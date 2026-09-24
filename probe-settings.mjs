// 设置面板的按键绑定，端到端验证。
//
// 用户要的模型是：一个动作有自己的键，每个键自己带一档「短按还是长按」。
// 所以这里不看配置对象，看的是**在面板上录完一个键，手柄按下去的行为真的
// 变了** —— 中间任何一环断了都会表现成「录了没反应」，而那种 bug 在代码里
// 读不出来。
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { fixturePath, fixtureExists, buildFixture } from './test/make-fixture.mjs';
if (!fixtureExists()) buildFixture();

/*
 * 起一个页面：真夹具 + 一个替身侧边栏 + 手柄脚本。
 *
 * 替身侧边栏（宿主 + shadow 里的两个按钮）是为了数得清「AI 面板被开关了
 * 几次」。真侧边栏一进来，prefs 里就多了一堆 fbai.* 的键，下面那条「存进
 * 了 GM 存储」的断言会被搅浑；真接缝由 test/gamepad-toggle 那边用真侧边栏
 * 验。
 *
 * initial 是开局就躺在 GM 存储里的东西 —— 验老配置迁移要用。
 */
function boot(initial) {
    const prefs = Object.assign({}, initial);
    const dom = new JSDOM(readFileSync(fixturePath(),'utf8'), {
        url:'https://spa.fenbi.com/ti/memorize/practice', runScripts:'outside-only', pretendToBeVisual:true });
    const win = dom.window;
    win.document.body.insertAdjacentHTML('beforeend',
        '<div class="submit-btn"><svg></svg>交卷</div>');
    let raf = [], now = 0;
    const slots = [null];
    const mkPad = b => ({ id:'Pad', mapping:'standard', connected:true, index:0,
        buttons: Array.from({length:17},(_,i)=>({pressed:!!b[i],value:b[i]?1:0})), axes:[0,0,0,0] });
    slots[0] = mkPad({});
    Object.defineProperty(win.navigator,'getGamepads',{configurable:true,value:()=>slots.slice()});
    win.requestAnimationFrame = cb => raf.push(cb);
    win.cancelAnimationFrame = () => {};
    Object.defineProperty(win.performance,'now',{configurable:true,value:()=>now});
    win.Date.now = () => now;
    win.GM_getValue = (k,f) => (k in prefs ? prefs[k] : f);
    win.GM_setValue = (k,v) => { prefs[k]=v; };
    win.GM_registerMenuCommand = () => 1;
    win.console = { ...win.console, log:()=>{}, warn:()=>{} };

    let aiHidden = false, toggles = 0, submits = 0;
    const fakeHost = win.document.createElement('div');
    fakeHost.id = 'fbai-panel';
    const fakeShadow = fakeHost.attachShadow({ mode: 'open' });
    for (const [cls, next] of [['fbai-collapse', true], ['fbai-tab', false]]) {
        const button = win.document.createElement('button');
        button.className = cls;
        button.addEventListener('click', () => {
            aiHidden = next; toggles++;
            fakeHost.setAttribute('data-fbai-hidden', aiHidden ? '1' : '0');
        });
        fakeShadow.appendChild(button);
    }
    fakeHost.setAttribute('data-fbai-hidden', '0');
    win.document.documentElement.appendChild(fakeHost);
    win.document.querySelector('.submit-btn')
        .addEventListener('click', () => submits++);

    win.eval(readFileSync('fenbi-gamepad.user.js','utf8'));
    win.document.dispatchEvent(new win.Event('gamepadconnected'));

    const step = (ms=16) => { now += ms; const d = raf; raf = []; for (const cb of d) cb(now); };
    const tap = k => { slots[0]=mkPad({[k]:true}); step(); slots[0]=mkPad({}); step(); };
    const holdFor = (k, ms) => { slots[0]=mkPad({[k]:true}); step();
        for (let t=0; t<ms; t+=16) step(); slots[0]=mkPad({}); step(); };

    const panel = () => win.document.getElementById('fbgp-panel');
    const sr = () => { const p = panel(); return p ? p.shadowRoot : null; };
    const row = id => { const s = sr(); return s && s.querySelector('[data-action="' + id + '"]'); };

    /*
     * 在面板上录一个键。走的是真路径：选好那一档 → 点「录入按键」→
     * 下一帧按下手柄。
     */
    const record = (id, key, hold) => {
        const r = row(id);
        r.querySelector('.when').value = hold ? 'hold/' : '';
        r.querySelector('.bind').click();
        step();
        tap(key);
    };

    return { win, prefs, tap, holdFor, sr, row, panel, record,
        toggles: () => toggles, submits: () => submits,
        hint: () => sr().getElementById('fbgp-hint').textContent,
        tags: id => { const r = row(id);
            return r ? [...r.querySelectorAll('.key')].map(t => t.textContent) : null; },
        unbound: id => { const r = row(id); return r && /未绑定/.test(r.textContent); },
        unbind: (id, index) => { row(id).querySelectorAll('.key')[index].click(); step(); } };
}

const out=[];
const check=(l,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want); out.push(ok);
    console.log((ok?'  ok  ':'  FAIL')+' '+l+(ok?'':`  得到 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}`)); };

console.log('== 一行 = 一个动作 + 它自己的键 ==');
{ const g = boot();
  g.tap(8);                       // 短按 Back = 设置/帮助
  check('短按 Back 打开设置面板', !!g.panel(), true);
  const rows = [...g.sr().querySelectorAll('[data-action]')];
  check('每个动作一行', rows.length > 0, true);
  check('每行都有「录入按键」', rows.every(r => r.querySelector('.bind')), true);
  check('每行都有短按/长按那一档可选',
      rows.every(r => r.querySelector('.when').options.length === 2), true);

  // 用户报的那两条：交卷和回退网页原来没有自己的键（挂在别人的长按里），
  // 现在它们各有一短一长两条，都写在自己这一行
  check('交卷那一行有两条：短按 R3、长按 Start',
      g.tags('finish'), ['按钮 11 ✕', '长按 按钮 9 ✕']);
  check('回退那一行同理',
      g.tags('back'), ['按钮 10 ✕', '长按 按钮 8 ✕']);
  check('开关 AI 那行只有短按 —— 长按不是它的',
      g.tags('toggleAi'), ['按钮 9 ✕']);
  check('没有哪一行还在说「只在长按里」',
      rows.some(r => /只在长按里/.test(r.textContent)), false);
  check('也没有哪一行是空的', rows.some(r => /未绑定/.test(r.textContent)), false);
  check('面板上写明了规则',
      /同一个键上两件短按/.test(g.sr().querySelector('.tip').textContent), true); }

console.log('== 按住 Start 交卷，短按还是开 AI 面板 ==');
{ const g = boot();
  g.holdFor(9, 1200);
  check('按住 1.2 秒点到了交卷', g.submits(), 1);
  check('没顺手开 AI 面板', g.toggles(), 0);
  g.tap(9);
  check('短按那一下开 AI 面板', g.toggles(), 1);
  check('短按没交卷', g.submits(), 1); }

console.log('== 录一个短按：把别人的键顶掉 ==');
{ const g = boot();
  g.tap(8);
  g.record('next', 0, false);      // 把「下一题」录到面键 0（原本归确认）
  check('下一题原来那条长按还在，多了一条短按',
      g.tags('next'), ['长按 按钮 15 ✕', '按钮 0 ✕']);
  check('确认那行的键被顶掉了，显示「未绑定」', g.unbound('confirm'), true);
  check('提示说清了录进去的是什么', g.hint(), '按钮 0 → 下一题');
  check('存进了 GM 存储',
      JSON.parse(JSON.stringify(g.prefs['fenbi-gamepad-bindings'])).confirm, []);
  check('交卷的长按没被碰', g.tags('finish'), ['按钮 11 ✕', '长按 按钮 9 ✕']); }

console.log('== 同一个键的短按和长按可以并存 ==');
{ const g = boot();
  g.tap(8);
  g.record('jump', 0, false);      // 跳题 ← 面键 0 短按（原本归确认）
  g.record('expand', 0, true);     // 展开解析 ← 同一个键的长按
  // 跳题原来是短按 button:5，录新的短按时同一档换掉（不是两条并存）
  check('面键 0 的短按归跳题', g.tags('jump'), ['按钮 0 ✕']);
  check('同一个键的长按归展开解析', g.tags('expand'), ['按钮 4 ✕', '长按 按钮 0 ✕']);
  check('确认那行只是丢了短按', g.unbound('confirm'), true);

  // 行为真的分开了
  g.tap(0);
  check('短按打开跳题浮层',
      !!g.win.document.getElementById('fbgp-jump'), true); }

console.log('== 录一个长按，按满一秒才动 ==');
{ const g = boot();
  g.tap(8);
  g.record('jump', 3, true);       // 跳题 ← 面键 3 长按（面键 3 本来没人用）
  check('跳题挂着原来那条，加上新的长按',
      g.tags('jump'), ['按钮 5 ✕', '长按 按钮 3 ✕']);

  g.tap(3);
  check('短按没反应', !!g.win.document.getElementById('fbgp-jump'), false);
  g.holdFor(3, 1200);
  check('按住 1.2 秒才打开跳题浮层',
      !!g.win.document.getElementById('fbgp-jump'), true); }

console.log('== 解绑一条，同一行的另一档留着 ==');
{ const g = boot();
  g.tap(8);
  g.unbind('finish', 1);           // 解掉交卷那条长按
  check('交卷只剩短按', g.tags('finish'), ['按钮 11 ✕']);
  check('开关 AI 那行没受牵连', g.tags('toggleAi'), ['按钮 9 ✕']);
  g.holdFor(9, 1200);
  check('按住 Start 不再交卷', g.submits(), 0);
  check('松手补了个短按 —— 开 AI 面板', g.toggles(), 1); }

console.log('== 改完存得住：关了面板再开还在 ==');
{ const g = boot();
  g.tap(8);
  g.unbind('finish', 1);
  g.tap(8);                        // 关掉面板
  check('面板关掉了', !!g.panel(), false);
  g.tap(8);                        // 再打开
  check('重开还是只剩短按', g.tags('finish'), ['按钮 11 ✕']);
  g.holdFor(9, 1200);
  check('按住还是不交卷', g.submits(), 0); }

console.log('== 恢复默认全回来 ==');
{ const g = boot();
  g.tap(8);
  g.unbind('finish', 1);
  g.record('next', 0, false);
  g.sr().querySelector('[data-reset]').click();
  check('交卷的长按回来了', g.tags('finish'), ['按钮 11 ✕', '长按 按钮 9 ✕']);
  check('确认的键也回来了', g.tags('confirm'), ['按钮 0 ✕']);
  g.holdFor(9, 1200);
  check('按住又开始交卷', g.submits(), 1); }

console.log('== 老配置迁移：以前配的长按接着能用 ==');
{ const g = boot({
      'fenbi-gamepad-bindings': {
          toggleAi: ['button:9'], help: ['button:8'],
          finish: ['button:11'], back: ['button:10']
      },
      'fenbi-gamepad-holds': {
          toggleAi: { action: 'finish', ms: 1000 },
          help: { action: 'back', ms: 1000 }
      }
  });
  g.tap(8);
  check('老的长按折到了交卷那一行',
      g.tags('finish'), ['按钮 11 ✕', '长按 按钮 9 ✕']);
  check('回退那条也折过去了',
      g.tags('back'), ['按钮 10 ✕', '长按 按钮 8 ✕']);
  check('老键被清成记号，不会折第二遍',
      JSON.stringify(g.prefs['fenbi-gamepad-holds']), '{}');
  g.holdFor(9, 1200);
  check('按住 Start 还是交卷', g.submits(), 1); }

console.log('== 迁移过的长按解绑之后不会自己复活 ==');
{ const g = boot({
      'fenbi-gamepad-bindings': { finish: ['button:11'] },
      'fenbi-gamepad-holds': {}
  });
  g.tap(8);
  check('交卷只有短按那条', g.tags('finish'), ['按钮 11 ✕']);
  g.holdFor(9, 1200);
  check('按住 Start 没交卷', g.submits(), 0);
  check('松手补了短按 —— 开 AI 面板', g.toggles(), 1); }

let bad=out.filter(x=>!x).length;
console.log(`\n通过 ${out.length-bad}/${out.length}`);
process.exit(bad?1:0);
