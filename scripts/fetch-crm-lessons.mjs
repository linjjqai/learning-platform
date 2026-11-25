// 从课程平台 API 抓 CRM 课全部课时 lessonId
// 需要你先登录课程平台，然后把下面的 cookie 贴进去

import https from 'https';

// ====== 请把你浏览器的 cookie 贴在这里 ======
// 打开 https://www.fxiaoke.com/XV/UI/Home#app/train/detail/=/id-176106
// F12 → Network → 刷新 → 找到任意 XHR 请求 → 复制 Cookie 请求头
const COOKIE = process.env.FX_COOKIE || '';
const FS_TOKEN = process.env.FX_TOKEN || '';
// ==========================================

const COURSE_ID = 176106;
const TRAIN_TYPE = 1;

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'Cookie': COOKIE,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://www.fxiaoke.com',
        'Referer': 'https://www.fxiaoke.com/',
      }
    };
    https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch(e) {
          reject(new Error('JSON parse failed: ' + body.substring(0, 200)));
        }
      });
    }).on('error', reject).end();
  });
}

async function main() {
  if (!COOKIE || !FS_TOKEN) {
    console.log('❌ 请先设置环境变量 FX_COOKIE 和 FX_TOKEN');
    console.log('示例: $env:FX_COOKIE="fs_token=xxx; lang=zh-CN; ..."');
    console.log('      $env:FX_TOKEN="从 cookie 里拿的 fs_token 值"');
    process.exit(1);
  }

  const url = `https://www.fxiaoke.com/FHH/EM6HFsTrain/course/learn?_fs_token=${encodeURIComponent(FS_TOKEN)}&traceId=FSW-glsk888.1028-${Date.now()}`;
  console.log('请求:', url.substring(0, 100) + '...');

  const j = await fetchJSON(url);
  
  // 找 coursewares
  let coursewares = [];
  let chapters = [];
  
  const deepFind = (obj, depth = 0) => {
    if (depth > 8 || !obj || typeof obj !== 'object') return;
    if (Array.isArray(obj) && obj.length > 5) {
      const hasLesson = obj.some(x => x && typeof x === 'object' && x.resourceType !== undefined && x.length !== undefined);
      if (hasLesson && obj[0].name && !coursewares.length) coursewares = obj;
      const hasChapter = obj.some(x => x && typeof x === 'object' && x.sequence !== undefined && x.parentId !== undefined);
      if (hasChapter && !chapters.length) chapters = obj;
    }
    for (const k of Object.keys(obj)) deepFind(obj[k], depth + 1);
  };
  deepFind(j);

  if (coursewares.length === 0) {
    console.log('❌ 没找到 coursewares，原始响应:', JSON.stringify(j).substring(0, 1000));
    process.exit(1);
  }

  // 章节映射
  const chapterMap = {};
  chapters.forEach(c => { chapterMap[c.id] = c.name; });

  // 排序
  coursewares.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

  // 输出
  console.log(`\n✅ 找到 ${coursewares.length} 个课时，${chapters.length} 个章节\n`);
  console.log('按顺序排列的课时列表:');
  console.log('='.repeat(80));

  coursewares.forEach((l, i) => {
    const mins = Math.round((l.length || 0) / 60);
    const secs = String((l.length || 0) % 60).padStart(2, '0');
    const ch = chapterMap[l.courseChapterId] || '-';
    console.log(`${String(i+1).padStart(2, '0')} | lessonId=${l.id} | ${ch.padEnd(20)} | ${String(mins).padStart(3)}:${secs} | ${l.name}`);
  });

  // 输出 JSON（给 catalog.json 用）
  const lessons = coursewares.map((l, i) => ({
    order: i + 1,
    lessonId: l.id,
    name: l.name,
    chapter: chapterMap[l.courseChapterId] || '',
    durationSec: l.length || 0
  }));

  console.log('\n' + '='.repeat(80));
  console.log('catalog.json lessons 数组（可直接粘贴）:');
  console.log(JSON.stringify(lessons, null, 2));
}

main().catch(e => console.error(e));
