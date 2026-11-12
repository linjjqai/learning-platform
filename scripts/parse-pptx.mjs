/**
 * 解析 pptx 内容（pptx 本质是 zip + Open XML）
 * 用法：node scripts/parse-pptx.mjs <file.pptx>
 */
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { parse } from 'node-html-parser';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
if (!file) { console.error('用法: node parse-pptx.mjs <file.pptx>'); process.exit(1); }

const buf = fs.readFileSync(path.resolve(file));
const zip = await JSZip.loadAsync(buf);

// 读取共享字符串表
const sharedStrings = [];
if (zip.file('ppt/sharedStrings.xml')) {
  const ssXml = await zip.file('ppt/sharedStrings.xml').async('string');
  const ssDoc = parse(ssXml);
  ssDoc.querySelectorAll('si').forEach(si => {
    const texts = si.querySelectorAll('t').map(t => t.textContent).join('');
    sharedStrings.push(texts);
  });
}

// 逐页提取
const slideFiles = Object.keys(zip.files)
  .filter(k => k.match(/^ppt\/slides\/slide\d+\.xml$/))
  .sort((a, b) => {
    const na = parseInt(a.match(/slide(\d+)/)[1]);
    const nb = parseInt(b.match(/slide(\d+)/)[1]);
    return na - nb;
  });

const slides = [];
for (const sf of slideFiles) {
  const xml = await zip.file(sf).async('string');
  const doc = parse(xml);
  const texts = [];
  
  // 直接提取 <a:t> 标签内容 + 检查是否有 sdt (结构化文档标签) 里的 idx
  doc.querySelectorAll('a\\:t, a\\:tr, a\\:fld, t').forEach(el => {
    const t = el.textContent.trim();
    if (t) texts.push(t);
  });
  
  // 处理使用共享字符串的情况
  doc.querySelectorAll('a\\:v, v').forEach(el => {
    const idx = parseInt(el.textContent);
    if (!isNaN(idx) && sharedStrings[idx]) {
      texts.push(sharedStrings[idx]);
    }
  });
  
  // 去重保留顺序
  const unique = [];
  texts.forEach(t => {
    const clean = t.trim();
    if (clean && !unique.includes(clean) && clean.length < 500) unique.push(clean);
  });
  
  slides.push({ slide: slides.length + 1, text: unique.join(' / ') });
}

// 输出
console.log(`\n=== ${path.basename(file)} (${slides.length} slides) ===\n`);
for (const s of slides) {
  console.log(`--- Slide ${s.slide} ---`);
  console.log(s.text);
  console.log();
}
