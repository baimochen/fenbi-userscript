// Start 键（button:9）的两条分支：短按开关 AI 面板，按住 1 秒交卷。
//
// 开关面板这条原来验的是「手柄发没发出去那个 fbai-toggle 事件」。那条
// 事件信道已经拆了 —— 现在手柄跟点别的按钮一样，去点侧边栏上那个按钮。
// 所以这里不做假设了，**真把侧边栏跑起来**，看短按之后面板是不是真的
// 收起来了。
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { fixturePath, fixtureExists, buildFixture } from './test/make-fixture.mjs';
if (!fixtureExists()) buildFixture();

function boot(extraHtml = '') {
    const dom = new JSDOM(readFileSync(fixturePath(),'utf8'), {
        url:'https://spa.fenbi.com/ti/memorize/practice', runScripts:'outside-only', pretendToBeVisual:true });
    const win = dom.window, prefs={};
    if (extraHtml) win.document.body.insertAdjacentHTML('beforeend', extraHtml);
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
    const logs=[];
    win.console={...win.console,log:(...a)=>logs.push(a.join(' ')),warn:()=>{}};

    // 真侧边栏，不是替身 —— 这两份脚本之间的接缝正是要验的东西
    win.eval(readFileSync('fenbi-ai-sidebar.user.js','utf8'));
    win.eval(readFileSync('fenbi-gamepad.user.js','utf8'));
    win.document.dispatchEvent(new win.Event('gamepadconnected'));

    const step=(ms=16)=>{now+=ms;const d=raf;raf=[];for(const cb of d)cb(now);};
    const tap=k=>{ slots[0]=mkPad({[k]:true}); step(); slots[0]=mkPad({}); step(); };
    const holdFor=(k,ms)=>{ slots[0]=mkPad({[k]:true}); step(); for(let t=0;t<ms;t+=16) step(); slots[0]=mkPad({}); step(); };

    const host = () => win.document.getElementById('fbai-panel');
    const shadow = () => { const h = host(); return h ? h.shadowRoot : null; };

    return { win, prefs, tap, holdFor, logs,
        // 面板收着没有 —— 以宿主上那个属性为准，手柄看的就是它
        hidden: () => host() && host().getAttribute('data-fbai-hidden') === '1',
        wrapShown: () => { const w = shadow() && shadow().querySelector('.wrap');
            return w ? w.style.display !== 'none' : null; },
        tabCount: () => shadow() ? shadow().querySelectorAll('.fbai-tab').length : -1 };
}

const out=[];
const check=(l,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want); out.push(ok);
    console.log((ok?'  ok  ':'  FAIL')+' '+l+(ok?'':`  得到 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}`)); };

console.log('== 短按 Start = 开关 AI 面板 ==');
{ const g = boot();
  check('侧边栏真的跑起来了', !!g.win.document.getElementById('fbai-panel'), true);
  check('一开始是展开的', g.hidden(), false);

  g.tap(9);
  check('短按之后收起来了', g.hidden(), true);
  check('页面上那块面板不见了', g.wrapShown(), false);
  check('边上留了一个小标', g.tabCount(), 1);

  g.tap(9);
  check('再短按又展开', g.hidden(), false);
  check('小标自己收掉了', g.tabCount(), 0); }

console.log('== 长按 Start = 交卷 ==');
// 粉笔真正的交卷按钮：<div class="submit-btn">，不是 button/a。
{ const g = boot('<div class="submit-btn"><svg></svg>交卷</div>');
  let clicked=0;
  g.win.document.querySelector('.submit-btn').addEventListener('click',()=>clicked++);
  g.holdFor(9, 1200);
  check('长按 1.2 秒点到了交卷按钮', clicked, 1);
  check('长按不夹杂面板开关', g.hidden(), false); }

let bad=out.filter(x=>!x).length;
console.log(`\n通过 ${out.length-bad}/${out.length}`);
process.exit(bad?1:0);
