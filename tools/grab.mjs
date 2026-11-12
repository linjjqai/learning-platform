/**
 * 通过 CDP 接管已登录的 Edge 窗口，抓取培训视频画面
 *
 * 用法：
 *   node tools/grab.mjs list                 列出当前所有页面
 *   node tools/grab.mjs probe [关键字]        探查页面结构（video/iframe/按钮/文本）
 *   node tools/grab.mjs shot <文件名>         对当前页面截一张图
 *   node tools/grab.mjs capture <输出目录> <秒数逗号列表>   逐时间点 seek + 截图
 *   node tools/grab.mjs meta                  读取 <video> 的时长/尺寸/当前时间
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PORT = Number(process.env.CDP_PORT || 9222);
const ROOT = path.resolve(import.meta.dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 窗口被遮挡时 Chromium 不渲染，截图会全白：每次截图前把 Edge 拉到前台 */
function focusEdge() {
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `$p = Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*纷享*' } | Select-Object -First 1;
       if ($p) {
         Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);' -Name W -Namespace U -ErrorAction SilentlyContinue;
         [void][U.W]::ShowWindow($p.MainWindowHandle, 9);
         [void][U.W]::SetForegroundWindow($p.MainWindowHandle);
       }`,
    ], { stdio: 'ignore', timeout: 8000 });
  } catch { /* 忽略 */ }
}

async function devtools() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pend = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id;
    pend.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { ws, send };
}

async function evaluate(send, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

async function pickPage(keyword) {
  const list = await devtools();
  const pages = list.filter((t) => t.type === 'page' && /^https?:/.test(t.url));
  if (keyword) return pages.find((p) => p.url.includes(keyword) || p.title.includes(keyword)) || pages[0];
  return pages.find((p) => /fxiaoke/i.test(p.url)) || pages[0];
}

const cmd = process.argv[2] || 'list';

if (cmd === 'list') {
  const list = await devtools();
  for (const t of list.filter((x) => x.type === 'page')) {
    console.log(`- ${t.title}\n  ${t.url}`);
  }
  process.exit(0);
}

const target = await pickPage(process.argv[3] && cmd === 'probe' ? process.argv[3] : undefined);
if (!target) { console.error('没有可用页面'); process.exit(1); }
const { send } = await connect(target);
await send('Page.enable');
await send('Runtime.enable');

if (cmd === 'click') {
  const text = process.argv[3];
  if (!text) { console.error('需要要点击的文字'); process.exit(1); }
  const r = await evaluate(send, `(() => {
    const t = ${JSON.stringify(text)};
    const els = [...document.querySelectorAll('div,li,span,a,button')];
    const hit = els.find(e => (e.innerText || '').trim().startsWith(t) && (e.innerText || '').trim().length < 120);
    if (!hit) return { ok: false };
    hit.scrollIntoView({ block: 'center' });
    hit.click();
    return { ok: true, text: (hit.innerText || '').trim().slice(0, 60), cls: hit.className };
  })()`);
  console.log(JSON.stringify(r));
  await sleep(Number(process.argv[4] || 6000));
  console.log('url:', await evaluate(send, 'location.href'));
  process.exit(0);
}

if (cmd === 'nav') {
  const url = process.argv[3];
  if (!url) { console.error('需要 URL'); process.exit(1); }
  await send('Page.navigate', { url });
  await sleep(Number(process.argv[4] || 6000));
  const href = await evaluate(send, 'location.href');
  console.log('now at:', href);
  process.exit(0);
}

if (cmd === 'probe') {
  const info = await evaluate(send, `(() => {
    const vids = [...document.querySelectorAll('video')].map(v => ({
      src: (v.currentSrc || v.src || '').slice(0, 200),
      duration: v.duration, width: v.videoWidth, height: v.videoHeight,
      paused: v.paused, t: v.currentTime
    }));
    return {
      url: location.href,
      title: document.title,
      videos: vids,
      iframes: [...document.querySelectorAll('iframe')].map(f => f.src).slice(0, 10),
      canvases: document.querySelectorAll('canvas').length,
      buttons: [...document.querySelectorAll('button,[class*=btn],[class*=play]')].map(b => (b.innerText || b.className || '').toString().trim().slice(0, 30)).filter(Boolean).slice(0, 25),
      text: (document.body.innerText || '').slice(0, 500)
    };
  })()`);
  console.log(JSON.stringify(info, null, 2));
  process.exit(0);
}

if (cmd === 'meta') {
  const info = await evaluate(send, `(() => {
    const v = document.querySelector('video');
    if (!v) return { hasVideo: false };
    return { hasVideo: true, duration: v.duration, w: v.videoWidth, h: v.videoHeight, src: (v.currentSrc||'').slice(0,160) };
  })()`);
  console.log(JSON.stringify(info, null, 2));
  process.exit(0);
}

if (cmd === 'clickxy') {
  const x = Number(process.argv[3]);
  const y = Number(process.argv[4]);
  if (Number.isNaN(x) || Number.isNaN(y)) { console.error('需要 x y'); process.exit(1); }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  console.log(`clicked ${x},${y}`);
  await sleep(Number(process.argv[5] || 3000));
  const st = await evaluate(send, `(() => { const v = document.querySelector('video'); return v ? { rs: v.readyState, d: v.duration, t: v.currentTime, paused: v.paused, w: v.videoWidth } : null; })()`);
  console.log(JSON.stringify(st));
  process.exit(0);
}

if (cmd === 'play') {
  const r = await evaluate(send, `(async () => {
    const v = document.querySelector('video');
    if (!v) return { ok: false, reason: 'no video' };
    try { await v.play(); } catch (e) { /* 可能需要用户手势 */ }
    await new Promise(r => {
      if (v.readyState >= 1) return r();
      const done = () => r();
      v.addEventListener('loadedmetadata', done, { once: true });
      setTimeout(r, 15000);
    });
    return { ok: true, duration: v.duration, readyState: v.readyState, paused: v.paused, t: v.currentTime, w: v.videoWidth, h: v.videoHeight };
  })()`);
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}

if (cmd === 'shot') {
  const out = path.join(ROOT, '_inbox', 'frames', process.argv[3] || 'shot.png');
  await fs.mkdir(path.dirname(out), { recursive: true });
  await send('Page.bringToFront').catch(() => {});
  focusEdge();
  await sleep(900);
  const shotOnce = async (params) => {
    const p = send('Page.captureScreenshot', params);
    const timeout = new Promise((r) => setTimeout(() => r(null), 8000));
    return Promise.race([p, timeout]);
  };
  let res = await shotOnce({ format: 'png' });
  if (!res) res = await shotOnce({ format: 'png', fromSurface: false });
  if (!res) { console.error('截图超时（窗口可能被遮挡）'); process.exit(2); }
  await fs.writeFile(out, Buffer.from(res.data, 'base64'));
  console.log('saved', out, Math.round(Buffer.byteLength(res.data, 'base64') / 1024) + 'KB');
  process.exit(0);
}

if (cmd === 'capture') {
  const outDir = path.join(ROOT, '_inbox', 'frames', process.argv[3] || 'capture');
  const times = (process.argv[4] || '0').split(',').map(Number).filter((n) => !Number.isNaN(n));
  await fs.mkdir(outDir, { recursive: true });

  for (const t of times) {
    const ok = await evaluate(send, `(async () => {
      const v = document.querySelector('video');
      if (!v) return { ok: false, reason: 'no video element' };
      v.pause();
      v.currentTime = ${t};
      await new Promise(r => {
        const done = () => { v.removeEventListener('seeked', done); r(); };
        v.addEventListener('seeked', done);
        setTimeout(r, 4000);
      });
      await new Promise(r => setTimeout(r, 500));
      return { ok: true, t: v.currentTime, duration: v.duration };
    })()`);
    if (!ok.ok) { console.log(`× ${t}s ${ok.reason}`); continue; }
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const name = `t${String(t).padStart(5, '0')}.png`;
    await fs.writeFile(path.join(outDir, name), Buffer.from(data, 'base64'));
    console.log(`✓ ${t}s -> ${name}`);
  }
  process.exit(0);
}

console.error('未知命令:', cmd);
console.error('可用: list | probe | meta | shot <name> | capture <dir> <秒,...>');
process.exit(1);
