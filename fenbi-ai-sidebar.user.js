// ==UserScript==
// @name         粉笔背题页 AI 侧边栏
// @namespace    https://github.com/baimochen/fenbi-userscript
// @version      2.1
// @description  在页面左侧悬浮一块 AI 面板，支持 ChatGPT / Gemini / Claude 等 13 家。所有设置都在油猴菜单里，页面上只留一块 iframe
// @author       baimochen
// @match        *://*.fenbi.com/*
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @homepageURL  https://github.com/baimochen/fenbi-userscript
// @supportURL   https://github.com/baimochen/fenbi-userscript/issues
// @downloadURL  https://raw.githubusercontent.com/baimochen/fenbi-userscript/main/fenbi-ai-sidebar.user.js
// @updateURL    https://raw.githubusercontent.com/baimochen/fenbi-userscript/main/fenbi-ai-sidebar.user.js
// ==/UserScript==

(function () {
    'use strict';

    // 版本号。
    //
    // 只在头部 @version 和这里各写一次，测试盯着这两处必须一致 —— 对不上
    // 就会出现「日志说 2.1，装的是 2.0」这种事，而版本号正是用来判断「我装
    // 的是哪版」的，它自己不可信就白搭了。
    //
    // 这个坑真踩过：加了「询问 AI」一整条链路却没动版本号，日志还是「2.0
    // 已加载」，于是「没反应」到底是旧版没这个功能、还是新版坏了，从页面上
    // 完全看不出来，白白多绕一轮。
    const VERSION = '2.1';


    // =========================================================
    // 配置
    //
    // 面板上不再有任何设置控件，所以需要调的东西全在这里，
    // 或者在油猴菜单里。
    // =========================================================

    const CONFIG = {

        // 面板宽度。要调就调这一个数。
        //
        // 原来面板上有个拖拽条能拉宽，拉出来的宽度会存进偏好里 —— 那个已经
        // 删了，所以这里就是唯一说了算的地方。
        //
        // 面板是浮在答题区左边的，调宽了会盖住一部分题目。答题区本身多宽由
        // fenbi-memorize-layout.user.js 的 questionMaxWidth 管，两者互不知道
        // 对方的存在，配的时候心里有个数。
        panelWidth: 380,

        // 面板上边缘。
        //
        // 这个值必须和 fenbi-memorize-layout.user.js 的 CONFIG.cardTop 相等 ——
        // 粉笔页面顶部有一条吸顶头部，压在它下面的东西会被遮住。答题卡当初就是
        // 靠这个偏移躲开的，面板跟着对齐，两块悬浮物才是齐平的。
        //
        // 测试里有一条会去读布局脚本的 cardTop 来比，改一边不改另一边会红。
        panelTop: 65,

        // 左右留的空隙。16px 是照答题卡的 cardRight 来的，两边对称。
        panelLeft: 16,
        panelBottom: 16,

        // 自定义服务地址。
        //
        // 留空就表示不用这一项 —— 菜单里不会出现「自定义」，也就不会有人
        // 误点出一个空白的 iframe。
        //
        // 填了就多出这一项，比如自建的：
        //   customUrl: 'https://chat.example.com/'
        customUrl: '',

        // 快捷键：显示 / 隐藏面板
        hotkey: { alt: true, code: 'KeyQ' },

        // 面板宿主元素 id，避免和宿主页面撞名
        panelId: 'fbai-panel',


        // =====================================================
        // 和另外两份脚本之间的约定
        // =====================================================

        // 「询问 AI」按钮把题目递过来用的信道。
        //
        // 走 DOM 事件 + 属性，不走 CustomEvent.detail —— 粉笔页面上的脚本
        // 和这份脚本各在油猴自己的沙箱里，detail 传不传得过来不稳。属性是
        // 两边都看得见的普通 DOM。
        //
        // 三个名字必须和 fenbi-memorize-layout.user.js 里的那几个一致，
        // 有测试盯着。
        askEvent: 'fbai-ask',
        askAttr: 'data-fbai-ask',

        // 送完往回写一个结果码，布局脚本读了才知道这一下成没成 ——
        // 否则按钮只能瞎报「已发送」。
        askResultAttr: 'data-fbai-ask-result',

        // 塞进 iframe 的那条消息用这个标记认领。
        //
        // 必须和 ai-autofill.user.js 的 CONFIG.messageTag 相等 —— 那边是
        // 跨域 iframe，调不了函数，只能靠约定。有测试盯着这两个值。
        askTag: 'fbai-ask',

        // 哪些站点那边配了能接住 postMessage 的脚本。
        //
        // 目前只有豆包（ai-autofill.user.js）。别家发了也没人听，与其静默
        // 丢掉，不如老实退回剪贴板。以后配了新的就往这儿加。
        autofillServices: ['doubao']
    };


    // =========================================================
    // AI 服务
    //
    // 只有名字和地址。
    //
    // 这里原本还有一套 prefill 规则（把题目拼进 ?q= 参数），随「问这道题」
    // 按钮一起删了 —— 现在脚本里没有任何地方会产生要投喂的题目，留着就是死代码。
    //
    // 带 embeddable 的表示「这个地址本身允许被 iframe 嵌入」，不受去头扩展
    // 影响。没写的按 false 算。
    // =========================================================

    const SERVICES = {

        chatgpt:    { label: 'ChatGPT',    url: 'https://chatgpt.com/' },
        gemini:     { label: 'Gemini',     url: 'https://gemini.google.com/app' },
        claude:     { label: 'Claude',     url: 'https://claude.ai/new' },
        deepseek:   { label: 'DeepSeek',   url: 'https://chat.deepseek.com/' },
        kimi:       { label: 'Kimi',       url: 'https://www.kimi.com/' },
        doubao:     { label: '豆包',       url: 'https://www.doubao.com/chat/' },
        tongyi:     { label: '通义千问',   url: 'https://www.tongyi.com/qianwen/' },
        yuanbao:    { label: '腾讯元宝',   url: 'https://yuanbao.tencent.com/chat/' },
        chatglm:    { label: '智谱清言',   url: 'https://chatglm.cn/main/alltoolsdetail' },
        grok:       { label: 'Grok',       url: 'https://grok.com/' },
        perplexity: { label: 'Perplexity', url: 'https://www.perplexity.ai/' },
        copilot:    { label: 'Copilot',    url: 'https://copilot.microsoft.com/' },

        custom:     { label: '自定义…',    url: '', embeddable: true }
    };


    // 自定义地址没配就别让它出现在菜单里 —— 点了只会得到一块空白
    function availableServices(config) {

        const custom =
            String((config && config.customUrl) || '').trim();


        const out = {};


        for (const [key, service] of Object.entries(SERVICES)) {

            if (key === 'custom' && !custom) {
                continue;
            }


            out[key] = service;
        }


        return out;
    }


    function serviceUrl(service, config) {

        if (service === 'custom') {
            return String((config && config.customUrl) || '').trim();
        }


        return SERVICES[service] ? SERVICES[service].url : '';
    }


    // =========================================================
    // 去头扩展检测
    // =========================================================

    // 这是这套东西里唯一可靠的一处「检测」：跨域 iframe 被 X-Frame-Options 拦掉之后，
    // 脚本拿不到 contentDocument，也没法区分「加载成功了」和「被拦了」—— 两条路的
    // onload 都会触发。所以干脆不猜：扩展自己往 documentElement 上打个标记，
    // 脚本读标记。装了就默认嵌入，没装就默认开窗口，都不给用户看白框。
    const UNFRAME_MARK = 'data-fbai-unframe';


    function hasUnframeExtension(doc) {

        const target =
            doc || (typeof document === 'undefined' ? null : document);


        if (!target || !target.documentElement) {
            return false;
        }


        return target.documentElement.getAttribute(UNFRAME_MARK) === '1';
    }


    // 题目该往哪儿送。返回 'frame' / 'window' / 'clipboard'。
    //
    // 抽成纯函数是为了能测：真正的决定因素就这五个，和 DOM、和面板当前状态
    // 都无关。混在 buildUi 里就只能靠手点，而这几条分支恰恰是最容易漏的
    // ——「面板收起来了」「当前选的不是豆包」「窗口模式下没有 iframe」。
    function deliverTarget(options) {

        const settings = options || {};


        // 地址都没有就没什么可送的
        if (!settings.url) {
            return 'clipboard';
        }


        // 那边没配配套脚本，发过去是石沉大海
        const receivers =
            settings.autofillServices || [];


        if (receivers.indexOf(settings.service) === -1) {
            return 'clipboard';
        }


        if (settings.mode === 'embed' && settings.hasFrame) {
            return 'frame';
        }


        if (settings.mode === 'window' && settings.hasWindow) {
            return 'window';
        }


        return 'clipboard';
    }


    // 没在菜单里选过就用默认值。
    //
    // 去头扩展在场 —— 嵌入是可用的，那就默认嵌入，用户装扩展就是为了这个。
    // 扩展不在场 —— 嵌入会白屏，默认开窗口。
    // 自定义 URL 不看扩展：用户自己填的地址本来就可能是允许嵌入的。
    function resolveMode(prefs, service, unframeAvailable) {

        if (prefs.mode === 'embed' || prefs.mode === 'window') {
            return prefs.mode;
        }


        const embeddable =
            Boolean(SERVICES[service] && SERVICES[service].embeddable);


        return embeddable || unframeAvailable
            ? 'embed'
            : 'window';
    }


    // =========================================================
    // 偏好存储
    // =========================================================

    const STORE_PREFIX = 'fbai.';

    // 宽度不在这里 —— 它只听 CONFIG.panelWidth 的，见上面的说明。
    const DEFAULTS = {

        // 面板收起来了没有。收起后页面上不留任何东西，靠快捷键或菜单叫回来。
        hidden: false,

        service: 'chatgpt',

        // 空串 = 没选过，按去头扩展在不在决定。菜单里点过就固定下来。
        mode: ''
    };


    function hasGM() {

        return typeof GM_getValue === 'function'
            && typeof GM_setValue === 'function';
    }


    function readPrefs() {

        const prefs = Object.assign({}, DEFAULTS);


        for (const key of Object.keys(DEFAULTS)) {

            try {

                const stored =

                    hasGM()
                        ? GM_getValue(STORE_PREFIX + key, null)
                        : JSON.parse(
                            localStorage.getItem(STORE_PREFIX + key) || 'null'
                        );


                if (stored !== null && stored !== undefined) {
                    prefs[key] = stored;
                }

            } catch (error) {

                // 读不出来就用默认值，不值得为一个宽度把脚本搞崩
            }
        }


        return prefs;
    }


    function writePref(key, value) {

        try {

            if (hasGM()) {
                GM_setValue(STORE_PREFIX + key, value);
                return;
            }


            localStorage.setItem(
                STORE_PREFIX + key,
                JSON.stringify(value)
            );

        } catch (error) {

            // 存不下也不影响这一秒的显示
        }
    }


    // =========================================================
    // 样式
    //
    // 圆角、边框、阴影、底色、头部条高度都照抄布局脚本里的
    // #fenbi-custom-answer-card —— 两块悬浮物要看起来是一套的。
    // 测试里有一条会去读那边的真值逐条比，改一边不改另一边会红。
    // =========================================================

    const CSS = `

        :host {
            all: initial;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
                "Microsoft YaHei", sans-serif;
            font-size: 13px;
            line-height: 1.5;
            letter-spacing: normal;
            text-transform: none;
            list-style: none;
        }

        .wrap {
            position: fixed;
            top: ${CONFIG.panelTop}px;
            left: ${CONFIG.panelLeft}px;
            height: calc(100vh - ${CONFIG.panelTop + CONFIG.panelBottom}px);
            display: flex;
            z-index: 2147483000;
            color: #1f2329;
        }

        .panel {
            width: ${CONFIG.panelWidth}px;
            display: flex;
            flex-direction: column;
            background: rgba(255, 255, 255, 0.98);
            border: 1px solid #e7eaf0;
            border-radius: 9px;
            box-shadow: 0 3px 14px rgba(0, 0, 0, 0.07);
            overflow: hidden;
        }

        .panel-header {
            flex: 0 0 auto;
            height: 42px;
            padding: 0 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: #fff;
            border-bottom: 1px solid #f0f1f3;
            user-select: none;
        }

        .panel-title {
            display: flex;
            align-items: center;
            gap: 7px;
            font-size: 14px;
            font-weight: 600;
            color: #303133;
        }

        .panel-icon {
            width: 23px;
            height: 23px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 5px;
            background: #f4f7fb;
            font-size: 14px;
        }

        .collapse {
            font: inherit;
            line-height: 1;
            color: #909399;
            background: none;
            border: 0;
            border-radius: 5px;
            padding: 4px 7px;
            cursor: pointer;
        }

        .collapse:hover {
            background: #f4f7fb;
            color: #303133;
        }

        .panel-body {
            flex: 1 1 auto;
            position: relative;
            min-height: 0;
            background: #fff;
        }

        iframe {
            display: block;
            width: 100%;
            height: 100%;
            border: 0;
        }

        .toast {
            position: absolute;
            left: 12px;
            right: 12px;
            bottom: 12px;
            padding: 8px 11px;
            border-radius: 7px;
            background: rgba(48, 49, 51, 0.94);
            color: #fff;
            font-size: 12px;
            opacity: 0;
            transition: opacity .18s;
            pointer-events: none;
        }

        .toast.on {
            opacity: 1;
        }
    `;

    let toastTimer = null;


    // =========================================================
    // 启动
    // =========================================================

    function init() {

        const host =
            document.createElement('div');


        host.id = CONFIG.panelId;

        // 宿主元素本身也要挡掉继承，Shadow DOM 只隔离选择器，不隔离继承属性
        host.style.cssText =
            'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0;';


        const root =
            host.attachShadow({ mode: 'open' });


        const style =
            document.createElement('style');

        style.textContent = CSS;

        root.appendChild(style);


        document.documentElement.appendChild(host);


        const ui = buildUi(
            root,
            readPrefs(),
            host,
            hasUnframeExtension()
        );


        bindHotkey(ui);

        registerMenu(ui);

        ui.render();


        // 「询问 AI」按钮在布局脚本那边，它把题目写在属性上再发一个 DOM
        // 事件过来 —— 两份脚本各在自己的油猴沙箱里，除了 DOM 没有别的
        // 东西是共用的。
        //
        // 监听挂在 document 上，用捕获：布局脚本是同步 dispatch 的，
        // 处理完把结果码写回另一个属性，它 dispatch 返回后就能读到。
        document.addEventListener(
            CONFIG.askEvent,
            () => {

                const root = document.documentElement;

                const text =
                    root.getAttribute(CONFIG.askAttr) || '';


                // 这行日志是整条链路唯一一处「我确实被叫醒了」的凭据。
                //
                // 跨沙箱的这条信道一旦不通，症状和「跑的是没有这个功能的
                // 旧版」一模一样 —— 都是点了没反应，别处一点线索都没有。
                // 有这行就能当场分开。
                console.log(
                    '[粉笔 AI 侧边栏] 收到询问请求，题目 ' +
                    text.length + ' 字'
                );


                if (!text) {
                    return;
                }


                const result = ui.deliver(text);


                console.log('[粉笔 AI 侧边栏] 投递结果：' + result);


                root.setAttribute(
                    CONFIG.askResultAttr,
                    result
                );
            },
            true
        );


        return ui;
    }


    function el(tag, className, text) {

        const node =
            document.createElement(tag);


        if (className) {
            node.className = className;
        }


        if (text != null) {
            node.textContent = text;
        }


        return node;
    }


    // 面板里唯一会出现的临时文字。页面上不留常驻提示，只有「刚才那下没成」
    // 这种必须当场说的话才浮出来两秒。
    function toast(container, message) {

        let node =
            container.querySelector('.toast');


        if (!node) {

            node = el('div', 'toast');

            container.appendChild(node);
        }


        node.textContent = message;

        node.classList.add('on');


        clearTimeout(toastTimer);


        toastTimer = setTimeout(
            () => node.classList.remove('on'),
            2600
        );
    }


    // 送不出去的时候把题目放进剪贴板。
    //
    // 面板在 Shadow DOM 里，document.execCommand 那份兜底得挂在外面的
    // body 上，所以这里只走 navigator.clipboard。
    function copyText(text) {

        try {

            if (navigator.clipboard && navigator.clipboard.writeText) {

                navigator.clipboard.writeText(text);

                return true;
            }

        } catch (error) {

            // 权限被拒之类，当失败处理
        }


        return false;
    }


    // =========================================================
    // 面板
    //
    // 页面上只有三样东西：一条头部、一块 iframe、偶尔浮一下的提示。
    // 没有下拉框、没有模式按钮 —— 设置全在油猴菜单里。
    // =========================================================

    function buildUi(root, prefs, host, unframeAvailable) {

        const wrap = el('div', 'wrap');

        const panel = el('div', 'panel');

        const header = el('div', 'panel-header');

        const title = el('div', 'panel-title');

        const collapse = el('button', 'collapse', '⟨');

        const body = el('div', 'panel-body');


        collapse.type = 'button';

        collapse.title = '收起（Alt+Q 叫回来）';

        collapse.setAttribute('aria-label', '收起面板');


        title.append(el('div', 'panel-icon', '🤖'), el('span', null, 'AI 助手'));

        header.append(title, collapse);

        panel.append(header, body);

        wrap.append(panel);

        root.appendChild(wrap);


        const state = {

            prefs: prefs,

            frame: null,

            // 独立窗口模式下 openWindow 开出来的那个窗口，题目要往它送
            window: null
        };


        function currentService() {

            return SERVICES[state.prefs.service]
                ? state.prefs.service
                : 'chatgpt';
        }


        function currentMode() {

            return resolveMode(
                state.prefs,
                currentService(),
                unframeAvailable
            );
        }


        function render() {

            wrap.style.display =
                state.prefs.hidden ? 'none' : 'flex';

            panel.style.width =
                CONFIG.panelWidth + 'px';


            const url =
                serviceUrl(currentService(), CONFIG);


            // 不嵌的时候把 iframe 摘掉，不是藏起来 —— 留着的话那个站点还在后台
            // 跑着，白占内存，也没人会看到它。
            const shouldEmbed =
                currentMode() === 'embed' && Boolean(url);


            if (!shouldEmbed) {

                if (state.frame) {

                    state.frame.remove();

                    state.frame = null;
                }


                return;
            }


            if (!state.frame) {

                state.frame = document.createElement('iframe');

                state.frame.setAttribute('referrerpolicy', 'no-referrer');

                body.appendChild(state.frame);
            }


            if (state.frame.getAttribute('src') !== url) {
                state.frame.setAttribute('src', url);
            }
        }


        function setService(key) {

            state.prefs.service = key;

            writePref('service', key);

            render();
        }


        function setMode(mode) {

            state.prefs.mode = mode;

            writePref('mode', mode);

            render();
        }


        function setHidden(value) {

            state.prefs.hidden = Boolean(value);

            writePref('hidden', state.prefs.hidden);

            render();
        }


        // 题目送到当前这块面板里。
        //
        // 返回结果码，调用方（init 里那个事件监听）会把它写回 DOM 属性，
        // 布局脚本读了才知道按钮上该显示「已发送」还是「已复制」。
        function deliver(text) {

            if (!text) {
                return 'none';
            }


            // 面板收起来了就先叫回来 —— 不然填进去了用户也看不见，
            // 只会觉得点了没反应。
            if (state.prefs.hidden) {
                setHidden(false);
            }


            const key = currentService();

            const url = serviceUrl(key, CONFIG);

            const label =
                (SERVICES[key] && SERVICES[key].label) || 'AI';


            const target = deliverTarget({

                url: url,
                service: key,
                mode: currentMode(),
                hasFrame: Boolean(state.frame && state.frame.contentWindow),
                hasWindow: Boolean(state.window && !state.window.closed),
                autofillServices: CONFIG.autofillServices
            });


            if (target === 'clipboard') {

                // 送不到就放剪贴板。静默丢掉是最差的 —— 用户会以为脚本坏了，
                // 而其实题目就在手边。
                const copied = copyText(text);

                toast(
                    body,
                    copied
                        ? '题目已复制（' + label + '还不能自动填）'
                        : '题目没能送出去，手动复制一下'
                );

                return copied ? 'copied' : 'none';
            }


            const receiver =
                target === 'frame'
                    ? state.frame.contentWindow
                    : state.window;


            try {

                receiver.postMessage(
                    { tag: CONFIG.askTag, text: text },
                    new URL(url).origin
                );

            } catch (error) {

                toast(body, '题目没能送出去：' + error.message);

                return 'none';
            }


            toast(body, '题目已发给' + label);

            return 'sent';
        }


        function openWindow() {

            const url =
                serviceUrl(currentService(), CONFIG);


            if (!url) {

                toast(body, '没配自定义地址，先在脚本里填 CONFIG.customUrl');

                return;
            }


            const screen =
                window.screen || {};


            // 贴屏幕左侧，和面板待在同一个位置
            const width = Math.max(
                360,
                Math.round((screen.availWidth || 1440) * 0.36)
            );

            const height = Math.max(
                600,
                (screen.availHeight || 900) - 80
            );


            const opened = window.open(
                url,
                'fbai-window',
                'left=0,top=0,width=' + width + ',height=' + height
            );


            if (!opened) {

                toast(body, '窗口被浏览器拦了，允许这个站点弹窗再试');

                return;
            }


            // 留着这个把手，题目才有地方送 —— 独立窗口模式下没有 iframe，
            // 只有它。
            state.window = opened;


            opened.focus();
        }


        collapse.addEventListener('click', () => setHidden(true));


        return {

            root: root,
            host: host,

            render: render,

            currentService: currentService,
            currentMode: currentMode,

            isHidden: () => Boolean(state.prefs.hidden),

            setService: setService,
            setMode: setMode,
            setHidden: setHidden,

            toggle: () => setHidden(!state.prefs.hidden),

            openWindow: openWindow,

            deliver: deliver
        };
    }


    // =========================================================
    // 快捷键
    // =========================================================

    function bindHotkey(ui) {

        const hotkey = CONFIG.hotkey;


        document.addEventListener('keydown', event => {

            if (event.code !== hotkey.code) {
                return;
            }


            // 该按的修饰键一个都不能少，不该按的一个都不能多 ——
            // 不然用户在输入框里按 Ctrl+Alt+Q 也会把面板弄没
            for (const key of ['altKey', 'ctrlKey', 'shiftKey', 'metaKey']) {

                const wanted =
                    Boolean(hotkey[key.replace('Key', '')]);


                if (Boolean(event[key]) !== wanted) {
                    return;
                }
            }


            event.preventDefault();

            ui.toggle();

        }, true);

    }


    // =========================================================
    // 油猴菜单
    //
    // 设置全在这儿，所以菜单就是这套东西的主界面。
    //
    // Tampermonkey 没有子菜单（那是 ScriptCat 的特性），只能拍平成一长条。
    // 勾选状态靠 unregister + 重新注册来更新 —— 没有「改一项」的 API。
    // =========================================================

    function registerMenu(ui) {

        if (typeof GM_registerMenuCommand !== 'function') {
            return;
        }


        const canUnregister =
            typeof GM_unregisterMenuCommand === 'function';


        let ids = [];


        function add(name, onClick) {
            ids.push(GM_registerMenuCommand(name, onClick));
        }


        // 当前那项打个勾，其余留白对齐（全角空格，和勾同宽）
        function tick(active) {
            return active ? '✓ ' : '　 ';
        }


        function paint() {

            const service =
                ui.currentService();

            const mode =
                ui.currentMode();


            add('显示 / 隐藏面板 (Alt+Q)', () => {

                ui.setHidden(!ui.isHidden());

                rebuild();
            });


            // 嵌入模式下这一步没有意义，不占地方
            if (mode === 'window') {

                add('打开 ' + SERVICES[service].label + ' 窗口', () => {
                    ui.openWindow();
                });
            }


            for (const [key, item] of Object.entries(availableServices(CONFIG))) {

                add(tick(key === service) + 'AI：' + item.label, () => {

                    ui.setService(key);

                    rebuild();
                });
            }


            add(tick(mode === 'embed') + '模式：嵌入页面', () => {

                ui.setMode('embed');

                rebuild();
            });


            add(tick(mode === 'window') + '模式：独立窗口', () => {

                ui.setMode('window');

                rebuild();
            });
        }


        // 先撤掉旧的再画新的，不然每切一次 AI 菜单就长一截
        function rebuild() {

            if (!canUnregister) {
                return;
            }


            for (const id of ids) {
                GM_unregisterMenuCommand(id);
            }


            ids = [];

            paint();
        }


        paint();
    }


    // =========================================================
    // 出口
    //
    // 有 module 就是 Node（跑测试），只导出纯函数；否则是浏览器，启动面板。
    // 这样测试测的就是要发布的这份代码本身，不是它的副本。
    // =========================================================

    if (typeof module !== 'undefined' && module.exports) {

        module.exports = {

            SERVICES: SERVICES,
            CONFIG: CONFIG,

            availableServices: availableServices,
            serviceUrl: serviceUrl,

            resolveMode: resolveMode,
            hasUnframeExtension: hasUnframeExtension,

            deliverTarget: deliverTarget,

            VERSION: VERSION
        };

    } else {

        init();

        // 两份脚本各干各的，装没装从页面上看不出来 —— 这行日志是唯一的凭据。
        // 「切换 AI 在哪」这类问题，先看这行在不在。
        console.log(
            '[粉笔 AI 侧边栏] ' + VERSION + ' 已加载 —— 切换 AI / 模式在右上角油猴菜单里\n' +
            '  接了「询问 AI」的信道：' + CONFIG.askEvent + '\n' +
            '  上面那句里没有「接了「询问 AI」的信道」就是在跑旧版，重新贴一遍脚本'
        );
    }
})();
