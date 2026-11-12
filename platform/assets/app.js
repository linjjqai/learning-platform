/* ==========================================================================
   学习平台 · 前端交互（多课程版）
   进度按课程隔离 / 全局搜索 / 课程切换 / 自测 / 灯箱
   ========================================================================== */
(() => {
  'use strict';

  const BASE = document.documentElement.dataset.base || '';
  const COURSE = document.documentElement.dataset.course || '';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const escapeHtml = (s = '') => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const coursesData = (() => {
    try { return JSON.parse($('#courses-data')?.textContent || '[]'); } catch { return []; }
  })();

  /* ------------------------------ 本地进度 ------------------------------ */
  const KEY = 'lp:progress:v2';
  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  };
  const save = (data) => {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* 隐私模式 */ }
  };
  const progress = load();

  const courseProgress = (cid) => progress[cid] || {};
  const isDone = (cid, lid) => !!(courseProgress(cid)[lid] && courseProgress(cid)[lid].done);
  const countDone = (cid, ids) => ids.filter((id) => isDone(cid, id)).length;

  /** 当前页面所属课程的全部课时 ID（来自侧栏） */
  const navIds = [...new Set($$('.nav__link[data-lesson]').map((a) => a.dataset.lesson))];

  function paintProgress() {
    if (COURSE) {
      const done = countDone(COURSE, navIds);
      const pct = navIds.length ? Math.round((done / navIds.length) * 100) : 0;

      const pill = $('#global-progress');
      if (pill) {
        pill.style.setProperty('--p', pct);
        $('.pill__text', pill).textContent = pct + '%';
        pill.title = `本科目已完成 ${done} / ${navIds.length} 课时`;
      }
      const bar = $('#hero-bar');
      if (bar) bar.style.width = pct + '%';
      const txt = $('#hero-progress-text');
      if (txt) txt.textContent = `已完成 ${done} / ${navIds.length}`;

      $$('.nav__link[data-lesson]').forEach((a) => a.classList.toggle('is-done', isDone(COURSE, a.dataset.lesson)));
      $$('.lessonchip[data-lesson], .lessoncard[data-lesson]').forEach((el) => el.classList.toggle('is-done', isDone(COURSE, el.dataset.lesson)));

      $$('.nav__day').forEach((dayEl) => {
        const ids = $$('.nav__link[data-lesson]', dayEl).map((a) => a.dataset.lesson);
        const d = ids.filter((id) => isDone(COURSE, id)).length;
        const p = ids.length ? (d / ids.length) * 100 : 0;
        const dayNo = (dayEl.querySelector('.nav__badge')?.textContent || '').replace('D', '');
        const target = $(`[data-day-bar="${dayNo}"]`);
        if (target) target.style.width = p + '%';
      });
      return;
    }

    // 平台首页：每门课的进度 + 总完成数
    let totalDone = 0;
    $$('.coursecard[data-course]').forEach((card) => {
      const cid = card.dataset.course;
      const total = Number(card.dataset.count || 0);
      const done = Object.values(courseProgress(cid)).filter((x) => x && x.done).length;
      totalDone += done;
      const pct = total ? Math.round((done / total) * 100) : 0;
      const bar = $(`[data-course-bar="${cid}"]`);
      if (bar) bar.style.width = pct + '%';
      const label = $(`[data-course-text="${cid}"]`);
      if (label) label.textContent = done ? `已学 ${done} / ${total} · ${pct}%` : `未开始 · ${total} 课时`;
    });
    const portalDone = $('#portal-done');
    if (portalDone) portalDone.textContent = String(totalDone);
  }

  function wireContinue() {
    const btn = $('#continue-btn');
    if (!btn || !COURSE) return;
    const next = navIds.find((id) => !isDone(COURSE, id));
    if (!next) {
      btn.textContent = '已全部学完 · 去复习 →';
      btn.href = `${BASE}${COURSE}/${navIds[0]}/`;
      return;
    }
    btn.href = `${BASE}${COURSE}/${next}/`;
    btn.textContent = `继续学习 ${next} →`;
  }

  /* ------------------------------ 课时完成 ------------------------------ */
  const markBtn = $('#mark-done');
  if (markBtn && COURSE) {
    const id = markBtn.dataset.lesson;
    const sync = () => {
      const done = isDone(COURSE, id);
      markBtn.classList.toggle('is-done', done);
      markBtn.textContent = done ? '✓ 已学完（点击撤销）' : '标记为已学完';
    };
    sync();
    markBtn.addEventListener('click', () => {
      progress[COURSE] = progress[COURSE] || {};
      progress[COURSE][id] = { ...(progress[COURSE][id] || {}), done: !isDone(COURSE, id), at: Date.now() };
      save(progress);
      sync();
      paintProgress();
      toast(isDone(COURSE, id) ? '已记入学习进度' : '已撤销完成标记');
    });
  }

  /* -------------------------------- 主题 -------------------------------- */
  $('#theme-toggle')?.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('lp:theme', dark ? 'light' : 'dark'); } catch {}
  });

  /* ------------------------------ 课程切换器 ------------------------------ */
  const menu = $('#coursemenu');
  const menuBtn = $('#coursemenu-btn');
  if (menu && menuBtn) {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('is-open');
    });
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target)) menu.classList.remove('is-open');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') menu.classList.remove('is-open');
    });
  }

  /* ------------------------------ 移动端目录 ------------------------------ */
  const sidebar = $('#sidebar');
  const scrim = $('#scrim');
  const closeNav = () => { sidebar?.classList.remove('is-open'); scrim?.classList.remove('is-show'); };
  $('#nav-toggle')?.addEventListener('click', () => {
    sidebar?.classList.toggle('is-open');
    scrim?.classList.toggle('is-show');
  });
  scrim?.addEventListener('click', closeNav);
  $$('.nav__link').forEach((a) => a.addEventListener('click', closeNav));

  /* -------------------------------- 提示 -------------------------------- */
  let toastEl;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    requestAnimationFrame(() => toastEl.classList.add('is-show'));
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove('is-show'), 2200);
  }

  /* ------------------------------ 时间点跳转 ------------------------------ */
  const fmt = (sec) => {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return `${h ? h + ':' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  $$('[data-seek]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sec = Number(el.dataset.seek) || 0;
      const video = $('video');
      if (video) { video.currentTime = sec; video.play?.(); return; }
      toast(`本课未接入视频源 · 时间点 ${fmt(sec)}`);
    });
  });

  /* -------------------------------- 灯箱 -------------------------------- */
  const shots = $$('.shot');
  if (shots.length) {
    let cur = 0;
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.hidden = true;
    box.innerHTML = `
      <button class="lightbox__close" aria-label="关闭">✕</button>
      <button class="lightbox__nav lightbox__nav--prev" aria-label="上一张">‹</button>
      <img alt="">
      <p class="lightbox__cap"></p>
      <button class="lightbox__nav lightbox__nav--next" aria-label="下一张">›</button>`;
    document.body.appendChild(box);

    const show = (i) => {
      cur = (i + shots.length) % shots.length;
      const s = shots[cur];
      $('img', box).src = s.dataset.src;
      $('.lightbox__cap', box).textContent = s.dataset.caption || '';
    };
    const close = () => { box.hidden = true; };
    shots.forEach((s, i) => s.addEventListener('click', () => { show(i); box.hidden = false; }));
    $('.lightbox__close', box).addEventListener('click', close);
    $('.lightbox__nav--prev', box).addEventListener('click', () => show(cur - 1));
    $('.lightbox__nav--next', box).addEventListener('click', () => show(cur + 1));
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    document.addEventListener('keydown', (e) => {
      if (box.hidden) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') show(cur - 1);
      if (e.key === 'ArrowRight') show(cur + 1);
    });
  }

  /* -------------------------------- 自测 -------------------------------- */
  const quizData = $('#quiz-data');
  if (quizData && COURSE) {
    const questions = JSON.parse(quizData.textContent || '[]');
    const lesson = quizData.parentElement.querySelector('.quiz')?.dataset.lesson || '';
    const holder = $('#quiz-body');
    const state = questions.map(() => -1);

    questions.forEach((q, qi) => {
      const box = document.createElement('div');
      box.className = 'q';
      box.dataset.qi = qi;
      const opts = q.options
        .map((o, oi) => `<button class="q__opt" data-oi="${oi}"><b>${String.fromCharCode(65 + oi)}</b><span>${escapeHtml(o)}</span></button>`)
        .join('');
      box.innerHTML = `<div class="q__title">${qi + 1}. ${escapeHtml(q.q)}</div><div class="q__opts">${opts}</div><div class="q__explain"></div>`;
      holder.appendChild(box);
      $$('.q__opt', box).forEach((btn) => {
        btn.addEventListener('click', () => {
          if (box.classList.contains('is-graded')) return;
          state[qi] = Number(btn.dataset.oi);
          $$('.q__opt', box).forEach((b) => b.classList.toggle('is-selected', b === btn));
        });
      });
    });

    $('#quiz-submit')?.addEventListener('click', () => {
      if (state.some((v) => v < 0)) { toast('还有题目没作答'); return; }
      let right = 0;
      questions.forEach((q, qi) => {
        const box = $(`.q[data-qi="${qi}"]`, holder);
        box.classList.add('is-graded');
        const ok = state[qi] === q.answer;
        if (ok) right++;
        $$('.q__opt', box).forEach((b) => {
          const oi = Number(b.dataset.oi);
          b.classList.toggle('is-correct', oi === q.answer);
          b.classList.toggle('is-wrong', oi === state[qi] && !ok);
        });
        $('.q__explain', box).textContent = (ok ? '✓ 正确 · ' : '✗ 正确答案：') + q.explain;
      });
      const pct = Math.round((right / questions.length) * 100);
      $('#quiz-score').textContent = `得分 ${right}/${questions.length}（${pct} 分）`;
      progress[COURSE] = progress[COURSE] || {};
      progress[COURSE][lesson] = { ...(progress[COURSE][lesson] || {}), done: true, quiz: { right, total: questions.length, at: Date.now() } };
      save(progress);
      paintProgress();
      toast(pct === 100 ? '全对，这一课可以过了 🎉' : `已记录成绩 ${right}/${questions.length}`);
    });
  }

  /* -------------------------------- 结业总测 -------------------------------- */
  const examForm = $('#exam-form');
  if (examForm && COURSE) {
    const key = JSON.parse($('#exam-key').textContent || '[]');
    const PASS = Number(examForm.dataset.pass || 60);
    const qs = $$('.examq', examForm);
    const state = qs.map(() => -1);
    const bar = $('#exam-bar');
    const doneEl = $('#exam-done');
    const btns = [$('#exam-submit'), $('#exam-submit-2')].filter(Boolean);
    const result = $('#exam-result');
    let finished = false;

    const refresh = () => {
      const answered = state.filter((v) => v >= 0).length;
      if (doneEl) doneEl.textContent = answered;
      if (bar) bar.style.width = `${(answered / qs.length) * 100}%`;
      const all = answered === qs.length;
      btns.forEach((b) => { b.disabled = !all || finished; });
      return all;
    };

    qs.forEach((box, qi) => {
      $$('.examopt', box).forEach((btn) => {
        btn.addEventListener('click', () => {
          if (finished) return;
          state[qi] = Number(btn.dataset.oi);
          $$('.examopt', box).forEach((b) => b.classList.toggle('is-selected', b === btn));
          refresh();
        });
      });
    });

    const grade = () => {
      const left = state.filter((v) => v < 0).length;
      if (left) { toast(`还有 ${left} 题没答，答完才能交卷`); return; }
      finished = true;
      let right = 0;
      qs.forEach((box, qi) => {
        const k = key[qi] || { a: -1, e: '' };
        const ok = state[qi] === k.a;
        if (ok) right++;
        box.classList.add('is-graded');
        $$('.examopt', box).forEach((b) => {
          const oi = Number(b.dataset.oi);
          b.classList.toggle('is-correct', oi === k.a);
          b.classList.toggle('is-wrong', oi === state[qi] && !ok);
        });
        const ex = $('.examq__explain', box);
        if (ex) {
          ex.hidden = false;
          ex.textContent = ok ? `✓ 正确 · ${k.e}` : `✗ 正确答案：${String.fromCharCode(65 + k.a)} · ${k.e}`;
        }
      });

      const score = Math.round((right / qs.length) * 100);
      const pass = score >= PASS;
      $('#exam-score').textContent = score;
      $('#exam-verdict').textContent = pass ? '通过 · 可以毕业了' : `未通过 · 及格线 ${PASS} 分`;
      $('#exam-detail').textContent = `答对 ${right} / ${qs.length} 题`;
      result.hidden = false;
      result.classList.toggle('is-pass', pass);
      result.classList.toggle('is-fail', !pass);

      progress[COURSE] = progress[COURSE] || {};
      progress[COURSE].__exam = { score, right, total: qs.length, pass, at: Date.now() };
      save(progress);
      paintProgress();
      result.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast(pass ? `通过，${score} 分` : `${score} 分，还差一点`);
    };

    btns.forEach((b) => b.addEventListener('click', grade));

    $('#exam-retry')?.addEventListener('click', () => {
      finished = false;
      qs.forEach((box, qi) => {
        state[qi] = -1;
        box.classList.remove('is-graded');
        $$('.examopt', box).forEach((b) => b.classList.remove('is-selected', 'is-correct', 'is-wrong'));
        const ex = $('.examq__explain', box);
        if (ex) { ex.hidden = true; ex.textContent = ''; }
      });
      result.hidden = true;
      refresh();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    refresh();
  }

  /* --------------------------- 测验中心：章节状态 --------------------------- */
  const examStates = $$('[data-exam-state]');
  examStates.forEach((el) => {
    const id = el.dataset.examState;
    const rec = (progress[COURSE] || {})[id];
    if (rec && rec.quiz) {
      el.textContent = `${rec.quiz.right}/${rec.quiz.total}`;
      el.classList.add('is-done');
    }
  });

  /* -------------------------------- 搜索 -------------------------------- */
  const overlay = $('#search-overlay');
  const input = $('#search-input');
  const results = $('#search-results');
  let index = null;
  let flat = [];
  let active = 0;

  async function ensureIndex() {
    if (index) return index;
    try {
      const res = await fetch(BASE + 'search-index.json');
      index = await res.json();
      flat = [];
      index.forEach((c) => {
        flat.push({ url: c.url, title: c.t, course: c.cn, kind: '课时', text: c.t });
        c.sections.forEach((s, si) => {
          flat.push({ url: `${c.url}#s${si}`, title: c.t, course: c.cn, kind: s.h, text: s.x });
        });
      });
    } catch {
      index = [];
    }
    return index;
  }

  function snippet(text, q) {
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return escapeHtml(text.slice(0, 110));
    const start = Math.max(0, i - 34);
    const end = Math.min(text.length, i + q.length + 70);
    const raw = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
    return escapeHtml(raw).replace(new RegExp(escapeRegExp(escapeHtml(q)), 'gi'), (m) => `<mark>${m}</mark>`);
  }

  function render(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      results.innerHTML = `<div class="searchempty">输入关键词，可跨课程搜索课时标题、章节内容与术语</div>`;
      return;
    }
    const scored = [];
    flat.forEach((item) => {
      const tl = item.title.toLowerCase();
      const kl = item.kind.toLowerCase();
      const xl = item.text.toLowerCase();
      let score = 0;
      if (tl.includes(q)) score += 40;
      if (kl.includes(q)) score += 25;
      if (xl.includes(q)) score += 6;
      if (!score) return;
      scored.push({ ...item, score: score + Math.min(xl.split(q).length - 1, 6) });
    });
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 14);
    active = 0;
    if (!top.length) {
      results.innerHTML = `<div class="searchempty">没有找到「${escapeHtml(query)}」相关内容</div>`;
      return;
    }
    results.innerHTML = top
      .map(
        (r, i) => `<a class="sr ${i === 0 ? 'is-active' : ''}" href="${BASE}${r.url}">
        <div class="sr__title">${escapeHtml(r.title)}</div>
        <div class="sr__path">${escapeHtml(r.course)} · ${escapeHtml(r.kind)}</div>
        <div class="sr__snippet">${snippet(r.text, q)}</div>
      </a>`
      )
      .join('');
  }

  async function openSearch() {
    await ensureIndex();
    overlay.hidden = false;
    input.value = '';
    render('');
    setTimeout(() => input.focus(), 30);
  }
  const closeSearch = () => { overlay.hidden = true; };

  $('#search-open')?.addEventListener('click', openSearch);
  overlay?.addEventListener('click', (e) => { if (e.target === overlay) closeSearch(); });
  input?.addEventListener('input', (e) => render(e.target.value));
  input?.addEventListener('keydown', (e) => {
    const items = $$('.sr', results);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      items[active]?.classList.remove('is-active');
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[active].classList.add('is-active');
      items[active].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      items[active]?.click();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openSearch();
    }
    if (e.key === 'Escape' && !overlay?.hidden) closeSearch();
  });

  /* ------------------------------ 术语页筛选 ------------------------------ */
  const filter = $('#glossary-filter');
  if (filter) {
    filter.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      let visible = 0;
      $$('.glossgroup').forEach((g) => {
        let shown = 0;
        $$('.glossary__row', g).forEach((row) => {
          const hit = !q || (row.dataset.text || '').includes(q);
          row.hidden = !hit;
          if (hit) shown++;
        });
        g.hidden = shown === 0;
        visible += shown;
      });
      const empty = $('#glossary-empty');
      if (empty) empty.hidden = visible > 0;
    });
  }

  /* ------------------------------ 目录高亮 ------------------------------ */
  const tocLinks = $$('.toc a[href^="#"]');
  if (tocLinks.length) {
    const map = new Map();
    tocLinks.forEach((a) => {
      const el = document.getElementById(a.getAttribute('href').slice(1));
      if (el) map.set(el, a);
    });
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          tocLinks.forEach((a) => a.classList.remove('is-active'));
          map.get(en.target)?.classList.add('is-active');
        });
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 }
    );
    map.forEach((_, el) => io.observe(el));
  }

  paintProgress();
  wireContinue();

  /* ------------------------------ 阅读进度条 ------------------------------ */
  const readbar = document.getElementById('readbar');
  if (readbar) {
    const onScroll = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      readbar.style.transform = `scaleX(${max > 0 ? Math.min(1, doc.scrollTop / max) : 0})`;
    };
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
})();
