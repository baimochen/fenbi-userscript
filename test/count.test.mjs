// 「自定义刷题」里那个任意出题数量的测试。
//
// 这件事只在目录页的模态框里干，所以有四层要分开验：
//
//   1. 这个数本身合不合法（纯函数，最该测厚的一层）
//   2. 页面路径对不对（别在背题页也去动那个模态框）
//   3. 装进 DOM 的样子（落在哪一格、装几次、「5」怎么了）
//   4. 这个数怎么送到粉笔那边（换请求的 query，以及什么时候作废）
//
// 值的合法性值得写这么多条，是因为它挡的是一个很具体的场景：用户随手敲
// 了个 0 或者负号，或者全角输入法打出来的数字。这种值一旦漏进去，粉笔那边
// 要么报错要么给你推一整套题，而页面上不会有任何提示。
//
// 第四层是接线之后补的，也是唯一一层没法只靠纯函数验完的 —— 这个数从输入框
// 走到请求里要跨三个函数和一份模块状态，所以除了 withCustomCount 本身，剩下
// 几条是盯着源码里的接线（这个仓库对「A 到底有没有调 B」一贯是这么盯的）。

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

// 抠出两个标记之间的那段源码。断言只在这一段里找，免得跨到隔壁函数身上
// 去 —— 「源码里出现过 withCustomCount」这种断言太松了，别处出现一次它
// 就绿了，而真正该接的那条路可能根本没接。
function between(startMarker, endMarker) {

    const start = source.indexOf(startMarker);

    assert.ok(start >= 0, '源码里找不到 ' + startMarker);

    const end = source.indexOf(endMarker, start);

    assert.ok(end > start, '源码里找不到 ' + endMarker);

    return source.slice(start, end);
}


// 探针实测的那条请求，照抄，只删掉尾巴上几个和这件事无关的参数。
const API =
    '//tiku.fenbi.com/activity/userquiz/updateUserQuestionInfo' +
    '?sheetType=151&questionCount=5&yearScope=5' +
    '&correctRatioLow=0&correctRatioHigh=1&app=web';

const openHook = () => between('proto.open = function', 'proto.send = function');

// 这个范围必须夹住 —— 切到文件尾的话，那些函数定义和导出里的
// consumeCustomCount 也会被搜到，断言就永远是绿的（真踩过）。
const fetchHook = () => between('window.fetch = function', 'function injectStyle');
const sendHook = () => between('proto.send = function', 'window.fetch = function');
const inputHandler = () => between('function onCustomCountChange', 'function installCustomCount');
const installer = () => between('function installCustomCount', 'function syncCustomCount');


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


describe('把「5」那一格换成输入框', () => {

    function install(doc) {
        return layout.installCustomCount(
            doc.querySelector(layout.COUNT_LIST_SELECTOR)
        );
    }

    test('那一组还是四项，不多长出一格', () => {

        // 早先是往末尾再插一个 <li>，凑成第 9 格。八个小方块那一行本来就
        // 满了，第 9 个把行撑爆，看着就不像原生的。
        const doc = modal();
        const list = doc.querySelector(layout.COUNT_LIST_SELECTOR);

        assert.ok(list, '测试夹具里就找不到出题数量那一组，选择器是错的');

        install(doc);

        assert.equal(
            list.children.length,
            4,
            '多长出了一格 —— 那一行会被撑满或者换行'
        );
    });

    test('输入框落在第一格里，也就是「5」原来的位置', () => {

        const doc = modal();
        const list = doc.querySelector(layout.COUNT_LIST_SELECTOR);

        const input = install(doc);

        assert.ok(input, '没装出输入框');
        assert.equal(
            input.closest('li'),
            list.firstElementChild,
            '输入框没落在第一格，那一行看着会错位'
        );
    });

    test('「5」被藏起来，把位置让出来', () => {

        const doc = modal();
        const list = doc.querySelector(layout.COUNT_LIST_SELECTOR);
        const five = list.querySelector('a');

        assert.equal(
            five.textContent.trim(),
            '5',
            '夹具的第一个按钮不是 5，下面这条断言就失去意义了'
        );

        install(doc);

        assert.equal(
            five.style.display,
            'none',
            '「5」还露着，会和输入框挤在同一格里'
        );
    });

    test('是藏起来，不是从 DOM 里删掉', () => {

        // 那个 <a> 是 Angular *ngFor 渲染的，还挂着它的点击监听。
        // 删掉等于在人家的清单里挖个洞，下一轮重建时可能对不上。
        const doc = modal();
        const list = doc.querySelector(layout.COUNT_LIST_SELECTOR);
        const before = list.querySelectorAll('a').length;

        install(doc);

        assert.equal(
            list.querySelectorAll('a').length,
            before,
            'Angular 渲染出来的节点被删了'
        );
    });

    test('别的预设一个不动 —— 10 到 40 照旧', () => {

        const doc = modal();
        const list = doc.querySelector(layout.COUNT_LIST_SELECTOR);

        install(doc);

        const shown = [...list.querySelectorAll('a')]
            .filter(node => node.style.display !== 'none')
            .map(node => node.textContent.trim());

        assert.deepEqual(
            shown,
            ['10', '20', '40'],
            '除了让位的「5」，别的预设被动了'
        );
    });

    test('里面是个能输数字的输入框', () => {

        const doc = modal();
        const input = install(doc);

        assert.equal(input.tagName, 'INPUT');
        assert.equal(input.type, 'number');
        assert.equal(input.min, String(layout.MIN_CUSTOM_COUNT));
        assert.equal(input.max, String(layout.MAX_CUSTOM_COUNT));
    });

    test('借用粉笔自己的 class，长得才像一伙的', () => {

        // 自己描一套颜色边框，粉笔换主题（暗色模式）时这一格就会突兀地
        // 亮着。用它的 class，它的 CSS 会管这一格。
        const doc = modal();

        assert.ok(
            install(doc).classList.contains('select-button'),
            '没带 .select-button，样式会跟旁边几个对不上'
        );
    });

    test('重复调用不会装出第二个输入框', () => {

        const doc = modal();
        const list = doc.querySelector(layout.COUNT_LIST_SELECTOR);

        install(doc);
        install(doc);

        assert.equal(
            list.querySelectorAll('.' + layout.CUSTOM_COUNT_INPUT_CLASS).length,
            1,
            '装了两个 —— 模态框是会被反复重建的，这里必须自己去重'
        );
    });

    test('列表压根不存在时给个 null，不炸', () => {

        assert.equal(
            layout.installCustomCount(modal().querySelector('.不存在的组')),
            null
        );
    });

    test('那一组里一个预设按钮都没有时也给个 null，不炸', () => {

        const doc = modal();
        const list = doc.querySelector(layout.COUNT_LIST_SELECTOR);

        list.innerHTML = '';

        assert.equal(layout.installCustomCount(list), null);
    });
});


describe('把这个数换进请求里', () => {

    test('换掉 questionCount，别的参数一条不动', () => {

        const out = layout.withCustomCount(API, 10);

        assert.notEqual(
            out,
            API,
            '没换 —— 用户敲 10，粉笔那边收到的还是 5'
        );

        const params = new URL(out).searchParams;

        assert.equal(
            params.get(layout.COUNT_PARAM),
            '10',
            '换是换了，换成了别的数'
        );

        // 其余参数逐条比对。重建 URL 的时候很容易顺手把它们弄丢或者改掉
        // 编码，而请求照样发得出去 —— 只是粉笔收到的东西不一样了，两边
        // 都不报错。
        for (const [key, value] of [
            ['sheetType', '151'],
            ['yearScope', '5'],
            ['correctRatioLow', '0'],
            ['correctRatioHigh', '1'],
            ['app', 'web']
        ]) {
            assert.equal(params.get(key), value, key + ' 被改掉了');
        }

        assert.equal(
            [...params.keys()].length,
            6,
            '参数个数变了 —— 多出来或者少了一条'
        );
    });

    test('协议相对的地址也认 —— 页面上发出来的就是这种', () => {

        // //tiku.fenbi.com/... 直接丢给 new URL 会当场抛，要带 base。
        assert.notEqual(layout.withCustomCount(API, 7), API);
    });

    test('没自定义就原样放行', () => {

        // parseCustomCount 已经挡过一道，这里再挡一道：万一有人绕过它
        // 直接写那个变量，0 或者小数发出去就是「粉笔要么报错、要么真给你
        // 推一整套题」。
        for (const count of [null, undefined, 0, -1, 2.5, '10', NaN, Infinity]) {
            assert.equal(
                layout.withCustomCount(API, count),
                API,
                '数量是 ' + count + ' 的时候还去动了请求'
            );
        }
    });

    test('不是这条接口就不碰', () => {

        // 尤其那条解析接口 —— 它和出题这条域名一样、路径风格也像。
        const other =
            '//tiku.fenbi.com/combine/static/solution?questionCount=5';

        assert.equal(layout.withCustomCount(other, 10), other);
    });

    test('这条接口上本来没这个参数就不碰', () => {

        // 凭空加一个参数出去是另一种静默出错：粉笔可能当非法请求拒掉，
        // 也可能直接忽略 —— 两种都不报错，用户只看到「填了没反应」。
        const bare =
            '//tiku.fenbi.com/activity/userquiz/updateUserQuestionInfo' +
            '?sheetType=151';

        assert.equal(layout.withCustomCount(bare, 10), bare);
    });

    test('参数值里出现长得像的不算数', () => {

        // 拿字符串替换去改的话这一条会改错地方 —— 改的是 remark 那个值。
        // 用 searchParams 就是为了这件事。
        const sneaky =
            '//tiku.fenbi.com/activity/userquiz/updateUserQuestionInfo' +
            '?remark=old%20questionCount%3D5&questionCount=5';

        const params =
            new URL(layout.withCustomCount(sneaky, 10)).searchParams;

        assert.equal(params.get('questionCount'), '10');

        assert.equal(
            params.get('remark'),
            'old questionCount=5',
            'remark 那个值被误伤了 —— 这就是不用字符串替换的原因'
        );
    });

    test('地址坏掉就原样放行，绝不抛', () => {

        // 抛出去的话网络钩子那条链子就断了，页面上**每一个** XHR 都发不
        // 出去 —— 为了一个小功能把整站搞垮，是这里最不能出的错。
        const broken =
            '//[::1/activity/userquiz/updateUserQuestionInfo?questionCount=5';

        assert.equal(layout.withCustomCount(broken, 10), broken);
    });

    test('乱七八糟的输入都不炸', () => {

        for (const url of [null, undefined, '', 123, {}, 'not a url', '/']) {
            assert.doesNotThrow(() => layout.withCustomCount(url, 10));
        }
    });

    test('换到了就把这个数花掉 —— 只用一次', () => {

        // 模态框会被 Angular 重建，我们那个输入框跟着一起没，但这个数不会。
        // 不作废的话，下次打开模态框随手点「保存」，发出去的是上一次敲的数，
        // 而屏幕上那个输入框早就不在了 —— 没有任何地方看得出这个数是从哪儿
        // 冒出来的。
        layout.setPendingCustomCount(10);

        assert.notEqual(
            layout.consumeCustomCount(API),
            API,
            '第一次就没换到'
        );

        assert.equal(
            layout.consumeCustomCount(API),
            API,
            '第二次还换 —— 这个数没花掉，会一直留到下一次开模态框'
        );
    });

    test('没换到的请求不许吃掉它', () => {

        // 页面上埋点请求多得很。要是写成「先作废、再判」，用户敲完 10、
        // 中间来一条埋点，保存的时候就变回预设了 —— 而且完全看不出为什么，
        // 因为埋点请求在 Network 面板里根本不会有人去看。
        layout.setPendingCustomCount(10);

        const beacon =
            '//fenbi-web.cn-beijing.log.aliyuncs.com/logstores/xingce-exam' +
            '/track?APIVersion=0.6.0&event=exerciseMode&value=151';

        assert.equal(
            layout.consumeCustomCount(beacon),
            beacon,
            '埋点请求被改了 —— 这就不只是吃不吃掉的问题了'
        );

        assert.notEqual(
            layout.consumeCustomCount(API),
            API,
            '中间过了一条埋点，这个数就被吃掉了'
        );
    });

    test('手里没有数的时候什么都不做', () => {

        layout.setPendingCustomCount(null);

        assert.equal(layout.consumeCustomCount(API), API);
    });
});


describe('接线：从输入框到请求', () => {

    test('XHR 的 open 里换 —— 那是 URL 最后还能改的地方', () => {

        // 粉笔是 Angular，HttpClient 默认就走 XHR，所以这条是主线。
        assert.match(
            openHook(),
            /consumeCustomCount\(/,
            'XHR 那条路没接上，粉笔收不到这个数'
        );
    });

    test('改的是 open，不是 send', () => {

        // 在 send 里改只是改给我们自己看的 —— 请求行在 open 的时候就定死
        // 了。这是「改了个寂寞」的典型写法：代码在、日志也在、数量不动。
        assert.doesNotMatch(
            sendHook(),
            /withCustomCount\(/,
            '改成在 send 里换了 —— 那个 URL 已经发出去了，换了也没用'
        );
    });

    test('fetch 那条路也接上了，而且走的是同一道口子', () => {

        assert.match(
            fetchHook(),
            /consumeCustomCount\(/,
            'fetch 那条路没接上 —— 粉笔哪天改用它就悄悄失效了'
        );

        assert.doesNotMatch(
            fetchHook(),
            /withCustomCount\(/,
            'fetch 那条路绕过了 consumeCustomCount，没人作废'
        );
    });

    test('两条路走的都是「换到了就作废」那道口子', () => {

        // 「会不会作废」本身在上一个 describe 里真跑过一遍，这里只管接线：
        // 绕开 consumeCustomCount 直接调 withCustomCount 的话，这条路上就
        // 没人作废了，数会一直留着。
        assert.match(
            openHook(),
            /consumeCustomCount\(/,
            'XHR 那条路没经过 consumeCustomCount'
        );

        assert.doesNotMatch(
            openHook(),
            /withCustomCount\(/,
            'XHR 那条路绕过了 consumeCustomCount，没人作废'
        );
    });

    test('输入框里敲出的合法值会记下来', () => {

        assert.match(
            inputHandler(),
            /setPendingCustomCount\(value\)/,
            '输入框敲了数却没记下来，后面就没有可换的东西'
        );
    });

    test('输错了、清空了，上一个数一并作废', () => {

        // 不作废的话：框里明明空着，保存下去却是刚才那个数。
        assert.match(
            inputHandler(),
            /setPendingCustomCount\(null\)/,
            '清空输入框之后上一次那个数还留着'
        );
    });

    test('点了别的预设就作废 —— 预设优先', () => {

        // 不作废的话：敲了 10、又改点「20」，保存下去的还是 10，而屏幕上
        // 亮着的是「20」。页面说一套、发出去另一套，两边单看都是对的。
        const install = installer();

        assert.match(
            install,
            /a\.select-button/,
            '没盯着预设按钮，改点预设之后自定义还压着它'
        );

        assert.match(
            install,
            /setPendingCustomCount\(null\)/,
            '点了预设却没作废 —— 屏幕上亮「20」、发出去是 10'
        );
    });

    test('认的是 <a> 不是 .select-button，别误伤自己', () => {

        // 我们插进去的那个 input 也带着 .select-button，但它不是 <a>。
        // 选择器要是写成 .select-button，在输入框里点一下就把自己作废了。
        assert.match(installer(), /closest\('a\.select-button'\)/);
    });
});


describe('改完数量那条提示', () => {

    // 提示条要往页面上插节点，所以得先给模块一个 document。
    //
    // 平时这个缝是 installDownloadGuard 在初始化时合的（源码里的 pageDoc），
    // Node 里没有全局 document，只能照原样再合一次 —— 不这么做的话这一整块
    // 又只能退回去拿正则看源码，而「提示条上到底写了什么字」正是它唯一在
    // 做的事。
    const dom = new JSDOM('<body></body>');
    const doc = dom.window.document;

    before(() => {
        layout.installDownloadGuard(doc);
    });

    function toast() {
        return doc.querySelector('.' + layout.TOAST_CLASS);
    }

    // 走一遍真实的路：敲数 → 请求把它换走 → 提示条弹出来。
    function save(count) {

        layout.setPendingCustomCount(count);
        layout.consumeCustomCount(API);
        layout.announceAppliedCount();

        return toast();
    }


    test('换到了才弹，而且把数写在上面', () => {

        // 用户最想确认的就是「改成了几」。弹一句不带数字的「已修改」等于
        // 让他自己去猜。
        const node = save(10);

        assert.ok(node, '换掉了出题数量却一声不吭 —— 页面上看不出发生过什么');

        assert.match(
            node.textContent,
            /10/,
            '提示条上没写改成了几'
        );

        assert.match(
            node.textContent,
            /刷新/,
            '没说要刷新 —— 不刷新的话页面上还是旧数量，看着就是没生效'
        );
    });


    test('只弹一次 —— 这是个一次性的事', () => {

        save(10);

        layout.announceAppliedCount();

        assert.ok(
            toast() && toast().textContent.includes('10'),
            '第二次调用把提示条弄坏了'
        );

        // 真正的判据是那个数被取走了：再调一次不该又弹一条出来。
        // 上面那条只能说明「还挂着」，所以直接看它还认不认那个数。
        layout.hideToast();
        layout.announceAppliedCount();

        assert.equal(
            toast(),
            null,
            '提示弹了两遍 —— 那个数没被取走，别处再碰一次它还会弹'
        );
    });


    test('没换到就不弹 —— 埋点请求路过也不许弹', () => {

        const beacon =
            '//fenbi-web.cn-beijing.log.aliyuncs.com/logstores/xingce-exam' +
            '/track?APIVersion=0.6.0&event=exerciseMode&value=151';

        layout.setPendingCustomCount(10);
        layout.consumeCustomCount(beacon);
        layout.announceAppliedCount();

        assert.equal(
            toast(),
            null,
            '埋点请求路过也弹了提示 —— 用户会以为数量改成功了'
        );
    });


    test('手里什么都没有的时候什么都不做', () => {

        layout.announceAppliedCount();

        assert.equal(toast(), null);
    });


    test('刷新按钮点一下真的会刷新，并且顺手把提示收掉', () => {

        // location.reload 在这儿是没有的，补一个假的记下有没有人调它。
        // 这条验的是接线本身 —— 按钮画出来了、文案是「刷新」，但没接上
        // reload 的话，用户点下去什么都不会发生，而且不报错。
        const original = globalThis.location;
        let reloaded = 0;

        globalThis.location = {
            reload: function () {
                reloaded += 1;
            }
        };

        try {

            const node = save(10);
            const button = node.querySelector('.fb-toast-action');

            assert.ok(button, '提示条上没画刷新按钮');
            assert.equal(button.textContent, '刷新');

            button.dispatchEvent(
                new dom.window.MouseEvent('click', {
                    bubbles: true,
                    cancelable: true
                })
            );

            assert.equal(reloaded, 1, '刷新按钮没接上 location.reload');
            assert.equal(toast(), null, '刷新的同时还留着一条提示');

        } finally {

            if (original === undefined) {
                delete globalThis.location;
            } else {
                globalThis.location = original;
            }
        }
    });


    test('叉掉就没了，不用等它自己走', () => {

        const node = save(10);

        node.querySelector('.fb-toast-close').dispatchEvent(
            new dom.window.MouseEvent('click', {
                bubbles: true,
                cancelable: true
            })
        );

        assert.equal(toast(), null, '点了叉提示条还杵着');
    });


    test('两条路都记得喊这一声', () => {

        // 提示本身在上面真跑过了，这里只管接线：钩子里少一句 announce，
        // 表现就是「功能生效了但用户永远不知道」，而且不报错。
        for (const [name, block] of [
            ['XHR', openHook()],
            ['fetch', fetchHook()]
        ]) {

            assert.match(
                block,
                /announceAppliedCount\(/,
                name + ' 那条路换完 URL 没提示，用户不知道要刷新'
            );
        }
    });


    test('提示画不出来也不许把请求带崩', () => {

        // 换 URL 在那之前就已经成功了，提示条只是锦上添花。不裹 try 的话，
        // 提示里任何一处抛出去都会顺着钩子传回粉笔的请求链 —— 页面上
        // **每一个** XHR 都发不出去，而屏幕上看不出跟提示条有什么关系。
        for (const [name, block] of [
            ['XHR', openHook()],
            ['fetch', fetchHook()]
        ]) {

            assert.match(
                block,
                /try\s*\{\s*announceAppliedCount\(\)/,
                name + ' 那条路没把提示裹在 try 里 —— 提示一出错整条请求就没了'
            );
        }
    });
});
