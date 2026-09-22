// 「题目脱库」的测试：把当前这套练习拆成 .md + .json 两个文件。
//
// 这件事的数据来自两个地方，各占一半，所以两块都要盯着：
//
//   题干 / 选项        —— 只能从 DOM 读。接口那份里没有题干。
//   答案 / 解析 / 来源 / 考点 —— 只有接口缓存那份是全的。页面上只渲染
//                        已作答的题，没答过的题在 DOM 里根本没有这几块。
//
// 所以下面第一块拿真实的背题页存档（test/fixtures/questions.html）验 DOM
// 那一半，第二块往缓存里塞一份假响应验接口那一半，第三块验拼出来的文件。
//
// 为什么不拿正则看源码：「导出来的东西对不对」这件事，正则一个字都验不到
// —— 函数名都在、拼出来少一半字段，照样全绿。

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { loadModule, LAYOUT_SCRIPT } from './harness.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let layout;
let dom;
let doc;

const FIXTURE = join(
    dirname(fileURLToPath(import.meta.url)),
    'fixtures',
    'questions.html'
);

before(() => {
    layout = loadModule(LAYOUT_SCRIPT);

    dom = new JSDOM(readFileSync(FIXTURE, 'utf8'));
    doc = dom.window.document;
});

// 每个用例都从空缓存开始 —— 缓存是模块级的，上一个用例塞进去的东西会留到
// 下一个，而「缓存空的时候怎么办」本身就是一条要验的规则。
beforeEach(() => {
    layout.solutionCache.clear();
});

function questions() {
    return layout.collectQuestions(doc);
}

function byKey(key) {
    return questions().find(item => item.key === key);
}

// 一份像接口会返回的 solution 对象。字段名照抄脚本别处读的那几个。
function fakeSolution(overrides) {
    return Object.assign(
        {
            globalId: '3_32_f62k6',
            correctAnswer: 'B',
            solution: '<p>本题考查《学记》。</p><p>故正确答案为B。</p>',
            source: '2025年4月26日山东省青岛市直属学校教师招聘第56题',
            keypoints: [{ name: '教育学的萌芽阶段' }]
        },
        overrides || {}
    );
}


describe('题干和选项：从 DOM 读', () => {

    test('单选题的题型、序号、题干、选项都对得上', () => {

        const item = byKey('3_32_f62k6');

        assert.ok(item, '存档里那道单选题没被摘出来');

        assert.equal(item.index, '1.');
        assert.equal(item.type, '单选题');

        assert.match(item.stem, /藏息相辅/);

        assert.deepEqual(
            item.choices.map(choice => choice.label),
            ['A', 'B', 'C', 'D'],
            '选项的字母对不上 —— 答案那一栏是照着这些字母写的'
        );

        assert.match(item.choices[1].text, /课内与课外相结合/);
    });


    test('判断题的两个选项是「正确 / 错误」', () => {

        // 判断题没有 A/B/C/D，那两个选项的文字在 app-format-html 里而不是
        // p.input-text 里。选择器只认后者的话，判断题导出来就是一道没有
        // 选项的题。
        const item = byKey('3_32_iq3i1');

        assert.ok(item, '存档里那道判断题没被摘出来');

        assert.deepEqual(
            item.choices.map(choice => choice.text),
            ['正确', '错误'],
            '判断题的选项没读出来'
        );
    });


    test('填空题的题干把空填成 ____ —— 不然读出来是缺字的', () => {

        // 填空题的题干是被 <input readonly> 挖了空的，textContent 读不到
        // input，直接取会得到「有目的、、有组织」这种缺字的题干。
        const item = byKey('3_32_e6ivn');

        assert.ok(item, '存档里那道填空题没被摘出来');

        assert.match(
            item.stem,
            /有目的、____、有组织/,
            '填空题的空没填上，题干成了缺字的'
        );
    });


    test('多选题四个选项都在', () => {

        const item = byKey('3_32_i0nvt');

        assert.equal(item.choices.length, 4);
        assert.equal(item.type, '多选题');
    });


    test('整份存档一道不落', () => {

        // 存档里是 5 道：单选、多选、不定项、判断、填空各一。少一道就意味着
        // 某条选择器没盖住那种题型的结构。
        assert.equal(
            questions().length,
            5,
            '有题目被漏掉了 —— 某个题型的结构没被选择器盖住'
        );
    });
});


describe('答案和解析：从接口缓存读', () => {

    test('缓存里有，就用缓存那份', () => {

        layout.solutionCache.set('3_32_f62k6', fakeSolution());

        const item = byKey('3_32_f62k6');

        assert.equal(item.answer, 'B');
        assert.equal(item.source, '2025年4月26日山东省青岛市直属学校教师招聘第56题');
        assert.deepEqual(item.keypoints, ['教育学的萌芽阶段']);
        assert.match(item.solution, /本题考查《学记》/);
    });


    test('缓存没命中就退回 DOM —— 答案是，解析也是', () => {

        // resolveQuestionData 本身就是「缓存优先、DOM 兜底」。所以没有缓存
        // 不等于导不出来，只等于导得没那么全 —— 存档里 5 道题只有 2 道在
        // DOM 里带着解析，没答过的那几道是空的。
        const item = byKey('3_32_f62k6');

        assert.equal(item.answer, 'B', '缓存没命中时没去读页面上那一格');
        assert.match(
            item.solution,
            /本题考查《学记》/,
            '缓存没命中时没去读页面上那段解析'
        );
    });


    test('没答过的题，DOM 里那两块本来就没有', () => {

        // 这正是不许在缓存空的时候导出的原因：这种题导出来只有题干，
        // 而文件本身完全看不出少了什么。
        const item = byKey('3_32_i0nvt');

        assert.equal(item.answer, '');
        assert.equal(item.solution, '');
    });


    test('接口原样那份留着 —— 翻译会丢东西', () => {

        const raw = fakeSolution({ somethingWeDoNotRead: [1, 2, 3] });

        layout.solutionCache.set('3_32_f62k6', raw);

        assert.equal(
            byKey('3_32_f62k6').api.somethingWeDoNotRead.join(','),
            '1,2,3',
            '接口原样那份没留下来，以后想做别的处理就得再爬一遍接口'
        );
    });


    test('缓存没命中时是 null，不是 undefined', () => {

        // JSON.stringify 会把 undefined 的键整个丢掉，于是导出的文件里
        // 连「这儿本来有个东西没拿到」都看不出来。
        const item = byKey('3_32_i0nvt');

        assert.equal(item.api, null);

        const dumped = JSON.parse(
            layout.formatExportJson([item], { title: 't', url: '', time: '' })
        );

        assert.ok(
            'api' in dumped.questions[0],
            'api 这个键在 JSON 里整个消失了 —— 值用了 undefined'
        );
    });
});


describe('答案的几种形状', () => {

    const ti = null;

    test('字符串直接用', () => {

        assert.equal(layout.readAnswer({ correctAnswer: 'B' }, ti), 'B');
        assert.equal(layout.readAnswer({ correctAnswer: '有计划' }, ti), '有计划');
    });

    test('数组拼起来 —— 多选和不定项', () => {

        assert.equal(
            layout.readAnswer({ correctAnswer: ['A', 'C', 'D'] }, ti),
            'ACD'
        );
    });

    test('数组里是对象也认', () => {

        // 具体形状没验过（脚本别处没读过这个字段），所以按几种常见的键
        // 各兜一下。猜错了最多是这一行不好看，不会把整份导出带崩。
        assert.equal(
            layout.readAnswer({ correctAnswer: [{ content: 'A' }, { content: 'B' }] }, ti),
            'AB'
        );
    });

    test('没有这个字段就返回空串，不返回 undefined', () => {

        for (const raw of [null, {}, { correctAnswer: null }]) {
            assert.equal(layout.readAnswer(raw, ti), '');
        }
    });
});


describe('解析的 HTML 转纯文本', () => {

    test('段落之间留空行', () => {

        assert.equal(
            layout.htmlToText('<p>第一段</p><p>第二段</p>'),
            '第一段\n\n第二段'
        );
    });

    test('行内标签脱掉，文字留着', () => {

        assert.equal(
            layout.htmlToText('<p>故<strong>正确答案</strong>为B。</p>'),
            '故正确答案为B。'
        );
    });

    test('<br> 换成换行', () => {

        assert.equal(layout.htmlToText('甲<br>乙'), '甲\n乙');
    });

    test('实体解开，而且 &amp; 是最后解的', () => {

        // 顺序错了的话「&amp;lt;」会被解成「<」—— 那是原文里的四个字符
        // 「&lt;」，不是原文里的「<」。
        assert.equal(layout.htmlToText('&amp;lt;'), '&lt;');
        assert.equal(layout.htmlToText('&lt;'), '<');
        assert.equal(layout.htmlToText('A&nbsp;&amp;&nbsp;B'), 'A & B');
    });

    test('空的和 null 都给空串', () => {

        for (const value of [null, undefined, '']) {
            assert.equal(layout.htmlToText(value), '');
        }
    });
});


describe('拼出来的两个文件', () => {

    const meta = {
        title: '专项智能练习（教育与教育学）-背题',
        url: 'https://spa.fenbi.com/ti/memorize/practice',
        time: '2026-09-22 20:30'
    };

    function oneQuestion() {

        layout.solutionCache.set('3_32_f62k6', fakeSolution());

        return [byKey('3_32_f62k6')];
    }


    test('Markdown 里有题干、选项、答案、来源、考点、解析', () => {

        const text = layout.formatExportMarkdown(oneQuestion(), meta);

        for (const piece of [
            '# 专项智能练习（教育与教育学）-背题',
            '- 导出时间：2026-09-22 20:30',
            '- 共 1 题',
            '## 1. 单选题',
            '藏息相辅',
            '- **A** 强调教与学相辅相成',
            '- **B** 强调课内与课外相结合',
            '**正确答案：** B',
            '**来源：** 2025年4月26日',
            '**考点：** 教育学的萌芽阶段',
            '**解析：**',
            '本题考查《学记》'
        ]) {
            assert.ok(
                text.includes(piece),
                'Markdown 里少了这一段：' + piece
            );
        }
    });


    test('Markdown 里不能有 HTML 标签漏出来', () => {

        // 解析正文是接口给的 HTML。忘了转的话，导出的文件里会明晃晃地
        // 带着 <p> 标签。
        const text = layout.formatExportMarkdown(oneQuestion(), meta);

        assert.doesNotMatch(text, /<\/?p>/);
    });


    test('JSON 是能解析的，字段和道数都对', () => {

        const text = layout.formatExportJson(oneQuestion(), meta);
        const data = JSON.parse(text);

        assert.equal(data.title, meta.title);
        assert.equal(data.url, meta.url);
        assert.equal(data.exportedAt, meta.time);
        assert.equal(data.count, 1);
        assert.equal(data.questions[0].key, '3_32_f62k6');
        assert.equal(data.questions[0].answer, 'B');
    });


    test('答案和解析都没有的题，那两行整个不出现，不留空标题', () => {

        // 留一个「**解析：**」后面什么都不跟，读起来像解析丢了；实际上是
        // 这道题本来就没有。
        const bare = Object.assign(
            {},
            byKey('3_32_i0nvt'),
            { answer: '', solution: '', source: '', keypoints: [] }
        );

        const text = layout.formatExportMarkdown([bare], meta);

        assert.doesNotMatch(text, /\*\*解析/);
        assert.doesNotMatch(text, /\*\*正确答案/);
    });
});


describe('文件名', () => {

    function at(y, m, d, h, min) {
        return new Date(y, m - 1, d, h, min);
    }


    test('页面标题加时间戳', () => {

        assert.equal(
            layout.exportFilename('专项智能练习（教育与教育学）-背题', at(2026, 9, 22, 20, 5)),
            '专项智能练习（教育与教育学）-背题_20260922-2005'
        );
    });


    test('非法字符全压掉 —— 来源里那种日期时间最要命', () => {

        // 冒号在 Windows 上是非法字符。题目来源恰好就爱写
        // 「2025年4月26日 10:30」这种东西，而标题是用户自己填的。
        const name = layout.exportFilename('2025/4/26 10:30 真题', at(2026, 1, 2, 3, 4));

        assert.doesNotMatch(name, /[\\/:*?"<>|]/);
        assert.doesNotMatch(name, /\s/);
    });


    test('标题空着也给个能用的名字', () => {

        for (const title of ['', '   ', null, undefined]) {
            assert.match(
                layout.exportFilename(title, at(2026, 9, 22, 20, 5)),
                /^粉笔练习_20260922-2005$/
            );
        }
    });


    test('标题太长就截断，别把文件名撑爆', () => {

        const name = layout.exportFilename('题'.repeat(300), at(2026, 9, 22, 20, 5));

        assert.ok(name.length < 100, '文件名长到了 ' + name.length + ' 个字符');
    });
});


describe('缓存空的时候不装作成功', () => {

    // 这一块验的是「什么时候不导出」。导出本身要动 Blob / a.click，
    // Node 里起不来，所以盯着那个判断本身 —— 它要是没了，用户会在页面
    // 刚打开的时候拿到一份只有题干、没有答案也没有解析的空壳，而文件
    // 本身完全看不出来。
    const start = '    function exportPractice() {';
    const end = '\n    // =========================================================\n    // MutationObserver';

    function body() {

        const i = readFileSync(LAYOUT_SCRIPT, 'utf8').indexOf(start);

        assert.ok(i >= 0, '源码里找不到 exportPractice');

        return readFileSync(LAYOUT_SCRIPT, 'utf8').slice(i, readFileSync(LAYOUT_SCRIPT, 'utf8').indexOf(end, i));
    }


    test('缓存空就停下来说一声，不往下走', () => {

        const text = body();

        assert.match(
            text,
            /if \(!solutionCache\.size\)/,
            '没拦缓存为空的情况 —— 会导出一份没有解析的空壳'
        );

        assert.match(text, /showToast\(/);
    });


    test('一道题都没有也停下', () => {

        assert.match(
            body(),
            /if \(!questions\.length\)/,
            '页面上没题目的时候还在往下走'
        );
    });
});
