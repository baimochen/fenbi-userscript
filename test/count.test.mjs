// 「自定义刷题」里那个任意出题数量的测试。
//
// 这件事只在目录页的模态框里干，所以有三层要分开验：
//
//   1. 这个数本身合不合法（纯函数，最该测厚的一层）
//   2. 页面路径对不对（别在背题页也去插一个输入框）
//   3. 插进 DOM 的样子（插哪儿、插几次、有没有输入框）
//
// 值的合法性值得写这么多条，是因为它挡的是一个很具体的场景：用户随手敲
// 了个 0 或者负号，或者全角输入法打出来的数字。这种值一旦漏进去，粉笔那边
// 要么报错要么给你推一整套题，而页面上不会有任何提示。

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { loadModule, LAYOUT_SCRIPT } from './harness.mjs';

let layout;
let source;

// 从真实页面抄下来的那一小段结构，只留和这件事有关的部分
const MODAL = `
    <div class="customize-question-content">
        <h3 class="h-3">自定义刷题</h3>
        <main>
            <p class="m-t-36 h-5">设置每组出题数量</p>
            <ul class="question-mode-count m-t-16">
                <li><a class="select-button square-button">5</a></li>
                <li><a class="select-button square-button">10</a></li>
                <li><a class="select-button square-button select-button-active">20</a></li>
                <li><a class="select-button square-button">40</a></li>
            </ul>
        </main>
    </div>
`;

before(() => {
    layout = loadModule(LAYOUT_SCRIPT);
    source = readFileSync(LAYOUT_SCRIPT, 'utf8');
});

function modal() {
    const dom = new JSDOM(MODAL);
    return dom.window.document;
}


describe('这个数合不合法', () => {

    test('正常输入就是它自己', () => {

        for (const [text, expected] of [
            ['1', 1],
            ['20', 20],
            ['7', 7],
            ['500', 500]
        ]) {
            assert.equal(
                layout.parseCustomCount(text),
                expected,
                text + ' 被拒了'
            );
        }
    });

    test('两头的空白不算数', () => {

        assert.equal(layout.parseCustomCount('  20  '), 20);
        assert.equal(layout.parseCustomCount('\n7\t'), 7);
    });

    test('全角数字认 —— 中文输入法底下很容易敲出来', () => {

        // １２３ 是全角的。用户在中文输入法里打数字、又没切回来的时候
        // 就是它。当成非法的话，人只会觉得「输了没反应」。
        assert.equal(layout.parseCustomCount('１２３'), 123);
    });

    test('0 不算数', () => {

        assert.equal(layout.parseCustomCount('0'), null);
        assert.equal(layout.parseCustomCount('00'), null);
    });

    test('负数、小数、乱七八糟的都不算数', () => {

        for (const text of ['-5', '2.5', '1e3', '+5', '20题', 'abc', '', '   ', '0x10', '1/2']) {
            assert.equal(
                layout.parseCustomCount(text),
                null,
                '「' + text + '」被判成合法了'
            );
        }
    });

    test('空值不炸', () => {

        for (const value of [null, undefined, 0, false]) {
            assert.equal(layout.parseCustomCount(value), null);
        }
    });

    test('大得离谱的不认 —— 免得一次推出几千道题', () => {

        assert.equal(layout.parseCustomCount('501'), null);
        assert.equal(layout.parseCustomCount('999999'), null);
        assert.equal(layout.parseCustomCount(String(Number.MAX_SAFE_INTEGER)), null);
    });

    test('上下界本身是认的', () => {

        assert.equal(
            layout.parseCustomCount(String(layout.MIN_CUSTOM_COUNT)),
            layout.MIN_CUSTOM_COUNT
        );

        assert.equal(
            layout.parseCustomCount(String(layout.MAX_CUSTOM_COUNT)),
            layout.MAX_CUSTOM_COUNT
        );
    });
});


describe('只在目录页干活', () => {

    test('目录页认', () => {

        for (const path of [
            '/spa/tiku/guide/catalog',
            '/spa/tiku/guide/catalog/',
            '/spa/tiku/guide/catalog?x=1'
        ]) {
            assert.equal(layout.isCatalogPage(path), true, path + ' 没被认出来');
        }
    });

    test('别的地方一律不认 —— 尤其背题页', () => {

        // 背题页上要是也去插个输入框，那是往别人家里乱放东西。
        for (const path of [
            '/ti/memorize/practice',
            '/spa/tiku/guide',
            '/spa/tiku/guide/catalogX',
            '/',
            ''
        ]) {
            assert.equal(layout.isCatalogPage(path), false, path + ' 被误认成目录页了');
        }
    });

    test('拿不到路径也不炸', () => {

        for (const value of [null, undefined]) {
            assert.equal(layout.isCatalogPage(value), false);
        }
    });
});


describe('插进模态框里那一项', () => {

    test('插在出题数量那一组里，末尾', () => {

        const doc = modal();
        const list = doc.querySelector(layout.COUNT_LIST_SELECTOR);

        assert.ok(list, '测试夹具里就找不到出题数量那一组，选择器是错的');

        const option = layout.buildCustomCountOption(list);

        assert.equal(
            list.lastElementChild,
            option,
            '没插在末尾 —— 插到中间去会把「不限 / 近3年」那几组的位置也顶乱'
        );

        assert.equal(list.children.length, 5, '原来的四项应该还在');
    });

    test('里面有个能输数字的输入框', () => {

        const doc = modal();
        const option = layout.buildCustomCountOption(doc.querySelector(layout.COUNT_LIST_SELECTOR));

        const input = option.querySelector('input');

        assert.ok(input, '插进去的那一项里没有输入框');
        assert.equal(input.type, 'number');
        assert.equal(input.min, String(layout.MIN_CUSTOM_COUNT));
        assert.equal(input.max, String(layout.MAX_CUSTOM_COUNT));
    });

    test('借用粉笔自己的 class，长得才像一伙的', () => {

        // 自己描一套颜色边框，粉笔换主题（暗色模式）时这一项就会突兀地
        // 亮着。用它的 class，它的 CSS 会管这一项。
        const doc = modal();
        const option = layout.buildCustomCountOption(doc.querySelector(layout.COUNT_LIST_SELECTOR));

        assert.ok(
            option.querySelector('.select-button'),
            '没带 .select-button，样式会跟旁边四项对不上'
        );
    });

    test('重复调用不会插出第二项', () => {

        const doc = modal();
        const list = doc.querySelector(layout.COUNT_LIST_SELECTOR);

        layout.buildCustomCountOption(list);
        layout.buildCustomCountOption(list);

        assert.equal(
            list.querySelectorAll('.' + layout.CUSTOM_COUNT_CLASS).length,
            1,
            '插了两项 —— 模态框是会被反复重建的，这里必须自己去重'
        );
    });

    test('列表压根不存在时给个 null，不炸', () => {

        const doc = modal();

        assert.equal(
            layout.buildCustomCountOption(doc.querySelector('.不存在的组')),
            null
        );
    });
});


describe('探针', () => {

    test('探针是留着打日志用的，不是偷偷改东西', () => {

        // 这一轮刻意不接管真实出题数量 —— 值怎么送到粉笔那边还没接。
        // 所以这里盯一下：别出现「猜着改请求」这种代码，猜错就是静默出错。
        assert.match(
            source,
            /\[粉笔自定义数量/,
            '探针的日志前缀没了，控制台里就分不出哪几行是探针打的'
        );
    });

    test('探针能手动再武装一次', () => {

        // 自动武装只有 3 秒，等用户想起来点「保存」常常已经过了。
        assert.match(
            source,
            /fbCountProbe/,
            '没留手动重开的入口，探针窗口过了就只能刷新页面'
        );
    });
});
