/**
 * 合并 _inbox/quiz/*.json → content/courses/crm/exam.json
 * 同时校验每节 4 题、每题 4 选项、answer 在 0–3。
 *
 * 用法: node tools/make-exam.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const QDIR = path.join(ROOT, '_inbox', 'quiz');
const files = fs.readdirSync(QDIR).filter((f) => /^L\d+\.json$/.test(f)).sort();

const lessons = {};
const problems = [];

for (const f of files) {
  const id = f.replace('.json', '');
  let qs;
  try {
    qs = JSON.parse(fs.readFileSync(path.join(QDIR, f), 'utf8'));
  } catch (e) {
    problems.push(`${id}: JSON 解析失败 ${e.message}`);
    continue;
  }
  if (!Array.isArray(qs) || qs.length < 3) { problems.push(`${id}: 题数 ${Array.isArray(qs) ? qs.length : '非数组'}`); continue; }
  const clean = [];
  for (const q of qs.slice(0, 5)) {
    if (!q || typeof q.q !== 'string' || !Array.isArray(q.options) || q.options.length !== 4 || typeof q.answer !== 'number' || q.answer < 0 || q.answer > 3) {
      problems.push(`${id}: 题目结构不合法 -> ${String(q && q.q).slice(0, 30)}`);
      continue;
    }
    clean.push({ q: q.q, options: q.options, answer: q.answer, explain: q.explain || '' });
  }
  if (clean.length >= 3) lessons[id] = clean;
  else problems.push(`${id}: 有效题不足 3 道`);
}

const ids = Object.keys(lessons).sort();
console.log(`有效课时：${ids.length} / ${files.length}，题目合计 ${ids.reduce((n, id) => n + lessons[id].length, 0)}`);
if (problems.length) console.log('问题：\n  ' + problems.join('\n  '));

const DAY_OF = (n) => (n <= 5 ? 1 : n <= 13 ? 2 : n <= 18 ? 3 : n <= 20 ? 4 : n <= 27 ? 5 : n <= 30 ? 6 : 7);
const QUOTA = { 1: 4, 2: 5, 3: 4, 4: 3, 5: 5, 6: 2, 7: 2 };

const byDay = {};
for (const id of ids) {
  const d = DAY_OF(Number(id.slice(1)));
  (byDay[d] = byDay[d] || []).push({ id, questions: lessons[id] });
}

const final = [];
for (const d of [1, 2, 3, 4, 5, 6, 7]) {
  const pool = [];
  for (const item of byDay[d] || []) item.questions.forEach((q) => pool.push({ ...q, from: item.id }));
  const want = Math.min(QUOTA[d], pool.length);
  const step = pool.length / want;
  for (let k = 0; k < want; k++) {
    const q = pool[Math.floor(k * step)];
    if (q) final.push({ ...q, day: d });
  }
}

const exam = {
  passScore: 60,
  lessons,
  final: { title: '结业总测', questions: final },
};

const out = path.join(ROOT, 'content', 'courses', 'crm', 'exam.json');
fs.writeFileSync(out, JSON.stringify(exam, null, 2), 'utf8');
console.log(`✓ 写入 ${path.relative(ROOT, out)}`);
console.log('总测分布：' + [1, 2, 3, 4, 5, 6, 7].map((d) => `Day${d}=${final.filter((x) => x.day === d).length}`).join(' '));
