// 交卷弹窗也要能用十字键选。
//
// 用户的原话：「点交卷会有弹窗，你需要让我可以用方向键选择确定或者取消，
// 然后复用选项的那个点击逻辑」。所以这里不新造一套，盯的是**复用**：
// 同一套 moveCursor / confirmChoice，只是落脚处换成了弹窗按钮。
//
// 弹窗的 DOM 是用户从运行中的页面上抄下来的。脚本里本来没有 —— 存下来的
// 静态页面里一个 .modal-* 都没有，那是 Angular 用 *ngIf 现建的。这条
// 决定了「在 DOM 里」就等于「开着」，所以下面的夹具都是整个塞进去 / 整个
// 摘掉，而不是切 display。
//
// 最要命的一条在最后：弹窗盖在题目上，这时候按确认**不能**漏到底下那道
// 题上 —— 弹窗开着的时候用户根本没在看题，而答错了不可逆。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadModule, ROOT } from './harness.mjs';

const api = loadModule(ROOT + '/fenbi-gamepad.user.js');

// 用户抄下来的那两个按钮，类名一字不改（btn-submit 上还带着主题类，
// 确认按钮的文字两边还有空格）
const DIALOG = `
    <div class="modal-body modal-alert-bg-image bg-image">
        <div class="modal-title">确认交卷?</div>
        <div class="modal-action">
            <button class="modal-action-btn btn-cancel">取消</button>
            <button class="modal-action-btn btn-submit theme-box-shadow-inset-blue"> 确认 </button>
        </div>
    </div>`;

const QUESTION = `
    <app-ti>
        <div class="ti-container">
            <ul class="choice-radios allow">
                <li><label class="choice-radio-label">甲</label></li>
                <li><label class="choice-radio-label">乙</label></li>
            </ul>
        </div>
    </app-ti>`;

/*
 * 把 document / window / history 都摆好再调脚本里的函数。
 *
 * history 必须是个桩：脚本里 runAction('back') 会调 history.back()，而
 * Node 里没有 history 这个全局 —— 弹窗那条路要是漏了拦截，测试会以
 * ReferenceError 的形式炸出来，而不是悄悄放行。这正好也是想验的东西。
 */
function withDom(html, fn) {

    const dom = new JSDOM('<!doctype html><body>' + html + '</body>');

    const saved = {
        document: global.document,
        window: global.window,
        history: global.history
    };

    let navigated = 0;

    global.document = dom.window.document;
    global.window = dom.window;
    global.history = { back: () => { navigated += 1; } };

    // 当前题由布局脚本写在属性上，不写的话脚本会去猜，而 jsdom 没有布局
    dom.window.document.documentElement.setAttribute(
        api.CURRENT_QUESTION_ATTR,
        '0'
    );

    // 点弹窗按钮 → 弹窗当场被摘掉，真页面上就是这样的
    wireClose(dom.window.document);

    try {

        return fn(dom.window.document, () => navigated);

    } finally {

        for (const key of Object.keys(saved)) {

            if (saved[key] === undefined) {
                delete global[key];
            } else {
                global[key] = saved[key];
            }
        }
    }
}

/*
 * 数点了几下。
 *
 * 抓住节点再数，不数选择器 —— 点完弹窗按钮弹窗就没了，这时候再
 * doc.querySelector('.btn-submit') 拿到的是 null，永远数出 0，
 * 而 0 正是「没被点到」，会绿得莫名其妙。
 */
function watch(doc) {

    const counts = new Map();

    const count = node => counts.get(node) || 0;


    const hook = selector => {

        const nodes = [...doc.querySelectorAll(selector)];

        nodes.forEach(node => {

            counts.set(node, 0);

            node.addEventListener('click', () => {
                counts.set(node, counts.get(node) + 1);
            });
        });


        return nodes;
    };


    const cancel = hook('.btn-cancel');
    const submit = hook('.btn-submit');
    const choices = hook('label.choice-radio-label');


    return {
        cancel: () => cancel.reduce((sum, node) => sum + count(node), 0),
        submit: () => submit.reduce((sum, node) => sum + count(node), 0),
        choices: () => choices.reduce((sum, node) => sum + count(node), 0),
        total: () => count
    };
}

function closeDialog(doc) {

    const bar = doc.querySelector(api.DIALOG_SELECTOR);

    if (bar) {
        bar.remove();
    }
}

/*
 * 真页面上点弹窗按钮，弹窗是当场被摘掉的（*ngIf）。夹具里得自己接上
 * 这一步 —— 不接的话「点完光标有没有清掉」根本验不了，因为那个分支
 * 只在弹窗消失时才走到。
 */
function wireClose(doc) {

    doc.querySelectorAll(api.DIALOG_BUTTON_SELECTOR).forEach(node => {

        node.addEventListener('click', () => closeDialog(doc));
    });
}


// 关掉再开一个新的 —— 是新的 DOM 节点，不是把原来那个放回来
function reopenDialog(doc) {

    doc.body.insertAdjacentHTML('beforeend', DIALOG);

    wireClose(doc);
}


describe('认出弹窗', () => {

    test('那两个按钮都在（取消在前、确认在后）', () => {

        withDom(QUESTION + DIALOG, doc => {

            const buttons = api.dialogButtons();

            assert.equal(buttons.length, 2);
            assert.equal(buttons[0].textContent.trim(), '取消');
            assert.equal(buttons[1].textContent.trim(), '确认');
        });
    });

    test('没有弹窗的时候是空的', () => {

        withDom(QUESTION, doc => {
            assert.deepEqual(api.dialogButtons(), []);
            assert.equal(api.dialogOpen(), false);
        });
    });

    test('叠了两层就认最上面那层', () => {

        withDom(QUESTION + DIALOG + DIALOG, doc => {

            const buttons = api.dialogButtons();

            assert.equal(buttons.length, 2);

            // 取的是文档里最后那一组
            assert.equal(
                buttons[0],
                doc.querySelectorAll(api.DIALOG_SELECTOR + ' button')[2]
            );
        });
    });

    test('别的弹窗（不是按钮排的那种）不算', () => {

        withDom(
            QUESTION +
            '<div class="modal-action"><p>只有一段说明</p></div>',
            () => {
                assert.equal(api.dialogOpen(), false);
            }
        );
    });
});


describe('十字键在弹窗里', () => {

    test('弹窗开着时光标落在弹窗上，不落在选项上', () => {

        withDom(QUESTION + DIALOG, doc => {

            assert.match(api.cursorContext().scope, /^dialog:/);

            api.moveCursor(1);

            assert.ok(
                doc.querySelector('.btn-cancel').classList.contains(api.CURSOR_CLASS),
                '按了 ↓ 却没在弹窗按钮上画光标'
            );


            // 外框只能有一个 —— 弹窗和题目同时被画上，说明落脚处选错了
            assert.equal(doc.querySelectorAll('.' + api.CURSOR_CLASS).length, 1);

            assert.equal(
                doc.querySelector('label.choice-radio-label')
                    .classList.contains(api.CURSOR_CLASS),
                false,
                '弹窗开着，光标却画到底下的选项上去了'
            );
        });
    });

    test('↓ 从取消挪到确认', () => {

        withDom(QUESTION + DIALOG, doc => {

            const clicks = watch(doc);

            api.moveCursor(1);
            api.moveCursor(1);
            api.confirmChoice();

            assert.equal(clicks.submit(), 1);
            assert.equal(clicks.cancel(), 0);
        });
    });

    test('↑ 进场就停在最后一个 —— 跟选项那边一个规矩', () => {

        withDom(QUESTION + DIALOG, doc => {

            const clicks = watch(doc);

            api.moveCursor(-1);
            api.confirmChoice();

            assert.equal(clicks.submit(), 1);
        });
    });

    test('挪一圈会绕回来，不卡在头上', () => {

        withDom(QUESTION + DIALOG, doc => {

            const clicks = watch(doc);

            api.moveCursor(1);
            api.moveCursor(1);
            api.moveCursor(1);   // 取消 → 确认 → 绕回取消

            api.confirmChoice();

            assert.equal(clicks.cancel(), 1);
        });
    });

    test('弹窗关掉之后光标回到题目上，不留在按钮上', () => {

        withDom(QUESTION + DIALOG, doc => {

            api.moveCursor(1);

            const button = doc.querySelector('.btn-cancel');

            closeDialog(doc);

            assert.equal(api.cursorContext().scope, 'q:0');

            api.moveCursor(1);

            assert.ok(
                doc.querySelector('label.choice-radio-label')
                    .classList.contains(api.CURSOR_CLASS),
                '弹窗没了，光标该回到选项上'
            );

            assert.equal(
                button.classList.contains(api.CURSOR_CLASS),
                false,
                '弹窗都关了，选中框还挂在那个按钮上'
            );
        });
    });
});


describe('默认停在取消上', () => {

    test('没挪过光标就按确认 = 取消（连按两下最多是取消）', () => {

        withDom(QUESTION + DIALOG, doc => {

            const clicks = watch(doc);

            api.confirmChoice();

            assert.equal(clicks.cancel(), 1);
            assert.equal(clicks.submit(), 0);
        });
    });

    /*
     * 弹窗关掉再开是一个**新的 DOM 节点**，可它跟上一个长得一模一样。
     * 光标要是只按「在弹窗里」来判断落脚处，上一次停在「确认」上的位置
     * 就会带到这一次来 —— 而这一次的第一下本该是「取消」。
     *
     * 触发路径很平常：用户用鼠标把弹窗点掉（没走手柄），过一会儿再交卷。
     */
    test('弹窗关了又开，光标从头进场 —— 默认还是取消', () => {

        withDom(QUESTION + DIALOG, doc => {

            api.moveCursor(1);
            api.moveCursor(1);      // 停在「确认」上，但没按

            closeDialog(doc);       // 鼠标关掉的，手柄不知道
            reopenDialog(doc);

            const clicks = watch(doc);

            api.runAction('confirm');

            assert.equal(
                clicks.cancel(),
                1,
                '上一次停在「确认」上，这一次一按确认就把卷交了'
            );
            assert.equal(clicks.submit(), 0);
        });
    });

    test('点完弹窗按钮，光标立刻清掉（按钮已经不在文档里了）', () => {

        withDom(QUESTION + DIALOG, doc => {

            const button = doc.querySelector('.btn-cancel');

            api.confirmChoice();

            assert.equal(
                doc.querySelector(api.DIALOG_SELECTOR),
                null,
                '夹具没把弹窗关掉，下面那条就白测了'
            );

            assert.equal(
                button.classList.contains(api.CURSOR_CLASS),
                false,
                '点完还把外框画回去，画的是一个已经摘掉的节点'
            );
        });
    });
});


describe('弹窗开着的时候是模态的', () => {

    test('按确认只点弹窗，绝不碰下面那道题', () => {

        withDom(QUESTION + DIALOG, doc => {

            const clicks = watch(doc);

            api.runAction('confirm');

            assert.equal(
                clicks.choices(),
                0,
                '弹窗盖着题呢，确认漏到底下去了 —— 那是在用户看不见的地方答题'
            );
        });
    });

    test('Back 是「取消」，不是「退回上一页」', () => {

        withDom(QUESTION + DIALOG, (doc, navigated) => {

            const clicks = watch(doc);

            api.runAction('back');

            assert.equal(clicks.cancel(), 1);

            assert.equal(
                navigated(),
                0,
                'Back 退网页了 —— 弹窗开着的时候用户想的是关掉它，' +
                '真退回去会把整套练习的进度丢掉'
            );
        });
    });

    /*
     * 默认映射里物理 Back 键是挂在 help（设置/帮助）上的，回退网页在
     * 摇杆下压。所以只认 back 的话，用户按 Back 会发现弹窗关不掉 ——
     * 那是这条路上最容易漏的一处。
     */
    test('按物理 Back 键（默认是 help）也关得掉', () => {

        withDom(QUESTION + DIALOG, doc => {

            const clicks = watch(doc);

            api.runAction('help');

            assert.equal(clicks.cancel(), 1);
        });
    });

    test('别的动作一律不理（免得隔着一层弹窗操作页面）', () => {

        withDom(QUESTION + DIALOG, (doc, navigated) => {

            const clicks = watch(doc);

            for (const action of ['submit', 'next', 'prev', 'jump', 'finish', 'expand']) {
                api.runAction(action);
            }

            assert.equal(
                clicks.cancel() + clicks.submit() + clicks.choices(),
                0
            );
            assert.equal(navigated(), 0);
        });
    });

    test('弹窗关了就恢复正常：确认又是选选项', () => {

        withDom(QUESTION + DIALOG, doc => {

            const clicks = watch(doc);

            closeDialog(doc);

            api.runAction('confirm');

            assert.equal(clicks.choices(), 1);
        });
    });
});


describe('认不出「取消」两个字也得能关掉', () => {

    test('文案换了就退回第一个按钮 —— 那是取消的位置', () => {

        withDom(
            QUESTION +
            '<div class="modal-action">' +
            '<button class="modal-action-btn btn-cancel">再想想</button>' +
            '<button class="modal-action-btn btn-submit">交卷</button>' +
            '</div>',
            doc => {

                const clicks = watch(doc);

                api.clickDialogCancel();

                assert.equal(clicks.cancel(), 1);
                assert.equal(
                    clicks.submit(),
                    0,
                    '认不出「取消」就点到确认上了 —— 按 Back 反而交卷，' +
                    '比不生效糟得多'
                );
            }
        );
    });

    test('压根没有弹窗时不炸', () => {

        withDom(QUESTION, () => {
            assert.equal(api.clickDialogCancel(), false);
        });
    });
});
