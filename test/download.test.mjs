// 「下载」按钮拦截的测试。
//
// 这个功能目前什么都不做 —— 只是把点击吃掉、打一行日志，再把口子
// （window.fbDownloadHook）留着。所以测的重点是「真的吃掉了」：
// 少一步 stopImmediatePropagation，粉笔自己的 Angular 监听照样会跑，
// 表现是「看着拦了，文件还是下下来了」，而且一点报错都没有。
//
// 判定和拦截分开测：判定是纯的（认不认这个元素），拦截要起一个真 DOM
// 来验事件传播顺序 —— 这两件事坏起来的样子完全不同。

import { test, describe, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadModule, LAYOUT_SCRIPT } from './harness.mjs';

let layout;
let win;
let doc;

// 一棵像真页面那样嵌着的下载按钮：粉笔的图标是 svg + path，
// 点上去 event.target 是那个 path，不是 app-download 本身。
const PAGE = `
    <div id="nav">
        <app-download>
            <div class="download-inner">
                <svg viewBox="0 0 20 20"><path class="download-icon-fill"></path></svg>
                下载
            </div>
        </app-download>
        <div class="submit-btn">交卷</div>
    </div>
`;

before(() => {
    layout = loadModule(LAYOUT_SCRIPT);

    const dom = new JSDOM(PAGE);
    win = dom.window;
    doc = win.document;

    layout.installDownloadGuard(doc);
});

function click(selector) {
    const node = doc.querySelector(selector);

    // 页面自己的两个监听（模拟粉笔 Angular 挂在文档上的那类）：
    // 它们跑没跑，就是「拦没拦住」的判据。
    //
    // 两个阶段都要挂。只挂冒泡的话，一套自身跑在冒泡阶段的拦截也能让
    // 这条测试变绿 —— 而粉笔真跑起来的时候，它挂在捕获阶段的监听早跑完了。
    const fired = [];

    const captureListener = () => fired.push('capture');
    const bubbleListener = () => fired.push('bubble');

    doc.addEventListener('click', captureListener, true);
    doc.addEventListener('click', bubbleListener);

    const notCanceled = node.dispatchEvent(
        new win.MouseEvent('click', { bubbles: true, cancelable: true })
    );

    doc.removeEventListener('click', captureListener, true);
    doc.removeEventListener('click', bubbleListener);

    return { notCanceled, fired };
}


describe('认不认这个元素', () => {

    test('按钮本身和它里头的子孙都算', () => {

        for (const selector of ['app-download', '.download-inner', 'svg', 'path.download-icon-fill']) {
            assert.equal(
                layout.isDownloadTarget(doc.querySelector(selector)),
                true,
                selector + ' 没被认成下载按钮，点它就会真的下载'
            );
        }
    });

    test('别的东西不算 —— 拦宽了会把交卷也吃掉', () => {

        for (const selector of ['.submit-btn', '#nav', 'body']) {
            assert.equal(
                layout.isDownloadTarget(doc.querySelector(selector)),
                false,
                selector + ' 被判成了下载按钮'
            );
        }
    });

    test('拿不到元素（null / 不是元素）也不能炸', () => {

        // 事件没目标、或者目标是文本节点的时候会走到这儿。
        for (const value of [null, undefined, doc.createTextNode('下载')]) {
            assert.equal(layout.isDownloadTarget(value), false);
        }
    });
});


describe('点击真的被吃掉了', () => {

    test('默认行为被阻止 —— 不阻止就还是会下载', () => {

        const result = click('path.download-icon-fill');

        assert.equal(
            result.notCanceled,
            false,
            '点击没有被 preventDefault，浏览器该干嘛还干嘛'
        );
    });

    test('页面上别的监听收不到这个点击，捕获和冒泡都收不到', () => {

        // 这条才是关键：粉笔自己的下载逻辑挂在文档上。
        //
        // 只 preventDefault 不 stopImmediatePropagation 的话，文件照样下下来，
        // 而且从页面上完全看不出来脚本没生效。
        //
        // 捕获那一半是在验「挂的是捕获阶段」：拦截自己要是也跑在冒泡阶段，
        // 页面挂在捕获上的监听就先跑完了，那时候再拦已经晚了。
        const result = click('.download-inner');

        assert.deepEqual(
            result.fired,
            [],
            '点击还是传到了页面自己的监听上（' + result.fired.join('、') + '），说明没拦干净'
        );
    });

    test('交卷按钮不受影响', () => {

        const result = click('.submit-btn');

        assert.deepEqual(
            result.fired,
            ['capture', 'bubble'],
            '交卷的点击被拦下来了 —— 拦宽了比不拦更糟'
        );
    });
});


// 当前挂着的那个菜单。没有就是 null。
function menu() {
    const item = doc.querySelector('.' + layout.DOWNLOAD_ITEM_CLASS);
    return item ? item.parentNode : null;
}

// 菜单里那几项的文案，按顺序。
function items() {
    const node = menu();
    return node ? Array.from(node.children).map(el => el.textContent) : [];
}


describe('点一下出菜单', () => {

    // 每个用例都从「菜单关着」开始，跑完再关一次 —— 菜单是挂在 body 上的
    // 真节点，上一个用例留着的会被下一个用例的 querySelector 捞到。
    afterEach(() => {
        click('.submit-btn');
    });

    test('点在图标上也能弹出来 —— 认的是祖先', () => {

        // 粉笔的图标是 svg + path，event.target 是那个 path。
        click('path.download-icon-fill');

        assert.deepEqual(
            items(),
            ['题目成册', '题目脱库'],
            '点了下载按钮没出菜单，或者菜单里不是这两项'
        );
    });


    test('菜单项自己不能被当成下载按钮', () => {

        // 菜单挂在 body 上而不是按钮里，就是为了这个。挂进去的话，点菜单项
        // 那一下的 target 落在 app-download 里，会被守卫当成「又点了一次
        // 下载」吃掉 —— 表现是点「题目脱库」什么都不会发生，而且不报错。
        click('path.download-icon-fill');

        const item = doc.querySelector('.' + layout.DOWNLOAD_ITEM_CLASS);

        assert.equal(
            layout.isDownloadMenuItem(item),
            true,
            '菜单项没被认出来，点下去不会触发任何事'
        );

        assert.equal(
            layout.isDownloadTarget(item),
            false,
            '菜单项被认成了下载按钮 —— 它挂在 body 上才对'
        );
    });


    test('点页面别处，菜单收回去', () => {

        click('path.download-icon-fill');

        assert.ok(menu(), '前提就没成立：菜单没弹出来');

        click('.submit-btn');

        assert.equal(menu(), null, '点了别处菜单还杵在那儿');
    });


    test('Esc 也能收', () => {

        click('path.download-icon-fill');

        doc.dispatchEvent(
            new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );

        assert.equal(menu(), null, 'Esc 关不掉菜单');
    });
});


describe('「题目成册」把点击还给粉笔', () => {

    // 这一整块验的是一件很别扭的事：我们的守卫挂在 document 捕获阶段，
    // 拦得比粉笔还早，所以「按一下原功能」只能是举旗子 + 重放点击。
    // 重放要是也被自己拦住，表现就是菜单点了没反应 —— 而且不报错。

    function clickItem(label) {

        const fired = [];

        /*
         * 只记落在下载按钮上的事件。
         *
         * 不能靠「先清空数组」把点菜单那一下滤掉 —— 重放是同步发生的，
         * 就在点菜单这一下**里面**，中间没有可以插手的缝。
         */
        const capture = event => {
            if (layout.isDownloadTarget(event.target)) fired.push('capture');
        };

        const bubble = event => {
            if (layout.isDownloadTarget(event.target)) fired.push('bubble');
        };

        doc.addEventListener('click', capture, true);
        doc.addEventListener('click', bubble);

        click('path.download-icon-fill');

        const item = Array.from(
            doc.querySelectorAll('.' + layout.DOWNLOAD_ITEM_CLASS)
        ).find(el => el.textContent === label);

        item.dispatchEvent(
            new win.MouseEvent('click', { bubbles: true, cancelable: true })
        );

        doc.removeEventListener('click', capture, true);
        doc.removeEventListener('click', bubble);

        return fired;
    }


    test('重放的那一下，粉笔那边的监听收得到', () => {

        assert.deepEqual(
            clickItem('题目成册'),
            ['capture', 'bubble'],
            '重放的点击被自己的守卫拦住了 —— 点了「题目成册」什么都不会发生'
        );
    });


    test('重放落在用户真正点的那个元素上', () => {

        /*
         * 守卫认的是 closest('app-download')，也就是那个**宿主元素**；
         * 但真人点的是它里头的图标。这两个不是一回事：
         *
         *   事件只沿「派它的那个元素」往上冒。
         *
         * 派给宿主的话，传播路径是 document → … → app-download，挂在它
         * **子孙**上的监听压根不在路径上，一个都不会响。粉笔的下载处理器
         * 挂在宿主上还是挂在图标上，只有运行时才知道 —— 所以只能照着真人
         * 的样子，派给他点的那个元素。
         *
         * 上面那两条验不出这件事：它们盯的是挂在 document 上的监听，而
         * document 在两种派法里都在路径上。
         */
        const inner = doc.querySelector('.download-inner');
        const fired = [];

        inner.addEventListener('click', () => fired.push('inner'));

        // 先按真人那样把菜单点开（这一下本身就会经过 inner）
        click('path.download-icon-fill');

        const item = Array.from(
            doc.querySelectorAll('.' + layout.DOWNLOAD_ITEM_CLASS)
        ).find(el => el.textContent === '题目成册');

        // 清在这儿才有用：重放发生在下面这一下**里面**，中间没有缝。
        fired.length = 0;

        item.dispatchEvent(
            new win.MouseEvent('click', { bubbles: true, cancelable: true })
        );

        assert.deepEqual(
            fired,
            ['inner'],
            '重放的事件没经过图标本身 —— 处理器挂在它上面的话，点「题目成册」就是没反应，而且不报错'
        );
    });


    test('放行只限重放那一下，之后立刻收回来', () => {

        // 旗子忘了复位的话，从此以后点下载按钮会直接触发粉笔的下载，
        // 菜单再也不弹了。
        clickItem('题目成册');

        click('path.download-icon-fill');

        assert.deepEqual(
            items(),
            ['题目成册', '题目脱库'],
            '重放之后旗子没收回来，下载按钮再也不弹菜单了'
        );
    });


    test('菜单点完就收 —— 不留一个挂在页面上的空壳', () => {

        clickItem('题目成册');

        assert.equal(menu(), null, '点了菜单项之后菜单还留着');
    });
});


describe('挂在捕获阶段', () => {

    test('拦下来的点击连捕获阶段的监听都传不到', () => {

        // 上面那条「页面自己的监听收不到」用的是挂在冒泡上的监听，
        // 单靠它分不出拦截是哪个阶段跑的。这里换一个先挂上的捕获监听：
        // 拦截要是跑在冒泡阶段，它必然先响。
        const fired = [];

        doc.addEventListener('click', () => fired.push('capture'), true);

        click('path.download-icon-fill');

        assert.deepEqual(
            fired,
            [],
            '捕获阶段先跑完了才轮到拦截 —— 说明拦截挂的是冒泡，抢不到粉笔前面'
        );
    });
});
