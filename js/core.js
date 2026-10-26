(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MemoryCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DAY = 86400000;
  const STORAGE_KEY = "mayuan-memory-v1";
  const RATINGS = new Set(["again", "hard", "good", "easy"]);

  function clamp(value, min, max, fallback = min) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  function dateKey(timestamp = Date.now()) {
    const date = new Date(timestamp);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function createDefaultState(now = Date.now()) {
    return {
      version: 1,
      questions: {},
      settings: { theme: "system", fontSize: "standard", examCount: 20, examMinutes: 0, dailyGoal: 20 },
      positions: { choice: "", subjective: "" },
      activity: {},
      examHistory: [],
      activeExam: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  function defaultQuestionState() {
    return {
      seen: 0,
      mastery: 0,
      interval: 0,
      ease: 2.5,
      due: 0,
      lastReviewed: 0,
      lapses: 0,
      correct: 0,
      wrong: 0,
      favorite: false,
    };
  }

  function sanitizeQuestionState(value) {
    const base = defaultQuestionState();
    if (!value || typeof value !== "object") return base;
    return {
      seen: Math.round(clamp(value.seen, 0, 1000000, 0)),
      mastery: Math.round(clamp(value.mastery, 0, 5, 0)),
      interval: clamp(value.interval, 0, 3650, 0),
      ease: clamp(value.ease, 1.3, 3.5, 2.5),
      due: clamp(value.due, 0, 9999999999999, 0),
      lastReviewed: clamp(value.lastReviewed, 0, 9999999999999, 0),
      lapses: Math.round(clamp(value.lapses, 0, 1000000, 0)),
      correct: Math.round(clamp(value.correct, 0, 1000000, 0)),
      wrong: Math.round(clamp(value.wrong, 0, 1000000, 0)),
      favorite: value.favorite === true,
    };
  }

  function sanitizeAnswers(value) {
    if (!value || typeof value !== "object") return {};
    const answers = {};
    for (const [id, selected] of Object.entries(value)) {
      if (!/^c\d{4}$/.test(id) || !Array.isArray(selected)) continue;
      answers[id] = [...new Set(selected.filter(letter => /^[A-H]$/.test(letter)))].sort();
    }
    return answers;
  }

  function sanitizeExam(value, validIds) {
    if (!value || typeof value !== "object" || !Array.isArray(value.questionIds)) return null;
    const questionIds = [...new Set(value.questionIds.filter(id => validIds.has(id) && id.startsWith("c")))];
    if (!questionIds.length) return null;
    const answers = sanitizeAnswers(value.answers);
    const graded = {};
    for (const id of questionIds) if (value.graded && value.graded[id] === true) graded[id] = true;
    const startedAt = clamp(value.startedAt, 0, 9999999999999, Date.now());
    const timeLimit = Math.round(clamp(value.timeLimit, 0, 300 * 60000, 0));
    return {
      id: String(value.id || `exam-${Date.now()}`).slice(0, 80),
      questionIds,
      index: Math.round(clamp(value.index, 0, questionIds.length - 1, 0)),
      answers,
      graded,
      flagged: Array.isArray(value.flagged) ? value.flagged.filter(id => questionIds.includes(id)) : [],
      startedAt,
      elapsed: Math.round(clamp(value.elapsed, 0, 86400000, 0)),
      timeLimit,
      endsAt: timeLimit ? clamp(value.endsAt, 1, 9999999999999, startedAt + timeLimit) : 0,
      strategy: ["smart", "random", "sequential"].includes(value.strategy) ? value.strategy : "smart",
      chapterId: String(value.chapterId || "all").slice(0, 30),
    };
  }

  function normalizeState(input, validQuestionIds, now = Date.now()) {
    const base = createDefaultState(now);
    if (!input || typeof input !== "object") return base;
    const validIds = validQuestionIds instanceof Set ? validQuestionIds : new Set(validQuestionIds || []);
    const questions = {};
    if (input.questions && typeof input.questions === "object") {
      for (const [id, value] of Object.entries(input.questions)) {
        if (validIds.has(id)) questions[id] = sanitizeQuestionState(value);
      }
    }
    const settings = input.settings && typeof input.settings === "object" ? input.settings : {};
    const positions = input.positions && typeof input.positions === "object" ? input.positions : {};
    const activity = {};
    if (input.activity && typeof input.activity === "object") {
      for (const [key, value] of Object.entries(input.activity)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(key)) activity[key] = Math.round(clamp(value, 0, 1000000, 0));
      }
    }
    const history = Array.isArray(input.examHistory) ? input.examHistory.slice(0, 20).map(record => {
      if (!record || typeof record !== "object" || !Array.isArray(record.questionIds)) return null;
      const questionIds = record.questionIds.filter(id => validIds.has(id) && id.startsWith("c"));
      if (!questionIds.length) return null;
      const correct = Math.round(clamp(record.correct, 0, questionIds.length, 0));
      return {
        id: String(record.id || `exam-${Date.now()}`).slice(0, 80),
        date: clamp(record.date, 0, 9999999999999, now),
        duration: Math.round(clamp(record.duration, 0, 86400000, 0)),
        timeLimit: Math.round(clamp(record.timeLimit, 0, 300 * 60000, 0)),
        timedOut: record.timedOut === true,
        questionIds,
        answers: sanitizeAnswers(record.answers),
        correct,
        accuracy: questionIds.length ? Math.round(correct / questionIds.length * 100) : 0,
        wrongIds: Array.isArray(record.wrongIds) ? record.wrongIds.filter(id => questionIds.includes(id)) : [],
      };
    }).filter(Boolean) : [];
    return {
      ...base,
      questions,
      settings: {
        theme: ["system", "light", "dark"].includes(settings.theme) ? settings.theme : "system",
        fontSize: ["compact", "standard", "large"].includes(settings.fontSize) ? settings.fontSize : "standard",
        examCount: Math.round(clamp(settings.examCount, 1, 421, 20)),
        examMinutes: Math.round(clamp(settings.examMinutes, 0, 300, 0)),
        dailyGoal: Math.round(clamp(settings.dailyGoal, 5, 200, 20)),
      },
      positions: {
        choice: validIds.has(positions.choice) ? positions.choice : "",
        subjective: validIds.has(positions.subjective) ? positions.subjective : "",
      },
      activity,
      examHistory: history,
      activeExam: sanitizeExam(input.activeExam, validIds),
      createdAt: clamp(input.createdAt, 0, 9999999999999, now),
      updatedAt: clamp(input.updatedAt, 0, 9999999999999, now),
    };
  }

  function getQuestionState(state, id) {
    return state.questions[id] || defaultQuestionState();
  }

  function nextSchedule(previous, rating, now) {
    const next = { ...previous, seen: previous.seen + 1, lastReviewed: now };
    if (rating === "again") {
      next.mastery = Math.max(0, previous.mastery - 2);
      next.interval = 10 / (60 * 24);
      next.ease = Math.max(1.3, previous.ease - 0.2);
      next.lapses = previous.lapses + 1;
      next.due = now + 10 * 60000;
    } else if (rating === "hard") {
      next.mastery = Math.max(1, previous.mastery - (previous.mastery > 1 ? 1 : 0));
      next.interval = previous.interval >= 1 ? Math.min(365, previous.interval * 1.2) : 1;
      next.ease = Math.max(1.3, previous.ease - 0.15);
      next.due = now + next.interval * DAY;
    } else if (rating === "easy") {
      next.mastery = Math.min(5, previous.mastery + 2);
      next.interval = previous.interval >= 1 ? Math.min(365, previous.interval * previous.ease * 1.3) : 3;
      next.ease = Math.min(3.5, previous.ease + 0.15);
      next.due = now + next.interval * DAY;
    } else {
      next.mastery = Math.min(5, previous.mastery + 1);
      next.interval = previous.interval >= 1 ? Math.min(365, previous.interval * previous.ease) : 1;
      next.due = now + next.interval * DAY;
    }
    return next;
  }

  function touchActivity(state, now, amount = 1) {
    const key = dateKey(now);
    return { ...state.activity, [key]: (state.activity[key] || 0) + amount };
  }

  function reviewQuestion(state, id, rating, now = Date.now()) {
    if (!RATINGS.has(rating)) throw new Error("Unknown review rating");
    const previous = getQuestionState(state, id);
    const scheduled = nextSchedule(previous, rating, now);
    return {
      ...state,
      questions: { ...state.questions, [id]: scheduled },
      activity: touchActivity(state, now),
      updatedAt: now,
    };
  }

  function toggleFavorite(state, id, now = Date.now()) {
    const previous = getQuestionState(state, id);
    return {
      ...state,
      questions: { ...state.questions, [id]: { ...previous, favorite: !previous.favorite } },
      updatedAt: now,
    };
  }

  function sameAnswers(selected, answer) {
    if (!Array.isArray(selected) || selected.length !== answer.length) return false;
    const normalized = [...selected].sort();
    return answer.every((letter, index) => normalized[index] === letter);
  }

  function weightedSample(items, count, state, rng) {
    const pool = [...items];
    const selected = [];
    while (pool.length && selected.length < count) {
      const weights = pool.map(question => {
        const memory = getQuestionState(state, question.id);
        const due = memory.lastReviewed && memory.due <= Date.now() ? 4 : 0;
        const unseen = memory.seen === 0 ? 2.5 : 0;
        const wrong = Math.min(6, memory.wrong * 1.5);
        const weak = (5 - memory.mastery) * 0.3;
        return 1 + due + unseen + wrong + weak + (memory.favorite ? 0.5 : 0);
      });
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      let cursor = rng() * total;
      let index = pool.length - 1;
      for (let i = 0; i < pool.length; i += 1) {
        cursor -= weights[i];
        if (cursor <= 0) { index = i; break; }
      }
      selected.push(pool.splice(index, 1)[0]);
    }
    return selected;
  }

  function selectExamQuestions(pool, state, count = 20, strategy = "smart", rng = Math.random) {
    const choices = pool.filter(question => question.kind === "choice");
    const target = Math.min(Math.max(0, Math.round(count)), choices.length);
    if (!target) return [];
    if (strategy === "sequential") return choices.slice(0, target);
    if (strategy === "random") {
      const shuffled = [...choices];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled.slice(0, target);
    }
    const singles = choices.filter(question => question.type === "single");
    const multiples = choices.filter(question => question.type === "multiple");
    let multipleTarget = Math.round(target * multiples.length / choices.length);
    if (singles.length && multiples.length && target > 1) {
      multipleTarget = Math.max(1, Math.min(target - 1, multipleTarget));
    }
    multipleTarget = Math.min(multipleTarget, multiples.length);
    const singleTarget = Math.min(target - multipleTarget, singles.length);
    const selected = [
      ...weightedSample(singles, singleTarget, state, rng),
      ...weightedSample(multiples, multipleTarget, state, rng),
    ];
    if (selected.length < target) {
      const ids = new Set(selected.map(question => question.id));
      selected.push(...weightedSample(choices.filter(question => !ids.has(question.id)), target - selected.length, state, rng));
    }
    for (let i = selected.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [selected[i], selected[j]] = [selected[j], selected[i]];
    }
    return selected;
  }

  function gradeExam(exam, questionMap) {
    const wrongIds = [];
    let correct = 0;
    for (const id of exam.questionIds) {
      const question = questionMap instanceof Map ? questionMap.get(id) : questionMap[id];
      if (question && sameAnswers(exam.answers[id], question.answer)) correct += 1;
      else wrongIds.push(id);
    }
    return { correct, wrongIds, total: exam.questionIds.length, accuracy: exam.questionIds.length ? Math.round(correct / exam.questionIds.length * 100) : 0 };
  }

  function submitExam(state, exam, questionMap, now = Date.now()) {
    const result = gradeExam(exam, questionMap);
    let next = state;
    for (const id of exam.questionIds) {
      const question = questionMap instanceof Map ? questionMap.get(id) : questionMap[id];
      if (!question) continue;
      const isCorrect = !result.wrongIds.includes(id);
      next = reviewQuestion(next, id, isCorrect ? "good" : "again", now);
      const memory = next.questions[id];
      next.questions[id] = {
        ...memory,
        correct: memory.correct + (isCorrect ? 1 : 0),
        wrong: memory.wrong + (isCorrect ? 0 : 1),
      };
    }
    const record = {
      id: exam.id,
      date: now,
      duration: Math.max(0, Math.round(exam.elapsed / 1000)),
      timeLimit: Math.round(clamp(exam.timeLimit, 0, 300 * 60000, 0)),
      timedOut: exam.timedOut === true,
      questionIds: [...exam.questionIds],
      answers: sanitizeAnswers(exam.answers),
      correct: result.correct,
      accuracy: result.accuracy,
      wrongIds: result.wrongIds,
    };
    next.examHistory = [record, ...next.examHistory.filter(item => item.id !== record.id)].slice(0, 20);
    next.activeExam = null;
    next.updatedAt = now;
    return { state: next, record };
  }

  function getStats(state, questions, now = Date.now()) {
    const memories = questions.map(question => getQuestionState(state, question.id));
    const seen = memories.filter(memory => memory.seen > 0).length;
    const mastered = memories.filter(memory => memory.mastery >= 4).length;
    const due = memories.filter(memory => memory.seen > 0 && memory.due <= now).length;
    const wrong = memories.filter(memory => memory.wrong > 0).length;
    const favorites = memories.filter(memory => memory.favorite).length;
    const reviewsToday = state.activity[dateKey(now)] || 0;
    let streak = 0;
    const cursor = new Date(now);
    if (!reviewsToday) cursor.setDate(cursor.getDate() - 1);
    while (state.activity[dateKey(cursor.getTime())] > 0) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    const exams = state.examHistory.length;
    const examQuestions = state.examHistory.reduce((sum, record) => sum + record.questionIds.length, 0);
    const examCorrect = state.examHistory.reduce((sum, record) => sum + record.correct, 0);
    return {
      seen, mastered, due, wrong, favorites, reviewsToday, streak, exams,
      progress: questions.length ? Math.round(seen / questions.length * 100) : 0,
      masteryProgress: questions.length ? Math.round(mastered / questions.length * 100) : 0,
      accuracy: examQuestions ? Math.round(examCorrect / examQuestions * 100) : 0,
    };
  }

  return {
    DAY, STORAGE_KEY, createDefaultState, defaultQuestionState, normalizeState,
    getQuestionState, nextSchedule, reviewQuestion, toggleFavorite, sameAnswers,
    selectExamQuestions, gradeExam, submitExam, getStats, dateKey,
  };
});
