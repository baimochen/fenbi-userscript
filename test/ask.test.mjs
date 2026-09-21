// 「询问 AI」这条链路的测试。
//
// 三个脚本、两种页面、三道跨不过去的墙：
//
//   fenbi 页面                          豆包页面
//   ┌──────────────────────┐            ┌──────────────┐
//   │ 布局脚本 → DOM 属性/事件 │            │  ai-autofill  │
//   │      ↓                │            │      ↑       │
//   │ 侧边栏   → postMessage ─┼── iframe ──┼──────┘       │
//   └──────────────────────┘            └──────────────┘
//
// 每一道墙两边都调不了对方的函数，只能靠名字对上：DOM 事件名、属性名、
// postMessage 的标记。名字对不上就是「点了没反应」，而且页面上一点线索
// 都没有 —— 所以这里最要紧的一组用例是「两边的名字一致」。
//
// 剩下的验分支：题目该往哪儿送（deliverTarget）、送不到的时候有没有退回
// 剪贴板、没人应答的时候按钮报什么。

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import {
    ROOT, boot, closeAll, ensureFixture, loadModule,
    LAYOUT_SCRIPT, USERSCRIPT
} from './harness.mjs';
import { fixturePath, fixtureExists, buildFixture } from './make-fixture.mjs';

const AUTOFILL_SCRIPT = join(ROOT, 'ai-autofill.user.js');

let layout;
let sidebar;
let autofill;

before(() => {
    ensureFixture();
    layout = loadModule(LAYOUT_SCRIPT);
    sidebar = loadModule(USERSCRIPT);
    autofill = loadModule(AUTOFILL_SCRIPT);
});

after(closeAll);


describe('两边靠名字对接，名字必须一致', () => {

    // 这一组是整套东西里最容易悄悄坏掉的地方：改了一边忘了另一边，
    // 表现是「点了没反应」，没有任何报错，页面上也没有线索。

    test('DOM 事件名一致', () => {

        assert.equal(
            layout.ASK_EVENT,
            sidebar.CONFIG.askEvent,
            '布局脚本发的和侧边栏听的不是同一个事件名'
        );
    });

    test('题目那条属性名一致', () => {

        assert.equal(
            layout.ASK_ATTR,
            sidebar.CONFIG.askAttr,
            '题目写在一边的属性上，另一边读的是别的属性'
        );
    });

    test('结果码那条属性名一致', () => {

        assert.equal(
            layout.ASK_RESULT_ATTR,
            sidebar.CONFIG.askResultAttr,
            '侧边栏写了结果，布局脚本读不到，按钮就只能瞎报'
        );
    });

    test('postMessage 的标记和豆包那份脚本一致', () => {

        assert.equal(
            sidebar.CONFIG.askTag,
            autofill.CONFIG.messageTag,
            '侧边栏发出去的标记，ai-autofill 认不出来'
        );
    });

    test('侧边栏认的「能自动填」的站点，就是真有配套脚本的那些', () => {

        // 现在只有豆包。加了新脚本要记得回侧边栏的 CONFIG 里加一笔，
        // 不然题目会走剪贴板 —— 能用，但不是用户以为的那条路。
        assert.deepEqual(sidebar.CONFIG.autofillServices, ['doubao']);
    });
});


describe('题目该往哪儿送', () => {

    const base = {
        url: 'https://www.doubao.com/chat/',
        service: 'doubao',
        mode: 'embed',
        hasFrame: true,
        hasWindow: false,
        autofillServices: ['doubao']
    };

    function target(patch) {
        return sidebar.deliverTarget({ ...base, ...patch });
    }

    test('嵌着豆包就送进 iframe', () => {
        assert.equal(target(), 'frame');
    });

    test('独立窗口模式送进那个窗口', () => {
        assert.equal(
            target({ mode: 'window', hasFrame: false, hasWindow: true }),
            'window'
        );
    });

    test('独立窗口还没开出来，退回剪贴板', () => {
        assert.equal(
            target({ mode: 'window', hasFrame: false, hasWindow: false }),
            'clipboard'
        );
    });

    test('嵌入模式但 iframe 还没建好，退回剪贴板', () => {
        assert.equal(target({ hasFrame: false }), 'clipboard');
    });

    test('当前选的不是豆包，退回剪贴板 —— 那边没人接', () => {

        assert.equal(target({ service: 'chatgpt' }), 'clipboard');
        assert.equal(target({ service: 'gemini' }), 'clipboard');
    });

    test('没地址就没什么可送的', () => {
        assert.equal(target({ url: '' }), 'clipboard');
    });

    test('缺参数不炸', () => {
        assert.equal(sidebar.deliverTarget(undefined), 'clipboard');
        assert.equal(sidebar.deliverTarget({}), 'clipboard');
    });
});


describe('侧边栏这一端', () => {

    // 从布局脚本那边发一次，看侧边栏接不接得住。

    function ask(booted, text) {
        const root = booted.win.document.documentElement;
        root.setAttribute(sidebar.CONFIG.askAttr, text);
        root.removeAttribute(sidebar.CONFIG.askResultAttr);
        booted.win.document.dispatchEvent(
            new booted.win.Event(sidebar.CONFIG.askEvent)
        );
        return root.getAttribute(sidebar.CONFIG.askResultAttr);
    }

    test('接住了，并且把结果码写回去 —— 布局脚本就靠这个报状态', () => {

        const booted = boot({ unframe: true });

        const result = ask(booted, '一道题');

        assert.ok(result, '侧边栏没应答，按钮只会显示「已复制」');
    });

    test('当前是 ChatGPT 时退回剪贴板，题目不丢', () => {

        const booted = boot({ unframe: true });

        // 默认服务就是 chatgpt，那边没配套脚本
        assert.equal(ask(booted, '一道题'), 'copied');
        assert.deepEqual(booted.copied, ['一道题']);
    });

    test('切到豆包、又有 iframe，就走 postMessage', () => {

        const booted = boot({ unframe: true });

        booted.clickMenu('AI：豆包');

        assert.ok(
            booted.root.querySelector('iframe'),
            '嵌入模式下该有 iframe'
        );

        assert.equal(ask(booted, '一道题'), 'sent');
    });

    test('发过去的内容和收件人都是对的', () => {

        const booted = boot({ unframe: true });

        booted.clickMenu('AI：豆包');

        ask(booted, '一道题');

        assert.equal(booted.posted.length, 1);

        // 形状必须和 ai-autofill.user.js 认的一致。
        //
        // 摊平一层再比：消息是脚本在 jsdom 那个 realm 里造的，原型不是这边
        // 的 Object.prototype，deepEqual（严格版）会因此判不相等。
        assert.deepEqual({ ...booted.posted[0].message }, {
            tag: sidebar.CONFIG.askTag,
            text: '一道题'
        });

        // 目标 origin 得写死成豆包，不能用 '*' —— 用 '*' 的话任何嵌进来的
        // 页面都能收到这条消息
        assert.equal(
            booted.posted[0].origin,
            'https://www.doubao.com'
        );
    });

    test('面板收起来的时候会自己弹回来 —— 不然填进去也看不见', () => {

        const booted = boot({ unframe: true });

        booted.clickMenu('隐藏面板');

        assert.equal(booted.root.querySelector('.wrap').style.display, 'none');

        ask(booted, '一道题');

        assert.notEqual(
            booted.root.querySelector('.wrap').style.display,
            'none',
            '题来了面板还藏着，用户会以为点了没反应'
        );
    });

    test('空题目不当回事', () => {

        const booted = boot({ unframe: true });

        assert.equal(ask(booted, ''), null);
    });
});


describe('布局脚本这一端', () => {

    // 这个面板在真实页面上才建得出来，但 askAi 只吃一个 app-ti 元素，
    // 拿夹具里的真题喂它就行。

    let doc;

    before(() => {
        if (!fixtureExists()) {
            assert.ok(buildFixture().ok);
        }
        doc = new JSDOM(readFileSync(fixturePath(), 'utf8')).window.document;
    });

    function firstTi() {
        return doc.querySelector('app-ti');
    }

    // askAi 用的是全局 document 和 Event，得临时指到 jsdom 那边去。
    //
    // Event 也得换：Node 自己有一个全局 Event，但它造的实例 jsdom 不认，
    // dispatchEvent 会抛「parameter 1 is not of type 'Event'」。浏览器里
    // 只有一个 Event，不存在这个问题。
    //
    // navigator 得走 defineProperty：Node 24 把它定义成只有 getter 的属性，
    // 直接赋值会抛「Cannot set property navigator」。
    function withDocument(run) {

        const view = doc.defaultView;

        const saved = ['document', 'navigator', 'Event'].map(name => [
            name,
            Object.getOwnPropertyDescriptor(globalThis, name)
        ]);

        const copied = [];


        globalThis.document = doc;
        globalThis.Event = view.Event;

        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: {
                clipboard: { writeText: text => copied.push(text) }
            }
        });


        try {
            return { value: run(), copied };
        } finally {

            for (const [name, descriptor] of saved) {

                if (descriptor) {
                    Object.defineProperty(globalThis, name, descriptor);
                } else {
                    delete globalThis[name];
                }
            }
        }
    }

    test('没人应答（侧边栏没装）时自己复制一份，这一下不白点', () => {

        const { value, copied } = withDocument(() => layout.askAi(firstTi()));

        assert.equal(value, '已复制 ✓');
        assert.equal(copied.length, 1);
        assert.match(copied[0], /【/);
    });

    test('有人应答就照结果码说话，不自己复制', () => {

        const { value, copied } = withDocument(() => {

            // 冒充侧边栏：接住事件，写个结果码回去
            doc.addEventListener(layout.ASK_EVENT, () => {
                doc.documentElement.setAttribute(
                    layout.ASK_RESULT_ATTR,
                    'sent'
                );
            }, { once: true });

            return layout.askAi(firstTi());
        });

        assert.equal(value, '已发送 ✓');
        assert.deepEqual(copied, [], '侧边栏已经送出去了，不该再动剪贴板');
    });

    test('用完之后信道上不留东西 —— 属性会一直挂在 documentElement 上', () => {

        const { value } = withDocument(() => layout.askAi(firstTi()));

        assert.ok(value);

        assert.equal(
            doc.documentElement.hasAttribute(layout.ASK_ATTR),
            false,
            '题目留在 DOM 上了'
        );

        assert.equal(
            doc.documentElement.hasAttribute(layout.ASK_RESULT_ATTR),
            false,
            '上一次的结果码没擦掉，下次没人应答时会读到旧的'
        );
    });

    test('结果码是白名单查表，侧面塞进来的值不会被当成文案显示', () => {

        const { value } = withDocument(() => {

            doc.addEventListener(layout.ASK_EVENT, () => {
                doc.documentElement.setAttribute(
                    layout.ASK_RESULT_ATTR,
                    '<img src=x onerror=alert(1)>'
                );
            }, { once: true });

            return layout.askAi(firstTi());
        });

        // 认不出来就当没人应答，走自己复制的路
        assert.equal(value, '已复制 ✓');
    });

    test('读不到题目的元素不炸', () => {

        const { value } = withDocument(
            () => layout.askAi(doc.createElement('div'))
        );

        assert.equal(value, '没读到题目');
    });
});
