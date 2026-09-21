// 从 domains.json 生成 rules.json，并同步 manifest.json 的 host_permissions。
//
// 为什么不手写 rules.json —— 30 条规则每条都长一个样，手写迟早会漏掉某一条的
// initiatorDomains，那一条就等于给全网开了点击劫持的门（而且不报错）。
// 生成的话，安全边界只在一处写死。
//
// 用法：node build-rules.mjs
//
// 生成出来的 rules.json 要一起提交 —— 扩展加载的是它，不是这个脚本。

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// 规则只对来自这些站点的子框架请求生效。
//
// fenbi.com 是正主；localhost 是为了 test.html 能自检 —— 本地起个 http server
// 就能验证规则到底通没通，不用真去粉笔页面上试。
//
// 别往这里加 "*" 或者别的站点：这些规则删的是浏览器专门用来防点击劫持的头，
// 放开范围等于让任何网站都能 iframe 一个登录状态的 ChatGPT。
export const INITIATORS = ['fenbi.com', 'localhost'];

// 只删和「能不能被嵌入」有关的头。
//
// x-frame-options 和 CSP 的 frame-ancestors 是两道独立的闸，站点一般两道都上，
// 所以两道都得拆。
//
// 注意这是整条删掉，不是只删 frame-ancestors —— DNR 的 modifyHeaders 只能整条
// 增删，做不了「保留 A 指令、去掉 B 指令」这种手术。代价是这些站点在 iframe 里
// 跑的时候自己那层 CSP 也没了，README 里跟用户讲清楚了。
export const HEADERS = [
    'x-frame-options',
    'content-security-policy',
    'content-security-policy-report-only'
];

export function buildRules(domains) {
    return domains.map((domain, index) => ({
        id: index + 1,
        priority: 1,
        action: {
            type: 'modifyHeaders',
            responseHeaders: HEADERS.map(header => ({
                header,
                operation: 'remove'
            }))
        },
        condition: {
            urlFilter: '||' + domain,
            resourceTypes: ['sub_frame'],
            initiatorDomains: [...INITIATORS]
        }
    }));
}

export function hostPatterns(domains) {
    return domains.map(domain => '*://*.' + domain + '/*');
}

// 手写的字段要留着（name、description、content_scripts…），只换 host_permissions
export function syncManifest(manifest, domains) {
    return { ...manifest, host_permissions: hostPatterns(domains) };
}

export function serialize(value) {
    return JSON.stringify(value, null, 2) + '\n';
}

export function loadDomains() {
    return JSON.parse(readFileSync(join(HERE, 'domains.json'), 'utf8'));
}

export function readManifest() {
    return JSON.parse(readFileSync(join(HERE, 'manifest.json'), 'utf8'));
}

// 只在直接运行时写盘；被测试 import 的时候只借里面的纯函数
if (process.argv[1] === fileURLToPath(import.meta.url)) {

    const domains = loadDomains();

    writeFileSync(join(HERE, 'rules.json'), serialize(buildRules(domains)));
    writeFileSync(
        join(HERE, 'manifest.json'),
        serialize(syncManifest(readManifest(), domains))
    );

    console.log('已生成 rules.json（' + domains.length + ' 条）并同步 manifest.json');
}
