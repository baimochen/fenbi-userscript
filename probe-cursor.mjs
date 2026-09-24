import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { fixturePath, fixtureExists, buildFixture } from './test/make-fixture.mjs';
if (!fixtureExists()) buildFixture();
const out = [];
const check = (l, got, want) => { const a=JSON.stringify(got),b=JSON.stringify(want); out.push(a===b);
    console.log((a===b?'  ok  ':'  FAIL')+' '+l+(a===b?'':`  得到 ${a}，期望 ${b}`)); };

function boot() {
    const dom = new JSDOM(readFileSync(fixturePath(),'utf8'), {
        url:'https://spa.fenbi.com/ti/memorize/practice', runScripts:'outside-only', pretendToBeVisual:true });
    const win = dom.window, prefs = {}, logs = [];
    let raf=[], now=0, armed=null;
    const slots=[null];
    const mkPad = btn => { const p = { id:'Pad', mapping:'standard', connected:true, index:0,
        buttons: Array.from({length:17},(_,i)=>({pressed:!!btn[i],value:btn[i]?1:0})), axes:[0,0,0,0] };
        Object.defineProperty(p,'vibrationActuator',{configurable:true,get:()=>armed}); return p; };
    const setPad = b => { slots[0] = mkPad(b); };
    setPad({});
    Object.defineProperty(win.navigator,'getGamepads',{configurable:true,value:()=>slots.slice()});
    win.requestAnimationFrame = cb => raf.push(cb);
    win.cancelAnimationFrame = () => {};
    Object.defineProperty(win.performance,'now',{configurable:true,value:()=>now});
    win.Date.now = () => now;
    win.GM_getValue = (k,f) => (k in prefs ? prefs[k] : f);
    win.GM_setValue = (k,v) => { prefs[k]=v; };
    win.GM_registerMenuCommand = () => 1;
    win.console = { ...win.console, log:(...a)=>logs.push(a.join(' ')), warn:()=>{} };
    win.eval(readFileSync('fenbi-gamepad.user.js','utf8'));
    win.document.dispatchEvent(new win.Event('gamepadconnected'));
    const step = (ms=16) => { now+=ms; const d=raf; raf=[]; for (const cb of d) cb(now); };
    const tap = k => { setPad({[k]:true}); step(); setPad({}); step(); };
    const api = { win, prefs, logs, setPad, step, tap,
        arm: a => { armed = a; },
        setQ: i => win.document.documentElement.setAttribute('data-fbai-current-question', String(i)),
        q: i => win.document.querySelectorAll('app-ti')[i],
        labels: i => [...win.document.querySelectorAll('app-ti')[i]
            .querySelectorAll('label.choice-radio-label, label.choice-checkbox-label')],
        inputs: i => [...win.document.querySelectorAll('app-ti')[i]
            .querySelectorAll('label.choice-radio-label, label.choice-checkbox-label')]
            .map(l => l.querySelector('input')),
        checked: i => api.inputs(i).map(n => n.checked),
        cursorAt(i) { const ls = api.labels(i); return ls.findIndex(l => l.classList.contains('fbgp-cursor')); },
        cursorCount: () => win.document.querySelectorAll('.fbgp-cursor').length,
        // 给一题加一个选项（夹具里最多 4 个，用户要的是 5+）。
        //
        // clone 出来的 label 的 for 还指着原来那个 input 的 id —— 不改的话
        // 点新选项的 label 会去勾第一个（浏览器的 for 解析），看着像「确认识别
        // 错选项」，其实是夹具没造好：真实页面每个选项的 id 都是唯一的。
        addOption(i) {
            const ul = api.q(i).querySelector('ul.choice-checkboxs, ul.choice-radios');
            const li = ul.querySelector('li');
            const clone = li.cloneNode(true);
            const n = ul.querySelectorAll('li').length;
            const input = clone.querySelector('input');
            const label = clone.querySelector('label');
            const id = 'added-' + i + '-' + n;
            input.id = id;
            input.checked = false;
            if (label) label.setAttribute('for', id);
            ul.appendChild(clone);
            return ul.querySelectorAll('li').length;
        } };
    return api;
}

const Q = { locked:0, multi:1, uncertain:2, judge:3, blank:4 };

console.log('== 光标移动 ==');
{ const g = boot(); g.setQ(Q.multi);
  check('初始没画光标', g.cursorCount(), 0);
  g.tap(13);
  check('下键 → 光标在第 1 个', g.cursorAt(Q.multi), 0);
  g.tap(13); g.tap(13);
  check('再按两次 → 第 3 个', g.cursorAt(Q.multi), 2);
  g.tap(12);
  check('上键 → 第 2 个', g.cursorAt(Q.multi), 1);
  check('同时只有一个光标', g.cursorCount(), 1); }
// 进场方向：新题上按 ↑ 停在最后一个，按 ↓ 停在第一个
{ const g = boot(); g.setQ(Q.multi);
  g.tap(12);
  check('新题按 ↑ → 停在最后一个（不是第一个）', g.cursorAt(Q.multi), 3); }
{ const g = boot(); g.setQ(Q.multi);
  g.tap(13);
  check('新题按 ↓ → 停在第一个', g.cursorAt(Q.multi), 0); }
// 环绕：4 个选项，↓ 按满一圈回到第一个
{ const g = boot(); g.setQ(Q.multi);
  for (let i=0;i<4;i++) g.tap(13);
  check('↓ 四次 → 最后一个', g.cursorAt(Q.multi), 3);
  g.tap(13);
  check('再按一次 → 绕回第一个', g.cursorAt(Q.multi), 0); }
{ const g = boot(); g.setQ(Q.multi);
  g.tap(12); g.tap(12);
  check('↑ 两次 → 倒数第二个', g.cursorAt(Q.multi), 2); }

console.log('== 超过 4 个选项（原始诉求） ==');
{ const g = boot(); g.setQ(Q.multi);
  check('加了第 5 个选项', g.addOption(Q.multi), 5);
  for (let i=0;i<5;i++) g.tap(13);
  check('光标能到第 5 个（4 个键直选做不到这个）', g.cursorAt(Q.multi), 4);
  g.tap(0);
  check('确认选中第 5 个', g.checked(Q.multi), [false,false,false,false,true]); }

console.log('== 确认 ==');
{ const g = boot(); g.setQ(Q.multi);
  g.tap(13); g.tap(13); g.tap(0);
  check('↓ 两次后确认 → 第 2 个被选', g.checked(Q.multi), [false,true,false,false]); }
{ const g = boot(); g.setQ(Q.judge);
  // ↓ 第一下是「进场」，落在第 1 个；再一下才挪到第 2 个
  g.tap(13); g.tap(13); g.tap(0);
  check('判断题：↓ 两下确认 → 第 2 个', g.checked(Q.judge), [false,true]); }
{ const g = boot(); g.setQ(Q.judge);
  g.tap(0);
  check('判断题：直接确认 → 第 1 个', g.checked(Q.judge), [true,false]); }
{ const g = boot(); g.setQ(Q.multi);
  // 多选：移一下确认一下，再移一下再确认
  g.tap(13); g.tap(0);
  g.tap(13); g.tap(0);
  check('多选勾两个', g.checked(Q.multi), [true,true,false,false]);
  g.tap(6);
  check('提交不炸', true, true); }
{ const g = boot(); g.setQ(Q.multi);
  g.tap(0);
  check('没移过光标时确认 = 选第 1 个', g.checked(Q.multi), [true,false,false,false]); }

console.log('== 光标不越界、不残留 ==');
{ const g = boot(); g.setQ(Q.locked);
  g.tap(13);
  check('已锁的题不画光标', g.cursorCount(), 0);
  g.tap(0);
  check('已锁的题确认也没用', g.checked(Q.locked), [false,false,false,false]); }
{ const g = boot(); g.setQ(Q.blank);
  g.tap(13); g.tap(0);
  check('填空题不画光标也不炸', g.cursorCount(), 0); }
{ const g = boot(); g.setQ(Q.multi);
  g.tap(13); g.tap(13);
  check('翻题前光标在第 2 个', g.cursorAt(Q.multi), 1);
  g.tap(15);   // 下一题
  check('翻题后旧光标被擦掉', g.cursorCount(), 0);
  g.tap(13);
  check('新题的光标从第一个重新开始', g.cursorAt(Q.multi+1), 0); }
{ const g = boot(); const calls = []; g.arm({playEffect:(t,p)=>{calls.push(p);return Promise.resolve();}});
  g.setQ(Q.multi); g.tap(13); g.tap(0);
  check('答完前光标还在', g.cursorCount(), 1);
  g.q(Q.multi).querySelector('.ti-container').classList.add('correct');
  await new Promise(r=>setTimeout(r,20));
  check('结果出来 → 光标收掉（题锁了）', g.cursorCount(), 0);
  check('震动照常', calls[0] && calls[0].duration, 100); }

console.log('== 输入框聚焦 ==');
{ const g = boot(); g.setQ(Q.multi);
  const inp = g.win.document.createElement('input'); g.win.document.body.appendChild(inp); inp.focus();
  g.tap(13);
  check('聚焦时仍能移光标', g.cursorAt(Q.multi), 0);
  g.tap(0);
  check('聚焦时确认被挡下', g.checked(Q.multi), [false,false,false,false]); }

console.log('== 跳题浮层的方向键 ==');
{ const g = boot(); g.setQ(Q.multi);
  g.tap(5);   // RB 跳题
  check('浮层开了', !!g.win.document.getElementById('fbgp-jump'), true);
  const sr = g.win.document.getElementById('fbgp-jump').shadowRoot;
  const on = () => sr.querySelector('.cell.on').dataset.jump;
  check('初始选中当前题（改之前恒为 null）', on(), String(Q.multi));
  check('标题跟着走',
      sr.querySelector('.title').textContent.includes('第 ' + (Q.multi+1) + ' 题'), true);
  g.tap(15);  check('→ 挪一格', on(), String(Q.multi+1));
  g.tap(14);  check('← 挪回来', on(), String(Q.multi));
  // 夹具的题数远不到十道，「挪十格」挪不过去 —— 期待的是夹在头尾，不是越界。
  // 数从 DOM 里拿，免得哪天夹具题库变了自己悄悄过期。
  const last = String(g.win.document.querySelectorAll('app-ti').length - 1);
  g.tap(13);  check('↓ 挪十格 → 夹在最后一题', on(), last);
  g.tap(12);  check('↑ 挪十格 → 夹回第一题', on(), '0');
  g.tap(15);  check('→ 还能从第一题正常挪', on(), '1');
  g.tap(8);   // Back 取消
  check('Back 关掉浮层', !!g.win.document.getElementById('fbgp-jump'), false); }
{ const g = boot(); g.setQ(Q.multi);
  g.tap(5);
  g.tap(0);   // 面键 1 = 确认跳过去
  check('面键 1 跳过去，浮层关掉',
      !!g.win.document.getElementById('fbgp-jump'), false); }

console.log('== 默认键位回归 ==');
{ const src = readFileSync('fenbi-gamepad.user.js','utf8');
  const pairs = [
    ['cursorUp', 'button:12'], ['cursorDown', 'button:13'],
    ['confirm', 'button:0'], ['submit', 'button:6'],
    ['next', 'button:15'], ['prev', 'button:14'],
    ['expand', 'button:4'], ['ask', 'button:7'], ['jump', 'button:5'],
    ['help', 'button:8']
  ];
  for (const [id, key] of pairs) {
    check(id + ' → ' + key,
        new RegExp(id + ":\\s*\\['" + key.replace(':','\\:') + "'\\]").test(src), true);
  }
  check('滚动只剩左摇杆（十字键让给选项了）',
      /scrollUp:\s*\['axis:1:-1'\]/.test(src) && !/scrollUp:\s*\['button:12'/.test(src), true); }

const pass = out.filter(Boolean).length;
console.log(`\n通过 ${pass}/${out.length}`);
process.exit(pass === out.length ? 0 : 1);
