// 手柄开关 AI 面板这条路。
//
// 原来走的是事件信道（手柄发 fbai-toggle、侧边栏听完把结果写回
// documentElement 上的属性）。那条路能用，但它是全部动作里唯一一个
// 「不是点 DOM」的：别的不灵了看一眼页面就知道哪不对，这个不灵了得
// 同时怀疑两份脚本，还得先想清楚是谁没应答。
//
// 现在跟别的动作一模一样 —— 找按钮、点它：
//
//   面板展开时点 CONFIG.toggleOpenClass（头部那个收起键）
//   面板收起后点 CONFIG.toggleClosedClass（边上常显的小标）
//
// 该点哪个由宿主元素上的 CONFIG.hiddenAttr 说 —— 两个按钮在 DOM 里
// 是同时存在的，收起的那个只是被 display:none 的容器罩着。
//
// 这条路必须**关得掉**，那是用户报的 bug：「ai 窗口关闭功能用不了」。
// 根因不在信道，在侧边栏那边：独立窗口模式下面板只是个空壳，AI 在一个
// **真正的浏览器窗口**里。收起面板原来只把页面上那块 wrap 藏起来，用户
// 正盯着的那扇窗纹丝不动 —— 看起来就是「按了没反应」。
//
// 所以这里盯两件事：手柄真能按开关，收起真能连那扇窗一起关掉。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, closeAll, loadModule, USERSCRIPT, ROOT } from './harness.mjs';
import { join } from 'node:path';

const GAMEPAD_SCRIPT = join(ROOT, 'fenbi-gamepad.user.js');

const gamepad = loadModule(GAMEPAD_SCRIPT);
const sidebar = loadModule(USERSCRIPT);

// 短按 Start。默认映射里 toggleAi 就挂在这个键上。
const START = 9;

/*
 * 往已经跑着侧边栏的窗口里再塞一个假手柄和手柄脚本。
 *
 * 两份脚本共用同一个假 GM 存储 —— 真油猴里它们是各存各的，但两边的
 * 键名（fbai.* 和 fenbi-gamepad-*）不撞，放一起不影响任何断言。
 */
function installGamepad(win) {

    let queue = [];
    let now = 0;

    const slots = [null];

    const makePad = pressed => ({
        id: 'Pad',
        mapping: 'standard',
        connected: true,
        index: 0,
        buttons: Array.from({ length: 17 }, (_, i) => ({
            pressed: Boolean(pressed[i]),
            value: pressed[i] ? 1 : 0
        })),
        axes: [0, 0, 0, 0]
    });

    slots[0] = makePad({});

    Object.defineProperty(win.navigator, 'getGamepads', {
        configurable: true,
        value: () => slots.slice()
    });

    win.requestAnimationFrame = callback => queue.push(callback);
    win.cancelAnimationFrame = () => {};

    /*
     * jsdom 里 document.hidden 一直是 true（除非 pretendToBeVisual），
     * 而手柄脚本的 tick 一看页面在后台就整帧跳过 —— 不掰过来，按多少
     * 下都跟没插手柄一样，而那是夹具的问题，不是脚本的。
     */
    Object.defineProperty(win.document, 'hidden', {
        configurable: true,
        value: false
    });

    Object.defineProperty(win.performance, 'now', {
        configurable: true,
        value: () => now
    });

    win.Date.now = () => now;

    win.eval(readFileSync(GAMEPAD_SCRIPT, 'utf8'));

    win.document.dispatchEvent(new win.Event('gamepadconnected'));

    function step(ms = 16) {

        now += ms;

        const due = queue;

        queue = [];

        for (const callback of due) {
            callback(now);
        }
    }

    return {
        // 按一下再松开。手柄的状态机要的是一整个来回。
        tap(button) {

            slots[0] = makePad({ [button]: true });
            step();

            slots[0] = makePad({});
            step();
        },
        hold(button, ms) {

            slots[0] = makePad({ [button]: true });
            step();

            for (let elapsed = 0; elapsed < ms; elapsed += 16) {
                step();
            }

            slots[0] = makePad({});
            step();
        }
    };
}

// 侧边栏 + 手柄，装在同一个窗口里 —— 这就是用户机器上的样子
function bootBoth(options) {

    const booted = boot(options);

    booted.pad = installGamepad(booted.win);

    return booted;
}

const wrapOf = booted => booted.root.querySelector('.wrap');

// 布局脚本送题：题目写在属性上，再 dispatch 一个事件（手柄不参与）
//
// 得先切到豆包 —— 只有它在 CONFIG.autofillServices 里，别家发了没人听，
// 脚本会老实退回剪贴板，那样就测不到「发进窗口」这条路了。
function askQuestion(booted, text) {

    const root = booted.win.document.documentElement;

    root.setAttribute('data-fbai-ask', text);

    booted.win.document.dispatchEvent(new booted.win.Event('fbai-ask'));

    return root.getAttribute('data-fbai-ask-result');
}

function useDoubao(booted) {
    booted.clickMenu('AI：豆包');
}


describe('两份脚本对暗号的四个名字', () => {

    test('宿主 id', () => {
        assert.equal(gamepad.AI_HOST_ID, sidebar.CONFIG.panelId);
    });

    test('状态属性 —— 手柄靠它决定点哪个按钮', () => {
        assert.equal(gamepad.AI_HIDDEN_ATTR, sidebar.CONFIG.hiddenAttr);
    });

    test('展开时点的那个类名', () => {
        assert.equal(gamepad.AI_OPEN_CLASS, sidebar.CONFIG.toggleOpenClass);
    });

    test('收起后点的那个类名', () => {
        assert.equal(gamepad.AI_CLOSED_CLASS, sidebar.CONFIG.toggleClosedClass);
    });

    test('侧边栏真的把这两个类名挂在了按钮上', () => {

        const { root } = boot();

        assert.ok(
            root.querySelector('.' + sidebar.CONFIG.toggleOpenClass),
            '收起键上没有契约类名，手柄按名字找不到它'
        );
    });
});


describe('手柄开关 AI 面板', () => {

    test('短按 Start → 收起，状态写到宿主上', () => {

        const booted = bootBoth();

        booted.pad.tap(START);

        assert.equal(wrapOf(booted).style.display, 'none');

        assert.equal(booted.prefs['fbai.hidden'], true);

        assert.equal(
            booted.win.document.getElementById(gamepad.AI_HOST_ID)
                .getAttribute(gamepad.AI_HIDDEN_ATTR),
            '1',
            '收起后没更新宿主上的状态，手柄下一次还会去点收起键'
        );
    });

    test('再短按一次 → 展开', () => {

        const booted = bootBoth();

        booted.pad.tap(START);
        booted.pad.tap(START);

        assert.notEqual(wrapOf(booted).style.display, 'none');

        assert.equal(booted.prefs['fbai.hidden'], false);
    });

    test('收起后手柄点的是那个小标，不是藏起来的收起键', () => {

        const booted = bootBoth();

        booted.pad.tap(START);

        const tab = booted.root.querySelector(
            '.' + sidebar.CONFIG.toggleClosedClass
        );

        assert.ok(tab, '收起后边上得留个小标，不然关掉了就找不回来');

        // 藏起来的那个还挂在文档里 —— 手柄要是「找到一个就点」，
        // 点的就是它，而它在一个 display:none 的容器里，点下去
        // 什么都不会发生。
        assert.ok(
            booted.root.querySelector('.' + sidebar.CONFIG.toggleOpenClass),
            '收起键应该还在，只是被藏起来了（这条是上面那句的前提）'
        );
    });

    test('点小标能把面板叫回来，而且小标自己收掉', () => {

        const booted = bootBoth();

        booted.pad.tap(START);

        booted.root.querySelector('.' + sidebar.CONFIG.toggleClosedClass)
            .dispatchEvent(new booted.win.MouseEvent('click', { bubbles: true }));

        assert.notEqual(wrapOf(booted).style.display, 'none');

        assert.equal(
            booted.root.querySelector('.' + sidebar.CONFIG.toggleClosedClass),
            null,
            '面板都展开了，小标还留在页面上'
        );
    });

    test('没装侧边栏 → 静静地什么都不做', () => {

        // 只跑手柄脚本，页面上没有 fbai-panel
        const booted = boot();

        const pad = installGamepad(booted.win);

        assert.doesNotThrow(() => pad.tap(START));
    });

    test('收起之后 wrap 真的不显示了', () => {

        const booted = bootBoth();

        booted.pad.tap(START);

        assert.equal(wrapOf(booted).style.display, 'none');
    });
});


describe('收起面板要连独立窗口一起关', () => {

    test('窗口模式下，手柄收起把那扇窗关掉', () => {

        const booted = bootBoth();

        booted.clickMenu('打开');

        assert.equal(booted.windows.length, 1);
        assert.equal(booted.windows[0].closed, false, '刚开的时候是开着的');

        booted.pad.tap(START);

        assert.equal(
            booted.windows[0].closed,
            true,
            '收起面板了，那扇窗还开着 —— 用户看到的就是「关了没反应」'
        );
    });

    test('菜单里的「显示 / 隐藏面板」走同一条路，也关', () => {

        const booted = bootBoth();

        booted.clickMenu('打开');
        booted.clickMenu('显示 / 隐藏面板');

        assert.equal(booted.windows[0].closed, true);
    });

    test('展开不关窗 —— 只有收起才关', () => {

        const booted = bootBoth();

        booted.clickMenu('打开');

        // 先收起来（窗口关掉），再展开
        booted.pad.tap(START);
        booted.pad.tap(START);

        assert.equal(booted.windows.length, 1, '展开不该自己再开一扇');
    });

    test('窗口还开着的时候，送题是发进那扇窗的', () => {

        const booted = bootBoth();

        useDoubao(booted);
        booted.clickMenu('打开');

        assert.equal(askQuestion(booted, '题干'), 'sent');
        assert.equal(booted.posted.length, 1);
        assert.equal(booted.posted[0].via, 'window');
    });

    test('窗口关掉之后再送题 → 退回剪贴板，不往死窗口里发', () => {

        const booted = bootBoth();

        useDoubao(booted);
        booted.clickMenu('打开');
        booted.pad.tap(START);

        const asked = askQuestion(booted, '题干');

        assert.equal(
            booted.posted.length,
            0,
            '窗口已经关了，不该再往它 postMessage'
        );

        // 只断言「没发出去」是不够的：事件名写错、监听没挂上，同样一条
        // 都发不出去。所以要正面确认它走了兜底那条路。
        assert.deepEqual(booted.copied, ['题干']);
        assert.equal(asked, 'copied');
    });

    test('关的是我们自己开的那扇 —— 没开过就什么都不关', () => {

        const booted = bootBoth();

        booted.pad.tap(START);

        assert.equal(booted.windows.length, 0);
    });
});


describe('窗口把手', () => {

    test('每开一次是一个独立把手，互不串台', () => {

        const booted = bootBoth();

        booted.clickMenu('打开');
        booted.clickMenu('打开');

        assert.equal(booted.windows.length, 2);
        assert.notEqual(booted.windows[0], booted.windows[1]);

        booted.pad.tap(START);

        // 收起时 state.window 存的是最近那扇，关的也应该是它
        assert.equal(booted.windows[1].closed, true);
        assert.equal(booted.windows[0].closed, false);
    });
});


// 每个用例都开一个新的 dom，不关的话定时器吊着事件循环
process.on('beforeExit', closeAll);
