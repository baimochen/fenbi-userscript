// 答题卡的测试：一行几个题号、以及题目多了怎么滚。
//
// 原来列数是 CONFIG.columns 写死的 5，卡宽改了它不动 —— 卡放宽了还是 5 列，
// 每个格子白白变胖；卡被媒体查询压到 195px 了还是 5 列，格子就挤了。
// 现在改成从实测宽度算，所以这里测的是「算得对不对」，不是「等于几」。
//
// 另外一半测的是滚动：以前题目一多卡片就一路长到屏幕外面去，底部的页脚
// 和「当前：N」就看不见了。现在卡片有 max-height，题号那格自己滚。
//
// 最后一块测的是显隐：卡片以前不问青红皂白就挂在页面上，目录页、解析页、
// 首页这种没有题目的地方也杵着一块写着「0/0 / 共 0 题」的空卡。现在没题号
// 就收起来。

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
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

    test('默认卡宽下还是 5 列', () => {

        // 256px 的卡：减去面板 1px 边框两侧、body 24px 内边距两侧，题号区
        // 实宽 206px。这条是防回归的锚点 —— 内边距和卡宽是一起调的，
        // 目的是让留白变大而列数纹丝不动，谁再单独动其中一个都会撞到这儿。
        //
        // 注意实宽一直是 206：两次加内边距都是「卡宽加多少、内边距就吃多少」，
        // 所以格子的大小和列数从 220px 那版起就没变过，变的只有那圈留白。
        //
        // 反过来说：内边距只要超过 24px（或者卡宽掉回 256px 以下），这里
        // 就会变成 4 列。所以这两个数是一对，不能拆开改。
        assert.equal(
            layout.computeColumns(206, layout.CONFIG.minCellWidth, layout.CONFIG.gridGap),
            5,
            '默认卡宽下的列数变了，答题卡的样子跟着变，这是没打算发生的'
        );
    });

    test('题号区实宽确实是 206 —— 卡宽和内边距得配上', () => {

        // 上面那条锚的是 206 这个数，但它得真的由 cardWidth 和内边距推出来，
        // 否则改了 CONFIG 而锚点还绿着，等于没盯着。
        assert.equal(
            layout.CONFIG.cardWidth - 2 - 24 * 2,
            206,
            'cardWidth 或内边距动过了，上面那条锚点的 206 已经不是真的了'
        );

        assert.match(
            cssBlock('.fbac-body {'),
            /padding:\s*24px/,
            '.fbac-body 的内边距不是 24px —— 上面那条算式里的 24 就成了一句谎话'
        );
    });

    test('题号区自己那圈留白不能把列数挤掉', () => {

        // 上面那层 .fbac-body 的 24px 是卡片四周的留白，这一层是题号区
        // 自己的：.fbac-grid 是 overflow: auto 的滚动容器，而滚动容器的
        // 裁剪边是 padding box —— 自己一点 padding 都不留，第一列题号选中
        // 时的光圈（is-current 那条 box-shadow 往外支 2px）就被切掉一条边。
        // 5 比光圈和 hover 上浮那 1px 都宽，四边都留就都盖住了。
        //
        // 但它同时在减 grid 的 content 宽度，而 syncCardColumns 量的是
        // border box（206，padding 算在里面），量不到这圈 padding。所以它
        // 一大，列数还报 5，格子却在悄悄变窄，最后挤成一条 —— 而且没有
        // 任何一处能量得出来。
        assert.match(
            cssBlock('.fbac-grid {'),
            /padding:\s*5px\b(?!\s+\d)/,
            '.fbac-grid 的留白动过了，下面那条算式里的 10 就不再是真的'
        );

        // 余量很薄：(196 + 7) / (33 + 7) = 5.075，再多一个像素就掉到 4 列。
        // 所以这条不是「顺便验一下」，是这一版唯一挡在 4 列前面的东西。
        assert.equal(
            layout.computeColumns(
                206 - 5 * 2,
                layout.CONFIG.minCellWidth,
                layout.CONFIG.gridGap
            ),
            5,
            '题号区自己那圈留白把列数从 5 挤掉了'
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


describe('没题目就别显示', () => {

    // 这张卡在显隐这件事上只有一个可观察的状态：带没带那个隐藏类。
    // 所以这里拿一个空壳 <div> 顶上就行 —— 真卡片那套壳是 createCustomCard
    // 拼的，跟「该不该露脸」这条规则没关系，混在一起只会让失败信息变糊。
    const dom = new JSDOM('<div id="fenbi-custom-answer-card"></div>');
    const doc = dom.window.document;

    function makeCard() {
        return doc.createElement('div');
    }

    function buttons(count) {
        return Array.from(
            { length: count },
            () => doc.createElement('button')
        );
    }

    function hidden(card) {
        return card.classList.contains(layout.CARD_HIDDEN_CLASS);
    }


    test('一个题号都没有 —— 收起来', () => {

        const card = makeCard();

        assert.equal(
            layout.applyCardVisibility(card, []),
            false,
            '收起来不算「刚露出来」，回报 true 会让调用方白量一次宽度'
        );

        assert.ok(hidden(card), '没题目的时候卡片还挂在页面上');
    });


    test('有题号 —— 露出来，并回报「这一下刚露出来」', () => {

        const card = makeCard();

        layout.applyCardVisibility(card, []);

        assert.equal(
            layout.applyCardVisibility(card, buttons(3)),
            true,
            '从藏变露那一次没回报 true，调用方就不会重量宽度'
        );

        assert.equal(hidden(card), false, '有题目了卡片还藏着');
    });


    test('已经是露的，再报一次不重复写 DOM', () => {

        // updateCustomCard 是热路径，每轮 mutation 都要走到这儿。无条件写
        // classList 等于自己给自己再造一轮 mutation —— 这份脚本被那个
        // 自我触发的循环咬过一次，代价是一整轮排查。
        const card = makeCard();

        layout.applyCardVisibility(card, buttons(1));

        assert.equal(
            layout.applyCardVisibility(card, buttons(1)),
            false,
            '状态没变却回报「刚露出来」，每轮都会白量一次宽度'
        );
    });


    test('题目没了再收回去', () => {

        const card = makeCard();

        layout.applyCardVisibility(card, buttons(2));

        assert.equal(layout.applyCardVisibility(card, []), false);

        assert.ok(hidden(card), '切到没有题目的页面之后卡片还留着');
    });


    test('卡片还没建出来（null）也不炸', () => {

        assert.equal(layout.applyCardVisibility(null, buttons(1)), false);
        assert.equal(layout.applyCardVisibility(null, []), false);
    });


    test('隐藏规则必须带 !important', () => {

        // #fenbi-custom-answer-card 那条把 display 钉成了 flex !important。
        // CSS 先比重要性、再比特异性，所以一条不带 important 的类选择器
        // 根本盖不住它 —— 表现是「隐藏类加上了，卡片照样在」，而且一点
        // 报错都没有。这个感叹号就是这条功能的命门。
        assert.match(
            cssBlock('#fenbi-custom-answer-card.fbac-hidden {'),
            /display:\s*none\s*!important/,
            '.fbac-hidden 不是 display: none !important，压不住卡片的 flex'
        );
    });


    test('卡片一建出来就是藏的，没数据的页面不会闪一下「0/0」', () => {

        // 建出来先露着、等下一轮 updateCustomCard 再收，页面上会闪一下
        // 写着「0/0 / 共 0 题」的空卡。
        assert.match(
            source,
            /customCard\.classList\.add\(\s*CARD_HIDDEN_CLASS\s*\)/,
            'createCustomCard 没先把卡片藏起来'
        );
    });


    test('显隐是热路径在管，不是只在初始化时判一次', () => {

        // 粉笔是单页应用：从答题页点回目录页，卡片得跟着收起来。只在
        // init 里判一次的话，走路由切换这条路就漏了。
        assert.match(
            source,
            /function updateCustomCard\(\)[\s\S]*?applyCardVisibility\(/,
            'updateCustomCard 里没调 applyCardVisibility，路由一切换就不灵了'
        );
    });


    test('从藏变露那一次重量宽度 —— 否则会以 1 列闪一下', () => {

        // display: none 没有盒子，量出来是 0 宽，computeColumns 把 0 宽
        // 兜成 1 列。不重量的话，卡片会先以 1 列的样子画出来，等
        // ResizeObserver 下一轮回调才跳回 5 列。
        assert.match(
            source,
            /if \(justShown\) \{\s*syncCardColumns\(\);/,
            'updateCustomCard 露出来那一次没有重量宽度'
        );
    });
});
