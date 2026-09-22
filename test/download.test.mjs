// 「下载」按钮拦截的测试。
//
// 这个功能目前什么都不做 —— 只是把点击吃掉、打一行日志，再把口子
// （window.fbDownloadHook）留着。所以测的重点是「真的吃掉了」：
// 少一步 stopImmediatePropagation，粉笔自己的 Angular 监听照样会跑，
// 表现是「看着拦了，文件还是下下来了」，而且一点报错都没有。
//
// 判定和拦截分开测：判定是纯的（认不认这个元素），拦截要起一个真 DOM
// 来验事件传播顺序 —— 这两件事坏起来的样子完全不同。

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { loadModule, LAYOUT_SCRIPT } from './harness.mjs';

let layout;
let source;
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
    source = readFileSync(LAYOUT_SCRIPT, 'utf8');

    const dom = new JSDOM(PAGE);
    win = dom.window;
    doc = win.document;

    layout.installDownloadGuard(doc, win);
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


describe('留给以后的口子', () => {

    test('拦下来的时候会喊一声', () => {

        // 目前没有任何 UI 反馈，日志就是唯一的线索。
        assert.match(
            source,
            /fbDownloadHook/,
            '源码里找不到 fbDownloadHook，口子没留'
        );
    });

    test('fbDownloadHook 塞了函数就调它，参数是按钮本身', () => {

        const seen = [];
        win.fbDownloadHook = element => seen.push(element.tagName);

        click('path.download-icon-fill');

        assert.deepEqual(seen, ['APP-DOWNLOAD']);
    });

    test('钩子里抛错不能连累页面', () => {

        win.fbDownloadHook = () => {
            throw new Error('故意炸的');
        };

        assert.doesNotThrow(() => click('path.download-icon-fill'));

        win.fbDownloadHook = null;
    });

    test('没塞函数（或者塞了不是函数的）也不炸', () => {

        win.fbDownloadHook = '不是函数';

        assert.doesNotThrow(() => click('path.download-icon-fill'));

        win.fbDownloadHook = null;
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
