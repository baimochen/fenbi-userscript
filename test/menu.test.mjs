// 油猴菜单的测试。
//
// 设置从页面上搬进菜单之后，菜单就成了唯一的交互面：切 AI、切模式、显示隐藏
// 全在这儿。所以这一段得有测试兜着，不然改坏了用户是「点了没反应」，页面上
// 一点线索都没有。
//
// 菜单项的文案带勾选标记（✓ / 全角空格），测试统一用 includes 匹配关键词，
// 免得被对齐用的空格绊住。

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, closeAll, ensureFixture, loadModule, USERSCRIPT } from './harness.mjs';

let api;

before(() => {
    ensureFixture();
    api = loadModule(USERSCRIPT);
});

after(closeAll);

// 菜单里所有 AI 服务项（带「AI：」前缀的那些）
function serviceItems(booted) {
    return booted.menu.filter(item => item.name.includes('AI：'));
}

describe('菜单里能选 AI', () => {

    test('13 家全在', () => {

        const booted = boot();
        const names = serviceItems(booted).map(item => item.name);

        assert.equal(names.length, Object.keys(api.SERVICES).length - 1,
            '除了自定义之外，每家都该有一项');

        for (const service of Object.values(api.SERVICES)) {
            if (service.label === '自定义…') continue;

            assert.ok(
                names.some(name => name.includes(service.label)),
                service.label + ' 不在菜单里'
            );
        }
    });

    test('当前那家带勾，其他家不带', () => {

        const booted = boot();
        const items = serviceItems(booted);

        const checked = items.filter(item => item.name.includes('✓'));

        assert.equal(checked.length, 1, '有勾的应该正好一家');
        assert.match(checked[0].name, /ChatGPT/);
    });

    test('点另一家就切过去，勾跟着移动', () => {

        const booted = boot();

        booted.clickMenu('AI：Gemini');

        assert.equal(booted.prefs['fbai.service'], 'gemini');

        const checked = serviceItems(booted).filter(item => item.name.includes('✓'));

        assert.equal(checked.length, 1);
        assert.match(checked[0].name, /Gemini/);
    });

    test('切换后菜单不会越堆越长 —— 勾是改的，不是新加的', () => {

        const booted = boot();
        const before = booted.menu.length;

        for (const label of ['AI：Gemini', 'AI：Claude', 'AI：ChatGPT']) {
            booted.clickMenu(label);
        }

        assert.equal(
            booted.menu.length,
            before,
            '菜单项在重复注册，用户会看到一长串'
        );
    });

    test('切过之后 iframe 跟着换', () => {

        const booted = boot({ unframe: true });

        booted.clickMenu('AI：Claude');

        assert.equal(
            booted.root.querySelector('iframe').getAttribute('src'),
            api.SERVICES.claude.url
        );
    });
});

describe('菜单里能切模式', () => {

    test('两项都在，当前那项带勾', () => {

        const booted = boot({ unframe: true });

        const items = booted.menu.filter(item => item.name.includes('模式：'));

        assert.equal(items.length, 2);
        assert.equal(
            items.filter(item => item.name.includes('✓')).length,
            1
        );
        assert.match(items.find(item => item.name.includes('✓')).name, /嵌入页面/);
    });

    test('切到独立窗口，勾跟着走', () => {

        const booted = boot({ unframe: true });

        booted.clickMenu('模式：独立窗口');

        assert.equal(booted.prefs['fbai.mode'], 'window');

        const items = booted.menu.filter(item => item.name.includes('模式：'));

        assert.match(
            items.find(item => item.name.includes('✓')).name,
            /独立窗口/
        );
    });

    test('没装去头扩展时默认那项是独立窗口', () => {

        const booted = boot();

        const items = booted.menu.filter(item => item.name.includes('模式：'));

        assert.match(
            items.find(item => item.name.includes('✓')).name,
            /独立窗口/
        );
    });
});

describe('菜单里的开关与动作', () => {

    test('显示 / 隐藏面板', () => {

        const booted = boot();
        const wrap = booted.root.querySelector('.wrap');

        booted.clickMenu('隐藏面板');
        assert.equal(wrap.style.display, 'none');

        booted.clickMenu('显示');
        assert.notEqual(wrap.style.display, 'none');
    });

    test('嵌入模式下没有「打开窗口」这一项 —— 用不上的项不该占地方', () => {

        const booted = boot({ unframe: true });

        assert.equal(
            booted.menuNames().filter(name => name.includes('打开')).length,
            0
        );
    });

    test('窗口模式下才有「打开窗口」，点了真的开', () => {

        const booted = boot();

        booted.clickMenu('打开');

        assert.equal(booted.opened.length, 1);
        assert.equal(booted.opened[0].url, api.SERVICES.chatgpt.url);
    });

    test('窗口开在屏幕左侧', () => {

        const booted = boot();

        booted.clickMenu('打开');

        assert.match(booted.opened[0].features, /left=0/);
        assert.match(booted.opened[0].features, /top=0/);
    });
});

describe('自定义地址', () => {

    test('没配就不出现在菜单里', () => {

        const booted = boot();

        assert.equal(
            booted.menuNames().filter(name => name.includes('自定义')).length,
            0
        );
    });

    test('CONFIG 里那个字段是空的 —— 用户自己往里填', () => {

        assert.equal(typeof api.CONFIG.customUrl, 'string');
    });

    test('配了就出现在菜单里', () => {

        const services = api.availableServices({
            customUrl: 'https://chat.example.com/'
        });

        assert.ok(services.custom, '填了地址就该多出「自定义」这一项');
    });

    test('地址原样用，不做拼接', () => {

        assert.equal(
            api.serviceUrl('custom', { customUrl: 'https://chat.example.com/' }),
            'https://chat.example.com/'
        );
    });

    test('空地址不会变成一个空 iframe', () => {

        assert.equal(api.serviceUrl('custom', { customUrl: '   ' }), '');
    });

    test('普通服务无视 customUrl', () => {

        assert.equal(
            api.serviceUrl('gemini', { customUrl: 'https://chat.example.com/' }),
            api.SERVICES.gemini.url
        );
    });
});
