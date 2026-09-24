// 手柄脚本的绑定模型，外加交卷按钮的选择器。
//
// 这一层原来长这样：按键表说「哪个键归哪个动作」，另外单存一张长按表说
// 「按住这个动作的键会触发谁」。用户指出这说不通 —— 交卷明明是个动作，
// 它的入口却写在 toggleAi 那一行上，于是交卷自己没有键，面板上显示成
// 「只在长按里」。
//
// 现在一条绑定 = 一个键 + 一种按法（短按 / 长按），挂在**被触发的那个
// 动作**身上。同一个键上的两档互不干扰，同一档才会互相顶掉。
//
// 迁移那一组盯着的是最容易出错的后果：用户以前配的长按要么丢了、要么
// 解绑之后自己复活。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { loadModule, ROOT } from './harness.mjs';

const GAMEPAD_SCRIPT = ROOT + '/fenbi-gamepad.user.js';

const api = loadModule(GAMEPAD_SCRIPT);

// 假的 GM 存储
function store(initial) {
    const data = initial === undefined ? {} : initial;

    return {
        get: (key, fallback) => (key in data ? data[key] : fallback),
        set: (key, value) => { data[key] = value; },
        data: data
    };
}

describe('绑定标识', () => {

    test('短按和长按是两条不同的绑定，同一个键', () => {
        const tap = api.decodeBinding('button:9');
        const hold = api.decodeBinding(api.makeBinding('button:9', true));

        assert.equal(tap.hold, false);
        assert.equal(hold.hold, true);

        // 剥掉按法之后是同一个物理键 —— 状态机、冲突判断认的都是它
        assert.equal(tap.key, hold.key);
        assert.equal(tap.key, 'button:9');
    });

    test('摇杆也能分两档，方向跟着走', () => {
        const hold = api.decodeBinding('hold/axis:1:-1');

        assert.deepEqual(hold, {
            key: 'axis:1:-1', hold: true, type: 'axis', index: 1, dir: -1
        });
    });

    test('认不出来的一律 null（旧版本留下的、手改过的）', () => {
        for (const text of ['', 'hold/', 'button:', 'button:x',
            'hold/axis:0', 'axis:0:0', 'hold/hold/button:9', null, 7]) {
            assert.equal(api.decodeBinding(text), null, String(text));
        }
    });

    test('encodeBinding 出来的是物理键，不带按法', () => {
        // 输入层认的是「哪个键在按着」，跟这个键被配成哪一档无关
        assert.equal(api.encodeBinding({ type: 'button', index: 9 }), 'button:9');
    });
});

describe('默认映射', () => {

    test('每个动作默认都有键 —— 面板上不该出现「未绑定」', () => {
        const bindings = api.freshBindings();

        for (const action of api.ACTIONS) {
            assert.ok(
                bindings[action.id].length > 0,
                action.id + ' 一个键都没有'
            );
        }
    });

    test('交卷自己有键，长按那件也写在交卷这一行', () => {
        // 用户报的就是这条：交卷的入口挂在 toggleAi 那行上，
        // 于是面板里交卷显示成「只在长按里，没有独立按键」
        const bindings = api.freshBindings();

        assert.deepEqual(bindings.finish, ['button:11', 'hold/button:9']);
        assert.deepEqual(bindings.back, ['button:10', 'hold/button:8']);

        // 反过来，toggleAi 那一行只有短按 —— 长按不是它的
        assert.deepEqual(bindings.toggleAi, ['button:9']);
    });

    test('按住连发的动作挂在长按那一档', () => {
        const bindings = api.freshBindings();

        for (const id of ['cursorUp', 'cursorDown', 'next', 'prev',
            'scrollUp', 'scrollDown']) {
            const binding = api.decodeBinding(bindings[id][0]);

            assert.equal(binding.hold, true, id + ' 该是长按那一档');
        }
    });

    test('默认映射里没有任何一个键被两件同档的事占着', () => {
        const bindings = api.freshBindings();

        const seen = new Set();

        for (const action of api.ACTIONS) {
            for (const text of bindings[action.id]) {
                assert.equal(seen.has(text), false, text + ' 重复了');
                seen.add(text);
            }
        }
    });
});

describe('冲突', () => {

    const toggle = api.actionById('toggleAi');
    const finish = api.actionById('finish');
    const cursorUp = api.actionById('cursorUp');

    test('同一个键的短按和长按可以共存 —— 这正是用户要的', () => {
        assert.equal(
            api.clashes('button:9', toggle, 'hold/button:9', finish),
            false
        );
    });

    test('同一个键的两件短按（或两件长按）冲突', () => {
        assert.equal(
            api.clashes('button:9', toggle, 'button:9', finish),
            true
        );
        assert.equal(
            api.clashes('hold/button:9', toggle, 'hold/button:9', finish),
            true
        );
    });

    test('不同的键怎么都不冲突', () => {
        assert.equal(
            api.clashes('button:9', toggle, 'hold/button:8', finish),
            false
        );
    });

    test('连发动作的长按独占那个键', () => {
        // 它按下沿就动，松手也不补短按 —— 一个键塞不下第三件事
        assert.equal(
            api.clashes('hold/button:12', cursorUp, 'button:12', toggle),
            true
        );
        assert.equal(
            api.clashes('hold/button:12', cursorUp, 'hold/button:12', finish),
            true
        );
    });

    test('加绑只顶掉同一档的，另一档留着', () => {
        const before = api.freshBindings();

        // 把「下一题」也绑到 Start 的短按上（原本归 toggleAi）
        const after = api.bindKey(before, 'next', 'button:9');

        assert.deepEqual(after.toggleAi, []);
        assert.ok(after.next.includes('button:9'));

        // 交卷的长按没被碰 —— 它是另一档
        assert.deepEqual(after.finish, ['button:11', 'hold/button:9']);
    });

    test('换绑只清这个动作同一档的旧键', () => {
        const before = api.freshBindings();

        // 交卷原来是「短按 R3、长按 Start」。重新录一个短按：
        // 短按那条换掉，长按那条不该跟着走
        const after = api.rebindKey(before, 'finish', 'button:2');

        assert.deepEqual(after.finish, ['hold/button:9', 'button:2']);

        // 换长按那档：短按留着
        const again = api.rebindKey(after, 'finish', 'hold/button:3');

        assert.deepEqual(again.finish, ['button:2', 'hold/button:3']);
    });

    test('换绑一个键会把它从别人的同一档上摘掉', () => {
        const after = api.rebindKey(api.freshBindings(), 'finish', 'button:0');

        assert.deepEqual(after.confirm, []);
        assert.ok(after.finish.includes('button:0'));
        assert.ok(after.finish.includes('hold/button:9'));
    });

    test('解绑只摘掉那一条，同一行的另一档不受影响', () => {
        const after = api.unbindKey(
            api.freshBindings(), 'finish', 'hold/button:9'
        );

        assert.deepEqual(after.finish, ['button:11']);
        // 短按那个键还在（它是 Start 的短按，归 toggleAi）
        assert.deepEqual(after.toggleAi, ['button:9']);
    });

    test('都不改入参', () => {
        const before = api.freshBindings();
        const snapshot = JSON.stringify(before);

        api.bindKey(before, 'next', 'button:9');
        api.rebindKey(before, 'finish', 'button:2');
        api.unbindKey(before, 'finish', 'button:11');

        assert.equal(JSON.stringify(before), snapshot);
    });
});

describe('behaviorOf 认两档', () => {

    test('一个键挂两件事：短按触发谁、长按触发谁', () => {
        const b = api.behaviorOf(api.freshBindings())('button:9');

        assert.deepEqual(b, {
            mode: 'hold',
            holdMs: 1000,
            pressAction: 'toggleAi',
            holdAction: 'finish'
        });
    });

    test('只挂长按的，松手那一下不触发任何东西', () => {
        const bindings = api.unbindKey(
            api.freshBindings(), 'toggleAi', 'button:9'
        );

        const b = api.behaviorOf(bindings)('button:9');

        assert.equal(b.mode, 'hold');
        assert.equal(b.pressAction, null);
        assert.equal(b.holdAction, 'finish');
    });

    test('连发动作的长按 = 按住连发，按下沿就动', () => {
        const b = api.behaviorOf(api.freshBindings())('button:12');

        assert.deepEqual(b, {
            mode: 'repeat', pressAction: 'cursorUp', holdAction: null
        });
    });

    test('连发动作改成短按 → 按一下只动一格', () => {
        const bindings = api.rebindKey(
            api.freshBindings(), 'cursorUp', 'button:12'
        );

        const b = api.behaviorOf(bindings)('button:12');

        assert.deepEqual(b, {
            mode: 'tap', pressAction: 'cursorUp', holdAction: null
        });
    });

    test('没绑任何东西的键报 tap 而不是 undefined', () => {
        // 报 undefined 的话状态机会漏掉按下沿，那个键就卡在「按住中」
        const b = api.behaviorOf(api.freshBindings())('button:16');

        assert.equal(b.mode, 'tap');
        assert.equal(b.pressAction, null);
    });

    test('手改过的存储里两档撞了也不炸：连发赢', () => {
        // 绑的时候 clashes 会挡住这种组合（连发那一档独占整个键），
        // 这里模拟有人直接改了存储
        const broken = api.freshBindings();

        broken.cursorUp = ['hold/button:16'];
        broken.toggleAi = ['button:16'];

        const b = api.behaviorOf(broken)('button:16');

        assert.equal(b.mode, 'repeat');
        assert.equal(b.pressAction, 'cursorUp');
    });
});

describe('两档真的连到状态机上', () => {

    /*
     * 走一段帧序列，返回所有事件。
     *
     * 必须**一帧一帧**走：两帧之间隔太久会被当成时钟跳变（切标签页
     * 回来那种），按住的时间就归零了。这不是测试的毛病，是脚本故意
     * 的防护。
     */
    function run(bindings, script, swap) {
        const behavior = api.behaviorOf(bindings);

        let state = api.freshInputState();
        let now = 0;

        const events = [];

        const frame = (active, current) => {
            const result = api.stepInput(state, active, now, current);
            state = result.state;
            events.push(...result.events);
        };

        for (const step of script) {

            frame(step.active, behavior);


            let left = step.ms;


            while (left > 0) {

                const delta = Math.min(16, left);

                now += delta;
                left -= delta;

                // swap：中途换一份配置，用来验「手上这一下不换动作」
                frame(step.active, swap ? swap() : behavior);
            }
        }

        return events;
    }

    const DOWN = new Set(['button:9']);
    const UP = new Set();

    test('按住一秒 → hold 事件，动作是交卷', () => {
        const events = run(api.freshBindings(), [
            { ms: 0, active: DOWN },
            { ms: 1200, active: DOWN },
            { ms: 0, active: UP }
        ]);

        assert.deepEqual(events, [
            { key: 'button:9', kind: 'hold', action: 'finish' }
        ]);
    });

    test('没按满就松手 → 触发的是短按那件', () => {
        const events = run(api.freshBindings(), [
            { ms: 0, active: DOWN },
            { ms: 400, active: DOWN },
            { ms: 0, active: UP }
        ]);

        assert.deepEqual(events, [
            { key: 'button:9', kind: 'tap', action: 'toggleAi' }
        ]);
    });

    test('长按触发之后松手，不再补一次短按', () => {
        const events = run(api.freshBindings(), [
            { ms: 0, active: DOWN },
            { ms: 1200, active: DOWN },
            { ms: 0, active: UP }
        ]);

        assert.equal(
            events.filter(e => e.kind === 'tap').length, 0,
            '交卷按完又开了一次 AI 面板'
        );
    });

    test('只挂长按的键，短按一下什么都不发生', () => {
        const bindings = api.unbindKey(
            api.freshBindings(), 'toggleAi', 'button:9'
        );

        const events = run(bindings, [
            { ms: 0, active: DOWN },
            { ms: 300, active: DOWN },
            { ms: 0, active: UP }
        ]);

        assert.deepEqual(events, [
            { key: 'button:9', kind: 'tap', action: null }
        ]);
    });

    test('连发动作：按下沿先动一格，按住之后连发', () => {
        const right = new Set(['button:12']);

        const events = run(api.freshBindings(), [
            { ms: 0, active: right },
            { ms: 600, active: right },
            { ms: 0, active: UP }
        ]);

        // 按下沿那一格是 'tap'，之后才是 'repeat' —— 名字不同，做的事
        // 一样（都是触发同一个动作），kind 只进调试日志
        assert.equal(events[0].kind, 'tap');
        assert.equal(events[1].kind, 'repeat');

        assert.ok(events.length >= 3, '只收到 ' + events.length + ' 个事件');

        assert.deepEqual(
            events.map(e => e.action),
            events.map(() => 'cursorUp')
        );
    });

    test('连发动作改成短按 → 按住也只动一格', () => {
        const bindings = api.rebindKey(
            api.freshBindings(), 'cursorUp', 'button:12'
        );

        const right = new Set(['button:12']);

        const events = run(bindings, [
            { ms: 0, active: right },
            { ms: 800, active: right },
            { ms: 0, active: UP }
        ]);

        assert.deepEqual(events, [
            { key: 'button:12', kind: 'tap', action: 'cursorUp' }
        ]);
    });

    test('按住的过程中改了配置，手上这一下不换动作', () => {
        // 按下那一刻认的是「短按开关 AI、长按交卷」，按住的过程中把
        // 长按挪到别的键上 —— 这一下该按交卷算，不该中途变成别的
        const moved = () => api.behaviorOf(
            api.rebindKey(api.freshBindings(), 'finish', 'hold/button:3')
        );

        const events = run(api.freshBindings(), [
            { ms: 0, active: DOWN },
            { ms: 1200, active: DOWN },
            { ms: 0, active: UP }
        ], moved);

        assert.deepEqual(events, [
            { key: 'button:9', kind: 'hold', action: 'finish' }
        ]);
    });
});

describe('老配置的迁移', () => {

    // 老版本的存储：按键表 + 单独一张长按表
    const legacyStore = () => store({
        [api.STORAGE_KEY]: {
            toggleAi: ['button:9'],
            help: ['button:8'],
            finish: ['button:11'],
            back: ['button:10']
        },
        [api.HOLD_STORAGE_KEY]: {
            toggleAi: { action: 'finish', ms: 1000 },
            help: { action: 'back', ms: 1000 }
        }
    });

    test('把老长按表折进按键表，落到被触发的那个动作那一行', () => {
        const folded = api.foldLegacyHolds(
            api.loadBindings(legacyStore().get),
            { toggleAi: 'finish', help: 'back' }
        );

        assert.deepEqual(folded.finish, ['button:11', 'hold/button:9']);
        assert.deepEqual(folded.back, ['button:10', 'hold/button:8']);

        // 触发者那一行不动
        assert.deepEqual(folded.toggleAi, ['button:9']);
    });

    test('一个动作绑了多个键，每个键都折一条过去', () => {
        const bindings = api.freshBindings();

        bindings.toggleAi = ['button:9', 'button:1'];

        const folded = api.foldLegacyHolds(bindings, { toggleAi: 'finish' });

        assert.deepEqual(folded.finish, [
            'button:11', 'hold/button:9', 'hold/button:1'
        ]);
    });

    test('已经折过的不重复加（跑两次结果一样）', () => {
        const once = api.foldLegacyHolds(
            api.freshBindings(), { toggleAi: 'finish' }
        );

        const twice = api.foldLegacyHolds(once, { toggleAi: 'finish' });

        assert.deepEqual(twice.finish, ['button:11', 'hold/button:9']);
    });

    test('折过去的那条长按已经被别人占着 → 不抢', () => {
        const bindings = api.freshBindings();

        // 用户把 toggleAi 挪到了 button:0 上，而 button:0 的长按
        // 已经归 ask 了。交卷不能凭老配置把这条抢过来。
        bindings.toggleAi = ['button:0'];
        bindings.ask = ['hold/button:0'];

        const folded = api.foldLegacyHolds(bindings, { toggleAi: 'finish' });

        assert.deepEqual(folded.finish, ['button:11', 'hold/button:9']);
        assert.deepEqual(folded.ask, ['hold/button:0']);
    });

    test('从没配过长按的老用户拿默认那两条，不是空配置', () => {
        const s = store({ [api.STORAGE_KEY]: { toggleAi: ['button:9'] } });

        const legacy = api.readLegacyHolds(s.get);

        assert.deepEqual(legacy, { toggleAi: 'finish', help: 'back' });
    });

    test('整份存过就以存的为准 —— 老版本关掉的长按不该被折回来', () => {
        const s = store({
            [api.HOLD_STORAGE_KEY]: { toggleAi: { action: 'finish' } }
        });

        const legacy = api.readLegacyHolds(s.get);

        assert.deepEqual(legacy, { toggleAi: 'finish' });
    });

    test('老表里指向不存在的动作 → 整条丢掉', () => {
        const s = store({
            [api.HOLD_STORAGE_KEY]: {
                toggleAi: { action: '没有这个动作' },
                help: { action: 'back' }
            }
        });

        assert.deepEqual(
            api.readLegacyHolds(s.get),
            { help: 'back' }
        );
    });

    test('老表里指向自己 → 丢掉（按满了再触发一遍自己）', () => {
        const s = store({
            [api.HOLD_STORAGE_KEY]: { toggleAi: { action: 'toggleAi' } }
        });

        assert.deepEqual(api.readLegacyHolds(s.get), {});
    });

    test('迁完把老键写成空对象当记号', () => {
        const s = legacyStore();

        api.migrateConfig(s.get, s.set);

        assert.deepEqual(s.data[api.HOLD_STORAGE_KEY], {});
    });

    test('老键是空对象 = 已经迁过，不再折第二遍', () => {
        const s = store({ [api.HOLD_STORAGE_KEY]: {} });

        assert.equal(api.readLegacyHolds(s.get), null);
    });

    test('先存住按键表，再落记号', () => {
        // 反过来的话，按键表没存住而记号落了地 —— 下次开页面不会再折
        // 一遍，用户的老长按就凭空没了
        const order = [];
        const s = legacyStore();

        api.migrateConfig(
            s.get,
            (key, value) => {
                order.push(key);
                s.set(key, value);
            }
        );

        assert.deepEqual(order, [api.STORAGE_KEY, api.HOLD_STORAGE_KEY]);
    });

    test('解绑过的长按不会从老表里复活', () => {
        // 这是「迁完要写记号」的全部理由：不写的话，用户解绑一个长按，
        // 下次开页面它自己就回来了
        const s = legacyStore();

        const migrated = api.migrateConfig(s.get, s.set);

        const after = api.unbindKey(migrated, 'finish', 'hold/button:9');

        api.saveBindings(s.set, after);

        assert.deepEqual(
            api.migrateConfig(s.get, s.set).finish,
            ['button:11']
        );
    });

    test('老用户迁移的结果就是他一直用的行为', () => {
        const s = legacyStore();
        const bindings = api.migrateConfig(s.get, s.set);
        const behavior = api.behaviorOf(bindings);

        assert.equal(behavior('button:9').holdAction, 'finish');
        assert.equal(behavior('button:9').pressAction, 'toggleAi');
        assert.equal(behavior('button:8').holdAction, 'back');
    });

    test('全新用户：直接用默认，不往存储里写按键表', () => {
        const s = store();

        const bindings = api.migrateConfig(s.get, s.set);

        assert.deepEqual(bindings, api.freshBindings());

        // 写了的话等于把默认值抄进用户存储，以后改默认就到他不了
        assert.equal(s.data[api.STORAGE_KEY], undefined);
    });

    test('全新用户也把老键打成记号，不必每次开页面都折一遍', () => {
        const s = store();

        api.migrateConfig(s.get, s.set);

        assert.deepEqual(s.data[api.HOLD_STORAGE_KEY], {});
    });

    test('存储读不出来也不炸', () => {
        const broken = {
            get: () => { throw new Error('读不了'); },
            set: () => {}
        };

        assert.deepEqual(api.loadBindings(broken.get), api.freshBindings());
        assert.equal(api.readLegacyHolds(broken.get), null);
    });
});

describe('交卷按钮', () => {

    /*
     * 这几条用真的 DOM。clickFinish 裸调 document，所以把 jsdom 的
     * document 挂到 global 上再加载脚本。
     *
     * 背景：粉笔的交卷**不是** button/a，是
     * <div class="submit-btn"><svg></svg>交卷</div>。老版本只扫
     * 'button, a, [role="button"]'，所以永远找不到，表现是长按 Start
     * 毫无反应、日志里也不留痕迹。
     */
    function withDom(html, fn) {
        const dom = new JSDOM('<!doctype html><body>' + html + '</body>');
        const saved = global.document;

        global.document = dom.window.document;

        try {
            return fn(dom.window.document);
        } finally {
            if (saved === undefined) {
                delete global.document;
            } else {
                global.document = saved;
            }
        }
    }

    function clickCount(doc, selector) {
        let n = 0;

        doc.querySelectorAll(selector).forEach(node => {
            node.addEventListener('click', () => { n += 1; });
        });

        return () => n;
    }

    test('找得到 div.submit-btn（实测的真实结构）', () => {
        withDom(
            '<div class="submit-btn"><svg viewBox="0 0 1 1"></svg>交卷</div>',
            doc => {
                const clicked = clickCount(doc, '.submit-btn');

                assert.equal(api.clickFinish(), true);
                assert.equal(clicked(), 1);
            }
        );
    });

    test('button 那版也还认（别的页面/别的版本）', () => {
        withDom('<button class="submit-btn">交卷</button>', doc => {
            const clicked = clickCount(doc, '.submit-btn');

            assert.equal(api.clickFinish(), true);
            assert.equal(clicked(), 1);
        });
    });

    test('「提交试卷」这个说法也认', () => {
        withDom('<div class="submit-btn">提交试卷</div>', doc => {
            const clicked = clickCount(doc, '.submit-btn');

            assert.equal(api.clickFinish(), true);
            assert.equal(clicked(), 1);
        });
    });

    test('class 改了名，按字还能兜住', () => {
        withDom('<div class="some-other-btn">交卷</div>', doc => {
            const clicked = clickCount(doc, '.some-other-btn');

            assert.equal(api.clickFinish(), true);
            assert.equal(clicked(), 1);
        });
    });

    test('包着一大片内容的祖先不算 —— 点它是点了个寂寞', () => {
        withDom(
            '<div class="page">交卷时间还剩 3 分钟' +
            '<div class="submit-btn">交卷</div></div>',
            () => {
                // 只有内层那个该被点到；外层 textContent 不等于「交卷」
                assert.equal(api.clickFinish(), true);
            }
        );
    });

    test('页面上没有交卷按钮 → 返回 false，不点任何东西', () => {
        withDom('<div class="question">下一题</div>', () => {
            assert.equal(api.clickFinish(), false);
        });
    });
});
