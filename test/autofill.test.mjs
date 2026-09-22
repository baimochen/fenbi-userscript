// ai-autofill.user.js 的测试。
//
// 这个脚本跑在豆包页面里，是整条「询问 AI」链路的最后一环。它能测的部分
// 分三块：
//
//   1. 找输入框的挑选逻辑（pickComposer）—— 纯函数，喂进去假的尺寸就行。
//      真实的 getBoundingClientRect 在 jsdom 里恒等于 0，量不出东西，
//      所以测量和挑选是分开的，挑的那半在这儿测。
//   2. 两条传输通道的编解码（encodePayload / decodePayload）
//   3. 来源校验（originAllowed）—— 这条是安全边界，最不能回归
//
// 真正「在豆包页面上找不找得到输入框」只能人工验，见脚本里的 Ctrl+Alt+F。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { join } from 'node:path';
import { ROOT, loadModule } from './harness.mjs';

const SCRIPT = join(ROOT, 'ai-autofill.user.js');

const api = loadModule(SCRIPT);

// 造一个候选项，只需要 pickComposer 会看的几个字段
function candidate(width, height, top, extra) {
    return {
        node: { id: (extra && extra.id) || 'n' + Math.random() },
        width,
        height,
        top,
        hidden: false,
        ...extra
    };
}

const VIEWPORT = { viewportHeight: 800, searchFrom: 0.4 };   // 下 60% 才算


describe('挑输入框', () => {

    test('挑面积最大的那个', () => {

        const small = candidate(200, 30, 700, { id: 'small' });
        const big = candidate(600, 120, 700, { id: 'big' });

        assert.equal(
            api.pickComposer([small, big], VIEWPORT).id,
            'big'
        );
    });

    test('面积一样时挑更靠下的', () => {

        const upper = candidate(400, 60, 600, { id: 'upper' });
        const lower = candidate(400, 60, 740, { id: 'lower' });

        assert.equal(
            api.pickComposer([upper, lower], VIEWPORT).id,
            'lower'
        );
    });

    test('上半屏的不算 —— 那是对话记录，不是输入框', () => {

        // 对话区里有个巨大的富文本区域，比输入框大得多
        const transcript = candidate(900, 500, 60, { id: 'transcript' });

        assert.equal(
            api.pickComposer([transcript], VIEWPORT),
            null
        );
    });

    test('藏起来的不算 —— 编辑器常留个隐藏 textarea 兜底', () => {

        const hidden = candidate(900, 200, 700, { id: 'hidden', hidden: true });

        assert.equal(api.pickComposer([hidden], VIEWPORT), null);
    });

    test('太小的不算', () => {

        const tiny = candidate(40, 10, 700, { id: 'tiny' });

        assert.equal(api.pickComposer([tiny], VIEWPORT), null);
    });

    test('一个候选都没有就返回 null', () => {
        assert.equal(api.pickComposer([], VIEWPORT), null);
    });

    test('返回的是节点本身，不是候选对象', () => {

        const item = candidate(400, 60, 700, { id: 'composer' });
        const picked = api.pickComposer([item], VIEWPORT);

        assert.equal(picked, item.node);
    });
});


describe('地址通道的编解码', () => {

    test('往返之后还是原来那句', () => {

        const text = '下列说法正确的是：A. 甲  B. 乙\n（多选题）';

        assert.equal(
            api.decodePayload('#' + api.encodePayload(text)),
            text
        );
    });

    test('会被 URL 拆开的字符也活着', () => {

        // & 和 = 和 # 在地址里都有特殊含义，没编码就会被截断
        const text = 'a=1&b=2#c 100% 中文';

        assert.equal(
            api.decodePayload('#' + api.encodePayload(text)),
            text
        );
    });

    test('前面还有别的片段时也认得出', () => {

        assert.equal(
            api.decodePayload('#foo=1&fbai=' + encodeURIComponent('题目')),
            '题目'
        );
    });

    test('没有这一项就是空串', () => {

        assert.equal(api.decodePayload('#foo=1'), '');
        assert.equal(api.decodePayload(''), '');
        assert.equal(api.decodePayload(undefined), '');
    });

    test('编码坏掉不会把脚本搞崩', () => {

        // %E4 后面缺字节，decodeURIComponent 会抛
        assert.equal(api.decodePayload('#fbai=%E4%B8'), '');
    });
});


describe('来源校验', () => {

    const allowed = api.CONFIG.allowedOrigins;

    test('fenbi 的各个子域都放行', () => {

        for (const origin of [
            'https://spa.fenbi.com',
            'https://www.fenbi.com',
            'https://fenbi.com',
            'https://tiku.fenbi.com'
        ]) {
            assert.ok(api.originAllowed(origin, allowed), origin + ' 该放行');
        }
    });

    test('不是自己人的一律拦掉', () => {

        for (const origin of [
            'https://evil.com',
            'https://fenbi.com.evil.com',   // 后缀伪装
            'https://notfenbi.com',
            'http://localhost',
            '',
            null,
            'about:blank'
        ]) {
            assert.equal(
                api.originAllowed(origin, allowed),
                false,
                String(origin) + ' 该拦掉'
            );
        }
    });

    test('白名单里没有通配符 —— 加通配等于没校验', () => {

        for (const entry of allowed) {
            assert.doesNotMatch(entry, /\*/);
        }
    });
});


describe('默认配置', () => {

    test('默认自动发送 —— 但它必须和来源白名单一起看', () => {

        // 打开自动发送之后，任何能往豆包页面发消息的网页都能替你按下发送。
        // 拦住这件事的唯一东西就是上面那份 allowedOrigins，所以这两条是
        // 一个整体：这里改了，那边必须还是白名单、还是不带通配符。
        assert.equal(api.CONFIG.autoSend, true);
    });

    test('autoSend 真的有人读 —— 不能再是个没人理的开关', () => {

        // 这个开关原来是死的：CONFIG 里声明了、注释写得很像回事，但全文件
        // 没有一处读它。表现是「改了没反应」，而且看不出为什么 —— 因为
        // 配置项本身是真的，只是没人接。
        const source = readFileSync(SCRIPT, 'utf8');

        assert.ok(
            (source.match(/CONFIG\.autoSend/g) || []).length >= 1,
            'autoSend 声明了但没人读，改了不会有任何反应'
        );
    });

    test('发送前要等一拍 —— 填充和框架状态同步不同步', () => {

        // 填完立刻点，豆包的发送按钮还是灰的，点了没反应而且是静默的。
        assert.ok(api.CONFIG.sendDelay > 0);
    });

    test('两条通道用的是同一个标记', () => {

        assert.equal(typeof api.CONFIG.messageTag, 'string');
        assert.ok(api.CONFIG.messageTag.length > 0);
    });
});


describe('版本号', () => {

    // 版本号是用来判断「日志里这行是不是我正在跑的那版」的。它自己要是
    // 和头部对不上，那这个判断就废了 —— 而排查「装的是不是旧版」正是
    // 最需要它准的时候。这事儿刚发生过一次。
    test('脚本里的 VERSION 和头部 @version 一致', () => {

        const header = readFileSync(SCRIPT, 'utf8')
            .match(/\/\/\s*@version\s+(\S+)/);

        assert.ok(header, '头部没有 @version');

        assert.equal(
            api.VERSION,
            header[1],
            '改了 @version 忘了改 VERSION（或反过来），日志会报错版本'
        );
    });

    test('加载日志里带着版本号，能一眼看出装的是哪版', () => {

        const source = readFileSync(SCRIPT, 'utf8');

        assert.match(
            source,
            /'\[AI 自动填写\] '\s*\+\s*VERSION\s*\+\s*' 已加载/,
            '日志得引用 VERSION，不能写死一个数字'
        );
    });
});


describe('测试入口的提示', () => {

    // Mac 上 Alt 印的是 Option。日志里喊错键名，用户会以为脚本没生效，
    // 而不是「键名对不上」—— 这是白白浪费的一轮排查。
    //
    // 平台显式喂进去：靠读当前环境的话，同一个用例在 Mac 和 Windows 上
    // 结论不一样，等于没测。
    test('Mac 上说 Option', () => {

        assert.equal(api.hotkeyLabel('MacIntel'), 'Ctrl+Option+F');
    });

    test('别的平台说 Alt', () => {

        assert.equal(api.hotkeyLabel('Win32'), 'Ctrl+Alt+F');
        assert.equal(api.hotkeyLabel('Linux x86_64'), 'Ctrl+Alt+F');
    });

    test('认得出 Mac 家族的几个平台串', () => {

        for (const platform of ['MacIntel', 'Macintosh', 'iPhone', 'iPad']) {
            assert.ok(api.isMac(platform), platform + ' 该被认成 Mac');
        }

        assert.equal(api.isMac('Win32'), false);
    });

    test('键名是从 testHotkey 拼出来的，不是写死的一句话', () => {

        // 写死的话，改了 CONFIG 里的快捷键而日志还报老键名。
        // 去掉 Key 前缀这一步也在里面，所以结尾只该有一个 F。
        assert.ok(api.hotkeyLabel('Win32').endsWith('F'));
        assert.ok(api.hotkeyLabel('Win32').startsWith('Ctrl+'));
    });
});


describe('页面清理', () => {

    function dom(html) {
        return new JSDOM(html, { url: 'https://www.doubao.com/chat/' });
    }

    // 用户贴过来的那个按钮，砍到只剩结构
    const DOWNLOAD_BUTTON = `
        <button data-dbx-name="button">
            <svg viewBox="0 0 24 24"><path d="M16.2 5.4"></path></svg>
            <div class="min-w-0 truncate">下载电脑版</div>
        </button>
    `;

    test('文字对得上的按钮被藏起来', () => {

        const { window } = dom(`<div>${DOWNLOAD_BUTTON}</div>`);

        assert.equal(api.cleanUnwanted(window.document), 1);

        const button = window.document.querySelector('button');

        assert.equal(button.style.getPropertyValue('display'), 'none');
    });

    test('标签之间塞的空白不影响认领', () => {

        // 用户贴的是 DevTools 格式化过的版本，真实 DOM 里也是带换行缩进的
        const { window } = dom(`
            <button>
                <div>
                    下载电脑版
                </div>
            </button>
        `);

        assert.equal(api.cleanUnwanted(window.document), 1);
    });

    test('别的按钮一律不动', () => {

        const { window } = dom(`
            <button>发送</button>
            <button>新对话</button>
            <a href="/x">下载电脑版网页</a>
        `);

        // 最后那个是「包含」而不是相等，必须放过
        assert.equal(api.cleanUnwanted(window.document), 0);

        for (const node of window.document.querySelectorAll('button, a')) {
            assert.notEqual(
                node.style.getPropertyValue('display'),
                'none',
                node.textContent.trim() + ' 不该被藏'
            );
        }
    });

    test('a 和 role=button 也算数，不只是 button 标签', () => {

        const { window } = dom(`
            <a href="/download">下载电脑版</a>
            <div role="button" tabindex="0">下载电脑版</div>
        `);

        assert.equal(api.cleanUnwanted(window.document), 2);
    });

    test('藏过的不再写第二遍 —— 写了会产生 mutation，observer 正盯着子树', () => {

        const { window } = dom(DOWNLOAD_BUTTON);

        assert.equal(api.cleanUnwanted(window.document), 1);
        assert.equal(
            api.cleanUnwanted(window.document),
            0,
            '第二轮又写了一次样式，等于自己喂自己'
        );
    });

    test('重新渲染出来的新节点会被重新藏上', () => {

        // 豆包切换会话时 React 会把按钮换成新节点，旧的那个断开连接
        const { window } = dom(DOWNLOAD_BUTTON);

        const doc = window.document;

        api.cleanUnwanted(doc);

        doc.querySelector('button').remove();

        doc.body.insertAdjacentHTML('beforeend', DOWNLOAD_BUTTON);

        assert.equal(
            api.cleanUnwanted(doc),
            1,
            '换了一茬之后没重新藏，按钮会重新露出来'
        );
    });

    test('要藏哪些是可配的，不是写死一句', () => {

        assert.ok(Array.isArray(api.CONFIG.hideTexts));
        assert.ok(api.CONFIG.hideTexts.length > 0);
    });
});


describe('往输入框里填', () => {

    function dom(html) {
        return new JSDOM(html, { url: 'https://www.doubao.com/chat/' });
    }

    test('textarea 的值被设进去，并且发出了 input 事件', () => {

        const { window } = dom('<textarea id="t"></textarea>');

        const node = window.document.getElementById('t');

        const seen = [];

        node.addEventListener('input', event => seen.push(event.type));
        node.addEventListener('change', event => seen.push(event.type));

        api.fill(node, '题目内容');

        assert.equal(node.value, '题目内容');

        // React 只认事件，不认 node.value 被直接改
        assert.deepEqual(seen, ['input', 'change']);
    });

    test('走的是原型上的 setter —— 这正是 React 能看见的原因', () => {

        const { window } = dom('<textarea id="t"></textarea>');

        const node = window.document.getElementById('t');

        // 在实例上盖一个同名属性，模拟「框架自己拦截了赋值」
        let instanceSet = 0;

        Object.defineProperty(node, 'value', {
            configurable: true,
            get: () => '',
            set: () => { instanceSet += 1; }
        });

        api.fill(node, '题目内容');

        assert.equal(instanceSet, 0,
            '走了实例上的 setter 就说明绕不过框架的拦截');
    });

    test('contenteditable 在没有 execCommand 的环境里也能填进去', () => {

        // jsdom 没实现 execCommand，等于替我们验了那条兜底分支
        const { window } = dom('<div id="e" contenteditable="true"></div>');

        const node = window.document.getElementById('e');

        api.fill(node, '题目内容');

        assert.equal(node.textContent, '题目内容');
    });
});


describe('发送', () => {

    // 发送按钮是按位置认的（class 是 Tailwind 加哈希，认不住），所以这一组
    // 测的就是那套几何启发式：谁该被选中、谁绝对不能被选中。
    //
    // 「绝对不能被选中」那几条比「选中对的」更要紧 —— 选不中顶多发不出去，
    // 选错了就是在别人的页面上乱点按钮。

    function dom(html) {
        return new JSDOM(html, { url: 'https://www.doubao.com/chat/' });
    }

    // jsdom 不做排版，getBoundingClientRect 恒等于 0，所有按钮都会因为
    // 「没尺寸」被滤掉。所以矩形得一个个塞进去。
    function place(node, left, top, width, height) {

        node.getBoundingClientRect = () => ({
            left: left,
            top: top,
            width: width,
            height: height,
            right: left + width,
            bottom: top + height,
            x: left,
            y: top
        });

        return node;
    }

    // 一个像模像样的输入区：输入框在左，右下角是发送，左边一排功能按钮。
    //
    // 输入框 (10,600) 600x60 —— 右下角 (610,660)，横向中点 310。
    const COMPOSER = `
        <div id="bar">
            <div id="editor" contenteditable="true"></div>
            <button id="think">深度思考</button>
            <button id="send">发送</button>
        </div>
    `;

    function scene() {

        const { window } = dom(COMPOSER);

        const doc = window.document;

        const editor = place(doc.getElementById('editor'), 10, 600, 600, 60);

        const think = place(doc.getElementById('think'), 20, 610, 60, 24);

        const send = place(doc.getElementById('send'), 570, 620, 40, 40);

        return { window: window, doc: doc, editor: editor, think: think, send: send };
    }

    test('挑离输入框右下角最近的那个', () => {

        const { editor, send } = scene();

        assert.equal(api.findSendButton(editor), send);
    });

    test('输入框左边的功能按钮不碰 —— 点了会改设置，不是发送', () => {

        const { editor, think, send } = scene();

        assert.notEqual(api.findSendButton(editor), think);

        // 把发送按钮摘掉之后，左边那排不该被顶上来
        send.remove();

        assert.equal(
            api.findSendButton(editor),
            null,
            '左边那一排被当成发送按钮了'
        );
    });

    test('输入框上方的按钮不碰 —— 那是对话记录那一带的', () => {

        const { doc, editor } = scene();

        const above = place(doc.createElement('button'), 570, 400, 40, 40);

        above.textContent = '复制';

        doc.getElementById('bar').appendChild(above);

        // 它离右下角比真的发送按钮还近，只有「必须在输入框顶边以下」
        // 这一条能把它挡掉
        doc.getElementById('send').remove();

        assert.equal(api.findSendButton(editor), null);
    });

    test('灰掉的不点', () => {

        const { editor, send } = scene();

        send.disabled = true;

        assert.equal(api.findSendButton(editor), null);
    });

    test('aria-disabled 也认', () => {

        const { editor, send } = scene();

        send.setAttribute('aria-disabled', 'true');

        assert.equal(api.findSendButton(editor), null);
    });

    test('离得太远的不点 —— 宁可发不出去，也不能在别人页面上乱点', () => {

        const { editor, send } = scene();

        place(send, 1400, 1600, 40, 40);   // 挪到屏幕另一头去

        assert.equal(api.findSendButton(editor), null);
    });

    test('找不到按钮就退回模拟回车', () => {

        const { editor, send } = scene();

        // 这一条验的是退路，所以得先把发送按钮拿掉
        send.remove();

        const seen = [];

        editor.addEventListener('keydown', event => seen.push(event.key));

        const result = api.send(editor);

        assert.equal(result.how, 'enter');
        assert.deepEqual(seen, ['Enter']);
    });

    test('找得到按钮就点它，不再补一发回车', () => {

        const { editor, send } = scene();

        let clicked = 0;
        let keys = 0;

        send.addEventListener('click', () => { clicked += 1; });
        editor.addEventListener('keydown', () => { keys += 1; });

        const result = api.send(editor);

        assert.equal(result.how, 'button');
        assert.equal(clicked, 1);
        assert.equal(keys, 0, '又点按钮又发回车，会发出去两条');
    });

    test('编辑器空了才算发出去', () => {

        const { editor } = scene();

        editor.textContent = '题目内容';
        assert.equal(api.stillHasText(editor), true);

        editor.textContent = '';
        assert.equal(api.stillHasText(editor), false);
    });

    test('开着自动发送时，填完会自己发出去', async () => {

        const { window, doc, editor, send } = scene();

        // findComposer 靠 innerHeight 判断「是不是在下半屏」，jsdom 里恒为 0
        Object.defineProperty(window, 'innerHeight', {
            configurable: true,
            value: 800
        });

        let clicked = 0;

        send.addEventListener('click', () => {
            clicked += 1;
            editor.textContent = '';   // 真发出去之后编辑器会清空
        });

        const savedDocument =
            Object.getOwnPropertyDescriptor(globalThis, 'document');

        const savedDelay = api.CONFIG.sendDelay;
        const savedVerify = api.CONFIG.sendVerifyDelay;

        globalThis.document = doc;
        api.CONFIG.sendDelay = 0;
        api.CONFIG.sendVerifyDelay = 0;

        try {

            api.fillWhenReady('题目内容', Date.now() + 1000);

            /*
             * 等整条链子走完，而不是等一个「差不多够了」的毫秒数。
             *
             * 这条链子是：填入 → 隔 sendDelay 点发送 → 再隔 sendVerifyDelay
             * 回来验一眼编辑器空没空。验完那一下会弹一条提示，弹提示要摸
             * document。
             *
             * 原来这儿等的是 30ms。定时器一多，Node 会把同一批到期的攒在
             * 一起跑，那条「回来验一眼」就可能排在 30ms 那条**后面** ——
             * 于是这条用例先醒了，下面 finally 把 globalThis.document 摘掉，
             * 它才醒过来一摸 document，就是一句 ReferenceError，而且是在
             * 用例已经结束之后才炸的，只看结果根本看不出是谁干的。
             *
             * 终点是验完那一眼弹的那条提示。不能等「提示条出现了」——
             * 填入那一步是同步的，一进去就已经弹了「正在发送…」，等于没等。
             */
            const terminal = ['题目已发送', '没发出去，题目还在输入框里'];

            const said = () => {
                const node = doc.getElementById('fbai-autofill-toast');
                return node && terminal.includes(node.textContent);
            };

            const deadline = Date.now() + 3000;

            while (!said() && Date.now() < deadline) {
                await new Promise(resolve => setTimeout(resolve, 5));
            }

            assert.ok(
                said(),
                '三秒过去这条链子还没走到头 —— 卡在填入到发送中间了'
            );

        } finally {

            api.CONFIG.sendDelay = savedDelay;
            api.CONFIG.sendVerifyDelay = savedVerify;

            if (savedDocument) {
                Object.defineProperty(globalThis, 'document', savedDocument);
            } else {
                delete globalThis.document;
            }
        }

        assert.equal(clicked, 1, '填完了没有自动发出去');
    });
});
