// 当前题号：四种情形。验的是同一条不变量 ——
//
//   **翻到哪道题，紧接着的确认就答在哪道题上。**
//
// 不写死题号：起点由当前题号怎么算出来决定（没属性时 jsdom 里启发式恒
// 给 0），写死的话测的就不是不变量而是我自己的算术了。
//
// 第一条最要命：属性还在布局脚本 250ms 缓存里，信了它就会答到上一题，
// 而答完即锁，不可撤销。
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { fixturePath, fixtureExists, buildFixture } from './test/make-fixture.mjs';
if (!fixtureExists()) buildFixture();

const ATTR = 'data-fbai-current-question';

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
    // 翻题时点了答题卡第几个按钮 —— 那就是脚本认为的「翻到了第几题」
    const jumped=[];
    [...win.document.querySelectorAll('app-answer-card app-answer-button .answer-btn')]
        .forEach((b,i)=>b.addEventListener('click',()=>jumped.push(i)));
    win.eval(readFileSync('fenbi-gamepad.user.js','utf8'));
    win.document.dispatchEvent(new win.Event('gamepadconnected'));
    if (attr !== undefined) win.document.documentElement.setAttribute(ATTR, attr);
    const step=()=>{now+=16;const d=raf;raf=[];for(const cb of d)cb(now);};
    const tap=k=>{ slots[0]=mkPad({[k]:true}); step(); slots[0]=mkPad({}); step(); };
    return { win, tap, jumped, setAttr: v => win.document.documentElement.setAttribute(ATTR, v),
        answered: () => [...win.document.querySelectorAll('app-ti')]
            .findIndex(t => [...t.querySelectorAll('input')].some(n => n.checked)) };
}

const results=[];
const check=(l,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want); results.push(ok);
    console.log((ok?'  ok  ':'  FAIL')+' '+l+(ok?'':`  得到 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}`)); };

// 1) 属性还停在旧值（布局脚本 250ms 缓存，命中时还把这个旧值原样再写一遍）
{ const g = boot('1');
  g.tap(15);
  g.setAttr('1');                 // 缓存命中：旧值被原样回写
  g.tap(0);
  check('属性是旧值时，答的是翻过去那道', g.answered(), g.jumped[0]); }

// 2) 压根没装布局脚本（没有属性）
{ const g = boot();
  g.tap(15);
  g.tap(0);
  check('没有属性时，自持索引照样管用', g.answered(), g.jumped[0]); }

// 3) 属性是新的、且没人翻过 —— 该信属性
{ const g = boot('2');
  g.tap(0);
  check('属性可信时听属性的', g.answered(), 2); }

// 4) 属性是空串 —— Number('') 是 0，别被当成「第 1 题」
{ const g = boot('');
  g.tap(15);
  g.tap(0);
  check('属性是空串时不被当成第 0 题', g.answered(), g.jumped[0]); }

let bad=results.filter(x=>!x).length;
console.log(`\n通过 ${results.length-bad}/${results.length}`);

// 计划 Task 11 那条测试里的两个具体数值，单独确认一下
{
  const g = boot('1');
  g.tap(15);
  console.log(`\n[计划断言核对] 属性='1' 时翻题点到答题卡第 ${g.jumped[0]} 个按钮`);
  g.setAttr('1');
  g.tap(13); g.tap(0);
  console.log(`[计划断言核对] 确认后勾中的是第 ${g.answered()} 道`);
}
