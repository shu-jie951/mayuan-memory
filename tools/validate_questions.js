#!/usr/bin/env node
"use strict";

// 题库数据质检：校验每道题的结构与答案合法性
const path = require("path");
const bank = require(path.join(__dirname, "..", "data", "questions.js"));

const problems = [];
const stats = { choice: 0, single: 0, multiple: 0, subjective: 0 };
const seenIds = new Set();
const seenStems = new Map();

for (const chapter of bank.chapters) {
  if (!chapter.id || !chapter.title) problems.push(`章节缺少 id 或 title: ${JSON.stringify(chapter).slice(0, 80)}`);
}

for (const question of bank.questions) {
  const label = `${question.id}`;
  if (!question.id) problems.push(`存在无 id 的题目`);
  if (seenIds.has(question.id)) problems.push(`${label}: id 重复`);
  seenIds.add(question.id);

  if (!question.question || !question.question.trim()) problems.push(`${label}: 题干为空`);
  if (!question.chapterId || !bank.chapters.some(chapter => chapter.id === question.chapterId)) {
    problems.push(`${label}: chapterId 无效 "${question.chapterId}"`);
  }
  if (!Array.isArray(question.chapterIds) || !question.chapterIds.includes(question.chapterId)) {
    problems.push(`${label}: chapterIds 未包含 chapterId`);
  }
  if (typeof question.order !== "number") problems.push(`${label}: order 非数字`);

  if (question.kind === "choice") {
    stats.choice += 1;
    stats[question.type] += 1;
    const labels = (question.options || []).map(option => option.label);
    const unique = new Set(labels);
    if (!question.options || question.options.length < 2) problems.push(`${label}: 选项少于 2 个`);
    if (unique.size !== labels.length) problems.push(`${label}: 选项标号重复 ${labels.join("")}`);
    if (labels.some(l => !/^[A-H]$/.test(l))) problems.push(`${label}: 选项标号非法 ${labels.join("")}`);
    if (labels.some((l, i) => !question.options[i].text || !question.options[i].text.trim())) problems.push(`${label}: 存在空选项文本`);
    if (question.options && labels.length && !labels.every((l, i) => l === String.fromCharCode(65 + i))) {
      problems.push(`${label}: 选项标号不连续 ${labels.join("")}`);
    }
    if (!Array.isArray(question.answer) || !question.answer.length) {
      problems.push(`${label}: 答案为空`);
    } else {
      if (question.answer.some(letter => !labels.includes(letter))) {
        problems.push(`${label}: 答案 ${question.answer.join("")} 含不存在的选项`);
      }
      if (new Set(question.answer).size !== question.answer.length) problems.push(`${label}: 答案重复`);
      if (question.type === "single" && question.answer.length !== 1) problems.push(`${label}: 单选题答案数量 ${question.answer.length}`);
      if (question.type === "multiple" && question.answer.length < 2) problems.push(`${label}: 多选题答案数量 ${question.answer.length}`);
      if (question.answer.length === (question.options || []).length && question.type !== "multiple") problems.push(`${label}: 非多选题却全部选项都是答案`);
    }
    const stemKey = question.question.replace(/\s+/g, "");
    const optionKey = (question.options || []).map(option => `${option.label}${option.text}`).join("|");
    const fullKey = `${stemKey}::${optionKey}`;
    if (seenStems.has(fullKey)) problems.push(`${label}: 题干与选项均与 ${seenStems.get(fullKey)} 完全重复`);
    seenStems.set(fullKey, label);
  } else if (question.kind === "subjective") {
    stats.subjective += 1;
    if (typeof question.answer !== "string" || question.answer.trim().length < 8) problems.push(`${label}: 主观题答案过短`);
  } else {
    problems.push(`${label}: 未知 kind "${question.kind}"`);
  }
}

// 汇总统计与 bank.meta 一致性
if (bank.meta.total !== bank.questions.length) problems.push(`meta.total (${bank.meta.total}) 与实际题数 (${bank.questions.length}) 不符`);
if (bank.meta.choice !== stats.choice) problems.push(`meta.choice (${bank.meta.choice}) 与实际 (${stats.choice}) 不符`);
if (bank.meta.single !== stats.single) problems.push(`meta.single (${bank.meta.single}) 与实际 (${stats.single}) 不符`);
if (bank.meta.multiple !== stats.multiple) problems.push(`meta.multiple (${bank.meta.multiple}) 与实际 (${stats.multiple}) 不符`);
if (bank.meta.subjective !== stats.subjective) problems.push(`meta.subjective (${bank.meta.subjective}) 与实际 (${stats.subjective}) 不符`);

console.log(`题库校验：共 ${bank.questions.length} 题（单选 ${stats.single} / 多选 ${stats.multiple} / 主观 ${stats.subjective}）`);
if (problems.length) {
  console.error(`发现 ${problems.length} 个问题：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("全部校验通过 ✓");
