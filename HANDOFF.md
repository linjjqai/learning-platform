# 接手说明 · HANDOFF

> 给接手的人 / 接手 AI 看的一页说明。目标是：不用翻聊天记录，读完这份就能继续开发。
> 最后更新：2026-11-10

---

## 0. 这是什么

一个**纯静态学习平台**：内容用 markdown 写，`platform/build.mjs` 把它生成成 `dist/` 静态站点。
当前装着一门课《新员工 CRM 产品入门》：33 课时 / 7 天路径 / 14 份课件 / 132 道章节题 / 25 道结业总测。

不需要后端、数据库、账号体系。`dist/` 扔到任何静态托管就能跑。

---

## 1. 先跑起来

```bash
pnpm install     # 只有两个构建期依赖：marked、node-html-parser
pnpm build       # content/ → dist/
pnpm serve       # http://127.0.0.1:4173
```

Windows 上也可以双击 `启动预览.cmd`（起服务并打开浏览器）。

技术栈：Node 18+（实测 Node 24）、原生 JS、无前端框架、无模板引擎（build.mjs 里直接拼字符串）。

---

## 2. 目录职责

| 路径 | 作用 | 谁会改 |
| --- | --- | --- |
| `content/portal.json` | 平台品牌（学习中心名称、口号） | 换品牌时 |
| `content/courses/<课程ID>/course.json` | 课程元信息：标题、颜色、标签、简介 | 加课/改课 | 
| `content/courses/<课程ID>/catalog.json` | 天数分组、课件清单 | 改章节结构 |
| `content/courses/<课程ID>/lessons/Lxx.md` | 课时正文（front matter JSON + markdown） | 日常内容 |
| `content/courses/<课程ID>/exam.json` | 题库：章节题 + 结业总测 | 改题 |
| `content/courses/<课程ID>/media/<课时>/` | 截图 | 换图 |
| `platform/build.mjs` | 唯一生成器（970 行） | 加页面/改结构 |
| `platform/assets/app.css` | 全部样式（1129 行，顶部是配色变量） | 换肤 |
| `platform/assets/app.js` | 全部交互（530 行：搜索/进度/自测/总测/灯箱） | 加交互 |
| `templates/课程内容模板.md` | 新课时模板 | 写新课时参考 |
| `tools/` | 脚手架与运维脚本（见第 7 节） | 按需 |
| `_inbox/` | 原始素材：课件、视频抓帧、出题中间件 | 不是运行依赖 |
| `dist/` | **构建产物，不要手改**，下次 build 会覆盖 | 无 |

---

## 3. 内容模型（最重要的约定）

### 课时 markdown 的分区靠关键词识别

| 标题里出现 | 渲染成 |
| --- | --- |
| 速览 / 30 秒 | 顶部高亮速览卡 |
| 核心要点 / 要点 | 编号要点列表 |
| 结构与流程 / 结构 / 流程 | 普通 markdown 卡片（可放代码块画结构图） |
| 术语 | 术语卡片 + 进术语总表 + 无题库时自动出题 |
| 注意 / 易错 / 坑 | 警示卡片 |
| 截图 / 图示 | 截图墙（点击放大、带时间角标） |
| 时间轴 / 节点 | 可点击时间轴（有视频时跳转） |

缺哪节就不渲染哪节，不报错。

### front matter（JSON，不是 YAML）

```json
{
  "id": "L01", "order": 1, "day": 1,
  "title": "标题（不带"课时N"前缀）",
  "fullTitle": "课时1 标题",
  "duration": "87:55",
  "video": "",            // mp4 直链 → <video>；网页地址 → iframe
  "pdf": ["xxx.pdf"],
  "tags": ["对象管理"],
  "quiz": []              // 可选，手写题；有题库时用 exam.json
}
```

### 图片路径

正文里写 `../../assets/media/<课时目录>/xxx.jpg`，构建时会改写成 `assets/media/<课程ID>/...`。
截图实际存放：`content/courses/<课程ID>/media/<课时目录>/`（兼容 `slides/` 子目录，构建会拍平）。

### 题库 exam.json

```json
{
  "passScore": 60,
  "lessons": { "L01": [ { "q": "...", "options": ["A","B","C","D"], "answer": 0, "explain": "..." } ] },
  "final": { "title": "结业总测", "questions": [ /* 同上结构 + from/day */ ] }
}
```

- `answer` 是正确选项下标（0–3）
- 没有 `exam.json` 的课程自动退回「按术语表生成选择题」
- **字段名不要改**，前端按 `q / options / answer / explain` 读取

### 进度存储（前端 localStorage）

键：`lp:progress:v2`

```js
{
  crm: {
    L01: { done: true, quiz: { right: 3, total: 4, at: 1794... } },
    __exam: { score: 76, right: 19, total: 25, pass: true, at: 1794... }
  }
}
```

---

## 4. 当前内容状态

- **33 课时**，与纷享销客培训平台 2026-04 版逐节对应（标题、时长一致）
- 天数：D1 L01–L05、D2 L06–L13、D3 L14–L18、D4 L19–L20、D5 L21–L27、D6 L28–L30、D7 L31–L33
- 13 份官方课件已解析（`_inbox/_extracted/`）并并入对应课时
- L01/L02/L19/L20 的补充内容来自平台视频画面
- L22/L23/L27 是「作业讲解」课，正文是题干 + 逐题配置要点，**没有时间轴**（视频无章节节点，不编造）
- 题库 132 + 25 题，AI 依据课时正文生成，**尚未经业务全量校验**

---

## 5. 关键决策与原因（别推翻重做）

1. **为什么是 33 课时不是 31**：平台目录就是 33。商机的 3 节配置题合并成 2 节（L17/L18），新增审批流作业1/2（L22/L23）、业务流作业（L27）。
2. **课时编号整体重排过**：交易管理从 L20 变 L19，之后全部前移/后移。旧的单课链接会跳节，属于预期。
3. **为什么没有后端**：零运维、零成本、改内容即发布。代价是进度只在本机浏览器，无法统计"谁学完了"。
4. **为什么不用前端框架**：产物要能直接丢任何静态托管；改样式/内容不需要懂 React。
5. **为什么学习进度按课程隔离**：`lp:progress:v2[crm][L01]`，加新课程不会互相污染。
6. **总测为什么必须全答完才能交**：避免空题被判错、分数失真；交卷后立即批改并逐题给解析。

---

## 6. 已知问题 / 待办

| 优先级 | 事项 | 说明 |
| --- | --- | --- |
| P0 | 上线 | `dist/` 部署到 GitHub Pages / 内网 Nginx / 对象存储；注意内网课件合规 |
| P1 | 题库校验 | 132 道 AI 生成题建议按业务经验抽检，改 `exam.json` 即可 |
| P2 | 补齐两份课件 | `7.交易管理`、`00_零基础入门` 未拿到，L01/L02/L19/L20 目前靠视频 |
| P3 | 视频回填 | 可用 `tools/fx-capture.mjs` 抓帧，替换 2026 版界面截图 |
| P4 | 完成率统计 | 需要登录 + 后端，当前架构不支持；要做属于二期 |

---

## 7. 常用命令与脚本

```bash
pnpm build                                  # 构建
pnpm serve                                  # 本地预览
pnpm verify                                 # 无头 Edge 回归：截图 + 搜索/答题/打卡/图片加载，输出 _shots/report.json
pnpm new course hr "新员工 HR 制度"          # 加一门课（生成 course.json + 首课骨架）
pnpm new lesson crm L34 "新课时" --day 7     # 加一节课（自动接续 order）
node tools/check-content.mjs                # 体检：每课是否有速览/要点/术语/截图/时间轴
node tools/extract_material.py _inbox/crm   # 把 pptx/pdf/docx 解析成文本（需 python-pptx）
node tools/make-exam.mjs                     # 合并 _inbox/quiz/*.json → exam.json
node tools/fx-capture.mjs "<课时关键字>" L01 90   # 抓平台视频画面（需已登录的调试窗口）
```

---

## 8. 不要动

- `dist/` 是产物，手改必被覆盖
- `_inbox/crm/` 是公司内部课件（含培训水印），**对外发送前确认合规**，别整包外发
- `exam.json` 的字段名、`lp:progress:v2` 的结构（改了就丢老用户进度）

---

## 9. 继续开发怎么入手

| 想做的 | 改哪里 |
| --- | --- |
| 改文案/加课时 | `content/courses/crm/lessons/*.md` → `pnpm build` |
| 换配色/布局 | `platform/assets/app.css` 顶部变量（`--primary`、`--grad-main`、`--day-color`） |
| 加页面（如"学习报告"） | `platform/build.mjs` 里加一个 `xxxBody(course)` + 写入循环里 `await write(...)` |
| 加交互（如收藏、笔记） | `platform/assets/app.js`，数据存 localStorage |
| 加课程 | `pnpm new course <id> "<标题>"`，再补 `lessons/` |
| 改测验规则 | `exam.json` 的 `passScore`；交卷逻辑在 `app.js` 的「结业总测」段 |

改完统一跑 `pnpm build && pnpm verify` 回归。
