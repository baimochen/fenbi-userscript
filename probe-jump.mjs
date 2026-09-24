// 答题卡跳题浮层的两条集成断言：
//   1. 跳过去之后，紧接着的确认要答在**跳过去那道**上（接 Task 11 的契约）
//   2. 浮层开着的时候，面键 0 是「跳过去」，不是「选选项」
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { fixturePath, fixtureExists, buildFixture } from './test/make-fixture.mjs';
if (!fixtureExists()) buildFixture();

function boot(attr) {
    const dom = new JSDOM(readFileSync(fixturePath(),'utf8'), {
        url:'https://spa.fenbi.com/ti/memorize/practice', runScripts:'outside-only', pretendToBeVisual:true });
    const win = dom.window, prefs={};
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
    const jumped=[];
    [...win.document.querySelectorAll('app-answer-card app-answer-button .answer-btn')]
        .forEach((b,i)=>b.addEventListener('click',()=>jumped.push(i)));
    win.eval(readFileSync('fenbi-gamepad.user.js','utf8'));
    win.document.dispatchEvent(new win.Event('gamepadconnected'));
    if (attr !== undefined) win.document.documentElement.setAttribute('data-fbai-current-question', attr);
    const step=()=>{now+=16;const d=raf;raf=[];for(const cb of d)cb(now);};
    const tap=k=>{ slots[0]=mkPad({[k]:true}); step(); slots[0]=mkPad({}); step(); };
    const panel=()=>win.document.getElementById('fbgp-jump');
    return { win, tap, jumped, panel,
        on: () => { const p=panel(); return p && p.shadowRoot.querySelector('.cell.on')?.dataset.jump; },
        title: () => panel() && panel().shadowRoot.querySelector('.title').textContent,
        answered: () => [...win.document.querySelectorAll('app-ti')]
            .findIndex(t => [...t.querySelectorAll('input')].some(n => n.checked)) };
}

const results=[];
const check=(l,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want); results.push(ok);
    console.log((ok?'  ok  ':'  FAIL')+' '+l+(ok?'':`  得到 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}`)); };

// 1) 跳过去之后，确认要落在跳过去那道
{ const g = boot('1');            // 当前第 2 题（index 1）
  g.tap(5);                       // RB 开浮层
  g.tap(15); g.tap(15);           // → → 挪到 index 3
  check('浮层里挪到了 index 3', g.on(), '3');
  g.tap(0);                       // 面键 0 跳过去
  check('浮层关掉', !!g.panel(), false);
  check('跳题点的是答题卡第 4 个按钮', g.jumped, [3]);
  g.tap(0);                       // 再确认 —— 该答在跳过去那道
  check('跳完之后确认答在跳过去那道', g.answered(), 3); }

// 2) 浮层开着的时候，面键 0 是「跳过去」，不是「选选项」—— 别把当前题答了
{ const g = boot('1');
  g.tap(5);
  g.tap(0);
  check('面键 0 在浮层里只跳题，不答题', g.answered(), -1); }

// 3) 浮层开着时，↑ ↓ 是挪十题，不是移选项光标
{ const g = boot('0');
  g.tap(5);
  g.tap(13);
  check('↓ 在浮层里挪十题（夹在最后一题）', g.on(), '4');
  check('没有选项光标被画出来', g.win.document.querySelectorAll('.fbgp-cursor').length, 0); }

// 4) Back 关浮层，但不该顺手把网页也回退了
{ const g = boot('1');
  let wentBack = false;
  g.win.history.back = () => { wentBack = true; };
  g.tap(5);
  g.tap(8);
  check('Back 关掉浮层', !!g.panel(), false);
  check('关浮层时不回退网页', wentBack, false); }

let bad=results.filter(x=>!x).length;
console.log(`\n通过 ${results.length-bad}/${results.length}`);
process.exit(bad?1:0);
