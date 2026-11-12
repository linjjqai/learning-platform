/**
 * 抓取培训视频画面（从 video 元素取帧，不依赖窗口是否可见）
 *
 * 用法:
 *   node tools/fx-capture.mjs "<课时关键字>" <输出目录> [间隔秒=45] [起始秒=0] [结束秒=视频末尾]
 *
 * 例:
 *   node tools/fx-capture.mjs "课时1 组织结构" L01 45
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const PORT = Number(process.env.CDP_PORT || 9222);
const ROOT = path.resolve(import.meta.dirname, '..');
const [lessonKey, outName, intervalArg, startArg, endArg] = process.argv.slice(2);
if (!lessonKey || !outName) {
  console.error('用法: node tools/fx-capture.mjs "<课时关键字>" <输出目录> [间隔=45] [起始=0] [结束=末尾]');
  process.exit(1);
}
const interval = Number(intervalArg || 45);
const startAt = Number(startArg || 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find((t) => t.type === 'page' && /fxiaoke/i.test(t.url));
if (!target) { console.error('找不到纷享页面'); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

// 1. 点击目标课时（先滚动到可视区，再取坐标）
const row = await evaluate(`(() => {
  const key = ${JSON.stringify(lessonKey)};
  for (const el of document.querySelectorAll('.courseware_name, .courseware, div, span')) {
    const t = (el.innerText || '').trim();
    if (!t.startsWith(key)) continue;
    if (!(el.className || '').toString().includes('courseware')) continue;
    if (el.getBoundingClientRect().width < 40) continue;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: t.slice(0, 60) };
  }
  return null;
})()`);
if (!row) { console.error('没找到课时行:', lessonKey); process.exit(1); }
console.log('点击课时:', row.text);
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', { type, x: row.x, y: row.y, button: 'left', clickCount: 1 });
  await sleep(80);
}
await sleep(3500);

// 2. 等待播放器可用（必要时点一下播放键）
let meta = null;
for (let i = 0; i < 10; i++) {
  meta = await evaluate(`(() => { const v = document.querySelector('video'); return v ? { w: v.videoWidth, d: v.duration, t: v.currentTime } : null; })()`);
  if (meta && meta.w > 0 && meta.d) break;
  await sleep(1500);
}
if (!meta || !meta.d) {
  // 尝试点击播放器中央触发加载
  const box = await evaluate(`(() => { const v = document.querySelector('video'); if (!v) return null; const r = v.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  if (box) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await sleep(80);
    }
    await sleep(4000);
    meta = await evaluate(`(() => { const v = document.querySelector('video'); return v ? { w: v.videoWidth, d: v.duration } : null; })()`);
  }
}
if (!meta || !meta.d) { console.error('播放器未就绪:', JSON.stringify(meta)); process.exit(2); }

const duration = Math.floor(meta.d);
const endAt = endArg ? Math.min(Number(endArg), duration) : duration;
const outDir = path.join(ROOT, '_inbox', 'frames', outName);
await fs.mkdir(outDir, { recursive: true });
console.log(`视频 ${meta.w}px · 时长 ${duration}s · 采样 ${startAt}→${endAt}s 每 ${interval}s`);

// 3. 逐段采样（每批 12 个时间点，避免单次 evaluate 太久）
const times = [];
for (let t = startAt; t < endAt; t += interval) times.push(t);

const saved = [];
for (let i = 0; i < times.length; i += 12) {
  const batch = times.slice(i, i + 12);
  const frames = await evaluate(`(async () => {
    const v = document.querySelector('video');
    if (!v) return [];
    const canvas = document.createElement('canvas');
    canvas.width = 960; canvas.height = 540;
    const ctx = canvas.getContext('2d');
    const out = [];
    for (const t of ${JSON.stringify(batch)}) {
      v.pause();
      v.currentTime = t;
      await new Promise(res => {
        let done = false;
        const fin = () => { if (!done) { done = true; res(); } };
        v.addEventListener('seeked', fin, { once: true });
        setTimeout(fin, 8000);
      });
      await new Promise(res => setTimeout(res, 260));
      try { ctx.drawImage(v, 0, 0, canvas.width, canvas.height); } catch (e) { out.push({ t, err: String(e) }); continue; }
      // 指纹：缩到 16x9 灰度均值
      const sig = document.createElement('canvas');
      sig.width = 16; sig.height = 9;
      const sctx = sig.getContext('2d');
      sctx.drawImage(canvas, 0, 0, 16, 9);
      const d = sctx.getImageData(0, 0, 16, 9).data;
      const arr = [];
      for (let k = 0; k < d.length; k += 4) arr.push(Math.round((d[k] * 0.299 + d[k + 1] * 0.587 + d[k + 2] * 0.114)));
      out.push({ t, sig: arr, jpeg: canvas.toDataURL('image/jpeg', 0.72).split(',')[1] });
    }
    return out;
  })()`);

  for (const f of frames) {
    if (!f || f.err) { console.log(`× ${f && f.t} ${f && f.err}`); continue; }
    const name = `t${String(f.t).padStart(5, '0')}.jpg`;
    await fs.writeFile(path.join(outDir, name), Buffer.from(f.jpeg, 'base64'));
    saved.push({ t: f.t, file: name });
    console.log(`✓ ${f.t}s -> ${name}`);
  }
}

await fs.writeFile(path.join(outDir, 'index.json'), JSON.stringify({ lesson: lessonKey, duration, interval, frames: saved }, null, 2), 'utf8');
console.log(`\n完成：${saved.length} 帧 -> ${outDir}`);
ws.close();
