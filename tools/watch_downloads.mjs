/**
 * 盯下载目录：把新下载的课件自动收进 _inbox/crm 并解压 zip
 * 用法: node tools/watch_downloads.mjs [分钟数]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const INBOX = path.join(ROOT, '_inbox', 'crm');
const DOWNLOADS = path.join(os.homedir(), 'Downloads');
const MINUTES = Number(process.argv[2] || 30);
const EXT = new Set(['.pptx', '.ppt', '.pdf', '.docx', '.zip']);

await fs.mkdir(INBOX, { recursive: true });

const started = Date.now();
const since = started - 5000; // 只收监听开始之后写入的文件，避免把旧文件一起搬走
const seen = new Set();
console.log(`[watch] ${DOWNLOADS}`);
console.log(`[watch] -> ${INBOX}  监听 ${MINUTES} 分钟`);

async function stable(p) {
  try {
    const a = await fs.stat(p);
    await new Promise((r) => setTimeout(r, 1200));
    const b = await fs.stat(p);
    return a.size === b.size && b.size > 0;
  } catch {
    return false;
  }
}

async function unzip(file) {
  const dest = path.join(INBOX, path.basename(file, path.extname(file)));
  await fs.mkdir(dest, { recursive: true });
  await new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${file}' -DestinationPath '${dest}' -Force`], () => resolve());
  });
  console.log(`[zip] 解压 -> ${dest}`);
}

while (Date.now() - started < MINUTES * 60 * 1000) {
  let entries = [];
  try {
    entries = await fs.readdir(DOWNLOADS, { withFileTypes: true });
  } catch { /* 目录不存在时跳过 */ }

  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (!EXT.has(ext)) continue;
    const full = path.join(DOWNLOADS, e.name);
    if (seen.has(full)) continue;
    try {
      const st = await fs.stat(full);
      if (st.mtimeMs < since) continue; // 旧文件忽略
    } catch {
      continue;
    }
    if (!(await stable(full))) continue;
    seen.add(full);
    const dest = path.join(INBOX, e.name);
    try {
      await fs.copyFile(full, dest);
      console.log(`[ok] ${e.name}`);
      if (ext === '.zip') await unzip(dest);
    } catch (err) {
      console.log(`[fail] ${e.name}: ${err.message}`);
    }
  }
  await new Promise((r) => setTimeout(r, 2000));
}
console.log('[watch] 结束');
