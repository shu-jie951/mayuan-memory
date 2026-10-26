const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../js/core.js");
const bank = require("../data/questions.js");

const NOW = new Date(2026, 9, 26, 12, 0, 0).getTime();
const ids = new Set(bank.questions.map(question => question.id));
const questionMap = new Map(bank.questions.map(question => [question.id, question]));
const single = bank.questions.find(question => question.type === "single");
const multiple = bank.questions.find(question => question.type === "multiple");

function reviewedState(rating = "good") {
  return Core.reviewQuestion(Core.createDefaultState(NOW), single.id, rating, NOW);
}

function examFixture(answerMap = {}) {
  return {
    id: "exam-test",
    questionIds: [single.id, multiple.id],
    index: 0,
    answers: answerMap,
    flagged: [],
    startedAt: NOW - 5000,
    elapsed: 5000,
    strategy: "smart",
    chapterId: "all",
  };
}

test("重来会在十分钟后到期并记录一次遗忘", () => {
  const state = reviewedState("again");
  const memory = Core.getQuestionState(state, single.id);
  assert.equal(memory.due - NOW, 10 * 60 * 1000);
  assert.equal(memory.lapses, 1);
});

test("首次记住安排一天后复习", () => {
  const memory = Core.getQuestionState(reviewedState("good"), single.id);
  assert.equal(memory.due - NOW, Core.DAY);
  assert.equal(memory.mastery, 1);
});

test("首次熟练安排三天后复习", () => {
  const memory = Core.getQuestionState(reviewedState("easy"), single.id);
  assert.equal(memory.due - NOW, 3 * Core.DAY);
  assert.equal(memory.mastery, 2);
});

test("重复复习会提高强度且不修改旧状态", () => {
  const first = reviewedState("good");
  const second = Core.reviewQuestion(first, single.id, "good", NOW + Core.DAY);
  assert.equal(Core.getQuestionState(first, single.id).mastery, 1);
  assert.equal(Core.getQuestionState(second, single.id).mastery, 2);
  assert.ok(Core.getQuestionState(second, single.id).interval > 1);
});

test("记忆强度最高为五级", () => {
  let state = Core.createDefaultState(NOW);
  for (let index = 0; index < 8; index += 1) state = Core.reviewQuestion(state, single.id, "easy", NOW + index * Core.DAY);
  assert.equal(Core.getQuestionState(state, single.id).mastery, 5);
});

test("非法记忆评分会被拒绝", () => {
  assert.throws(() => Core.reviewQuestion(Core.createDefaultState(), single.id, "unknown"), /Unknown review rating/);
});

test("收藏切换不会清除已有复习记录", () => {
  const original = reviewedState("good");
  const toggled = Core.toggleFavorite(original, single.id, NOW + 1);
  assert.equal(Core.getQuestionState(toggled, single.id).favorite, true);
  assert.equal(Core.getQuestionState(toggled, single.id).seen, 1);
});

test("多选答案不受选择顺序影响", () => {
  assert.equal(Core.sameAnswers([...multiple.answer].reverse(), multiple.answer), true);
});

test("多选漏选不能判为正确", () => {
  assert.equal(Core.sameAnswers(multiple.answer.slice(1), multiple.answer), false);
});

test("多选多选错误选项不能判为正确", () => {
  const wrong = [...multiple.answer, multiple.options.find(option => !multiple.answer.includes(option.label)).label];
  assert.equal(Core.sameAnswers(wrong, multiple.answer), false);
});

test("空题库组卷返回空数组", () => {
  assert.deepEqual(Core.selectExamQuestions([], Core.createDefaultState(), 20), []);
});

test("组卷数量超过题库时返回全部且不重复", () => {
  const pool = bank.questions.filter(question => question.kind === "choice").slice(0, 12);
  const selected = Core.selectExamQuestions(pool, Core.createDefaultState(), 100, "random", () => 0.5);
  assert.equal(selected.length, pool.length);
  assert.equal(new Set(selected.map(question => question.id)).size, pool.length);
});

test("智能组卷按可用比例同时包含单选与多选", () => {
  const pool = bank.questions.filter(question => question.kind === "choice");
  const selected = Core.selectExamQuestions(pool, Core.createDefaultState(), 20, "smart", () => 0.42);
  assert.equal(selected.length, 20);
  assert.ok(selected.some(question => question.type === "single"));
  assert.ok(selected.some(question => question.type === "multiple"));
});

test("顺序组卷严格保留题库顺序", () => {
  const pool = bank.questions.filter(question => question.kind === "choice").slice(0, 30);
  const selected = Core.selectExamQuestions(pool, Core.createDefaultState(), 10, "sequential");
  assert.deepEqual(selected.map(question => question.id), pool.slice(0, 10).map(question => question.id));
});

test("考试评分会列出答错和未答题", () => {
  const exam = examFixture({ [single.id]: single.answer });
  const result = Core.gradeExam(exam, questionMap);
  assert.equal(result.correct, 1);
  assert.deepEqual(result.wrongIds, [multiple.id]);
  assert.equal(result.accuracy, 50);
});

test("交卷更新对错统计并清除活动考试", () => {
  const activeExam = examFixture({ [single.id]: single.answer, [multiple.id]: multiple.answer.slice(1) });
  const state = { ...Core.createDefaultState(NOW), activeExam };
  const result = Core.submitExam(state, activeExam, questionMap, NOW);
  assert.equal(result.state.activeExam, null);
  assert.equal(Core.getQuestionState(result.state, single.id).correct, 1);
  assert.equal(Core.getQuestionState(result.state, multiple.id).wrong, 1);
  assert.equal(result.state.examHistory.length, 1);
});

test("同一考试重复提交时历史记录不会重复", () => {
  const activeExam = examFixture({ [single.id]: single.answer, [multiple.id]: multiple.answer });
  const initial = { ...Core.createDefaultState(NOW), activeExam };
  const first = Core.submitExam(initial, activeExam, questionMap, NOW).state;
  const second = Core.submitExam(first, activeExam, questionMap, NOW + 1).state;
  assert.equal(second.examHistory.length, 1);
});

test("考试历史最多保留二十场", () => {
  const records = Array.from({ length: 25 }, (_, index) => ({
    id: `old-${index}`, date: NOW - index, duration: 1, questionIds: [single.id], answers: {}, correct: 0, accuracy: 0, wrongIds: [single.id],
  }));
  const activeExam = examFixture({ [single.id]: single.answer, [multiple.id]: multiple.answer });
  const result = Core.submitExam({ ...Core.createDefaultState(NOW), examHistory: records, activeExam }, activeExam, questionMap, NOW);
  assert.equal(result.state.examHistory.length, 20);
});

test("统计区分已掌握、到期、收藏与今日次数", () => {
  let state = reviewedState("again");
  state = Core.toggleFavorite(state, single.id, NOW);
  const stats = Core.getStats(state, [single, multiple], NOW);
  assert.equal(stats.seen, 1);
  assert.equal(stats.due, 0);
  assert.equal(stats.favorites, 1);
  assert.equal(stats.reviewsToday, 1);
  assert.equal(Core.getStats(state, [single, multiple], NOW + 11 * 60000).due, 1);
});

test("备份清洗丢弃未知题目并限制异常数值", () => {
  const normalized = Core.normalizeState({
    questions: { [single.id]: { mastery: 999, seen: -4, favorite: true }, malicious: { mastery: 5 } },
    settings: { theme: "invalid", dailyGoal: -1, examCount: 10000, examMinutes: 999 },
    activity: { "bad-date": 20 },
  }, ids, NOW);
  assert.equal(normalized.questions[single.id].mastery, 5);
  assert.equal(normalized.questions[single.id].seen, 0);
  assert.equal(normalized.questions.malicious, undefined);
  assert.equal(normalized.settings.theme, "system");
  assert.equal(normalized.settings.dailyGoal, 5);
  assert.equal(normalized.settings.examCount, 421);
  assert.equal(normalized.settings.examMinutes, 300);
});

test("自定义题数与限时考试状态可安全恢复", () => {
  const activeExam = { ...examFixture(), timeLimit: 45 * 60000, endsAt: NOW + 30 * 60000 };
  const normalized = Core.normalizeState({ settings: { examCount: 37, examMinutes: 45 }, activeExam }, ids, NOW);
  assert.equal(normalized.settings.examCount, 37);
  assert.equal(normalized.settings.examMinutes, 45);
  assert.equal(normalized.activeExam.timeLimit, 45 * 60000);
  assert.equal(normalized.activeExam.endsAt, NOW + 30 * 60000);
});

test("到时交卷会保留限时设置与时间到标记", () => {
  const activeExam = { ...examFixture(), timeLimit: 60000, endsAt: NOW, timedOut: true };
  const result = Core.submitExam(Core.createDefaultState(NOW), activeExam, questionMap, NOW);
  assert.equal(result.record.timeLimit, 60000);
  assert.equal(result.record.timedOut, true);
  const restored = Core.normalizeState({ examHistory: [result.record] }, ids, NOW);
  assert.equal(restored.examHistory[0].timedOut, true);
  assert.equal(restored.examHistory[0].timeLimit, 60000);
});

test("刷新恢复保留答案并修正越界题号", () => {
  const activeExam = { ...examFixture({ [single.id]: ["B", "A", "A"], invalid: ["A"] }), index: 999 };
  const normalized = Core.normalizeState({ activeExam }, ids, NOW);
  assert.equal(normalized.activeExam.index, 1);
  assert.deepEqual(normalized.activeExam.answers[single.id], ["A", "B"]);
  assert.equal(normalized.activeExam.answers.invalid, undefined);
});

test("损坏备份返回可用默认状态", () => {
  const normalized = Core.normalizeState(null, ids, NOW);
  assert.deepEqual(Object.keys(normalized.questions), []);
  assert.deepEqual(normalized.examHistory, []);
  assert.equal(normalized.activeExam, null);
});

test("判分状态随考试恢复且非法项被过滤", () => {
  const activeExam = {
    ...examFixture({ [single.id]: single.answer }),
    graded: { [single.id]: true, [multiple.id]: true, invalid: true },
  };
  const normalized = Core.normalizeState({ activeExam }, ids, NOW);
  assert.equal(normalized.activeExam.graded[single.id], true);
  assert.equal(normalized.activeExam.graded[multiple.id], true);
  assert.equal(normalized.activeExam.graded.invalid, undefined);
  const fresh = Core.normalizeState({ activeExam: examFixture({}) }, ids, NOW);
  assert.deepEqual(fresh.activeExam.graded, {});
});
