// 三个宽度变量的测试：AI 助手 / 答题区 / 答题卡，各在自己的脚本顶部。
//
// 这几个数本身没什么好测的 —— 测的是一件事：改一个数会不会牵扯到别的地方。
// 三处宽度散在两个脚本里，靠人记着同步是靠不住的。
//
// 特别是答题卡：它钉在右上角，占掉的地方是从答题区里扣的。原来那个
// rightReserve 是手写死的 250，改成从 cardWidth 算出来之后，「改 cardWidth
// 忘了改预留」这个坑就不存在了 —— 下面第一条盯着它。

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModule, LAYOUT_SCRIPT, USERSCRIPT } from './harness.mjs';

let layout;
let sidebar;
let layoutSource;
let sidebarSource;

before(() => {
    layout = loadModule(LAYOUT_SCRIPT);
    sidebar = loadModule(USERSCRIPT);
    layoutSource = readFileSync(LAYOUT_SCRIPT, 'utf8');
    sidebarSource = readFileSync(USERSCRIPT, 'utf8');
});


describe('答题区宽度', () => {

    test('是脚本顶部的一个数，改它就行', () => {

        assert.equal(typeof layout.CONFIG.questionMaxWidth, 'number');
        assert.ok(layout.CONFIG.questionMaxWidth > 0);
    });

    test('注进页面的 CSS 用的是这个数，没有另抄一份', () => {

        // 抄一份的话，改了 CONFIG 而 CSS 里还是老数字，页面上纹丝不动 ——
        // 而且一点报错都没有，最难查的那种。
        assert.match(
            layoutSource,
            /max-width:\s*\$\{CONFIG\.questionMaxWidth\}px/,
            'CSS 里的 max-width 必须直接引用 CONFIG.questionMaxWidth'
        );
    });

    test('低频兜底那处也是引用的，不是写死的', () => {

        const fallback = layoutSource.match(
            /function optimizeQuestionWidth\(\)[\s\S]*?\n    \}/
        );

        assert.ok(fallback, '找不到 optimizeQuestionWidth');

        assert.match(
            fallback[0],
            /\$\{CONFIG\.questionMaxWidth\}/,
            '几何兜底里的宽度也得引用 CONFIG'
        );

        assert.doesNotMatch(
            fallback[0],
            /max-width['"],\s*['"]\d+/,
            '兜底里出现了写死的 max-width'
        );
    });
});


describe('答题卡宽度', () => {

    test('留出来的空间是从 cardWidth 算的，不是手写死的', () => {

        assert.equal(
            layout.RIGHT_RESERVE,
            layout.CONFIG.cardRight
                + layout.CONFIG.cardWidth
                + layout.CONFIG.cardGap,
            'RIGHT_RESERVE 应该是算出来的 —— 手写死的话改 cardWidth 会压到题目'
        );
    });

    test('留的空间装得下整张答题卡', () => {

        assert.ok(
            layout.RIGHT_RESERVE
                >= layout.CONFIG.cardRight + layout.CONFIG.cardWidth,
            '预留比「右边距 + 卡宽」还小，答题卡左边会盖住题目'
        );
    });

    test('答题区和答题卡之间留着空隙', () => {

        assert.ok(
            layout.CONFIG.cardGap > 0,
            'cardGap 是 0 的话两块就贴在一起了'
        );
    });

    test('CONFIG 里没有 rightReserve 了 —— 留着就会被当成可以手改的旋钮', () => {

        assert.equal(
            'rightReserve' in layout.CONFIG,
            false
        );
    });

    test('宽度的两处用法都指向算出来的那个数', () => {

        const uses = layoutSource.match(/\$\{RIGHT_RESERVE\}px/g) || [];

        assert.equal(
            uses.length, 2,
            'CSS 和几何兜底各一处，实际找到 ' + uses.length + ' 处'
        );

        assert.doesNotMatch(
            layoutSource,
            /\$\{CONFIG\.rightReserve\}/,
            '还有地方在引用已经删掉的 CONFIG.rightReserve'
        );
    });
});


describe('AI 助手宽度', () => {

    test('是脚本顶部的一个数，改它就行', () => {

        assert.equal(typeof sidebar.CONFIG.panelWidth, 'number');
        assert.ok(sidebar.CONFIG.panelWidth > 0);
    });

    test('偏好里不再存宽度 —— 存了就会盖掉 CONFIG，改 CONFIG 反而不生效', () => {

        // 拖拽条删掉之后，存下来的宽度没人会再写，只剩「老值盖新配置」
        // 这一个作用。这正是最气人的那种 bug：改了文件，页面上没反应。
        assert.doesNotMatch(
            sidebarSource,
            /prefs\.width/,
            '还有地方在读 prefs.width'
        );

        assert.doesNotMatch(
            sidebarSource,
            /defaultWidth/,
            'defaultWidth 已经改名成 panelWidth 了'
        );
    });

    test('CSS 和运行时都引用 panelWidth', () => {

        const uses = sidebarSource.match(/CONFIG\.panelWidth/g) || [];

        assert.ok(
            uses.length >= 2,
            '静态 CSS 一处、render() 一处，实际找到 ' + uses.length + ' 处'
        );
    });
});
