#!/usr/bin/env node
"use strict";

// 题库数据质检：校验两套题库的结构与答案合法性
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const problems = [];
const duplicates = [];

function checkCommon(bank, name, stats, seenIds, seenStems) {
  const chapterIds = new Set(bank.chapters.map(chapter => chapter.id));
  for (const chapter of bank.chapters) {
    if (!chapter.id || !chapter.title) problems.push(`[${name}] 章节缺少 id 或 title: ${JSON.stringify(chapter).slice(0, 80)}`);
  }

  for (const question of bank.questions) {
    const label = `[${name}] ${question.id}`;
    if (!question.id) problems.push(`[${name}] 存在无 id 的题目`);
    if (seenIds.has(question.id)) problems.push(`${label}: id 重复`);
    seenIds.add(question.id);

    if (!question.question || !question.question.trim()) problems.push(`${label}: 题干为空`);
    if (!question.chapterId || !chapterIds.has(question.chapterId)) problems.push(`${label}: chapterId 无效 "${question.chapterId}"`);
    if (!Array.isArray(question.chapterIds) || !question.chapterIds.includes(question.chapterId)) problems.push(`${label}: chapterIds 未包含 chapterId`);
    if (typeof question.order !== "number") problems.push(`${label}: order 非数字`);
    if (question.image && !fs.existsSync(path.join(root, question.image))) problems.push(`${label}: 配图不存在 ${question.image}`);

    if (question.kind === "choice" || question.kind === "judge") {
      const labels = (question.options || []).map(option => option.label);
      const unique = new Set(labels);
      if (!question.options || question.options.length < 2) problems.push(`${label}: 选项少于 2 个`);
      if (unique.size !== labels.length) problems.push(`${label}: 选项标号重复 ${labels.join("")}`);
      if (labels.some(letter => !/^[A-H]$/.test(letter))) problems.push(`${label}: 选项标号非法 ${labels.join("")}`);
      if (labels.some((letter, index) => !question.options[index].text || !question.options[index].text.trim())) problems.push(`${label}: 存在空选项文本`);
      if (labels.length && !labels.every((letter, index) => letter === String.fromCharCode(65 + index))) {
        problems.push(`${label}: 选项标号不连续 ${labels.join("")}`);
      }
      if (!Array.isArray(question.answer) || !question.answer.length) {
        problems.push(`${label}: 答案为空`);
      } else {
        if (question.answer.some(letter => !labels.includes(letter))) problems.push(`${label}: 答案 ${question.answer.join("")} 含不存在的选项`);
        if (new Set(question.answer).size !== question.answer.length) problems.push(`${label}: 答案重复`);
        if (question.type === "single" && question.answer.length !== 1) problems.push(`${label}: 单选题答案数量 ${question.answer.length}`);
        if (question.type === "multiple" && question.answer.length < 2) problems.push(`${label}: 多选题答案数量 ${question.answer.length}`);
        if (question.type === "tf" && question.answer.length !== 1) problems.push(`${label}: 判断题答案数量 ${question.answer.length}`);
        if (question.answer.length === (question.options || []).length && question.type !== "multiple" && question.kind !== "judge") {
          problems.push(`${label}: 非多选题却全部选项都是答案`);
        }
      }
      stats[question.type] = (stats[question.type] || 0) + 1;
      const stemKey = question.question.replace(/\s+/g, "");
      const optionKey = (question.options || []).map(option => `${option.label}${option.text}`).join("|");
      const fullKey = `${stemKey}::${optionKey}`;
      if (seenStems.has(fullKey)) duplicates.push(`${label} 与 ${seenStems.get(fullKey)} 题干选项完全相同（原卷重复题）`);
      seenStems.set(fullKey, label);
    } else if (question.kind === "blank") {
      if (!Array.isArray(question.blanks) || !question.blanks.length) {
        problems.push(`${label}: 缺少 blanks 数组`);
      } else {
        if (question.blanks.some(item => !String(item).trim())) problems.push(`${label}: 存在空答案`);
        const slots = (question.question.match(/＿{2,}|_{3,}/g) || []).length;
        if (slots !== question.blanks.length) problems.push(`${label}: 题干空位 ${slots} 与答案 ${question.blanks.length} 不一致`);
      }
      stats.blank = (stats.blank || 0) + 1;
    } else if (question.kind === "term" || question.kind === "subjective") {
      if (typeof question.answer !== "string" || question.answer.trim().length < 6) problems.push(`${label}: 主观题答案过短`);
      stats[question.type] = (stats[question.type] || 0) + 1;
    } else {
      problems.push(`${label}: 未知 kind "${question.kind}"`);
    }
  }

  if (bank.meta?.total !== bank.questions.length) {
    problems.push(`[${name}] meta.total (${bank.meta?.total}) 与实际题数 (${bank.questions.length}) 不符`);
  }
}

function summarize(name, bank) {
  const counts = {};
  for (const question of bank.questions) counts[question.type] = (counts[question.type] || 0) + 1;
  const parts = Object.entries(counts).map(([type, count]) => `${type} ${count}`).join(" / ");
  console.log(`[${name}] 共 ${bank.questions.length} 题（${parts}）`);
}

const mayuan = require(path.join(root, "data", "questions.js"));
summarize("马原", mayuan);
checkCommon(mayuan, "马原", {}, new Set(), new Map());

let mech = null;
const mechPath = path.join(root, "data", "mech.js");
if (fs.existsSync(mechPath)) {
  mech = require(mechPath);
  summarize("机械", mech);
  checkCommon(mech, "机械", {}, new Set(), new Map());
}

if (problems.length) {
  console.error(`\n发现 ${problems.length} 个问题：`);
  for (const problem of problems.slice(0, 60)) console.error(`  - ${problem}`);
  if (problems.length > 60) console.error(`  ... 另有 ${problems.length - 60} 条`);
  process.exit(1);
}
if (duplicates.length) {
  console.log(`\n提示：检测到 ${duplicates.length} 组原卷重复题（保留原样，未去重）：`);
  for (const note of duplicates) console.log(`  · ${note}`);
}
console.log("\n全部校验通过 ✓");
