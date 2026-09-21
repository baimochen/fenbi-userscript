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
