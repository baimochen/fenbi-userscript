// 「复制题目」按钮的提取逻辑测试。
//
// 逻辑住在 fenbi-memorize-layout.user.js（解析面板是那份脚本造的），
// 这里用的是同一个夹具，所以两种脚本的提取结果可以直接对照。
//
// 脚本靠末尾的 UMD 尾巴导出纯函数：检测到 module 就只导出、不进 init()，
// 所以在 Node 里加载不会碰 DOM，也不会去挂钩 XHR。

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { fixturePath, fixtureExists, buildFixture } from './make-fixture.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LAYOUT_SCRIPT = join(ROOT, 'fenbi-memorize-layout.user.js');

let api;
let doc;

before(() => {
    if (!fixtureExists()) {
        const result = buildFixture();
        assert.ok(result.ok, '夹具生成失败：' + result.reason);
    }

    const sandbox = { module: { exports: {} } };
    new Function('module', readFileSync(LAYOUT_SCRIPT, 'utf8'))(sandbox.module);
    api = sandbox.module.exports;

    doc = new JSDOM(readFileSync(fixturePath(), 'utf8')).window.document;
});

function ti(type) {
    for (const el of doc.querySelectorAll('app-ti')) {
        const name = el.querySelector('.title-type-name');
        if (name && name.textContent.trim() === type) return el;
    }
    throw new Error('夹具里没有 ' + type);
}

describe('extractForCopy', () => {

    test('单选题：题干、四个选项、题号、题型', () => {
        const q = api.extractForCopy(ti('单选题'));

        assert.equal(q.type, '单选题');
        assert.equal(q.index, '1.');
        assert.equal(q.stem, '《学记》中阐述的教育原则“藏息相辅”是指（ ）。');
        assert.deepEqual(q.choices, [
            { label: 'A', text: '强调教与学相辅相成' },
            { label: 'B', text: '强调课内与课外相结合' },
            { label: 'C', text: '强调教学要循序渐进' },
            { label: 'D', text: '强调自学与合作相结合' }
        ]);
    });

    test('多选题：选项在 choice-checkbox 里', () => {
        const q = api.extractForCopy(ti('多选题'));

        assert.equal(q.type, '多选题');
        assert.equal(q.choices.length, 4);
        assert.deepEqual(q.choices[0], { label: 'A', text: '教育年限与支持' });
    });

    test('判断题：没有字母，文字在 app-format-html 里', () => {
        const q = api.extractForCopy(ti('判断题'));

        assert.deepEqual(q.choices, [
            { label: '', text: '正确' },
            { label: '', text: '错误' }
        ]);
    });

    test('填空题：没有选项，空位换成占位符', () => {
        const q = api.extractForCopy(ti('填空题'));

        assert.deepEqual(q.choices, []);
        assert.match(q.stem, /有目的、____、有组织地传授知识/);
    });

    test('复制的是题目本身，不带「请给出正确答案」这类指令', () => {
        const text = api.formatForCopy(api.extractForCopy(ti('单选题')));

        assert.doesNotMatch(text, /请给出正确答案/);
    });

    test('传 null / 非题目元素返回 null', () => {
        assert.equal(api.extractForCopy(null), null);
        assert.equal(api.extractForCopy(doc.createElement('div')), null);
    });
});

describe('formatForCopy', () => {

    test('单选题：题型、题号、题干、选项', () => {
        const text = api.formatForCopy(api.extractForCopy(ti('单选题')));

        assert.equal(text, [
            '【单选题】第1题',
            '《学记》中阐述的教育原则“藏息相辅”是指（ ）。',
            'A. 强调教与学相辅相成',
            'B. 强调课内与课外相结合',
            'C. 强调教学要循序渐进',
            'D. 强调自学与合作相结合'
        ].join('\n'));
    });

    test('判断题：直接列文字，不留空字母', () => {
        const text = api.formatForCopy(api.extractForCopy(ti('判断题')));

        assert.match(text, /^【判断题】第29题\n/);
        assert.match(text, /\n正确\n错误$/);
        assert.doesNotMatch(text, /^\s*\.\s/m);
    });

    test('填空题：没有选项时不留下多余空行', () => {
        const text = api.formatForCopy(api.extractForCopy(ti('填空题')));

        assert.doesNotMatch(text, /\n{2,}/);
        assert.match(text, /____/);
    });

    test('不带材料 —— 材料由侧边栏脚本负责，这个按钮只复制题目', () => {
        const text = api.formatForCopy(api.extractForCopy(ti('单选题')));

        assert.doesNotMatch(text, /【材料】/);
        assert.doesNotMatch(text, /王老师是某班班主任/);
    });

    test('传 null 返回空串', () => {
        assert.equal(api.formatForCopy(null), '');
    });
});

// 这里原本有一条「两份脚本的提取结果一致」的测试。
//
// 侧边栏脚本的题目提取代码（extractQuestion 那一套）随「问这道题」按钮一起删掉了，
// 现在全项目只有这一处读题目，没有第二份实现可比。测试跟着删。
//
// 题目提取的回归网还在：这个文件剩下的用例，加上它是从真实题库夹具上跑的。


describe('解析面板的标题栏', () => {

    // 这一行原来是「解析 | 复制题目 | 询问 AI | 展开 ▾」，最左边那个「解析」
    // 是纯标题（不是按钮，点不动）。删掉之后这层意思并进了展开按钮的字里，
    // 那一行只剩右边三个按钮。

    test('标题栏左边那个「解析」标题彻底删了 —— HTML 和 CSS 一起', () => {

        // 删这种东西最容易只删一半：span 拿掉了，给它写的样式还在。
        // 留着不报错、不影响观感，下次有人照着它找元素就找不到了。
        assert.doesNotMatch(
            readFileSync(LAYOUT_SCRIPT, 'utf8'),
            /fb-sol-title/,
            'HTML 里的标题删了，CSS 里那段 .fb-sol-title 还留着'
        );
    });

    test('展开按钮上的字各只有一份 —— 抄成两份，点一下就会漂回去', () => {

        // 这两个字在代码里本来要出现两次：初始 HTML 里写一次，点击后回写
        // 一次。两处各抄一份字面量的话，改了其中一处，按钮点一下就变回
        // 旧的 —— 提成常量就是为了防这个，这里盯着别再抄回去。
        const source = readFileSync(LAYOUT_SCRIPT, 'utf8');

        assert.equal(
            (source.match(/'解析和展开 ▾'/g) || []).length,
            1,
            '「解析和展开」的字面量出现了不止一次，改一处会漏另一处'
        );

        assert.equal(
            (source.match(/'收起 ▴'/g) || []).length,
            1,
            '「收起 ▴」的字面量出现了不止一次，改一处会漏另一处'
        );
    });

    test('展开那半句带着「解析」—— 标题删了，意思得有人接着', () => {

        assert.match(
            api.EXPAND_LABEL,
            /解析/,
            '标题栏那个「解析」已经删了，按钮上再不带这两个字就看不出这是解析区'
        );
    });
});
