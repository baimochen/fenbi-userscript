// 交卷那条路的端到端：按交卷 → 弹窗出来 → 十字键选 → 按确认。
//
// 用户的原话：「点交卷会有弹窗，你需要让我可以用方向键选择确定或者取消，
// 然后复用选项的那个点击逻辑」。
//
// 真页面上弹窗是粉笔的 Angular 在点完交卷之后现建的（存档的静态页面里
// 一个 .modal-* 都没有）。所以这里把这一步接上：点 .submit-btn 就插一个
// 弹窗进来，点弹窗上任何一个按钮就把它摘掉 —— 跟真页面一模一样。
//
// 量的是三件事：弹窗里的按钮真被点到了；没挪光标时默认是「取消」；
// 弹窗开着的时候，底下那道题一根汗毛都没动（答错了不可逆）。
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { fixturePath, fixtureExists, buildFixture } from './test/make-fixture.mjs';
if (!fixtureExists()) buildFixture();

// 用户从运行中的页面上抄下来的，一个字没改
const DIALOG = `
<div class="modal-body ng-tns-c3547082236-206 ng-trigger ng-trigger-zoomBigMotion modal-alert-bg-image bg-image">
  <div class="modal-title ng-tns-c3547082236-206">确认交卷?</div>
  <div class="modal-action ng-tns-c3547082236-206">
    <button class="modal-action-btn btn-cancel ng-tns-c3547082236-206 ng-star-inserted" style="">取消</button>
    <button class="modal-action-btn btn-submit theme-box-shadow-inset-blue ng-tns-c3547082236-206"> 确认 </button>
  </div>
</div>`;

// 手柄上的几个键，照默认映射
const DOWN = 13, CONFIRM = 0, BACK = 8, FINISH = 11;

function boot() {
    const dom = new JSDOM(readFileSync(fixturePath(),'utf8'), {
        url:'https://spa.fenbi.com/ti/memorize/practice', runScripts:'outside-only', pretendToBeVisual:true });
    const win = dom.window, doc = win.document, prefs={};

    // 交卷按钮（真结构：div.submit-btn），点它就当弹窗弹出来
    doc.body.insertAdjacentHTML('beforeend', '<div class="submit-btn"><svg></svg>交卷</div>');

    // 当前题定在第 2 题（有 ul.allow 的那道）—— 不写属性的话脚本事先
    // 会去猜，而 jsdom 没有布局，猜出来永远是第 1 题（不可作答的那道），
    // 「底下那道题没被动过」就成了空断言。
    doc.documentElement.setAttribute('data-fbai-current-question', '1');

    let raf=[], now=0;
    const slots=[null];
    const mkPad = b => ({ id:'Pad', mapping:'standard', connected:true, index:0,
        buttons: Array.from({length:17},(_,i)=>({pressed:!!b[i],value:b[i]?1:0})), axes:[0,0,0,0] });
    slots[0]=mkPad({});
    Object.defineProperty(win.navigator,'getGamepads',{configurable:true,value:()=>slots.slice()});
    win.requestAnimationFrame = cb => raf.push(cb);
    win.cancelAnimationFrame = () => {};
    Object.defineProperty(win.performance,'now',{configurable:true,value:()=>now});
    win.Date.now = () => now;
    win.GM_getValue=(k,f)=>(k in prefs?prefs[k]:f);
    win.GM_setValue=(k,v)=>{prefs[k]=v;};
    win.GM_registerMenuCommand=()=>1;
    win.console={...win.console,log:()=>{},warn:()=>{}};

    // 数点击。元素点完就没了，所以数的是计数器不是节点。
    let submits=0, cancels=0, confirms=0, answers=0;

    const onSubmit = () => { submits++; doc.body.insertAdjacentHTML('beforeend', DIALOG); wire(); };
    doc.querySelector('.submit-btn').addEventListener('click', onSubmit);

    function wire() {
        doc.querySelectorAll('.modal-action-btn').forEach(node => {
            node.addEventListener('click', () => {
                if (node.classList.contains('btn-cancel')) cancels++;
                else confirms++;
                const bar = doc.querySelector('.modal-action');
                if (bar) bar.remove();
            });
        });
    }

    doc.querySelectorAll('label.choice-radio-label, label.choice-checkbox-label')
        .forEach(node => node.addEventListener('click', () => answers++));

    win.eval(readFileSync('fenbi-gamepad.user.js','utf8'));
    doc.dispatchEvent(new win.Event('gamepadconnected'));

    const step=(ms=16)=>{now+=ms;const d=raf;raf=[];for(const cb of d)cb(now);};
    const tap=k=>{ slots[0]=mkPad({[k]:true}); step(); slots[0]=mkPad({}); step(); };

    return { win, doc, tap,
        counts: () => ({ submits, cancels, confirms, answers }),
        dialogOpen: () => !!doc.querySelector('.modal-action'),
        cursorOn: () => { const n = doc.querySelector('.fbgp-cursor');
            return n ? n.textContent.trim() : null; } };
}

const out=[];
const check=(l,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want); out.push(ok);
    console.log((ok?'  ok  ':'  FAIL')+' '+l+(ok?'':`  得到 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}`)); };

console.log('== 按交卷 → 弹窗出来 ==');
{ const g = boot();
  g.tap(FINISH);
  check('点到了交卷按钮', g.counts().submits, 1);
  check('弹窗弹出来了', g.dialogOpen(), true); }

console.log('== 不改键位：回到长按 Start 交卷 ==');
{ const g = boot();
  g.tap(9);                       // 短按 Start 是开关 AI，这里只确认它不交卷
  check('短按 Start 没交卷', g.counts().submits, 0); }

console.log('== ↓↓ 然后确认 = 确定（交卷）==');
{ const g = boot();
  g.tap(FINISH);
  g.tap(DOWN);
  check('第一下 ↓ 进场，停在「取消」上', g.cursorOn(), '取消');
  g.tap(DOWN);
  check('第二下 ↓ 挪到「确认」', g.cursorOn(), '确认');
  check('底下那道题没被动过', g.counts().answers, 0);
  g.tap(CONFIRM);
  const c = g.counts();
  check('点到了「确认」', c.confirms, 1);
  check('没点到「取消」', c.cancels, 0);
  check('弹窗关掉了', g.dialogOpen(), false);
  check('全程没答题', c.answers, 0); }

console.log('== 不挪光标直接确认 = 取消（默认落在安全的那边）==');
{ const g = boot();
  g.tap(FINISH);
  g.tap(CONFIRM);
  const c = g.counts();
  check('点到的是「取消」', c.cancels, 1);
  check('没有交卷', c.confirms, 0); }

console.log('== 弹窗开着时按 Back = 取消，不是退回上一页 ==');
{ const g = boot();
  g.tap(FINISH);
  g.tap(BACK);                    // 物理 Back 键，默认挂的是「设置/帮助」
  const c = g.counts();
  // jsdom 的 history.back() 会往 virtualConsole 报错，真发生了这里也会红
  check('点到的是「取消」', c.cancels, 1);
  check('弹窗关掉了', g.dialogOpen(), false);
  check('没顺手把设置面板开出来', !!g.doc.getElementById('fbgp-panel'), false); }

console.log('== 摇杆下压（回退网页）也是取消 ==');
{ const g = boot();
  g.tap(FINISH);
  g.tap(10);                      // L3 = 回退网页
  check('点到的是「取消」', g.counts().cancels, 1);
  check('弹窗关掉了', g.dialogOpen(), false); }

console.log('== 弹窗开着时别的键一律不理 ==');
{ const g = boot();
  g.tap(FINISH);
  g.tap(15);                      // 下一题
  g.tap(6);                       // 提交（多选）
  g.tap(0);                       // 确认 —— 这个是该应的，放最后
  const c = g.counts();
  check('下一题 / 提交都没落到页面上', c.answers, 0);
  check('最后那下确认点的是「取消」', c.cancels, 1); }

let bad=out.filter(x=>!x).length;
console.log(`\n通过 ${out.length-bad}/${out.length}`);
process.exit(bad?1:0);
