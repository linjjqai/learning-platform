/**
 * 批量导入脚本：把一个线上 MkDocs 站点抓成平台的一门课程
 * 说明：这是「加内容」的批量方式之一。平台本身只认 content/courses 下的 markdown，不依赖此脚本。
 *
 * 用法: node tools/migrate.mjs [课程ID]      # 默认 crm
 */
import { parse } from 'node-html-parser';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://linjjqai.github.io/crm-training';
const ROOT = path.resolve(import.meta.dirname, '..');
const COURSE_ID = process.argv[2] || 'crm';
const COURSE_DIR = path.join(ROOT, 'content', 'courses', COURSE_ID);
const LESSON_DIR = path.join(COURSE_DIR, 'lessons');
const MEDIA_DIR = path.join(COURSE_DIR, 'media');

const DAYS = [
  { n: 1, title: '初识产品 & 系统初始化 & 工作应用', range: [1, 5], hours: 6 },
  { n: 2, title: '对象管理 & 线索管理', range: [6, 13], hours: 5 },
  { n: 3, title: '客户管理 & 商机管理', range: [14, 19], hours: 4 },
  { n: 4, title: '交易管理 & LTC 串讲', range: [20, 21], hours: 4 },
  { n: 5, title: '审批流 & 工作流 & 业务流', range: [22, 25], hours: 4 },
  { n: 6, title: '数据权限 & BI 报表', range: [26, 28], hours: 4 },
  { n: 7, title: '数据维护 & 界面定制 & 作业', range: [29, 31], hours: 3 },
];

// 课件 → 课时 的对应关系（官方 14 份 PDF）
const PDFS = [
  ['00_纷享销客CRM零基础入门讲解.pdf', '零基础入门', [2]],
  ['01_1.系统初始化V2-2409.pdf', '系统初始化', [3, 4]],
  ['02_2.工作&应用V2-2409.pdf', '工作与应用', [5]],
  ['05_3、对象管理v3.0.pdf', '对象管理', [6, 7, 8, 9, 10, 11]],
  ['06_4、线索管理v3.0.pdf', '线索管理', [12, 13]],
  ['03_5.客户管理V2.pdf', '客户管理', [14, 15]],
  ['04_6.商机管理V2.pdf', '商机管理', [16, 17, 18, 19, 20, 21]],
  ['07_8、审批流v3.0.pdf', '审批流', [22]],
  ['08_9、工作流v3.0.pdf', '工作流', [23, 24]],
  ['09_10、业务流v3.0.pdf', '业务流', [25]],
  ['10_11、数据权限管理v3.0.pdf', '数据权限管理', [26, 27]],
  ['11_12、BI数据报表课件v3.0.pdf', 'BI 数据报表', [28]],
  ['12_13、数据维护工具v3.0.pdf', '数据维护工具', [29, 31]],
  ['13_14、界面定制管理v3.0.pdf', '界面定制管理', [30, 31]],
];

const pdfOf = (n) => PDFS.filter((p) => p[2].includes(n)).map((p) => p[0]);
const dayOf = (n) => DAYS.find((d) => n >= d.range[0] && n <= d.range[1]);

/* ---------------- HTML → Markdown ---------------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ', para: '¶', hellip: '…', mdash: '—', ndash: '–', middot: '·', rarr: '→', le: '≤', ge: '≥', times: '×', divide: '÷' };
function decode(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

const textOf = (n) => decode(n.rawText ?? n.text ?? '');

function inline(node) {
  if (node.nodeType === 3) return textOf(node);
  const tag = (node.rawTagName || '').toLowerCase();
  if (tag === 'a' && (node.getAttribute('class') || '').includes('headerlink')) return '';
  if (node.nodeType === 8 /* comment */) return '';
  const kids = () => (node.childNodes || []).map(inline).join('');
  switch (tag) {
    case 'strong': case 'b': return `**${kids().trim()}**`;
    case 'em': case 'i': return `*${kids().trim()}*`;
    case 'del': case 's': return `~~${kids().trim()}~~`;
    case 'code': return `\`${textOf(node)}\``;
    case 'a': {
      const href = node.getAttribute('href') || '';
      const label = kids().trim();
      if (!label) return '';
      return href && !href.startsWith('#') ? `[${label}](${href})` : label;
    }
    case 'img': {
      const src = node.getAttribute('src') || '';
      const alt = (node.getAttribute('alt') || '').replace(/\n/g, ' ');
      return `![${alt}](${src})`;
    }
    case 'br': return '\n';
    case 'sub': return `<sub>${kids()}</sub>`;
    case 'sup': return `<sup>${kids()}</sup>`;
    default: return kids();
  }
}

function tableToMd(node) {
  const rows = node.querySelectorAll('tr');
  if (!rows.length) return '';
  const firstCells = rows[0].querySelectorAll('th,td');
  const cols = firstCells.length;
  const cell = (n) => inline(n).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim();
  let head = '| ' + firstCells.map(cell).join(' | ') + ' |';
  let sep = '| ' + Array(cols).fill('---').join(' | ') + ' |';
  const body = rows.slice(1).map((tr) => '| ' + tr.querySelectorAll('th,td').map(cell).join(' | ') + ' |');
  return [head, sep, ...body].join('\n');
}

function listToMd(node, indent = '') {
  const ordered = node.rawTagName.toLowerCase() === 'ol';
  const out = [];
  let i = 1;
  for (const li of node.childNodes.filter((c) => c.nodeType === 1 && c.rawTagName.toLowerCase() === 'li')) {
    const own = [];
    const nested = [];
    for (const c of li.childNodes) {
      if (c.nodeType === 1 && ['ul', 'ol'].includes(c.rawTagName.toLowerCase())) nested.push(listToMd(c, indent + '  '));
      else own.push(inline(c));
    }
    const body = own.join('').trim().replace(/\n\s*\n/g, '\n');
    out.push(`${indent}${ordered ? `${i++}.` : '-'} ${body}${nested.length ? '\n' + nested.join('\n') : ''}`);
  }
  return out.join('\n');
}

function blockToMd(node) {
  const tag = (node.rawTagName || '').toLowerCase();
  switch (tag) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const level = Number(tag[1]);
      const t = inline(node).replace(/\s+/g, ' ').trim();
      return t ? `${'#'.repeat(level)} ${t}` : '';
    }
    case 'p': return inline(node).replace(/\u00a0/g, ' ').trim();
    case 'ul': case 'ol': return listToMd(node);
    case 'blockquote': {
      const inner = walk(node).trim();
      return inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
    }
    case 'pre': {
      const pre = node.querySelector('code') || node;
      pre.querySelectorAll('a').forEach((a) => a.remove());
      const lines = pre.querySelectorAll('span[id^="__span-"]');
      let text = lines.length
        ? lines.map((s) => s.textContent).join('')
        : pre.textContent;
      text = decode(text).replace(/<\/?[a-zA-Z][^>]*>/g, '').replace(/\n+$/, '');
      const cls = (node.querySelector('code')?.getAttribute('class') || '') + (node.getAttribute('class') || '');
      const lang = (cls.match(/language-(\w+)/) || cls.match(/highlight-(\w+)/) || [])[1] || '';
      return '```' + (lang === 'text' ? '' : lang) + '\n' + text + '\n```';
    }
    case 'table': return tableToMd(node);
    case 'hr': return '---';
    case 'img': return inline(node);
    case 'div': {
      const cls = node.getAttribute('class') || '';
      if (cls.includes('highlight')) return blockToMd(node.querySelector('pre') || node);
      if (cls.includes('admonition')) {
        const title = node.querySelector('.admonition-title')?.textContent?.trim() || '提示';
        const rest = node.childNodes.filter((c) => c.nodeType === 1 && !(c.getAttribute('class') || '').includes('admonition-title'));
        return `> **${title}**\n>\n` + walk({ childNodes: rest }).trim().split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
      }
      return walk(node);
    }
    default: return inline(node);
  }
}

function walk(node) {
  const parts = [];
  for (const child of node.childNodes || []) {
    if (child.nodeType === 3) {
      const t = textOf(child).trim();
      if (t) parts.push(t);
      continue;
    }
    if (child.nodeType !== 1) continue;
    const md = blockToMd(child).trim();
    if (md) parts.push(md);
  }
  return parts.join('\n\n');
}

/* ---------------- 抓取 ---------------- */

const cache = new Map();
async function fetchHtml(url) {
  if (cache.has(url)) return cache.get(url);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 platform-migrate' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const html = await res.text();
      cache.set(url, html);
      return html;
    } catch (e) {
      if (attempt === 2) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
}

const articleOf = (html) => {
  const root = parse(html);
  const art = root.querySelector('article.md-content__inner') || root.querySelector('article');
  art?.querySelectorAll('.headerlink').forEach((a) => a.remove());
  return art;
};

/* ---------------- 主流程 ---------------- */

const catalog = { days: DAYS, lessons: [], pdfs: [] };
const images = new Set();

await fs.mkdir(LESSON_DIR, { recursive: true });
await fs.mkdir(MEDIA_DIR, { recursive: true });

// 课程不存在时先生成最小 course.json，避免抓完内容却不出现在课程库
try {
  await fs.access(path.join(COURSE_DIR, 'course.json'));
} catch {
  await fs.writeFile(
    path.join(COURSE_DIR, 'course.json'),
    JSON.stringify(
      {
        id: COURSE_ID,
        order: 99,
        color: '#6366f1',
        mark: COURSE_ID.toUpperCase().slice(0, 3),
        title: COURSE_ID,
        subtitle: '',
        description: '',
        version: 'v1.0',
        updated: new Date().toISOString().slice(0, 10),
        tags: [],
      },
      null,
      2
    ),
    'utf8'
  );
  console.log(`已生成 content/courses/${COURSE_ID}/course.json，可再改成正式标题`);
}

for (const day of DAYS) {
  try {
    const html = await fetchHtml(`${BASE}/day${day.n}/`);
    const art = articleOf(html);
    art?.querySelector('h1')?.remove();
    const intro = walk(art)
      .split('\n\n')
      .filter((b) => b && !b.startsWith('|') && !b.startsWith('- [') && !b.startsWith('#'))
      .slice(0, 4)
      .join('\n\n')
      .trim();
    if (intro) day.intro = intro;
  } catch (e) {
    console.warn('day intro skipped', day.n, e.message);
  }
}

for (let n = 1; n <= 31; n++) {
  const id = 'L' + String(n).padStart(2, '0');
  const url = `${BASE}/lessons/${id}/`;
  const html = await fetchHtml(url);
  const art = articleOf(html);
  if (!art) { console.warn('no article', id); continue; }

  const h1 = art.querySelector('h1');
  const rawTitle = h1 ? inline(h1).replace(/\s+/g, ' ').trim() : id;
  h1?.remove();

  let markdown = walk(art);
  // 首段 blockquote 里的元信息提取为结构化字段
  let duration = '';
  const metaMatch = markdown.match(/^> 时长\s*([0-9:：]+)[^\n]*\n?/);
  if (metaMatch) {
    duration = metaMatch[1].replace('：', ':');
    markdown = markdown.slice(metaMatch[0].length).trim();
  }

  // 收集并改写图片路径
  markdown = markdown.replace(/!\[([^\]]*)\]\((\.\.\/\.\.\/media\/[^)]+)\)/g, (_m, alt, src) => {
    const rel = src.replace('../../', '');
    images.add(rel);
    const file = rel.split('/').pop();
    return `![${alt}](../../assets/media/${id}/${file})`;
  });

  const day = dayOf(n);
  const front = {
    id,
    order: n,
    day: day.n,
    title: rawTitle.replace(/^课时\d+\s*/, ''),
    fullTitle: rawTitle,
    duration,
    pdf: pdfOf(n),
  };

  const body = [
    '---',
    JSON.stringify(front, null, 2),
    '---',
    '',
    markdown,
    '',
  ].join('\n');

  await fs.writeFile(path.join(LESSON_DIR, `${id}.md`), body, 'utf8');
  catalog.lessons.push({ ...front, dayTitle: day.title });
  process.stdout.write(`✓ ${id} ${front.title} (${duration})\n`);
}

catalog.pdfs = PDFS.map(([file, title, lessons]) => ({ file, title, lessons }));

// 下载被引用的截图
const MEDIA_BASE = `${BASE}/media/`;
let ok = 0, fail = 0;
for (const rel of images) {
  // 拍平：media/L01/slides/x.jpg → <课程目录>/media/L01/x.jpg（与 md 里的图片路径一致）
  const parts = rel.split('/');
  const lessonKey = parts[1];
  const fileName = parts[parts.length - 1];
  const outPath = path.join(MEDIA_DIR, lessonKey, fileName);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  try {
    await fs.access(outPath);
    ok++;
    continue;
  } catch { /* 未下载过 */ }
  try {
    const res = await fetch(MEDIA_BASE + rel.replace(/^media\//, ''));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    await fs.writeFile(outPath, Buffer.from(await res.arrayBuffer()));
    ok++;
  } catch (e) {
    fail++;
    console.warn('img fail', rel, e.message);
  }
}
process.stdout.write(`\n截图 ${ok} 张下载完成，失败 ${fail}\n`);

await fs.writeFile(path.join(COURSE_DIR, 'catalog.json'), JSON.stringify(catalog, null, 2), 'utf8');
process.stdout.write(`内容源写入完成：${catalog.lessons.length} 课时\n`);
