const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:4173";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(check, description, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch {}
    await pause(60);
  }
  throw new Error(`等待超时：${description}`);
}

class CDP {
  constructor(browser) {
    this.input = browser.stdio[3];
    this.output = browser.stdio[4];
    this.nextId = 1;
    this.pending = new Map();
    this.errors = [];
    this.buffer = "";
    this.sessionId = null;
    this.output.on("data", chunk => {
      this.buffer += chunk.toString("utf8");
      let boundary = this.buffer.indexOf("\0");
      while (boundary !== -1) {
        const message = JSON.parse(this.buffer.slice(0, boundary));
        this.buffer = this.buffer.slice(boundary + 1);
        if (message.id) {
          const request = this.pending.get(message.id);
          if (request) {
            this.pending.delete(message.id);
            if (message.error) request.reject(new Error(JSON.stringify(message.error)));
            else request.resolve(message.result);
          }
        } else if (message.method === "Runtime.exceptionThrown") {
          this.errors.push(message.params.exceptionDetails.text);
        }
        boundary = this.buffer.indexOf("\0");
      }
    });
  }

  async send(method, params = {}, sessionId = this.sessionId) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.input.write(JSON.stringify(message) + "\0");
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
}

async function main() {
  const browser = spawn(EDGE, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--remote-debugging-pipe",
    `--user-data-dir=${path.join(__dirname, ".edge-e2e-profile")}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  let cdp;
  const checks = [];
  const passed = name => { checks.push(name); console.log(`PASS ${name}`); };
  try {
    cdp = new CDP(browser);
    const targets = await cdp.send("Target.getTargets");
    const page = targets.targetInfos.find(target => target.type === "page");
    const attached = await cdp.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
    cdp.sessionId = attached.sessionId;
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });

    const metrics = async (width, height, mobile = false) => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height });
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
    };
    const ready = () => waitFor(() => cdp.evaluate("document.readyState === 'complete' && !!window.QUESTION_BANK && document.querySelector('#app').children.length > 0 && !document.querySelector('.initial-loading')"), "页面渲染完成");
    const reload = async () => {
      const previousOrigin = await cdp.evaluate("performance.timeOrigin");
      await cdp.send("Page.reload", { ignoreCache: true });
      await waitFor(async () => (await cdp.evaluate("performance.timeOrigin")) !== previousOrigin, "新文档载入");
      await ready();
    };
    const click = async selector => {
      const clicked = await cdp.evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`);
      if (!clicked) {
        const content = await cdp.evaluate("document.querySelector('#app').textContent.slice(0, 500)");
        throw new Error(`找不到点击目标 ${selector}；当前页面：${content}；运行异常：${cdp.errors.join(' | ')}`);
      }
      await pause(80);
    };
    const noOverflow = async label => {
      const result = await cdp.evaluate(`(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll('body *')].map(element => ({ tag: element.tagName, cls: element.className, right: element.getBoundingClientRect().right })).filter(item => item.right > innerWidth + 2 && item.tag !== 'SYMBOL').slice(0, 8) }))()`);
      assert.ok(result.scroll <= result.width + 1, `${label} 横向溢出：${JSON.stringify(result)}`);
      passed(`${label} 无横向溢出`);
    };
    const screenshot = async name => {
      const image = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(path.join(__dirname, name), Buffer.from(image.data, "base64"));
    };
    const storedState = () => cdp.evaluate("JSON.parse(localStorage.getItem(MemoryCore.STORAGE_KEY))");
    const answerCurrent = async () => {
      await cdp.evaluate(`(() => {
        const state = JSON.parse(localStorage.getItem(MemoryCore.STORAGE_KEY));
        const exam = state.activeExam;
        const id = exam.questionIds[exam.index];
        if (exam.graded && exam.graded[id]) return;
        const question = QUESTION_BANK.questions.find(item => item.id === id);
        for (const letter of question.answer) {
          const input = document.querySelector('input[data-exam-answer="' + id + '"][value="' + letter + '"]');
          if (input && !input.checked) input.click();
        }
        if (question.type === "multiple") {
          const confirm = document.querySelector('[data-action="confirm-exam-answer"]');
          if (confirm && !confirm.disabled) confirm.click();
        }
      })()`);
      await pause(60);
    };

    await metrics(375, 812, true);
    await cdp.send("Page.navigate", { url: BASE });
    await ready();
    await waitFor(() => cdp.evaluate("navigator.serviceWorker && navigator.serviceWorker.ready.then(() => true)"), "离线服务就绪");
    await cdp.send("Page.navigate", { url: "about:blank" });
    await waitFor(() => cdp.evaluate("location.href === 'about:blank'"), "离开旧文档");
    await cdp.send("Storage.clearDataForOrigin", { origin: BASE, storageTypes: "local_storage" });
    await cdp.send("Page.navigate", { url: BASE });
    await ready();
    assert.equal(await cdp.evaluate("QUESTION_BANK.questions.length"), 444);
    await noOverflow("375px 首页");
    await screenshot("mobile-home.png");
    passed("离线资源首次缓存完成");

    await click('[data-action="start-study"][data-mode="choice"]');
    const firstQuestion = await cdp.evaluate("document.querySelector('.question-text').textContent");
    assert.ok(firstQuestion.includes("建立社会主义"));
    assert.equal(await cdp.evaluate("document.querySelectorAll('.answer-panel').length"), 0);
    await click('[data-action="reveal"]');
    assert.equal(await cdp.evaluate("document.querySelector('.choice-answer__letters').textContent"), "B");
    await noOverflow("375px 选择题");
    await screenshot("mobile-choice.png");
    await click('[data-action="rate"][data-rating="good"]');
    const secondQuestion = await cdp.evaluate("document.querySelector('.question-text').textContent");
    assert.notEqual(secondQuestion, firstQuestion);
    assert.equal((await storedState()).questions.c0001.mastery, 1);
    passed("选择题隐藏答案、自评与记忆强度更新");

    await reload();
    assert.equal(await cdp.evaluate("document.querySelector('#header-title').textContent"), "学习首页");
    await click('[data-action="continue-learning"]');
    assert.equal(await cdp.evaluate("document.querySelector('.question-text').textContent"), secondQuestion);
    passed("刷新后继续学习保持原题号");

    await click('.bottom-nav [data-nav="home"]');
    await click('[data-action="start-study"][data-mode="choice"]');
    await click('[data-action="pick-study"][data-option="A"]');
    assert.ok(await cdp.evaluate("!!document.querySelector('.verdict--wrong')"));
    assert.ok(await cdp.evaluate("!!document.querySelector('.option-row.is-wrong-answer')"));
    assert.ok(await cdp.evaluate("!!document.querySelector('.option-row.is-answer')"));
    assert.ok((await cdp.evaluate("document.querySelector('.verdict').textContent")).includes("正确答案 B"));
    await noOverflow("375px 背诵判分-答错");
    await screenshot("mobile-choice-wrong.png");
    await click('[data-action="rate"][data-rating="again"]');
    await click('[data-action="pick-study"][data-option="C"]');
    assert.ok(await cdp.evaluate("!!document.querySelector('.verdict--correct')"));
    assert.equal(await cdp.evaluate("document.querySelectorAll('.option-row.is-answer').length"), 1);
    await click('[data-action="rate"][data-rating="good"]');
    passed("背诵单选即时判分：答错标红、答对标绿并显示答案");

    await cdp.evaluate(`(() => {
      const select = document.querySelector('select[data-filter="type"]');
      select.value = "multiple";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    const multiAnswer = await cdp.evaluate("(() => { const stem = document.querySelector('.question-text').textContent; return QUESTION_BANK.questions.find(q => q.kind === 'choice' && q.type === 'multiple' && q.question === stem).answer.join(''); })()");
    for (const letter of multiAnswer) await click(`[data-action="pick-study"][data-option="${letter}"]`);
    await click('[data-action="submit-study-answer"]');
    assert.ok(await cdp.evaluate("!!document.querySelector('.verdict--correct')"));
    assert.equal(await cdp.evaluate("document.querySelectorAll('.option-row.is-answer').length"), multiAnswer.length);
    await click('[data-action="rate"][data-rating="hard"]');
    passed("背诵多选勾选后提交判分");

    await click('.bottom-nav [data-nav="home"]');
    await click('[data-action="start-study"][data-mode="subjective"]');
    assert.ok((await cdp.evaluate("document.querySelector('.question-text').textContent")).includes("什么是马克思主义"));
    await click('[data-action="favorite"]');
    await click('[data-action="reveal"]');
    assert.ok((await cdp.evaluate("document.querySelector('.answer-panel__content').textContent")).includes("科学理论体系"));
    await click('[data-action="rate"][data-rating="again"]');
    await click('.bottom-nav [data-nav="home"]');
    await click('[data-action="quick-review"][data-status="favorite"]');
    assert.equal(await cdp.evaluate("document.querySelector('#header-title').textContent"), "主观题背诵");
    assert.ok((await cdp.evaluate("document.querySelector('.question-text').textContent")).includes("什么是马克思主义"));
    passed("仅收藏主观题时快速入口选择正确模式");

    const dueState = await storedState();
    dueState.questions.s0001.due = 0;
    await cdp.send("Page.navigate", { url: `${BASE}/manifest.webmanifest` });
    await waitFor(() => cdp.evaluate("location.href.endsWith('/manifest.webmanifest')"), "进入同源测试准备页");
    await cdp.evaluate(`localStorage.setItem("mayuan-memory-v1", ${JSON.stringify(JSON.stringify(dueState))})`);
    await cdp.send("Page.navigate", { url: BASE });
    await ready();
    const dueIds = await cdp.evaluate("QUESTION_BANK.questions.filter(question => { const memory = MemoryCore.getQuestionState(JSON.parse(localStorage.getItem(MemoryCore.STORAGE_KEY)), question.id); return memory.seen > 0 && memory.due <= Date.now(); }).map(question => question.id)");
    assert.deepEqual(dueIds, ["s0001"]);
    await click('[data-action="continue-learning"]');
    assert.equal(await cdp.evaluate("document.querySelector('#header-title').textContent"), "主观题背诵");
    assert.ok((await cdp.evaluate("document.querySelector('.study-summary').textContent")).includes("1 / 1"));
    passed("仅主观题到期时继续学习选择正确模式");

    await click('.bottom-nav [data-nav="exam"]');
    await cdp.evaluate("document.querySelector('input[name=\"exam-count\"][value=\"10\"]').click()");
    await click('[data-action="start-exam"]');
    let state = await storedState();
    assert.equal(state.activeExam.questionIds.length, 10);
    const examTypes = await cdp.evaluate("JSON.parse(localStorage.getItem(MemoryCore.STORAGE_KEY)).activeExam.questionIds.map(id => QUESTION_BANK.questions.find(q => q.id === id).type)");
    assert.ok(examTypes.includes("single") && examTypes.includes("multiple"));
    await answerCurrent();
    const answeredId = state.activeExam.questionIds[0];
    const expectedAnswers = (await storedState()).activeExam.answers[answeredId];
    await reload();
    assert.ok((await storedState()).activeExam, "刷新后活动考试存在");
    assert.deepEqual((await storedState()).activeExam.answers[answeredId], expectedAnswers);
    await click('[data-action="continue-learning"]');
    assert.ok(await cdp.evaluate("!!document.querySelector('.verdict')"), "刷新后首题保持已判分状态");
    assert.ok(await cdp.evaluate("document.querySelectorAll('.exam-option.is-locked').length > 0"));
    passed("十题智能组卷、逐题判分与刷新断点续答");

    for (let index = 0; index < 10; index += 1) {
      await answerCurrent();
      assert.ok(await cdp.evaluate("!!document.querySelector('.verdict')"), `第 ${index + 1} 题作答后即时判分`);
      if (index < 9) await click('[data-action="exam-next"]');
    }
    await click('[data-action="submit-exam"]');
    assert.ok(await cdp.evaluate("document.querySelector('#confirm-dialog').open"));
    await click('#confirm-submit');
    await waitFor(() => cdp.evaluate("!!document.querySelector('.result-score')"), "成绩页");
    assert.equal(await cdp.evaluate("document.querySelector('.result-score').textContent"), "100%");
    state = await storedState();
    assert.equal(state.activeExam, null);
    assert.equal(state.examHistory.length, 1);
    assert.equal(state.examHistory[0].wrongIds.length, 0);
    await noOverflow("375px 成绩页");
    await screenshot("mobile-result.png");
    assert.ok(await cdp.evaluate("!!document.querySelector('.analysis')"), "成绩页包含分析模块");
    assert.ok((await cdp.evaluate("document.querySelector('.analysis').textContent")).includes("章节正确率"));
    assert.ok(await cdp.evaluate("document.querySelectorAll('.analysis-row').length > 0"));
    await noOverflow("375px 成绩分析");
    await screenshot("mobile-analysis.png");
    passed("完整作答、确认交卷、百分成绩、历史记录与成绩分析");

    await click('[data-action="toggle-review"]');
    assert.equal(await cdp.evaluate("document.querySelectorAll('.review-item').length"), 10);
    await noOverflow("375px 全题解析");
    await click('[data-action="new-exam"]');
    await noOverflow("375px 盲考设置");
    await cdp.evaluate("document.getElementById('exam-count-custom').scrollIntoView({ block: 'center', behavior: 'instant' })");
    await screenshot("mobile-exam-setup.png");
    await cdp.evaluate(`(() => {
      const count = document.getElementById("exam-count-custom");
      count.value = "3";
      count.dispatchEvent(new Event("change", { bubbles: true }));
      const minutes = document.getElementById("exam-minutes");
      minutes.value = "1";
      minutes.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await click('[data-action="start-exam"]');
    state = await storedState();
    assert.equal(state.activeExam.questionIds.length, 3);
    assert.equal(state.activeExam.timeLimit, 60000);
    assert.equal(state.activeExam.endsAt - state.activeExam.startedAt, 60000);
    assert.equal(await cdp.evaluate("document.getElementById('exam-timer-label').textContent"), "剩余");
    const deadline = state.activeExam.endsAt;
    await reload();
    assert.equal((await storedState()).activeExam.endsAt, deadline);
    await click('[data-action="continue-learning"]');
    assert.equal(await cdp.evaluate("document.getElementById('exam-timer-label').textContent"), "剩余");
    await cdp.evaluate("window.__realDateNow = Date.now; Date.now = () => " + (deadline + 1000));
    await waitFor(() => cdp.evaluate("!!document.querySelector('.result-score')"), "限时自动交卷");
    await cdp.evaluate("Date.now = window.__realDateNow; delete window.__realDateNow");
    state = await storedState();
    assert.equal(state.activeExam, null);
    assert.equal(state.examHistory.length, 2);
    assert.equal(state.examHistory[0].timedOut, true);
    assert.equal(state.examHistory[0].timeLimit, 60000);
    assert.ok((await cdp.evaluate("document.querySelector('.result-hero').textContent")).includes("时间到"));
    await noOverflow("375px 自动交卷成绩页");
    passed("自定义三题一分钟、刷新保留倒计时与到时自动交卷");
    await click('[data-action="new-exam"]');
    await cdp.evaluate(`(() => {
      const minutes = document.getElementById("exam-minutes");
      minutes.value = "0";
      minutes.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await click('[data-action="start-exam"]');
    await cdp.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))");
    const firstType = await cdp.evaluate("(() => { const exam = JSON.parse(localStorage.getItem(MemoryCore.STORAGE_KEY)).activeExam; return QUESTION_BANK.questions.find(q => q.id === exam.questionIds[exam.index]).type; })()");
    if (firstType === "multiple") await cdp.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))");
    assert.ok(await cdp.evaluate("!!document.querySelector('.verdict')"), "键盘作答后即时判分");
    await click('[data-action="abandon-exam"]');
    await click('#confirm-submit');
    await click('.bottom-nav [data-nav="home"]');
    assert.equal(await cdp.evaluate("document.querySelectorAll('.activity-heat .activity-day').length"), 14);
    assert.ok(await cdp.evaluate("!!document.querySelector('.activity-heat')"));
    passed("考试键盘快捷键与学习打卡热力图");
    await click('.bottom-nav [data-nav="home"]');
    await click('[data-action="toggle-theme"]');
    assert.equal(await cdp.evaluate("document.documentElement.dataset.theme"), "dark");
    await click('[data-action="toggle-theme"]');
    assert.equal(await cdp.evaluate("document.documentElement.dataset.theme"), "light");
    passed("明暗主题双向切换");

    await metrics(768, 1024, false);
    await noOverflow("768px 首页");
    await screenshot("tablet-home.png");
    await metrics(1440, 1000, false);
    await noOverflow("1440px 首页");
    await screenshot("desktop-home.png");

    await metrics(375, 812, true);
    await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await reload();
    assert.equal(await cdp.evaluate("QUESTION_BANK.questions.length"), 444);
    assert.equal(await cdp.evaluate("document.querySelector('#header-title').textContent"), "学习首页");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    passed("断网后完整重载与题库可用");

    const unnamedButtons = await cdp.evaluate("[...document.querySelectorAll('button')].filter(button => !button.textContent.trim() && !button.getAttribute('aria-label')).length");
    assert.equal(unnamedButtons, 0);
    assert.deepEqual(cdp.errors, []);
    passed("按钮可访问名称与浏览器运行无异常");
    console.log(`\n${checks.length} 项浏览器验收全部通过。`);
  } finally {
    if (cdp) {
      try { await cdp.send("Browser.close"); } catch {}
    }
    browser.kill();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
