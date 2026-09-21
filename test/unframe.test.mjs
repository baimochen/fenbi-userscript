// 去头扩展与侧边栏脚本之间的约定测试。
//
// 这层东西的危险之处在于：两边分别写在两个语言环境里（油猴脚本 / 扩展的
// JSON + content script），中间靠一个字符串属性名连着。改了一边忘了另一边，
// 症状是「扩展明明装了，侧边栏还是开窗口」—— 不报错，只是默默不生效。
// 所以这里把约定钉死。
//
// 另外 rules.json 是生成出来的，容易手滑改坏：规则的作用域（只 sub_frame、
// 只限发起方）是这整套东西的安全边界，删一条就等于给全网开点击劫持的门。

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import {
    buildRules,
    syncManifest,
    serialize,
    loadDomains
} from '../fenbi-ai-unframe/build-rules.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'fenbi-ai-unframe');

const read = name => readFileSync(join(EXT, name), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const rules = JSON.parse(read('rules.json'));
const content = read('content.js');

let api;

before(() => {
    const sandbox = { module: { exports: {} } };
    new Function(
        'module',
        readFileSync(join(ROOT, 'fenbi-ai-sidebar.user.js'), 'utf8')
    )(sandbox.module);
    api = sandbox.module.exports;
});

describe('扩展标记与脚本检测对得上', () => {

    test('content.js 打的属性名，和脚本读的是同一个', () => {
        // 脚本侧：往 documentElement 上写这个属性，就应该被认出来
        const dom = new JSDOM('<html></html>');
        const doc = dom.window.document;

        assert.equal(api.hasUnframeExtension(doc), false, '没标记时不该认成装了');

        // 从 content.js 里把属性名抠出来，而不是在这里重抄一遍 ——
        // 重抄的话两边一起改错，测试还是绿的
        const mark = content.match(/const MARK = '([^']+)'/);
        assert.ok(mark, 'content.js 里找不到 MARK 常量');

        doc.documentElement.setAttribute(mark[1], '1');

        assert.equal(
            api.hasUnframeExtension(doc),
            true,
            'content.js 打的标记脚本读不到：属性名对不上'
        );

        dom.window.close();
    });

    test('没有 document 时不炸（脚本可能在非 DOM 环境被加载）', () => {
        assert.equal(api.hasUnframeExtension(null), false);
    });
});

describe('resolveMode：装没装扩展决定默认模式', () => {

    test('装了扩展 —— 默认嵌入，用户装它就是为了这个', () => {
        assert.equal(api.resolveMode({}, 'chatgpt', true), 'embed');
    });

    test('没装扩展 —— 默认开窗口，不给用户白框', () => {
        assert.equal(api.resolveMode({}, 'chatgpt', false), 'window');
    });

    test('用户在菜单里选过就听用户的，扩展在不在都不改', () => {
        assert.equal(
            api.resolveMode({ mode: 'embed' }, 'chatgpt', false),
            'embed'
        );
        assert.equal(
            api.resolveMode({ mode: 'window' }, 'chatgpt', true),
            'window'
        );
    });

    test('自定义服务永远默认嵌入 —— 用户填的地址本来就可能是允许嵌入的', () => {
        assert.equal(api.resolveMode({}, 'custom', false), 'embed');
    });

    test('未知服务名不炸', () => {
        assert.equal(api.resolveMode({}, 'nope', true), 'embed');
        assert.equal(api.resolveMode({}, 'nope', false), 'window');
    });
});

describe('服务表', () => {

    test('用户点名的两家都在', () => {
        assert.ok(api.SERVICES.chatgpt, 'ChatGPT');
        assert.ok(api.SERVICES.gemini, 'Gemini');
    });

    test('每家都有名字和地址', () => {
        for (const [key, service] of Object.entries(api.SERVICES)) {
            assert.ok(service.label, key + ' 缺 label');
            if (key === 'custom') continue;
            assert.match(service.url, /^https:\/\//, key + ' 的 url 不是 https');
        }
    });

    test('不带 ?q= 预填规则了 —— 没有题目可投，那是死代码', () => {
        for (const [key, service] of Object.entries(api.SERVICES)) {
            assert.equal(
                service.prefill,
                undefined,
                key + ' 还留着 prefill，但现在没有任何地方会产生要投喂的题目'
            );
        }
    });

    test('地址里没有重复 —— 复制粘贴出来的服务很容易指到同一家', () => {
        const seen = new Map();

        for (const [key, service] of Object.entries(api.SERVICES)) {
            if (key === 'custom') continue;

            const host = new URL(service.url).host;
            assert.equal(
                seen.get(host),
                undefined,
                key + ' 和 ' + seen.get(host) + ' 指向同一个域名 ' + host
            );
            seen.set(host, key);
        }
    });
});

describe('rules.json 的安全边界', () => {

    test('每条规则都只作用于子框架', () => {
        for (const rule of rules) {
            assert.deepEqual(
                rule.condition.resourceTypes,
                ['sub_frame'],
                '规则 ' + rule.id + ' 作用到了子框架以外'
            );
        }
    });

    test('每条规则都限定了发起方 —— 这是防点击劫持的那道闸', () => {
        for (const rule of rules) {
            const initiators = rule.condition.initiatorDomains;

            assert.ok(
                Array.isArray(initiators) && initiators.length > 0,
                '规则 ' + rule.id + ' 没有 initiatorDomains：等于给全网开点击劫持的门'
            );

            assert.ok(
                initiators.includes('fenbi.com'),
                '规则 ' + rule.id + ' 的发起方里没有 fenbi.com'
            );
        }
    });

    test('只删框架相关的响应头，不碰别的', () => {
        const allowed = new Set([
            'x-frame-options',
            'content-security-policy',
            'content-security-policy-report-only'
        ]);

        for (const rule of rules) {
            assert.equal(rule.action.type, 'modifyHeaders');

            for (const header of rule.action.responseHeaders) {
                assert.ok(
                    allowed.has(header.header),
                    '规则 ' + rule.id + ' 动了不该动的头：' + header.header
                );
                assert.equal(header.operation, 'remove');
            }

            // 请求头一律不许动
            assert.equal(rule.action.requestHeaders, undefined);
        }
    });

    test('规则 id 唯一 —— 重号的话 Chrome 会整份 rules.json 都不加载', () => {
        const ids = rules.map(rule => rule.id);
        assert.equal(new Set(ids).size, ids.length);
    });

    test('规则数量和 manifest 授权的域名对得上', () => {
        const hosts = new Set(
            manifest.host_permissions.map(pattern =>
                pattern.replace(/^\*:\/\/(\*\.)?/, '').replace(/\/\*$/, '')
            )
        );

        for (const rule of rules) {
            const domain = rule.condition.urlFilter.replace(/^\|\|/, '');
            assert.ok(
                hosts.has(domain),
                domain + ' 有规则但 manifest 没授权，这条规则不会生效'
            );
        }
    });

    test('manifest 授权的域名都有规则 —— 授权了却不删头是没意义的', () => {
        const filtered = new Set(
            rules.map(rule => rule.condition.urlFilter.replace(/^\|\|/, ''))
        );

        for (const pattern of manifest.host_permissions) {
            const domain = pattern.replace(/^\*:\/\/(\*\.)?/, '').replace(/\/\*$/, '');
            assert.ok(filtered.has(domain), domain + ' 授权了但没有对应规则');
        }
    });
});

describe('生成物是最新的', () => {

    test('rules.json 和 domains.json 对得上 —— 改完域名要记得跑 build-rules.mjs', () => {
        assert.equal(
            read('rules.json'),
            serialize(buildRules(loadDomains())),
            'rules.json 是旧版本了，跑一下 node fenbi-ai-unframe/build-rules.mjs'
        );
    });

    test('manifest 的 host_permissions 也是同步过的', () => {
        assert.equal(
            read('manifest.json'),
            serialize(syncManifest(manifest, loadDomains())),
            'manifest.json 的 host_permissions 和 domains.json 不一致，跑一下 build-rules.mjs'
        );
    });
});

describe('manifest 里的路径都存在', () => {

    test('content script 文件在', () => {
        for (const script of manifest.content_scripts) {
            for (const file of script.js) {
                assert.doesNotThrow(
                    () => readFileSync(join(EXT, file)),
                    file + ' 不存在，扩展会加载失败'
                );
            }
        }
    });

    test('content script 只在粉笔页面上跑', () => {
        for (const script of manifest.content_scripts) {
            for (const match of script.matches) {
                assert.equal(match, '*://*.fenbi.com/*');
            }
        }
    });
});
