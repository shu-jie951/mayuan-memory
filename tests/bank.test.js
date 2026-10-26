const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const bank = require("../data/questions.js");

const normalize = text => text.replace(/[\s，。；：、？！‘’“”（）()《》]/g, "");

test("题库完整合并九份文档并保留预期题量", () => {
  assert.equal(bank.chapters.length, 9);
  assert.equal(bank.meta.sourceTotal, 461);
  assert.equal(bank.meta.mergedDuplicates, 17);
  assert.equal(bank.questions.length, 444);
  assert.equal(bank.meta.choice, 421);
  assert.equal(bank.meta.subjective, 23);
});

test("题目 ID 唯一且排序索引连续", () => {
  assert.equal(new Set(bank.questions.map(question => question.id)).size, bank.questions.length);
  bank.questions.forEach((question, index) => assert.equal(question.order, index));
});

test("单选和多选数量与题目类型一致", () => {
  const choices = bank.questions.filter(question => question.kind === "choice");
  assert.equal(choices.filter(question => question.type === "single").length, 272);
  assert.equal(choices.filter(question => question.type === "multiple").length, 149);
  for (const question of choices) {
    assert.equal(question.answer.length, question.type === "single" ? 1 : question.answer.length);
    if (question.type === "multiple") assert.ok(question.answer.length >= 2, question.id);
  }
});

test("每道选择题的选项标签连续且答案有效", () => {
  for (const question of bank.questions.filter(item => item.kind === "choice")) {
    assert.ok(question.question.length > 0, question.id);
    assert.ok(question.options.length >= 2, question.id);
    question.options.forEach((option, index) => {
      assert.equal(option.label, String.fromCharCode(65 + index), `${question.id} ${option.label}`);
      assert.ok(option.text.trim().length > 0, `${question.id} 空选项`);
    });
    const labels = new Set(question.options.map(option => option.label));
    for (const answer of question.answer) assert.ok(labels.has(answer), `${question.id} 答案 ${answer}`);
  }
});

test("清洗后的题干不残留括号答案", () => {
  for (const question of bank.questions.filter(item => item.kind === "choice")) {
    assert.doesNotMatch(question.question, /[（(]\s*[A-H](?:\s*[A-H]){0,3}\s*[）)]/, question.id);
  }
});

test("主观题有完整答案且不存在重复学习项", () => {
  const subjective = bank.questions.filter(question => question.kind === "subjective");
  const keys = new Set();
  for (const question of subjective) {
    assert.ok(question.question.trim().length > 2, question.id);
    assert.ok(question.answer.trim().length > 10, question.id);
    const key = normalize(question.question);
    assert.ok(!keys.has(key), question.id);
    keys.add(key);
  }
});

test("十七条章节重复主观题保留来源关系", () => {
  const merged = bank.questions.filter(question => question.sourceRecords?.length > 1);
  assert.equal(merged.length, 17);
  for (const question of merged) {
    assert.ok(question.chapterIds.includes("focus"));
    assert.ok(question.chapterIds.length >= 2);
    assert.equal(question.sourceRecords.length, question.chapterIds.length);
  }
});

test("章节汇总数量与实际关联题目一致", () => {
  for (const chapter of bank.chapters) {
    const items = bank.questions.filter(question => question.chapterIds.includes(chapter.id));
    assert.equal(bank.summary[chapter.id].single, items.filter(question => question.type === "single").length);
    assert.equal(bank.summary[chapter.id].multiple, items.filter(question => question.type === "multiple").length);
    assert.equal(bank.summary[chapter.id].subjective, items.filter(question => question.kind === "subjective").length);
  }
});

test("网页引用的本地资源全部存在且不依赖第三方 CDN", () => {
  const root = path.resolve(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const references = [...html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)].map(match => match[1]).filter(value => !value.startsWith("data:"));
  for (const reference of references) {
    assert.ok(!/^https?:/.test(reference), `外部依赖 ${reference}`);
    assert.ok(fs.existsSync(path.join(root, reference)), `缺少资源 ${reference}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(root, icon.src)));
});
