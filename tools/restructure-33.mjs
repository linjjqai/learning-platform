/**
 * 把课程从 31 课时重排成平台的 33 课时
 * - L17+L18 合并为 17（商机作业讲解1），L19 顺延为 18
 * - 新增 22 审批流作业1、23 审批流作业2、27 业务流作业（由后续脚本填内容）
 * - 统一更新 id / order / day / title / duration，去掉每课手写的上一课/下一课页尾
 *
 * 用法: node tools/restructure-33.mjs [--dry]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'content', 'courses', 'crm', 'lessons');
const TMP = path.join(ROOT, 'content', 'courses', 'crm', '_lessons_new');
const dry = process.argv.includes('--dry');

const TITLES = {
  1: '组织结构及业务流程介绍', 2: '认识纷享销客CRM', 3: '系统初始化——功能讲解', 4: '系统初始化作业讲解',
  5: '工作应用模块——功能讲解', 6: '对象管理-对象、字段', 7: '对象管理-布局、业务类型',
  8: '对象管理-字段依赖、布局规则、验证规则', 9: '对象管理-角色权限', 10: '对象管理-按钮、场景管理',
  11: '对象管理练习题讲解', 12: '线索管理——功能讲解', 13: '线索管理练习题讲解',
  14: '客户管理——功能讲解', 15: '客户管理作业讲解', 16: '商机管理', 17: '商机管理作业讲解1',
  18: '商机管理作业讲解2', 19: '交易管理——功能讲解', 20: 'LTC串讲', 21: '审批流——功能讲解',
  22: '审批流作业讲解1', 23: '审批流作业讲解2', 24: '工作流——功能讲解', 25: '工作流作业讲解',
  26: '业务流——功能讲解', 27: '业务流作业讲解', 28: '数据权限管理——功能讲解',
  29: '数据权限管理练习题讲解', 30: 'BI报表功能讲解', 31: '数据维护工具——功能讲解',
  32: '界面定制管理——功能讲解', 33: '数据维护工具和界面定制管理作业讲解',
};
const DURATION = {
  1: '87:55', 2: '15:27', 3: '62:16', 4: '64:42', 5: '58:32', 6: '37:56', 7: '18:58', 8: '15:23',
  9: '21:53', 10: '30:18', 11: '45:02', 12: '69:20', 13: '24:46', 14: '74:40', 15: '17:56',
  16: '59:57', 17: '35:18', 18: '53:29', 19: '62:49', 20: '55:17', 21: '64:54', 22: '22:59',
  23: '20:36', 24: '43:50', 25: '14:36', 26: '62:26', 27: '83:02', 28: '35:36', 29: '10:53',
  30: '66:08', 31: '18:23', 32: '35:42', 33: '18:21',
};
const DAY_OF = (n) => (n <= 5 ? 1 : n <= 13 ? 2 : n <= 18 ? 3 : n <= 20 ? 4 : n <= 27 ? 5 : n <= 30 ? 6 : 7);

// 旧编号 -> 新编号；18 合并进 17
const MAP = {
  1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, 11: 11, 12: 12, 13: 13, 14: 14,
  15: 15, 16: 16, 17: 17, 18: 17, 19: 18, 20: 19, 21: 20, 22: 21, 23: 24, 24: 25, 25: 26,
  26: 28, 27: 29, 28: 30, 29: 31, 30: 32, 31: 33,
};

const parse = (raw) => {
  const end = raw.indexOf('\n---', 3);
  const fm = JSON.parse(raw.slice(3, end));
  let body = raw.slice(end + 4).replace(/^\s*\n/, '');
  // 去掉手写页尾（上一课/返回目录/下一课）
  const cut = body.lastIndexOf('\n---\n\n- ←');
  if (cut > 0) body = body.slice(0, cut).trimEnd();
  return { fm, body };
};

const splitSections = (body) => {
  const lines = body.split('\n');
  const out = [];
  let cur = { title: '', lines: [] };
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) { out.push(cur); cur = { title: m[1], lines: [] }; }
    else cur.lines.push(line);
  }
  out.push(cur);
  return out.filter((s) => s.title || s.lines.join('').trim());
};

const joinSections = (secs) =>
  secs.map((s) => (s.title ? `## ${s.title}\n${s.lines.join('\n').trim()}\n` : s.lines.join('\n').trim())).join('\n');

/** 合并两节课：同类章节拼接，时间轴只保留第一节并加说明 */
function mergeBodies(a, b, aTitle) {
  const sa = splitSections(a), sb = splitSections(b);
  const merged = [];
  const order = ['速览', '核心要点', '结构与流程', '术语表', '注意', '关键截图', '时间轴'];
  for (const key of order) {
    const pick = (list) => list.find((s) => s.title.includes(key));
    const x = pick(sa), y = pick(sb);
    if (key === '时间轴') {
      if (x || y) {
        const body = (x ? x.lines.join('\n').trim() : '') +
          `\n\n> 本节由原「配置题01」「配置题02」两段讲解合并，时间轴对应第一段视频；第二段的题解已并入上面的要点。`;
        merged.push({ title: x?.title || '关键节点时间轴', lines: body.split('\n') });
      }
      continue;
    }
    if (!x && !y) continue;
    const lines = [];
    if (x) lines.push(x.lines.join('\n').trim());
    if (y) lines.push(y.lines.join('\n').trim());
    merged.push({ title: x?.title || y.title, lines: lines.join('\n\n').split('\n') });
  }
  // 兜底：未被识别归类的章节
  for (const s of sa.filter((s) => s.title && !order.some((k) => s.title.includes(k)))) merged.push(s);
  return joinSections(merged);
}

const files = (await fs.readdir(DIR)).filter((f) => /^L\d+\.md$/.test(f));
const byOld = new Map();
for (const f of files) {
  const raw = await fs.readFile(path.join(DIR, f), 'utf8');
  const { fm, body } = parse(raw);
  byOld.set(Number(f.match(/\d+/)[0]), { fm, body });
}

const out = new Map();
for (const [oldN, data] of [...byOld.entries()].sort((a, b) => a[0] - b[0])) {
  const target = MAP[oldN];
  if (!target) continue;
  if (out.has(target)) {
    const prev = out.get(target);
    prev.body = mergeBodies(prev.body, data.body, prev.fm.title);
    continue;
  }
  out.set(target, { fm: { ...data.fm }, body: data.body });
}

await fs.rm(TMP, { recursive: true, force: true });
await fs.mkdir(TMP, { recursive: true });

for (const [n, { fm, body }] of [...out.entries()].sort((a, b) => a[0] - b[0])) {
  const id = 'L' + String(n).padStart(2, '0');
  const front = {
    id,
    order: n,
    day: DAY_OF(n),
    title: TITLES[n],
    fullTitle: `课时${n} ${TITLES[n]}`,
    duration: DURATION[n],
    pdf: fm.pdf || [],
    ...(fm.tags ? { tags: fm.tags } : {}),
  };
  const content = `---\n${JSON.stringify(front, null, 2)}\n---\n\n${body.trim()}\n`;
  if (!dry) await fs.writeFile(path.join(TMP, `${id}.md`), content, 'utf8');
  console.log(`${String(n).padStart(2)} ${TITLES[n]}`);
}

if (dry) { console.log('\n（dry run，未写入）'); process.exit(0); }

// 替换目录
await fs.rm(DIR, { recursive: true, force: true });
await fs.rename(TMP, DIR);

// 更新 catalog：章节标题按平台，去掉写死的 hours 让构建自动算
const catPath = path.join(ROOT, 'content', 'courses', 'crm', 'catalog.json');
const cat = JSON.parse(await fs.readFile(catPath, 'utf8'));
cat.days = [
  { n: 1, title: '初识纷享销客CRM', range: [1, 5], intro: cat.days?.[0]?.intro || '' },
  { n: 2, title: '对象管理、线索管理', range: [6, 13], intro: cat.days?.[1]?.intro || '' },
  { n: 3, title: '客户管理、商机管理', range: [14, 18], intro: cat.days?.[2]?.intro || '' },
  { n: 4, title: '交易管理、LTC串讲', range: [19, 20], intro: cat.days?.[3]?.intro || '' },
  { n: 5, title: '流程管理', range: [21, 27], intro: cat.days?.[4]?.intro || '' },
  { n: 6, title: 'CRM权限、BI报表', range: [28, 30], intro: cat.days?.[5]?.intro || '' },
  { n: 7, title: '数据维护工具、界面定制管理', range: [31, 33], intro: cat.days?.[6]?.intro || '' },
];
await fs.writeFile(catPath, JSON.stringify(cat, null, 2), 'utf8');

console.log(`\n✓ 重排完成：${out.size} 课时（缺 22/23/27 待补内容）`);
