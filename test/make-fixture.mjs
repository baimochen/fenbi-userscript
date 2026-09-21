// 从粉笔背题页的本地存档里抠出一个测试夹具。
//
// 为什么是「生成」而不是直接提交夹具：存档 HTML 含题库内容，.gitignore 里
// 明确写了不随仓库分发，所以夹具产物同样进 .gitignore，只提交这个生成器。
//
// 用法：npm run fixture

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'test', 'fixtures');
const OUT_FILE = join(OUT_DIR, 'questions.html');

// 找存档：*背题.html，排除 _files 目录
function findArchives() {
    return readdirSync(ROOT).filter(
        name => name.endsWith('背题.html') && !name.endsWith('_files')
    );
}

// 剥掉 SVG（几万字节的图标路径，跟提取逻辑无关）、Angular 的注释占位节点、
// 以及 _ngcontent/_nghost 作用域属性。标签结构和 class 保持原样 —— 选择器只依赖这些。
function clean(html) {
    return html
        .replace(/<svg\b[\s\S]*?<\/svg>/g, '')
        .replace(/<!---->/g, '')
        .replace(/\s_ng(?:host|content)-[^=]*="[^"]*"/g, '')
        .replace(/\s+/g, ' ')
        .replace(/> </g, '><')
        .trim();
}

// app-ti 可能嵌套，按深度配对找闭合标签
function findClose(html, start) {
    let depth = 0;
    const re = /<app-ti[ >]|<\/app-ti>/g;
    re.lastIndex = start;
    let m;
    while ((m = re.exec(html))) {
        if (m[0].startsWith('</')) {
            if (--depth === 0) return m.index + m[0].length;
        } else {
            depth++;
        }
    }
    return -1;
}

function questionType(block) {
    const m = block.match(/title-type-name[^>]*>\s*([^<]+?)\s*</);
    return m ? m[1] : null;
}

// 每种题型各取一道，覆盖 5 种渲染结构：
// 单选题/多选题/不定项 走 app-choice-radio，判断题走 app-choice-true-false，
// 填空题走 app-solution-blank（没有选项）。
function extractQuestions(html) {
    const picked = new Map();
    const re = /<app-ti[ >]/g;
    let m;
    while ((m = re.exec(html))) {
        const end = findClose(html, m.index);
        if (end < 0) continue;
        const block = html.slice(m.index, end);
        const type = questionType(block);
        if (type && !picked.has(type)) picked.set(type, clean(block));
    }
    return picked;
}

function extractMaterials(html) {
    const start = html.indexOf('<app-materials');
    if (start < 0) return '';
    const end = html.indexOf('</app-materials>', start);
    if (end < 0) return '';
    return clean(html.slice(start, end + '</app-materials>'.length));
}

export function buildFixture() {
    const archives = findArchives();
    if (!archives.length) return { ok: false, reason: '没找到 *背题.html 存档' };

    // 挑题型最全的那份存档
    let best = null;
    for (const name of archives) {
        const html = readFileSync(join(ROOT, name), 'utf8');
        const questions = extractQuestions(html);
        if (!best || questions.size > best.questions.size) {
            best = { name, questions, materials: extractMaterials(html) };
        }
    }

    // 两个题组，覆盖材料归属的两条路径：
    //   甲组 —— 左边有 app-materials，题干的提取要带上材料
    //   乙组 —— 没有材料，material 必须是空串
    const withMaterial = ['单选题', '多选题', '不定项'];
    const withoutMaterial = ['判断题', '填空题'];

    function group(types, material) {
        const left = material
            ? '<div class="left-part">' + material + '</div>'
            : '<div class="left-part"></div>';
        const items = types
            .filter(t => best.questions.has(t))
            .map(t => '<!-- ' + t + ' -->\n' + best.questions.get(t))
            .join('\n');
        return (
            '<div class="ti">' + left +
            '<div class="right-part"><div class="questions-container"><app-questions>' +
            items +
            '</app-questions></div></div></div>'
        );
    }

    const parts = [
        '<!doctype html><html><head><meta charset="utf-8"><title>fenbi fixture</title></head><body>',
        '<!-- 由 test/make-fixture.mjs 从本地存档生成，勿手改；不进版本库。 -->',
        group(withMaterial, best.materials),
        group(withoutMaterial, ''),
        '</body></html>'
    ];

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT_FILE, parts.join('\n'), 'utf8');

    return {
        ok: true,
        file: OUT_FILE,
        source: best.name,
        types: [...best.questions.keys()]
    };
}

export function fixturePath() {
    return OUT_FILE;
}

export function fixtureExists() {
    return existsSync(OUT_FILE);
}

// 直接跑 `node test/make-fixture.mjs` 时的入口
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const result = buildFixture();
    if (!result.ok) {
        console.error('生成失败：' + result.reason);
        process.exit(1);
    }
    console.log(`已生成 ${result.file}`);
    console.log(`  来源：${result.source}`);
    console.log(`  题型：${result.types.join('、')}`);
}
