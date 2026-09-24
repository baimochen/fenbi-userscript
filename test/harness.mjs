// 在 jsdom 里把侧边栏脚本真跑起来的共用夹具。
//
// 脚本放进 window 上下文执行，所以 module 是 undefined，init() 会照常启动。
// setInterval 用的是 jsdom 的定时器，window.close() 能收干净 —— 每个用例都
// boot() 一个新的 dom，不关的话前面那些的定时器会一直吊着事件循环。
//
// 这里连油猴菜单也一起假装了（GM_registerMenuCommand / GM_unregisterMenuCommand）：
// 设置全搬进菜单之后，菜单就是主要的交互面，不测等于没测。

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { fixturePath, fixtureExists, buildFixture } from './make-fixture.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const USERSCRIPT = join(ROOT, 'fenbi-ai-sidebar.user.js');
export const LAYOUT_SCRIPT = join(ROOT, 'fenbi-memorize-layout.user.js');

const booted = [];

export function ensureFixture() {
    if (!fixtureExists()) {
        const result = buildFixture();
        if (!result.ok) {
            throw new Error('夹具生成失败：' + result.reason);
        }
    }
}

export function closeAll() {
    while (booted.length) {
        booted.pop().window.close();
    }
}

// 把脚本当模块加载，只拿纯函数和常量，不启动面板
export function loadModule(file) {
    const sandbox = { module: { exports: {} } };
    new Function('module', readFileSync(file, 'utf8'))(sandbox.module);
    return sandbox.module.exports;
}

// options.unframe —— 模拟装没装去头扩展：装了就在 documentElement 上打标记。
// 这个标记决定默认走嵌入还是开窗口，是最容易回归的一处，两种都要测。
export function boot(options) {
    ensureFixture();

    const unframe = Boolean(options && options.unframe);

    const copied = [];   // 剪贴板写入的内容
    const opened = [];   // window.open 收到的参数
    const windows = [];  // 开出来的假窗口把手，能看 close() 有没有被调
    const posted = [];   // 发进 iframe 的 postMessage
    const prefs = {};    // 假的 GM 存储
    const logged = [];   // console.log 的内容
    const menu = [];     // 菜单项，保持注册顺序

    let nextMenuId = 1;

    const dom = new JSDOM(readFileSync(fixturePath(), 'utf8'), {
        url: 'https://spa.fenbi.com/ti/memorize/practice',
        runScripts: 'outside-only'
    });

    const win = dom.window;

    closeAll();
    booted.push(dom);

    win.GM_getValue = (key, fallback) =>
        (key in prefs ? prefs[key] : fallback);

    win.GM_setValue = (key, value) => {
        prefs[key] = value;
    };

    win.GM_registerMenuCommand = (name, run) => {
        const item = { id: nextMenuId++, name, run };
        menu.push(item);
        return item.id;
    };

    win.GM_unregisterMenuCommand = id => {
        const index = menu.findIndex(item => item.id === id);
        if (index >= 0) {
            menu.splice(index, 1);
        }
    };

    Object.defineProperty(win.navigator, 'clipboard', {
        configurable: true,
        value: { writeText: text => copied.push(text) }
    });

    // 每个窗口一个独立把手。共用同一个对象的话，「关掉的是不是刚开的
    // 那一扇」就没法验了 —— 那正好是收起面板时最容易搞错的一处。
    //
    // postMessage 也要有：独立窗口模式下题目就是往这儿发的，没有它
    // deliver 会抛异常被自己的 try 吞掉，测试看到的是「什么都没发生」，
    // 而那和「发到别处去了」长得一模一样。
    win.open = (url, name, features) => {
        const handle = {
            url,
            name,
            closed: false,
            focused: false,
            focus() { this.focused = true; },
            close() { this.closed = true; },
            postMessage(message, origin) {
                posted.push({ message, origin, via: 'window' });
            }
        };

        opened.push({ url, name, features });
        windows.push(handle);

        return handle;
    };

    // jsdom 不会真去加载跨域 iframe，contentWindow 一直是 null。浏览器里它
    // 从元素插进文档那一刻起就有值，所以这里补一个。
    //
    // 补的同时把发过去的内容记下来 —— 跨域那一步的文章全在「发了什么、
    // 发给谁」上，正是最该验的地方，不记下来就只能靠手点。
    Object.defineProperty(win.HTMLIFrameElement.prototype, 'contentWindow', {
        configurable: true,
        get() {
            if (!this.__fbWindow) {
                this.__fbWindow = {
                    postMessage: (message, origin) =>
                        posted.push({ message, origin, via: 'frame' })
                };
            }
            return this.__fbWindow;
        }
    });

    // jsdom 的 console 会往 virtualConsole 转，抓不到；换掉它
    win.console = {
        ...win.console,
        log: (...args) => logged.push(args.join(' '))
    };

    if (unframe) {
        win.document.documentElement.setAttribute('data-fbai-unframe', '1');
    }

    win.eval(readFileSync(USERSCRIPT, 'utf8'));

    const root = win.document.getElementById('fbai-panel').shadowRoot;

    return {
        dom,
        win,
        root,
        copied,
        opened,
        windows,
        posted,
        prefs,
        logged,
        menu,

        // 菜单里所有项的文案，按注册顺序
        menuNames: () => menu.map(item => item.name),

        // 点某一项。刻意用「包含」匹配：菜单项前面带勾选标记（✓ / 空格），
        // 写测试时不该被那个对齐用的空格绊住。
        clickMenu(part) {
            const item = menu.find(entry => entry.name.includes(part));
            if (!item) {
                throw new Error(
                    '菜单里没有含「' + part + '」的项。现有：' +
                    menu.map(entry => entry.name).join(' / ')
                );
            }
            item.run();
        },

        click(selector) {
            const node = root.querySelector(selector);
            if (!node) {
                throw new Error('阴影里找不到：' + selector);
            }
            node.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
            return node;
        },

        press(key, modifiers) {
            win.document.dispatchEvent(new win.KeyboardEvent('keydown', {
                code: key,
                bubbles: true,
                ...modifiers
            }));
        }
    };
}
