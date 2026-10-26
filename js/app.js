(function () {
  "use strict";

  const bank = window.QUESTION_BANK;
  const Core = window.MemoryCore;
  const app = document.getElementById("app");
  if (!bank || !Core) {
    app.innerHTML = '<div class="empty-state card"><h2>题库载入失败</h2><p>请确认 data/questions.js 与 js/core.js 文件完整，然后刷新页面。</p></div>';
    return;
  }

  const questions = bank.questions;
  const questionMap = new Map(questions.map(question => [question.id, question]));
  const chapterMap = new Map(bank.chapters.map(chapter => [chapter.id, chapter]));
  const validIds = new Set(questions.map(question => question.id));
  const choiceQuestions = questions.filter(question => question.kind === "choice");
  const subjectiveQuestions = questions.filter(question => question.kind === "subjective");
  const headerTitle = document.getElementById("header-title");
  const headerSubtitle = document.getElementById("header-subtitle");
  const todayChip = document.getElementById("today-chip");
  const settingsDialog = document.getElementById("settings-dialog");
  const helpDialog = document.getElementById("help-dialog");
  const confirmDialog = document.getElementById("confirm-dialog");
  const importFile = document.getElementById("import-file");
  const titles = {
    home: ["学习首页", "把每一道题，变成长期记忆"],
    choice: ["选择题背诵", "按题库顺序学习，用记忆反馈安排复习"],
    subjective: ["主观题背诵", "先回忆答题框架，再核对完整表述"],
    exam: ["选择题盲考", "单选与多选智能组卷，交卷前不显示答案"],
  };
  const defaultFilters = {
    choice: { chapter: "all", type: "all", status: "all", search: "", order: "sequential" },
    subjective: { chapter: "all", status: "all", search: "", order: "sequential" },
  };
  const ui = {
    view: "home",
    revealed: false,
    completed: { choice: false, subjective: false },
    filters: JSON.parse(JSON.stringify(defaultFilters)),
    examResult: null,
    showReview: false,
    mobileSheet: false,
  };
  let storageWarningShown = false;
  let confirmCallback = null;
  let searchComposing = false;
  let examLastTick = Date.now();
  let state;

  try {
    state = Core.normalizeState(JSON.parse(localStorage.getItem(Core.STORAGE_KEY) || "null"), validIds);
  } catch {
    state = Core.createDefaultState();
  }

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
      localStorage.setItem(Core.STORAGE_KEY, JSON.stringify(state));
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
    document.querySelector('meta[name="theme-color"]').content = dark ? "#111713" : "#174d40";
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

  function chapterName(question, short = false) {
    const chapter = chapterMap.get(question.chapterId);
    if (!chapter) return "未知章节";
    return short ? chapter.shortTitle : `${chapter.shortTitle} · ${chapter.title}`;
  }

  function chapterOptions(selected, includeFocus = false) {
    const chapters = bank.chapters.filter(chapter => includeFocus || chapter.id !== "focus");
    return `<option value="all"${selected === "all" ? " selected" : ""}>全部章节</option>${chapters.map(chapter => {
      const count = includeFocus ? bank.summary[chapter.id].subjective : bank.summary[chapter.id].single + bank.summary[chapter.id].multiple;
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

  function getStudyList(mode) {
    const filter = ui.filters[mode];
    const source = mode === "choice" ? choiceQuestions : subjectiveQuestions;
    const query = filter.search.trim().toLowerCase();
    const now = Date.now();
    const list = source.filter(question => {
      if (filter.chapter !== "all" && !question.chapterIds.includes(filter.chapter)) return false;
      if (mode === "choice" && filter.type !== "all" && question.type !== filter.type) return false;
      const memory = Core.getQuestionState(state, question.id);
      if (filter.status === "unseen" && memory.seen) return false;
      if (filter.status === "due" && (!memory.seen || memory.due > now)) return false;
      if (filter.status === "wrong" && !memory.wrong) return false;
      if (filter.status === "favorite" && !memory.favorite) return false;
      if (filter.status === "mastered" && memory.mastery < 4) return false;
      if (query) {
        const options = question.options ? question.options.map(option => option.text).join(" ") : "";
        const haystack = `${question.question} ${options} ${question.kind === "subjective" ? question.answer : ""}`.toLowerCase();
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
        return leftDue - rightDue || left.mastery - right.mastery || left.seen - right.seen || a.order - b.order;
      });
    }
    return list.sort((a, b) => a.order - b.order);
  }

  function currentStudy(mode, list) {
    const savedId = state.positions[mode];
    const index = Math.max(0, list.findIndex(question => question.id === savedId));
    return { question: list[index], index };
  }

  function updateChrome() {
    const [title, subtitle] = titles[ui.view];
    headerTitle.textContent = title;
    headerSubtitle.textContent = subtitle;
    document.title = `${title} · 马原记忆舱`;
    document.querySelectorAll("[data-nav]").forEach(button => button.classList.toggle("is-active", button.dataset.nav === ui.view));
    const stats = Core.getStats(state, questions);
    todayChip.textContent = `今日 ${stats.reviewsToday} 次记忆`;
    const dark = document.documentElement.dataset.theme === "dark";
    const themeButton = document.querySelector('[data-action="toggle-theme"]');
    themeButton.innerHTML = icon(dark ? "sun" : "moon");
    themeButton.setAttribute("aria-label", dark ? "切换为浅色主题" : "切换为深色主题");
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

  function renderHome() {
    const stats = Core.getStats(state, questions);
    const goalProgress = Math.min(100, Math.round(stats.reviewsToday / state.settings.dailyGoal * 100));
    const continueLabel = state.activeExam ? "继续未交卷考试" : stats.due ? `复习今日 ${stats.due} 道到期题` : state.positions.choice || state.positions.subjective ? "继续上次背诵" : "开始第一轮背诵";
    const recent = state.examHistory.slice(0, 3);
    const chapterRows = bank.chapters.filter(chapter => chapter.id !== "focus").map(chapter => {
      const items = questions.filter(question => question.chapterIds.includes(chapter.id));
      const seen = items.filter(question => Core.getQuestionState(state, question.id).seen).length;
      const percent = items.length ? Math.round(seen / items.length * 100) : 0;
      return `<li class="chapter-row"><button class="chapter-row__name text-button" data-action="open-chapter" data-chapter="${chapter.id}">${escapeHTML(chapter.shortTitle)} · ${escapeHTML(chapter.title)}</button>${progressBar(percent)}<span class="chapter-row__count">${seen}/${items.length}</span></li>`;
    }).join("");
    return `<div class="page-stack">
      <section class="hero">
        <div class="hero__copy">
          <span class="eyebrow">MARXISM STUDY SPACE</span>
          <h2>不是多看一遍，<br>而是真正记住。</h2>
          <p>421 道选择题与 23 道主观题，结合间隔复习、弱点组卷和错题重考，让每一次练习都有方向。</p>
          <button class="button button--primary button--large" data-action="continue-learning">${continueLabel}${icon("arrow")}</button>
        </div>
        <div class="hero__progress">
          <div class="progress-ring" style="--progress:${stats.masteryProgress}"><span class="progress-ring__value">${stats.masteryProgress}<small>%</small></span></div>
          <p>全库掌握度<br><strong>${stats.mastered} / ${questions.length} 题</strong></p>
          <div class="daily-goal"><div class="daily-goal__label"><span>今日目标</span><span>${stats.reviewsToday}/${state.settings.dailyGoal}</span></div>${progressBar(goalProgress)}</div>
        </div>
      </section>
      <section class="mode-grid" aria-label="三种学习模式">
        <button class="mode-card card" data-action="start-study" data-mode="choice"><span class="mode-card__icon">${icon("choice")}</span><h3>选择题背诵</h3><p>题库顺序学习，答案先隐藏。覆盖单选与多选，支持章节、错题和收藏筛选。</p><span class="mode-card__meta"><span>${bank.meta.single} 单选 · ${bank.meta.multiple} 多选</span>${icon("arrow")}</span></button>
        <button class="mode-card card" data-action="start-study" data-mode="subjective"><span class="mode-card__icon">${icon("book")}</span><h3>主观题背诵</h3><p>先构建答题框架，再展开完整答案。四档记忆反馈，逐步攻克长篇表述。</p><span class="mode-card__meta"><span>${bank.meta.subjective} 道重点主观题</span>${icon("arrow")}</span></button>
        <button class="mode-card card" data-nav="exam"><span class="mode-card__icon">${icon("exam")}</span><h3>选择题盲考</h3><p>智能分配单选、多选比例，优先薄弱与到期题。交卷后统一评分和解析。</p><span class="mode-card__meta"><span>${state.activeExam ? "有 1 场考试待继续" : "智能组卷 · 自动判分"}</span>${icon("arrow")}</span></button>
      </section>
      <section class="stat-grid" aria-label="学习统计">
        <button class="stat-card card stat-card--link" data-action="quick-review" data-status="due" aria-label="复习今日到期题目"><span class="stat-card__label">今日到期${icon("clock")}</span><strong class="stat-card__value">${stats.due}</strong><span class="stat-card__note">点击立即复习</span></button>
        <div class="stat-card card"><span class="stat-card__label">连续学习${icon("brain")}</span><strong class="stat-card__value">${stats.streak}<small> 天</small></strong><span class="stat-card__note">今日已记忆 ${stats.reviewsToday} 题次</span></div>
        <button class="stat-card card stat-card--link" data-action="quick-review" data-status="wrong" aria-label="进入错题本"><span class="stat-card__label">错题本${icon("close")}</span><strong class="stat-card__value">${stats.wrong}</strong><span class="stat-card__note">点击进入错题重背</span></button>
        <div class="stat-card card"><span class="stat-card__label">盲考正确率${icon("exam")}</span><strong class="stat-card__value">${stats.accuracy}<small>%</small></strong><span class="stat-card__note">已完成 ${stats.exams} 场考试</span></div>
      </section>
      <section class="dashboard-grid">
        <div class="panel card"><div class="section-heading"><div><h2>章节学习进度</h2><p>选择题与关联主观题合并统计</p></div><span class="badge">已学 ${stats.seen} 题</span></div><ul class="chapter-list">${chapterRows}</ul></div>
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

  function renderHistoryItem(record) {
    return `<li class="history-item"><button class="text-button" data-action="view-result" data-exam-id="${escapeHTML(record.id)}">${record.questionIds.length} 题盲考 · ${formatDate(record.date)}${record.timedOut ? " · 时间到" : ""}</button><strong class="history-item__score">${record.accuracy}<small>%</small></strong><span class="history-item__meta">答对 ${record.correct} 题 · 用时 ${formatDuration(record.duration)}</span></li>`;
  }

  function renderStudy(mode) {
    if (ui.completed[mode]) return renderStudyCompletion(mode);
    const list = getStudyList(mode);
    const filter = ui.filters[mode];
    const label = mode === "choice" ? "选择题" : "主观题";
    if (!list.length) {
      return `<div class="page-stack">${renderStudyToolbar(mode)}<div class="empty-state card"><span class="empty-state__icon">${icon("search")}</span><h2>当前筛选下没有${label}</h2><p>可以清除章节、状态或搜索条件。学习进度不会受到影响。</p><button class="button button--primary" data-action="clear-filters" data-mode="${mode}">清除筛选</button></div></div>`;
    }
    const { question, index } = currentStudy(mode, list);
    const memory = Core.getQuestionState(state, question.id);
    const revealed = ui.revealed;
    const positionPercent = Math.round((index + 1) / list.length * 100);
    const dots = Array.from({ length: 5 }, (_, dot) => `<span class="memory-dot${dot < memory.mastery ? " is-filled" : ""}"></span>`).join("");
    return `<div class="page-stack">
      ${renderStudyToolbar(mode)}
      <div class="study-summary"><span>当前第 <strong>${index + 1}</strong> / ${list.length} 题 · ${filter.order === "sequential" ? "题库顺序" : "记忆优先"}</span><div class="study-summary__bar">${progressBar(positionPercent)}</div><span class="subtle">${positionPercent}%</span></div>
      <div class="study-layout">
        <article class="question-card card">
          <header class="question-card__header"><div class="question-card__badges"><span class="badge badge--brand">${escapeHTML(chapterName(question, true))}</span>${question.type === "single" ? '<span class="badge">单选题</span>' : question.type === "multiple" ? '<span class="badge badge--multi">多选题</span>' : '<span class="badge badge--multi">主观题</span>'}<span class="badge">${escapeHTML(question.section)}</span></div><button class="icon-button${memory.favorite ? " is-active" : ""}" data-action="favorite" aria-label="${memory.favorite ? "取消收藏" : "收藏当前题"}" title="收藏（F）">${icon("star")}</button></header>
          <div class="question-card__body"><span class="question-number">${mode === "choice" ? "CHOICE" : "ESSAY"} · ${String(index + 1).padStart(3, "0")}</span><h2 class="question-text">${escapeHTML(question.question)}</h2><p class="question-source">${escapeHTML(question.sourceFile)} · 原第 ${question.sourceNumber} 题${question.sourceRecords ? ` · 已合并 ${question.sourceRecords.length} 个来源` : ""}</p>
            ${question.options ? `<ul class="option-list">${question.options.map(option => `<li class="option-row${revealed && question.answer.includes(option.label) ? " is-answer" : ""}"><span class="option-letter">${option.label}</span><span>${escapeHTML(option.text)}</span></li>`).join("")}</ul>` : ""}
            ${revealed ? renderAnswer(question) : `<div class="answer-gate">${icon(mode === "choice" ? "choice" : "book")}<p>${mode === "choice" ? "先在心里确定选项，再核对答案" : "先口头复述或写下答题要点，再查看答案"}</p><button class="button button--primary" data-action="reveal">显示答案 <span class="subtle">Space</span></button></div>`}
          </div>
          ${revealed ? `<div class="rating-area"><p class="rating-area__prompt">这次回忆得怎么样？诚实评价，复习安排会更准确。</p><div class="rating-grid"><button class="rating-button rating-button--again" data-action="rate" data-rating="again">重来<small>1 · 10 分钟后</small></button><button class="rating-button rating-button--hard" data-action="rate" data-rating="hard">模糊<small>2 · 至少 1 天</small></button><button class="rating-button rating-button--good" data-action="rate" data-rating="good">记住<small>3 · 正常间隔</small></button><button class="rating-button rating-button--easy" data-action="rate" data-rating="easy">熟练<small>4 · 更长间隔</small></button></div></div>` : ""}
          <footer class="question-card__footer"><button class="button button--ghost" data-action="study-prev" data-mode="${mode}"${index === 0 ? " disabled" : ""}>${icon("left")}上一题</button><span class="subtle">${memoryStatus(memory)}</span><button class="button button--ghost" data-action="study-next" data-mode="${mode}"${index === list.length - 1 ? " disabled" : ""}>下一题${icon("right")}</button></footer>
        </article>
        <aside class="memory-panel card"><div><h3>当前记忆强度</h3><div class="memory-level"><strong>${memory.mastery}</strong><span>/ 5 · ${memoryStatus(memory)}</span></div></div><div class="memory-dots" aria-label="记忆强度 ${memory.mastery}/5">${dots}</div><dl class="memory-details"><div><dt>学习次数</dt><dd>${memory.seen} 次</dd></div><div><dt>答对 / 答错</dt><dd>${memory.correct} / ${memory.wrong}</dd></div><div><dt>下次复习</dt><dd>${dueText(memory)}</dd></div><div><dt>遗忘次数</dt><dd>${memory.lapses} 次</dd></div></dl><p class="memory-tip">${memory.seen ? "间隔会随“记住”和“熟练”逐渐拉长；“重来”会尽快再次出现。" : "第一次学习后，系统会记录记忆强度并安排下一次复习。"}</p><div class="memory-panel__side button-row"><button class="button button--small button--ghost" data-action="restart-study" data-mode="${mode}">从本组第一题开始</button></div></aside>
      </div>
    </div>`;
  }

  function renderStudyToolbar(mode) {
    const filter = ui.filters[mode];
    return `<div class="study-toolbar card"><div class="field field--search">${icon("search")}<input class="input" type="search" data-search="${mode}" value="${escapeHTML(filter.search)}" placeholder="搜索题干${mode === "subjective" ? "或答案" : "、选项"}" aria-label="搜索${mode === "choice" ? "选择题" : "主观题"}"></div><select class="select" data-filter="chapter" data-mode="${mode}" aria-label="筛选章节">${chapterOptions(filter.chapter, mode === "subjective")}</select>${mode === "choice" ? `<select class="select" data-filter="type" data-mode="${mode}" aria-label="筛选题型"><option value="all"${filter.type === "all" ? " selected" : ""}>全部题型</option><option value="single"${filter.type === "single" ? " selected" : ""}>仅单选题</option><option value="multiple"${filter.type === "multiple" ? " selected" : ""}>仅多选题</option></select>` : ""}<select class="select" data-filter="status" data-mode="${mode}" aria-label="筛选学习状态"><option value="all"${filter.status === "all" ? " selected" : ""}>全部题目</option><option value="unseen"${filter.status === "unseen" ? " selected" : ""}>尚未学习</option><option value="due"${filter.status === "due" ? " selected" : ""}>今日到期</option><option value="wrong"${filter.status === "wrong" ? " selected" : ""}>错题重背</option><option value="favorite"${filter.status === "favorite" ? " selected" : ""}>我的收藏</option><option value="mastered"${filter.status === "mastered" ? " selected" : ""}>已经掌握</option></select><select class="select" data-filter="order" data-mode="${mode}" aria-label="题目排序"><option value="sequential"${filter.order === "sequential" ? " selected" : ""}>题库顺序</option><option value="smart"${filter.order === "smart" ? " selected" : ""}>记忆优先</option></select></div>`;
  }

  function renderAnswer(question) {
    if (question.kind === "choice") {
      const texts = question.answer.map(letter => question.options.find(option => option.label === letter)?.text).filter(Boolean);
      return `<div class="answer-panel"><div class="answer-panel__label">${icon("check")}正确答案</div><div class="choice-answer"><strong class="choice-answer__letters">${question.answer.join("")}</strong><span class="muted">${escapeHTML(texts.join("；"))}</span></div></div>`;
    }
    const alternates = question.alternateAnswers || [];
    return `<div class="answer-panel"><div class="answer-panel__label">${icon("book")}参考答案 · 建议按要点回忆</div><div class="answer-panel__content">${escapeHTML(question.answer)}</div>${alternates.length ? `<details class="alternate-answer"><summary>查看章节题库中的另一种表述</summary>${alternates.map(item => `<div><strong>${escapeHTML(item.sourceFile)}</strong><br>${escapeHTML(item.answer)}</div>`).join("")}</details>` : ""}</div>`;
  }

  function renderStudyCompletion(mode) {
    const label = mode === "choice" ? "选择题" : "主观题";
    return `<div class="empty-state card"><span class="empty-state__icon">${icon("check")}</span><h2>本组${label}已完成</h2><p>每一次自评都已写入记忆计划。可以回到首页查看到期任务，或按相同筛选再复习一轮。</p><div class="button-row"><button class="button button--primary" data-action="restart-study" data-mode="${mode}">再背一轮</button><button class="button button--ghost" data-nav="home">返回首页</button></div></div>`;
  }

  function startStudy(mode, options = {}) {
    ui.filters[mode] = { ...defaultFilters[mode], ...options };
    ui.completed[mode] = false;
    state.positions[mode] = "";
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
    ui.revealed = false;
    if (index === list.length - 1) ui.completed[mode] = true;
    else state.positions[mode] = list[index + 1].id;
    saveState();
    render();
    if (!ui.completed[mode]) document.querySelector(".question-card")?.scrollIntoView({ block: "start" });
  }

  function preferredModeForStatus(status) {
    const now = Date.now();
    const matches = questions.filter(question => {
      const memory = Core.getQuestionState(state, question.id);
      if (status === "due") return memory.seen > 0 && memory.due <= now;
      if (status === "wrong") return memory.wrong > 0;
      if (status === "favorite") return memory.favorite;
      return false;
    });
    return matches.some(question => question.kind === "choice") || !matches.length ? "choice" : "subjective";
  }

  function examPool(chapterId) {
    return chapterId && chapterId !== "all" ? choiceQuestions.filter(question => question.chapterIds.includes(chapterId)) : choiceQuestions;
  }

  function renderExam() {
    if (ui.examResult) return renderExamResult(ui.examResult);
    if (state.activeExam) return renderExamRoom();
    const stats = Core.getStats(state, questions);
    const selectedCount = state.settings.examCount;
    const customCount = [-1, 10, 20, 50].includes(selectedCount) ? "" : selectedCount;
    return `<div class="page-stack">
      <section class="exam-setup card">
        <div class="exam-setup__intro"><span class="eyebrow">BLIND TEST</span><h2>把“看着会”，<br>变成“做得对”。</h2><p>系统按题库中 65% 单选、35% 多选的实际比例自动分配，并优先抽取到期、答错和尚未掌握的题。</p><ul class="exam-rules"><li>${icon("check")}交卷前不显示答案，避免熟悉感造成误判</li><li>${icon("check")}多选题必须全部选对，漏选、错选均不得分</li><li>${icon("check")}自动保存答案，刷新或换天都能继续本场考试</li></ul></div>
        <div class="exam-setup__form">
          <div class="form-group"><label for="exam-chapter">考试范围</label><select id="exam-chapter" class="select">${chapterOptions("all")}</select><small id="exam-pool-note">全库共 ${choiceQuestions.length} 道选择题</small></div>
          <div class="form-group"><span>题目数量</span><div class="choice-chips">${[10, 20, 50, -1].map(count => `<label class="choice-chip"><input type="radio" name="exam-count" value="${count}"${selectedCount === count ? " checked" : ""}><span>${count === -1 ? "全部" : `${count} 题`}</span></label>`).join("")}</div></div>
          <div class="exam-custom-grid">
            <div class="form-group"><label for="exam-count-custom">自定义题数</label><input id="exam-count-custom" class="input" type="number" inputmode="numeric" min="1" max="421" step="1" placeholder="1–421 题" value="${customCount}"><small>填写后优先于上方预设</small></div>
            <div class="form-group"><label for="exam-minutes">考试时长（分钟）</label><input id="exam-minutes" class="input" type="number" inputmode="numeric" min="0" max="300" step="1" value="${state.settings.examMinutes}" required><small>0 为不限时，最多 300 分钟</small></div>
          </div>
          <div class="form-group"><label for="exam-strategy">组卷方式</label><select id="exam-strategy" class="select"><option value="smart">智能强化（推荐）</option><option value="random">完全随机</option><option value="sequential">题库顺序</option></select><small>智能强化会优先照顾薄弱题，同时保留一定随机性</small></div>
          <div class="exam-note">成绩按答对题数 ÷ 总题数计算。限时考试按真实时间倒计时，刷新不会暂停；时间到自动交卷，未答题按答错计分。</div>
          <button class="button button--primary button--large" data-action="start-exam">开始盲考${icon("arrow")}</button>
        </div>
      </section>
      ${state.examHistory.length ? `<section class="panel card"><div class="section-heading"><div><h2>考试记录</h2><p>保留最近 20 场，可回看解析或重考错题</p></div><span class="badge">平均正确率 ${stats.accuracy}%</span></div><ul class="history-list">${state.examHistory.map(renderHistoryItem).join("")}</ul></section>` : `<div class="empty-state card"><span class="empty-state__icon">${icon("exam")}</span><h2>第一场盲考，从现在开始</h2><p>建议先选择 20 题智能强化，交卷后会生成专属错题重考。</p></div>`}
    </div>`;
  }

  function renderExamRoom() {
    const exam = state.activeExam;
    const question = questionMap.get(exam.questionIds[exam.index]);
    if (!question) return '<div class="empty-state card"><h2>考试数据异常</h2><p>请结束本场考试后重新组卷。</p><button class="button button--primary" data-action="abandon-exam">返回考试中心</button></div>';
    const selected = exam.answers[question.id] || [];
    const answered = exam.questionIds.filter(id => (exam.answers[id] || []).length).length;
    const flagged = exam.flagged.includes(question.id);
    const remaining = exam.timeLimit ? Math.max(0, exam.endsAt - Date.now()) : null;
    const timerClass = remaining !== null && remaining <= 60000 ? " timer--danger" : remaining !== null && remaining <= 300000 ? " timer--warning" : "";
    const timerValue = remaining === null ? formatDuration(exam.elapsed / 1000) : formatDuration(Math.ceil(remaining / 1000));
    return `<div class="exam-room"><div class="exam-room__main"><div class="exam-status"><div><strong>第 ${exam.index + 1} / ${exam.questionIds.length} 题</strong><div class="study-summary__bar">${progressBar(Math.round(answered / exam.questionIds.length * 100))}</div></div><div class="exam-status__items"><span class="badge">已答 ${answered}</span><span class="badge">标记 ${exam.flagged.length}</span><span class="timer${timerClass}" title="${exam.timeLimit ? "距离自动交卷" : "本场作答用时"}">${icon("clock")}<span id="exam-timer-label">${exam.timeLimit ? "剩余" : "已用"}</span><span id="exam-timer">${timerValue}</span></span></div></div><article class="question-card card"><header class="question-card__header"><div class="question-card__badges"><span class="badge badge--brand">${escapeHTML(chapterName(question, true))}</span><span class="badge${question.type === "multiple" ? " badge--multi" : ""}">${question.type === "multiple" ? "多选题" : "单选题"}</span><span class="badge">${escapeHTML(question.section)}</span></div><button class="icon-button${flagged ? " is-active" : ""}" data-action="exam-flag" aria-label="${flagged ? "取消标记" : "标记本题"}" title="标记本题">${icon("flag")}</button></header><div class="question-card__body"><span class="question-number">${question.type === "multiple" ? "MULTIPLE CHOICE" : "SINGLE CHOICE"} · ${String(exam.index + 1).padStart(3, "0")}</span><h2 class="question-text">${escapeHTML(question.question)}</h2><p class="question-source">${question.type === "multiple" ? "本题有两个或两个以上正确答案，全部选对才得分" : "本题只有一个正确答案"}</p><div class="option-list exam-options">${question.options.map(option => `<label class="exam-option${selected.includes(option.label) ? " is-selected" : ""}"><input type="${question.type === "multiple" ? "checkbox" : "radio"}" name="answer-${question.id}" data-exam-answer="${question.id}" value="${option.label}"${selected.includes(option.label) ? " checked" : ""}><span class="option-letter">${option.label}</span><span>${escapeHTML(option.text)}</span></label>`).join("")}</div></div><footer class="question-card__footer"><button class="button button--ghost" data-action="exam-prev"${exam.index === 0 ? " disabled" : ""}>${icon("left")}上一题</button><button class="button button--ghost mobile-sheet-button" data-action="toggle-sheet">${icon("grid")}答题卡</button><button class="button button--ghost" data-action="exam-next">${exam.index === exam.questionIds.length - 1 ? "回到第一题" : "下一题"}${icon("right")}</button></footer></article><div class="exam-actions"><button class="text-button text-danger" data-action="abandon-exam">结束本场考试</button><div class="exam-actions__right"><span class="subtle">答案已自动保存</span></div></div></div><aside class="answer-sheet card${ui.mobileSheet ? " is-mobile-open" : ""}" aria-label="答题卡"><div class="answer-sheet__header"><h3>答题卡</h3><span class="subtle">${answered}/${exam.questionIds.length}</span></div><div class="sheet-grid">${exam.questionIds.map((id, index) => `<button class="sheet-number${(exam.answers[id] || []).length ? " is-answered" : ""}${index === exam.index ? " is-current" : ""}${exam.flagged.includes(id) ? " is-flagged" : ""}" data-action="exam-jump" data-index="${index}" aria-label="第 ${index + 1} 题${(exam.answers[id] || []).length ? "，已答" : "，未答"}">${index + 1}</button>`).join("")}</div><div class="answer-sheet__legend"><span><i class="legend-dot legend-dot--answered"></i>已答</span><span><i class="legend-dot"></i>未答</span><span>圆点：已标记</span></div><button class="button button--primary sheet-submit" data-action="submit-exam">交卷并查看成绩</button></aside></div>`;
  }

  function renderExamResult(record) {
    const unanswered = record.questionIds.filter(id => !(record.answers[id] || []).length).length;
    const message = record.accuracy >= 90 ? "掌握得很扎实，可以挑战更大范围。" : record.accuracy >= 70 ? "整体不错，把错题再巩固一轮会更稳定。" : "已经找到薄弱点，立即重考错题效果最好。";
    return `<div class="page-stack"><section class="result-hero card"><div class="result-score">${record.accuracy}<small>%</small></div><h2>${record.accuracy >= 80 ? "本场发挥出色" : "完成比完美更重要"}</h2><p>${record.timedOut ? "时间到，系统已自动交卷；未作答按答错计分。" : message}</p><div class="button-row"><button class="button button--primary" data-action="retry-wrong" data-exam-id="${escapeHTML(record.id)}"${record.wrongIds.length ? "" : " disabled"}>错题重考（${record.wrongIds.length}）</button><button class="button button--ghost" data-action="toggle-review">${ui.showReview ? "收起解析" : "查看全部解析"}</button><button class="button button--ghost" data-action="copy-result" data-exam-id="${escapeHTML(record.id)}">复制成绩</button><button class="button button--ghost" data-action="export-result" data-exam-id="${escapeHTML(record.id)}">${icon("download")}导出解析</button><button class="button button--ghost" data-action="new-exam">再考一场</button></div></section><section class="result-stats"><div class="result-stat"><strong class="text-success">${record.correct}</strong><span>答对</span></div><div class="result-stat"><strong class="text-danger">${record.wrongIds.length}</strong><span>答错</span></div><div class="result-stat"><strong>${unanswered}</strong><span>未作答</span></div><div class="result-stat"><strong>${formatDuration(record.duration)}</strong><span>用时</span></div></section>${ui.showReview ? `<section class="review-list">${record.questionIds.map((id, index) => renderReviewItem(record, id, index)).join("")}</section>` : ""}</div>`;
  }

  function renderReviewItem(record, id, index) {
    const question = questionMap.get(id);
    if (!question) return "";
    const selected = record.answers[id] || [];
    const correct = !record.wrongIds.includes(id);
    return `<article class="review-item card"><div class="review-item__top"><div class="question-card__badges"><span class="badge">${index + 1}</span><span class="badge badge--brand">${escapeHTML(chapterName(question, true))}</span><span class="badge${question.type === "multiple" ? " badge--multi" : ""}">${question.type === "multiple" ? "多选题" : "单选题"}</span></div><span class="badge ${correct ? "badge--success" : "badge--multi"}">${correct ? "回答正确" : "需要巩固"}</span></div><h3 class="question-text">${escapeHTML(question.question)}</h3><ul class="option-list">${question.options.map(option => `<li class="option-row${question.answer.includes(option.label) ? " is-answer" : ""}${selected.includes(option.label) && !question.answer.includes(option.label) ? " is-wrong-answer" : ""}"><span class="option-letter">${option.label}</span><span>${escapeHTML(option.text)}</span></li>`).join("")}</ul><div class="review-answer"><div><span>你的答案</span><strong class="${correct ? "is-correct" : "is-wrong"}">${selected.length ? selected.join("") : "未作答"}</strong></div><div><span>正确答案</span><strong class="is-correct">${question.answer.join("")}</strong></div></div></article>`;
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
    const selected = questionIds ? questionIds.map(id => questionMap.get(id)).filter(Boolean) : Core.selectExamQuestions(pool, state, count, strategy);
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
    const multiple = selected.filter(question => question.type === "multiple").length;
    toast(`已生成 ${selected.length} 题：${selected.length - multiple} 道单选，${multiple} 道多选${timeLimit ? `，限时 ${minutes} 分钟` : ""}`);
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
    const question = questionMap.get(exam.questionIds[exam.index]);
    const label = letter.toUpperCase();
    const option = question?.options.find(item => item.label === label);
    if (!option) return;
    syncExamClock();
    if (question.type === "single") exam.answers[question.id] = [label];
    else {
      const selected = new Set(exam.answers[question.id] || []);
      if (selected.has(label)) selected.delete(label);
      else selected.add(label);
      exam.answers[question.id] = [...selected].sort();
    }
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
    const submitted = Core.submitExam(state, exam, questionMap);
    state = submitted.state;
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
    if (select && note) note.textContent = `当前范围共 ${examPool(select.value).length} 道选择题；超过范围数量的设置会自动取全部题目`;
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
    return `马原盲考成绩：${record.accuracy}%（答对 ${record.correct}/${record.questionIds.length}）· 用时 ${formatDuration(record.duration)}${record.timedOut ? " · 时间到自动交卷" : ""}`;
  }

  function copyExamResult(record) {
    navigator.clipboard.writeText(examResultSummary(record)).then(() => toast("成绩摘要已复制")).catch(() => toast("复制失败，请手动复制"));
  }

  function downloadExamResult(record) {
    const rows = [["序号", "题型", "章节", "题干", "你的答案", "正确答案", "判定"]];
    record.questionIds.forEach((id, index) => {
      const question = questionMap.get(id);
      if (!question) return;
      const selected = record.answers[id] || [];
      rows.push([
        index + 1,
        question.type === "multiple" ? "多选题" : "单选题",
        chapterName(question),
        question.question,
        selected.join("") || "未作答",
        question.answer.join(""),
        record.wrongIds.includes(id) ? "需要巩固" : "回答正确",
      ]);
    });
    const csv = `\ufeff${rows.map(row => row.map(csvCell).join(",")).join("\r\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `盲考解析-${record.id}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("解析已导出为 CSV");
  }

  function exportData() {
    const payload = { app: "mayuan-memory", version: 1, exportedAt: new Date().toISOString(), state };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `马原记忆舱备份-${Core.dateKey()}.json`;
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
      const imported = Core.normalizeState(parsed.state || parsed, validIds);
      openConfirm("导入学习备份", "导入会覆盖当前浏览器中的记忆进度、收藏和考试记录，且无法撤销。建议先导出当前数据。", "确认导入", () => {
        state = imported;
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
    if (action === "continue-learning") {
      if (state.activeExam) { ui.examResult = null; navigate("exam"); }
      else if (Core.getStats(state, questions).due) {
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
    else if (action === "reveal") { ui.revealed = true; render(true); }
    else if (action === "rate") rateCurrent(button.dataset.rating);
    else if (action === "study-prev") moveStudy(button.dataset.mode, -1);
    else if (action === "study-next") moveStudy(button.dataset.mode, 1);
    else if (action === "favorite") {
      const list = getStudyList(ui.view);
      const { question } = currentStudy(ui.view, list);
      state = Core.toggleFavorite(state, question.id);
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
    } else if (action === "toggle-sheet") { ui.mobileSheet = !ui.mobileSheet; render(true); }
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
      openConfirm("清空全部学习数据", "将永久删除本机的记忆进度、收藏、每日记录和考试历史。题库本身不会删除，此操作无法撤销。", "全部清空", () => {
        state = Core.createDefaultState();
        applyPreferences();
        saveState();
        ui.examResult = null;
        startStudy("choice");
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
      const question = questionMap.get(id);
      if (question.type === "single") state.activeExam.answers[id] = [answer.value];
      else {
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

  document.addEventListener("compositionstart", event => {
    if (event.target.closest("[data-search]")) searchComposing = true;
  });
  document.addEventListener("compositionend", event => {
    if (!event.target.closest("[data-search]")) return;
    searchComposing = false;
    event.target.dispatchEvent(new Event("input", { bubbles: true }));
  });
  document.addEventListener("input", event => {
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
  [settingsDialog, helpDialog, confirmDialog].forEach(dialog => dialog.addEventListener("click", event => {
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
      if (event.key === "Enter") { event.preventDefault(); moveExam(state.activeExam.index + 1); }
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
