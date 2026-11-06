(function () {
  "use strict";

  const Core = window.MemoryCore;
  const app = document.getElementById("app");

  const SUBJECT_DEFS = [
    {
      id: "mayuan",
      short: "马原",
      full: "马克思主义基本原理",
      mark: "M",
      bank: window.QUESTION_BANK,
      labels: { choice: "选择题背诵", subjective: "主观题背诵", exam: "选择题盲考" },
      navLabels: { choice: "选择题", subjective: "主观题", exam: "选择题盲考" },
      intro: "题库顺序 + 间隔复习 + 弱点组卷",
    },
    {
      id: "mech",
      short: "机械",
      full: "机械工程材料",
      mark: "J",
      bank: window.QUESTION_BANK_MECH,
      labels: { choice: "客观题背诵", subjective: "主观题背诵", exam: "客观题盲考" },
      navLabels: { choice: "客观题", subjective: "主观题", exam: "客观题盲考" },
      intro: "名词 · 判断 · 选择 · 填空 · 简答 · 综合分析",
    },
  ];

  const TYPE_LABELS = {
    single: "单选题",
    multiple: "多选题",
    tf: "判断题",
    judge: "判断题",
    blank: "填空题",
    term: "名词解释",
    essay: "简答题",
    analysis: "综合分析题",
    subjective: "主观题",
  };

  const MODE_LABELS = { choice: "客观题", subjective: "主观题" };

  const subjects = SUBJECT_DEFS.filter(item => item.bank && Array.isArray(item.bank.questions) && item.bank.questions.length);
  if (!Core || !subjects.length) {
    app.innerHTML = '<div class="empty-state card"><h2>题库载入失败</h2><p>请确认 data/questions.js、data/mech.js 与 js/core.js 文件完整，然后刷新页面。</p></div>';
    return;
  }

  const headerTitle = document.getElementById("header-title");
  const headerSubtitle = document.getElementById("header-subtitle");
  const todayChip = document.getElementById("today-chip");
  const subjectSwitch = document.querySelectorAll(".subject-switch");
  const brandMark = document.getElementById("brand-mark");
  const brandName = document.getElementById("brand-name");
  const brandSub = document.getElementById("brand-sub");
  const settingsDialog = document.getElementById("settings-dialog");
  const helpDialog = document.getElementById("help-dialog");
  const confirmDialog = document.getElementById("confirm-dialog");
  const imageDialog = document.getElementById("image-dialog");
  const importFile = document.getElementById("import-file");

  const defaultFilters = {
    choice: { chapter: "all", type: "all", status: "all", search: "", order: "sequential" },
    subjective: { chapter: "all", type: "all", status: "all", search: "", order: "sequential" },
  };

  const ui = {
    subjectId: "",
    view: "home",
    revealed: false,
    studySelected: [],
    studyGraded: false,
    blankInputs: [],
    blankHits: [],
    blankChecked: false,
    completed: { choice: false, subjective: false },
    filters: JSON.parse(JSON.stringify(defaultFilters)),
    examResult: null,
    showReview: false,
    mobileSheet: false,
  };

  const LAST_BANK_KEY = "memory-cabin:last-bank";
  let storageWarningShown = false;
  let confirmCallback = null;
  let searchComposing = false;
  let examLastTick = Date.now();
  let ctx = null;
  let state = null;
  const stateCache = new Map();

  function loadState(id) {
    const def = subjects.find(item => item.id === id);
    const core = buildContext(def);
    let loaded;
    try {
      loaded = Core.normalizeState(JSON.parse(localStorage.getItem(Core.storageKey(id)) || "null"), core.validIds);
    } catch {
      loaded = Core.createDefaultState();
    }
    stateCache.set(id, loaded);
    return loaded;
  }

  function buildContext(def) {
    const bank = def.bank;
    const questions = bank.questions.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const questionMap = new Map(questions.map(question => [question.id, question]));
    const chapters = (bank.chapters || []).filter(chapter => chapter.id !== "focus");
    const chapterMap = new Map(chapters.map(chapter => [chapter.id, chapter]));
    const validIds = new Set(questions.map(question => question.id));
    const objective = questions.filter(question => Core.isAutoGraded(question));
    const recall = questions.filter(question => !Core.isAutoGraded(question));
    const typeCounts = {};
    questions.forEach(question => {
      const key = question.type || question.kind;
      typeCounts[key] = (typeCounts[key] || 0) + 1;
    });
    return {
      def, bank, questions, questionMap, chapters, chapterMap, validIds,
      objective, recall, typeCounts,
      meta: bank.meta || {},
      modes: { choice: objective, subjective: recall },
      modeTypes: {
        choice: [...new Set(objective.map(question => question.type || question.kind))],
        subjective: [...new Set(recall.map(question => question.type || question.kind))],
      },
    };
  }

  function rebuildContext() {
    const def = subjects.find(item => item.id === ui.subjectId) || subjects[0];
    ui.subjectId = def.id;
    ctx = buildContext(def);
    state = stateCache.get(def.id) || loadState(def.id);
    if (state.settings.lastBank !== def.id) {
      state.settings.lastBank = def.id;
      saveState();
    }
  }

  const initialBank = (() => {
    try {
      const direct = localStorage.getItem(LAST_BANK_KEY);
      if (direct) return direct;
      const stored = JSON.parse(localStorage.getItem(Core.STORAGE_KEY) || "null");
      return stored?.settings?.lastBank;
    } catch { return null; }
  })();
  ui.subjectId = subjects.some(item => item.id === initialBank) ? initialBank : subjects[0].id;
  rebuildContext();

  function icon(name) {
    return `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
  }

  function clampPercent(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
  }

  function progressBar(value) {
    return `<div class="progress-track"><div class="progress-fill" style="transform:scaleX(${clampPercent(value) / 100})"></div></div>`;
  }

  function scrollBehavior() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  }

  function saveState() {
    state.updatedAt = Date.now();
    try {
      localStorage.setItem(Core.storageKey(ui.subjectId), JSON.stringify(state));
      // 单独记录当前学科，避免与马原题库的状态键冲突
      localStorage.setItem(LAST_BANK_KEY, ui.subjectId);
    } catch {
      if (!storageWarningShown) {
        storageWarningShown = true;
        toast("浏览器未允许本地存储，本次进度仅在当前页面保留");
      }
    }
  }

  function applyPreferences() {
    const dark = state.settings.theme === "dark" || (state.settings.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.font = state.settings.fontSize;
    document.documentElement.dataset.subject = ui.subjectId;
    document.querySelector('meta[name="theme-color"]').content = dark ? "#111713" : (ui.subjectId === "mech" ? "#1d3a5c" : "#174d40");
  }

  function toast(message) {
    const region = document.getElementById("toast-region");
    const element = document.createElement("div");
    element.className = "toast";
    element.innerHTML = icon("check");
    const text = document.createElement("span");
    text.textContent = message;
    element.append(text);
    region.append(element);
    while (region.children.length > 3) region.firstElementChild.remove();
    window.setTimeout(() => element.remove(), 2800);
  }

  function openConfirm(title, message, confirmText, callback, danger = true) {
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-message").textContent = message;
    const submit = document.getElementById("confirm-submit");
    submit.textContent = confirmText;
    submit.className = danger ? "button button--danger" : "button button--primary";
    confirmCallback = callback;
    confirmDialog.returnValue = "";
    confirmDialog.showModal();
  }

  function typeOf(question) {
    return question.type || question.kind;
  }

  function typeLabel(question) {
    return TYPE_LABELS[typeOf(question)] || question.section || "题目";
  }

  function modeOf(question) {
    return Core.isAutoGraded(question) ? "choice" : "subjective";
  }

  function answerText(question) {
    if (!question) return "";
    if (Array.isArray(question.answer)) return question.answer.join("");
    return String(question.answer || "");
  }

  function chapterName(question, short = false) {
    const chapter = ctx.chapterMap.get(question.chapterId);
    if (!chapter) return "未分类";
    return short ? chapter.shortTitle : `${chapter.shortTitle} · ${chapter.title}`;
  }

  function chapterIdsOf(question) {
    return Array.isArray(question.chapterIds) && question.chapterIds.length ? question.chapterIds : [question.chapterId];
  }

  function chapterOptions(selected, mode) {
    const pool = ctx.modes[mode] || ctx.questions;
    return `<option value="all"${selected === "all" ? " selected" : ""}>全部章节</option>${ctx.chapters.map(chapter => {
      const count = pool.filter(question => chapterIdsOf(question).includes(chapter.id)).length;
      if (!count) return "";
      return `<option value="${chapter.id}"${selected === chapter.id ? " selected" : ""}>${escapeHTML(chapter.shortTitle)}（${count}）</option>`;
    }).join("")}`;
  }

  function formatDuration(seconds) {
    const safe = Math.max(0, Math.round(seconds || 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const rest = safe % 60;
    return hours ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  function formatDate(timestamp) {
    return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
  }

  function memoryStatus(memory) {
    if (!memory.seen) return "尚未学习";
    if (memory.mastery >= 4) return "已掌握";
    if (memory.mastery >= 2) return "记忆中";
    return "待巩固";
  }

  function dueText(memory) {
    if (!memory.seen) return "尚未安排";
    const remaining = memory.due - Date.now();
    if (remaining <= 0) return "现在到期";
    if (remaining < Core.DAY) return "今天稍晚";
    const days = Math.ceil(remaining / Core.DAY);
    return `${days} 天后`;
  }

  function titles() {
    const label = ctx.def.labels;
    return {
      home: ["学习首页", `${ctx.def.full} · 把每一道题变成长期记忆`],
      choice: [label.choice, "先作答或自评，再查看答案与解析"],
      subjective: [label.subjective, "先回忆答题框架，再核对完整表述与解析"],
      exam: [label.exam, "逐题即时判分，交卷后查看成绩与分析"],
    };
  }

  function getStudyList(mode) {
    const filter = ui.filters[mode];
    const source = ctx.modes[mode] || [];
    const query = filter.search.trim().toLowerCase();
    const now = Date.now();
    const list = source.filter(question => {
      if (filter.chapter !== "all" && !chapterIdsOf(question).includes(filter.chapter)) return false;
      if (filter.type !== "all" && typeOf(question) !== filter.type) return false;
      const memory = Core.getQuestionState(state, question.id);
      if (filter.status === "unseen" && memory.seen) return false;
      if (filter.status === "due" && (!memory.seen || memory.due > now)) return false;
      if (filter.status === "wrong" && !memory.wrong) return false;
      if (filter.status === "favorite" && !memory.favorite) return false;
      if (filter.status === "mastered" && memory.mastery < 4) return false;
      if (query) {
        const options = question.options ? question.options.map(option => option.text).join(" ") : "";
        const haystack = `${question.question} ${options} ${answerText(question)} ${question.explanation || ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    if (filter.order === "smart") {
      return list.sort((a, b) => {
        const left = Core.getQuestionState(state, a.id);
        const right = Core.getQuestionState(state, b.id);
        const leftDue = left.seen && left.due <= now ? 0 : 1;
        const rightDue = right.seen && right.due <= now ? 0 : 1;
        return leftDue - rightDue || left.mastery - right.mastery || left.seen - right.seen || (a.order ?? 0) - (b.order ?? 0);
      });
    }
    return list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  function currentStudy(mode, list) {
    const savedId = state.positions[mode];
    const index = Math.max(0, list.findIndex(question => question.id === savedId));
    return { question: list[index], index };
  }

  function updateChrome() {
    const [title, subtitle] = titles()[ui.view];
    headerTitle.textContent = title;
    headerSubtitle.textContent = subtitle;
    document.title = `${ctx.def.short}记忆舱 · ${title}`;
    brandMark.textContent = ctx.def.mark;
    brandName.textContent = `${ctx.def.short}记忆舱`;
    brandSub.textContent = ctx.def.full;
    document.querySelectorAll("[data-nav]").forEach(button => {
      button.classList.toggle("is-active", button.dataset.nav === ui.view);
      const label = button.querySelector("span");
      const nav = button.dataset.nav;
      if (!label) return;
      if (nav === "exam") label.textContent = button.closest(".side-nav") ? ctx.def.navLabels.exam : "盲考";
      else if (ctx.def.navLabels[nav]) label.textContent = ctx.def.navLabels[nav];
    });
    const stats = Core.getStats(state, ctx.questions);
    todayChip.textContent = `今日 ${stats.reviewsToday} 次记忆`;
    const dark = document.documentElement.dataset.theme === "dark";
    const themeButton = document.querySelector('[data-action="toggle-theme"]');
    themeButton.innerHTML = icon(dark ? "sun" : "moon");
    themeButton.setAttribute("aria-label", dark ? "切换为浅色主题" : "切换为深色主题");
    const strip = subjects.map(item => {
      const total = item.bank.questions.length;
      const loaded = stateCache.get(item.id) || null;
      const seen = loaded ? item.bank.questions.filter(question => Core.getQuestionState(loaded, question.id).seen).length : 0;
      const active = item.id === ui.subjectId;
      return `<button class="subject-chip${active ? " is-active" : ""}" role="tab" aria-selected="${active}" data-action="switch-subject" data-subject="${item.id}"><strong>${item.short}</strong><small>${seen}/${total}</small></button>`;
    }).join("");
    subjectSwitch.forEach(node => { node.innerHTML = strip; });
  }

  function render(preserveScroll = false) {
    const scroll = window.scrollY;
    if (isExamExpired()) { finalizeExam(true); return; }
    updateChrome();
    if (ui.view === "home") app.innerHTML = renderHome();
    else if (ui.view === "choice" || ui.view === "subjective") app.innerHTML = renderStudy(ui.view);
    else app.innerHTML = renderExam();
    if (preserveScroll) requestAnimationFrame(() => window.scrollTo({ top: scroll }));
  }

  function navigate(view) {
    ui.view = view;
    ui.revealed = false;
    ui.mobileSheet = false;
    resetStudyPick();
    render();
    window.scrollTo({ top: 0, behavior: "instant" });
    app.focus({ preventScroll: true });
  }

  function activityHeat() {
    const todayCount = state.activity[Core.dateKey()] || 0;
    const cells = [];
    for (let offset = 13; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - offset);
      const key = Core.dateKey(date.getTime());
      const count = state.activity[key] || 0;
      const level = count === 0 ? 0 : count < state.settings.dailyGoal / 2 ? 1 : count < state.settings.dailyGoal ? 2 : 3;
      cells.push(`<span class="activity-day${level ? ` is-level-${level}` : ""}" title="${key} · ${count} 次"></span>`);
    }
    return `<section class="panel card activity-panel"><div class="section-heading"><div><h2>学习打卡</h2><p>最近 14 天的记忆次数</p></div><span class="badge">今日 ${todayCount} 次</span></div><div class="activity-heat" role="img" aria-label="最近 14 天学习热力图">${cells.join("")}</div><div class="activity-legend"><span><i class="activity-day"></i>未学习</span><span><i class="activity-day is-level-1"></i>起步</span><span><i class="activity-day is-level-2"></i>接近目标</span><span><i class="activity-day is-level-3"></i>达标</span></div></section>`;
  }

  function subjectOverviewCards() {
    return subjects.map(item => {
      const core = item.id === ui.subjectId ? ctx : buildContext(item);
      const loaded = stateCache.get(item.id) || (item.id === ui.subjectId ? state : null);
      const total = core.questions.length;
      const seen = loaded ? core.questions.filter(question => Core.getQuestionState(loaded, question.id).seen).length : 0;
      const percent = total ? Math.round(seen / total * 100) : 0;
      const counts = core.modeTypes.choice.map(type => `${TYPE_LABELS[type] || type} ${core.objective.filter(question => typeOf(question) === type).length}`).join(" · ");
      return `<button class="subject-card${item.id === ui.subjectId ? " is-active" : ""}" data-action="switch-subject" data-subject="${item.id}">
        <span class="subject-card__mark">${item.mark}</span>
        <span class="subject-card__body"><strong>${escapeHTML(item.full)}</strong><small>${escapeHTML(counts)}${core.recall.length ? ` · 主观类 ${core.recall.length}` : ""}</small>${progressBar(percent)}</span>
        <span class="subject-card__meta">${seen}/${total}</span>
      </button>`;
    }).join("");
  }

  function renderHome() {
    const stats = Core.getStats(state, ctx.questions);
    const goalProgress = Math.min(100, Math.round(stats.reviewsToday / state.settings.dailyGoal * 100));
    const continueLabel = state.activeExam ? "继续未交卷考试" : stats.due ? `复习今日 ${stats.due} 道到期题` : state.positions.choice || state.positions.subjective ? "继续上次背诵" : "开始第一轮背诵";
    const recent = state.examHistory.slice(0, 3);
    const chapterRows = ctx.chapters.map(chapter => {
      const items = ctx.questions.filter(question => chapterIdsOf(question).includes(chapter.id));
      const seen = items.filter(question => Core.getQuestionState(state, question.id).seen).length;
      const percent = items.length ? Math.round(seen / items.length * 100) : 0;
      return `<li class="chapter-row"><button class="chapter-row__name text-button" data-action="open-chapter" data-chapter="${chapter.id}">${escapeHTML(chapter.shortTitle)} · ${escapeHTML(chapter.title)}</button>${progressBar(percent)}<span class="chapter-row__count">${seen}/${items.length}</span></li>`;
    }).join("");
    const objectiveTypes = ctx.modeTypes.choice.map(type => `${TYPE_LABELS[type] || type} ${ctx.objective.filter(question => typeOf(question) === type).length}`).join(" · ");
    const recallTypes = ctx.modeTypes.subjective.map(type => `${TYPE_LABELS[type] || type} ${ctx.recall.filter(question => typeOf(question) === type).length}`).join(" · ");
    return `<div class="page-stack">
      <section class="hero">
        <div class="hero__copy">
          <span class="eyebrow">MEMORY CABIN · ${escapeHTML(ctx.def.full)}</span>
          <h2>不是多看一遍，<br>而是真正记住。</h2>
          <p>${ctx.questions.length} 道题：${escapeHTML(objectiveTypes)}${recallTypes ? `，${escapeHTML(recallTypes)}` : ""}。作答或查看后立即给出答案与逐题解析，结合间隔复习与错题重考。</p>
          <button class="button button--primary button--large" data-action="continue-learning">${continueLabel}${icon("arrow")}</button>
        </div>
        <div class="hero__progress">
          <div class="progress-ring" style="--progress:${stats.masteryProgress}"><span class="progress-ring__value">${stats.masteryProgress}<small>%</small></span></div>
          <p>全库掌握度<br><strong>${stats.mastered} / ${ctx.questions.length} 题</strong></p>
          <div class="daily-goal"><div class="daily-goal__label"><span>今日目标</span><span>${stats.reviewsToday}/${state.settings.dailyGoal}</span></div>${progressBar(goalProgress)}</div>
        </div>
      </section>
      <section class="panel card subject-panel"><div class="section-heading"><div><h2>学科题库</h2><p>两个题库的学习进度完全独立，互不影响</p></div><span class="badge">当前：${escapeHTML(ctx.def.short)}</span></div><div class="subject-grid">${subjectOverviewCards()}</div></section>
      <section class="mode-grid" aria-label="学习模式">
        <button class="mode-card card" data-action="start-study" data-mode="choice"><span class="mode-card__icon">${icon("choice")}</span><h3>${escapeHTML(ctx.def.labels.choice)}</h3><p>逐题作答或直接看答案，${typeLabelModeHint("choice")}。支持章节、错题和收藏筛选。</p><span class="mode-card__meta"><span>${ctx.modes.choice.length} 道可判分题</span>${icon("arrow")}</span></button>
        <button class="mode-card card" data-action="start-study" data-mode="subjective"><span class="mode-card__icon">${icon("book")}</span><h3>${escapeHTML(ctx.def.labels.subjective)}</h3><p>先构建答题框架，再展开完整答案与解析。四档记忆反馈，逐步攻克长篇表述。</p><span class="mode-card__meta"><span>${ctx.modes.subjective.length} 道背诵题</span>${icon("arrow")}</span></button>
        <button class="mode-card card" data-nav="exam"><span class="mode-card__icon">${icon("exam")}</span><h3>${escapeHTML(ctx.def.labels.exam)}</h3><p>按各题型实际比例自动分配，优先抽取薄弱与到期题。交卷后统一评分并给出解析。</p><span class="mode-card__meta"><span>${state.activeExam ? "有 1 场考试待继续" : "智能组卷 · 自动判分"}</span>${icon("arrow")}</span></button>
      </section>
      <section class="stat-grid" aria-label="学习统计">
        <button class="stat-card card stat-card--link" data-action="quick-review" data-status="due" aria-label="复习今日到期题目"><span class="stat-card__label">今日到期${icon("clock")}</span><strong class="stat-card__value">${stats.due}</strong><span class="stat-card__note">点击立即复习</span></button>
        <div class="stat-card card"><span class="stat-card__label">连续学习${icon("brain")}</span><strong class="stat-card__value">${stats.streak}<small> 天</small></strong><span class="stat-card__note">今日已记忆 ${stats.reviewsToday} 题次</span></div>
        <button class="stat-card card stat-card--link" data-action="quick-review" data-status="wrong" aria-label="进入错题本"><span class="stat-card__label">错题本${icon("close")}</span><strong class="stat-card__value">${stats.wrong}</strong><span class="stat-card__note">点击进入错题重背</span></button>
        <div class="stat-card card"><span class="stat-card__label">盲考正确率${icon("exam")}</span><strong class="stat-card__value">${stats.accuracy}<small>%</small></strong><span class="stat-card__note">已完成 ${stats.exams} 场考试</span></div>
      </section>
      <section class="dashboard-grid">
        <div class="panel card"><div class="section-heading"><div><h2>章节学习进度</h2><p>客观题与主观题合并统计</p></div><span class="badge">已学 ${stats.seen} 题</span></div><ul class="chapter-list">${chapterRows}</ul></div>
        <div class="panel card"><div class="section-heading"><div><h2>快速开始</h2><p>把精力用在最需要的地方</p></div></div><div class="quick-list">
          <button class="quick-action" data-action="quick-review" data-status="due"><span class="quick-action__icon">${icon("clock")}</span><span class="quick-action__copy"><strong>今日到期</strong><small>${stats.due} 道题等待复习</small></span>${icon("right")}</button>
          <button class="quick-action" data-action="quick-review" data-status="wrong"><span class="quick-action__icon">${icon("close")}</span><span class="quick-action__copy"><strong>错题重背</strong><small>${stats.wrong} 道题曾经答错</small></span>${icon("right")}</button>
          <button class="quick-action" data-action="quick-review" data-status="favorite"><span class="quick-action__icon">${icon("star")}</span><span class="quick-action__copy"><strong>我的收藏</strong><small>${stats.favorites} 道重点标记题</small></span>${icon("right")}</button>
        </div></div>
      </section>
      ${activityHeat()}
      ${recent.length ? `<section class="panel card"><div class="section-heading"><div><h2>最近盲考</h2><p>点击成绩可查看作答与解析</p></div><button class="text-button" data-nav="exam">全部考试${icon("right")}</button></div><ul class="history-list">${recent.map(renderHistoryItem).join("")}</ul></section>` : ""}
    </div>`;
  }

  function typeLabelModeHint(mode) {
    const types = ctx.modeTypes[mode];
    const names = types.map(type => TYPE_LABELS[type] || type);
    return names.length > 1 ? `${names.join("、")}混合练习` : `只含${names[0] || "题目"}`;
  }

  function renderHistoryItem(record) {
    return `<li class="history-item"><button class="text-button" data-action="view-result" data-exam-id="${escapeHTML(record.id)}">${record.questionIds.length} 题盲考 · ${formatDate(record.date)}${record.timedOut ? " · 时间到" : ""}</button><strong class="history-item__score">${record.accuracy}<small>%</small></strong><span class="history-item__meta">答对 ${record.correct} 题 · 用时 ${formatDuration(record.duration)}</span></li>`;
  }

  // ---------- 题干与配图 ----------

  function renderFigure(question) {
    if (!question.image) return "";
    return `<figure class="question-figure"><img src="${escapeHTML(question.image)}" alt="${escapeHTML(question.figureCaption || "题目配图")}" loading="lazy" data-action="zoom-image"><figcaption>${escapeHTML(question.figureCaption || "点击图片可放大查看")}</figcaption></figure>`;
  }

  function renderTable(table) {
    if (!table || !Array.isArray(table.head) || !Array.isArray(table.rows)) return "";
    return `<div class="table-wrap"><table class="data-table"><thead><tr>${table.head.map(cell => `<th>${escapeHTML(cell)}</th>`).join("")}</tr></thead><tbody>${table.rows.map(row => `<tr>${row.map(cell => `<td>${escapeHTML(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  function renderStem(question, interactive) {
    if (question.kind === "blank" && interactive) {
      const blanks = Array.isArray(question.blanks) ? question.blanks : [];
      const escaped = escapeHTML(question.question);
      const slots = escaped.match(/＿{2,}|_{3,}/g) || [];
      if (blanks.length && slots.length === blanks.length) {
        let cursor = 0;
        const html = escaped.replace(/＿{2,}|_{3,}/g, () => {
          const index = cursor;
          cursor += 1;
          const value = ui.blankInputs[index] ?? "";
          const cls = ui.blankChecked ? (ui.blankHits[index] ? " is-correct" : " is-wrong") : "";
          return `<span class="blank-slot"><span class="blank-slot__index">${index + 1}</span><input class="blank-input${cls}" type="text" data-blank-index="${index}" value="${escapeHTML(value)}" autocomplete="off" aria-label="第 ${index + 1} 空"${ui.blankChecked ? " disabled" : ""}></span>`;
        });
        return `<h2 class="question-text question-text--blank">${html}</h2>`;
      }
    }
    return `<h2 class="question-text">${escapeHTML(question.question)}</h2>`;
  }

  function blankInputsBelow(question) {
    const blanks = Array.isArray(question.blanks) ? question.blanks : [];
    return `<div class="blank-grid">${blanks.map((_, index) => {
      const value = ui.blankInputs[index] ?? "";
      const cls = ui.blankChecked ? (ui.blankHits[index] ? " is-correct" : " is-wrong") : "";
      return `<label class="blank-field"><span>第 ${index + 1} 空</span><input class="blank-input${cls}" type="text" data-blank-index="${index}" value="${escapeHTML(value)}" autocomplete="off"${ui.blankChecked ? " disabled" : ""}></label>`;
    }).join("")}</div>`;
  }

  // ---------- 答案与解析 ----------

  function renderExplanation(question) {
    const blocks = [];
    if (question.explanation) {
      blocks.push(`<div class="explain-block explain-block--analysis"><div class="explain-block__label">${icon("brain")}解析</div><div class="explain-block__body">${escapeHTML(question.explanation)}</div></div>`);
    }
    if (question.erratum) {
      blocks.push(`<div class="explain-block explain-block--erratum"><div class="explain-block__label">${icon("info")}勘误说明</div><div class="explain-block__body">${escapeHTML(question.erratum)}</div></div>`);
    }
    if (question.correction) {
      // 若本题已有勘误，原卷给出的“改正”可能已作废，收进折叠区避免误导
      blocks.push(question.erratum
        ? `<details class="explain-block explain-block--stale"><summary>${icon("info")}原卷给出的“改正”（勘误后可能不再适用）</summary><div class="explain-block__body">${escapeHTML(question.correction)}</div></details>`
        : `<details class="explain-block"><summary>${icon("info")}改正</summary><div class="explain-block__body">${escapeHTML(question.correction)}</div></details>`);
    }
    return blocks.length ? `<div class="explain-stack">${blocks.join("")}</div>` : "";
  }

  function renderAnswerBody(question) {
    if (question.kind === "choice") {
      const letters = (question.answer || []).join("");
      const texts = (question.answer || []).map(letter => question.options?.find(option => option.label === letter)?.text).filter(Boolean);
      return `<div class="choice-answer"><strong class="choice-answer__letters">${escapeHTML(letters)}</strong><span class="muted">${escapeHTML(texts.join("；"))}</span></div>`;
    }
    if (question.kind === "judge") {
      const letters = (question.answer || []).join("");
      const text = letters === "A" ? "说法正确" : letters === "B" ? "说法错误" : letters;
      return `<div class="choice-answer"><strong class="choice-answer__letters">${escapeHTML(letters)}</strong><span class="muted">${escapeHTML(text)}</span></div>`;
    }
    if (question.kind === "blank") {
      const blanks = Array.isArray(question.blanks) ? question.blanks : [];
      return `<ol class="blank-answer-list">${blanks.map((item, index) => `<li><span>第 ${index + 1} 空</span><strong>${escapeHTML(item)}</strong></li>`).join("")}</ol>`;
    }
    return `<div class="answer-panel__content">${escapeHTML(answerText(question))}</div>`;
  }

  function renderAnswer(question) {
    const alternates = question.alternateAnswers || [];
    return `<div class="answer-panel">
      <div class="answer-panel__label">${icon("check")}参考答案</div>
      ${question.image ? "" : ""}
      ${renderAnswerBody(question)}
      ${alternates.length ? `<details class="alternate-answer"><summary>查看章节题库中的另一种表述</summary>${alternates.map(item => `<div><strong>${escapeHTML(item.sourceFile)}</strong><br>${escapeHTML(item.answer)}</div>`).join("")}</details>` : ""}
      ${renderExplanation(question)}
    </div>`;
  }

  // ---------- 背诵页 ----------

  function renderStudy(mode) {
    if (ui.completed[mode]) return renderStudyCompletion(mode);
    const list = getStudyList(mode);
    const filter = ui.filters[mode];
    if (!list.length) {
      return `<div class="page-stack">${renderStudyToolbar(mode)}<div class="empty-state card"><span class="empty-state__icon">${icon("search")}</span><h2>当前筛选下没有题目</h2><p>可以清除章节、题型、状态或搜索条件。学习进度不会受到影响。</p><button class="button button--primary" data-action="clear-filters" data-mode="${mode}">清除筛选</button></div></div>`;
    }
    const { question, index } = currentStudy(mode, list);
    const memory = Core.getQuestionState(state, question.id);
    const revealed = ui.revealed;
    const positionPercent = Math.round((index + 1) / list.length * 100);
    const dots = Array.from({ length: 5 }, (_, dot) => `<span class="memory-dot${dot < memory.mastery ? " is-filled" : ""}"></span>`).join("");
    const objective = Core.isAutoGraded(question);
    return `<div class="page-stack">
      ${renderStudyToolbar(mode)}
      <div class="study-summary"><span>当前第 <strong>${index + 1}</strong> / ${list.length} 题 · ${filter.order === "sequential" ? "题库顺序" : "记忆优先"}</span><div class="study-summary__bar">${progressBar(positionPercent)}</div><span class="subtle">${positionPercent}%</span></div>
      <div class="study-layout">
        <article class="question-card card" data-question="${question.id}" data-kind="${question.kind}">
          <header class="question-card__header"><div class="question-card__badges"><span class="badge badge--brand">${escapeHTML(chapterName(question, true))}</span><span class="badge badge--type">${escapeHTML(typeLabel(question))}</span>${question.section && question.section !== typeLabel(question) ? `<span class="badge">${escapeHTML(question.section)}</span>` : ""}</div><button class="icon-button${memory.favorite ? " is-active" : ""}" data-action="favorite" aria-label="${memory.favorite ? "取消收藏" : "收藏当前题"}" title="收藏（F）">${icon("star")}</button></header>
          <div class="question-card__body"><span class="question-number">${objective ? "OBJECTIVE" : "RECALL"} · ${String(index + 1).padStart(3, "0")}</span>${renderStem(question, true)}${question.kind === "blank" && !/＿{2,}|_{3,}/.test(question.question) ? blankInputsBelow(question) : ""}<p class="question-source">${escapeHTML(question.sourceFile || ctx.def.full)}${question.sourceNumber ? ` · 原第 ${question.sourceNumber} 题` : ""}${question.sourceRecords ? ` · 已合并 ${question.sourceRecords.length} 个来源` : ""}</p>
            ${renderFigure(question)}
            ${question.table ? renderTable(question.table) : ""}
            ${question.options && question.kind !== "judge" ? `<ul class="option-list">${question.options.map(option => renderStudyOption(question, option, revealed)).join("")}</ul>` : ""}
            ${question.kind === "judge" ? renderJudgeRow(question, revealed) : ""}
            ${revealed ? `${ui.studyGraded ? studyVerdict(question) : ""}${renderAnswer(question)}` : renderGate(question)}
          </div>
          ${revealed ? `<div class="rating-area"><p class="rating-area__prompt">这次回忆得怎么样？诚实评价，复习安排会更准确。</p><div class="rating-grid"><button class="rating-button rating-button--again" data-action="rate" data-rating="again">重来<small>1 · 10 分钟后</small></button><button class="rating-button rating-button--hard" data-action="rate" data-rating="hard">模糊<small>2 · 至少 1 天</small></button><button class="rating-button rating-button--good" data-action="rate" data-rating="good">记住<small>3 · 正常间隔</small></button><button class="rating-button rating-button--easy" data-action="rate" data-rating="easy">熟练<small>4 · 更长间隔</small></button></div></div>` : ""}
          <footer class="question-card__footer"><button class="button button--ghost" data-action="study-prev" data-mode="${mode}"${index === 0 ? " disabled" : ""}>${icon("left")}上一题</button><span class="subtle">${memoryStatus(memory)}</span><button class="button button--ghost" data-action="study-next" data-mode="${mode}"${index === list.length - 1 ? " disabled" : ""}>下一题${icon("right")}</button></footer>
        </article>
        <aside class="memory-panel card"><div><h3>当前记忆强度</h3><div class="memory-level"><strong>${memory.mastery}</strong><span>/ 5 · ${memoryStatus(memory)}</span></div></div><div class="memory-dots" aria-label="记忆强度 ${memory.mastery}/5">${dots}</div><dl class="memory-details"><div><dt>学习次数</dt><dd>${memory.seen} 次</dd></div><div><dt>答对 / 答错</dt><dd>${memory.correct} / ${memory.wrong}</dd></div><div><dt>下次复习</dt><dd>${dueText(memory)}</dd></div><div><dt>遗忘次数</dt><dd>${memory.lapses} 次</dd></div></dl><p class="memory-tip">${memory.seen ? "间隔会随“记住”和“熟练”逐渐拉长；“重来”会尽快再次出现。" : "第一次学习后，系统会记录记忆强度并安排下一次复习。"}</p><div class="memory-panel__side button-row"><button class="button button--small button--ghost" data-action="restart-study" data-mode="${mode}">从本组第一题开始</button></div></aside>
      </div>
    </div>`;
  }

  function renderStudyOption(question, option, revealed) {
    const isCorrect = (question.answer || []).includes(option.label);
    const picked = ui.studySelected.includes(option.label);
    const inner = `<span class="option-letter">${option.label}</span><span>${escapeHTML(option.text)}</span>`;
    if (ui.studyGraded) {
      const cls = isCorrect ? " is-answer" : picked ? " is-wrong-answer" : "";
      return `<li class="option-row${cls}" aria-disabled="true">${inner}${isCorrect ? '<span class="option-flag">正确答案</span>' : picked ? '<span class="option-flag option-flag--wrong">你的选择</span>' : ""}</li>`;
    }
    if (revealed) return `<li class="option-row${isCorrect ? " is-answer" : ""}">${inner}</li>`;
    return `<li><button type="button" class="option-row option-row--pickable${picked ? " is-picked" : ""}" data-action="pick-study" data-option="${option.label}" aria-pressed="${picked}">${inner}</button></li>`;
  }

  function renderJudgeRow(question, revealed) {
    const picked = ui.studySelected[0] || "";
    return `<div class="judge-row">${["A", "B"].map(letter => {
      const isCorrect = (question.answer || []).includes(letter);
      const isPicked = picked === letter;
      const cls = ["judge-button", isPicked ? " is-picked" : "", ui.studyGraded && isCorrect ? " is-answer" : "", ui.studyGraded && isPicked && !isCorrect ? " is-wrong-answer" : ""].join("");
      const label = letter === "A" ? "正确 √" : "错误 ×";
      const disabled = ui.studyGraded || revealed;
      return `<button type="button" class="${cls}" data-action="judge-study" data-option="${letter}"${disabled ? " disabled" : ""}><span class="judge-button__letter">${letter}</span>${label}${ui.studyGraded && isCorrect ? '<span class="option-flag">正确答案</span>' : ""}</button>`;
    }).join("")}</div>`;
  }

  function renderGate(question) {
    if (question.kind === "blank") {
      return `<div class="answer-gate">${icon("choice")}<p>在题干的横线处填入答案后提交，系统逐空判分并给出解析</p><div class="button-row"><button class="button button--primary" data-action="check-blanks">提交答案</button><button class="button button--ghost" data-action="reveal">直接显示答案 <span class="subtle">Space</span></button></div></div>`;
    }
    if (question.kind === "judge") {
      return `<div class="answer-gate">${icon("choice")}<p>判断下列说法是否正确，点击选项后即时给出答案与解析</p><button class="button button--ghost" data-action="reveal">直接显示答案 <span class="subtle">Space</span></button></div>`;
    }
    if (question.kind === "choice") {
      const pickedCount = ui.studySelected.length;
      return `<div class="answer-gate">${icon("choice")}<p>${question.type === "multiple" ? "勾选所有正确选项后提交，漏选、错选均不得分" : "点击选项作答，系统即时判分"}</p><div class="button-row">${question.type === "multiple" ? `<button class="button button--primary" data-action="submit-study-answer"${pickedCount ? "" : " disabled"}>提交答案${pickedCount ? `（已选 ${pickedCount} 项）` : ""}</button>` : ""}<button class="button button--ghost" data-action="reveal">直接显示答案 <span class="subtle">Space</span></button></div></div>`;
    }
    const hint = question.kind === "term" ? "先口头说出定义，再展开标准表述" : question.kind === "analysis" ? "先按“先定区间/条件 → 再读相区或组织 → 最后得结论”的思路作答" : "先口头复述或写下答题要点，再查看答案";
    return `<div class="answer-gate">${icon("book")}<p>${hint}</p><button class="button button--primary" data-action="reveal">显示答案与解析 <span class="subtle">Space</span></button></div>`;
  }

  function studyVerdict(question) {
    let correct = false;
    if (question.kind === "blank") correct = ui.blankHits.length > 0 && ui.blankHits.every(Boolean);
    else correct = Core.gradeAnswer(question, ui.studySelected).correct;
    const detail = question.kind === "blank" && !correct
      ? `答对 ${ui.blankHits.filter(Boolean).length} / ${ui.blankHits.length} 空`
      : `正确答案 ${answerText(question) || (question.answer || []).join("")}`;
    return `<div class="verdict ${correct ? "verdict--correct" : "verdict--wrong"}">${icon(correct ? "check" : "close")}<span>${correct ? "回答正确" : `回答错误 · ${escapeHTML(detail)}`}</span></div>`;
  }

  function resetStudyPick() {
    ui.studySelected = [];
    ui.studyGraded = false;
    ui.blankInputs = [];
    ui.blankHits = [];
    ui.blankChecked = false;
  }

  function currentQuestion(mode) {
    return currentStudy(mode, getStudyList(mode)).question;
  }

  function pickStudy(label) {
    const question = currentQuestion("choice");
    if (!question || ui.studyGraded || ui.revealed) return;
    if (question.type !== "multiple") {
      ui.studySelected = [label];
      gradeStudy();
      return;
    }
    ui.studySelected = ui.studySelected.includes(label) ? ui.studySelected.filter(item => item !== label) : [...ui.studySelected, label].sort();
    render(true);
  }

  function judgeStudy(label) {
    const question = currentQuestion(ui.view);
    if (!question || ui.studyGraded || ui.revealed) return;
    ui.studySelected = [label];
    gradeStudy();
  }

  function gradeStudy() {
    const question = currentQuestion(ui.view);
    if (!question || ui.studyGraded || ui.revealed) return;
    if (!ui.studySelected.length) {
      toast("请先选择至少一个选项");
      return;
    }
    ui.studyGraded = true;
    ui.revealed = true;
    render(true);
    toast(Core.gradeAnswer(question, ui.studySelected).correct ? "回答正确" : "回答错误，请查看解析");
  }

  function checkBlanks() {
    const question = currentQuestion("choice");
    if (!question || question.kind !== "blank" || ui.blankChecked) return;
    const blanks = Array.isArray(question.blanks) ? question.blanks : [];
    if (ui.blankInputs.filter(value => (value || "").trim()).length < blanks.length) {
      toast(`还有 ${blanks.length - ui.blankInputs.filter(value => (value || "").trim()).length} 空未填写`);
      return;
    }
    const result = Core.matchBlank(question, ui.blankInputs);
    ui.blankHits = result.hits;
    ui.blankChecked = true;
    ui.studyGraded = true;
    ui.revealed = true;
    render(true);
    const hits = result.hits.filter(Boolean).length;
    toast(result.correct ? "全部正确" : `答对 ${hits} / ${blanks.length} 空，请查看解析`);
  }

  function renderStudyToolbar(mode) {
    const filter = ui.filters[mode];
    const types = ctx.modeTypes[mode];
    const typeSelect = types.length > 1
      ? `<select class="select" data-filter="type" data-mode="${mode}" aria-label="筛选题型"><option value="all"${filter.type === "all" ? " selected" : ""}>全部题型</option>${types.map(type => `<option value="${type}"${filter.type === type ? " selected" : ""}>${TYPE_LABELS[type] || type}</option>`).join("")}</select>`
      : "";
    return `<div class="study-toolbar card"><div class="field field--search">${icon("search")}<input class="input" type="search" data-search="${mode}" value="${escapeHTML(filter.search)}" placeholder="搜索题干、选项或解析" aria-label="搜索题目"></div><select class="select" data-filter="chapter" data-mode="${mode}" aria-label="筛选章节">${chapterOptions(filter.chapter, mode)}</select>${typeSelect}<select class="select" data-filter="status" data-mode="${mode}" aria-label="筛选学习状态"><option value="all"${filter.status === "all" ? " selected" : ""}>全部题目</option><option value="unseen"${filter.status === "unseen" ? " selected" : ""}>尚未学习</option><option value="due"${filter.status === "due" ? " selected" : ""}>今日到期</option><option value="wrong"${filter.status === "wrong" ? " selected" : ""}>错题重背</option><option value="favorite"${filter.status === "favorite" ? " selected" : ""}>我的收藏</option><option value="mastered"${filter.status === "mastered" ? " selected" : ""}>已经掌握</option></select><select class="select" data-filter="order" data-mode="${mode}" aria-label="题目排序"><option value="sequential"${filter.order === "sequential" ? " selected" : ""}>题库顺序</option><option value="smart"${filter.order === "smart" ? " selected" : ""}>记忆优先</option></select></div>`;
  }

  function renderStudyCompletion(mode) {
    return `<div class="empty-state card"><span class="empty-state__icon">${icon("check")}</span><h2>本组${MODE_LABELS[mode]}已过完一轮</h2><p>每一次自评都已写入记忆计划。可以回到首页查看到期任务，或按相同筛选再复习一轮。</p><div class="button-row"><button class="button button--primary" data-action="restart-study" data-mode="${mode}">再背一轮</button><button class="button button--ghost" data-nav="home">返回首页</button></div></div>`;
  }

  function startStudy(mode, options = {}) {
    ui.filters[mode] = { ...defaultFilters[mode], ...options };
    ui.completed[mode] = false;
    state.positions[mode] = "";
    resetStudyPick();
    saveState();
    navigate(mode);
  }

  function moveStudy(mode, direction) {
    const list = getStudyList(mode);
    const { index } = currentStudy(mode, list);
    const nextIndex = Math.max(0, Math.min(list.length - 1, index + direction));
    if (!list[nextIndex]) return;
    state.positions[mode] = list[nextIndex].id;
    ui.revealed = false;
    resetStudyPick();
    saveState();
    render();
    document.querySelector(".question-card")?.scrollIntoView({ block: "start", behavior: scrollBehavior() });
  }

  function rateCurrent(rating) {
    const mode = ui.view;
    const list = getStudyList(mode);
    const { question, index } = currentStudy(mode, list);
    if (!question || !ui.revealed) return;
    state = Core.reviewQuestion(state, question.id, rating);
    stateCache.set(ui.subjectId, state);
    ui.revealed = false;
    resetStudyPick();
    if (index === list.length - 1) ui.completed[mode] = true;
    else state.positions[mode] = list[index + 1].id;
    saveState();
    render();
    if (!ui.completed[mode]) document.querySelector(".question-card")?.scrollIntoView({ block: "start" });
  }

  function preferredModeForStatus(status) {
    const now = Date.now();
    const matches = ctx.questions.filter(question => {
      const memory = Core.getQuestionState(state, question.id);
      if (status === "due") return memory.seen > 0 && memory.due <= now;
      if (status === "wrong") return memory.wrong > 0;
      if (status === "favorite") return memory.favorite;
      return false;
    });
    return matches.some(question => Core.isAutoGraded(question)) || !matches.length ? "choice" : "subjective";
  }

  // ---------- 盲考 ----------

  function examPool(chapterId) {
    return chapterId && chapterId !== "all"
      ? ctx.objective.filter(question => chapterIdsOf(question).includes(chapterId))
      : ctx.objective;
  }

  function renderExam() {
    if (ui.examResult) return renderExamResult(ui.examResult);
    if (state.activeExam) return renderExamRoom();
    const stats = Core.getStats(state, ctx.questions);
    const selectedCount = state.settings.examCount;
    const customCount = [-1, 10, 20, 50].includes(selectedCount) ? "" : selectedCount;
    const pool = examPool("all");
    const mix = ctx.modeTypes.choice.map(type => `${TYPE_LABELS[type] || type} ${ctx.objective.filter(question => typeOf(question) === type).length}`).join(" · ");
    return `<div class="page-stack">
      <section class="exam-setup card">
        <div class="exam-setup__intro"><span class="eyebrow">BLIND TEST</span><h2>把“看着会”，<br>变成“做得对”。</h2><p>系统按题库中各题型的实际比例自动分配，并优先抽取到期、答错和尚未掌握的题。</p><ul class="exam-rules"><li>${icon("check")}每题作答后立即判分，判分后不可修改</li><li>${icon("check")}多选题需确认答案，漏选、错选均不得分</li><li>${icon("check")}填空题按空逐一比对，忽略空格与全半角差异</li><li>${icon("check")}交卷后查看完整成绩、章节分析与逐题解析</li></ul></div>
        <div class="exam-setup__form">
          <div class="form-group"><label for="exam-chapter">考试范围</label><select id="exam-chapter" class="select">${chapterOptions("all", "choice")}</select><small id="exam-pool-note">全库共 ${pool.length} 道可判分题</small></div>
          <div class="form-group"><span>题目数量</span><div class="choice-chips">${[10, 20, 50, -1].map(count => `<label class="choice-chip"><input type="radio" name="exam-count" value="${count}"${selectedCount === count ? " checked" : ""}><span>${count === -1 ? "全部" : `${count} 题`}</span></label>`).join("")}</div></div>
          <div class="exam-custom-grid">
            <div class="form-group"><label for="exam-count-custom">自定义题数</label><input id="exam-count-custom" class="input" type="number" inputmode="numeric" min="1" max="${pool.length}" step="1" placeholder="1–${pool.length} 题" value="${customCount}"><small>填写后优先于上方预设</small></div>
            <div class="form-group"><label for="exam-minutes">考试时长（分钟）</label><input id="exam-minutes" class="input" type="number" inputmode="numeric" min="0" max="300" step="1" value="${state.settings.examMinutes}" required><small>0 为不限时，最多 300 分钟</small></div>
          </div>
          <div class="form-group"><label for="exam-strategy">组卷方式</label><select id="exam-strategy" class="select"><option value="smart">智能强化（推荐）</option><option value="random">完全随机</option><option value="sequential">题库顺序</option></select><small>智能强化会优先照顾薄弱题，同时保留一定随机性</small></div>
          <div class="exam-note">成绩按答对题数 ÷ 总题数计算。限时考试按真实时间倒计时，刷新不会暂停；时间到自动交卷，未答题按答错计分。当前题型构成：${escapeHTML(mix)}。</div>
          <button class="button button--primary button--large" data-action="start-exam">开始盲考${icon("arrow")}</button>
        </div>
      </section>
      ${state.examHistory.length ? `<section class="panel card"><div class="section-heading"><div><h2>考试记录</h2><p>保留最近 20 场，可回看解析或重考错题</p></div><span class="badge">平均正确率 ${stats.accuracy}%</span></div><ul class="history-list">${state.examHistory.map(renderHistoryItem).join("")}</ul></section>` : `<div class="empty-state card"><span class="empty-state__icon">${icon("exam")}</span><h2>第一场盲考，从现在开始</h2><p>建议先选择 20 题智能强化，交卷后会生成专属错题重考。</p></div>`}
    </div>`;
  }

  function isExamAnswerCorrect(exam, id) {
    const question = ctx.questionMap.get(id);
    return Boolean(exam.graded?.[id]) && Boolean(question) && Core.gradeAnswer(question, exam.answers[id] || []).correct;
  }

  function renderExamOption(question, option, selected, graded) {
    const isAnswer = (question.answer || []).includes(option.label);
    const picked = selected.includes(option.label);
    const inner = `<span class="option-letter">${option.label}</span><span>${escapeHTML(option.text)}</span>`;
    if (graded) {
      const cls = isAnswer ? " is-answer" : picked ? " is-wrong-answer" : "";
      return `<div class="exam-option${cls} is-locked" aria-disabled="true">${inner}${isAnswer ? '<span class="option-flag">正确答案</span>' : picked ? '<span class="option-flag option-flag--wrong">你的选择</span>' : ""}</div>`;
    }
    const inputType = question.type === "multiple" ? "checkbox" : "radio";
    return `<label class="exam-option${picked ? " is-selected" : ""}"><input type="${inputType}" name="answer-${question.id}" data-exam-answer="${question.id}" value="${option.label}"${picked ? " checked" : ""}>${inner}</label>`;
  }

  function renderExamBlanks(question, exam, graded) {
    const blanks = Array.isArray(question.blanks) ? question.blanks : [];
    const given = exam.answers[question.id] || [];
    const hits = graded ? Core.matchBlank(question, given).hits : [];
    return `<div class="blank-grid">${blanks.map((_, index) => {
      const cls = graded ? (hits[index] ? " is-correct" : " is-wrong") : "";
      return `<label class="blank-field"><span>第 ${index + 1} 空</span><input class="blank-input${cls}" type="text" data-exam-blank="${question.id}" data-blank-index="${index}" value="${escapeHTML(given[index] || "")}" autocomplete="off"${graded ? " disabled" : ""}></label>`;
    }).join("")}</div>`;
  }

  function renderExamStem(question, exam, graded) {
    if (question.kind !== "blank") return `<h2 class="question-text">${escapeHTML(question.question)}</h2>`;
    const blanks = Array.isArray(question.blanks) ? question.blanks : [];
    const escaped = escapeHTML(question.question);
    const slots = escaped.match(/＿{2,}|_{3,}/g) || [];
    const given = exam.answers[question.id] || [];
    const hits = graded ? Core.matchBlank(question, given).hits : [];
    if (blanks.length && slots.length === blanks.length) {
      let cursor = 0;
      const html = escaped.replace(/＿{2,}|_{3,}/g, () => {
        const index = cursor;
        cursor += 1;
        const cls = graded ? (hits[index] ? " is-correct" : " is-wrong") : "";
        return `<span class="blank-slot"><span class="blank-slot__index">${index + 1}</span><input class="blank-input${cls}" type="text" data-exam-blank="${question.id}" data-blank-index="${index}" value="${escapeHTML(given[index] || "")}" autocomplete="off" aria-label="第 ${index + 1} 空"${graded ? " disabled" : ""}></span>`;
      });
      return `<h2 class="question-text question-text--blank">${html}</h2>`;
    }
    return `<h2 class="question-text">${escapeHTML(question.question)}</h2>`;
  }

  function renderExamRoom() {
    const exam = state.activeExam;
    const question = ctx.questionMap.get(exam.questionIds[exam.index]);
    if (!question) return '<div class="empty-state card"><h2>考试数据异常</h2><p>请结束本场考试后重新组卷。</p><button class="button button--primary" data-action="abandon-exam">返回考试中心</button></div>';
    const selected = exam.answers[question.id] || [];
    const graded = Boolean(exam.graded?.[question.id]);
    const examCorrect = graded && Core.gradeAnswer(question, selected).correct;
    const answered = exam.questionIds.filter(id => (exam.answers[id] || []).length).length;
    const correctCount = exam.questionIds.filter(id => isExamAnswerCorrect(exam, id)).length;
    const flagged = exam.flagged.includes(question.id);
    const remaining = exam.timeLimit ? Math.max(0, exam.endsAt - Date.now()) : null;
    const timerClass = remaining !== null && remaining <= 60000 ? " timer--danger" : remaining !== null && remaining <= 300000 ? " timer--warning" : "";
    const timerValue = remaining === null ? formatDuration(exam.elapsed / 1000) : formatDuration(Math.ceil(remaining / 1000));
    const isBlank = question.kind === "blank";
    const hasInlineBlanks = isBlank && /＿{2,}|_{3,}/.test(question.question);
    const body = isBlank
      ? `${renderExamStem(question, exam, graded)}${renderFigure(question)}${hasInlineBlanks ? "" : renderExamBlanks(question, exam, graded)}`
      : `${renderStem(question, false)}${renderFigure(question)}${question.table ? renderTable(question.table) : ""}<div class="option-list exam-options">${(question.options || []).map(option => renderExamOption(question, option, selected, graded)).join("")}</div>`;
    const confirmButton = !graded && (question.type === "multiple" || isBlank)
      ? `<div class="exam-confirm"><button class="button button--primary" data-action="confirm-exam-answer">确认答案${question.type === "multiple" ? `（已选 ${selected.length} 项）` : ""}</button><small>确认后立即判分，不可修改</small></div>`
      : "";
    return `<div class="exam-room"><div class="exam-room__main"><div class="exam-status"><div><strong>第 ${exam.index + 1} / ${exam.questionIds.length} 题</strong><div class="study-summary__bar">${progressBar(Math.round(answered / exam.questionIds.length * 100))}</div></div><div class="exam-status__items"><span class="badge">已答 ${answered}</span><span class="badge badge--success">已判对 ${correctCount}</span><span class="badge">标记 ${exam.flagged.length}</span><span class="timer${timerClass}" title="${exam.timeLimit ? "距离自动交卷" : "本场作答用时"}">${icon("clock")}<span id="exam-timer-label">${exam.timeLimit ? "剩余" : "已用"}</span><span id="exam-timer">${timerValue}</span></span><button class="text-button exam-abandon" data-action="abandon-exam" title="放弃本场考试">结束本场</button></div></div>
      <article class="question-card card" data-question="${question.id}" data-kind="${question.kind}"><header class="question-card__header"><div class="question-card__badges"><span class="badge badge--brand">${escapeHTML(chapterName(question, true))}</span><span class="badge badge--type">${escapeHTML(typeLabel(question))}</span></div><button class="icon-button${flagged ? " is-active" : ""}" data-action="exam-flag" aria-label="${flagged ? "取消标记" : "标记本题"}" title="标记本题">${icon("flag")}</button></header>
      <div class="question-card__body"><span class="question-number">${escapeHTML(typeLabel(question)).toUpperCase()} · ${String(exam.index + 1).padStart(3, "0")}</span>${body}${graded ? `<div class="verdict ${examCorrect ? "verdict--correct" : "verdict--wrong"}">${icon(examCorrect ? "check" : "close")}<span>${examCorrect ? "回答正确" : "回答错误"}</span></div>${renderAnswer(question)}` : confirmButton}</div>
      <footer class="question-card__footer"><button class="button button--ghost" data-action="exam-prev">${icon("left")}上一题</button><button class="button button--ghost" data-action="toggle-sheet">${icon("grid")}答题卡</button><button class="button button--ghost" data-action="exam-next">下一题${icon("right")}</button></footer></article></div>
      <aside class="answer-sheet${ui.mobileSheet ? " is-open" : ""} card"><div class="answer-sheet__header"><h3>答题卡</h3><button class="icon-button sheet-close" data-action="toggle-sheet" aria-label="收起答题卡">${icon("close")}</button></div><div class="sheet-grid">${exam.questionIds.map((id, index) => {
        const isCorrect = isExamAnswerCorrect(exam, id);
        const isWrong = Boolean(exam.graded?.[id]) && !isCorrect;
        return `<button class="sheet-number${(exam.answers[id] || []).length ? " is-answered" : ""}${index === exam.index ? " is-current" : ""}${exam.flagged.includes(id) ? " is-flagged" : ""}${isCorrect ? " is-correct" : isWrong ? " is-wrong" : ""}" data-action="exam-jump" data-index="${index}" aria-label="第 ${index + 1} 题${isCorrect ? "，回答正确" : isWrong ? "，回答错误" : (exam.answers[id] || []).length ? "，已答" : "，未答"}">${index + 1}</button>`;
      }).join("")}</div><div class="answer-sheet__legend"><span><i class="legend-dot legend-dot--correct"></i>正确</span><span><i class="legend-dot legend-dot--wrong"></i>错误</span><span><i class="legend-dot legend-dot--answered"></i>已答</span><span><i class="legend-dot"></i>未答</span></div><button class="button button--primary sheet-submit" data-action="submit-exam">交卷并查看成绩</button></aside></div>`;
  }

  function examAnalysis(record) {
    const types = new Map();
    const chapters = new Map();
    record.questionIds.forEach(id => {
      const question = ctx.questionMap.get(id);
      if (!question) return;
      const key = typeOf(question);
      const ok = !record.wrongIds.includes(id);
      const entry = types.get(key) || { label: TYPE_LABELS[key] || key, total: 0, correct: 0 };
      entry.total += 1;
      if (ok) entry.correct += 1;
      types.set(key, entry);
      const chapter = chapters.get(question.chapterId) || { name: chapterName(question), total: 0, correct: 0 };
      chapter.total += 1;
      if (ok) chapter.correct += 1;
      chapters.set(question.chapterId, chapter);
    });
    const typeHTML = [...types.values()].map(value => {
      const percent = Math.round(value.correct / value.total * 100);
      return `<div class="analysis-chip"><span>${escapeHTML(value.label)}</span><strong class="${percent >= 70 ? "text-success" : percent >= 50 ? "" : "text-danger"}">${percent}%</strong><small>${value.correct}/${value.total}</small></div>`;
    }).join("");
    const chapterHTML = [...chapters.entries()].map(([id, value]) => ({ id, ...value, percent: Math.round(value.correct / value.total * 100) })).sort((a, b) => a.percent - b.percent).map(chapter => `
      <div class="analysis-row${chapter.percent < 60 ? " analysis-row--weak" : ""}"><span class="analysis-row__name">${escapeHTML(chapter.name)}</span><div class="analysis-row__bar">${progressBar(chapter.percent)}</div><strong class="${chapter.percent >= 70 ? "text-success" : chapter.percent >= 60 ? "" : "text-danger"}">${chapter.correct}/${chapter.total}</strong></div>`).join("");
    const avgSeconds = record.questionIds.length ? Math.round(record.duration / 1000 / record.questionIds.length) : 0;
    return `<section class="analysis card"><div class="section-heading"><div><h2>成绩分析</h2><p>找出薄弱章节，决定下一步复习重点</p></div><span class="badge">平均每题 ${avgSeconds} 秒</span></div><div class="analysis-chips">${typeHTML}</div><h3>章节正确率（由弱到强）</h3><div class="analysis-rows">${chapterHTML}</div>${record.wrongIds.length ? `<p class="analysis-tip">建议：先重考本章错题，再进入「${escapeHTML([...chapters.entries()].map(([id, value]) => ({ id, ...value, percent: Math.round(value.correct / value.total * 100) })).sort((a, b) => a.percent - b.percent)[0]?.name || "")}」专项背诵。</p>` : '<p class="analysis-tip">全部答对，可以扩大考试范围或提高题量继续挑战。</p>'}</section>`;
  }

  function renderExamResult(record) {
    const unanswered = record.questionIds.filter(id => !(record.answers[id] || []).length).length;
    const message = record.accuracy >= 90 ? "掌握得很扎实，可以挑战更大范围。" : record.accuracy >= 70 ? "整体不错，把错题再巩固一轮会更稳定。" : "已经找到薄弱点，立即重考错题效果最好。";
    return `<div class="page-stack"><section class="result-hero card"><div class="result-score">${record.accuracy}<small>%</small></div><h2>${record.accuracy >= 80 ? "本场发挥出色" : "完成比完美更重要"}</h2><p>${record.timedOut ? "时间到，系统已自动交卷；未作答按答错计分。" : message}</p><div class="button-row"><button class="button button--primary" data-action="retry-wrong" data-exam-id="${escapeHTML(record.id)}"${record.wrongIds.length ? "" : " disabled"}>错题重考（${record.wrongIds.length}）</button><button class="button button--ghost" data-action="toggle-review">${ui.showReview ? "收起解析" : "查看全部解析"}</button><button class="button button--ghost" data-action="copy-result" data-exam-id="${escapeHTML(record.id)}">复制成绩</button><button class="button button--ghost" data-action="export-result" data-exam-id="${escapeHTML(record.id)}">${icon("download")}导出解析</button><button class="button button--ghost" data-action="new-exam">再考一场</button></div></section><section class="result-stats"><div class="result-stat"><strong class="text-success">${record.correct}</strong><span>答对</span></div><div class="result-stat"><strong class="text-danger">${record.wrongIds.length}</strong><span>答错</span></div><div class="result-stat"><strong>${unanswered}</strong><span>未作答</span></div><div class="result-stat"><strong>${formatDuration(record.duration)}</strong><span>用时</span></div></section>${examAnalysis(record)}${ui.showReview ? `<section class="review-list">${record.questionIds.map((id, index) => renderReviewItem(record, id, index)).join("")}</section>` : ""}</div>`;
  }

  function renderReviewItem(record, id, index) {
    const question = ctx.questionMap.get(id);
    if (!question) return "";
    const selected = record.answers[id] || [];
    const correct = !record.wrongIds.includes(id);
    const objective = Core.isAutoGraded(question);
    const mine = question.kind === "blank"
      ? (selected.length ? selected.map((text, i) => `第${i + 1}空：${text || "（未填）"}`).join("；") : "未作答")
      : (selected.join("") || "未作答");
    const right = question.kind === "blank"
      ? (question.blanks || []).map((text, i) => `第${i + 1}空：${text}`).join("；")
      : answerText(question) || (question.answer || []).join("");
    return `<article class="review-item card"><div class="review-item__top"><div class="question-card__badges"><span class="badge">${index + 1}</span><span class="badge badge--brand">${escapeHTML(chapterName(question, true))}</span><span class="badge badge--type">${escapeHTML(typeLabel(question))}</span></div><span class="badge ${correct ? "badge--success" : "badge--multi"}">${correct ? "回答正确" : "需要巩固"}</span></div><h3 class="question-text">${escapeHTML(question.question)}</h3>${renderFigure(question)}${question.table ? renderTable(question.table) : ""}${question.options && question.kind !== "judge" ? `<ul class="option-list">${question.options.map(option => `<li class="option-row${(question.answer || []).includes(option.label) ? " is-answer" : ""}${selected.includes(option.label) && !(question.answer || []).includes(option.label) ? " is-wrong-answer" : ""}"><span class="option-letter">${option.label}</span><span>${escapeHTML(option.text)}</span></li>`).join("")}</ul>` : ""}${question.kind === "judge" ? `<div class="judge-static">参考答案：<strong>${question.answer?.[0] === "A" ? "正确 √" : "错误 ×"}</strong></div>` : ""}<div class="review-answer"><div><span>你的答案</span><strong class="${correct ? "is-correct" : "is-wrong"}">${escapeHTML(mine)}</strong></div><div><span>正确答案</span><strong class="is-correct">${escapeHTML(right)}</strong></div></div>${objective ? "" : ""}${renderExplanation(question)}</article>`;
  }

  function startExam(questionIds = null) {
    const chapterId = document.getElementById("exam-chapter")?.value || "all";
    const strategy = document.getElementById("exam-strategy")?.value || "smart";
    const customCount = document.getElementById("exam-count-custom");
    const minutesInput = document.getElementById("exam-minutes");
    if (customCount?.value && !customCount.checkValidity()) {
      customCount.reportValidity();
      return;
    }
    if (minutesInput && !minutesInput.checkValidity()) {
      minutesInput.reportValidity();
      return;
    }
    const countValue = customCount?.value ? Number(customCount.value) : Number(document.querySelector('input[name="exam-count"]:checked')?.value || 20);
    const minutes = minutesInput ? Number(minutesInput.value) : 0;
    const pool = examPool(chapterId);
    const count = countValue === -1 ? pool.length : Math.min(countValue, pool.length);
    const selected = questionIds ? questionIds.map(id => ctx.questionMap.get(id)).filter(Boolean) : Core.selectExamQuestions(pool, state, count, strategy);
    if (!selected.length) {
      toast("当前范围没有可组卷的题目");
      return;
    }
    const now = Date.now();
    const timeLimit = questionIds ? 0 : minutes * 60000;
    state.activeExam = {
      id: `exam-${now}`,
      questionIds: selected.map(question => question.id),
      index: 0,
      answers: {},
      graded: {},
      flagged: [],
      startedAt: now,
      elapsed: 0,
      timeLimit,
      endsAt: timeLimit ? now + timeLimit : 0,
      strategy,
      chapterId,
    };
    if (!questionIds) {
      if (countValue !== -1) state.settings.examCount = countValue;
      state.settings.examMinutes = minutes;
    }
    ui.examResult = null;
    ui.showReview = false;
    examLastTick = now;
    saveState();
    navigate("exam");
    toast(`已生成 ${selected.length} 题`);
  }

  function syncExamClock() {
    if (!state.activeExam) return;
    const now = Date.now();
    state.activeExam.elapsed += Math.max(0, now - examLastTick);
    examLastTick = now;
  }

  function isExamExpired() {
    return Boolean(state.activeExam?.timeLimit && Date.now() >= state.activeExam.endsAt);
  }

  function updateExamTimer() {
    const exam = state.activeExam;
    const timer = document.getElementById("exam-timer");
    if (!exam || !timer) return;
    const remaining = exam.timeLimit ? Math.max(0, exam.endsAt - Date.now()) : null;
    timer.textContent = remaining === null ? formatDuration(exam.elapsed / 1000) : formatDuration(Math.ceil(remaining / 1000));
    const container = timer.closest(".timer");
    container.classList.toggle("timer--warning", remaining !== null && remaining > 60000 && remaining <= 300000);
    container.classList.toggle("timer--danger", remaining !== null && remaining <= 60000);
  }

  function answerExamLetter(letter) {
    if (!state.activeExam) return;
    const exam = state.activeExam;
    const question = ctx.questionMap.get(exam.questionIds[exam.index]);
    const label = letter.toUpperCase();
    const option = question?.options?.find(item => item.label === label);
    if (!option || exam.graded?.[question.id]) return;
    syncExamClock();
    if (question.type !== "multiple") {
      exam.answers[question.id] = [label];
      exam.graded = { ...(exam.graded || {}), [question.id]: true };
    } else {
      const selected = new Set(exam.answers[question.id] || []);
      if (selected.has(label)) selected.delete(label);
      else selected.add(label);
      exam.answers[question.id] = [...selected].sort();
    }
    saveState();
    render(true);
  }

  function confirmExamAnswer() {
    const exam = state.activeExam;
    if (!exam) return;
    const id = exam.questionIds[exam.index];
    const question = ctx.questionMap.get(id);
    if (!question) return;
    if (question.kind === "blank") {
      const values = [...document.querySelectorAll(`[data-exam-blank="${id}"]`)].map(input => input.value.trim());
      if (values.filter(Boolean).length < (question.blanks || []).length) {
        toast("请填写全部空格后再确认");
        return;
      }
      syncExamClock();
      exam.answers[id] = values;
      exam.graded = { ...(exam.graded || {}), [id]: true };
      saveState();
      render(true);
      return;
    }
    if (!(exam.answers[id] || []).length) {
      toast("请先选择至少一个选项");
      return;
    }
    syncExamClock();
    exam.graded = { ...(exam.graded || {}), [id]: true };
    saveState();
    render(true);
  }

  function moveExam(index) {
    if (!state.activeExam) return;
    if (isExamExpired()) { finalizeExam(true); return; }
    syncExamClock();
    const total = state.activeExam.questionIds.length;
    state.activeExam.index = (index + total) % total;
    ui.mobileSheet = false;
    saveState();
    render();
    document.querySelector(".question-card")?.scrollIntoView({ block: "start" });
  }

  function requestSubmitExam() {
    if (!state.activeExam) return;
    if (isExamExpired()) { finalizeExam(true); return; }
    const unanswered = state.activeExam.questionIds.filter(id => !(state.activeExam.answers[id] || []).length).length;
    openConfirm("确认交卷", unanswered ? `还有 ${unanswered} 道题未作答，未答题将按答错计分。确定现在交卷吗？` : "全部题目均已作答。交卷后会显示成绩与完整解析。", "确认交卷", () => finalizeExam(false), false);
  }

  function finalizeExam(timedOut = false) {
    if (!state.activeExam) return;
    syncExamClock();
    const exam = { ...state.activeExam, timedOut };
    if (timedOut && exam.timeLimit) exam.elapsed = Math.max(exam.elapsed, exam.timeLimit);
    const submitted = Core.submitExam(state, exam, ctx.questionMap);
    state = submitted.state;
    stateCache.set(ui.subjectId, state);
    ui.examResult = submitted.record;
    ui.showReview = false;
    if (confirmDialog.open) confirmDialog.close();
    saveState();
    render();
    window.scrollTo({ top: 0 });
    if (timedOut) toast("考试时间到，已自动交卷");
  }

  function findExamRecord(id) {
    if (ui.examResult?.id === id) return ui.examResult;
    return state.examHistory.find(record => record.id === id);
  }

  function retryWrong(id) {
    const record = findExamRecord(id);
    if (!record?.wrongIds.length) {
      toast("本场没有错题，全部答对");
      return;
    }
    if (state.activeExam) {
      openConfirm("替换未交卷考试", "当前还有一场未交卷考试。开始错题重考会替换本场题目与答案，且无法恢复。", "开始错题重考", () => startExam(record.wrongIds));
    } else startExam(record.wrongIds);
  }

  function updateExamPoolNote() {
    const select = document.getElementById("exam-chapter");
    const note = document.getElementById("exam-pool-note");
    if (select && note) note.textContent = `当前范围共 ${examPool(select.value).length} 道可判分题；超过范围数量的设置会自动取全部题目`;
  }

  function openSettings() {
    document.getElementById("daily-goal").value = state.settings.dailyGoal;
    document.querySelectorAll("[data-font]").forEach(button => button.classList.toggle("is-active", button.dataset.font === state.settings.fontSize));
    settingsDialog.showModal();
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function examResultSummary(record) {
    return `${ctx.def.full}盲考成绩：${record.accuracy}%（答对 ${record.correct}/${record.questionIds.length}）· 用时 ${formatDuration(record.duration)}${record.timedOut ? " · 时间到自动交卷" : ""}`;
  }

  function copyExamResult(record) {
    navigator.clipboard.writeText(examResultSummary(record)).then(() => toast("成绩摘要已复制")).catch(() => toast("复制失败，请手动复制"));
  }

  function downloadExamResult(record) {
    const rows = [["序号", "题型", "章节", "题干", "你的答案", "正确答案", "判定", "解析"]];
    record.questionIds.forEach((id, index) => {
      const question = ctx.questionMap.get(id);
      if (!question) return;
      const selected = record.answers[id] || [];
      rows.push([
        index + 1,
        typeLabel(question),
        chapterName(question),
        question.question,
        question.kind === "blank" ? selected.join(" / ") || "未作答" : selected.join("") || "未作答",
        question.kind === "blank" ? (question.blanks || []).join(" / ") : answerText(question) || (question.answer || []).join(""),
        record.wrongIds.includes(id) ? "需要巩固" : "回答正确",
        question.explanation || "",
      ]);
    });
    const csv = `\ufeff${rows.map(row => row.map(csvCell).join(",")).join("\r\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${ctx.def.short}盲考解析-${record.id}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("解析已导出为 CSV");
  }

  function exportData() {
    const payload = { app: "memory-cabin", version: 2, subject: ui.subjectId, exportedAt: new Date().toISOString(), state };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${ctx.def.short}记忆舱备份-${Core.dateKey()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("学习数据已导出");
  }

  async function importData(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast("备份文件过大，请选择本题库导出的 JSON 文件");
      return;
    }
    try {
      const parsed = JSON.parse(await file.text());
      const imported = Core.normalizeState(parsed.state || parsed, ctx.validIds);
      openConfirm("导入学习备份", "导入会覆盖当前学科的进度、收藏和考试记录，且无法撤销。建议先导出当前数据。", "确认导入", () => {
        state = imported;
        stateCache.set(ui.subjectId, state);
        applyPreferences();
        saveState();
        ui.examResult = null;
        render();
        toast("备份已导入，学习进度已恢复");
      });
    } catch {
      toast("无法读取备份，请选择有效的 JSON 备份文件");
    } finally {
      importFile.value = "";
    }
  }

  function switchSubject(id) {
    if (!subjects.some(item => item.id === id) || id === ui.subjectId) return;
    syncExamClock();
    saveState();
    ui.subjectId = id;
    ui.examResult = null;
    ui.showReview = false;
    ui.completed = { choice: false, subjective: false };
    ui.filters = JSON.parse(JSON.stringify(defaultFilters));
    resetStudyPick();
    rebuildContext();
    applyPreferences();
    saveState();
    navigate("home");
    toast(`已切换到「${ctx.def.full}」题库，进度独立保存`);
  }

  function openImage(src) {
    const image = document.getElementById("image-preview");
    if (!image || !imageDialog) return;
    image.src = src;
    if (!imageDialog.open) imageDialog.showModal();
  }

  document.addEventListener("click", event => {
    const nav = event.target.closest("[data-nav]");
    if (nav) {
      ui.examResult = null;
      navigate(nav.dataset.nav);
      return;
    }
    const close = event.target.closest("[data-close-dialog]");
    if (close) {
      close.closest("dialog").close();
      return;
    }
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === "switch-subject") switchSubject(button.dataset.subject);
    else if (action === "zoom-image") openImage(button.getAttribute("src"));
    else if (action === "continue-learning") {
      if (state.activeExam) { ui.examResult = null; navigate("exam"); }
      else if (Core.getStats(state, ctx.questions).due) {
        const mode = preferredModeForStatus("due");
        startStudy(mode, { status: "due", order: "smart" });
      } else if (state.positions.choice || state.positions.subjective) {
        navigate(state.positions.choice ? "choice" : "subjective");
      } else startStudy("choice");
    } else if (action === "start-study") startStudy(button.dataset.mode);
    else if (action === "quick-review") {
      const mode = preferredModeForStatus(button.dataset.status);
      startStudy(mode, { status: button.dataset.status, order: button.dataset.status === "due" ? "smart" : "sequential" });
    }
    else if (action === "open-chapter") startStudy("choice", { chapter: button.dataset.chapter });
    else if (action === "reveal") { ui.revealed = true; if (currentQuestion(ui.view)?.kind === "blank") ui.blankChecked = true; render(true); }
    else if (action === "pick-study") pickStudy(button.dataset.option);
    else if (action === "judge-study") judgeStudy(button.dataset.option);
    else if (action === "submit-study-answer") gradeStudy();
    else if (action === "check-blanks") checkBlanks();
    else if (action === "rate") rateCurrent(button.dataset.rating);
    else if (action === "study-prev") moveStudy(button.dataset.mode, -1);
    else if (action === "study-next") moveStudy(button.dataset.mode, 1);
    else if (action === "favorite") {
      const list = getStudyList(ui.view);
      const { question } = currentStudy(ui.view, list);
      state = Core.toggleFavorite(state, question.id);
      stateCache.set(ui.subjectId, state);
      saveState();
      render(true);
      toast(Core.getQuestionState(state, question.id).favorite ? "已加入收藏" : "已取消收藏");
    } else if (action === "clear-filters") startStudy(button.dataset.mode);
    else if (action === "restart-study") startStudy(button.dataset.mode, ui.filters[button.dataset.mode]);
    else if (action === "start-exam") startExam();
    else if (action === "exam-prev") moveExam(state.activeExam.index - 1);
    else if (action === "exam-next") moveExam(state.activeExam.index + 1);
    else if (action === "exam-jump") moveExam(Number(button.dataset.index));
    else if (action === "exam-flag") {
      syncExamClock();
      const exam = state.activeExam;
      const id = exam.questionIds[exam.index];
      exam.flagged = exam.flagged.includes(id) ? exam.flagged.filter(item => item !== id) : [...exam.flagged, id];
      saveState();
      render(true);
    } else if (action === "confirm-exam-answer") confirmExamAnswer();
    else if (action === "toggle-sheet") { ui.mobileSheet = !ui.mobileSheet; render(true); }
    else if (action === "submit-exam") requestSubmitExam();
    else if (action === "abandon-exam") openConfirm("结束本场考试", "结束后，本场未交卷作答不会计入成绩，但已记录的以往学习进度不受影响。", "结束考试", () => { state.activeExam = null; ui.examResult = null; saveState(); navigate("exam"); });
    else if (action === "retry-wrong") retryWrong(button.dataset.examId);
    else if (action === "view-result") { ui.examResult = findExamRecord(button.dataset.examId); ui.showReview = true; navigate("exam"); }
    else if (action === "toggle-review") { ui.showReview = !ui.showReview; render(); window.scrollTo({ top: 0 }); }
    else if (action === "copy-result") copyExamResult(findExamRecord(button.dataset.examId));
    else if (action === "export-result") downloadExamResult(findExamRecord(button.dataset.examId));
    else if (action === "new-exam") { ui.examResult = null; ui.showReview = false; navigate("exam"); }
    else if (action === "toggle-theme") {
      state.settings.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      applyPreferences();
      saveState();
      updateChrome();
    } else if (action === "open-settings") openSettings();
    else if (action === "open-help") { settingsDialog.close(); helpDialog.showModal(); }
    else if (action === "export-data") exportData();
    else if (action === "import-data") importFile.click();
    else if (action === "reset-data") {
      settingsDialog.close();
      openConfirm("清空当前学科进度", "将永久删除本学科在本机的记忆进度、收藏、每日记录和考试历史。另一个题库不受影响，此操作无法撤销。", "全部清空", () => {
        state = Core.createDefaultState();
        stateCache.set(ui.subjectId, state);
        applyPreferences();
        saveState();
        ui.examResult = null;
        resetStudyPick();
        navigate("home");
        toast("本机学习数据已清空");
      });
    }
  });

  document.addEventListener("change", event => {
    const filter = event.target.closest("[data-filter]");
    if (filter) {
      const mode = filter.dataset.mode;
      ui.filters[mode][filter.dataset.filter] = filter.value;
      state.positions[mode] = "";
      ui.revealed = false;
      resetStudyPick();
      ui.completed[mode] = false;
      saveState();
      render();
      return;
    }
    if (event.target.id === "exam-count-custom" && event.target.value) {
      document.querySelectorAll('input[name="exam-count"]').forEach(input => { input.checked = false; });
    }
    if (event.target.name === "exam-count") {
      const customCount = document.getElementById("exam-count-custom");
      if (customCount) customCount.value = "";
    }
    const answer = event.target.closest("[data-exam-answer]");
    if (answer && state.activeExam) {
      if (isExamExpired()) { finalizeExam(true); return; }
      syncExamClock();
      const id = answer.dataset.examAnswer;
      const question = ctx.questionMap.get(id);
      if (state.activeExam.graded?.[id]) { render(true); return; }
      if (question.type !== "multiple") {
        state.activeExam.answers[id] = [answer.value];
        state.activeExam.graded = { ...(state.activeExam.graded || {}), [id]: true };
      } else {
        const selected = new Set(state.activeExam.answers[id] || []);
        if (answer.checked) selected.add(answer.value);
        else selected.delete(answer.value);
        state.activeExam.answers[id] = [...selected].sort();
      }
      saveState();
      render(true);
      return;
    }
    if (event.target.id === "exam-chapter") updateExamPoolNote();
    if (event.target.id === "daily-goal") {
      state.settings.dailyGoal = Math.max(5, Math.min(200, Number(event.target.value) || 20));
      event.target.value = state.settings.dailyGoal;
      saveState();
      render(true);
      toast("每日目标已更新");
    }
  });

  document.addEventListener("input", event => {
    const blank = event.target.closest("[data-blank-index]");
    if (blank && !blank.dataset.examBlank) {
      ui.blankInputs[Number(blank.dataset.blankIndex)] = blank.value;
      return;
    }
    const search = event.target.closest("[data-search]");
    if (!search || searchComposing || event.isComposing) return;
    const mode = search.dataset.search;
    if (ui.filters[mode].search === search.value) return;
    ui.filters[mode].search = search.value;
    state.positions[mode] = "";
    ui.revealed = false;
    ui.completed[mode] = false;
    const caret = search.selectionStart;
    render();
    const replacement = document.querySelector(`[data-search="${mode}"]`);
    replacement?.focus();
    replacement?.setSelectionRange(caret, caret);
  });

  document.addEventListener("compositionstart", event => {
    if (event.target.closest("[data-search]")) searchComposing = true;
  });
  document.addEventListener("compositionend", event => {
    if (!event.target.closest("[data-search]")) return;
    searchComposing = false;
    event.target.dispatchEvent(new Event("input", { bubbles: true }));
  });

  document.querySelectorAll("[data-font]").forEach(button => button.addEventListener("click", () => {
    state.settings.fontSize = button.dataset.font;
    applyPreferences();
    saveState();
    document.querySelectorAll("[data-font]").forEach(item => item.classList.toggle("is-active", item === button));
    render(true);
  }));

  importFile.addEventListener("change", () => importData(importFile.files[0]));
  confirmDialog.addEventListener("close", () => {
    const callback = confirmDialog.returnValue === "confirm" ? confirmCallback : null;
    confirmCallback = null;
    if (callback) callback();
  });
  [settingsDialog, helpDialog, confirmDialog, imageDialog].filter(Boolean).forEach(dialog => dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }));

  document.addEventListener("keydown", event => {
    if (document.querySelector("dialog[open]") || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.toLowerCase() === "f" && (ui.view === "choice" || ui.view === "subjective")) {
      event.preventDefault();
      document.querySelector('[data-action="favorite"]')?.click();
    }
    if (ui.view === "choice" || ui.view === "subjective") {
      if (event.code === "Space") { event.preventDefault(); if (!ui.revealed) document.querySelector('[data-action="reveal"]')?.click(); }
      if (ui.revealed && ["1", "2", "3", "4"].includes(event.key)) rateCurrent(["again", "hard", "good", "easy"][Number(event.key) - 1]);
      if (event.key === "ArrowLeft") moveStudy(ui.view, -1);
      if (event.key === "ArrowRight") moveStudy(ui.view, 1);
    } else if (ui.view === "exam" && state.activeExam && !ui.examResult) {
      if (/^[a-h]$/i.test(event.key)) { event.preventDefault(); answerExamLetter(event.key); }
      if (event.key === "Enter") {
        event.preventDefault();
        const question = ctx.questionMap.get(state.activeExam.questionIds[state.activeExam.index]);
        if ((question?.type === "multiple" || question?.kind === "blank") && !state.activeExam.graded?.[question.id]) document.querySelector('[data-action="confirm-exam-answer"]')?.click();
        else moveExam(state.activeExam.index + 1);
      }
      if (event.key === "Backspace") { event.preventDefault(); moveExam(state.activeExam.index - 1); }
      if (event.key.toLowerCase() === "f") document.querySelector('[data-action="exam-flag"]')?.click();
    }
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (state.settings.theme === "system") { applyPreferences(); updateChrome(); }
  });
  window.addEventListener("beforeunload", () => { syncExamClock(); saveState(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { syncExamClock(); saveState(); }
    else if (isExamExpired()) finalizeExam(true);
    else examLastTick = Date.now();
  });
  window.setInterval(() => {
    if (!state.activeExam) return;
    if (isExamExpired()) { finalizeExam(true); return; }
    syncExamClock();
    updateExamTimer();
    if (Math.floor(state.activeExam.elapsed / 1000) % 15 === 0) saveState();
  }, 1000);

  applyPreferences();
  render();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
