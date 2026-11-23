/**
 * 学习平台生成器（多课程版）
 * ------------------------------------------------------------------
 * 内容结构：
 *   content/portal.json                平台级配置（品牌、标题）
 *   content/courses/<课程ID>/course.json   课程配置（标题、颜色、简介）
 *   content/courses/<课程ID>/lessons/*.md  课时内容
 *   content/courses/<课程ID>/catalog.json  可选：天数分组 / 课件清单
 *   content/courses/<课程ID>/media/        课时截图
 *
 * 输出：
 *   dist/index.html                 课程库（平台首页）
 *   dist/<课程ID>/index.html        课程首页
 *   dist/<课程ID>/<课时ID>/          课时页
 *   dist/<课程ID>/day/<n>/           天数页
 *   dist/<课程ID>/glossary/          术语总表
 *   dist/<课程ID>/materials/         课件页
 *   dist/search-index.json          全局搜索索引
 *
 * 加内容 = 往 content/courses 里加课时 md 或加一个新课程目录，重新构建即可。
 */
import { marked } from 'marked';
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CONTENT = path.join(ROOT, 'content');
const COURSES_DIR = path.join(CONTENT, 'courses');
const DIST = path.join(ROOT, 'dist');
const PLATFORM = path.join(ROOT, 'platform');

/** 没有本地 PDF 时，课件从这里取（可改成自己的对象存储） */
const REMOTE_ASSETS = 'https://linjjqai.github.io/crm-training';

/** 未指定颜色时按顺序分配 */
const PALETTE = ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#f59e0b', '#f43f5e', '#a855f7'];
/** 每天一个主色 */
const DAY_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#f59e0b', '#f43f5e', '#a855f7'];

marked.setOptions({ gfm: true, breaks: false });

/* ---------------------------------- 工具 ---------------------------------- */

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const stripTags = (s = '') =>
  s.replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

const toSec = (t) => {
  const p = String(t).split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : 0;
};
const pad2 = (n) => String(n).padStart(2, '0');

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
const seeded = (str) => {
  let s = (hash(str) % 2147483647) || 7;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
};
const shuffle = (arr, rnd) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const plainText = (s = '') =>
  stripTags(s)
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

const md = (text) => marked.parse(text ?? '');
const mdInline = (text) => marked.parseInline(text ?? '');

/* --------------------------------- 内容解析 -------------------------------- */

function parseFrontMatter(raw) {
  if (!raw.startsWith('---')) return { data: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: raw };
  const json = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\s*\n/, '');
  let data = {};
  try { data = JSON.parse(json); } catch (e) { console.warn('front matter 解析失败', e.message); }
  return { data, body };
}

function splitSections(body) {
  const lines = body.split('\n');
  const out = [];
  let cur = { title: '', lines: [] };
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line.trim())) inFence = !inFence;
    const m = !inFence && /^#{1,2}\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (cur.title || cur.lines.join('').trim()) out.push(cur);
      cur = { title: m[1].replace(/[¶#]+$/, '').trim(), lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  if (cur.title || cur.lines.join('').trim()) out.push(cur);
  return out;
}

const SECTION_TYPE = [
  ['overview', /速览|30 ?秒/],
  ['points', /核心要点|关键要点|要点/],
  ['structure', /结构与流程|结构|流程/],
  ['glossary', /术语/],
  ['pitfalls', /注意|易错|提醒|坑|误区/],
  ['shots', /截图|图示|画面/],
  ['timeline', /时间轴|节点/],
  ['selfcheck', /自检|测验|练习|作业|复盘/],
];
const sectionType = (title) => (SECTION_TYPE.find(([, re]) => re.test(title)) || ['generic'])[0];

function parseGlossary(text) {
  const rows = text.split('\n').filter((l) => l.trim().startsWith('|'));
  if (rows.length < 2) return [];
  const cells = (line) =>
    line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  const terms = [];
  for (const line of rows.slice(1)) {
    const c = cells(line);
    if (!c[0] || /^-{2,}$/.test(c[0])) continue;
    terms.push({ term: stripTags(mdInline(c[0])), def: stripTags(mdInline(c[1] || '')) });
  }
  return terms;
}

function parseShots(text) {
  const shots = [];
  const re = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  let m;
  while ((m = re.exec(text))) {
    const alt = m[1];
    const src = m[2];
    const tm = /(\d{1,2}:\d{2}(?::\d{2})?)\s*[）)]?\s*$/.exec(alt);
    const time = tm ? tm[1] : '';
    const caption = tm ? alt.slice(0, tm.index).trim() : alt.trim();
    shots.push({ src, caption, time, sec: time ? toSec(time) : 0 });
  }
  return shots;
}

function parseTimeline(text) {
  const flat = text.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const re = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;
  const marks = [];
  let m;
  while ((m = re.exec(flat))) marks.push({ time: m[1], index: m.index, end: m.index + m[0].length });
  if (!marks.length) return [];
  return marks.map((mk, i) => {
    const stop = i + 1 < marks.length ? marks[i + 1].index : flat.length;
    return { time: mk.time, text: flat.slice(mk.end, stop).trim() };
  });
}

/** 把 ../..assets/media/ 改写成按课程分目录的路径（同时支持 HTML 片段与裸路径） */
const fixMedia = (html, root, cid) =>
  html.replace(/(^|["'(])(?:\.\.\/)+assets\/media\//g, `$1${root}assets/media/${cid}/`);

async function loadLessons(dir) {
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md')).sort();
  const lessons = [];
  for (const f of files) {
    const raw = await fs.readFile(path.join(dir, f), 'utf8');
    const { data, body } = parseFrontMatter(raw);
    const sections = splitSections(body);
    const lesson = {
      id: data.id || path.basename(f, '.md'),
      order: data.order ?? lessons.length + 1,
      day: data.day ?? 1,
      title: data.title || sections[0]?.title || path.basename(f, '.md'),
      fullTitle: data.fullTitle || data.title || '',
      duration: data.duration || '',
      video: data.video || '',
      videoExternal: data.videoExternal || '',
      pdf: data.pdf || [],
      tags: data.tags || [],
      sections: [],
      glossary: [],
      shots: [],
      timeline: [],
      quiz: data.quiz || [],
      overview: [],
    };
    sections.forEach((s, i) => {
      const type = sectionType(s.title);
      const text = s.lines.join('\n').trim();
      const sec = { title: s.title, type, id: 's' + i, text, html: md(text) };
      if (type === 'glossary') { lesson.glossary = parseGlossary(text); sec.glossary = lesson.glossary; }
      if (type === 'shots') { lesson.shots = parseShots(text); sec.shots = lesson.shots; }
      if (type === 'timeline') { lesson.timeline = parseTimeline(text); sec.timeline = lesson.timeline; }
      if (type === 'overview') lesson.overview = text.split('\n').filter((l) => /^[-*]\s+/.test(l)).map((l) => l.replace(/^[-*]\s+/, ''));
      lesson.sections.push(sec);
    });
    if (!lesson.fullTitle) lesson.fullTitle = lesson.title;
    lessons.push(lesson);
  }
  lessons.sort((a, b) => a.order - b.order);
  return lessons;
}

/* -------------------------------- 自测题生成 -------------------------------- */

function buildQuiz(lesson, allTerms) {
  const manual = Array.isArray(lesson.quiz) ? lesson.quiz : [];
  const auto = [];
  const pool = allTerms.filter((t) => t.def.length >= 8 && t.term.length <= 14);
  const own = lesson.glossary.filter((t) => t.def.length >= 8 && t.term.length <= 14);
  for (const t of own.slice(0, 5)) {
    const rnd = seeded(lesson.id + t.term);
    const others = pool.filter((x) => x.def !== t.def && x.term !== t.term);
    const trim = (s) => (s.length > 90 ? s.slice(0, 88) + '…' : s);
    const distractors = shuffle(others, rnd).slice(0, 3).map((x) => ({ text: trim(x.def), ok: false }));
    if (distractors.length < 3) continue;
    const correct = { text: trim(t.def), ok: true };
    const options = shuffle([correct, ...distractors], rnd);
    auto.push({
      q: `「${t.term}」在这个课程场景里的含义是？`,
      options: options.map((o) => o.text),
      answer: options.findIndex((o) => o.ok),
      explain: `${t.term}：${t.def}`,
      auto: true,
    });
  }
  return [...manual, ...auto].slice(0, 6);
}

/* --------------------------------- 页面骨架 -------------------------------- */

function topbar(portal, course, courses, root) {
  const menu = courses.length
    ? `<div class="coursemenu" id="coursemenu">
    <button class="coursemenu__btn" id="coursemenu-btn" style="--c-color:${course ? course.color : 'var(--primary)'}">
      <span class="coursemenu__mark">${esc(course ? course.mark : portal.mark)}</span>
      <span class="coursemenu__title">${esc(course ? course.title : '全部课程')}</span>
      <span class="coursemenu__caret">▾</span>
    </button>
    <div class="coursemenu__panel">
      ${courses
        .map(
          (c) => `<a class="coursemenu__item ${course && c.id === course.id ? 'is-active' : ''}" href="${root}${c.id}/" style="--c-color:${c.color}">
        <span class="coursemenu__mark">${esc(c.mark)}</span>
        <span>${esc(c.title)}</span>
      </a>`
        )
        .join('')}
      <a class="coursemenu__item coursemenu__item--all" href="${root}"><span class="coursemenu__mark">⌂</span><span>全部课程</span></a>
    </div>
  </div>`
    : '';

  return `<header class="topbar">
  <button class="iconbtn topbar__burger" id="nav-toggle" aria-label="目录">☰</button>
  <a class="brand" href="${root}">
    <span class="brand__mark">${esc(portal.mark)}</span>
    <span class="brand__text"><strong>${esc(portal.title)}</strong><small>${esc(portal.brand)}</small></span>
  </a>
  ${menu}
  <button class="searchbtn" id="search-open">
    <span>🔍 搜索课程 / 课时 / 术语</span><span class="kbd">Ctrl K</span>
  </button>
  <div class="topbar__right">
    <div class="pill" id="global-progress" title="当前课程学习进度"><span class="pill__ring"></span><span class="pill__text">0%</span></div>
    <button class="iconbtn" id="theme-toggle" aria-label="切换主题">🌗</button>
  </div>
</header>`;
}

function layout({ portal, courses = [], course = null, root = '', mode = 'course', active = '', title, description = '', body, toc = [] }) {
  const courseAttr = course ? ` data-course="${esc(course.id)}"` : '';
  const tocHtml = toc.length
    ? `<nav class="toc"><p class="toc__title">本页目录</p><ul>${toc.map((t) => `<li><a href="#${t.id}">${esc(t.title)}</a></li>`).join('')}</ul></nav>`
    : '';
  const mark = (portal.mark || '学').slice(0, 2);
  const docTitle = title === portal.title || !title ? portal.title : `${title} · ${portal.title}`;

  const sidebar = mode === 'course' ? `<aside class="sidebar" id="sidebar">${renderSidebar(course, courses, active, root)}</aside><div class="scrim" id="scrim"></div>` : '';

  return `<!doctype html>
<html lang="zh-CN" data-base="${root}"${courseAttr}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(docTitle)}</title>
<meta name="description" content="${esc(description || portal.description)}">
<link rel="stylesheet" href="${root}assets/app.css">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#4f46e5"/><text x="16" y="22" font-size="15" font-family="sans-serif" fill="#fff" text-anchor="middle">${mark}</text></svg>`
  )}">
<script>try{const t=localStorage.getItem('lp:theme');if(t==='dark')document.documentElement.dataset.theme='dark';}catch(e){}</script>
</head>
<body class="mode-${mode}">
${topbar(portal, course, courses, root)}
<div class="readbar" id="readbar"></div>
<div class="shell">
  ${sidebar}
  <main class="main">${body}</main>
  ${tocHtml}
</div>
<div class="overlay" id="search-overlay" hidden>
  <div class="searchbox">
    <input id="search-input" type="search" placeholder="输入关键词，跨课程搜索课时 / 术语 / 要点…" autocomplete="off">
    <div class="searchbox__hint">↑↓ 选择 · Enter 打开 · Esc 关闭</div>
    <div id="search-results" class="searchresults"></div>
  </div>
</div>
<script type="application/json" id="courses-data">${JSON.stringify(courses.map((c) => ({ id: c.id, title: c.title, mark: c.mark, color: c.color }))).replace(/</g, '\\u003c')}</script>
<script src="${root}assets/app.js" defer></script>
</body>
</html>`;
}

function renderSidebar(course, courses, active, root) {
  return `
<div class="sidebar__head">
  <span>课程目录</span>
  <a class="sidebar__home" href="${root}">全部课程</a>
</div>
<nav class="nav">
  ${course.days
    .map(
      (d) => `<div class="nav__day" data-day="${d.n}" style="--day-color:${d.color}">
    <a class="nav__daytitle ${active === 'day' + d.n ? 'is-active' : ''}" href="${root}${course.id}/day/${d.n}/">
      <span class="nav__badge">D${d.n}</span><span>${esc(d.title)}</span>
    </a>
    <ul class="nav__lessons">
      ${d.lessons
        .map(
          (l) => `<li><a class="nav__link ${active === l.id ? 'is-active' : ''}" href="${root}${course.id}/${l.id}/" data-lesson="${l.id}">
        <span class="nav__check" aria-hidden="true"></span><span class="nav__label">${esc(l.title)}</span>
      </a></li>`
        )
        .join('')}
    </ul>
  </div>`
    )
    .join('')}
</nav>
<div class="nav__foot">
  <a href="${root}${course.id}/exam/">📝 结业测验</a>
  <a href="${root}${course.id}/glossary/">📚 术语总表</a>
  <a href="${root}${course.id}/materials/">📎 官方课件</a>
</div>`;
}

/* --------------------------------- 组件渲染 -------------------------------- */

function renderSection(sec, ctx) {
  const { root, course } = ctx;
  const fix = (h) => fixMedia(h, root, course.id);
  const head = (title, extra = '') => `<h2 class="card__title"><span class="card__dot"></span>${title}${extra}</h2>`;
  const wrap = (title, inner, extra = '') => `<section class="card card--${sec.type}${extra}" id="${sec.id}">${head(title)}${inner}</section>`;

  switch (sec.type) {
    case 'overview':
      return `<section class="card card--overview" id="${sec.id}">
  <div class="card__label"><span class="dot"></span>30 秒速览</div>
  ${fix(sec.html)}
</section>`;
    case 'points':
      return wrap('核心要点', `<div class="points">${fix(sec.html)}</div>`);
    case 'glossary':
      return wrap(
        '术语表',
        `<div class="glossary">${sec.glossary
          .map((g) => `<div class="glossary__row"><div class="glossary__term">${esc(g.term)}</div><div class="glossary__def">${esc(g.def)}</div></div>`)
          .join('')}</div>`,
        `<span class="muted">${sec.glossary.length} 个</span>`
      );
    case 'shots':
      if (!sec.shots.length) return '';
      return wrap(
        '关键截图',
        `<div class="shots">${sec.shots
          .map(
            (s) => `<figure class="shot" data-src="${esc(fixMedia(s.src, root, course.id))}" data-caption="${esc(s.caption)}">
      <img src="${esc(fixMedia(s.src, root, course.id))}" alt="${esc(s.caption)}" loading="lazy">
      ${s.time ? `<button class="shot__time" data-seek="${s.sec}" title="跳转到视频 ${s.time}">${s.time}</button>` : ''}
      <figcaption>${esc(s.caption)}</figcaption>
    </figure>`
          )
          .join('')}</div>`,
        '<span class="muted">点击放大</span>'
      );
    case 'timeline':
      if (!sec.timeline.length) return '';
      return wrap(
        '关键节点时间轴',
        `<ol class="timeline">${sec.timeline
          .map(
            (it) => `<li class="timeline__item">
      <button class="timeline__time" data-seek="${toSec(it.time)}">${it.time}</button>
      <div class="timeline__text">${esc(it.text)}</div>
    </li>`
          )
          .join('')}</ol>`,
        '<span class="muted">点击时间点跳转视频</span>'
      );
    case 'pitfalls':
      return wrap('容易踩的坑', `<div class="warn">${fix(sec.html)}</div>`, ' card--warn');
    default:
      return wrap(esc(sec.title), `<div class="prose">${fix(sec.html)}</div>`);
  }
}

function videoBlock(lesson) {
  const hasVideo = !!lesson.video;
  const hasExternal = !!lesson.videoExternal;
  if (!hasVideo && !hasExternal) return '';

  // 确定视频类型
  let videoType = 'none'; // direct | iframe | external-only
  let videoSrc = '';
  if (hasVideo) {
    const isDirect = /\.(mp4|webm|m3u8|mov)(\?|$)/i.test(lesson.video);
    videoType = isDirect ? 'direct' : 'iframe';
    videoSrc = lesson.video;
  }

  // 生成播放区域
  let playerHtml = '';
  let titleHint = '';
  let videoUrl = ''; // "在新窗口打开" 的 URL

  if (videoType === 'direct') {
    playerHtml = `<video src="${esc(videoSrc)}" controls preload="metadata" playsinline></video>`;
    titleHint = '<span class="muted">⏱ 时间轴上的时间点可直接跳转视频对应位置</span>';
    videoUrl = videoSrc;
  } else if (videoType === 'iframe') {
    playerHtml = `<iframe src="${esc(videoSrc)}" allow="fullscreen autoplay" allowfullscreen loading="lazy" referrerpolicy="no-referrer"></iframe>`;
    titleHint = '<span class="muted">视频嵌入课程平台播放 · 时间轴点击见下方说明</span>';
    videoUrl = videoSrc;
  }

  // 底部提示按钮（iframe/external 模式下显示）
  const externalBtn = (videoType === 'iframe' || hasExternal)
    ? `<div class="video__bar">
      ${playerHtml ? `<span class="video__tip">🔗 嵌入播放无法精确跳转时间点，点击按钮在新窗口打开视频后，回到本页对照"关键节点时间轴"上的时间点</span>` : ''}
      ${hasExternal ? `<a class="btn btn--ghost" href="${esc(lesson.videoExternal)}" target="_blank" rel="noopener">📺 在新窗口打开视频</a>` : ''}
      ${videoType === 'iframe' ? `<a class="btn btn--ghost" href="${esc(videoSrc)}" target="_blank" rel="noopener">↗ 放大视频（新窗口）</a>` : ''}
    </div>`
    : '';

  return `<section class="card card--video" id="video" ${videoType === 'iframe' ? 'data-video-type="iframe"' : ''}>
  <h2 class="card__title"><span class="card__dot"></span>课程视频 ${titleHint}</h2>
  ${playerHtml ? `<div class="videowrap videowrap--${videoType}">${playerHtml}</div>` : ''}
  ${externalBtn}
</section>`;
}

/* --------------------------------- 各类页面 --------------------------------- */

function lessonBody(course, lessons, idx, portal, courses) {
  const lesson = lessons[idx];
  const prev = lessons[idx - 1];
  const next = lessons[idx + 1];
  const day = course.days.find((d) => d.n === lesson.day);
  const root = '../../';
  const ctx = { root, course };
  const toc = lesson.sections.map((s) => ({ id: s.id, title: s.title }));
  const quiz = lesson.__quiz || [];
  const base = `${root}${course.id}`;

  const body = `
<div class="lesson">
  <div class="crumbs"><a href="${root}">全部课程</a><span>/</span><a href="${root}${course.id}/">${esc(course.title)}</a><span>/</span><a href="${base}/day/${lesson.day}/">Day ${lesson.day}</a><span>/</span><span>${esc(lesson.id)}</span></div>
  <header class="lesson__head" style="--c-color:${course.color}">
    <div class="lesson__eyebrow">课时 ${lesson.order} · Day ${lesson.day}</div>
    <h1>${esc(lesson.title)}</h1>
    <div class="chips">
      ${lesson.duration ? `<span class="chip">⏱ ${esc(lesson.duration)}</span>` : ''}
      <span class="chip">🗂 ${esc(day?.title || '')}</span>
      ${lesson.tags.map((x) => `<span class="chip chip--soft">${esc(x)}</span>`).join('')}
      <button class="btn btn--done" id="mark-done" data-lesson="${lesson.id}">标记为已学完</button>
    </div>
    <div class="lesson__actions">
      ${lesson.pdf.map((p) => `<a class="btn btn--ghost" href="${materialUrl(course, p, root)}" target="_blank" rel="noopener">📎 ${esc(pdfLabel(p))}</a>`).join('')}
    </div>
  </header>

  ${videoBlock(lesson)}
  ${lesson.sections.map((s) => renderSection(s, ctx)).join('\n')}

  ${
    quiz.length
      ? `<section class="card card--quiz quiz" id="quiz" data-lesson="${lesson.id}">
    <h2 class="card__title"><span class="card__dot"></span>随堂自测 <span class="muted">${quiz.length} 题 · 结果保存在本地</span></h2>
    <div class="quiz__body" id="quiz-body"></div>
    <div class="quiz__foot"><button class="btn" id="quiz-submit">提交答案</button><span id="quiz-score" class="quiz__score"></span></div>
  </section>`
      : ''
  }

  <nav class="pager">
    ${prev ? `<a class="pager__item" href="${base}/${prev.id}/"><small>上一课</small><strong>${esc(prev.title)}</strong></a>` : '<span></span>'}
    ${next ? `<a class="pager__item pager__item--next" href="${base}/${next.id}/"><small>下一课</small><strong>${esc(next.title)}</strong></a>` : '<span></span>'}
  </nav>
</div>
<script type="application/json" id="quiz-data">${JSON.stringify(quiz).replace(/</g, '\\u003c')}</script>`;

  return layout({
    portal,
    courses,
    course,
    root,
    active: lesson.id,
    title: lesson.title,
    description: plainText(lesson.overview.join('；')).slice(0, 150) || lesson.title,
    body,
    toc,
  });
}

function pdfLabel(file) {
  return file.replace(/^\d+_/, '').replace(/\.pdf$/i, '');
}

function materialUrl(course, file, root = '') {
  const local = path.join(COURSES_DIR, course.id, 'pdf', file);
  return existsSync(local) ? `${root}assets/pdf/${course.id}/${encodeURIComponent(file)}` : `${REMOTE_ASSETS}/assets/pdf/${encodeURIComponent(file)}`;
}

function courseHomeBody(course, portal, courses) {
  const root = '../';
  const base = `${root}${course.id}`;
  const totalMin = course.lessons.reduce((n, l) => n + toSec(l.duration || '0:00') / 60, 0);
  return `
<div class="hero" style="--c-color:${course.color}">
  <span class="hero__orb hero__orb--1"></span>
  <span class="hero__orb hero__orb--2"></span>
  <span class="hero__orb hero__orb--3"></span>
  <div class="hero__tags"><span>${esc(course.mark)}</span><span>${esc(course.version || 'v1.0')}</span><span>更新于 ${esc(course.updated || '')}</span></div>
  <h1>${esc(course.title)}</h1>
  <p class="hero__sub">${esc(course.subtitle || '')}</p>
  <p class="hero__desc">${esc(course.description || '')}</p>
  <div class="hero__cta">
    <a class="btn btn--primary" id="continue-btn" href="${base}/${course.lessons[0].id}/">开始学习 →</a>
    <a class="btn btn--ghost" href="${base}/glossary/">查术语表</a>
    <a class="btn btn--ghost" href="${base}/materials/">看官方课件</a>
    ${course.exam ? `<a class="btn btn--ghost" href="${base}/exam/">做结业测验</a>` : ''}
  </div>
  <div class="stats">
    <div class="stat"><strong>${course.lessons.length}</strong><span>个课时</span></div>
    <div class="stat"><strong>${course.days.length}</strong><span>天路径</span></div>
    <div class="stat"><strong>${course.materials.length}</strong><span>份课件</span></div>
    <div class="stat"><strong>${Math.round(totalMin / 60)}</strong><span>小时视频</span></div>
  </div>
  <div class="hero__progress"><div class="bar"><i id="hero-bar"></i></div><span id="hero-progress-text">已完成 0 / ${course.lessons.length}</span></div>
</div>

<h2 class="section-title">${course.days.length} 天学习路径</h2>
<div class="days">
  ${course.days
    .map(
      (d) => `<a class="path__item" href="${base}/day/${d.n}/" style="--day-color:${d.color}">
    <span class="path__rail"><span class="path__dot">${d.n}</span></span>
    <span class="path__card">
      <span class="path__head"><strong>${esc(d.title)}</strong><span class="path__hours">${d.hours}h</span></span>
      <span class="path__meta">Day ${d.n} · ${d.lessons.length} 课时 · ${esc(d.lessons[0]?.id)}–${esc(d.lessons[d.lessons.length - 1]?.id)}</span>
      <span class="path__lessons">${d.lessons.slice(0, 3).map((l) => esc(l.title)).join(' · ')}${d.lessons.length > 3 ? ` +${d.lessons.length - 3}` : ''}</span>
      <span class="bar bar--sm"><i data-day-bar="${d.n}"></i></span>
    </span>
    <span class="path__go">→</span>
  </a>`
    )
    .join('')}
</div>

<h2 class="section-title">全量课时</h2>
<div class="lessongrid">
  ${course.lessons
    .map(
      (l) => `<a class="lessonchip" href="${base}/${l.id}/" data-lesson="${l.id}" style="--day-color:${course.days.find((d) => d.n === l.day)?.color || course.color}">
    <span class="lessonchip__id">${esc(l.id)}</span>
    <span class="lessonchip__title">${esc(l.title)}</span>
    <span class="lessonchip__meta">${esc(l.duration || '')}</span>
  </a>`
    )
    .join('')}
</div>

${course.materials.length ? `<h2 class="section-title">官方课件（${course.materials.length} 份）</h2>
<div class="materials">
  ${course.materials
    .map(
      (m) => `<a class="material" href="${materialUrl(course, m.file, root)}" target="_blank" rel="noopener">
    <span class="material__icon">PDF</span>
    <span class="material__title">${esc(m.title)}</span>
    <span class="material__meta">关联 ${m.lessons.length} 课时</span>
  </a>`
    )
    .join('')}
</div>` : ''}

<div class="callout">
  <strong>怎么用这门课？</strong>
  <p>先看每课开头的「30 秒速览」判断要不要精看；卡住的知识点用「关键节点时间轴」定位；遇到不认识的词查「术语表」；学完用「随堂自测」验收。每标记一课，进度会记在本机浏览器里。</p>
</div>`;
}

function dayBody(course, d, portal, courses) {
  const root = '../../../';
  const base = `${root}${course.id}`;
  const minutes = d.lessons.reduce((n, l) => n + toSec(l.duration) / 60, 0);
  return `
<div class="crumbs"><a href="${root}">全部课程</a><span>/</span><a href="${root}${course.id}/">${esc(course.title)}</a><span>/</span><span>Day ${d.n}</span></div>
<header class="dayhead" style="--day-color:${d.color}">
  <div class="lesson__eyebrow">Day ${d.n} · 建议 ${d.hours} 小时</div>
  <h1>${esc(d.title)}</h1>
  ${d.intro ? `<div class="prose dayhead__intro">${md(d.intro.replace(/\n-{3,}\s*$/, ''))}</div>` : ''}
  <div class="chips">
    <span class="chip">${d.lessons.length} 课时</span>
    <span class="chip">视频约 ${Math.round(minutes)} 分钟</span>
    <div class="bar bar--wide"><i data-day-bar="${d.n}"></i></div>
  </div>
</header>
<div class="cards" style="--day-color:${d.color}">
  ${d.lessons
    .map(
      (l) => `<a class="lessoncard" href="${base}/${l.id}/" data-lesson="${l.id}">
    <div class="lessoncard__head"><span class="lessoncard__id">${esc(l.id)}</span><span class="lessoncard__time">${esc(l.duration)}</span></div>
    <h3>${esc(l.title)}</h3>
    <ul class="lessoncard__points">${(l.overview || []).slice(0, 3).map((p) => `<li>${mdInline(p)}</li>`).join('')}</ul>
    <span class="lessoncard__go">开始学习 →</span>
  </a>`
    )
    .join('')}
</div>
<nav class="pager">
  ${d.n > 1 ? `<a class="pager__item" href="${base}/day/${d.n - 1}/"><small>上一天</small><strong>Day ${d.n - 1}</strong></a>` : '<span></span>'}
  ${d.n < course.days.length ? `<a class="pager__item pager__item--next" href="${base}/day/${d.n + 1}/"><small>下一天</small><strong>Day ${d.n + 1}</strong></a>` : '<span></span>'}
</nav>`;
}

function glossaryBody(course) {
  const root = '../../';
  const groups = course.lessons.filter((l) => l.glossary.length);
  const total = groups.reduce((n, l) => n + l.glossary.length, 0);
  return `
<div class="crumbs"><a href="${root}">全部课程</a><span>/</span><a href="${root}${course.id}/">${esc(course.title)}</a><span>/</span><span>术语总表</span></div>
<header class="dayhead" style="--day-color:${course.color}">
  <h1>术语总表</h1>
  <p class="hero__desc">《${esc(course.title)}》共 ${total} 条术语，按课时归组。输入关键词可即时筛选。</p>
  <input id="glossary-filter" class="filter" type="search" placeholder="筛选术语，例如 ARR / 商机 / 权限…">
</header>
<div class="glossarypage">
  ${groups
    .map(
      (l) => `<section class="glossgroup" data-lesson="${l.id}">
    <h2><a href="${root}${course.id}/${l.id}/">${esc(l.id)} · ${esc(l.title)}</a></h2>
    <div class="glossary">${l.glossary
      .map((g) => `<div class="glossary__row" data-text="${esc((g.term + ' ' + g.def).toLowerCase())}"><div class="glossary__term">${esc(g.term)}</div><div class="glossary__def">${esc(g.def)}</div></div>`)
      .join('')}</div>
  </section>`
    )
    .join('')}
</div>
<p class="empty" id="glossary-empty" hidden>没有匹配的术语。</p>`;
}

function materialsBody(course) {
  const root = '../../';
  return `
<div class="crumbs"><a href="${root}">全部课程</a><span>/</span><a href="${root}${course.id}/">${esc(course.title)}</a><span>/</span><span>官方课件</span></div>
<header class="dayhead" style="--day-color:${course.color}">
  <h1>官方课件</h1>
  <p class="hero__desc">共 ${course.materials.length} 份 PDF，点击可在浏览器直接翻阅；每份都标注了关联课时。</p>
</header>
<div class="materials materials--big">
  ${course.materials
    .map(
      (m) => `<div class="material material--card">
    <span class="material__icon">PDF</span>
    <div class="material__main">
      <strong>${esc(m.title)}</strong>
      <span class="material__file">${esc(m.file)}</span>
      <div class="chips">${m.lessons.map((id) => `<a class="chip chip--link" href="${root}${course.id}/${id}/">${esc(id)}</a>`).join('')}</div>
    </div>
    <a class="btn btn--ghost" href="${materialUrl(course, m.file, root)}" target="_blank" rel="noopener">在线预览</a>
  </div>`
    )
    .join('')}
</div>`;
}

function portalBody(portal, courses) {
  const totalLessons = courses.reduce((n, c) => n + c.lessons.length, 0);
  const totalMin = courses.reduce((n, c) => n + c.lessons.reduce((m, l) => m + toSec(l.duration || '0:00') / 60, 0), 0);

  return `
<div class="hero hero--portal">
  <span class="hero__orb hero__orb--1"></span>
  <span class="hero__orb hero__orb--2"></span>
  <span class="hero__orb hero__orb--3"></span>
  <div class="hero__tags"><span>内部学习平台</span><span>${esc(portal.version)}</span><span>更新于 ${esc(portal.updated)}</span></div>
  <h1>${esc(portal.title)}</h1>
  <p class="hero__sub">${esc(portal.subtitle)}</p>
  <p class="hero__desc">${esc(portal.description)}</p>
  <div class="stats">
    <div class="stat"><strong>${courses.length}</strong><span>门课程</span></div>
    <div class="stat"><strong>${totalLessons}</strong><span>个课时</span></div>
    <div class="stat"><strong>${Math.round(totalMin / 60)}</strong><span>小时视频</span></div>
    <div class="stat"><strong id="portal-done">0</strong><span>已完成课时</span></div>
  </div>
</div>

<h2 class="section-title">全部课程</h2>
<div class="courselist">
  ${courses
    .map(
      (c) => `<a class="coursecard" href="${c.id}/" style="--c-color:${c.color}" data-course="${c.id}" data-count="${c.lessons.length}">
    <span class="coursecard__cover">
      <span class="coursecard__mark">${esc(c.mark)}</span>
      <span class="coursecard__sheen"></span>
    </span>
    <span class="coursecard__body">
      <span class="coursecard__top"><strong>${esc(c.title)}</strong><span class="coursecard__go">→</span></span>
      <span class="coursecard__sub">${esc(c.subtitle || '')}</span>
      <span class="coursecard__meta">${c.lessons.length} 课时 · ${c.days.length} 天 · ${Math.round(c.lessons.reduce((m, l) => m + toSec(l.duration) / 60, 0) / 60)} 小时</span>
      <span class="coursecard__tags">${(c.tags || []).map((t) => `<em>${esc(t)}</em>`).join('')}</span>
      <span class="bar bar--sm"><i data-course-bar="${c.id}"></i></span>
      <span class="coursecard__progress"><span data-course-text="${c.id}">未开始</span></span>
    </span>
  </a>`
    )
    .join('')}
</div>

<div class="callout">
  <strong>加新课程不用改代码</strong>
  <p>把新课程的课时 markdown 放进 <code>content/courses/&lt;课程ID&gt;/lessons/</code>，在 <code>course.json</code> 里写好标题和颜色，重新构建就会出现在这个列表里；同一门课里加课时也一样，会自动进入当天分组、导航和搜索。</p>
</div>`;
}

function examIndexBody(course) {
  const root = '../../';
  const base = `${root}${course.id}`;
  const finalQ = course.exam.final.questions.length;
  const lessonRows = course.lessons
    .map((l) => {
      const n = (course.exam.lessons[l.id] || []).length;
      return `<a class="examrow" href="${base}/${l.id}/#quiz" data-exam-lesson="${l.id}">
      <span class="examrow__id">${esc(l.id)}</span>
      <span class="examrow__title">${esc(l.title)}</span>
      <span class="examrow__meta">${n} 题</span>
      <span class="examrow__state" data-exam-state="${l.id}">未作答</span>
    </a>`;
    })
    .join('');

  return `
<div class="crumbs"><a href="${root}">全部课程</a><span>/</span><a href="${root}${course.id}/">${esc(course.title)}</a><span>/</span><span>结业测验</span></div>
<header class="dayhead" style="--day-color:${course.color}">
  <h1>结业测验</h1>
  <p class="hero__desc">每节课 4 道题，随学随测；全部学完后做一次 ${finalQ} 题的结业总测，交卷即出分，${course.exam.passScore} 分及格。所有作答都在本机保存，不上传服务器。</p>
  <div class="chips">
    <span class="chip">${course.lessons.length} 节 · 每节 4 题</span>
    <span class="chip">总测 ${finalQ} 题</span>
    <span class="chip">及格 ${course.exam.passScore} 分</span>
  </div>
</header>

<a class="examhero" href="${base}/exam/final/">
  <span class="examhero__icon">📝</span>
  <span class="examhero__text">
    <strong>${esc(course.exam.final.title)}</strong>
    <small>${finalQ} 题 · 覆盖 7 天全部章节 · 交卷立即批改</small>
  </span>
  <span class="examhero__go">开始测验 →</span>
</a>

<h2 class="section-title">章节测验</h2>
<div class="examlist">${lessonRows}</div>`;
}

function examFinalBody(course) {
  const root = '../../../';
  const base = `${root}${course.id}`;
  const qs = course.exam.final.questions;

  const questions = qs
    .map((q, i) => {
      const opts = q.options
        .map((o, oi) => `<button type="button" class="examopt" data-oi="${oi}"><b>${String.fromCharCode(65 + oi)}</b><span>${esc(o)}</span></button>`)
        .join('');
      return `<div class="examq" data-q="${i}">
      <div class="examq__head"><span class="examq__no">${i + 1}</span><span class="examq__title">${esc(q.q)}</span></div>
      <div class="examq__opts">${opts}</div>
      <div class="examq__explain" hidden></div>
    </div>`;
    })
    .join('');

  const key = JSON.stringify(qs.map((q) => ({ a: q.answer, e: q.explain }))).replace(/</g, '\\u003c');

  return `
<div class="crumbs"><a href="${root}">全部课程</a><span>/</span><a href="${root}${course.id}/">${esc(course.title)}</a><span>/</span><a href="${base}/exam/">结业测验</a><span>/</span><span>结业总测</span></div>
<header class="dayhead" style="--day-color:${course.color}">
  <h1>${esc(course.exam.final.title)}</h1>
  <p class="hero__desc">共 ${qs.length} 题，及格 ${course.exam.passScore} 分。全部答完后点「交卷」，系统立即批改并给出每题的解析。</p>
</header>

<div class="exambar" id="exambar">
  <span class="exambar__count">已答 <b id="exam-done">0</b> / ${qs.length}</span>
  <span class="bar"><i id="exam-bar"></i></span>
  <button class="btn btn--primary" id="exam-submit" disabled>交卷</button>
</div>

<div class="examresult" id="exam-result" hidden>
  <div class="examresult__score"><span id="exam-score">--</span><small>分</small></div>
  <div class="examresult__text">
    <strong id="exam-verdict"></strong>
    <span id="exam-detail"></span>
  </div>
  <button class="btn btn--ghost" id="exam-retry">重做一遍</button>
</div>

<form class="examform" id="exam-form" data-pass="${course.exam.passScore}" onsubmit="return false">
  ${questions}
</form>

<div class="examfoot">
  <button class="btn btn--primary" id="exam-submit-2" disabled>交卷并批改</button>
  <a class="btn btn--ghost" href="${base}/exam/">返回测验中心</a>
</div>
<script type="application/json" id="exam-key">${key}</script>`;
}

/* ----------------------------------- 主流程 ---------------------------------- */

const portal = JSON.parse(await fs.readFile(path.join(CONTENT, 'portal.json'), 'utf8'));
const courseIds = (await fs.readdir(COURSES_DIR, { withFileTypes: true }))
  .filter((e) => e.isDirectory() && existsSync(path.join(COURSES_DIR, e.name, 'course.json')))
  .map((e) => e.name);

const courses = [];
for (const [ci, id] of courseIds.entries()) {
  const dir = path.join(COURSES_DIR, id);
  const meta = JSON.parse(await fs.readFile(path.join(dir, 'course.json'), 'utf8'));
  const catalogPath = path.join(dir, 'catalog.json');
  const catalog = existsSync(catalogPath) ? JSON.parse(await fs.readFile(catalogPath, 'utf8')) : { days: [], pdfs: [] };
  const lessons = await loadLessons(path.join(dir, 'lessons'));

  // 自动补 videoExternal：catalog.json 里 lessons[].lessonId + course.json platform 配置
  if (catalog.lessons?.length && (meta.platformId || meta.platformCourseId)) {
    const platId = meta.platformId || meta.platformCourseId;
    const trainType = meta.platformTrainType ?? 1;
    const upstreamEa = meta.platformUpstreamEa || 'fs';
    const baseURL = `https://www.fxiaoke.com/XV/UI/Home?noheader=1&ddtab=true#app/train/learn/=/id-${platId}/trainType-${trainType}/lessonId-{lessonId}/upstreamEa-${upstreamEa}`;

    // 建立 catalog lessonId 映射（按 order 或 id）
    const catalogByOrder = {};
    catalog.lessons.forEach((cl) => { if (cl.order) catalogByOrder[cl.order] = cl; });

    for (const lesson of lessons) {
      if (!lesson.videoExternal && !lesson.video) {
        const catEntry = catalogByOrder[lesson.order] || catalog.lessons.find((cl) => cl.id === lesson.id);
        const lid = catEntry?.lessonId;
        if (lid) lesson.videoExternal = baseURL.replace('{lessonId}', lid);
      }
    }
  }

  // 结业测验题库（可选）：有就用精编题，没有就退回术语自动出题
  const examPath = path.join(dir, 'exam.json');
  const exam = existsSync(examPath) ? JSON.parse(await fs.readFile(examPath, 'utf8')) : null;

  // 术语题需要跨课时池子，先收集
  const allTerms = lessons.flatMap((l) => l.glossary.map((g) => ({ ...g, lesson: l.id })));
  for (const l of lessons) {
    const curated = exam?.lessons?.[l.id];
    l.__quiz = Array.isArray(curated) && curated.length >= 3 ? curated : buildQuiz(l, allTerms);
  }

  const dayDefs = catalog.days.length
    ? catalog.days
    : [...new Set(lessons.map((l) => l.day))].map((n) => ({ n, title: `第 ${n} 天`, hours: 4, intro: '' }));

  const days = dayDefs
    .map((d, di) => {
      const ls = lessons.filter((l) => l.day === d.n);
      const hours = Math.max(1, Math.round(ls.reduce((n, l) => n + toSec(l.duration) / 60, 0) / 60));
      return { ...d, hours: d.hours || hours, lessons: ls, color: DAY_COLORS[di % DAY_COLORS.length] };
    })
    .filter((d) => d.lessons.length);

  courses.push({
    ...meta,
    id,
    order: meta.order ?? ci + 1,
    color: meta.color || PALETTE[ci % PALETTE.length],
    mark: meta.mark || id.toUpperCase().slice(0, 3),
    tags: meta.tags || [],
    lessons,
    days,
    materials: catalog.pdfs || [],
    exam,
  });
}
courses.sort((a, b) => a.order - b.order);

await fs.rm(DIST, { recursive: true, force: true });
await fs.mkdir(DIST, { recursive: true });

const write = async (p, content) => {
  const full = path.join(DIST, p);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
};

async function copyDir(from, to) {
  if (!existsSync(from)) return;
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDir(src, dst);
    else await fs.copyFile(src, dst);
  }
}

/** 每课截图可能放在 media/<课时>/ 或 media/<课时>/slides/，统一拍平到 assets/media/<课程>/<课时>/ */
async function copyMedia(course) {
  const src = path.join(COURSES_DIR, course.id, 'media');
  const dstRoot = path.join(DIST, 'assets', 'media', course.id);
  if (!existsSync(src)) return;
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const lessonMedia = path.join(src, entry.name);
    const dst = path.join(dstRoot, entry.name);
    const slides = path.join(lessonMedia, 'slides');
    if (existsSync(slides)) await copyDir(slides, dst);
    // 课时目录下直接放的文件（如从视频抓的截图）也要一起带上
    for (const f of await fs.readdir(lessonMedia, { withFileTypes: true })) {
      if (f.isFile()) {
        await fs.mkdir(dst, { recursive: true });
        await fs.copyFile(path.join(lessonMedia, f.name), path.join(dst, f.name));
      }
    }
  }
}

// 平台首页
await write('index.html', layout({ portal, courses, root: '', mode: 'landing', title: portal.title, body: portalBody(portal, courses) }));

// 每个课程
for (const course of courses) {
  const root = '../';
  await write(`${course.id}/index.html`, layout({ portal, courses, course, root, active: 'home', title: course.title, description: course.description, body: courseHomeBody(course, portal, courses) }));

  for (const d of course.days) {
    await write(
      `${course.id}/day/${d.n}/index.html`,
      layout({ portal, courses, course, root: '../../../', active: 'day' + d.n, title: `Day ${d.n} · ${d.title}`, body: dayBody(course, d, portal, courses) })
    );
  }

  for (const [i, l] of course.lessons.entries()) {
    await write(`${course.id}/${l.id}/index.html`, lessonBody(course, course.lessons, i, portal, courses));
  }

  await write(`${course.id}/glossary/index.html`, layout({ portal, courses, course, root: '../../', active: 'glossary', title: '术语总表', body: glossaryBody(course) }));
  await write(`${course.id}/materials/index.html`, layout({ portal, courses, course, root: '../../', active: 'materials', title: '官方课件', body: materialsBody(course) }));

  if (course.exam) {
    await write(
      `${course.id}/exam/index.html`,
      layout({ portal, courses, course, root: '../../', active: 'exam', title: '结业测验', body: examIndexBody(course) })
    );
    await write(
      `${course.id}/exam/final/index.html`,
      layout({ portal, courses, course, root: '../../../', active: 'exam', title: course.exam.final.title, body: examFinalBody(course) })
    );
  }
}

// 全局搜索索引（带课程信息，跨课程可搜）
const searchIndex = [];
for (const course of courses) {
  for (const l of course.lessons) {
    searchIndex.push({
      c: course.id,
      cn: course.title,
      l: l.id,
      t: l.title,
      d: l.day,
      url: `${course.id}/${l.id}/`,
      sections: l.sections.map((s) => ({
        h: s.title,
        x: (s.type === 'glossary'
          ? l.glossary.map((g) => `${g.term} ${g.def}`).join(' ')
          : stripTags(s.type === 'shots' ? s.shots.map((x) => x.caption).join(' ') : s.html)
        ).slice(0, 900),
      })),
    });
  }
}
await write('search-index.json', JSON.stringify(searchIndex));

// 静态资源 + 各课程媒体
await copyDir(path.join(PLATFORM, 'assets'), path.join(DIST, 'assets'));
for (const course of courses) {
  await copyMedia(course);
  await copyDir(path.join(COURSES_DIR, course.id, 'pdf'), path.join(DIST, 'assets', 'pdf', course.id));
}

const pages = 1 + courses.reduce((n, c) => n + 1 + c.days.length + c.lessons.length + 2, 0);
console.log(`✓ 构建完成：${courses.length} 门课程 / ${courses.reduce((n, c) => n + c.lessons.length, 0)} 课时 / 共 ${pages} 页`);
console.log(`  输出目录：${DIST}`);
