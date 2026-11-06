# 记忆舱 · 双学科题库

两套相互独立的题库，共用一套背诵、盲考与间隔复习机制：

| 学科 | 题量 | 题型构成 |
| --- | --- | --- |
| 马克思主义基本原理（马原） | 444 | 单选 272 · 多选 149 · 主观题 23 |
| 机械工程材料（机械） | 374 | 名词解释 50 · 判断 116 · 选择 71 · 填空 79 · 简答 42 · 综合分析 16 |

**两个题库的进度、错题、收藏、考试记录完全隔离**（分别存放在 `mayuan-memory-v1` 与 `question-bank:mech:v1`），左侧栏或顶栏的「马原 / 机械」按钮即可以切换，切换后学科主题色也会变化。

## 功能

- **客观题背诵**：单选、多选、判断、填空逐题作答并即时判分
  - 选择题点击选项立即判分；多选需勾选后提交
  - 判断题以「正确 √ / 错误 ×」两个大按钮作答
  - 填空题在题干横线处内嵌输入框，逐空判分（忽略空格、全半角与标点差异），作答后按空列出参考答案
- **主观题背诵**：名词解释、简答题、综合分析题先回忆再看答案，四档自评（重来 / 模糊 / 记住 / 熟练）驱动间隔复习
- **答案 + 解析 + 勘误**：作答或点击「显示答案」后，同时给出参考答案、逐题【解析】与原卷【勘误说明】；原卷「改正」在存在勘误时折叠，避免误导
- **配图**：机械题库 4 道综合分析题带 Fe-Fe₃C 相图与 CCT 曲线，点击可放大查看
- **客观题盲考**：按题型实际比例智能组卷（选择 / 判断 / 填空混排），优先抽取到期、答错与未掌握题；自定义范围、题数与时长；每题即时判分，交卷后给出成绩、题型与章节分析与逐题解析；刷新不丢进度，限时到自动交卷
- **错题本与章节专项**：错题自动进入重考，可按章节、题型、状态筛选
- **学习统计**：14 天打卡热力图、今日记忆次数与每日目标、全库掌握度
- **成绩导出**：成绩摘要一键复制，解析导出 CSV（UTF-8 BOM，Excel 直接打开）
- **键盘快捷键**：背诵模式 `Space` 显示答案、`1–4` 自评、`←/→` 翻题、`F` 收藏；考试模式 `A–H` 选答案、`Enter` 确认/下一题、`Backspace` 上一题
- **离线可用（PWA）**：进度保存在本机浏览器，支持添加到主屏幕、离线学习与数据备份导入导出

## 数据与工具

```
data/questions.js     马原题库（由九份 Word 文档合并去重）
data/mech.js          机械工程材料题库（由 PDF 题库解析生成）
assets/mech/*.png     综合分析题配图（从 PDF 原页裁切、二值化去底色）
tools/build_mech.py   解析 PDF 结构化 JSON → 六大题型 → data/mech.js
tools/mech_overrides.py  填空题人工重建、单选/简答/综合题补丁
tools/prep_figures.py 从 PDF 原页裁切插图（配 tools/png_util.py 纯 Python PNG 编解码）
tools/validate_questions.js  两套题库结构质检
```

重建机械题库：

```bash
python tools/build_mech.py --structure <structure.json> --out /tmp/mech.json --js data/mech.js
```

其中 `structure.json` 由 `workbuddy-pdf` 以 `-f structure` 导出。插图重建（先把含图的三页导出为 400dpi PNG 到临时目录，再按 PDF 点坐标裁切、去底色、二值化）：

```bash
workbuddy-pdf <题库.pdf> -f png --dpi 400 --pages 60-62 --out /tmp/figsrc
python tools/prep_figures.py --src /tmp/figsrc --out assets/mech
```

## 本地运行

纯静态站点，无任何构建依赖：

```bash
npm start        # 默认 http://127.0.0.1:4173
```

运行单元测试与数据校验：

```bash
npm test                     # Node.js 内置测试运行器
node tools/validate_questions.js
```

运行浏览器端到端验收（需先 `npm start`，使用本机 Edge）：

```bash
npm run test:e2e
```

## 技术栈

原生 HTML / CSS / JavaScript，零依赖。记忆算法基于间隔重复（四次自评对应不同复习间隔），所有进度通过 `localStorage` 保存在本机，两个题库使用独立的存储键。
