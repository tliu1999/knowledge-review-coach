const STORAGE_KEY = "knowledge-review-coach-session";
const TOPICS_KEY = "knowledge-review-coach-topics";
const OBJECTIVE_TARGET = 30;

const state = {
  topic: "",
  currentQuestion: "",
  currentStage: "",
  currentQuestionType: "short_answer",
  currentOptions: [],
  currentCorrectAnswer: [],
  selectedAnswerIds: [],
  history: [],
  busy: false,
  mastered: false,
  lastReview: null,
  lastAnsweredQuestion: "",
  lastAnsweredAnswer: "",
  pendingReview: null,
  awaitingNext: false,
  followupOpen: false,
  followupMessages: []
};

const topicForm = document.querySelector("#topicForm");
const topicInput = document.querySelector("#topicInput");
const topicLabel = document.querySelector("#topicLabel");
const roundLabel = document.querySelector("#roundLabel");
const scoreLabel = document.querySelector("#scoreLabel");
const stageLabel = document.querySelector("#stageLabel");
const objectiveLabel = document.querySelector("#objectiveLabel");
const sessionTitle = document.querySelector("#sessionTitle");
const resetBtn = document.querySelector("#resetBtn");
const questionText = document.querySelector("#questionText");
const questionTypeLabel = document.querySelector("#questionTypeLabel");
const answerForm = document.querySelector("#answerForm");
const optionList = document.querySelector("#optionList");
const answerInput = document.querySelector("#answerInput");
const submitAnswerBtn = document.querySelector("#submitAnswerBtn");
const nextQuestionBtn = document.querySelector("#nextQuestionBtn");
const endReviewBtn = document.querySelector("#endReviewBtn");
const dontKnowBtn = document.querySelector("#dontKnowBtn");
const newQuestionBtn = document.querySelector("#newQuestionBtn");
const followupBtn = document.querySelector("#followupBtn");
const subjectiveBtn = document.querySelector("#subjectiveBtn");
const statusText = document.querySelector("#statusText");
const feedbackPanel = document.querySelector("#feedbackPanel");
const verdictText = document.querySelector("#verdictText");
const feedbackScore = document.querySelector("#feedbackScore");
const conclusionBlock = document.querySelector("#conclusionBlock");
const conclusionText = document.querySelector("#conclusionText");
const basisList = document.querySelector("#basisList");
const errorList = document.querySelector("#errorList");
const optionAnalysisBlock = document.querySelector("#optionAnalysisBlock");
const optionAnalysisList = document.querySelector("#optionAnalysisList");
const explanationBlock = document.querySelector("#explanationBlock");
const explanationText = document.querySelector("#explanationText");
const correctionBlock = document.querySelector("#correctionBlock");
const correctionText = document.querySelector("#correctionText");
const verificationBlock = document.querySelector("#verificationBlock");
const verificationText = document.querySelector("#verificationText");
const masteryBlock = document.querySelector("#masteryBlock");
const masteryText = document.querySelector("#masteryText");
const historyCount = document.querySelector("#historyCount");
const historyList = document.querySelector("#historyList");
const topicLibraryCount = document.querySelector("#topicLibraryCount");
const topicLibraryList = document.querySelector("#topicLibraryList");
const topicLibraryEmpty = document.querySelector("#topicLibraryEmpty");
const followupPanel = document.querySelector("#followupPanel");
const followupForm = document.querySelector("#followupForm");
const followupInput = document.querySelector("#followupInput");
const askFollowupBtn = document.querySelector("#askFollowupBtn");
const followupMessages = document.querySelector("#followupMessages");
const continueReviewBtn = document.querySelector("#continueReviewBtn");

function getStoredTopics() {
  try {
    return JSON.parse(localStorage.getItem(TOPICS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveStoredTopics(topics) {
  localStorage.setItem(TOPICS_KEY, JSON.stringify(topics));
}

function statsForHistory(history) {
  const objective = history.filter((item) => ["true_false", "single_choice", "multiple_choice"].includes(item.evaluation?.answeredQuestionType || item.evaluation?.questionType));
  const correct = objective.filter((item) => item.evaluation?.objectiveCorrect).length;
  const scores = history.map((item) => Number(item.evaluation?.score || 0));
  const stages = [...new Set(history.map((item) => item.evaluation?.stage).filter(Boolean))];
  const weakItems = history.filter((item) => {
    const evaluation = item.evaluation || {};
    return Number(evaluation.score || 0) < 85
      || evaluation.objectiveCorrect === false
      || evaluation.needsVerification
      || (evaluation.errorPoints || []).length > 0
      || (evaluation.missingPoints || []).length > 0;
  });
  return {
    rounds: history.length,
    objectiveCount: objective.length,
    objectiveAccuracy: objective.length ? Math.round((correct / objective.length) * 100) : 0,
    averageScore: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0,
    stages,
    weakItems
  };
}

function saveTopicSnapshot() {
  if (!state.topic || state.history.length === 0) {
    renderTopicLibrary();
    return;
  }
  const topics = getStoredTopics();
  const stats = statsForHistory(state.history);
  const topicRecord = {
    topic: state.topic,
    updatedAt: new Date().toISOString(),
    mastered: state.mastered,
    currentStage: state.currentStage,
    currentQuestion: state.currentQuestion,
    currentQuestionType: state.currentQuestionType,
    currentOptions: state.currentOptions,
    currentCorrectAnswer: state.currentCorrectAnswer,
    pendingReview: state.pendingReview,
    awaitingNext: state.awaitingNext,
    lastReview: state.lastReview,
    lastAnsweredQuestion: state.lastAnsweredQuestion,
    lastAnsweredAnswer: state.lastAnsweredAnswer,
    history: state.history,
    stats
  };
  const nextTopics = [topicRecord, ...topics.filter((item) => item.topic !== state.topic)].slice(0, 40);
  saveStoredTopics(nextTopics);
  renderTopicLibrary();
}

function weakFocusFromRecord(record) {
  const weakItems = record.stats?.weakItems || [];
  const weakStages = [...new Set(weakItems.map((item) => item.evaluation?.stage).filter(Boolean))];
  const weakNotes = weakItems.flatMap((item) => [
    ...(item.evaluation?.errorPoints || []),
    ...(item.evaluation?.missingPoints || []),
    ...(item.evaluation?.gaps || [])
  ]).filter(Boolean).slice(0, 8);
  return {
    mode: "weak",
    stages: weakStages,
    notes: weakNotes,
    summary: weakNotes.length
      ? `重点复习：${weakNotes.join("；")}`
      : "重点复习历史中低分、错题、遗漏和不确定内容。"
  };
}

function renderTopicLibrary() {
  const topics = getStoredTopics();
  topicLibraryCount.textContent = `${topics.length} 个`;
  topicLibraryEmpty.hidden = topics.length > 0;
  topicLibraryList.replaceChildren(
    ...topics.map((record) => {
      const item = document.createElement("article");
      item.className = "topic-library-card";
      item.innerHTML = `
        <div class="topic-library-title">
          <strong></strong>
          <span></span>
        </div>
        <p></p>
        <div class="topic-library-actions">
          <button type="button" data-action="weak">重点回顾</button>
          <button type="button" data-action="all">全部重来</button>
        </div>
      `;
      item.querySelector("strong").textContent = record.topic;
      item.querySelector(".topic-library-title span").textContent = record.mastered ? "已完成" : "复习中";
      item.querySelector("p").textContent = `${record.stats?.rounds || 0} 轮 · 客观题 ${record.stats?.objectiveCount || 0} 道 · 正确率 ${record.stats?.objectiveAccuracy || 0}%`;
      item.querySelector('[data-action="weak"]').addEventListener("click", () => {
        startSession(record.topic, { reviewMode: "weak", focus: weakFocusFromRecord(record), sourceHistory: record.history || [] });
      });
      item.querySelector('[data-action="all"]').addEventListener("click", () => {
        startSession(record.topic, { reviewMode: "all" });
      });
      return item;
    })
  );
}

function persistSession() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    topic: state.topic,
    currentQuestion: state.currentQuestion,
    currentStage: state.currentStage,
    currentQuestionType: state.currentQuestionType,
    currentOptions: state.currentOptions,
    currentCorrectAnswer: state.currentCorrectAnswer,
    selectedAnswerIds: state.selectedAnswerIds,
    history: state.history,
    mastered: state.mastered,
    lastReview: state.lastReview,
    lastAnsweredQuestion: state.lastAnsweredQuestion,
    lastAnsweredAnswer: state.lastAnsweredAnswer,
    pendingReview: state.pendingReview,
    awaitingNext: state.awaitingNext,
    followupMessages: state.followupMessages
  }));
}

function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (!saved.topic) {
      return false;
    }
    Object.assign(state, {
      topic: saved.topic || "",
      currentQuestion: saved.currentQuestion || "",
      currentStage: saved.currentStage || "",
      currentQuestionType: saved.currentQuestionType || "short_answer",
      currentOptions: Array.isArray(saved.currentOptions) ? saved.currentOptions : [],
      currentCorrectAnswer: Array.isArray(saved.currentCorrectAnswer) ? saved.currentCorrectAnswer : [],
      selectedAnswerIds: Array.isArray(saved.selectedAnswerIds) ? saved.selectedAnswerIds : [],
      history: Array.isArray(saved.history) ? saved.history : [],
      mastered: Boolean(saved.mastered),
      lastReview: saved.lastReview || null,
      lastAnsweredQuestion: saved.lastAnsweredQuestion || "",
      lastAnsweredAnswer: saved.lastAnsweredAnswer || "",
      pendingReview: saved.pendingReview || null,
      awaitingNext: Boolean(saved.awaitingNext),
      followupOpen: false,
      followupMessages: Array.isArray(saved.followupMessages) ? saved.followupMessages : []
    });
    return true;
  } catch {
    return false;
  }
}

function canAct() {
  return Boolean(state.currentQuestion && !state.busy && !state.mastered && !state.awaitingNext);
}

function isObjectiveQuestion() {
  return ["true_false", "single_choice", "multiple_choice"].includes(state.currentQuestionType);
}

function normalizeCurrentQuestionState() {
  if (isObjectiveQuestion() && (!state.currentOptions || state.currentOptions.length === 0)) {
    state.currentQuestionType = "short_answer";
    state.currentOptions = [];
    state.currentCorrectAnswer = [];
    state.selectedAnswerIds = [];
  }
}

function hasAnswer() {
  normalizeCurrentQuestionState();
  if (state.awaitingNext) {
    return false;
  }
  return isObjectiveQuestion() ? state.selectedAnswerIds.length > 0 : answerInput.value.trim().length > 0;
}

function questionTypeName(type) {
  return {
    true_false: "判断题",
    single_choice: "单选题",
    multiple_choice: "多选题",
    short_answer: "简答题"
  }[type] || "简答题";
}

function objectiveStats() {
  const objective = state.history.filter((item) => ["true_false", "single_choice", "multiple_choice"].includes(item.evaluation?.answeredQuestionType || item.evaluation?.questionType));
  const correct = objective.filter((item) => item.evaluation?.objectiveCorrect).length;
  return {
    count: objective.length,
    correct,
    accuracy: objective.length ? Math.round((correct / objective.length) * 100) : 0
  };
}

function setBusy(isBusy, message = "") {
  state.busy = isBusy;
  statusText.textContent = message;
  topicInput.disabled = isBusy;
  answerInput.disabled = isBusy || state.followupOpen || !state.currentQuestion || state.mastered || state.awaitingNext || isObjectiveQuestion();
  submitAnswerBtn.disabled = isBusy || state.followupOpen || !state.currentQuestion || state.mastered || !hasAnswer();
  optionList.querySelectorAll("button").forEach((button) => {
    button.disabled = isBusy || state.followupOpen || state.mastered || state.awaitingNext;
  });
  nextQuestionBtn.disabled = isBusy || state.followupOpen || !state.awaitingNext || !state.pendingReview || state.pendingReview.mastered;
  endReviewBtn.disabled = isBusy || state.followupOpen || !state.topic || state.history.length === 0;
  dontKnowBtn.disabled = state.followupOpen || !canAct();
  newQuestionBtn.disabled = state.followupOpen || !canAct();
  followupBtn.disabled = isBusy || state.followupOpen || !state.awaitingNext || !state.lastReview;
  subjectiveBtn.disabled = state.followupOpen || !canAct();
  if (followupInput) {
    followupInput.disabled = isBusy;
  }
  if (askFollowupBtn) {
    askFollowupBtn.disabled = isBusy || !followupInput.value.trim();
  }
}

function setSessionLabels() {
  topicLabel.textContent = state.topic || "未开始";
  roundLabel.textContent = String(state.history.length);
  stageLabel.textContent = state.currentStage || "-";
  sessionTitle.textContent = state.topic ? `正在回顾：${state.topic}` : "准备开始";
  historyCount.textContent = `${state.history.length} 条`;
  const stats = objectiveStats();
  objectiveLabel.textContent = `${stats.count}/${OBJECTIVE_TARGET} · ${stats.accuracy}%`;
  questionTypeLabel.textContent = questionTypeName(state.currentQuestionType);
}

function renderList(listEl, items, emptyText) {
  const values = items && items.length ? items : [emptyText];
  listEl.replaceChildren(
    ...values.map((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      return li;
    })
  );
}

function normalizeFeedbackText(text) {
  return String(text || "").replaceAll("上一题", "本题");
}

function compactItems(items, limit) {
  return Array.isArray(items) ? items.filter(Boolean).map(normalizeFeedbackText).slice(0, limit) : [];
}

function displayReview(review) {
  const answeredType = review.answeredQuestionType || review.questionType;
  const wasObjective = ["true_false", "single_choice", "multiple_choice"].includes(answeredType);
  if (!wasObjective || review.objectiveCorrect !== false) {
    return review;
  }

  return {
    ...review,
    verdict: "客观题回答错误。",
    positivePoints: (review.positivePoints || []).filter((point) => !point.includes("正确"))
  };
}

function renderFeedback(review) {
  review = displayReview(review);
  feedbackPanel.hidden = false;
  verdictText.textContent = review.verdict;
  feedbackScore.textContent = `${review.score}/100`;
  scoreLabel.textContent = String(review.score);
  state.currentStage = review.stage || state.currentStage;

  renderCoachBlocks(review);

  renderList(basisList, compactItems(review.basis, 2), "本轮没有返回明确依据。");
  renderList(errorList, compactItems(review.errorPoints, 2), "没有明显错误。");

  renderOptionAnalysis(review);
  explanationBlock.hidden = !review.explanation;
  explanationText.textContent = review.explanation || "";
  correctionBlock.hidden = !review.correction;
  correctionText.textContent = review.correction || "";
  verificationBlock.hidden = !review.needsVerification;
  verificationText.textContent = review.verificationNote || "";
  masteryBlock.hidden = !review.mastered;
  masteryText.textContent = review.masterySummary || "你已经达到这一轮的掌握标准。";

  setSessionLabels();
}

function renderCoachBlocks(review) {
  const comparison = review.answerComparison || deriveAnswerComparison(review);
  const selected = comparison && Array.isArray(comparison.selectedIds) && comparison.selectedIds.length
    ? comparison.selectedIds.join("、")
    : comparison && Array.isArray(comparison.selected) && comparison.selected.length
      ? comparison.selected.map((item) => String(item).split(".")[0]).join("、")
      : "未选择";
  const correct = comparison && Array.isArray(comparison.correctIds) && comparison.correctIds.length
    ? comparison.correctIds.join("、")
    : comparison && Array.isArray(comparison.correct) && comparison.correct.length
      ? comparison.correct.map((item) => String(item).split(".")[0]).join("、")
      : "未提供";
  const derivedConclusion = review.objectiveCorrect === true
    ? `回答正确。你的选择是 ${selected}，标准答案是 ${correct}。`
    : review.objectiveCorrect === false
      ? `回答错误。你的选择是 ${selected}，标准答案是 ${correct}。`
      : normalizeFeedbackText(review.conclusion) || "";
  conclusionBlock.hidden = !derivedConclusion;
  conclusionText.textContent = derivedConclusion;
}

function renderFollowupMessages() {
  followupMessages.replaceChildren(
    ...state.followupMessages.map((message) => {
      const item = document.createElement("article");
      item.className = "followup-message";
      item.dataset.role = message.role;
      item.innerHTML = `
        <strong></strong>
        <p></p>
      `;
      item.querySelector("strong").textContent = message.role === "user" ? "你的追问" : "模型回答";
      item.querySelector("p").textContent = normalizeFeedbackText(message.content);
      return item;
    })
  );
}

function openFollowupMode() {
  if (!state.awaitingNext || !state.lastReview) {
    return;
  }
  state.followupOpen = true;
  feedbackPanel.hidden = true;
  followupPanel.hidden = false;
  renderFollowupMessages();
  setBusy(false, "已进入追问答疑。提问不会推进题目进度。");
  followupInput.focus();
}

function closeFollowupMode() {
  state.followupOpen = false;
  followupPanel.hidden = true;
  if (state.awaitingNext && state.lastReview) {
    renderFeedback(state.lastReview);
  }
  setBusy(false, "已回到本题解析。可以继续追问、下一题或结束回顾。");
}

function deriveAnswerComparison(review) {
  const explanations = Array.isArray(review.optionExplanations) ? review.optionExplanations : [];
  if (!explanations.length) {
    return null;
  }
  return {
    selected: explanations.filter((item) => item.wasSelected).map((item) => `${item.id}. ${item.text || ""}`.trim()),
    correct: explanations.filter((item) => item.isCorrect).map((item) => `${item.id}. ${item.text || ""}`.trim())
  };
}

function renderOptionAnalysis(review) {
  const explanations = Array.isArray(review.optionExplanations) ? review.optionExplanations : [];
  optionAnalysisBlock.hidden = explanations.length === 0;
  optionAnalysisList.replaceChildren(
    ...explanations.map((item) => {
      const row = document.createElement("article");
      row.className = "option-analysis-item";
      row.dataset.correct = String(Boolean(item.isCorrect));
      row.innerHTML = `
        <strong></strong>
        <div>
          <p class="option-analysis-title"></p>
          <p class="option-analysis-body"></p>
        </div>
      `;
      row.querySelector("strong").textContent = item.id;
      row.querySelector(".option-analysis-title").textContent = `${item.isCorrect ? "正确选项" : "错误选项"}${item.wasSelected ? " · 你的选择" : ""}`;
      row.querySelector(".option-analysis-body").textContent = normalizeFeedbackText(item.explanation);
      return row;
    })
  );
}

function renderOptions() {
  normalizeCurrentQuestionState();
  const objective = Boolean(state.currentQuestion) && isObjectiveQuestion();
  optionList.hidden = !objective;
  answerInput.hidden = objective;

  if (!objective) {
    optionList.replaceChildren();
    return;
  }

  optionList.replaceChildren(
    ...state.currentOptions.map((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "option-btn";
      button.dataset.optionId = option.id;
      if (state.awaitingNext) {
        const correct = state.currentCorrectAnswer.includes(option.id);
        const selected = state.selectedAnswerIds.includes(option.id);
        if (correct) {
          button.classList.add("option-btn-correct");
        }
        if (selected && !correct) {
          button.classList.add("option-btn-incorrect");
        }
        if (!selected && correct) {
          button.classList.add("option-btn-missed");
        }
      }
      button.setAttribute("aria-pressed", String(state.selectedAnswerIds.includes(option.id)));
      button.innerHTML = `<strong>${option.id}</strong><span></span>`;
      button.querySelector("span").textContent = option.text;
      button.addEventListener("click", () => {
        if (state.currentQuestionType === "multiple_choice") {
          const selected = new Set(state.selectedAnswerIds);
          if (selected.has(option.id)) {
            selected.delete(option.id);
          } else {
            selected.add(option.id);
          }
          state.selectedAnswerIds = [...selected].sort();
        } else {
          state.selectedAnswerIds = [option.id];
        }
        renderOptions();
        setBusy(false, statusText.textContent);
        persistSession();
      });
      return button;
    })
  );
}

function renderHistory() {
  historyList.replaceChildren(
    ...state.history.map((item, index) => {
      const card = document.createElement("article");
      card.className = "history-card";
      card.innerHTML = `
        <div>
          <span>第 ${index + 1} 轮 · ${item.evaluation.stage || "未分阶段"} · ${questionTypeName(item.evaluation.answeredQuestionType || item.evaluation.questionType)}</span>
          <strong>${item.evaluation.score}/100</strong>
        </div>
        <p class="history-question"></p>
        <p class="history-answer"></p>
        <p class="history-verdict"></p>
      `;
      card.querySelector(".history-question").textContent = item.question;
      card.querySelector(".history-answer").textContent = `你的回答：${item.answer || "未填写"}`;
      card.querySelector(".history-verdict").textContent = `评估：${item.evaluation.verdict}`;
      return card;
    })
  );
}

function renderRestoredSession() {
  normalizeCurrentQuestionState();
  topicInput.value = state.topic;
  questionText.textContent = state.currentQuestion || (state.mastered ? "这一知识点已达到当前掌握标准。" : "输入一个知识点后，我会先问第一题。");
  renderOptions();
  if (state.awaitingNext && state.lastReview) {
    renderFeedback(state.lastReview);
  } else {
    feedbackPanel.hidden = true;
  }
  renderHistory();
  setSessionLabels();
  saveTopicSnapshot();
  setBusy(false, state.awaitingNext ? "已恢复解析页。点击“下一题”继续，或点击“结束回顾”。" : state.currentQuestion ? "已恢复上次复习。" : "");
}

async function requestReview(payload) {
  const response = await fetch("/api/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || data.error || "请求失败");
  }
  return data;
}

function applyReviewToQuestion(review) {
  state.awaitingNext = false;
  state.pendingReview = null;
  state.followupOpen = false;
  state.followupMessages = [];
  followupPanel.hidden = true;
  state.currentStage = review.stage || state.currentStage;
  state.currentQuestionType = review.questionType || "short_answer";
  state.currentOptions = Array.isArray(review.options) ? review.options : [];
  state.currentCorrectAnswer = Array.isArray(review.correctAnswer) ? review.correctAnswer : [];
  state.selectedAnswerIds = [];
  normalizeCurrentQuestionState();
  state.mastered = review.mastered;
  state.currentQuestion = review.mastered ? "" : (review.question || review.nextQuestion);
  state.lastReview = review;
  questionText.textContent = review.mastered
    ? "这一知识点已达到当前掌握标准。"
    : review.question || review.nextQuestion || "模型没有返回下一题，请重新开始或换一个知识点。";
  answerInput.value = "";
  renderOptions();
  setSessionLabels();
}

async function startSession(topic, options = {}) {
  Object.assign(state, {
    topic,
    currentQuestion: "",
    currentStage: "",
    currentQuestionType: "short_answer",
    currentOptions: [],
    currentCorrectAnswer: [],
    selectedAnswerIds: [],
    history: [],
    mastered: false,
    lastReview: null,
    lastAnsweredQuestion: "",
    lastAnsweredAnswer: "",
    pendingReview: null,
    awaitingNext: false,
    followupOpen: false,
    followupMessages: []
  });
  feedbackPanel.hidden = true;
  followupPanel.hidden = true;
  historyList.replaceChildren();
  scoreLabel.textContent = "-";
  setSessionLabels();
  setBusy(true, "正在生成第一题...");

  try {
    const review = await requestReview({
      mode: "start",
      topic,
      history: [],
      reviewMode: options.reviewMode || "all",
      focus: options.focus || null,
      sourceHistory: options.sourceHistory || []
    });
    applyReviewToQuestion(review);
    if (review.configurationMissing) {
      renderFeedback(review);
    } else {
      feedbackPanel.hidden = true;
      setSessionLabels();
    }
    persistSession();
    saveTopicSnapshot();
    setBusy(false, state.currentQuestion ? "请回答当前问题。" : "已完成。");
    answerInput.focus();
  } catch (error) {
    questionText.textContent = "生成问题失败，请检查服务端日志和 DeepSeek 配置。";
    setBusy(false, error.message);
  }
}

async function submitAnswer(answer) {
  const question = state.currentQuestion;
  const answerIds = [...state.selectedAnswerIds];
  const displayAnswer = isObjectiveQuestion() ? answerIds.join("、") : answer;
  setBusy(true, "正在评估回答...");

  try {
    const review = await requestReview({
      mode: "answer",
      topic: state.topic,
      currentQuestion: question,
      questionType: state.currentQuestionType,
      options: state.currentOptions,
      correctAnswer: state.currentCorrectAnswer,
      answerIds,
      answer: displayAnswer,
      history: state.history
    });

    review.answeredQuestion = question;
    review.answeredAnswer = displayAnswer;
    state.lastAnsweredQuestion = question;
    state.lastAnsweredAnswer = displayAnswer;
    state.history.push({ question, answer: displayAnswer, evaluation: review });
    state.lastReview = review;
    state.pendingReview = review;
    state.awaitingNext = true;
    state.followupOpen = false;
    state.followupMessages = [];
    state.mastered = review.mastered;
    followupPanel.hidden = true;
    renderOptions();
    renderFeedback(review);
    renderHistory();
    persistSession();
    saveTopicSnapshot();
    setBusy(false, review.mastered ? "已达到掌握标准，可以结束回顾。" : "已显示解析。点击“下一题”继续，或点击“结束回顾”。");
  } catch (error) {
    setBusy(false, error.message);
  }
}

async function requestQuestionMode(mode, message) {
  if (!canAct()) {
    return;
  }
  setBusy(true, message);
  try {
    const review = await requestReview({
      mode,
      topic: state.topic,
      currentQuestion: state.currentQuestion,
      answer: mode === "explain" ? "我不会，需要讲解。" : "",
      stage: state.currentStage,
      questionType: state.currentQuestionType,
      options: state.currentOptions,
      correctAnswer: state.currentCorrectAnswer,
      history: state.history
    });
    applyReviewToQuestion(review);
    feedbackPanel.hidden = true;
    persistSession();
    saveTopicSnapshot();
    setBusy(false, "已更新当前问题。");
    answerInput.focus();
  } catch (error) {
    setBusy(false, error.message);
  }
}

async function requestSubjectiveQuestion() {
  if (!canAct()) {
    return;
  }
  setBusy(true, "正在生成主观题...");
  try {
    const review = await requestReview({
      mode: "subjective",
      topic: state.topic,
      currentQuestion: state.currentQuestion,
      stage: state.currentStage,
      questionType: "short_answer",
      history: state.history
    });
    applyReviewToQuestion({ ...review, questionType: "short_answer", options: [], correctAnswer: [] });
    feedbackPanel.hidden = true;
    persistSession();
    saveTopicSnapshot();
    setBusy(false, "请回答主观题。");
    answerInput.focus();
  } catch (error) {
    setBusy(false, error.message);
  }
}

async function askFollowupQuestion(question) {
  if (!state.awaitingNext || !state.lastReview || state.busy) {
    return;
  }
  state.followupMessages = [{ role: "user", content: question }];
  renderFollowupMessages();
  followupInput.value = "";
  setBusy(true, "正在回答追问...");

  try {
    const review = await requestReview({
      mode: "followup",
      topic: state.topic,
      currentQuestion: state.lastAnsweredQuestion || state.currentQuestion,
      questionType: state.lastReview.answeredQuestionType || state.lastReview.questionType,
      options: state.lastReview.options || state.currentOptions,
      correctAnswer: state.lastReview.correctAnswer || state.currentCorrectAnswer,
      answer: state.lastAnsweredAnswer,
      followupQuestion: question,
      lastReview: {
        verdict: state.lastReview.verdict,
        conclusion: state.lastReview.conclusion,
        basis: state.lastReview.basis,
        errorPoints: state.lastReview.errorPoints,
        questionAnalysis: state.lastReview.questionAnalysis,
        optionExplanations: state.lastReview.optionExplanations
      },
      history: state.history
    });
    const answer = review.followupAnswer || review.explanation || review.questionAnalysis || "这次追问没有返回有效回答，请换一种问法再试。";
    state.followupMessages = [
      { role: "user", content: question },
      { role: "assistant", content: answer }
    ];
    renderFollowupMessages();
    persistSession();
    setBusy(false, "追问已回答。可以继续提问，或点“继续回顾”。");
  } catch (error) {
    state.followupMessages = [
      { role: "user", content: question },
      { role: "assistant", content: `追问回答失败：${error.message}` }
    ];
    renderFollowupMessages();
    setBusy(false, error.message);
  }
}

function goToNextQuestion() {
  if (!state.pendingReview || state.pendingReview.mastered) {
    return;
  }
  applyReviewToQuestion(state.pendingReview);
  feedbackPanel.hidden = true;
  followupPanel.hidden = true;
  persistSession();
  saveTopicSnapshot();
  setBusy(false, "请回答当前问题。");
  answerInput.focus();
}

function endReview() {
  if (!state.topic) {
    return;
  }
  state.mastered = true;
  state.awaitingNext = false;
  state.pendingReview = null;
  state.currentQuestion = "";
  state.selectedAnswerIds = [];
  state.followupOpen = false;
  state.followupMessages = [];
  questionText.textContent = `“${state.topic}”本轮回顾已结束。`;
  renderOptions();
  followupPanel.hidden = true;
  persistSession();
  saveTopicSnapshot();
  setSessionLabels();
  setBusy(false, "本轮回顾已结束。");
}

function resetSession() {
  Object.assign(state, {
    topic: "",
    currentQuestion: "",
    currentStage: "",
    currentQuestionType: "short_answer",
    currentOptions: [],
    currentCorrectAnswer: [],
    selectedAnswerIds: [],
    history: [],
    busy: false,
    mastered: false,
    lastReview: null,
    lastAnsweredQuestion: "",
    lastAnsweredAnswer: "",
    pendingReview: null,
    awaitingNext: false,
    followupOpen: false,
    followupMessages: []
  });
  localStorage.removeItem(STORAGE_KEY);
  topicInput.value = "";
  answerInput.value = "";
  optionList.replaceChildren();
  optionList.hidden = true;
  answerInput.hidden = false;
  questionText.textContent = "输入一个知识点后，我会先问第一题。";
  feedbackPanel.hidden = true;
  followupPanel.hidden = true;
  followupMessages.replaceChildren();
  historyList.replaceChildren();
  scoreLabel.textContent = "-";
  setSessionLabels();
  setBusy(false, "");
}

topicForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const topic = topicInput.value.trim();
  if (topic) {
    startSession(topic);
  }
});

answerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const answer = answerInput.value.trim();
  if (hasAnswer() && state.currentQuestion && !state.busy) {
    submitAnswer(answer);
  }
});

answerInput.addEventListener("input", () => {
  setBusy(false, statusText.textContent);
});

dontKnowBtn.addEventListener("click", () => {
  requestQuestionMode("explain", "正在生成讲解...");
});

newQuestionBtn.addEventListener("click", () => {
  requestQuestionMode("newQuestion", "正在换一题...");
});

followupBtn.addEventListener("click", () => {
  openFollowupMode();
});

subjectiveBtn.addEventListener("click", requestSubjectiveQuestion);
nextQuestionBtn.addEventListener("click", goToNextQuestion);
endReviewBtn.addEventListener("click", endReview);
resetBtn.addEventListener("click", resetSession);

followupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const question = followupInput.value.trim();
  if (question) {
    askFollowupQuestion(question);
  }
});

followupInput.addEventListener("input", () => {
  setBusy(false, statusText.textContent);
});

continueReviewBtn.addEventListener("click", closeFollowupMode);

if (restoreSession()) {
  renderRestoredSession();
} else {
  resetSession();
}
renderTopicLibrary();
