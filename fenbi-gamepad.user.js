// ==UserScript==
// @name         粉笔背题页手柄操作
// @namespace    https://github.com/baimochen/fenbi-userscript
// @version      0.1
// @description  用手柄刷粉笔背题页：选选项、翻题、滚动、看解析、跳题、交卷、回退、开关 AI 面板。按键和长按都可以自己配
// @author       baimochen
// @match        *://*.fenbi.com/ti/memorize/*
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// ==/UserScript==

(function () {
    'use strict';


    const VERSION = '0.1';


    // =========================================================
    // 动作表
    //
    // behavior 说的是「这个动作被触发之后走哪种节奏」：
    //
    //   'tap'    —— 触发一次。默认。
    //   'repeat' —— 触发一次，按住 400ms 后每 80ms 连发。
    //               只有翻题和滚动用它 —— 这两个明确要连发。
    //
    // 这跟「短按还是长按」是**两件事**。短按/长按说的是「这个键怎么
    // 按」，是绑定自己的属性（见下面的默认映射）；behavior 说的是
    // 「动作被触发之后怎么走」。两者叠起来：
    //
    //   短按 + repeat 动作 = 按一下动一格，不连发
    //   长按 + repeat 动作 = 按住连发（这一档按下沿就动，不等阈值）
    //   长按 + 其他动作    = 按住满 1 秒才触发（防误触就靠它）
    //
    // 数组顺序就是设置面板里的显示顺序。
    // =========================================================

    const ACTIONS = [

        // 选项是靠「移光标 + 确认」选的，不是四个键直选。
        //
        // 直选撑不住五六个选项的题 —— 而那种题是有的。移光标对几个
        // 选项都一样，多选题也顺：移到哪个就按哪个，按几下勾几个。
        { id: 'cursorUp',   name: '选项上移',      behavior: 'repeat' },
        { id: 'cursorDown', name: '选项下移',      behavior: 'repeat' },
        { id: 'confirm',    name: '确认（选中）',   behavior: 'tap' },
        { id: 'submit',     name: '提交（多选）',   behavior: 'tap' },

        { id: 'next',       name: '下一题',        behavior: 'repeat' },
        { id: 'prev',       name: '上一题',        behavior: 'repeat' },
        { id: 'scrollUp',   name: '上滚',          behavior: 'repeat' },
        { id: 'scrollDown', name: '下滚',          behavior: 'repeat' },

        { id: 'expand',     name: '展开/收起解析',  behavior: 'tap' },
        { id: 'ask',        name: '询问 AI',        behavior: 'tap' },
        { id: 'jump',       name: '跳题',          behavior: 'tap' },

        // Start 一键两用：短按开关 AI 面板，按住 1 秒交卷。这层关系写在
        // 默认映射里（finish 那行挂了一条 hold/button:9），不是写死的。
        { id: 'toggleAi', name: '开关 AI 面板', behavior: 'tap' },
        { id: 'finish',     name: '交卷（不可逆）', behavior: 'tap' },

        // Back 同理：短按查设置（躺着忘了哪个键干什么，短按就该出来），
        // 按住 1 秒回退网页 —— 回退会丢掉这套练习的进度，藏进长按里。
        { id: 'help', name: '设置/帮助', behavior: 'tap' },
        { id: 'back',       name: '回退网页',     behavior: 'tap' },
    ];

    const ACTION_IDS = new Set(ACTIONS.map(action => action.id));


    // =========================================================
    // 默认映射
    //
    // 用**标准映射的索引**，不用 A/B/X/Y 那些名字：索引 0 是「下面那个
    // 键」，Xbox 上叫 A、PS 上叫 ×、Switch 上叫 B —— 顺着手柄叫名字，
    // 换个手柄就全反了。这正是按键要能自己映射的原因。
    //
    //   0~3   四个面键      12~15  十字键 上/下/左/右
    //   4/5   肩键 LB/RB     8      Back
    //   6/7   扳机 LT/RT     9      Start
    //   轴 0/1 左摇杆 X/Y
    //
    // 一条绑定就是一个「键 + 按法」。键就是上面那些标识，按法分两档：
    //
    //   'button:9'        短按 Start
    //   'hold/button:9'   按住 Start 一秒
    //
    // 两档都挂在**被触发的那个动作**身上，所以「Start 长按交卷」写在
    // finish 那行，不在 toggleAi 那行。一个键上的两档互不干扰，同一个
    // 键的两条短按（或两条长按）才会互相顶掉。
    // =========================================================

    const DEFAULT_BINDINGS = {
        // 十字键上下用来移选项光标，所以滚动只剩左摇杆。
        // 摇杆滚起来其实更顺手，而且能无级变速。
        //
        // 这几个动作要按住连发，所以是长按那一档 —— 但它们按下沿就
        // 动一格，手感上跟短按没差别（见动作表上面的说明）。
        cursorUp:   ['hold/button:12'],
        cursorDown: ['hold/button:13'],
        confirm:    ['button:0'],
        submit:     ['button:6'],

        next:       ['hold/button:15'],
        prev:       ['hold/button:14'],
        scrollUp:   ['hold/axis:1:-1'],
        scrollDown: ['hold/axis:1:1'],

        expand:     ['button:4'],
        ask:        ['button:7'],
        jump:       ['button:5'],

        // Start 两档：短按开关 AI 面板，按住一秒交卷。
        // 交卷自己那个键在「把右摇杆按下去」上（11 = R3），故意不放面键：
        // 面键就在大拇指底下，聊天时随手一按就把卷交了，而交卷不可逆。
        // 摇杆下压要刻意使劲，误触不了。
        toggleAi:   ['button:9'],
        finish:     ['button:11', 'hold/button:9'],

        // Back 两档：短按查设置，按住一秒回退网页。回退同理，自己的键
        // 在 L3（10）上。
        help:       ['button:8'],
        back:       ['button:10', 'hold/button:8'],
    };


    // =========================================================
    // 绑定标识
    //
    // 存成字符串而不是对象：GM 存储走 JSON，字符串比较、去重、写进
    // DOM 属性、打进日志都省事。
    //
    // 一条绑定 = 一个键 + 一种按法。按法就靠前缀分：没有前缀是短按，
    // hold/ 开头是长按。前缀几乎不占地方，也让「同一个键的两档」在
    // 字符串层面就是两个不同的人，去重、比较全都自动对。
    // =========================================================

    const HOLD_PREFIX = 'hold/';

    // 按住多久算长按。1 秒是调过的手感值。
    const HOLD_MS = 1000;


    /*
     * 物理键 → 标识。**不带按法**：输入层认的是「哪个键在按着」，
     * 跟这个键被配成了短按还是长按无关。
     */
    function encodeBinding(binding) {

        if (!binding || typeof binding.index !== 'number') {
            return '';
        }


        if (binding.type === 'button') {
            return 'button:' + binding.index;
        }


        if (binding.type === 'axis') {
            return 'axis:' + binding.index + ':' +
                (binding.dir < 0 ? -1 : 1);
        }


        return '';
    }


    // 物理键 + 按法 → 一条绑定。
    function makeBinding(key, hold) {
        return (hold ? HOLD_PREFIX : '') + key;
    }


    /*
     * 绑定标识 → { key, hold, type, index, dir }。
     *
     * key 是剥掉前缀的物理键标识 —— 状态机、冲突判断要的都是它。
     * 认不出来的（旧版本留下的、手改过的、别的脚本撞进来的）返回 null，
     * 调用方一律当「这条不存在」处理。
     */
    function decodeBinding(text) {

        if (typeof text !== 'string') {
            return null;
        }


        const hold = text.slice(0, HOLD_PREFIX.length) === HOLD_PREFIX;

        const key = hold ? text.slice(HOLD_PREFIX.length) : text;

        const parts = key.split(':');


        if (parts[0] === 'button' && parts.length === 2) {

            const index = Number(parts[1]);


            if (parts[1] === '' || !Number.isInteger(index) || index < 0) {
                return null;
            }


            return {
                key: key, hold: hold, type: 'button', index: index
            };
        }


        if (parts[0] === 'axis' && parts.length === 3) {

            const index = Number(parts[1]);
            const dir = Number(parts[2]);


            if (parts[1] === '' || !Number.isInteger(index) || index < 0) {
                return null;
            }


            if (dir !== 1 && dir !== -1) {
                return null;
            }


            return {
                key: key, hold: hold, type: 'axis', index: index, dir: dir
            };
        }


        return null;
    }


    function actionById(id) {
        return ACTIONS.find(action => action.id === id) || null;
    }


    // =========================================================
    // 配置层
    //
    // 存的就是「动作 id → 按键标识列表」。一个动作能绑多个键，因为
    // 滚动同时给了十字键和左摇杆。
    // =========================================================

    const STORAGE_KEY = 'fenbi-gamepad-bindings';


    // 深拷一份默认表。必须拷 —— 调用方拿到手就会改（加绑、解绑），
    // 直接返回 DEFAULT_BINDINGS 的话改的是所有人共用的那一份。
    function freshBindings() {

        const out = {};


        for (const action of ACTIONS) {
            out[action.id] = (DEFAULT_BINDINGS[action.id] || []).slice();
        }


        return out;
    }


    function isPlainObject(value) {
        return Boolean(value) && typeof value === 'object' &&
            !Array.isArray(value);
    }


    /*
     * 读配置。
     *
     * 存进去的东西是不可信的 —— 可能是旧版本留下的、可能被人手改过、
     * 也可能别的脚本撞了同一个 key。所以逐项验：坏的那一项落回默认，
     * 而不是整份丢掉。整份丢掉的话，用户改了半天的映射会被一个不相干
     * 的坏字段全带走。
     */
    function loadBindings(getValue) {

        const bindings = freshBindings();

        let stored;


        try {
            stored = getValue(STORAGE_KEY, null);
        } catch (e) {
            return bindings;
        }


        if (!isPlainObject(stored)) {
            return bindings;
        }


        for (const action of ACTIONS) {

            if (!(action.id in stored)) {
                continue;
            }


            const raw = stored[action.id];


            if (!Array.isArray(raw)) {
                continue;
            }


            // 认不出来的键直接滤掉。全被滤掉就是空列表 —— 这跟「没配过」
            // 不同，是用户真的把它解绑完了。
            bindings[action.id] = raw.filter(
                key =>
                    typeof key === 'string' &&
                    decodeBinding(key) !== null
            );
        }


        return bindings;
    }


    function saveBindings(setValue, bindings) {

        try {
            setValue(STORAGE_KEY, bindings);
        } catch (e) {}
    }


    // =========================================================
    // 老配置的迁移
    //
    // 老版本里「长按」是**另一张表**：按键表说「哪个键归哪个动作」，
    // 长按表说「按住这个动作的键会触发谁」。那样有个说不通的地方 ——
    // 交卷明明是个动作，它的入口却写在 toggleAi 那一行上，于是交卷
    // 自己没有键，面板上显示成「只在长按里」。
    //
    // 现在长按是绑定自己的属性，写在被触发的那个动作那一行。老表要在
    // 启动时折进按键表，折完把老键写成空对象当记号：不写的话，用户
    // 以后解绑一个长按，下次开页面它会从老表里复活。
    //
    // 折的时候「老表里没有 = 用默认」—— 跟老 loadHolds 的语义一致
    // （那个键不存在 = 用户从没动过长按）。所以没配过长按的老用户拿到的
    // 正是他一直在用的行为，不是一份空配置。
    // =========================================================

    const HOLD_STORAGE_KEY = 'fenbi-gamepad-holds';

    // 老版本的默认长按表：谁的长按触发谁。只有迁移用得上 —— 新版本里
    // 这两条直接写在 DEFAULT_BINDINGS 里。
    const LEGACY_HOLDS = {
        toggleAi: 'finish',
        help:     'back'
    };


    /*
     * 把老长按表折进按键表。
     *
     * 老语义是「绑在 toggleAi 上的**任何一个**键，按住都触发交卷」，所以
     * 这里逐个键转：每个键复制一条长按绑定到目标动作上。返回新对象。
     */
    function foldLegacyHolds(bindings, legacy) {

        const next = {};


        for (const id of Object.keys(bindings)) {
            next[id] = bindings[id].slice();
        }


        for (const [srcId, targetId] of Object.entries(legacy || {})) {

            if (!ACTION_IDS.has(srcId) || !ACTION_IDS.has(targetId)) {
                continue;
            }


            if (srcId === targetId) {
                continue;
            }


            for (const text of (bindings[srcId] || [])) {

                const binding = decodeBinding(text);


                // 已经是新格式的说明这份配置不该走迁移，别重复加
                if (!binding || binding.hold) {
                    continue;
                }


                const spread = makeBinding(binding.key, true);


                // 这条长按已经有人占着了（目标自己有，或者老配置被改过
                // 撞到别的动作上），不抢也不重复加
                const taken = Object.keys(next).some(
                    id => next[id].includes(spread)
                );


                if (taken) {
                    continue;
                }


                next[targetId].push(spread);
            }
        }


        return next;
    }


    /*
     * 读一次老长按表，返 { 触发者: 目标 }，没得迁移就返回 null ——
     * 已经迁过的（老键是空对象）和读不到的都算。
     */
    function readLegacyHolds(getValue) {

        let stored;


        try {
            stored = getValue(HOLD_STORAGE_KEY, null);
        } catch (e) {
            return null;
        }


        const migrated =
            isPlainObject(stored) && Object.keys(stored).length === 0;


        if (migrated) {
            return null;
        }


        // 连老键都没有 = 用户从没配过长按，那就是默认那两条。
        // 默认那两条折回去正好等于现在的默认表，等于什么都没做。
        if (!isPlainObject(stored)) {
            return Object.assign({}, LEGACY_HOLDS);
        }


        const legacy = {};


        for (const [id, raw] of Object.entries(stored)) {

            // 认不出来的整条丢掉。老 loadHolds 就是这么办的：长按指向
            // 一个不存在的动作，按下去是彻底没反应，比没有这条配置更
            // 难查。
            if (!ACTION_IDS.has(id) || !isPlainObject(raw)) {
                continue;
            }


            if (!ACTION_IDS.has(raw.action) || raw.action === id) {
                continue;
            }


            legacy[id] = raw.action;
        }


        return legacy;
    }


    /*
     * 启动时把老配置接过来，返回该用的按键表。
     *
     * 只有真的要改才写回按键表：没改也写的话，等于把默认值抄进了用户
     * 的存储里 —— 以后改默认就再也到不了他那儿了。
     *
     * 「已迁移」那个记号**最后写**。先写的话，万一按键表没存住，记号
     * 却已经落下了 —— 下次开页面不会再折一遍，老长按就凭空没了。
     */
    function migrateConfig(getValue, setValue) {

        const bindings = loadBindings(getValue);

        const legacy = readLegacyHolds(getValue);


        if (!legacy) {
            return bindings;
        }


        const folded = foldLegacyHolds(bindings, legacy);

        const changed = JSON.stringify(folded) !== JSON.stringify(bindings);


        if (changed) {
            saveBindings(setValue, folded);
        }


        try {
            setValue(HOLD_STORAGE_KEY, {});
        } catch (e) {}


        return changed ? folded : bindings;
    }


    /*
     * 两个绑定能不能挤在同一个键上。
     *
     *   短按 + 长按 —— 可以。这正是「一个键干两件事」。
     *   短按 + 短按、长按 + 长按 —— 不行，后绑的顶掉先绑的。
     *   连发动作的长按 —— 它按下沿就动，松手也不补短按，一整个键
     *   都是它的，跟谁都挤不下。
     *
     * 只在绑的那一刻拦。behaviorOf 里也留了一道，为的是兜住手改过的
     * 存储 —— 那种配置进不了这个函数。
     */
    function clashes(textA, actionA, textB, actionB) {

        const a = decodeBinding(textA);
        const b = decodeBinding(textB);


        if (!a || !b || a.key !== b.key) {
            return false;
        }


        if (a.hold === b.hold) {
            return true;
        }


        return repeatsOnHold(a, actionA) || repeatsOnHold(b, actionB);
    }


    function repeatsOnHold(binding, action) {

        return Boolean(binding.hold) && Boolean(action) &&
            action.behavior === 'repeat';
    }


    /*
     * 加绑。返回新对象，不改入参。
     *
     * 一个键上的同一档只能有一个动作，所以加绑之前先把它从别人的同一档
     * 上摘掉；另一档不动 —— 那是另一个动作的位置。
     */
    function bindKey(bindings, actionId, text) {

        const action = actionById(actionId);


        if (!action || !decodeBinding(text)) {
            return bindings;
        }


        const next = {};


        for (const id of Object.keys(bindings)) {
            next[id] = bindings[id].filter(
                other => !clashes(text, action, other, actionById(id))
            );
        }


        const own = next[actionId] || [];


        if (!own.includes(text)) {
            own.push(text);
        }


        next[actionId] = own;


        return next;
    }


    /*
     * 换绑：把这个动作**同一档**原来的键清掉，只留新的那个。
     *
     * 跟 bindKey（追加）分开，是因为设置面板上那个按钮写的是「录入
     * 按键」—— 用户按下去的意思就是「这个动作这一档以后归这个键」。
     * 用追加语义的话，改一次就多一个键，按哪个都触发，越改越乱。
     *
     * 「同一档」是关键：交卷既有短按（R3）又有长按（Start），录一个
     * 新的短按时不能把长按那条也带走 —— 那是另一档，用户没说不要。
     */
    function rebindKey(bindings, actionId, text) {

        const action = actionById(actionId);

        const binding = decodeBinding(text);


        if (!action || !binding) {
            return bindings;
        }


        const next = {};


        for (const id of Object.keys(bindings)) {

            next[id] = bindings[id].filter(other => {

                const parsed = decodeBinding(other);


                if (!parsed) {
                    return false;
                }


                // 自己要换的那一档，旧的全让位
                if (id === actionId && parsed.hold === binding.hold) {
                    return false;
                }


                return !clashes(text, action, other, actionById(id));
            });
        }


        const own = next[actionId] || [];


        if (!own.includes(text)) {
            own.push(text);
        }


        next[actionId] = own;


        return next;
    }


    function unbindKey(bindings, actionId, text) {

        const next = {};


        for (const id of Object.keys(bindings)) {
            next[id] = bindings[id].filter(
                existing => !(id === actionId && existing === text)
            );
        }


        return next;
    }


    /*
     * 按键 → 该按什么规矩触发。
     *
     * 一个键上最多两件事：一件短按、一件长按。所以这里给的不是「哪个
     * 动作」，而是「按下沿触发谁」和「按满一秒触发谁」两个 —— 状态机
     * 把动作 id 直接带在事件里，动作层不用再去查表（查也查不出唯一
     * 答案：同一个键本来就可能是两件事）。
     *
     * mode 决定状态机怎么走：
     *
     *   'tap'    按下沿触发 pressAction 一次
     *   'hold'   按下沿不触发；松手补一次 pressAction，按满一秒
     *            触发 holdAction
     *   'repeat' 按下沿触发 pressAction，按住 400ms 后每 80ms 再来一次
     *
     * 没绑任何动作的键报 'tap' 而不是 undefined —— 状态机拿到 undefined
     * 会漏掉按下沿，那个键就会卡在「按住中」直到刷新页面。
     */
    function behaviorOf(bindings) {

        const tapTable = new Map();

        const holdTable = new Map();


        for (const action of ACTIONS) {

            for (const text of (bindings[action.id] || [])) {

                const binding = decodeBinding(text);


                if (!binding) {
                    continue;
                }


                if (binding.hold) {
                    holdTable.set(binding.key, action);
                } else {
                    tapTable.set(binding.key, action);
                }
            }
        }


        return function (key) {

            const tap = tapTable.get(key) || null;

            const held = holdTable.get(key) || null;


            /*
             * 连发动作的长按 = 按住不放。它按下沿就得动一格，也就没有
             * 「松手才算短按」这一档 —— 一整个键都是它的。
             *
             * 绑的时候就不让这种组合出现（见 clashes），这里兜的是
             * 手改过的存储：真有的话，连发赢，短按那条被忽略。
             */
            if (held && held.behavior === 'repeat') {
                return {
                    mode: 'repeat',
                    pressAction: held.id,
                    holdAction: null
                };
            }


            if (held) {
                return {
                    mode: 'hold',
                    holdMs: HOLD_MS,
                    pressAction: tap ? tap.id : null,
                    holdAction: held.id
                };
            }


            if (tap) {
                return {
                    mode: 'tap',
                    pressAction: tap.id,
                    holdAction: null
                };
            }


            return { mode: 'tap', pressAction: null, holdAction: null };
        };
    }


    // =========================================================
    // 输入层（纯计算部分）
    //
    // 这一层只做「把一帧手柄状态翻译成一个按键标识集合」，不碰 DOM、
    // 不碰定时器。
    // =========================================================

    /*
     * 死区。
     *
     * 0.35 是经验值：能滤掉老手柄静止时的电气漂移（实测能飘到 0.2 上
     * 下），又不至于让正常的轻推没反应。真漂到 0.35 以上的手柄，现在
     * 没有界面能调它 —— 那种情况先靠重新绑按键绕开。
     */
    const AXIS_DEADZONE = 0.35;


    function axisDir(value, deadzone) {

        if (typeof value !== 'number' || Number.isNaN(value)) {
            return 0;
        }


        if (value <= -deadzone) {
            return -1;
        }


        if (value >= deadzone) {
            return 1;
        }


        return 0;
    }


    /*
     * 采集一帧：把按下的按钮和推过死区的摇杆方向，变成一组按键标识。
     *
     * 只读左摇杆（轴 0 / 1）。右摇杆不读 —— 现在没有任何动作绑在它
     * 上面，读它只会多出一堆没人处理的边沿。
     *
     * 手柄的 buttons / axes 数组长度不保证 —— 杂牌手柄少报几个键是
     * 常事，元素甚至可能是 null。所以逐项验类型，不假设形状。
     */
    function frameInputs(pad, deadzone) {

        const active = new Set();


        if (!pad) {
            return active;
        }


        const buttons = Array.isArray(pad.buttons) ? pad.buttons : [];


        buttons.forEach((button, index) => {

            if (button && button.pressed) {
                active.add(encodeBinding({ type: 'button', index: index }));
            }
        });


        const axes = Array.isArray(pad.axes) ? pad.axes : [];

        const x = axisDir(axes[0], deadzone);
        const y = axisDir(axes[1], deadzone);


        if (x !== 0) {
            active.add(encodeBinding({ type: 'axis', index: 0, dir: x }));
        }


        if (y !== 0) {
            active.add(encodeBinding({ type: 'axis', index: 1, dir: y }));
        }


        return active;
    }


    // =========================================================
    // 识别层：边沿 / 长按 / 连发
    //
    // 这是整个脚本最容易写错的一块 —— 长按要区分「还没达成」和「已经
    // 触发过」，连发要同时看「按住多久」和「上次发是什么时候」，松开
    // 还要补发长按动作的短按分支。所以它是纯函数：不碰 DOM、不读时钟，
    // now 由调用方传进来。
    // =========================================================

    /*
     * 长按连发的节奏。
     *
     * 400ms 的首次延迟是为了区分「点一下」和「按住」—— 太短了想点一下
     * 会变成翻两页，太长了按住不跟手。80ms 的间隔约合每秒 12 次，比
     * 键盘重复快一点，翻题时不会觉得拖。
     */
    const REPEAT = {
        delay: 400,
        interval: 80
    };


    /*
     * 时钟跳变的容忍度。
     *
     * 切到别的标签页时 rAF 会停摆，回来时 now 一次跳几秒到几十秒。
     * 超过这个跨度就认为「中间没看见」，重置计时而不是补发。
     */
    const CLOCK_JUMP_MS = 1000;


    function freshInputState() {
        return { held: new Map(), lastNow: null };
    }


    function clearInputState() {
        return freshInputState();
    }


    /*
     * 推进一帧，返回 { events, state }。
     *
     * 事件的 kind 有三种：'tap'（短按）、'hold'（长按达成）、
     * 'repeat'（连发）。tap 模式按下沿直接发 'tap'；hold 模式要等到
     * 松开才发 'tap'，或者按住满阈值发 'hold'。
     *
     * 事件里带的是**动作 id**，不是按键标识。同一个键可以挂两件事
     * （短按一件、长按一件），拿键去反查已经查不出唯一答案了。
     */
    function stepInput(state, active, now, behaviorFor) {

        const events = [];

        const held = new Map();


        for (const entry of state.held) {
            held.set(entry[0], Object.assign({}, entry[1]));
        }


        // 时钟跳变：把还在按着的键当成「刚按下」重新计时，不补发。
        // 注意只重置计时，不重新触发 tap —— 用户其实一直按着，再触发
        // 一次就是凭空多出来的动作。
        const jumped =
            state.lastNow !== null &&
            (now < state.lastNow || now - state.lastNow > CLOCK_JUMP_MS);


        for (const key of active) {

            const behavior = behaviorFor(key) || { mode: 'tap' };

            const previous = held.get(key);


            if (!previous) {

                /*
                 * 按下的这一刻就把两件事**记在这个键名下**：按住的过程中
                 * 用户改了配置也不会让手上这一下中途换动作。
                 */
                held.set(key, {
                    since: now,
                    lastFire: now,
                    mode: behavior.mode,
                    holdMs: behavior.holdMs,
                    pressAction: behavior.pressAction,
                    holdAction: behavior.holdAction,
                    holdFired: false
                });


                if (behavior.mode === 'hold') {

                    // hold 模式按下沿故意不触发 —— 短按还是长按，得等
                    // 松开或等到阈值才知道。
                    continue;
                }


                events.push({
                    key: key,
                    kind: 'tap',
                    action: behavior.pressAction
                });

                continue;
            }


            if (jumped) {
                previous.since = now;
                previous.lastFire = now;
                continue;
            }


            if (previous.mode === 'hold') {

                if (
                    !previous.holdFired &&
                    now - previous.since >= (previous.holdMs || HOLD_MS)
                ) {

                    previous.holdFired = true;

                    events.push({
                        key: key,
                        kind: 'hold',
                        action: previous.holdAction
                    });
                }

                continue;
            }


            if (previous.mode === 'repeat') {

                if (now - previous.since < REPEAT.delay) {
                    continue;
                }


                if (now - previous.lastFire < REPEAT.interval) {
                    continue;
                }


                previous.lastFire = now;

                events.push({
                    key: key,
                    kind: 'repeat',
                    action: previous.pressAction
                });
            }
        }


        // 松开的键：hold 模式还没达成的话，现在补一个 tap
        for (const entry of Array.from(held)) {

            const key = entry[0];
            const previous = entry[1];


            if (active.has(key)) {
                continue;
            }


            if (previous.mode === 'hold' && !previous.holdFired) {
                events.push({
                    key: key,
                    kind: 'tap',
                    action: previous.pressAction
                });
            }


            held.delete(key);
        }


        return {
            events: events,
            state: { held: held, lastNow: now }
        };
    }


    // =========================================================
    // 动作层
    //
    // 这一层**不碰手柄** —— 它拿到的就是一个个动作 id。
    //
    // 全部走「直接操作 DOM」，不发合成键盘事件：一旦发合成 keydown
    // 就会跟 AI 面板的 Ctrl+Alt+Q 那类现有快捷键撞车，而且谁先跑
    // 取决于监听顺序，出了 bug 极难查。
    // =========================================================

    const QUESTION_SELECTOR = 'app-ti';

    // 单选和判断共用 choice-radio 那套，多选和不定项是 choice-checkbox。
    // （注意 choice-checkboxs 是粉笔自己的拼写错误，得照抄。）
    const CHOICE_LABEL_SELECTOR =
        'label.choice-radio-label, label.choice-checkbox-label';

    /*
     * 可作答的题：ul 上带 allow 类。已作答的题 input 会被 disabled 且
     * 不带 allow。
     *
     * 认这个类比「猜有没有解析节点」可靠，而且答完即锁，点已锁的题
     * 没有任何反应 —— 静默跳过比装作点了强。
     */
    const ANSWERABLE_SELECTOR = 'ul.allow';

    const CONFIRM_SELECTOR = '.memorize-confirm-btn';

    // 跟 fenbi-memorize-layout.user.js 里那个常量同名，有测试盯着
    const CURRENT_QUESTION_ATTR = 'data-fbai-current-question';

    /*
     * 开关 AI 面板这条路要的四个名字，跟 fenbi-ai-sidebar.user.js 的
     * CONFIG.panelId / hiddenAttr / toggleOpenClass / toggleClosedClass
     * 逐一对应，有契约测试盯着。
     *
     * 侧边栏在 shadow DOM 里（宿主 id 就是 panelId），所以手柄得先拿
     * 宿主再进 shadowRoot —— document 上直接找是穿不过去的。
     */
    const AI_HOST_ID = 'fbai-panel';
    const AI_HIDDEN_ATTR = 'data-fbai-hidden';
    const AI_OPEN_CLASS = 'fbai-collapse';
    const AI_CLOSED_CLASS = 'fbai-tab';

    /*
     * 交卷要先过一道确认弹窗，弹窗里那两个按钮手柄也要能用。
     *
     * 弹窗是 Angular 用 *ngIf 现建的 —— 存档里一个 .modal-* 都没有，
     * 全是运行时才知道长什么样的。所以「在 DOM 里」就等于「开着」，
     * 不用再判可见性。
     */
    const DIALOG_SELECTOR = '.modal-action';
    const DIALOG_BUTTON_SELECTOR = 'button.modal-action-btn';
    const DIALOG_CANCEL_TEXT = '取消';

    const SCROLL_STEP_RATIO = 1 / 3;


    function questions() {
        return Array.from(document.querySelectorAll(QUESTION_SELECTOR));
    }


    /*
     * 猜当前在哪道题。
     *
     * 取离视口 35% 高度最近的那道题 —— 跟布局脚本用的是同一套启发式。
     * **这只是兜底**，主路径是底下 currentIndex() 里的属性。
     *
     * jsdom 里 getBoundingClientRect 全返回 0，所以这个函数在测试环境
     * 里恒等于第 0 题 —— 别指望它，属性才是准的。
     */
    function findCurrentQuestionIndex() {

        const list = questions();


        if (!list.length) {
            return -1;
        }


        let best = -1;
        let bestDistance = Infinity;


        list.forEach((question, index) => {

            const rect = question.getBoundingClientRect();


            if (rect.bottom < 0 || rect.top > window.innerHeight) {
                return;
            }


            const center = rect.top + rect.height / 2;

            const distance = Math.abs(
                center - window.innerHeight * 0.35
            );


            if (distance < bestDistance) {
                bestDistance = distance;
                best = index;
            }
        });


        return best;
    }


    /*
     * 当前题号。
     *
     * 首选是布局脚本写下的 data-fbai-current-question —— 它手上有 DOM
     * 标记那一层，比我们猜得准。
     *
     * 但那个属性有 250ms 的缓存（CONFIG.currentIndexTTL）。手柄翻题
     * 是立刻生效的，属性却要等缓存过期才跟上。连发间隔才 80ms，快翻
     * 的时候必然踩中这个窗口 —— 那时按面键就会答到**上一题**，而答完
     * 即锁，等于当场报废一道没做过的题。
     *
     * 所以手柄自己翻的题记在 trackedIndex 里，并且记下「开始自持时属性
     * 是什么值」（trackedFrom）。只要属性还停在那個值上，就说明布局
     * 脚本还没跟上，这时听我们的；属性一变，说明它算出来了，立刻交还
     * 给它 —— 用户自己用鼠标滚走的情况也走这条路。
     */
    let trackedIndex = -1;
    let trackedFrom = null;


    /*
     * 手柄自己翻到了第 index 题。trackedFrom 记的是翻之前属性是什么
     * 值，用来判断布局脚本跟上没有。
     */
    function trackQuestion(index) {

        trackedIndex = index;

        trackedFrom = document.documentElement.getAttribute(
            CURRENT_QUESTION_ATTR
        );
    }


    function currentIndex() {

        const list = questions();


        if (!list.length) {
            trackedIndex = -1;
            trackedFrom = null;

            return -1;
        }


        const raw = document.documentElement.getAttribute(
            CURRENT_QUESTION_ATTR
        );


        const parsed = Number(raw);


        // 空串要挡掉：Number('') 是 0，会被当成「第 1 题」
        const attrUsable =
            raw !== null && raw !== '' &&
            Number.isInteger(parsed) &&
            parsed >= 0 && parsed < list.length;


        const selfUsable =
            trackedIndex >= 0 && trackedIndex < list.length;


        /*
         * 属性还停在我们开始自持时那个值上 —— 它比我们旧。
         *
         * 布局脚本那边有 250ms 的缓存，而且**缓存命中时还会把这个旧值
         * 原样再写一遍**，所以它不是「没跟上」，是被反复回写成旧的。
         * 光看值合不合法认不出来，得比它动没动。
         */
        const attrStale = selfUsable && raw === trackedFrom;


        if (attrUsable && !attrStale) {

            trackedIndex = parsed;
            trackedFrom = raw;


            return parsed;
        }


        /*
         * 手柄自己翻的题记在这儿 —— 它比猜准得多。
         *
         * 没装布局脚本时也要走这条：启发式只是兜底，不该在每次动作前
         * 重跑一遍把自持索引踩掉（jsdom 里 getBoundingClientRect 全是
         * 零，真机上长题干、材料题也会偏）。
         */
        if (selfUsable) {
            return trackedIndex;
        }


        // 到这儿是真没辙了：还没翻过题，或者换了套练习对不上号
        trackedIndex = findCurrentQuestionIndex();
        trackedFrom = null;


        return trackedIndex;
    }


    /*
     * 输入框聚焦时不该选选项。
     *
     * 页面上有自定义刷题数量的输入框。因为不发合成键盘事件，在输入框
     * 里打字本身没问题；但「选选项」这个动作得主动让开 —— 不然你正在
     * 填数量，手柄一按就把下面那道题答了。
     */
    function isEditableFocused() {

        const active = document.activeElement;


        if (!active) {
            return false;
        }


        const tag = active.tagName;


        return tag === 'INPUT' ||
            tag === 'TEXTAREA' ||
            tag === 'SELECT' ||
            active.isContentEditable === true;
    }


    function clickElement(node) {

        if (!node) {
            return false;
        }


        try {
            node.click();
            return true;
        } catch (e) {
            return false;
        }
    }


    /*
     * 这一题能选的选项。不能作答的题（已锁、填空题）返回空数组。
     *
     * 只认带 ul.allow 的题。已锁的题静默跳过 —— 点了也没反应，装作
     * 成功只会让人以为脚本坏了。
     */
    function choiceLabels(questionIndex) {

        if (questionIndex < 0) {
            return [];
        }


        const question = questions()[questionIndex];


        if (!question || !question.querySelector(ANSWERABLE_SELECTOR)) {
            return [];
        }


        return Array.from(
            question.querySelectorAll(CHOICE_LABEL_SELECTOR)
        );
    }


    // =========================================================
    // 弹窗
    //
    // 粉笔的弹窗（交卷确认之类）是 Angular 的 *ngIf 现建的，从静态存
    // 档里看不出来长什么样，只能照运行时那份 DOM 认：外面是 .modal-action，
    // 里面一排 button.modal-action-btn。
    //
    // 认「在 DOM 里」而不是「看得见」：弹窗关掉是整个从文档里摘掉的，
    // 而 getComputedStyle 那类判断在 jsdom 里根本跑不出真值。
    // =========================================================

    /*
     * 当前该应的那个弹窗，没有就是 null。
     *
     * 从后往前找：同时开着两层的时候（比如交卷弹窗上面又叠了一个），
     * 压在最后面的那个才是用户正看着的。
     */
    function dialogBar() {

        const bars = document.querySelectorAll(DIALOG_SELECTOR);


        for (let i = bars.length - 1; i >= 0; i--) {

            if (bars[i].querySelector(DIALOG_BUTTON_SELECTOR)) {
                return bars[i];
            }
        }


        return null;
    }


    function dialogButtons() {

        const bar = dialogBar();


        return bar
            ? Array.from(bar.querySelectorAll(DIALOG_BUTTON_SELECTOR))
            : [];
    }


    /*
     * 给每个弹窗发一个号。
     *
     * 光标要知道「还是刚才那个弹窗吗」—— 光用 'dialog' 这个字符串不够：
     * 关掉再开是一个全新的 DOM 节点，可字符串一模一样，上一次的光标位置
     * 就会带过来。上一次停在「确认」上的话，下一次一按确认就把卷交了，
     * 而这一下的默认本该是「取消」。
     *
     * 号挂在元素自己身上，节点没了号也就没了。
     */
    let dialogSeq = 0;

    function dialogScope(bar) {

        if (!bar.__fbgpDialogId) {

            dialogSeq += 1;

            bar.__fbgpDialogId = String(dialogSeq);
        }


        return 'dialog:' + bar.__fbgpDialogId;
    }


    function dialogOpen() {

        return dialogButtons().length > 0;
    }


    /*
     * 关掉弹窗 = 点「取消」。
     *
     * 认文字，认不出来就退回第一个按钮 —— 粉笔这套弹窗里第一个一直
     * 是取消。这个兜底很重要：文案改了以后要是点成第二个，那就是
     * 「按 Back 反而把卷交了」，比不生效糟得多。
     */
    function clickDialogCancel() {

        const buttons = dialogButtons();


        for (const button of buttons) {

            if ((button.textContent || '').trim() === DIALOG_CANCEL_TEXT) {
                return clickElement(button);
            }
        }


        return clickElement(buttons[0]);
    }


    // =========================================================
    // 选项光标
    //
    // 上下移，确认选中。光标是脚本自己画的一个外框 —— 不用 DOM 焦点：
    // 那会改 document.activeElement，而 isEditableFocused() 正是靠它
    // 判断「用户在输入框里」，两者会打架。
    //
    // 弹窗按钮走的是同一套光标：对用户来说「上下选、按一下确认」就是
    // 同一件事，没道理弹窗里换一套手感。
    // =========================================================

    const CURSOR_CLASS = 'fbgp-cursor';
    const CURSOR_STYLE_ID = 'fbgp-cursor-style';

    /*
     * 光标在第几个选项上。-1 表示「还没进场」。
     *
     * 「还没进场」和「停在第 1 个」必须分开：刚换到一道新题时，按 ↓
     * 该停在第一个，按 ↑ 该停在**最后**一个 —— 从你按的方向进场。
     * 混成一种的话，按 ↑ 会停在第一个，跟按 ↓ 一样。
     */
    let cursorIndex = -1;

    // 光标待的地方。跟当前该待的地方对不上就重新进场 —— 换了题还留
    // 着上一题的光标位置，按确认就会选到一个没在看的地方。
    //
    // 存的是个字符串（'dialog' 或 'q:3'）而不是题号：光标现在有两种
    // 落脚处，弹窗按钮没有题号可存，硬塞一个 -1 进去的话，弹窗和「猜
    // 不出当前题」就撞成同一个值了。
    let cursorScope = null;

    // 现在画着外框的那个元素。只记一个，清理时不用扫全页。
    let cursorPainted = null;


    function ensureCursorStyle() {

        if (document.getElementById(CURSOR_STYLE_ID)) {
            return;
        }


        const style = document.createElement('style');


        style.id = CURSOR_STYLE_ID;

        // 粉笔自己的样式优先级不低，得带 !important
        style.textContent =
            '.' + CURSOR_CLASS + '{' +
            'outline:2px solid #409eff !important;' +
            'outline-offset:2px !important;' +
            'border-radius:6px !important;' +
            '}';


        (document.head || document.documentElement).appendChild(style);
    }


    function clearCursorPaint() {

        if (!cursorPainted) {
            return;
        }


        cursorPainted.classList.remove(CURSOR_CLASS);

        cursorPainted = null;
    }


    function resetCursor() {

        clearCursorPaint();

        cursorScope = null;
        cursorIndex = -1;
    }


    /*
     * 光标这一下该落在哪儿 —— 弹窗开着就落在弹窗按钮上，否则落在当前
     * 这道题的选项上。
     *
     * scope 是「换地方了」的判据，跟 nodes 分开：答完一题选项会被锁掉
     * （ul.allow 没了，nodes 变空），但人还在同一题上，不该因为这一下
     * 就把光标位置忘了。
     */
    function cursorContext() {

        const bar = dialogBar();


        if (bar) {

            // question 是 -1：弹窗不是题，点完没有对错信号可等。
            return {
                scope: dialogScope(bar),
                nodes: Array.from(
                    bar.querySelectorAll(DIALOG_BUTTON_SELECTOR)
                ),
                question: -1
            };
        }


        const index = currentIndex();


        return {
            scope: 'q:' + index,
            nodes: choiceLabels(index),
            question: index
        };
    }


    function paintCursor(ctx) {

        clearCursorPaint();


        const node = ctx.nodes[cursorIndex];


        if (!node) {
            return;
        }


        ensureCursorStyle();

        node.classList.add(CURSOR_CLASS);

        cursorPainted = node;


        cursorScope = ctx.scope;


        // 选项多到要滚的时候，光标得跟着进视野。jsdom 没有真的布局，
        // 这个调用在那里是空转，不影响测试。
        try {
            node.scrollIntoView({ block: 'nearest' });
        } catch (e) {}
    }


    /*
     * 移光标。delta 是 +1 / -1，也接受 repeat 连发时一次挪好几格。
     *
     * 到头了绕回去，不卡住 —— 卡住的表现是「按了没反应」，跟坏了分
     * 不出来。选项总共就几个，绕回去比卡住好用。
     */
    function moveCursor(delta) {

        const ctx = cursorContext();


        // 填空题、已锁的题、没有按钮的弹窗：没得移。顺手把上一处留下
        // 的外框擦掉。
        if (!ctx.nodes.length) {

            resetCursor();

            return false;
        }


        if (cursorScope !== ctx.scope) {
            cursorScope = ctx.scope;
            cursorIndex = -1;
        }


        if (cursorIndex < 0) {

            // 进场：从你按的那个方向进来。按 ↓ 停在第一个选项，按 ↑
            // 停在最后一个。
            cursorIndex = delta > 0 ? 0 : ctx.nodes.length - 1;

        } else {

            const total = ctx.nodes.length;

            cursorIndex = ((cursorIndex + delta) % total + total) % total;
        }


        paintCursor(ctx);


        return true;
    }


    /*
     * 按下光标所在的那个 —— 选项就是选中它，弹窗就是按那个按钮。
     *
     * 多选题这里就是勾一下，不自动往下移 —— 自动移看着方便，但连按
     * 两下就会勾中两个，正好是"误选"那类最难查的错。要勾哪个自己移。
     */
    function confirmChoice() {

        const ctx = cursorContext();


        if (!ctx.nodes.length) {
            resetCursor();

            return false;
        }


        if (cursorScope !== ctx.scope) {
            cursorScope = ctx.scope;
            cursorIndex = -1;
        }


        /*
         * 还没移过光标就直接确认 = 选第一个。判断题只有两个选项，
         * 「看一眼，按 A」是最顺的用法，逼人先按一下 ↓ 没道理。
         *
         * 弹窗里第一个是「取消」—— 交卷不可逆，光标默认停在取消上，
         * 连按两下最多是取消，不会把卷交了。
         */
        const target = cursorIndex < 0 ? 0 : cursorIndex;


        if (!clickElement(ctx.nodes[target])) {
            return false;
        }


        /*
         * 点完这一下，光标待的地方可能就没了 —— 弹窗按钮按下去弹窗
         * 就关。这时候再把外框画回去，画的是一个已经不在文档里的
         * 节点，看着像「弹窗关了，选中框还挂在屏幕上」。
         */
        if (cursorContext().scope !== ctx.scope) {

            resetCursor();

            return true;
        }


        cursorIndex = target;

        paintCursor(ctx);


        // 弹窗不是题，没有对错可等。
        if (ctx.question >= 0) {
            watchResult(ctx.question);
        }


        return true;
    }


    // 粉笔原生答题卡里的按钮，跟布局脚本的 jumpToQuestion 用同一套
    const ANSWER_BUTTON_SELECTOR =
        'app-answer-card app-answer-button .answer-btn';


    function answerButtons() {

        let buttons = document.querySelectorAll(ANSWER_BUTTON_SELECTOR);


        // 布局脚本会自建一张答题卡，可能把原生的那张换掉了
        if (!buttons.length) {
            buttons = document.querySelectorAll('.answer-btn');
        }


        return Array.from(buttons);
    }


    /*
     * 翻到第 index 题。
     *
     * 复用粉笔原生答题卡的按钮 —— 布局脚本的 jumpToQuestion 也是这么
     * 干的。自己 scrollIntoView 的话，粉笔的懒渲染不会触发，翻过去
     * 是一道没渲染的空题。
     */
    function gotoQuestion(index) {

        const buttons = answerButtons();


        if (index < 0 || index >= buttons.length) {
            return false;
        }


        return clickElement(buttons[index]);
    }


    /*
     * 翻 delta 题。
     *
     * 自持索引在这里更新 —— 手柄自己翻的题它当然知道，比猜准得多。
     * 布局脚本写的属性可能还是翻之前那个值（它有 TTL 缓存），所以
     * trackedIndex 必须比属性优先，否则会「翻是翻了，但选项选在上一题」。
     */
    function stepToQuestion(delta) {

        // 翻题了，上一题的结果不用再等了；光标也归零，免得停在新题
        // 中间某个位置上
        cancelResultWatch();

        resetCursor();


        const target = currentIndex() + delta;


        if (!gotoQuestion(target)) {
            return false;
        }


        trackQuestion(target);


        return true;
    }


    /*
     * 页面在哪儿滚。
     *
     * 粉笔的题目区可能是个自己的滚动容器，不一定是 window。从当前题
     * 往上找第一个「真的能滚」的祖先，找不到才退回 window。
     */
    function scrollHost() {

        let node = questions()[currentIndex()];


        while (node && node !== document.body && node !== document.documentElement) {

            let style = null;

            try {
                style = getComputedStyle(node);
            } catch (e) {}


            if (style) {

                const overflowY = style.overflowY;

                const scrollable =
                    overflowY === 'auto' || overflowY === 'scroll';


                if (scrollable && node.scrollHeight > node.clientHeight) {
                    return node;
                }
            }


            node = node.parentElement;
        }


        return null;
    }


    function scrollByStep(direction) {

        const step = window.innerHeight * SCROLL_STEP_RATIO * direction;

        const host = scrollHost();


        if (host) {

            host.scrollTop += step;

            return;
        }


        window.scrollBy(0, step);
    }


    // 布局脚本自建解析面板上那个展开按钮的类名，跟那边的 TOGGLE_CLASS 一致
    const SOLUTION_TOGGLE_CLASS = 'fb-solution-toggle';


    /*
     * 找那一题里「展开 / 收起解析」的按钮。
     *
     * 先认 class。**不能只按字找** —— 那个按钮上的字改过版：老版本是
     * 「解析和展开 ▾」，新版本是「展开 ▾」。按「以展开开头」去匹配的话，
     * 老版本上「展开」在第 4 个字，一条都匹配不上，于是什么都不点 ——
     * 表现就是「按了没反应」，而且页面上一点线索都没有。
     */
    function solutionToggle(question) {

        const byClass = question.querySelector('.' + SOLUTION_TOGGLE_CLASS);


        if (byClass) {
            return byClass;
        }


        for (const node of question.querySelectorAll('button, [role="button"]')) {

            const text = (node.textContent || '').trim();


            // 用 includes 不用前缀，就是为了兼容上面那个老版本的字
            if (text.includes('展开') || text.includes('收起')) {
                return node;
            }
        }


        return null;
    }


    /*
     * 展开 / 收起解析。
     *
     * 装了布局脚本就走它自建面板上那个按钮。没装就退回粉笔原生的解析
     * 标题栏 —— 那边的展开是 Angular 自己在管的，能点开就算数。
     */
    function clickExpandToggle() {

        const index = currentIndex();

        const question = questions()[index];


        if (!question) {

            console.log(
                '[粉笔手柄] 展开解析：没找到当前题（题号 ' + index + '）'
            );

            return false;
        }


        const toggle = solutionToggle(question);


        if (toggle) {
            return clickElement(toggle);
        }


        const native = question.querySelector(
            '.solution-title, .title-right'
        );


        if (native) {
            return clickElement(native);
        }


        /*
         * 走到这儿说明这一题的解析面板还没建起来。
         *
         * 布局脚本只在拿到这道题的解析数据时才建面板，没做过、也没
         * 缓存过的题就是没有。这不是坏了 —— 但那行日志是唯一能把
         * 「没有」和「找错了」分开的凭据。
         */
        console.log(
            '[粉笔手柄] 展开解析：第 ' + (index + 1) +
            ' 题里没有解析面板（这道题的解析还没加载出来）'
        );


        return false;
    }


    // 布局脚本解析面板上「询问 AI」按钮的类名，跟那边的 ASK_CLASS 一致
    const ASK_AI_CLASS = 'fb-ask-ai';


    /*
     * 询问 AI：把当前这道题递给左侧的 AI 面板。
     *
     * 点布局脚本那个按钮，不自己走一遍握手 —— 题目正文怎么从 DOM 里
     * 抠出来是它的事，抄一份过来迟早跟它走散。按钮点下去它会把题目写
     * 进属性、发事件、读回结果码，还会在按钮上闪一下「已发送 ✓」或者
     * 「没送出去」—— 那一下闪字就是这条链路唯一的手感反馈，自己走
     * 握手反而没有。
     *
     * 所以这个动作要装布局脚本才有。没装就没得问。
     */
    function clickAskAi() {

        const index = currentIndex();

        const question = questions()[index];


        if (!question) {

            console.log(
                '[粉笔手柄] 询问 AI：没找到当前题（题号 ' + index + '）'
            );

            return false;
        }


        const button = question.querySelector('.' + ASK_AI_CLASS);


        if (!button) {

            console.log(
                '[粉笔手柄] 询问 AI：第 ' + (index + 1) +
                ' 题里没有「询问 AI」按钮 —— 要么没装 ' +
                'fenbi-memorize-layout.user.js，要么这道题的解析面板还没建起来'
            );

            return false;
        }


        return clickElement(button);
    }


    /*
     * 交卷。故意做得难找 —— 它不可逆，找不到就不做比点错强。
     *
     * 粉笔那个**不是** button/a —— 实测是 <div _ngcontent-… class=
     * "submit-btn"><svg …></svg>交卷</div>。老版本只扫
     * 'button, a, [role="button"]'，所以永远找不到它，表现就是长按
     * Start 一点反应都没有，日志里也不留痕迹。
     *
     * 注意：粉笔点完「交卷」还会弹一个确认框，那一步手柄管不了，
     * 得用鼠标点。没有自动确认 —— 不可逆的动作不该由脚本替你按下去。
     */
    const FINISH_SELECTOR = '.submit-btn';

    // 文字要整块相等，不能用 includes —— 「交卷」两个字很容易出现在
    // 包着一大片内容的祖先节点里，那种节点点下去是点了个寂寞。
    const FINISH_TEXTS = ['交卷', '提交试卷'];


    function finishTextMatches(node) {

        const text = (node.textContent || '').trim();

        return FINISH_TEXTS.includes(text);
    }


    function clickFinish() {

        // 先认 class。它最准，也最便宜。
        const byClass = document.querySelector(FINISH_SELECTOR);


        if (byClass && finishTextMatches(byClass)) {
            return clickElement(byClass);
        }


        // 兜底按字找，顺带把 div 也扫进去 —— 上面那个 class 万一改名
        // 了，这里还能救一次。
        const candidates = document.querySelectorAll(
            'button, a, [role="button"], div, span'
        );


        for (const node of candidates) {

            if (finishTextMatches(node)) {
                return clickElement(node);
            }
        }


        return false;
    }


    /*
     * 开关 AI 助手面板 —— 跟别的动作一样，就是点一个按钮。
     *
     * 原来这里走的是「自己发个事件、侧边栏听着切面板、再把结果写回
     * documentElement 属性」那条信道。能跑，但它是全部动作里唯一一个
     * 不是点 DOM 的：别的不灵了看一眼页面就知道哪不对，这个不灵了得
     * 同时怀疑两份脚本，还得先想清楚是谁没应答。
     *
     * 现在侧边栏在那两个按钮上都挂了 toggleClass，展开时是头部那个
     * 收起键，收起后是屏幕边上常显的一个小标（这是用户要的：关掉了
     * 也得能一眼看回来）。手柄照着类名点就行，跟点「展开解析」没有
     * 任何区别。
     *
     * 两个按钮同时在 DOM 里（收起的那个藏在一个 display:none 的容器
     * 里，不是被摘掉），所以不能「找到一个就点」—— 得先问侧边栏现在
     * 是哪个状态，那个状态写在宿主元素上。
     *
     * 没装侧边栏就静默跳过：点了没反应比报错强，用户可能压根没装。
     */
    function toggleAiPanel() {

        const host = document.getElementById(AI_HOST_ID);


        if (!host || !host.shadowRoot) {
            return false;
        }


        const hidden = host.getAttribute(AI_HIDDEN_ATTR) === '1';


        return clickElement(host.shadowRoot.querySelector(
            '.' + (hidden ? AI_CLOSED_CLASS : AI_OPEN_CLASS)
        ));
    }


    // =========================================================
    // 跳题浮层
    //
    // 「跳题」要能跳到任意一题，而粉笔原生答题卡是给鼠标点的。所以
    // 自己起一个：十字键左右 ±1、上下 ±10，面键 1 跳过去，Back 取消。
    //
    // 浮层开着的时候是模态的 —— 别的手柄输入一律不理，免得一边挑
    // 题号一边把下面那道题答了。
    // =========================================================

    const JUMP_PANEL_ID = 'fbgp-jump';

    let jumpSelected = 0;


    function jumpPanelOpen() {
        return Boolean(document.getElementById(JUMP_PANEL_ID));
    }


    function closeJumpPanel() {

        const panel = document.getElementById(JUMP_PANEL_ID);


        if (panel) {
            panel.remove();
        }
    }


    function paintJumpPanel() {

        const panel = document.getElementById(JUMP_PANEL_ID);


        if (!panel) {
            return;
        }


        /*
         * 从 shadowRoot 里找，**不是从 panel 找**。
         *
         * shadow DOM 是封起来的：panel.querySelectorAll 穿不透边界，
         * 在它上面找 [data-jump] 一个都找不到 —— 表现是浮层能弹出来、
         * 但选中哪一格永远不高亮，标题也永远停在刚开始那个数字。
         */
        const shadow = panel.shadowRoot;


        if (!shadow) {
            return;
        }


        for (const node of shadow.querySelectorAll('[data-jump]')) {

            const index = Number(node.dataset.jump);


            node.classList.toggle('on', index === jumpSelected);


            if (index === jumpSelected) {

                // 别让选中的那格跑到看不见的地方去
                const box = node.getBoundingClientRect();
                const frame = panel.getBoundingClientRect();


                if (box.top < frame.top || box.bottom > frame.bottom) {

                    try {
                        node.scrollIntoView({ block: 'nearest' });
                    } catch (e) {}
                }
            }
        }


        const title = shadow.querySelector('.title');


        if (title) {

            title.textContent = '跳到第 ' + (jumpSelected + 1) +
                ' 题 / 共 ' + questions().length + ' 题';
        }
    }


    function openJumpPanel() {

        if (jumpPanelOpen()) {
            return;
        }


        const list = questions();


        if (!list.length) {
            return;
        }


        jumpSelected = Math.max(0, currentIndex());


        const panel = document.createElement('div');

        panel.id = JUMP_PANEL_ID;

        const shadow = panel.attachShadow({ mode: 'open' });


        shadow.innerHTML = [
            '<style>',
            ':host{all:initial}',
            '.box{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);',
            'z-index:2147483002;width:min(560px,86vw);max-height:70vh;',
            'display:flex;flex-direction:column;background:#fff;color:#222;',
            'border:1px solid #dcdfe6;border-radius:12px;',
            'box-shadow:0 12px 40px rgba(0,0,0,.28);',
            'font:13px/1.7 system-ui,sans-serif}',
            '.title{padding:12px 16px;font-weight:600;border-bottom:1px solid #ebeef5}',
            '.grid{display:flex;flex-wrap:wrap;gap:6px;padding:12px 16px;overflow:auto}',
            '.cell{width:38px;height:32px;border:1px solid #dcdfe6;border-radius:6px;',
            'background:#fff;cursor:pointer;font:inherit;font-size:12px;color:#606266}',
            '.cell.on{background:#409eff;border-color:#409eff;color:#fff;font-weight:600}',
            '.foot{padding:10px 16px;border-top:1px solid #ebeef5;color:#909399;font-size:12px}',
            '</style>',
            '<div class="box">',
            '<div class="title"></div>',
            '<div class="grid"></div>',
            '<div class="foot">← → 挪一题，↑ ↓ 挪十题，面键 1 跳过去，Back 取消</div>',
            '</div>'
        ].join('');


        const grid = shadow.querySelector('.grid');


        list.forEach((unused, index) => {

            const cell = document.createElement('button');

            cell.className = 'cell';
            cell.dataset.jump = String(index);
            cell.textContent = String(index + 1);


            cell.addEventListener('click', () => {
                jumpSelected = index;
                confirmJump();
            });


            grid.appendChild(cell);
        });


        document.body.appendChild(panel);

        paintJumpPanel();
    }


    function confirmJump() {

        const target = jumpSelected;

        closeJumpPanel();

        cancelResultWatch();

        resetCursor();


        if (gotoQuestion(target)) {
            trackQuestion(target);
        }
    }


    function moveJumpSelection(delta) {

        const total = questions().length;


        if (!total) {
            closeJumpPanel();
            return;
        }


        jumpSelected = Math.max(0, Math.min(total - 1, jumpSelected + delta));

        paintJumpPanel();
    }


    // =========================================================
    // 震动反馈
    //
    // 触发信号是当前题的 .ti-container 拿到 correct / wrong 类。
    // 实测点击后 226ms 出现 —— 对感知而言是即时的，所以纯 DOM 就够，
    // 不用去接口缓存里捞答案。
    //
    // 答完即锁 + 226ms 出结果，这两条合起来意味着：震动的时刻就是
    // 「这道题结束了」的时刻。所以它同时也是一声「可以翻下一题了」。
    // =========================================================

    const RESULT_CLASSES = ['correct', 'wrong'];

    /*
     * 时长。规格是总时长不超过 0.5 秒。
     *
     * 答对用「两下短」而不是「一下长」，是因为躺着的时候手能感觉出
     * 节奏差异，但对震动强度不敏感 —— 用节奏编码比用强度编码可靠。
     */
    const VIBRATION = {
        correct: { pulse: 100, gap: 80 },   // 100 + 80 + 100 = 280ms
        wrong:   { duration: 400 }
    };

    const RESULT_TIMEOUT_MS = 3000;

    let vibrationTimers = [];


    function clearVibrationTimers() {

        for (const timer of vibrationTimers) {
            clearTimeout(timer);
        }


        vibrationTimers = [];
    }


    function buzz(pad, duration, strength) {

        if (
            !pad || !pad.vibrationActuator ||
            typeof pad.vibrationActuator.playEffect !== 'function'
        ) {
            return false;
        }


        try {

            pad.vibrationActuator.playEffect('dual-rumble', {
                startDelay: 0,
                duration: duration,
                weakMagnitude: strength,
                strongMagnitude: 1
            });


            return true;
        } catch (e) {
            return false;
        }
    }


    /*
     * 响一次反馈。
     *
     * 先清掉上一次没响完的 —— 答完立刻翻下一题时，上一题第二下还没响，
     * 不取消的话两个反馈会串在一起。
     */
    function playVibration(pad, verdict) {

        clearVibrationTimers();


        if (verdict === 'correct') {

            buzz(pad, VIBRATION.correct.pulse, 0.6);


            vibrationTimers.push(setTimeout(() => {
                buzz(pad, VIBRATION.correct.pulse, 0.6);
            }, VIBRATION.correct.pulse + VIBRATION.correct.gap));


            return;
        }


        if (verdict === 'wrong') {
            buzz(pad, VIBRATION.wrong.duration, 0.9);
        }
    }


    let resultObserver = null;
    let resultTimer = null;


    function cancelResultWatch() {

        if (resultObserver) {
            resultObserver.disconnect();
            resultObserver = null;
        }


        if (resultTimer) {
            clearTimeout(resultTimer);
            resultTimer = null;
        }
    }


    /*
     * 等当前题的对错结果。
     *
     * 三种收场：拿到 correct / wrong 就震、翻题时取消、3 秒没动静放弃。
     * 最后那条是必须的 —— 填空题之类的题压根不会拿到这个类，监听器
     * 不能永远挂着。
     *
     * **调用方必须已经确认这道题真的被作答了。** 做过一遍的题，它的
     * ti-container 上会留着 correct / wrong 类，翻回去再按一下面键就会
     * 立刻误震一次。所以只在真的点中了选项之后才调这里（见 confirmChoice：
     * 弹窗那条路上 question 是 -1，压根不调）。
     */
    function watchResult(questionIndex) {

        cancelResultWatch();


        const question = questions()[questionIndex];


        if (!question) {
            return;
        }


        const box = question.querySelector('.ti-container');


        if (!box) {
            return;
        }


        const finish = verdict => {

            cancelResultWatch();

            // 结果出来了 = 这一题锁了，选项不能再动，光标留着就是骗人
            resetCursor();

            // 到这一刻才去拿手柄。结果要 226ms 才回来，这段时间里用户
            // 可能已经把上一个拔了换了一个 —— 按下那一刻的引用早就旧了。
            playVibration(activePad(), verdict);
        };


        const check = () => {

            for (const verdict of RESULT_CLASSES) {

                if (box.classList.contains(verdict)) {
                    finish(verdict);
                    return true;
                }
            }


            return false;
        };


        // 可能类已经在了（结果比监听器先到）
        if (check()) {
            return;
        }


        if (typeof MutationObserver === 'function') {

            resultObserver = new MutationObserver(check);

            resultObserver.observe(box, {
                attributes: true,
                attributeFilter: ['class']
            });
        }


        // 三秒还没等到结果就放弃 —— 但光标也要收掉。不收的话它会一直
        // 停在选项上，看着像还能再选
        resultTimer = setTimeout(() => {

            cancelResultWatch();
            resetCursor();

        }, RESULT_TIMEOUT_MS);
    }


    // =========================================================
    // 动作派发
    // =========================================================

    /*
     * 拿当前所有手柄。
     *
     * **不能用 getGamepads()[0]。** 那个数组是按**手柄索引**排的，不是
     * 紧凑的 —— 之前连过别的手柄、系统里有个虚拟手柄、或者拔了重插，
     * 你的手柄就可能在索引 1、2 上，而 [0] 是 null。这时候脚本会一口
     * 咬定「没检测到手柄」，明明角标都亮着。
     *
     * 用下标循环而不是 for...of：老 Firefox 返回的 GamepadList 没有
     * 迭代器，for...of 会直接抛。
     */
    function connectedPads() {

        if (typeof navigator.getGamepads !== 'function') {
            return [];
        }


        let pads = null;


        try {
            pads = navigator.getGamepads();
        } catch (e) {
            return [];
        }


        if (!pads) {
            return [];
        }


        const out = [];


        for (let i = 0; i < pads.length; i++) {

            if (pads[i]) {
                out.push(pads[i]);
            }
        }


        return out;
    }


    function activePad() {
        return connectedPads()[0] || null;
    }


    function runAction(actionId) {

        /*
         * 跳题浮层开着的时候是模态的，只认下面这几个。
         *
         * 方向键的映射照着「表格」来：左右挪一格，上下挪十格。选项光标
         * 那套上下移一个在这里不适用 —— 题号表是几十上百个，一格一格
         * 挪要按到手酸。
         */
        if (jumpPanelOpen()) {

            switch (actionId) {

                case 'next':
                    moveJumpSelection(1);
                    return;

                case 'prev':
                    moveJumpSelection(-1);
                    return;

                case 'cursorUp':
                case 'scrollUp':
                    moveJumpSelection(-10);
                    return;

                case 'cursorDown':
                case 'scrollDown':
                    moveJumpSelection(10);
                    return;

                case 'confirm':
                    confirmJump();
                    return;

                case 'back':
                case 'help':
                    closeJumpPanel();
                    return;

                default:
                    return;
            }
        }


        /*
         * 弹窗（交卷确认那种）也是模态的，只认十字键、面键 1 和 Back。
         *
         * 别的动作一律不理，这一步不能省：弹窗盖在题目上，这时候按
         * 确认要是漏到底下那道题上，就是在用户看不见的地方把题答了
         * —— 而答错了不可逆。
         *
         * 两个「退出去」的动作都当取消：back 是回退网页，help 是设置/
         * 帮助。弹窗开着的时候用户按它们想的是「关掉这东西」，真退回
         * 上一页会把整套练习的进度丢掉，而设置面板叠在弹窗上也没意义。
         *
         * （默认映射里物理 Back 键挂在 help 上，所以这两条都得留 ——
         *   只认 back 的话，用户按 Back 会发现关不掉。）
         */
        if (dialogOpen()) {

            switch (actionId) {

                case 'cursorUp':
                    moveCursor(-1);
                    return;

                case 'cursorDown':
                    moveCursor(1);
                    return;

                case 'confirm':
                    confirmChoice();
                    return;

                case 'back':
                case 'help':
                    clickDialogCancel();
                    return;

                default:
                    return;
            }
        }


        switch (actionId) {

            case 'cursorUp':
                moveCursor(-1);
                return;

            case 'cursorDown':
                moveCursor(1);
                return;

            case 'confirm': {

                // 输入框聚焦时不让确认。挪光标本身是无害的，但「选中」
                // 会真答题 —— 正在填自定义刷题数量时手柄一按，就把下面
                // 那道题答了。
                if (isEditableFocused()) {
                    return;
                }


                // watchResult 在 confirmChoice 里面挂，只有真的点成功了
                // 才挂 —— 锁着的题和填空题点了没反应，挂上去等于挂在一个
                // 永远不会变的类上。
                confirmChoice();

                return;
            }

            case 'submit': {

                const index = currentIndex();

                const question = questions()[index];


                if (
                    question &&
                    question.querySelector(ANSWERABLE_SELECTOR) &&
                    clickElement(question.querySelector(CONFIRM_SELECTOR))
                ) {
                    watchResult(index);
                }


                return;
            }

            case 'next':
                stepToQuestion(1);
                return;

            case 'prev':
                stepToQuestion(-1);
                return;

            case 'scrollUp':
                scrollByStep(-1);
                return;

            case 'scrollDown':
                scrollByStep(1);
                return;

            case 'expand':
                clickExpandToggle();
                return;

            case 'ask':
                clickAskAi();
                return;

            case 'jump':
                openJumpPanel();
                return;

            case 'help':
                togglePanel();
                return;

            case 'back':
                history.back();
                return;

            case 'finish':
                clickFinish();
                return;

            case 'toggleAi':
                toggleAiPanel();
                return;

            default:
                return;
        }
    }


    // =========================================================
    // 设置浮层
    //
    // 挂在 shadow DOM 里，跟 AI 侧边栏同风格 —— 粉笔的样式进不来，
    // 我们的样式也出不去。
    //
    // 这是唯一能改按键的地方，所以它同时是「帮助」：躺着忘了哪个键
    // 干什么，按住 Back 一秒就能查。
    // =========================================================

    const PANEL_ID = 'fbgp-panel';
    const BINDING_TIMEOUT_MS = 8000;

    // 非 null 时，主循环把下一个手柄输入写进配置而不是执行动作。
    // 记的是「给谁 + 哪一档」—— 录之前那个下拉选了短按还是长按。
    let pendingBind = null;
    let pendingBindTimer = null;


    function bindingLabel(text) {

        const binding = decodeBinding(text);


        if (!binding) {
            return text;
        }


        let label;


        if (binding.type === 'button') {

            label = '按钮 ' + binding.index;

        } else {

            const axisNames = ['左摇杆 X', '左摇杆 Y'];

            const axisName = axisNames[binding.index] || ('轴 ' + binding.index);

            label = axisName + (binding.dir < 0 ? ' 负向' : ' 正向');
        }


        // 两档在面板上得一眼分得开 —— 交卷那一行会有两条，一条短按
        // 一条长按，只写「按钮 9」和「按钮 11」看不出哪条是哪个。
        return binding.hold ? '长按 ' + label : label;
    }


    function cancelPendingBind() {

        pendingBind = null;


        if (pendingBindTimer) {
            clearTimeout(pendingBindTimer);
            pendingBindTimer = null;
        }
    }


    function panelRoot() {

        const panel = document.getElementById(PANEL_ID);


        return panel ? panel.shadowRoot : null;
    }


    function paintHint(text) {

        const root = panelRoot();


        if (root) {
            root.getElementById('fbgp-hint').textContent = text;
        }
    }


    function closePanel() {

        const panel = document.getElementById(PANEL_ID);


        if (panel) {
            panel.remove();
        }


        cancelPendingBind();
    }


    /*
     * 主循环正在用的那份配置。
     *
     * 设置面板改完配置必须把它递进去 —— 不递的话，behaviorCache 还是
     * 改之前那张表，用户录完按键得刷新页面才生效，而他是当场就要试的。
     *
     * init() 会把 onChange 装上。没装（比如测试里只加载纯函数）就只是
     * 存下来，不报错。
     */
    const liveConfig = { bindings: null, onChange: null };


    function pushConfig(bindings) {

        liveConfig.bindings = bindings;


        if (typeof liveConfig.onChange === 'function') {
            liveConfig.onChange(bindings);
        }
    }


    function renderPanel(bindings) {

        const root = panelRoot();


        if (!root) {
            return;
        }


        const list = root.getElementById('fbgp-list');

        list.textContent = '';


        for (const action of ACTIONS) {

            const row = document.createElement('div');

            row.className = 'row';
            row.dataset.action = action.id;


            const name = document.createElement('span');

            name.className = 'name';
            name.textContent = action.name;

            row.appendChild(name);


            const keys = document.createElement('span');

            keys.className = 'keys';


            const bound = bindings[action.id] || [];


            if (!bound.length) {

                const none = document.createElement('em');


                none.textContent = '未绑定';


                keys.appendChild(none);
            }


            for (const text of bound) {

                const tag = document.createElement('button');

                tag.className = 'key';
                tag.dataset.unbind = text;
                tag.textContent = bindingLabel(text) + ' ✕';
                tag.title = '解除这个绑定';


                tag.addEventListener('click', () => {

                    const next = unbindKey(
                        loadBindings(GM_getValue),
                        action.id,
                        text
                    );


                    saveBindings(GM_setValue, next);

                    pushConfig(next);

                    renderPanel(next);
                });


                keys.appendChild(tag);
            }


            row.appendChild(keys);


            /*
             * 「录进去的这个键，是短按还是长按」。
             *
             * 两档各自独立，所以录之前得说清这一次录的是哪一档 —— 不说
             * 的话，用户想给交卷加个长按，结果把短按那个键顶掉了。
             *
             * 下拉本身不存：录完重画，回到短按。默认那一档是常用的那个，
             * 而误录成长按的代价是「按一下没反应」，比反过来好查。
             */
            const when = document.createElement('select');

            when.className = 'when';
            when.dataset.whenFor = action.id;


            for (const pair of [['', '短按'], [HOLD_PREFIX, '长按']]) {

                const option = document.createElement('option');


                option.value = pair[0];
                option.textContent = pair[1];


                when.appendChild(option);
            }


            row.appendChild(when);


            const bind = document.createElement('button');

            bind.className = 'bind';
            bind.dataset.bindFor = action.id;
            bind.textContent = '录入按键';


            bind.addEventListener('click', () => {

                cancelPendingBind();


                pendingBind = {
                    action: action.id,
                    hold: when.value === HOLD_PREFIX
                };


                paintHint(
                    '按下手柄上的键…（' + (BINDING_TIMEOUT_MS / 1000) +
                    ' 秒内没按就取消）'
                );


                pendingBindTimer = setTimeout(() => {

                    cancelPendingBind();
                    paintHint('');

                }, BINDING_TIMEOUT_MS);
            });


            row.appendChild(bind);


            list.appendChild(row);
        }
    }


    function describePad(pad) {

        if (!pad || !pad.id) {
            return '手柄';
        }


        return String(pad.id)
            .replace(/\s*\([^)]*\)\s*$/, '')
            .slice(0, 40) || '手柄';
    }


    function openPanel() {

        if (document.getElementById(PANEL_ID)) {
            return;
        }


        const panel = document.createElement('div');

        panel.id = PANEL_ID;


        const shadow = panel.attachShadow({ mode: 'open' });


        shadow.innerHTML = [
            '<style>',
            ':host{all:initial}',
            '.box{position:fixed;top:24px;right:24px;z-index:2147483003;',
            'width:min(440px,88vw);max-height:80vh;overflow:auto;background:#fff;',
            'color:#222;border:1px solid #dcdfe6;border-radius:10px;',
            'box-shadow:0 8px 32px rgba(0,0,0,.18);',
            'font:13px/1.7 system-ui,sans-serif}',
            '.head{padding:12px 16px;border-bottom:1px solid #ebeef5;display:flex;',
            'justify-content:space-between;align-items:center}',
            '.title{font-weight:600;font-size:14px}',
            '.close{border:none;background:none;cursor:pointer;font-size:16px;color:#909399}',
            '.pad{padding:8px 16px;color:#606266;font-size:12px;',
            'border-bottom:1px solid #f2f6fc}',
            '.warn{color:#e6a23c;margin-top:4px}',
            '.row{display:flex;align-items:center;gap:8px;padding:8px 16px;',
            'border-bottom:1px solid #fafafa;flex-wrap:wrap}',
            '.name{flex:1;min-width:110px}',
            '.keys{display:flex;flex-wrap:wrap;gap:4px}',
            '.key{border:1px solid #dcdfe6;background:#f5f7fa;border-radius:4px;',
            'padding:2px 6px;cursor:pointer;font:inherit;font-size:12px;color:#606266}',
            '.key:hover{border-color:#f56c6c;color:#f56c6c}',
            '.bind{border:1px solid #409eff;color:#409eff;background:#fff;',
            'border-radius:4px;padding:2px 8px;cursor:pointer;font:inherit;font-size:12px}',
            // 「这一次录的是短按还是长按」。窄一点，它只是一档选择
            '.when{border:1px solid #dcdfe6;border-radius:4px;padding:2px 4px;',
            'font:inherit;font-size:12px;color:#606266;background:#fff}',
            '.tip{padding:8px 16px;color:#909399;font-size:12px;',
            'border-bottom:1px solid #f2f6fc;line-height:1.6}',
            '.tip b{color:#606266;font-weight:600}',
            '.foot{padding:10px 16px;display:flex;justify-content:space-between;',
            'align-items:center;gap:8px}',
            '.hint{color:#409eff;font-size:12px}',
            '.reset{border:1px solid #dcdfe6;background:#fff;border-radius:4px;',
            'padding:4px 10px;cursor:pointer;font:inherit;font-size:12px}',
            '</style>',
            '<div class="box">',
            '<div class="head"><span class="title">手柄设置</span>',
            '<button class="close" title="关闭">✕</button></div>',
            '<div class="pad"></div>',
            '<div class="tip">一个键可以挂两件事：一件<b>短按</b>、一件<b>长按</b>。',
            '同一个键上两件短按（或两件长按）会互相顶掉，后录的赢。',
            '标着「长按」的键按住一秒才触发 —— 但按住本来就连发的动作',
            '（移光标、翻题、滚动）例外：那几档按住就是连发。</div>',
            '<div id="fbgp-list"></div>',
            '<div class="foot"><span class="hint" id="fbgp-hint"></span>',
            '<button class="reset" data-reset>全部恢复默认</button></div>',
            '</div>'
        ].join('');


        const pads = connectedPads();

        const padLine = shadow.querySelector('.pad');


        const warn = text => {

            const node = document.createElement('div');

            node.className = 'warn';
            node.textContent = text;

            padLine.appendChild(node);
        };


        if (!pads.length) {

            /*
             * 说清楚是「没有」还是「拿不到」—— 两者都表现为这一行
             * 字，但一个是正常现象（还没按过键），一个是环境不支持。
             * 分不开的话只能靠猜。
             */
            if (typeof navigator.getGamepads !== 'function') {

                padLine.textContent =
                    '这个浏览器没有 Gamepad API，手柄用不了。';

            } else {

                padLine.textContent =
                    '没检测到手柄 —— 先按一下手柄上的任意键，' +
                    '再重新打开这个面板。';

                warn(
                    '浏览器就是这样：不按过键，它不给网页看手柄。' +
                    '按了之后左下角会出现「🎮 手柄名」的角标。'
                );
            }

        } else {

            padLine.textContent = '已连接：' + pads[0].id +
                '（索引 ' + pads[0].index + '）';


            // 手柄不在索引 0 上是合法的，但会让人以为「第一个」才是
            // 自己那个。列出来省得对不上号。
            if (pads.length > 1) {

                warn(
                    '一共检测到 ' + pads.length + ' 个手柄，' +
                    '脚本用的是索引最小的那个：' +
                    pads.map(pad => pad.index + '. ' + pad.id).join('；')
                );
            }


            /*
             * 非标准映射的手柄，按键索引没有标准含义，默认键位可能
             * 全是错的。必须明说 —— 不说的话用户会以为脚本坏了，
             * 而不是意识到自己该重新绑一遍。
             */
            if (pads[0].mapping !== 'standard') {

                warn(
                    '这个手柄报的不是标准映射（mapping = "' +
                    pads[0].mapping + '"），下面那些默认键位可能是错的，' +
                    '需要自己重新绑。'
                );
            }
        }


        shadow.querySelector('.close').addEventListener('click', closePanel);


        shadow.querySelector('[data-reset]').addEventListener('click', () => {

            const fresh = freshBindings();


            saveBindings(GM_setValue, fresh);

            pushConfig(fresh);

            renderPanel(fresh);

            paintHint('已全部恢复默认');
        });


        document.body.appendChild(panel);


        renderPanel(loadBindings(GM_getValue));
    }


    function togglePanel() {

        if (document.getElementById(PANEL_ID)) {
            closePanel();
        } else {
            openPanel();
        }
    }


    // =========================================================
    // 角标
    //
    // 不只是好看：浏览器要求先按一下手柄上的键，getGamepads() 才会
    // 返回它。插上不动等于没插 —— 没这个提示，用户会以为脚本坏了。
    // =========================================================

    const BADGE_ID = 'fbgp-badge';


    function ensureBadge() {

        let badge = document.getElementById(BADGE_ID);


        if (badge) {
            return badge;
        }


        badge = document.createElement('div');

        badge.id = BADGE_ID;

        badge.style.cssText = [
            'position:fixed',
            'left:12px',
            'bottom:12px',
            'z-index:2147483000',
            'padding:4px 10px',
            'border-radius:14px',
            'background:rgba(0,0,0,.72)',
            'color:#fff',
            'font:12px/1.6 system-ui,sans-serif',
            'pointer-events:none',
            'max-width:60vw',
            'overflow:hidden',
            'text-overflow:ellipsis',
            'white-space:nowrap'
        ].join(';');


        document.body.appendChild(badge);


        return badge;
    }


    function paintBadge(text) {

        const badge = ensureBadge();


        badge.textContent = text;

        badge.style.display = text ? 'block' : 'none';
    }


    function removeBadge() {

        const badge = document.getElementById(BADGE_ID);


        if (badge) {
            badge.remove();
        }
    }


    // =========================================================
    // 启动
    // =========================================================

    function init() {

        let inputState = freshInputState();

        // 老版本把长按单存一张表，这里把它折进按键表（只做一次）
        let bindings = migrateConfig(GM_getValue, GM_setValue);

        let behaviorCache = behaviorOf(bindings);

        let debug = false;


        function applyConfig(nextBindings) {

            bindings = nextBindings;

            // 存一份预先算好的表，别每帧重建 —— 60fps 乘 15 个动作，
            // 白烧的
            behaviorCache = behaviorOf(bindings);
        }


        // 设置面板改完配置会走这里，当场生效，不用刷新页面。
        liveConfig.onChange = applyConfig;


        document.addEventListener('gamepadconnected', () => {

            // 重连时清掉按住状态 —— 不清的话，上一轮按着的键会被当成
            // 「按住很久了」，重连第一帧就补发一串连发。
            cancelResultWatch();
            inputState = clearInputState();


            /*
             * 事件到了也得再确认一次手柄真的在。角标存在的全部意义就是
             * 「看见它 = 手柄能用了」，画一个出来却发现还没到手，正好
             * 是在误导。
             */
            const pad = activePad();


            if (pad) {
                paintBadge('🎮 ' + describePad(pad));
            }
        });


        document.addEventListener('gamepaddisconnected', () => {

            cancelResultWatch();

            // 同一个道理，反着来：断开时也要清，否则残留的「按住中」
            // 会让重连后立刻开始连发翻页。
            inputState = clearInputState();

            removeBadge();
        });


        // 页面打开时手柄就已经插着：不会有 gamepadconnected 事件补发，
        // 但 getGamepads() 里可能有值。
        if (activePad()) {
            paintBadge('🎮 ' + describePad(activePad()));
        }


        if (typeof GM_registerMenuCommand === 'function') {

            GM_registerMenuCommand('手柄设置…', togglePanel);

            GM_registerMenuCommand('手柄调试日志', () => {

                debug = !debug;

                console.log(
                    '[粉笔手柄] 调试日志已' + (debug ? '打开' : '关闭')
                );
            });
        }


        function tick() {

            /*
             * 页面在后台就完全不动。
             *
             * 切到别的标签页时浏览器本来就会把 rAF 降到几乎不跑，但
             * 主动挡一道更稳：一来省电，二来避免「切回来时 now 跳变」
             * 那一类问题。
             */
            if (document.hidden) {
                requestAnimationFrame(tick);
                return;
            }


            const pad = activePad();


            if (pad) {

                const active = frameInputs(pad, AXIS_DEADZONE);


                /*
                 * 正在录键：把下一个按下沿直接写进配置，不执行动作。
                 * 用 frameInputs 的原始结果而不是状态机的事件 —— 录键
                 * 要的是「用户按了哪个键」，跟那个键原本是什么行为无关。
                 */
                if (pendingBind && active.size) {

                    const key = active.values().next().value;

                    const request = pendingBind;


                    cancelPendingBind();


                    const text = makeBinding(key, request.hold);

                    const next = rebindKey(
                        loadBindings(GM_getValue),
                        request.action,
                        text
                    );


                    saveBindings(GM_setValue, next);

                    applyConfig(next);


                    // 状态清干净，免得这个键被当成「已经按住很久」
                    inputState = clearInputState();


                    renderPanel(next);


                    // 录完得说清录进去的是什么 —— 尤其是「顶掉了别人」
                    // 这种用户看不见的事，不说他会以为键没生效。
                    const action = actionById(request.action);

                    paintHint(
                        bindingLabel(text) + ' → ' +
                        (action ? action.name : request.action)
                    );


                    requestAnimationFrame(tick);
                    return;
                }


                const result = stepInput(
                    inputState,
                    active,
                    performance.now(),
                    behaviorCache
                );


                inputState = result.state;


                for (const event of result.events) {

                    // 状态机已经把动作算好了 —— 一个键可能挂着两件事，
                    // 拿键去反查是查不出唯一答案的
                    const actionId = event.action;


                    if (!actionId) {
                        continue;
                    }


                    if (debug) {
                        console.log(
                            '[粉笔手柄] ' + event.key + ' → ' + actionId +
                            '（' + event.kind + '）'
                        );
                    }


                    runAction(actionId);
                }
            }


            requestAnimationFrame(tick);
        }


        requestAnimationFrame(tick);


        console.log(
            '[粉笔手柄] ' + VERSION +
            ' 已加载 —— 按键映射在右上角油猴菜单的「手柄设置…」里'
        );
    }


    // =========================================================
    // 出口
    //
    // 有 module 就是 Node（跑测试），只导出纯函数；否则是浏览器，启动。
    // =========================================================

    if (typeof module !== 'undefined' && module.exports) {

        module.exports = {
            VERSION: VERSION,

            ACTIONS: ACTIONS,
            ACTION_IDS: ACTION_IDS,
            DEFAULT_BINDINGS: DEFAULT_BINDINGS,

            HOLD_STORAGE_KEY: HOLD_STORAGE_KEY,
            LEGACY_HOLDS: LEGACY_HOLDS,
            foldLegacyHolds: foldLegacyHolds,
            readLegacyHolds: readLegacyHolds,
            migrateConfig: migrateConfig,

            HOLD_PREFIX: HOLD_PREFIX,
            HOLD_MS: HOLD_MS,
            encodeBinding: encodeBinding,
            decodeBinding: decodeBinding,
            makeBinding: makeBinding,
            actionById: actionById,

            STORAGE_KEY: STORAGE_KEY,
            freshBindings: freshBindings,
            loadBindings: loadBindings,
            saveBindings: saveBindings,
            bindKey: bindKey,
            rebindKey: rebindKey,
            unbindKey: unbindKey,
            clashes: clashes,
            behaviorOf: behaviorOf,

            AXIS_DEADZONE: AXIS_DEADZONE,
            axisDir: axisDir,
            frameInputs: frameInputs,

            REPEAT: REPEAT,
            CLOCK_JUMP_MS: CLOCK_JUMP_MS,
            freshInputState: freshInputState,
            clearInputState: clearInputState,
            stepInput: stepInput,

            QUESTION_SELECTOR: QUESTION_SELECTOR,
            CHOICE_LABEL_SELECTOR: CHOICE_LABEL_SELECTOR,
            ANSWERABLE_SELECTOR: ANSWERABLE_SELECTOR,
            SOLUTION_TOGGLE_CLASS: SOLUTION_TOGGLE_CLASS,
            ASK_AI_CLASS: ASK_AI_CLASS,
            CURRENT_QUESTION_ATTR: CURRENT_QUESTION_ATTR,
            AI_HOST_ID: AI_HOST_ID,
            AI_HIDDEN_ATTR: AI_HIDDEN_ATTR,
            AI_OPEN_CLASS: AI_OPEN_CLASS,
            AI_CLOSED_CLASS: AI_CLOSED_CLASS,
            DIALOG_SELECTOR: DIALOG_SELECTOR,
            DIALOG_BUTTON_SELECTOR: DIALOG_BUTTON_SELECTOR,
            SCROLL_STEP_RATIO: SCROLL_STEP_RATIO,

            CURSOR_CLASS: CURSOR_CLASS,
            questions: questions,
            currentIndex: currentIndex,
            findCurrentQuestionIndex: findCurrentQuestionIndex,
            isEditableFocused: isEditableFocused,
            choiceLabels: choiceLabels,
            dialogBar: dialogBar,
            dialogButtons: dialogButtons,
            dialogOpen: dialogOpen,
            clickDialogCancel: clickDialogCancel,
            cursorContext: cursorContext,
            moveCursor: moveCursor,
            confirmChoice: confirmChoice,
            resetCursor: resetCursor,
            gotoQuestion: gotoQuestion,
            stepToQuestion: stepToQuestion,
            solutionToggle: solutionToggle,
            clickExpandToggle: clickExpandToggle,
            clickAskAi: clickAskAi,
            clickFinish: clickFinish,
            FINISH_SELECTOR: FINISH_SELECTOR,
            toggleAiPanel: toggleAiPanel,
            runAction: runAction,

            RESULT_CLASSES: RESULT_CLASSES,
            VIBRATION: VIBRATION,
            buzz: buzz,
            playVibration: playVibration,
            watchResult: watchResult,
            cancelResultWatch: cancelResultWatch,
        };

    } else {

        init();
    }
})();
