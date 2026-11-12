/**
 * 验收脚本：用 Chrome DevTools Protocol 驱动 Edge headless
 *  - 强制浅色/深色整页截图
 *  - 收集控制台错误
 *  - 自动跑交互：课程卡、搜索、答题、打卡、术语筛选、图片加载
 *
 * 用法: node tools/shoot.mjs [baseUrl]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:4173';
const OUT = path.resolve(import.meta.dirname, '..', '_shots');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await fs.mkdir(OUT, { recursive: true });

const profile = path.join(process.env.TEMP, 'edge-cdp-' + Date.now());
const proc = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--disable-extensions',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('devtools 未就绪');
}
await waitForDevtools();

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let seq = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    logs.push(`[console.${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    logs.push('[exception] ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    logs.push('[log] ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
  }
});
function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');

async function emulateTheme(scheme) {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try{localStorage.setItem('lp:theme','${scheme}')}catch(e){}`,
  });
}

async function goto(url, { width = 1440, height = 1000, wait = 900, theme = 'light' } = {}) {
  await emulateTheme(theme);
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
  await send('Page.navigate', { url });
  await sleep(wait);
}

async function shot(name, { full = true } = {}) {
  let params = { format: 'png' };
  if (full) {
    const { cssContentSize } = await send('Page.getLayoutMetrics');
    params = {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.ceil(cssContentSize.width), height: Math.min(cssContentSize.height, 12000), scale: 1 },
    };
  }
  const { data } = await send('Page.captureScreenshot', params);
  await fs.writeFile(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

const report = { pages: {}, checks: [], errors: logs };

// 1. 平台首页（课程库）
await goto(`${BASE}/`);
await shot('portal');
await shot('portal-top', { full: false });
report.pages.portal = await evaluate(`({
  title: document.title,
  courses: document.querySelectorAll('.coursecard').length,
  courseTitle: document.querySelector('.coursecard__top strong')?.textContent,
  prevText: document.querySelector('[data-course-text]')?.textContent,
  menuItems: document.querySelectorAll('.coursemenu__item').length
})`);

// 2. 课程首页
await goto(`${BASE}/crm/`);
await shot('home');
report.pages.courseHome = await evaluate(`({
  h1: document.querySelector('.hero h1')?.textContent,
  lessons: document.querySelectorAll('.lessonchip').length,
  days: document.querySelectorAll('.path__item').length,
  materials: document.querySelectorAll('.material').length,
  courseMenu: document.querySelector('.coursemenu__title')?.textContent,
  continueHref: document.querySelector('#continue-btn')?.getAttribute('href')
})`);

// 2.5 课程切换器
await evaluate(`document.querySelector('#coursemenu-btn')?.click()`);
await sleep(250);
report.checks.push({ name: 'course-switcher', ...(await evaluate(`({
  open: document.querySelector('#coursemenu')?.classList.contains('is-open'),
  items: [...document.querySelectorAll('.coursemenu__item')].map(a => a.getAttribute('href')),
  visible: getComputedStyle(document.querySelector('.coursemenu__panel')).display
})`)) });
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);

// 3. 课时页
await goto(`${BASE}/crm/L01/`);
await shot('lesson');
await shot('lesson-top', { full: false });
// 滚动一遍触发懒加载图片
await evaluate(`(async()=>{for(let y=0;y<document.body.scrollHeight;y+=500){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,120));}window.scrollTo(0,0);return true;})()`);
await sleep(1800);
report.pages.lesson = await evaluate(`(async()=>{
  const imgs = [...document.querySelectorAll('.shot img')];
  imgs.forEach(i => { i.loading = 'eager'; });
  await Promise.all(imgs.map(i => (i.complete ? 0 : new Promise(r => { i.onload = r; i.onerror = r; }))));
  return {
    title: document.querySelector('.lesson__head h1')?.textContent,
    quizQuestions: document.querySelectorAll('.q').length,
    timeline: document.querySelectorAll('.timeline__item').length,
    shots: document.querySelectorAll('.shot').length,
    imagesOk: imgs.filter(i => i.naturalWidth > 0).length,
    imagesBad: imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src')),
    glossary: document.querySelectorAll('.glossary__row').length
  };
})()`);

// 4. 答题 + 进度
await evaluate(`(() => {
  document.querySelectorAll('.q').forEach(q => q.querySelector('.q__opt').click());
  document.querySelector('#quiz-submit')?.click();
  return true;
})()`);
await sleep(300);
report.checks.push({ name: 'quiz', ...(await evaluate(`({
  graded: document.querySelectorAll('.q.is-graded').length,
  score: document.querySelector('#quiz-score')?.textContent,
  saved: JSON.parse(localStorage.getItem('lp:progress:v2')||'{}').crm?.L01?.quiz
})`)) });
report.checks.push({ name: 'progress', ...(await evaluate(`({
  pill: document.querySelector('.pill__text')?.textContent,
  done: document.querySelectorAll('.nav__link.is-done').length
})`)) });
await shot('lesson-quiz');

// 5. 搜索（跨课程）
await goto(`${BASE}/crm/L01/`);
await evaluate(`document.querySelector('#search-open').click()`);
await sleep(500);
await evaluate(`(() => {
  const i = document.querySelector('#search-input');
  i.value = 'ARR';
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(400);
report.checks.push({ name: 'search', ...(await evaluate(`({
  results: document.querySelectorAll('.sr').length,
  marked: document.querySelectorAll('.sr mark').length,
  firstPath: document.querySelector('.sr__path')?.textContent,
  firstHref: document.querySelector('.sr')?.getAttribute('href')
})`)) });
await shot('search');

// 6. 术语页筛选
await goto(`${BASE}/crm/glossary/`);
await evaluate(`(() => {
  const f = document.querySelector('#glossary-filter');
  f.value = '权限';
  f.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(300);
report.checks.push({ name: 'glossary', ...(await evaluate(`({
  groups: [...document.querySelectorAll('.glossgroup')].filter(g=>!g.hidden).length,
  rows: [...document.querySelectorAll('.glossary__row')].filter(r=>!r.hidden).length
})`)) });
await shot('glossary');

// 7. 天数页
await goto(`${BASE}/crm/day/5/`);
await shot('day5');
report.pages.day5 = await evaluate(`({ cards: document.querySelectorAll('.lessoncard').length, h1: document.querySelector('h1')?.textContent })`);

// 8. 深色 + 移动端
await goto(`${BASE}/crm/L16/`, { theme: 'dark' });
await shot('lesson-dark-top', { full: false });
await goto(`${BASE}/`, { width: 390, height: 844, theme: 'light' });
await shot('mobile-portal');
await goto(`${BASE}/crm/`, { width: 390, height: 844, theme: 'light' });
await shot('mobile-home');

report.errors = logs;
await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));

ws.close();
proc.kill();
