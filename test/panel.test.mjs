// 面板本身的测试：在 jsdom 里真的把 init() 跑起来，然后点它。
//
// 两个重点：
//
// 1. 面板上「什么都没有」是新规格的一部分。设置搬进了油猴菜单，所以这里要
//    盯着页面上别再冒出下拉框、模式按钮、「问这道题」—— 这类东西是慢慢长
//    回来的，得靠测试按着。
//
// 2. 「和答题卡统一」不是一句形容词：顶部偏移要和布局脚本的 cardTop 相等，
//    圆角/边框/阴影要和那边 .fbac-panel 的值逐条相等。所以这里的断言是去
//    布局脚本里读真值来比，不是抄一遍数字 —— 抄的话两边一起改错，测试还
//    是绿的。布局脚本哪天挪了答题卡，这边会红，这正是想要的。

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, closeAll, ensureFixture, loadModule, LAYOUT_SCRIPT, USERSCRIPT } from './harness.mjs';

let api;         // 侧边栏脚本导出的纯函数与常量
let layoutApi;   // 布局脚本导出的，用来读答题卡的真值

before(() => {
    ensureFixture();
    api = loadModule(USERSCRIPT);
    layoutApi = loadModule(LAYOUT_SCRIPT);
});

after(closeAll);

// 把一段 CSS 声明压成可比较的形式：小写、空白归一、`.07` → `0.07`、
// 逗号后补空格。两边的模板字符串缩进不一样，不归一没法比。
function normalizeCss(text) {
    return text
        .replace(/!important/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*,\s*/g, ', ')
        .replace(/(^|[\s,(])\.(\d)/g, '$10.$2')
        .trim()
        .toLowerCase();
}

// 从布局脚本里抠出答题卡面板那一段 CSS 声明
function cardPanelDeclarations() {

    const source = readFileSync(LAYOUT_SCRIPT, 'utf8');

    const block = source.match(
        /#fenbi-custom-answer-card\s*\.fbac-panel\s*\{([\s\S]*?)\}/
    );

    assert.ok(block, '布局脚本里找不到 #fenbi-custom-answer-card .fbac-panel');

    return normalizeCss(block[1]);
}

function sidebarCss() {
    return normalizeCss(
        readFileSync(USERSCRIPT, 'utf8')
            .match(/const CSS = `([\s\S]*?)`;/)[1]
    );
}

describe('和答题卡统一', () => {

    test('上边缘和答题卡齐平 —— 粉笔吸顶头部遮不住才算数', () => {

        assert.equal(
            api.CONFIG.panelTop,
            layoutApi.CONFIG.cardTop,
            '面板顶部偏移和答题卡的 cardTop 不一致，会被粉笔头部压住'
        );

        assert.ok(
            api.CONFIG.panelTop > 0,
            'panelTop 是 0 的话面板就顶到屏幕最上面了，正是被遮挡的位置'
        );
    });

    test('圆角、边框、阴影、底色逐条照抄答题卡', () => {

        const card = cardPanelDeclarations();
        const mine = sidebarCss();

        for (const property of [
            'border-radius',
            'border',
            'box-shadow',
            'background'
        ]) {

            const declaration = card
                .split(';')
                .map(part => part.trim())
                .find(part => part.startsWith(property + ':'));

            assert.ok(declaration, '答题卡里没有 ' + property + '？');

            assert.ok(
                mine.includes(declaration),
                '面板的 ' + property + ' 和答题卡不一致，答题卡是「' +
                    declaration + '」'
            );
        }
    });

    test('头部条的高度和答题卡一样', () => {

        const source = readFileSync(LAYOUT_SCRIPT, 'utf8');

        const header = source.match(
            /#fenbi-custom-answer-card\s*\.fbac-header\s*\{([\s\S]*?)\}/
        );

        assert.ok(header, '布局脚本里找不到 .fbac-header');

        const height = normalizeCss(header[1])
            .split(';')
            .map(part => part.trim())
            .find(part => part.startsWith('height:'));

        assert.ok(
            sidebarCss().includes(height),
            '头部条高度和答题卡不一致，答题卡是「' + height + '」'
        );
    });
});

describe('页面上不留任何设置入口', () => {

    test('没有 AI 下拉框', () => {
        assert.equal(boot().root.querySelector('select'), null);
    });

    test('没有「嵌入 / 窗口」按钮', () => {
        const root = boot().root;

        for (const text of ['嵌入', '窗口']) {
            const button = [...root.querySelectorAll('button')]
                .find(node => node.textContent.trim() === text);

            assert.equal(button, undefined, '页面上还有「' + text + '」按钮');
        }
    });

    test('没有「问这道题」按钮', () => {
        const root = boot().root;

        const button = [...root.querySelectorAll('button')]
            .find(node => node.textContent.includes('问这道题'));

        assert.equal(button, undefined);
    });

    test('没有任何提示、占位、白框说明文字', () => {

        const text = boot().root.textContent;

        assert.doesNotMatch(text, /这里是空白/);
        assert.doesNotMatch(text, /X-Frame-Options/);
        assert.doesNotMatch(text, /装配套的去头扩展/);
        assert.doesNotMatch(text, /独立窗口/);
    });

    test('面板里除了头部条就只剩 iframe', () => {

        const root = boot({ unframe: true }).root;

        const controls = [...root.querySelectorAll('button, input, select')];

        assert.deepEqual(
            controls.map(node => node.className),
            ['collapse'],
            '面板里除了收起按钮不该有别的控件'
        );
    });
});

describe('头部条', () => {

    test('标题是「AI 助手」，带图标', () => {

        const root = boot().root;

        assert.match(root.querySelector('.panel-title').textContent, /AI 助手/);
        assert.ok(root.querySelector('.panel-icon'));
    });

    test('收起按钮把面板收掉', () => {

        const { root, click } = boot();

        click('.collapse');

        assert.equal(
            root.querySelector('.wrap').style.display,
            'none',
            '收起后页面上一根线都不该留'
        );
    });

    test('收起后能用快捷键叫回来', () => {

        const { root, click, press } = boot();

        click('.collapse');
        press('KeyQ', { altKey: true });

        assert.notEqual(root.querySelector('.wrap').style.display, 'none');
    });
});

describe('嵌入与窗口', () => {

    test('没装去头扩展：不渲染 iframe，免得给用户一块白', () => {

        const { root } = boot();

        assert.equal(root.querySelector('iframe'), null);
    });

    test('装了去头扩展：默认嵌入，iframe 指向当前服务', () => {

        const { root } = boot({ unframe: true });

        const frame = root.querySelector('iframe');

        assert.ok(frame, '装了扩展就该渲染 iframe');
        assert.equal(frame.getAttribute('src'), api.SERVICES.chatgpt.url);
    });

    test('换了 AI，iframe 跟着换', () => {

        const booted = boot({ unframe: true });

        booted.clickMenu('Gemini');

        assert.equal(
            booted.root.querySelector('iframe').getAttribute('src'),
            api.SERVICES.gemini.url
        );
    });

    test('切到窗口模式：iframe 收掉', () => {

        const booted = boot({ unframe: true });

        assert.ok(booted.root.querySelector('iframe'));

        booted.clickMenu('独立窗口');

        assert.equal(booted.root.querySelector('iframe'), null);
    });
});

describe('快捷键', () => {

    test('Alt+Q 隐藏，再按一次回来', () => {

        const { root, press } = boot();

        press('KeyQ', { altKey: true });
        assert.equal(root.querySelector('.wrap').style.display, 'none');

        press('KeyQ', { altKey: true });
        assert.notEqual(root.querySelector('.wrap').style.display, 'none');
    });

    test('光按 Q 不动面板', () => {

        const { root, press } = boot();

        press('KeyQ', {});

        assert.notEqual(root.querySelector('.wrap').style.display, 'none');
    });
});

describe('启动日志', () => {

    test('控制台留一行 —— 用户判断「装没装上」的唯一凭据', () => {

        const { logged } = boot();

        assert.ok(
            logged.some(text => /侧边栏/.test(text)),
            '加载时什么都没打印，用户没法确认脚本装上了'
        );
    });

    // 下面这两条是为一次真实的排查加的：加了「询问 AI」一整条链路却没动
    // 版本号，日志还是「2.0 已加载」。于是「点了没反应」到底是旧版没这个
    // 功能、还是新版坏了，从页面上完全看不出来 —— 用户重贴没重贴也看不出
    // 来，只能靠推理，白绕一轮。
    //
    // 版本号就是用来回答「我装的是哪版」的，它自己不可信，那这行日志就
    // 只剩「装上了」这一个信息量。

    test('脚本里的 VERSION 和头部 @version 一致', () => {

        const header = readFileSync(USERSCRIPT, 'utf8')
            .match(/\/\/\s*@version\s+(\S+)/);

        assert.ok(header, '头部没有 @version');

        assert.equal(
            api.VERSION,
            header[1],
            '改了 @version 忘了改 VERSION（或反过来），日志会报错版本'
        );
    });

    test('日志里带着版本号，不是写死的一个数字', () => {

        const source = readFileSync(USERSCRIPT, 'utf8');

        assert.match(
            source,
            /'\[粉笔 AI 侧边栏\] '\s*\+\s*VERSION\s*\+\s*' 已加载/,
            '日志得引用 VERSION，写死的话升级之后日志还报老版本号'
        );
    });

    test('日志里报出「询问 AI」的信道名 —— 新旧两版的日志必须能分开', () => {

        const { logged } = boot();

        // 旧版打的是「2.0 已加载 —— 切换 AI / 模式在…」，新版多这一行。
        // 没有它，装了旧版和装了新版在控制台里长得一模一样。
        assert.ok(
            logged.some(text => /询问 AI/.test(text)),
            '日志里看不出这版有没有「询问 AI」，排查时又得靠猜'
        );
    });
});


// 布局脚本的版本号。
//
// 和上面侧边栏那两条是一回事，只是补得晚 —— 侧边栏出事的时候才发现这份
// 脚本也没人盯着，2.4 之前一直是「功能加了、版本号没动、日志看不出来」。
// 两份脚本装在同一个人机器上，凭据得一样硬，所以断言也照着抄一份。
//
// 放在这个文件里而不是各测各的：找「版本号靠不靠得住」的时候应该只翻一处。

describe('布局脚本的版本号', () => {

    test('脚本里的 VERSION 和头部 @version 一致', () => {

        const header = readFileSync(LAYOUT_SCRIPT, 'utf8')
            .match(/\/\/\s*@version\s+(\S+)/);

        assert.ok(header, '头部没有 @version');

        assert.equal(
            layoutApi.VERSION,
            header[1],
            '改了 @version 忘了改 VERSION（或反过来），日志会报错版本'
        );
    });

    test('日志引用 VERSION，不是写死的一个数字', () => {

        assert.match(
            readFileSync(LAYOUT_SCRIPT, 'utf8'),
            /'\[粉笔布局优化\] '\s*\+\s*VERSION\s*\+\s*' 已加载/,
            '日志得引用 VERSION，写死的话升级之后日志还报老版本号'
        );
    });
});
