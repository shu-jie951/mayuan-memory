const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const bank = require("../data/mech.js");

const root = path.resolve(__dirname, "..");
const byKind = kind => bank.questions.filter(question => question.kind === kind);

test("机械工程材料题库覆盖六大题型", () => {
  assert.equal(bank.meta.total, 374);
  assert.equal(bank.questions.length, 374);
  assert.deepEqual(
    Object.fromEntries(["term", "judge", "choice", "blank", "subjective"].map(kind => [kind, byKind(kind).length])),
    { term: 50, judge: 116, choice: 71, blank: 79, subjective: 58 },
  );
  assert.equal(byKind("subjective").filter(question => question.type === "essay").length, 42);
  assert.equal(byKind("subjective").filter(question => question.type === "analysis").length, 16);
});

test("题目 ID 唯一、以 j 开头且排序索引连续", () => {
  const ids = bank.questions.map(question => question.id);
  assert.equal(new Set(ids).size, ids.length);
  ids.forEach(id => assert.match(id, /^j\d{4}$/));
  bank.questions.forEach((question, index) => assert.equal(question.order, index));
});

test("判断题只有正误两个选项且答案合法", () => {
  const questions = byKind("judge");
  assert.equal(questions.length, 116);
  for (const question of questions) {
    assert.deepEqual(question.options.map(option => option.label), ["A", "B"], question.id);
    assert.equal(question.answer.length, 1, question.id);
    assert.ok(["A", "B"].includes(question.answer[0]), question.id);
  }
});

test("选择题选项标签连续且答案命中选项", () => {
  for (const question of byKind("choice")) {
    assert.ok(question.options.length >= 2, question.id);
    question.options.forEach((option, index) => {
      assert.equal(option.label, String.fromCharCode(65 + index), `${question.id} ${option.label}`);
      assert.ok(option.text.trim().length > 0, `${question.id} 空选项`);
    });
    const labels = new Set(question.options.map(option => option.label));
    for (const answer of question.answer) assert.ok(labels.has(answer), `${question.id} 答案 ${answer}`);
  }
});

test("填空题每题都有答案数组且与题干空位数量一致", () => {
  for (const question of byKind("blank")) {
    assert.ok(Array.isArray(question.blanks), question.id);
    assert.ok(question.blanks.length >= 1, question.id);
    question.blanks.forEach(item => assert.ok(String(item).trim().length > 0, `${question.id} 空答案`));
    assert.ok(typeof question.answer === "string" && question.answer.length > 0, question.id);
    const slots = (question.question.match(/＿{2,}|_{3,}/g) || []).length;
    assert.equal(slots, question.blanks.length, `${question.id} 空位 ${slots} / 答案 ${question.blanks.length}`);
  }
});

test("名词解释与简答题答案完整", () => {
  for (const question of bank.questions.filter(item => item.type === "term" || item.type === "essay")) {
    assert.ok(question.question.trim().length >= 1, question.id);
    assert.ok(String(question.answer).trim().length >= 6, question.id);
  }
});

test("综合分析题配图存在且文件可读", () => {
  const withImage = bank.questions.filter(question => question.image);
  assert.equal(withImage.length, 4);
  for (const question of withImage) {
    const file = path.join(root, question.image);
    assert.ok(fs.existsSync(file), `缺少配图 ${question.image}`);
    assert.ok(fs.statSync(file).size > 4000, `${question.image} 体积异常`);
  }
});

test("解析全覆盖，勘误单独保留", () => {
  const missing = bank.questions.filter(question => !(question.explanation || "").trim());
  assert.equal(missing.length, 0, `缺少解析：${missing.map(question => question.id).join("、")}`);
  const thin = bank.questions.filter(question => question.explanation.trim().length < 10);
  assert.equal(thin.length, 0, `解析过短：${thin.map(question => question.id).join("、")}`);
  const errata = bank.questions.filter(question => question.erratum && question.erratum.trim().length > 4);
  assert.ok(errata.length >= 10, `勘误数量 ${errata.length}`);
});

test("章节挂载存在且不混入马原题库", () => {
  const chapterIds = new Set(bank.chapters.map(chapter => chapter.id));
  assert.equal(chapterIds.size, bank.chapters.length);
  for (const question of bank.questions) {
    assert.ok(question.chapterIds.length >= 1, question.id);
    for (const id of question.chapterIds) assert.ok(chapterIds.has(id), `${question.id} 章节 ${id}`);
    assert.ok(!/^c\d{4}$/.test(question.id), question.id);
    assert.ok(!/马原|马克思主义/.test(question.sourceFile || ""), question.id);
  }
});

test("题目不含 PDF 下划线占位残留以外的异常控制字符", () => {
  for (const question of bank.questions) {
    assert.doesNotMatch(question.question, /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/, question.id);
    assert.doesNotMatch(question.question, /⟦|⟧/, question.id);
  }
});
