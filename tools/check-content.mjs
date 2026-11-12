import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('dist');
const dir = path.join(DIST, 'crm');
const ids = fs.readdirSync(dir).filter((n) => /^L\d+$/.test(n)).sort();

const rows = [];
for (const id of ids) {
  const file = path.join(dir, id, 'index.html');
  if (!fs.existsSync(file)) { rows.push({ id, error: 'MISSING PAGE' }); continue; }
  const s = fs.readFileSync(file, 'utf8');
  rows.push({
    id,
    h1: (/<h1>([^<]*)<\/h1>/.exec(s) || [])[1] || '',
    overview: s.includes('30 秒速览'),
    points: s.includes('核心要点'),
    glossary: (s.match(/class="glossary__row"/g) || []).length,
    pitfalls: s.includes('容易踩的坑'),
    shots: (s.match(/class="shot"/g) || []).length,
    timeline: (s.match(/class="timeline__item"/g) || []).length,
    quiz: (s.match(/class="q"/g) || []).length,
    kb: Math.round(Buffer.byteLength(s) / 1024),
  });
}

const bad = rows.filter((r) => r.error || !r.overview || !r.points || !r.glossary || !r.shots || !r.timeline);
console.log('lesson\tglossary\tshots\ttimeline\tquiz\tKB\tflags');
for (const r of rows) {
  const flags = [r.error, !r.overview && 'no速览', !r.points && 'no要点', !r.glossary && 'no术语', !r.shots && 'no截图', !r.timeline && 'no时间轴'].filter(Boolean).join(',');
  console.log(`${r.id}\t${r.glossary}\t${r.shots}\t${r.timeline}\t${r.quiz}\t${r.kb}\t${flags}`);
}
console.log(`\n共 ${rows.length} 课，异常 ${bad.length} 课`);
