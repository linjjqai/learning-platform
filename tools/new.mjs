/**
 * 内容脚手架：加课程 / 加课时
 *
 *   node tools/new.mjs course hr "新员工 HR 制度"
 *   node tools/new.mjs course hr "新员工 HR 制度" --color "#14b8a6"
 *   node tools/new.mjs lesson crm L32 "渠道政策与返点" --day 7
 *
 * 生成的是可编辑的 markdown 骨架，写完执行 pnpm build 即可上线。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const COURSES = path.join(ROOT, 'content', 'courses');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

const lessonSkeleton = ({ id, order, day, title }) => `---
{
  "id": "${id}",
  "order": ${order},
  "day": ${day},
  "title": "${title}",
  "duration": "",
  "video": "",
  "pdf": [],
  "tags": []
}
---

## 速览（30 秒看完）

- 这一课解决什么问题：一句话说清
- 关键结论 2：写结论，不要写"讲了一下 XX"
- 关键结论 3
- 关键结论 4（建议 5–7 条，每条 40 字内）

## 核心要点

- **要点名**：展开说明。一条只讲一个知识点，能独立看懂
- **要点名**：关键数字、口径、判断条件要写全
- **要点名**：写清"错在哪 → 正确做法"

## 结构与流程

适合放步骤链、结构图或对比表。代码块会保留等宽排版：

\`\`\`
第一步 → 第二步 → 第三步
\`\`\`

## 术语表

| 术语 | 含义 |
| --- | --- |
| 术语A | 一句话解释，写清使用场景 |
| 术语B | 一句话解释 |

## 需要注意的点

1. 最容易搞错的地方：错在哪 → 正确做法
2. 第二个坑

## 关键截图

图片放 content/courses/<课程ID>/media/${id}/ 下，说明末尾加时间点会自动生成角标：

![说明文字（00:01:30）](../../assets/media/${id}/shot-01.jpg)

## 关键节点时间轴

[00:00] 开场与目标 [03:20] 第一部分 [12:45] 演示 [28:10] 练习讲解 [35:00] 小结
`;

if (args[0] === 'course') {
  const id = positional[1];
  const title = positional[2];
  if (!id || !title) {
    console.error('用法: node tools/new.mjs course <课程ID> "<课程标题>" [--color "#6366f1"]');
    process.exit(1);
  }
  const dir = path.join(COURSES, id);
  if (existsSync(path.join(dir, 'course.json'))) {
    console.error(`课程已存在: ${id}`);
    process.exit(1);
  }
  await fs.mkdir(path.join(dir, 'lessons'), { recursive: true });
  await fs.mkdir(path.join(dir, 'media'), { recursive: true });

  const course = {
    id,
    order: 99,
    color: flag('color', '#6366f1'),
    mark: flag('mark', id.toUpperCase().slice(0, 3)),
    title,
    subtitle: '课时数 · N 天路径 · 每课 30 秒速览',
    description: '一句话说明这门课给谁学、学完能做什么。',
    version: 'v1.0',
    updated: new Date().toISOString().slice(0, 10),
    tags: ['标签1', '标签2'],
  };
  await fs.writeFile(path.join(dir, 'course.json'), JSON.stringify(course, null, 2), 'utf8');
  await fs.writeFile(
    path.join(dir, 'lessons', 'L01.md'),
    lessonSkeleton({ id: 'L01', order: 1, day: 1, title: '第一课标题' }),
    'utf8'
  );
  console.log(`✓ 已创建课程 content/courses/${id}/`);
  console.log('  下一步：编辑 lessons/L01.md，然后 pnpm build');
  process.exit(0);
}

if (args[0] === 'lesson') {
  const courseId = positional[1];
  const id = positional[2];
  const title = positional[3];
  if (!courseId || !id || !title) {
    console.error('用法: node tools/new.mjs lesson <课程ID> <课时ID> "<课时标题>" [--day 1]');
    process.exit(1);
  }
  const dir = path.join(COURSES, courseId, 'lessons');
  if (!existsSync(dir)) {
    console.error(`课程不存在: ${courseId}`);
    process.exit(1);
  }
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md'));
  let maxOrder = 0;
  for (const f of files) {
    const raw = await fs.readFile(path.join(dir, f), 'utf8');
    const m = /"order":\s*(\d+)/.exec(raw);
    if (m) maxOrder = Math.max(maxOrder, Number(m[1]));
  }
  const order = maxOrder + 1;
  const day = Number(flag('day', '1'));
  const file = path.join(dir, `${id}.md`);
  if (existsSync(file)) {
    console.error(`课时已存在: ${id}`);
    process.exit(1);
  }
  await fs.writeFile(file, lessonSkeleton({ id, order, day, title }), 'utf8');
  await fs.mkdir(path.join(COURSES, courseId, 'media', id), { recursive: true });
  console.log(`✓ 已添加课时 content/courses/${courseId}/lessons/${id}.md（第 ${order} 课，Day ${day}）`);
  console.log('  写完后执行 pnpm build，它会自动进入当天分组、导航、搜索和进度统计');
  process.exit(0);
}

console.error('用法:\n  node tools/new.mjs course <课程ID> "<标题>"\n  node tools/new.mjs lesson <课程ID> <课时ID> "<标题>" --day 3');
process.exit(1);
