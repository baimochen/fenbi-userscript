// 三栏宽度（AI 面板 | 答题区 | 答题卡）的测试。
//
// 这几个数本身没什么好测的 —— 测的是两件事：
//
//   1. 改一个数会不会牵扯到别的地方。三处宽度散在两个脚本里，靠人记着
//      同步是靠不住的，尤其是答题区现在是**照着另外两栏让位**的：AI 那栏
//      写大了，答题区让得不够，面板就压在题目上。
//
//   2. 有没有人把百分比又写回成 px。老版本是三个 px 数加一堆媒体查询，
//      每加一档就要再抄一遍「让出多少」，抄漏了没有报错、只是压住题目。
//      现在几何只有一处（QUESTION_INSET_*），这条盯着它别被拆开。

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


describe('三栏的比例', () => {

    test('是脚本顶部两个数，改它们就行', () => {

        for (const key of ['aiPercent', 'cardPercent']) {

            assert.equal(
                typeof layout.CONFIG[key], 'number',
                key + ' 应该是 CONFIG 里的一个数'
            );

            assert.ok(
                layout.CONFIG[key] > 0,
                key + ' 得是正的'
            );
        }
    });

    test('两个加起来不到 100 —— 剩下的要装得下答题区', () => {

        // 加起来正好 100 的话答题区宽度就是 0，再加上左右两条边距和两道
        // 空隙，直接变负数。负数宽度浏览器按 0 处理，表现是题目整块不见。
        const sum =
            layout.CONFIG.aiPercent + layout.CONFIG.cardPercent;

        assert.ok(
            sum < 100,
            '两栏占了 ' + sum + '%，答题区没地方了'
        );

        // 除了一栏的宽度，答题区还得让出两边边距和两道空隙（固定 px），
        // 所以留白得留够 —— 10% 在 1280 的屏上是 128px，扣掉 60px 的
        // 边距和空隙只剩 68px 给答题区。
        assert.ok(
            100 - sum >= 10,
            '只给答题区留了 ' + (100 - sum) + '%，屏幕一窄就没了'
        );
    });

    test('答题区没有第三个配置项 —— 它就是剩下的那份', () => {

        // 写出来就有三份数，改两个忘一个的时候谁也不知道该信哪个。
        for (const key of ['questionPercent', 'questionMaxWidth']) {

            assert.equal(
                key in layout.CONFIG, false,
                'CONFIG.' + key + ' 又回来了 —— 答题区应该是算出来的'
            );
        }
    });
});


describe('两栏之间有下限', () => {

    test('下限是 CONFIG 里两个数', () => {

        for (const key of ['aiMinWidth', 'cardMinWidth']) {

            assert.equal(
                typeof layout.CONFIG[key], 'number',
                key + ' 应该是 CONFIG 里的一个数'
            );

            assert.ok(
                layout.CONFIG[key] > 0,
                key + ' 得是正的'
            );
        }
    });

    test('卡的下限还排得下几列题号', () => {

        // 卡窄到只剩一两列就不像一张卡了。下限减掉面板边框和 .fbac-body
        // 的四周留白，得还够三列。
        const inner =
            layout.CONFIG.cardMinWidth - 2 - 24 * 2;

        assert.ok(
            layout.computeColumns(
                inner,
                layout.CONFIG.minCellWidth,
                layout.CONFIG.gridGap
            ) >= 3,
            'cardMinWidth 或 .fbac-body 的留白动过了，'
                + '最窄的卡只剩不到三列'
        );
    });

    test('面板的下限比卡的宽 —— 聊天框挤成一条就没法用了', () => {

        assert.ok(
            layout.CONFIG.aiMinWidth > layout.CONFIG.cardMinWidth,
            'AI 面板的下限比答题卡还窄，那一边排不下对话'
        );
    });
});


describe('几何只算一处', () => {

    test('答题区让位用的是那两栏的表达式本身，不是另抄一份', () => {

        // 这条是这一版的核心：让位量和栏宽必须是同一条式子。各写各的，
        // 改了下限或者比例就有一个不跟着动 —— 表现是面板压在题目上，
        // 或者两者之间空出一条谁也没占的缝。
        assert.match(
            layout.QUESTION_INSET_LEFT,
            /max\(22%, 260px\)/,
            '左边的让位量没有引用 AI 那一栏的表达式'
        );

        assert.match(
            layout.QUESTION_INSET_RIGHT,
            /max\(15%, 180px\)/,
            '右边的让位量没有引用答题卡的表达式'
        );
    });

    test('让位量里带着两侧的边距和空隙', () => {

        for (const [name, inset] of [
            ['QUESTION_INSET_LEFT', layout.QUESTION_INSET_LEFT],
            ['QUESTION_INSET_RIGHT', layout.QUESTION_INSET_RIGHT]
        ]) {

            assert.match(
                inset,
                new RegExp(layout.CONFIG.columnGap + 'px'),
                name + ' 里没有栏间空隙，那样两栏会贴在一起'
            );
        }

        assert.match(layout.QUESTION_INSET_LEFT, /16px/);
        assert.match(layout.QUESTION_INSET_RIGHT, /16px/);
    });

    test('CSS 和几何兜底引用的都是这两个常量', () => {

        // 兜底里重写一遍是**必须**的（粉笔自己给 .memorize-main 写了
        // max-width 和 margin: auto，得用内联的 !important 压住它），
        // 但值不能抄 —— 抄了就有改一处忘一处的那天。
        assert.doesNotMatch(
            layoutSource,
            /margin-(left|right):\s*calc\(\s*\d+%/,
            'CSS 里出现了手写的让位量'
        );

        // CSS 那边是模板插值，左右各一条
        const inCss =
            layoutSource.match(
                /\$\{QUESTION_INSET_(LEFT|RIGHT)\}/g
            ) || [];

        assert.equal(
            inCss.length, 2,
            'CSS 里应该左右各引用一次，实际找到 ' + inCss.length + ' 处'
        );

        // 几何兜底那边是直接的变量引用（本来就是 JS），也是左右各一条，
        // 而且得在 optimizeQuestionWidth 里面
        const fallback = layoutSource.match(
            /function optimizeQuestionWidth\(\)[\s\S]*?\n    \}/
        );

        assert.ok(fallback, '找不到 optimizeQuestionWidth');

        for (const name of ['QUESTION_INSET_LEFT', 'QUESTION_INSET_RIGHT']) {

            assert.match(
                fallback[0],
                new RegExp('\\b' + name + '\\b'),
                '几何兜底里没有引用 ' + name
            );
        }
    });

    test('答题区的宽度是 auto，不是又算一遍 100% 减多少', () => {

        // width 和 margin 都写满，同一件事就算了两遍，两遍就有对不上的
        // 那天。让出多少由 margin 说了算，宽度自己就是剩下的那些。
        assert.match(
            layoutSource,
            /\.memorize-main\s*\{[\s\S]*?width:\s*auto\s*!important/,
            '.memorize-main 的宽度应该交给 margin 推出来'
        );

        assert.doesNotMatch(
            layoutSource,
            /calc\(\s*100%\s*-\s*\$\{/,
            '还有地方在写 calc(100% - ...)'
        );
    });

    test('撤掉了粉笔自己那条 max-width', () => {

        // 粉笔给 .memorize-main 写了 max-width: var(--screen-width)
        // （桌面是 100vw - 260px）。我们那条 900px 的 !important 一撤，
        // 它就冒出来了，宽屏上会莫名其妙地在某处停住。
        assert.match(
            layoutSource,
            /\.memorize-main\s*\{[\s\S]*?max-width:\s*none\s*!important/,
            '没把粉笔自己那条 max-width 盖掉'
        );
    });
});


describe('两个脚本之间', () => {

    test('AI 那一栏的比例两边是同一个数', () => {

        // 答题区是照着布局脚本这边让位的，侧边栏那边按自己的数画 ——
        // 对不上就是面板压在题目上，或者两者之间空出一条。
        assert.equal(
            sidebar.CONFIG.panelPercent,
            layout.CONFIG.aiPercent,
            'layout 的 aiPercent 和 sidebar 的 panelPercent 不一致'
        );

        assert.equal(
            sidebar.CONFIG.panelMinWidth,
            layout.CONFIG.aiMinWidth,
            'layout 的 aiMinWidth 和 sidebar 的 panelMinWidth 不一致'
        );
    });

    test('面板离左边的距离也得对得上', () => {

        assert.equal(
            sidebar.CONFIG.panelLeft,
            layout.CONFIG.panelLeft,
            'layout 的 panelLeft 和 sidebar 的 panelLeft 不一致'
        );
    });

    test('答题卡离右边、以及它的上边缘，还是老规矩', () => {

        assert.equal(
            sidebar.CONFIG.panelTop,
            layout.CONFIG.cardTop,
            'AI 面板的上边缘和答题卡不齐平了'
        );

        assert.equal(
            sidebar.CONFIG.zIndex,
            layout.CONFIG.zIndex,
            '两个悬浮物的层级不一致'
        );
    });

    test('侧边栏画面板用的是同一条表达式', () => {

        assert.match(
            sidebarSource,
            /const PANEL_COLUMN =\s*`max\(\$\{CONFIG\.panelPercent\}%,\s*\$\{CONFIG\.panelMinWidth\}px\)`/,
            'PANEL_COLUMN 不再是「百分比 + 下限」那个写法了'
        );

        // 静态 CSS 一处、render() 一处
        const uses = sidebarSource.match(/\$\{PANEL_COLUMN\}/g) || [];

        assert.equal(
            uses.length, 1,
            '静态 CSS 里应该引用一次，实际找到 ' + uses.length + ' 处'
        );

        assert.match(
            sidebarSource,
            /panel\.style\.width = PANEL_COLUMN/,
            '运行时那处没有引用 PANEL_COLUMN'
        );
    });
});


describe('AI 助手宽度', () => {

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
            /panelWidth/,
            'panelWidth 已经改成 panelPercent + panelMinWidth 了'
        );
    });
});
