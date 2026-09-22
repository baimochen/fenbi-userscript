// 答题卡的测试：一行几个题号、以及题目多了怎么滚。
//
// 原来列数是 CONFIG.columns 写死的 5，卡宽改了它不动 —— 卡放宽了还是 5 列，
// 每个格子白白变胖；卡被媒体查询压到 195px 了还是 5 列，格子就挤了。
// 现在改成从实测宽度算，所以这里测的是「算得对不对」，不是「等于几」。
//
// 另外一半测的是滚动：以前题目一多卡片就一路长到屏幕外面去，底部的页脚
// 和「当前：N」就看不见了。现在卡片有 max-height，题号那格自己滚。

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModule, LAYOUT_SCRIPT } from './harness.mjs';

let layout;
let source;

before(() => {
    layout = loadModule(LAYOUT_SCRIPT);
    source = readFileSync(LAYOUT_SCRIPT, 'utf8');
});

// 抠出一段 CSS 声明块。参数带上结尾的花括号，比如 '.fbac-grid {'。
//
// 不能用 /选择器\s*\{([\s\S]*?)\}/ —— 模板字符串里的 ${CONFIG.xxx} 自带一个
// 花括号，非贪婪匹配会正好断在那儿，于是「块里没有 overflow-y」这种假失败
// 就出现了。也不能拿 indexOf('{') 找开头，同一个理由。
//
// 所以两头都认缩进：这个文件里的规则一律是「顶格 12 空格的选择器 + 空格 +
// 花括号」，收尾是同样 12 空格的 }。
function cssBlock(selector) {

    const marker = '\n            ' + selector;

    const start = source.indexOf(marker);

    assert.ok(start >= 0, '源码里找不到 ' + selector);

    const open = start + marker.length - 1;
    const close = source.indexOf('\n            }', open);

    assert.ok(close > open, selector + ' 那一段找不到收尾的花括号');

    return source.slice(open + 1, close);
}


describe('一行几个题号', () => {

    test('宽度不变时，算出来的列数和以前写死的 5 一致', () => {

        // 220px 的卡：减去面板 1px 边框两侧、body 11px 内边距两侧，题号区
        // 实宽 196px。这条是防回归的锚点 —— 算法换了但视觉该纹丝不动。
        assert.equal(
            layout.computeColumns(196, layout.CONFIG.minCellWidth, layout.CONFIG.gridGap),
            5,
            '默认卡宽下的列数变了，答题卡的样子跟着变，这是没打算发生的'
        );
    });

    test('卡变宽就多排一列，不会白白变胖', () => {

        const narrow = layout.computeColumns(196, 33, 7);
        const wide = layout.computeColumns(320, 33, 7);

        assert.ok(
            wide > narrow,
            '卡宽从 196 涨到 320，列数还是 ' + narrow + '，格子会胖得不成样子'
        );
    });

    test('宽度变大，列数只增不减', () => {

        // 单调性。中间要是出现「更宽反而更少列」，说明算式里有取整之类
        // 的坑，页面上表现为拉宽卡片列数乱跳。
        let previous = 0;

        for (let width = 40; width <= 800; width += 1) {

            const columns = layout.computeColumns(width, 33, 7);

            assert.ok(
                columns >= previous,
                '宽度 ' + width + ' 时列数是 ' + columns + '，比更窄时的 ' + previous + ' 还少'
            );

            previous = columns;
        }
    });

    test('多窄都至少留一列', () => {

        for (const width of [0, 1, 10, 33, 39]) {

            assert.equal(
                layout.computeColumns(width, 33, 7),
                1,
                '宽度 ' + width + ' 时算出了 0 列或负数，题号会整个消失'
            );
        }
    });

    test('还没量到宽度（0 / NaN）也要给出能看的列数', () => {

        // 卡片刚插进 DOM、布局还没跑的时候 getBoundingClientRect 是 0。
        // 这时候返回 0 或 NaN 会让 grid-template-columns 整条失效。
        for (const width of [0, NaN, undefined, null]) {

            const columns = layout.computeColumns(width, 33, 7);

            assert.ok(
                Number.isInteger(columns) && columns >= 1,
                '宽度是 ' + width + ' 时返回了 ' + columns
            );
        }
    });

    test('gap 是 0 也不会除零', () => {

        assert.ok(layout.computeColumns(196, 33, 0) >= 1);
    });
});


describe('列数的旋钮', () => {

    test('CONFIG 里没有写死的 columns 了', () => {

        assert.equal(
            'columns' in layout.CONFIG,
            false,
            'columns 还在的话，它就成了一句没人读的谎话 —— 真正生效的是算出来的那个'
        );
    });

    test('换成格子最小宽度，且是个正数', () => {

        assert.equal(typeof layout.CONFIG.minCellWidth, 'number');
        assert.ok(layout.CONFIG.minCellWidth > 0);
    });

    test('gap 从 CSS 提进了 CONFIG', () => {

        // 算列数要用 gap，CSS 里也要用 gap。抄两份的话改一处、列数就按错的
        // 间距算，表现是最后一列贴着边或者被挤掉。
        assert.equal(typeof layout.CONFIG.gridGap, 'number');

        assert.match(
            source,
            /gap:\s*\$\{CONFIG\.gridGap\}px/,
            'CSS 里的 gap 必须引用 CONFIG.gridGap'
        );
    });

    test('算出来的列数是真在用的，不是定义了没人调', () => {

        const calls = source.match(/computeColumns\(/g) || [];

        assert.ok(
            calls.length >= 2,
            'computeColumns 只出现 ' + calls.length + ' 次（定义一次 + 调用至少一次）'
        );
    });

    test('宽度变了靠 ResizeObserver 知道，不在 mutation 热路径里量', () => {

        // 这份脚本被「self-trigger 的 150ms 重排循环」咬过一次，
        // 热路径里每轮读几何尺寸正是当初的病根。
        assert.match(
            source,
            /new ResizeObserver/,
            '没用 ResizeObserver，改成每轮 mutation 都量一遍了'
        );
    });
});


describe('题目多了要滚', () => {

    test('卡片的高度上限是从顶部偏移和底部留白算的', () => {

        assert.equal(
            typeof layout.CONFIG.cardBottom,
            'number',
            'cardBottom 得存在，否则「卡片多高」又成了一个要手同步的数'
        );

        assert.match(
            source,
            /max-height:\s*calc\(\s*100vh\s*-\s*\$\{CONFIG\.cardTop\}px\s*-\s*\$\{CONFIG\.cardBottom\}px\s*\)/,
            '卡片的 max-height 必须由 cardTop / cardBottom 算出来'
        );
    });

    test('滚动加在题号那一格上，不是整张卡', () => {

        // 加在整张卡上的话，题目一多连「答题卡 12/40」那行标题和底部
        // 「当前：N」都会跟着滚走 —— 那两行正是滚动时最需要看见的。
        assert.match(
            cssBlock('.fbac-grid {'),
            /overflow-y:\s*auto/,
            '.fbac-grid 上没有 overflow-y: auto，题目多了就顶出屏幕了'
        );
    });

    test('卡片里是一条竖向 flex 链子，滚动区才分得到高度', () => {

        for (const selector of ['#fenbi-custom-answer-card {', '.fbac-panel {', '.fbac-body {']) {

            const block = cssBlock(selector);

            assert.match(
                block,
                /display:\s*flex/,
                selector + ' 不是 flex 容器，链子在这儿就断了'
            );

            assert.match(
                block,
                /flex-direction:\s*column/,
                selector + ' 不是竖向 flex，里面的滚动区就没高度可分'
            );
        }
    });

    test('中间那两层能压得下去', () => {

        // flex 子项的默认最小高度是内容高度，不写 min-height: 0 就永远
        // 压不下去，底下那个 overflow 也就永远不触发 —— flex 里最经典的
        // 「明明写了滚动却滚不动」。面板和 body 各是一层的子项，两处都要有。
        for (const selector of ['.fbac-panel {', '.fbac-body {', '.fbac-grid {']) {

            assert.match(
                cssBlock(selector),
                /min-height:\s*0/,
                selector + ' 少了 min-height: 0，滚动永远不触发'
            );
        }
    });

    test('标题、状态行、页脚都不参与压缩', () => {

        // 这三行是滚动时最该一直看得见的，被压扁或被滚走都算白做。
        for (const selector of ['.fbac-header {', '.fbac-status {', '.fbac-footer {']) {

            assert.match(
                cssBlock(selector),
                /flex:\s*0\s+0\s+auto/,
                selector + ' 没有 flex: 0 0 auto，会被题号区挤扁'
            );
        }
    });
});
