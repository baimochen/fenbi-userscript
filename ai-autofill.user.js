// ==UserScript==
// @name         AI 页面自动填写
// @namespace    https://github.com/baimochen/fenbi-userscript
// @version      1.3
// @description  跑在 AI 站点页面里：收到题目就填进输入框，顺手藏掉碍事的按钮。目前只适配豆包
// @author       baimochen
// @match        *://*.doubao.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

// 这个脚本是「询问 AI」这条链路的最后一环。
//
// 为什么必须有它 —— 粉笔页面上的脚本拿不到跨域 iframe 里的内容，豆包的输入框
// 对它来说是一堵墙。唯一能碰豆包输入框的，是跑在豆包页面自己里面的脚本，
// 也就是这一个。
//
// 豆包没有可用的 URL 预填：
//   ?q=        —— 不是豆包原生支持的，网上那些「支持豆包」的脚本都是自己读参数
//                 再往 DOM 里注入，跟我们在这里做的是同一件事
//   url-action —— 曾经有个 {"pluginId":"Send_Message"} 的深链能直接发消息，
//                 现在已失效（社区反馈只会跳首页）
//
// @grant none 是故意的：脚本跑在页面自己的 JS 上下文里，window 没被包装过，
// postMessage 那条路一点疑问都没有。代价是用不了 GM_* 接口，所以测试入口
// 做成了挂在 window 上的函数和快捷键，而不是油猴菜单。
//
// 挂 window 这件事只有在 @grant none 下才成立 —— 页面上下文和 DevTools
// 控制台是同一个 JS 世界，所以控制台里能直接敲到它。

(function () {
    'use strict';

    // 版本号。
    //
    // 只在头部 @version 和这里各写一次，测试盯着这两处必须一致 ——
    // 对不上就会出现「日志说 1.1，装的是 1.0」这种事，而版本号正是
    // 用来判断「我装的是哪版」的，它自己不可信就白搭了。
    const VERSION = '1.3';


    // =========================================================
    // 配置
    // =========================================================

    const CONFIG = {

        // 从父页面发来的消息用这个标记认领，避免和别的 postMessage 撞上
        messageTag: 'fbai-ask',

        // 填进去之后自动发出去。
        //
        // 打开之后，任何能往这个页面发消息的网页都能替你按下发送 —— 所以它
        // 必须和下面的 allowedOrigins 一起看，那份白名单里没有通配符，只有
        // 粉笔自己。只想让脚本帮你填、发送自己来，把它改回 false。
        autoSend: true,

        // 填完等这么久再发。
        //
        // 不能填完就发：富文本编辑器把内容同步进自己的状态要一个 tick，
        // 豆包的发送按钮跟着那个状态走，早了它还是灰的，点了没反应 ——
        // 而且是静默的，看起来跟没实现一样。
        sendDelay: 250,

        // 发完再等这么久，回头验一下编辑器空了没有。
        //
        // 点下去和真发出去是两件事。不验的话「点了但没生效」会一路装成
        // 成功，而这是按位置猜按钮最可能出的错。
        sendVerifyDelay: 900,

        // 只认这些来源发来的消息。
        //
        // 不校验的话，任何一个 iframe 了豆包的网页都能往输入框里塞字。
        // 填了不发送的话危害有限，但 autoSend 一开就是提示词注入的入口。
        allowedOrigins: [
            'https://spa.fenbi.com',
            'https://www.fenbi.com',
            'https://fenbi.com'
        ],

        // 找输入框时，只在这个比例以下的区域里找（0.4 = 屏幕下 60%）。
        // 豆包页面上半部分是对话记录，排除掉能少认错很多元素。
        searchFrom: 0.4,

        // 等输入框出现的时间上限。豆包是 SPA，刚打开时输入框可能还没渲染。
        waitTimeout: 12000,

        // 填完之后把光标留在输入框里，方便你直接改
        focusAfterFill: true,

        // 测试入口的快捷键。
        //
        // 在 Mac 上控制台那条路更稳（见下面 start() 里的 fbaiTest），这种三键
        // 组合浏览器和系统都有可能先一步吃掉，吃掉了还不报错。
        testHotkey: { code: 'KeyF', ctrl: true, alt: true },

        // 测试时填的内容
        testText: '这是一条来自 ai-autofill 的测试消息。看到它说明输入框找对了。',

        // =====================================================
        // 页面清理
        // =====================================================

        // 要藏起来的按钮，按上面的文字认。
        //
        // 不按 class 认：豆包的 class 是一长串 Tailwind 工具类加一个带哈希的
        // 后缀（比如 enhanceBtn-W9xBoi），重新部署就换一批，认不住。文字是
        // 这类按钮上少数稳定的东西。
        //
        // 要加就在这儿往后加，比如 '下载手机版'。
        hideTexts: ['下载电脑版'],

        // 页面变动之后隔多久去清理一次。
        //
        // 豆包的回复是流式的，页面几乎一直在动，observer 会被叫得很勤，
        // 必须防抖 —— 不然等于每来一个字就全页扫一遍按钮。
        cleanDelay: 300
    };


    // =========================================================
    // 纯函数
    // =========================================================

    // 从候选里挑一个最像「输入框」的。
    //
    // 不硬编码豆包的 class —— 那种选择器活不过一次改版。改成按几何特征挑：
    // 面积最大的那个（聊天站的输入框通常是页面上最大的可编辑区域），
    // 面积相同就取更靠下的（输入框在底部）。
    //
    // 候选项的形状是 { node, width, height, top, hidden }，测量在外面做，
    // 这样这个函数是纯的，测试里不用真的排版。
    function pickComposer(candidates, options) {

        const searchFrom =
            (options && options.searchFrom) || 0;

        const viewportHeight =
            (options && options.viewportHeight) || 0;


        const usable = candidates.filter(item => {

            // 藏起来的不算：富文本编辑器常留一个隐藏的 textarea 做兜底
            if (item.hidden) {
                return false;
            }

            // 太小，不像能打字的
            if (item.width < 80 || item.height < 16) {
                return false;
            }

            // 在上半屏，那是对话区不是输入框
            if (viewportHeight && item.top < viewportHeight * searchFrom) {
                return false;
            }

            return true;
        });


        if (!usable.length) {
            return null;
        }


        usable.sort((a, b) => {

            const byArea =
                (b.width * b.height) - (a.width * a.height);

            return byArea !== 0 ? byArea : b.top - a.top;
        });


        return usable[0].node;
    }


    // 把题目编码进 URL 片段。
    //
    // 这是 postMessage 之外的备用通道。postMessage 万一跨不过油猴的沙箱，
    // 就退回「改 iframe 地址」——代价是页面重载（当前对话没了），但一定能到。
    function encodePayload(text) {
        return 'fbai=' + encodeURIComponent(text);
    }


    function decodePayload(hash) {

        const raw = String(hash || '').replace(/^#/, '');

        const match = /(?:^|&)fbai=([^&]*)/.exec(raw);

        if (!match) {
            return '';
        }

        try {
            return decodeURIComponent(match[1]);
        } catch (error) {
            // 手工改坏的地址不该把脚本搞崩
            return '';
        }
    }


    // 平台字符串。platform 已经不被推荐了，但它比 userAgent 好读，
    // 而且 Node 里也有（macOS 上返回 MacIntel），所以测试能直接喂。
    function platformName() {

        return navigator.platform || navigator.userAgent || '';
    }


    // Mac 上 Alt 键印的是 Option，日志里喊「Alt+F」会让人以为是别的东西。
    //
    // platform 可以显式传进来 —— 不传就读当前平台。测试靠这个才能不受
    // 跑测试的机器影响。
    function isMac(platform) {

        const value =
            platform === undefined ? platformName() : platform;

        return /Mac|iPhone|iPad/i.test(value);
    }


    // 把 testHotkey 拼成人看的样子，跟着平台换键名
    function hotkeyLabel(platform) {

        const key = CONFIG.testHotkey;

        const mac = isMac(platform);

        const parts = [];


        if (key.ctrl) parts.push('Ctrl');
        if (key.alt) parts.push(mac ? 'Option' : 'Alt');
        if (key.shift) parts.push('Shift');
        if (key.meta) parts.push(mac ? 'Cmd' : 'Win');


        parts.push(String(key.code || '').replace(/^Key/, ''));


        return parts.join('+');
    }


    // 只认自己人。不校验来源的话，任何 iframe 了豆包的网页都能往输入框里塞字。
    function originAllowed(origin, allowed) {

        if (!origin) {
            return false;
        }


        for (const entry of allowed || []) {

            if (origin === entry) {
                return true;
            }

            // 允许 fenbi 的各个子域
            try {

                const host = new URL(origin).hostname;
                const base = new URL(entry).hostname.replace(/^www\./, '');

                if (host === base || host.endsWith('.' + base)) {
                    return true;
                }

            } catch (error) {
                // 不是合法 URL 就算了
            }
        }


        return false;
    }


    // =========================================================
    // 测量与填充（碰 DOM）
    // =========================================================

    const EDITABLE_SELECTOR =
        'textarea, input[type="text"], input:not([type]), [contenteditable="true"]';


    function measure(node, view) {

        const rect = node.getBoundingClientRect();

        const style = view.getComputedStyle(node);


        return {

            node: node,

            width: rect.width,

            height: rect.height,

            top: rect.top,

            hidden:
                style.display === 'none'
                || style.visibility === 'hidden'
                || style.opacity === '0'
                || node.getAttribute('aria-hidden') === 'true'
        };
    }


    function findComposer(doc, options) {

        const view = doc.defaultView;


        // 没有 window 就量不了尺寸，也就挑不出输入框
        if (!view) {
            return null;
        }


        const candidates = [];


        for (const node of doc.querySelectorAll(EDITABLE_SELECTOR)) {

            if (node.disabled || node.readOnly) {
                continue;
            }


            candidates.push(measure(node, view));
        }


        return pickComposer(candidates, {

            searchFrom:
                (options && options.searchFrom) !== undefined
                    ? options.searchFrom
                    : CONFIG.searchFrom,

            viewportHeight:
                view.innerHeight || 0
        });
    }


    // textarea / input：必须走原型上的 setter。
    //
    // 直接 node.value = x 只是在 DOM 上改了个属性，React 记的是它自己那份
    // state，onChange 根本不会触发，界面上看着还是空的。
    function fillInput(node, text) {

        const view = node.ownerDocument.defaultView;

        // 原型从节点自己身上取，不按标签猜。
        //
        // 猜错的话 setter 会抛「不是 HTMLInputElement 的实例」，而这条路的
        // 意义正是拿到原生 setter —— React 认得的就是它。
        const proto = Object.getPrototypeOf(node);

        const descriptor =
            Object.getOwnPropertyDescriptor(proto, 'value');


        if (descriptor && descriptor.set) {
            descriptor.set.call(node, text);
        } else {
            node.value = text;
        }


        node.dispatchEvent(new view.Event('input', { bubbles: true }));

        node.dispatchEvent(new view.Event('change', { bubbles: true }));
    }


    // contenteditable：全选 + insertText。
    //
    // execCommand 是被标了废弃，但富文本编辑器（包括豆包用的那种）至今只认
    // 这条路的输入事件。直接改 textContent 它们多半看不见。
    function fillEditable(node, text) {

        const doc = node.ownerDocument;

        const view = doc.defaultView;


        const range = doc.createRange();

        range.selectNodeContents(node);


        const selection = view.getSelection();

        selection.removeAllRanges();

        selection.addRange(range);


        let inserted = false;

        try {
            inserted = doc.execCommand('insertText', false, text);
        } catch (error) {
            inserted = false;
        }


        if (!inserted) {

            node.textContent = text;

            node.dispatchEvent(new view.InputEvent('input', {
                bubbles: true,
                inputType: 'insertText',
                data: text
            }));
        }
    }


    function fill(node, text) {

        node.focus();


        // 按标签分，不看 node.isContentEditable —— 那个属性在 jsdom 里恒为
        // false（测试里就是这么撞出来的），照它分会拿 contenteditable 去当
        // textarea 填，然后抛异常。标签是确定的。
        //
        // 能走到这儿的就两种：EDITABLE_SELECTOR 选的要么是 textarea / input，
        // 要么是 contenteditable。
        if (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT') {
            fillInput(node, text);
        } else {
            fillEditable(node, text);
        }


        if (!CONFIG.focusAfterFill) {
            node.blur();
        }
    }


    // =========================================================
    // 发送
    //
    // 「填进去」和「发出去」是两件事：填是往 DOM 里写，发是按下那个按钮。
    // 分成两步是因为「填进去了但没发出去」是个很常见的中间态，得能单独看见
    // 和单独验。
    // =========================================================

    // 找发送按钮时，最远只认到输入框外这么多像素。
    //
    // 有硬上限是故意的。按位置猜按钮，猜偏了就会点到别的东西 —— 在别人的
    // 页面上乱点是不可接受的，宁可发不出去、退回模拟回车。
    const SEND_RADIUS = 160;


    // 这个按钮算不算「能按」。
    function isClickableButton(node, view) {

        if (node.disabled) {
            return false;
        }

        if (node.getAttribute('aria-disabled') === 'true') {
            return false;
        }

        const rect = node.getBoundingClientRect();

        // 没尺寸 = 不在布局里（jsdom 里量什么都是 0，测试自己塞矩形）
        if (rect.width <= 0 || rect.height <= 0) {
            return false;
        }

        const style = view.getComputedStyle(node);

        return (
            style.display !== 'none'
            && style.visibility !== 'hidden'
            && style.pointerEvents !== 'none'
        );
    }


    // 找发送按钮。
    //
    // 不认 class —— 豆包那些 class 是 Tailwind 工具类加一个带哈希的后缀，
    // 改版就换一批，认不住（藏「下载电脑版」的时候已经吃过一次这个亏）。
    //
    // 改成认位置：发送按钮在输入区的右下角。这个空间关系比任何选择器都稳，
    // 因为它是由「人手要够得着」决定的，不是由哪个前端随手写的。
    //
    // 从输入框往上逐层找，第一层里出现合格的就地挑、不再往上 —— 范围越小，
    // 越不可能误伤到页面别处的按钮。
    function findSendButton(composer, options) {

        const view = composer.ownerDocument.defaultView;

        if (!view) {
            return null;
        }


        const radius = (options && options.radius) || SEND_RADIUS;
        const depth = (options && options.depth) || 6;

        const box = composer.getBoundingClientRect();

        const right = box.right;
        const bottom = box.bottom;

        // 输入框的横向中点
        const middle = box.left + box.width / 2;


        let scope = composer.parentElement;

        for (let level = 0; level < depth && scope; level++) {

            const found = [];


            for (const node of scope.querySelectorAll('button, [role="button"]')) {

                if (!isClickableButton(node, view)) {
                    continue;
                }

                const rect = node.getBoundingClientRect();

                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;

                // 得在中点右边。左边那一排是「深度思考」「联网」这类开关，
                // 点下去会改设置，不是发送。
                if (cx < middle) {
                    continue;
                }

                // 得在输入框顶边以下 —— 输入区上方是对话记录和它的操作按钮
                if (cy < box.top) {
                    continue;
                }

                const distance = Math.hypot(cx - right, cy - bottom);

                if (distance > radius) {
                    continue;
                }

                found.push({ node: node, distance: distance });
            }


            if (found.length) {

                // 离右下角最近的那个。发送按钮就在光标该在的地方。
                found.sort((a, b) => a.distance - b.distance);

                return found[0].node;
            }


            scope = scope.parentElement;
        }


        return null;
    }


    // 回车那条退路。
    //
    // 富文本编辑器（豆包用的是 ProseMirror）自己监听 keydown，合成的
    // KeyboardEvent 一样会跑进它的处理函数。少数站点会查 event.isTrusted
    // 把合成的挡掉，所以这条只当退路 —— 优先还是点真按钮，那是用户本来
    // 就会做的事。
    function pressEnter(node) {

        const view = node.ownerDocument.defaultView;

        const init = {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
            composed: true
        };


        for (const type of ['keydown', 'keypress', 'keyup']) {
            node.dispatchEvent(new view.KeyboardEvent(type, init));
        }
    }


    // 发出去。返回走的哪条路，好让日志说得清楚。
    function send(node) {

        const button = findSendButton(node);


        if (button) {

            button.click();

            return { how: 'button', node: button };
        }


        pressEnter(node);

        return { how: 'enter', node: null };
    }


    // 编辑器里还有字没有。按标签读，不按 isContentEditable —— 那个属性
    // 在 jsdom 里恒为 false，跟 fill() 里踩的是同一个坑。
    function textOf(node) {

        return node.tagName === 'TEXTAREA' || node.tagName === 'INPUT'
            ? String(node.value || '')
            : String(node.textContent || '');
    }


    function stillHasText(node) {

        return textOf(node).trim().length > 0;
    }


    // 发不出去时，把输入框周边的按钮摊开。
    //
    // 这是唯一能据以把上面那套启发式改准的东西 —— 光凭「点了没反应」，
    // 我没法知道该往哪个方向调。距离那一列就是发送按钮该最小的那个。
    function describeButtons(composer) {

        const view = composer.ownerDocument.defaultView;

        if (!view) {
            return [];
        }


        const box = composer.getBoundingClientRect();

        const out = [];

        let scope = composer.parentElement;


        for (let level = 0; level < 6 && scope; level++) {

            for (const node of scope.querySelectorAll('button, [role="button"]')) {

                const rect = node.getBoundingClientRect();

                out.push({
                    层: level,
                    标签: node.tagName,
                    class: String(node.className || '').slice(0, 60),
                    文字: normalizeText(node.textContent).slice(0, 20),
                    禁用: Boolean(node.disabled),
                    矩形: [
                        Math.round(rect.left),
                        Math.round(rect.top),
                        Math.round(rect.width),
                        Math.round(rect.height)
                    ].join(','),
                    距右下角: Math.round(
                        Math.hypot(
                            rect.left + rect.width / 2 - box.right,
                            rect.top + rect.height / 2 - box.bottom
                        )
                    )
                });
            }


            scope = scope.parentElement;
        }


        return out;
    }


    // 填完自己发出去。
    function autoSend(node, text) {

        setTimeout(() => {

            const result = send(node);


            console.log(
                '[AI 自动填写] 已发送（' +
                (result.how === 'button'
                    ? '点了发送按钮'
                    : '退路：模拟回车') +
                '）',
                result.node || ''
            );


            // 点下去 ≠ 发出去了。回来验一眼编辑器空没空 —— 不验的话
            // 「点了但没生效」会一路装成成功，而按位置猜按钮最可能出的
            // 就是这个错。
            setTimeout(() => {

                if (stillHasText(node)) {

                    toast('没发出去，题目还在输入框里');

                    console.warn(
                        '[AI 自动填写] 点了发送但输入框没清空。' +
                        '下面是输入框周边的按钮，按离右下角的距离排序：'
                    );

                    console.table(describeButtons(node));

                    return;
                }


                toast('题目已发送');

            }, CONFIG.sendVerifyDelay);

        }, CONFIG.sendDelay);
    }


    // 豆包是 SPA，刚打开时输入框可能还没渲染出来，等一下
    function fillWhenReady(text, deadline) {

        const node = findComposer(document);


        if (node) {

            fill(node, text);


            // 先立刻说一声，别让人对着没动静的界面等那一秒
            toast(CONFIG.autoSend ? '题目已填入，正在发送…' : '题目已填入，自己按发送');


            console.log('[AI 自动填写] 已填入', {
                element: node,
                tag: node.tagName,
                contenteditable: node.isContentEditable,
                text: text.slice(0, 60)
            });


            if (CONFIG.autoSend) {
                autoSend(node, text);
            }


            return true;
        }


        if (Date.now() > deadline) {

            toast('没找到输入框，题目在剪贴板里，手动粘一下');

            console.warn('[AI 自动填写] 超时仍未找到输入框', {
                candidates: [...document.querySelectorAll(EDITABLE_SELECTOR)]
                    .map(n => ({
                        tag: n.tagName,
                        cls: n.className,
                        rect: n.getBoundingClientRect().toJSON()
                    }))
            });

            return false;
        }


        setTimeout(() => fillWhenReady(text, deadline), 300);

        return false;
    }


    // =========================================================
    // 页面上的反馈
    //
    // 填进去了没有，得让人一眼看见 —— 否则「没反应」和「填错了地方」
    // 这两种情况分不出来。
    // =========================================================

    const TOAST_ID = 'fbai-autofill-toast';

    let toastTimer = null;


    function toast(message) {

        let node = document.getElementById(TOAST_ID);


        if (!node) {

            node = document.createElement('div');

            node.id = TOAST_ID;

            node.style.cssText = [
                'position: fixed',
                'left: 50%',
                'bottom: 96px',
                'transform: translateX(-50%)',
                'z-index: 2147483647',
                'padding: 8px 14px',
                'border-radius: 8px',
                'background: rgba(48, 49, 51, 0.94)',
                'color: #fff',
                'font-size: 13px',
                'font-family: -apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif',
                'pointer-events: none',
                'opacity: 0',
                'transition: opacity .18s'
            ].join(';');


            document.body.appendChild(node);
        }


        node.textContent = message;

        node.style.opacity = '1';


        clearTimeout(toastTimer);

        toastTimer = setTimeout(() => {
            node.style.opacity = '0';
        }, 2600);
    }


    // =========================================================
    // 页面清理
    //
    // 藏掉豆包上不想要的按钮，见 CONFIG.hideTexts。
    //
    // 用藏不用删。豆包是 React，直接 node.remove() 是绕过它把节点摘掉，
    // 它下次重渲染时照自己的账本去删这个子节点会找不到，抛 NotFoundError，
    // 轻则控制台报错重则整块 UI 崩掉。display:none 观感上和删掉一样（不占
    // 位置），但不跟框架的账本打架。
    //
    // 按文字认而不是按 class：豆包的 class 是一长串 Tailwind 工具类加一个
    // 带哈希的后缀（enhanceBtn-W9xBoi），重新部署就换一批，认不住。
    // =========================================================

    // 要清理的东西只可能是这几类，范围收窄了每轮扫描才够便宜
    const CLEAN_SELECTOR = 'button, a, [role="button"]';


    function normalizeText(value) {

        return String(value == null ? '' : value)
            .replace(/\s+/g, ' ')
            .trim();
    }


    // 返回这一轮真的藏了几个。传 doc 是为了能在 jsdom 里对着假页面测。
    function cleanUnwanted(doc) {

        let hidden = 0;


        for (const node of doc.querySelectorAll(CLEAN_SELECTOR)) {

            // 整串文字相等才算。用「包含」会误伤外面的大容器 ——
            // 一个包着整个侧边栏的按钮只要里面有这四个字就会被一起藏掉。
            if (!CONFIG.hideTexts.includes(normalizeText(node.textContent))) {
                continue;
            }


            // 已经藏过的跳过。
            //
            // 不跳的话每轮都会写一次同样的值，写样式会产生 mutation，而
            // observer 正盯着子树 —— 自己喂自己，转成一个永动的重排循环。
            // 布局脚本里踩过这个坑，那边的 important() 就是为它加的。
            if (node.style.getPropertyValue('display') === 'none') {
                continue;
            }


            node.style.setProperty('display', 'none', 'important');

            hidden++;
        }


        if (hidden) {

            console.log(
                '[AI 自动填写] 藏起了 ' + hidden + ' 个按钮：' +
                CONFIG.hideTexts.join('、')
            );
        }


        return hidden;
    }


    function startCleaner() {

        cleanUnwanted(document);


        const target =
            document.body || document.documentElement;


        if (!target) {
            return;
        }


        let timer = null;


        // 豆包是 SPA，切换会话之类的操作会把按钮重新渲染出来，所以不能
        // 只在启动时清一次。
        new MutationObserver(() => {

            clearTimeout(timer);

            timer = setTimeout(
                () => cleanUnwanted(document),
                CONFIG.cleanDelay
            );

        }).observe(target, {
            childList: true,
            subtree: true
        });
    }


    // =========================================================
    // 入口
    // =========================================================

    function ask(text) {

        const trimmed = String(text || '').trim();


        if (!trimmed) {
            return;
        }


        fillWhenReady(trimmed, Date.now() + CONFIG.waitTimeout);
    }


    function start() {

        startCleaner();


        // 通道一：父页面直接发消息。不重载页面，当前对话还在。
        window.addEventListener('message', event => {

            const data = event.data;


            if (!data || data.tag !== CONFIG.messageTag) {
                return;
            }


            if (!originAllowed(event.origin, CONFIG.allowedOrigins)) {

                console.warn(
                    '[AI 自动填写] 忽略了来源不明的消息：' + event.origin
                );

                return;
            }


            console.log('[AI 自动填写] 收到题目（postMessage）');

            ask(data.text);
        });


        // 通道二：地址里带的题目。
        //
        // postMessage 万一跨不过油猴沙箱，父页面就改成拼地址 —— 会重载页面，
        // 但一定到得了。两条路都留着，坏了一条还有另一条。
        function consumeHash() {

            const text = decodePayload(window.location.hash);


            if (!text) {
                return;
            }


            // 用掉就擦掉，免得刷新一次又填一遍
            history.replaceState(
                null,
                '',
                window.location.pathname + window.location.search
            );


            console.log('[AI 自动填写] 收到题目（地址参数）');

            ask(text);
        }


        // -----------------------------------------------------
        // 测试入口：不依赖粉笔那边，先把「能不能找到输入框并填进去」
        // 确认了。这一步单独拎出来是故意的 —— 万一整条链路不通，
        // 能立刻分清是这一环坏了还是消息没传过来。
        //
        // 给两条路，因为快捷键不是百分百靠得住：浏览器、系统、输入法都可
        // 能先一步把某个组合键吃掉，而且吃掉了不报错，只表现为按了没反应。
        //
        //   控制台 fbaiTest()   —— 任何平台都拦不住，Mac 上优先用这个
        //   快捷键              —— 图个顺手
        // -----------------------------------------------------

        // 不用快捷键的那条路。挂在 window 上是因为 @grant none 让脚本跑在
        // 页面上下文，和 DevTools 控制台是同一个 JS 世界。
        window.fbaiTest = function (text) {

            console.log('[AI 自动填写] 控制台测试入口被调用');

            ask(text || CONFIG.testText);
        };


        // 想拿真题试就 fbaiFill('题目原文')，跳过拼接直接看填充效果
        window.fbaiFill = function (text) {
            ask(text);
        };


        // 发送按钮是按位置猜的，猜不中就点不动。这个入口把输入框周边的按钮
        // 全列出来（按离右下角的距离排序），发不出去时跑一下 —— 发送按钮
        // 就该是距离最小、又不带「禁用」的那个。
        window.fbaiDump = function () {

            const composer = findComposer(document);


            if (!composer) {
                console.warn('[AI 自动填写] 没找到输入框，先确认页面加载完了');
                return;
            }


            const box = composer.getBoundingClientRect();


            console.log('[AI 自动填写] 输入框', {
                tag: composer.tagName,
                cls: String(composer.className || '').slice(0, 80),
                rect: [
                    Math.round(box.left),
                    Math.round(box.top),
                    Math.round(box.width),
                    Math.round(box.height)
                ].join(',')
            });


            console.table(describeButtons(composer));
        };


        document.addEventListener('keydown', event => {

            const hotkey = CONFIG.testHotkey;


            if (event.code !== hotkey.code) {
                return;
            }


            // ctrlKey / altKey / shiftKey / metaKey 一个都不能多，也不能少
            const wanted = {
                ctrlKey: Boolean(hotkey.ctrl),
                altKey: Boolean(hotkey.alt),
                shiftKey: Boolean(hotkey.shift),
                metaKey: Boolean(hotkey.meta)
            };


            for (const key of Object.keys(wanted)) {

                if (Boolean(event[key]) !== wanted[key]) {
                    return;
                }
            }


            event.preventDefault();

            console.log('[AI 自动填写] 快捷键测试入口被触发');

            ask(CONFIG.testText);

        }, true);


        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', consumeHash);
        } else {
            consumeHash();
        }


        console.log(
            '[AI 自动填写] ' + VERSION + ' 已加载（豆包）\n' +
            '  单独测这一步（不依赖粉笔那边）：\n' +
            '    控制台敲  fbaiTest()          —— 最稳，任何平台都不会被拦\n' +
            '    或按      ' + hotkeyLabel() + '\n' +
            '  想拿真题试：fbaiFill(\'题目原文\')\n' +
            '  上面那句里没有 fbaiTest() 就是在跑旧版，重新贴一遍脚本'
        );
    }


    // =========================================================
    // 跑测试还是跑浏览器
    //
    // 有 module 就是 Node（跑测试），只导出纯函数；否则是浏览器，启动。
    // 这样测试测的就是要发布的这份代码本身，不是它的副本。
    // =========================================================

    if (typeof module !== 'undefined' && module.exports) {

        module.exports = {

            VERSION: VERSION,
            CONFIG: CONFIG,

            pickComposer: pickComposer,
            encodePayload: encodePayload,
            decodePayload: decodePayload,
            originAllowed: originAllowed,

            isMac: isMac,
            hotkeyLabel: hotkeyLabel,

            normalizeText: normalizeText,
            cleanUnwanted: cleanUnwanted,

            measure: measure,
            findComposer: findComposer,
            fill: fill,
            fillWhenReady: fillWhenReady,

            isClickableButton: isClickableButton,
            findSendButton: findSendButton,
            send: send,
            stillHasText: stillHasText,
            autoSend: autoSend,

            // 发不出去时靠它把周边的按钮摊出来，是唯一能据以改准
            // findSendButton 那套启发式的东西
            describeButtons: describeButtons
        };

    } else {

        start();
    }
})();
