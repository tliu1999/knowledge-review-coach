const STORAGE_KEY = "knowledge-review-coach-session";
const TOPICS_KEY = "knowledge-review-coach-topics";
const OBJECTIVE_TARGET = 100;
const STAGE_TARGET = 10;
const CONTENT_ASPECT_TARGET = 10;
const BANK_QUESTIONS_PER_ASPECT = 10;
const BANK_QUESTIONS_PER_BATCH = 5;
const SUPPLEMENT_TARGET_BUFFER = 20;
const SUPPLEMENT_MAX_ASPECTS = 4;

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
  lastAnsweredQuestionType: "short_answer",
  lastAnsweredOptions: [],
  lastAnsweredCorrectAnswer: [],
  lastAnsweredSelectedAnswerIds: [],
  pendingReview: null,
  awaitingNext: false,
  followupOpen: false,
  followupMessages: [],
  questionBank: [],
  questionIndex: 0,
  coveragePlan: [],
  aspectSubpoints: {},
  bankProgress: [],
  bankReady: false,
  planningNote: ""
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
const bankProgressPanel = document.querySelector("#bankProgressPanel");
const bankProgressTitle = document.querySelector("#bankProgressTitle");
const bankProgressCount = document.querySelector("#bankProgressCount");
const bankProgressFill = document.querySelector("#bankProgressFill");
const bankProgressDetail = document.querySelector("#bankProgressDetail");
const bankProgressList = document.querySelector("#bankProgressList");
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
    lastAnsweredQuestionType: state.lastAnsweredQuestionType,
    lastAnsweredOptions: state.lastAnsweredOptions,
    lastAnsweredCorrectAnswer: state.lastAnsweredCorrectAnswer,
    lastAnsweredSelectedAnswerIds: state.lastAnsweredSelectedAnswerIds,
    history: state.history,
    questionBank: state.questionBank,
    questionIndex: state.questionIndex,
    coveragePlan: state.coveragePlan,
    aspectSubpoints: state.aspectSubpoints,
    bankReady: state.bankReady,
    planningNote: state.planningNote,
    stats
  };
  const nextTopics = [topicRecord, ...topics.filter((item) => item.topic !== state.topic)].slice(0, 40);
  saveStoredTopics(nextTopics);
  renderTopicLibrary();
}

function weakFocusFromRecord(record) {
  const weakItems = record.stats?.weakItems || [];
  const weakStages = [...new Set(weakItems.map((item) => item.evaluation?.stage).filter(Boolean))];
  const weakAspects = [...new Set(weakItems.map((item) => item.evaluation?.knowledgeAspect).filter(Boolean))];
  const weakNotes = weakItems.flatMap((item) => [
    ...(item.evaluation?.errorPoints || []),
    ...(item.evaluation?.missingPoints || []),
    ...(item.evaluation?.gaps || [])
  ]).filter(Boolean).slice(0, 8);
  return {
    mode: "weak",
    stages: weakStages,
    aspects: weakAspects,
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
    lastAnsweredQuestionType: state.lastAnsweredQuestionType,
    lastAnsweredOptions: state.lastAnsweredOptions,
    lastAnsweredCorrectAnswer: state.lastAnsweredCorrectAnswer,
    lastAnsweredSelectedAnswerIds: state.lastAnsweredSelectedAnswerIds,
    pendingReview: state.pendingReview,
    awaitingNext: state.awaitingNext,
    followupMessages: state.followupMessages,
    questionBank: state.questionBank,
    questionIndex: state.questionIndex,
    coveragePlan: state.coveragePlan,
    aspectSubpoints: state.aspectSubpoints,
    bankProgress: state.bankProgress,
    bankReady: state.bankReady,
    planningNote: state.planningNote
  }));
}

function idsFromAnswerText(answer) {
  return String(answer || "")
    .split(/[、,，\s]+/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function hydrateAnsweredSnapshotFromHistory() {
  if (!state.awaitingNext) {
    return;
  }
  const lastHistoryItem = state.history.at(-1);
  const evaluation = state.lastReview || lastHistoryItem?.evaluation;
  if (!evaluation) {
    return;
  }
  const explanations = Array.isArray(evaluation.optionExplanations) ? evaluation.optionExplanations : [];
  const answeredType = isObjectiveType(evaluation.answeredQuestionType)
    ? evaluation.answeredQuestionType
    : isObjectiveType(state.lastAnsweredQuestionType)
      ? state.lastAnsweredQuestionType
      : isObjectiveType(lastHistoryItem?.evaluation?.questionType)
        ? lastHistoryItem.evaluation.questionType
        : "";

  state.lastReview = state.lastReview || evaluation;
  state.lastAnsweredQuestion = state.lastAnsweredQuestion || evaluation.answeredQuestion || lastHistoryItem?.question || "";
  state.lastAnsweredAnswer = state.lastAnsweredAnswer || evaluation.answeredAnswer || lastHistoryItem?.answer || "";

  if (answeredType) {
    state.lastAnsweredQuestionType = answeredType;
  }
  if (!state.lastAnsweredOptions.length && explanations.length) {
    state.lastAnsweredOptions = explanations
      .filter((item) => item.id && item.text)
      .map((item) => ({ id: item.id, text: item.text }));
  }
  if (!state.lastAnsweredCorrectAnswer.length) {
    const correctIds = evaluation.answerComparison?.correctIds;
    state.lastAnsweredCorrectAnswer = Array.isArray(correctIds) && correctIds.length
      ? correctIds
      : explanations.filter((item) => item.isCorrect).map((item) => item.id).filter(Boolean);
  }
  if (!state.lastAnsweredSelectedAnswerIds.length) {
    const selectedIds = evaluation.answerComparison?.selectedIds;
    state.lastAnsweredSelectedAnswerIds = Array.isArray(selectedIds) && selectedIds.length
      ? selectedIds
      : explanations.filter((item) => item.wasSelected).map((item) => item.id).filter(Boolean);
  }
  if (!state.lastAnsweredSelectedAnswerIds.length) {
    state.lastAnsweredSelectedAnswerIds = idsFromAnswerText(state.lastAnsweredAnswer);
  }
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
      lastAnsweredQuestionType: saved.lastAnsweredQuestionType || "short_answer",
      lastAnsweredOptions: Array.isArray(saved.lastAnsweredOptions) ? saved.lastAnsweredOptions : [],
      lastAnsweredCorrectAnswer: Array.isArray(saved.lastAnsweredCorrectAnswer) ? saved.lastAnsweredCorrectAnswer : [],
      lastAnsweredSelectedAnswerIds: Array.isArray(saved.lastAnsweredSelectedAnswerIds) ? saved.lastAnsweredSelectedAnswerIds : [],
      pendingReview: saved.pendingReview || null,
      awaitingNext: Boolean(saved.awaitingNext),
      followupOpen: false,
      followupMessages: Array.isArray(saved.followupMessages) ? saved.followupMessages : [],
      questionBank: Array.isArray(saved.questionBank) ? saved.questionBank : [],
      questionIndex: Number(saved.questionIndex || 0),
      coveragePlan: Array.isArray(saved.coveragePlan) ? saved.coveragePlan : [],
      aspectSubpoints: saved.aspectSubpoints && typeof saved.aspectSubpoints === "object" ? saved.aspectSubpoints : {},
      bankProgress: Array.isArray(saved.bankProgress) ? saved.bankProgress : [],
      bankReady: Boolean(saved.bankReady),
      planningNote: saved.planningNote || ""
    });
    hydrateAnsweredSnapshotFromHistory();
    return true;
  } catch {
    return false;
  }
}

function canAct() {
  return Boolean(state.currentQuestion && !state.busy && !state.mastered && !state.awaitingNext);
}

function canSwitchQuestionMode() {
  return Boolean(state.topic && state.currentQuestion && !state.busy && !state.mastered && !state.awaitingNext);
}

function isObjectiveType(type) {
  return ["true_false", "single_choice", "multiple_choice"].includes(type);
}

function isObjectiveQuestion() {
  return isObjectiveType(state.currentQuestionType);
}

function normalizeCurrentQuestionState() {
  if (isObjectiveQuestion() && (!state.currentOptions || state.currentOptions.length === 0)) {
    state.currentQuestionType = "short_answer";
    state.currentOptions = [];
    state.currentCorrectAnswer = [];
    state.selectedAnswerIds = [];
  }
  if (state.currentQuestionType === "multiple_choice" && state.currentCorrectAnswer.length === 1) {
    state.currentQuestionType = "single_choice";
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

function aspectStats() {
  const objective = state.history.filter((item) => ["true_false", "single_choice", "multiple_choice"].includes(item.evaluation?.answeredQuestionType || item.evaluation?.questionType));
  const aspectMap = new Map();
  state.coveragePlan.forEach((aspect) => {
    aspectMap.set(aspect, { aspect, count: 0, correct: 0 });
  });
  objective.forEach((item) => {
    const aspect = item.evaluation?.knowledgeAspect || "未标注方面";
    const current = aspectMap.get(aspect) || { aspect, count: 0, correct: 0 };
    current.count += 1;
    if (item.evaluation?.objectiveCorrect) {
      current.correct += 1;
    }
    aspectMap.set(aspect, current);
  });
  return [...aspectMap.values()].map((item) => ({
    ...item,
    accuracy: item.count ? Math.round((item.correct / item.count) * 100) : 0
  }));
}

function masterySnapshot() {
  const stats = objectiveStats();
  const aspects = aspectStats();
  const recentScores = state.history.slice(-3).map((item) => Number(item.evaluation?.score || 0));
  const recentAverage = recentScores.length
    ? Math.round(recentScores.reduce((sum, score) => sum + score, 0) / recentScores.length)
    : 0;
  const hasLowRecent = recentScores.some((score) => score < 75);
  const latest = state.lastReview || state.history.at(-1)?.evaluation || {};
  const hasOpenRisk = Boolean(latest.needsVerification)
    || (latest.errorPoints || []).length > 0
    || (latest.missingPoints || []).length > 1;
  const totalTarget = Math.max(state.questionBank.length || OBJECTIVE_TARGET, OBJECTIVE_TARGET);
  const objectiveProgress = Math.min(1, stats.count / totalTarget);
  const accuracyProgress = Math.min(1, stats.accuracy / 85);
  const enoughAspectCount = aspects.filter((item) => item.count >= STAGE_TARGET).length;
  const requiredAspects = Math.max(state.coveragePlan.length || CONTENT_ASPECT_TARGET, CONTENT_ASPECT_TARGET);
  const aspectProgress = Math.min(1, enoughAspectCount / requiredAspects);
  const recentProgress = recentScores.length >= 3 && recentAverage >= 85 && !hasLowRecent ? 1 : Math.min(1, recentAverage / 85);
  const progress = Math.round(((objectiveProgress + accuracyProgress + aspectProgress + recentProgress) / 4) * 100);
  return {
    stats,
    aspects,
    recentScores,
    recentAverage,
    hasLowRecent,
    hasOpenRisk,
    progress
  };
}

function masteryStatusSentence() {
  const snapshot = masterySnapshot();
  const { stats, aspects, recentScores, recentAverage, hasLowRecent, hasOpenRisk, progress } = snapshot;
  const totalTarget = Math.max(state.questionBank.length || OBJECTIVE_TARGET, OBJECTIVE_TARGET);
  const requiredAspects = Math.max(state.coveragePlan.length || CONTENT_ASPECT_TARGET, CONTENT_ASPECT_TARGET);
  const enoughObjective = stats.count >= totalTarget;
  const enoughAccuracy = stats.accuracy >= 85;
  const enoughAspectCount = aspects.filter((item) => item.count >= STAGE_TARGET).length;
  const enoughAspects = enoughAspectCount >= requiredAspects;
  const stableRecent = recentScores.length >= 3 && recentAverage >= 85 && !hasLowRecent;
  const ready = enoughObjective && enoughAccuracy && enoughAspects && stableRecent && !hasOpenRisk;
  if (state.mastered || ready) {
    return "当前掌握情况：已达到掌握标准。";
  }
  const gaps = [];
  if (!enoughAspects) {
    const weakAspects = aspects
      .filter((item) => item.count < STAGE_TARGET)
      .sort((a, b) => a.count - b.count)
      .slice(0, 3)
      .map((item) => `${item.aspect} ${item.count}/${STAGE_TARGET}`);
    const aspectText = weakAspects.length ? `未达标：${weakAspects.join("、")}` : "尚未形成内容方面覆盖";
    gaps.push(`内容方面达标 ${enoughAspectCount}/${requiredAspects}，${aspectText}`);
  }
  if (!enoughObjective) gaps.push(`总客观题 ${stats.count}/${totalTarget}`);
  if (!enoughAccuracy) gaps.push(`正确率 ${stats.accuracy}%/85%`);
  if (recentScores.length < 3) gaps.push("最近表现样本不足");
  else if (!stableRecent) gaps.push(`最近 3 轮均分 ${recentAverage}/85`);
  if (hasOpenRisk) gaps.push("仍有错误风险");
  return `当前掌握情况：约 ${progress}%，${gaps.join("，")}。`;
}

function renderBankProgress({ title = "", detail = "", currentIndex = -1, completedCount = state.questionBank.length } = {}) {
  const totalTarget = Math.max(state.coveragePlan.length * BANK_QUESTIONS_PER_ASPECT, OBJECTIVE_TARGET);
  const percent = totalTarget ? Math.min(100, Math.round((completedCount / totalTarget) * 100)) : 0;
  bankProgressPanel.hidden = false;
  bankProgressTitle.textContent = title || "正在生成题库";
  bankProgressCount.textContent = `${completedCount}/${totalTarget}`;
  bankProgressFill.style.width = `${percent}%`;
  bankProgressDetail.textContent = detail || "请稍等，题库生成完成后会自动进入第一题。";
  bankProgressList.replaceChildren(
    ...state.bankProgress.map((item, index) => {
      const row = document.createElement("article");
      const status = index === currentIndex ? "running" : item.status || "pending";
      row.className = "bank-progress-item";
      row.dataset.status = status;
      row.innerHTML = "<span></span><strong></strong>";
      row.querySelector("span").textContent = `${index + 1}. ${item.aspect}`;
      row.querySelector("strong").textContent = status === "done"
        ? `完成 ${item.count || 0} 题`
        : status === "running"
          ? "生成中"
          : status === "partial"
            ? `已有 ${item.count || 0} 题`
            : "等待中";
      return row;
    })
  );
}

function hideBankProgress() {
  bankProgressPanel.hidden = true;
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
  const totalTarget = Math.max(state.coveragePlan.length * BANK_QUESTIONS_PER_ASPECT, OBJECTIVE_TARGET);
  const hasNextQuestion = state.questionIndex < state.questionBank.length - 1;
  const canSupplementBank = Boolean(state.topic && state.coveragePlan.length && state.questionBank.length < totalTarget);
  nextQuestionBtn.disabled = isBusy || !state.awaitingNext || state.mastered || (!hasNextQuestion && !canSupplementBank);
  endReviewBtn.disabled = isBusy || !state.topic || state.history.length === 0;
  dontKnowBtn.disabled = state.followupOpen || !canAct();
  newQuestionBtn.disabled = state.followupOpen || !canAct();
  followupBtn.disabled = isBusy || state.followupOpen || !state.awaitingNext || !state.lastReview;
  subjectiveBtn.disabled = !canSwitchQuestionMode();
  if (followupInput) {
    followupInput.disabled = isBusy;
  }
  if (askFollowupBtn) {
    askFollowupBtn.disabled = isBusy || !followupInput.value.trim();
  }
}

function setSessionLabels() {
  normalizeCurrentQuestionState();
  topicLabel.textContent = state.topic || "未开始";
  roundLabel.textContent = String(state.history.length);
  stageLabel.textContent = state.currentStage || "-";
  sessionTitle.textContent = state.topic ? `正在回顾：${state.topic}` : "准备开始";
  historyCount.textContent = `${state.history.length} 条`;
  const stats = objectiveStats();
  const totalTarget = Math.max(state.questionBank.length || OBJECTIVE_TARGET, OBJECTIVE_TARGET);
  objectiveLabel.textContent = `${stats.count}/${totalTarget} · ${stats.accuracy}%`;
  questionTypeLabel.textContent = questionTypeName(state.currentQuestionType);
  subjectiveBtn.textContent = isObjectiveQuestion() ? "主观题" : "客观题";
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
  setBusy(false, "已进入追问答疑。可以提问，也可以直接点“下一题”继续。");
  followupInput.focus();
}

function restoreAnsweredQuestionView() {
  if (!state.lastAnsweredQuestion) {
    return;
  }
  const explanations = Array.isArray(state.lastReview?.optionExplanations) ? state.lastReview.optionExplanations : [];
  const answeredType = ["true_false", "single_choice", "multiple_choice"].includes(state.lastReview?.answeredQuestionType)
    ? state.lastReview.answeredQuestionType
    : state.lastAnsweredQuestionType || state.currentQuestionType;
  const fallbackOptions = explanations
    .filter((item) => item.id && item.text)
    .map((item) => ({ id: item.id, text: item.text }));
  const fallbackCorrect = explanations
    .filter((item) => item.isCorrect)
    .map((item) => item.id);
  const fallbackSelected = explanations
    .filter((item) => item.wasSelected)
    .map((item) => item.id);

  state.currentQuestion = state.lastAnsweredQuestion;
  state.currentQuestionType = answeredType;
  state.currentOptions = state.lastAnsweredOptions.length ? state.lastAnsweredOptions : fallbackOptions;
  state.currentCorrectAnswer = state.lastAnsweredCorrectAnswer.length ? state.lastAnsweredCorrectAnswer : fallbackCorrect;
  state.selectedAnswerIds = state.lastAnsweredSelectedAnswerIds.length ? state.lastAnsweredSelectedAnswerIds : fallbackSelected;
  state.lastAnsweredQuestionType = state.currentQuestionType;
  state.lastAnsweredOptions = state.currentOptions.map((option) => ({ ...option }));
  state.lastAnsweredCorrectAnswer = [...state.currentCorrectAnswer];
  state.lastAnsweredSelectedAnswerIds = [...state.selectedAnswerIds];
  questionText.textContent = state.lastAnsweredQuestion;
  normalizeCurrentQuestionState();
  renderOptions();
  setSessionLabels();
}

function closeFollowupMode() {
  state.followupOpen = false;
  followupPanel.hidden = true;
  if (state.awaitingNext && state.lastReview) {
    restoreAnsweredQuestionView();
    renderFeedback(state.lastReview);
  }
  setBusy(false, `已回到本题解析。可以继续追问、下一题或结束回顾。${masteryStatusSentence()}`);
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
  if (state.questionBank.length && !state.awaitingNext && !state.mastered) {
    const current = bankQuestionAt() || state.questionBank[0];
    applyBankQuestion(current, state.questionBank[state.questionIndex] ? state.questionIndex : 0);
  }
  normalizeCurrentQuestionState();
  topicInput.value = state.topic;
  questionText.textContent = state.currentQuestion || (state.mastered ? "这一知识点已达到当前掌握标准。" : "输入一个知识点后，我会先问第一题。");
  renderOptions();
  if (state.awaitingNext && state.lastReview) {
    restoreAnsweredQuestionView();
    renderFeedback(state.lastReview);
    persistSession();
    saveTopicSnapshot();
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
  state.lastAnsweredQuestion = "";
  state.lastAnsweredAnswer = "";
  state.lastAnsweredQuestionType = "short_answer";
  state.lastAnsweredOptions = [];
  state.lastAnsweredCorrectAnswer = [];
  state.lastAnsweredSelectedAnswerIds = [];
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

function applyBankQuestion(question, index = state.questionIndex) {
  if (!question) {
    state.currentQuestion = "";
    state.currentQuestionType = "short_answer";
    state.currentOptions = [];
    state.currentCorrectAnswer = [];
    state.selectedAnswerIds = [];
    questionText.textContent = "题库已完成。可以结束回顾，或从最近回顾中再次生成重点题库。";
    setSessionLabels();
    renderOptions();
    return;
  }
  state.questionIndex = index;
  state.awaitingNext = false;
  state.pendingReview = null;
  state.followupOpen = false;
  state.followupMessages = [];
  state.lastAnsweredQuestion = "";
  state.lastAnsweredAnswer = "";
  state.lastAnsweredQuestionType = "short_answer";
  state.lastAnsweredOptions = [];
  state.lastAnsweredCorrectAnswer = [];
  state.lastAnsweredSelectedAnswerIds = [];
  state.currentStage = question.stage || state.currentStage || "-";
  state.currentQuestionType = question.questionType;
  state.currentOptions = Array.isArray(question.options) ? question.options : [];
  state.currentCorrectAnswer = Array.isArray(question.correctAnswer) ? question.correctAnswer : [];
  state.selectedAnswerIds = [];
  state.currentQuestion = question.question;
  state.lastReview = null;
  state.mastered = false;
  answerInput.value = "";
  questionText.textContent = question.question;
  feedbackPanel.hidden = true;
  followupPanel.hidden = true;
  hideBankProgress();
  normalizeCurrentQuestionState();
  renderOptions();
  setSessionLabels();
}

function bankQuestionAt(index = state.questionIndex) {
  return state.questionBank[index] || null;
}

function normalizeClientBankQuestion(question) {
  const correctAnswer = Array.isArray(question.correctAnswer) ? question.correctAnswer.map(String).sort() : [];
  const questionType = question.questionType === "multiple_choice" && correctAnswer.length < 2
    ? "single_choice"
    : question.questionType;
  return {
    ...question,
    questionType,
    correctAnswer,
    focusSubpoint: String(question.focusSubpoint || question.subpoint || "").trim()
  };
}

function normalizedQuestionKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[“”"'`，。！？、；：,.!?;:\s]/g, "");
}

function questionTokens(value) {
  const normalized = normalizedQuestionKey(value);
  const chars = [...normalized];
  if (chars.length < 2) {
    return chars;
  }
  return chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`);
}

function questionSimilarity(left, right) {
  const leftTokens = new Set(questionTokens(left));
  const rightTokens = new Set(questionTokens(right));
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }
  const intersection = [...leftTokens].filter((item) => rightTokens.has(item)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function isSimilarToExistingQuestion(question, existingQuestions) {
  const key = normalizedQuestionKey(question);
  return existingQuestions.some((existing) => {
    const prior = normalizedQuestionKey(existing);
    return prior === key
      || prior.includes(key)
      || key.includes(prior)
      || questionSimilarity(prior, key) >= 0.72;
  });
}

function filterDiverseQuestions(questions, existingQuestions, existingSubpoints) {
  const accepted = [];
  const usedSubpoints = new Set(existingSubpoints.filter(Boolean));
  for (const question of questions) {
    const pool = [...existingQuestions, ...accepted.map((item) => item.question)];
    if (isSimilarToExistingQuestion(question.question, pool)) {
      continue;
    }
    if (question.focusSubpoint && usedSubpoints.has(question.focusSubpoint)) {
      continue;
    }
    accepted.push(question);
    if (question.focusSubpoint) {
      usedSubpoints.add(question.focusSubpoint);
    }
  }
  return accepted;
}

function questionCountForAspect(aspect) {
  return state.questionBank.filter((question) => question.knowledgeAspect === aspect).length;
}

function syncBankProgressFromBank() {
  if (!state.coveragePlan.length) {
    return;
  }
  state.bankProgress = state.coveragePlan.map((aspect) => {
    const count = questionCountForAspect(aspect);
      return {
        aspect,
        status: count >= BANK_QUESTIONS_PER_ASPECT ? "done" : count > 0 ? "partial" : "pending",
        count
      };
    });
}

function weakAspectFromHistory() {
  const weak = state.history
    .filter((item) => item.evaluation?.objectiveCorrect === false || Number(item.evaluation?.score || 0) < 85)
    .map((item) => item.evaluation?.knowledgeAspect)
    .filter(Boolean);
  return weak.at(-1) || "";
}

function supplementCandidates(allowExtra = false) {
  const candidates = state.coveragePlan
    .map((aspect) => ({ aspect, count: questionCountForAspect(aspect) }))
    .filter((item) => allowExtra || item.count < BANK_QUESTIONS_PER_ASPECT)
    .sort((a, b) => a.count - b.count);
  const weakAspect = weakAspectFromHistory();
  if (weakAspect) {
    const weakIndex = candidates.findIndex((item) => item.aspect === weakAspect);
    if (weakIndex > 0) {
      const [weak] = candidates.splice(weakIndex, 1);
      candidates.unshift(weak);
    }
  }
  return candidates;
}

async function supplementQuestionBank() {
  const totalTarget = Math.max(state.coveragePlan.length * BANK_QUESTIONS_PER_ASPECT, OBJECTIVE_TARGET);
  if (!state.topic || !state.coveragePlan.length || state.questionBank.length >= totalTarget) {
    return 0;
  }
  syncBankProgressFromBank();
  const targetAdded = Math.min(SUPPLEMENT_TARGET_BUFFER, totalTarget - state.questionBank.length);
  let addedCount = 0;
  const baseCandidates = supplementCandidates(false);
  const candidates = baseCandidates.length ? baseCandidates : supplementCandidates(true);
  for (const candidate of candidates.slice(0, SUPPLEMENT_MAX_ASPECTS)) {
    if (addedCount >= targetAdded) {
      break;
    }
    const aspect = candidate.aspect;
    const aspectIndex = state.coveragePlan.indexOf(aspect);
    const subpointsForAspect = Array.isArray(state.aspectSubpoints[aspect]) ? state.aspectSubpoints[aspect] : [];
    const existingForAspect = state.questionBank.filter((item) => item.knowledgeAspect === aspect);
    const aspectGap = Math.max(0, BANK_QUESTIONS_PER_ASPECT - existingForAspect.length);
    const allowExtra = baseCandidates.length === 0;
    const needed = Math.min(
      BANK_QUESTIONS_PER_ASPECT,
      allowExtra ? BANK_QUESTIONS_PER_ASPECT : aspectGap,
      targetAdded - addedCount,
      totalTarget - state.questionBank.length
    );
    if (needed <= 0) {
      continue;
    }
    const message = `当前题库余量不足，正在批量补题：为「${aspect}」补充最多 ${needed} 道不相似题目...`;
    setBusy(true, message);
    renderBankProgress({
      title: `正在批量补题：${aspect}`,
      detail: message,
      currentIndex: Math.max(0, aspectIndex),
      completedCount: state.questionBank.length
    });
    const result = await requestReview({
      mode: "bankQuestions",
      topic: state.topic,
      aspect,
      aspectIndex,
      coveragePlan: state.coveragePlan,
      questionCount: needed,
      subpointsForAspect,
      existingSubpoints: existingForAspect.map((item) => item.focusSubpoint).filter(Boolean),
      existingQuestions: state.questionBank.map((item) => item.question).slice(-80)
    });
    const questions = Array.isArray(result.questions) ? result.questions.map(normalizeClientBankQuestion) : [];
    const diverseQuestions = filterDiverseQuestions(
      questions,
      state.questionBank.map((item) => item.question),
      existingForAspect.map((item) => item.focusSubpoint)
    );
    if (diverseQuestions.length) {
      state.questionBank.push(...diverseQuestions);
      addedCount += diverseQuestions.length;
      const progressIndex = state.bankProgress.findIndex((item) => item.aspect === aspect);
      if (progressIndex >= 0) {
        state.bankProgress[progressIndex] = {
          aspect,
          status: questionCountForAspect(aspect) >= BANK_QUESTIONS_PER_ASPECT ? "done" : "partial",
          count: questionCountForAspect(aspect)
        };
      }
      persistSession();
      saveTopicSnapshot();
    }
  }
  return addedCount;
}

async function generateQuestionBank(topic, options = {}) {
  setBusy(true, "正在规划题库内容方面...");
  renderBankProgress({
    title: "正在规划题库内容方面",
    detail: "模型正在先拆解这个知识点的完整内容范围，完成后会分方面生成题目。",
    completedCount: 0
  });
  const plan = await requestReview({
    mode: "bankPlan",
    topic,
    reviewMode: options.reviewMode || "all",
    focus: options.focus || null,
    sourceHistory: options.sourceHistory || []
  });
  state.coveragePlan = Array.isArray(plan.coveragePlan) ? plan.coveragePlan : [];
  state.aspectSubpoints = plan.aspectSubpoints && typeof plan.aspectSubpoints === "object" ? plan.aspectSubpoints : {};
  state.planningNote = plan.planningNote || "";
  state.bankProgress = state.coveragePlan.map((aspect) => ({ aspect, status: "pending", count: 0 }));
  if (!state.coveragePlan.length) {
    throw new Error(plan.configurationMissing ? plan.planningNote : "题库内容方面生成失败，请稍后重试。");
  }
  const bank = [];
  for (const [index, aspect] of state.coveragePlan.entries()) {
    state.bankProgress[index] = { aspect, status: "running", count: 0 };
    const aspectQuestions = [];
    const subpointsForAspect = Array.isArray(state.aspectSubpoints[aspect]) ? state.aspectSubpoints[aspect] : [];
    for (let offset = 0; offset < BANK_QUESTIONS_PER_ASPECT; offset += BANK_QUESTIONS_PER_BATCH) {
      const batchNumber = Math.floor(offset / BANK_QUESTIONS_PER_BATCH) + 1;
      const batchTotal = Math.ceil(BANK_QUESTIONS_PER_ASPECT / BANK_QUESTIONS_PER_BATCH);
      const message = `正在生成题库：${index + 1}/${state.coveragePlan.length}「${aspect}」第 ${batchNumber}/${batchTotal} 批，已完成 ${bank.length + aspectQuestions.length} 题`;
      setBusy(true, message);
      renderBankProgress({
        title: `正在生成：${aspect}`,
        detail: message,
        currentIndex: index,
        completedCount: bank.length + aspectQuestions.length
      });
      const result = await requestReview({
        mode: "bankQuestions",
        topic,
        aspect,
        aspectIndex: index,
        coveragePlan: state.coveragePlan,
        reviewMode: options.reviewMode || "all",
        focus: options.focus || null,
        questionCount: BANK_QUESTIONS_PER_BATCH,
        subpointsForAspect,
        existingSubpoints: aspectQuestions.map((item) => item.focusSubpoint).filter(Boolean),
        existingQuestions: [...bank, ...aspectQuestions].map((item) => item.question).slice(-60)
      });
      const questions = Array.isArray(result.questions) ? result.questions.map(normalizeClientBankQuestion) : [];
      const diverseQuestions = filterDiverseQuestions(
        questions,
        [...bank, ...aspectQuestions].map((item) => item.question),
        aspectQuestions.map((item) => item.focusSubpoint)
      );
      aspectQuestions.push(...diverseQuestions);
      if (result.generationWarning) {
        setBusy(true, `${message}。有一批 JSON 修复失败，已跳过并继续。`);
      }
    }
    for (let retry = 0; aspectQuestions.length < BANK_QUESTIONS_PER_ASPECT && retry < 2; retry += 1) {
      const needed = Math.min(BANK_QUESTIONS_PER_BATCH, BANK_QUESTIONS_PER_ASPECT - aspectQuestions.length);
      const message = `正在补齐题库：${index + 1}/${state.coveragePlan.length}「${aspect}」还差 ${BANK_QUESTIONS_PER_ASPECT - aspectQuestions.length} 题`;
      setBusy(true, message);
      renderBankProgress({
        title: `正在补齐：${aspect}`,
        detail: message,
        currentIndex: index,
        completedCount: bank.length + aspectQuestions.length
      });
      const result = await requestReview({
        mode: "bankQuestions",
        topic,
        aspect,
        aspectIndex: index,
        coveragePlan: state.coveragePlan,
        reviewMode: options.reviewMode || "all",
        focus: options.focus || null,
        questionCount: needed,
        subpointsForAspect,
        existingSubpoints: aspectQuestions.map((item) => item.focusSubpoint).filter(Boolean),
        existingQuestions: [...bank, ...aspectQuestions].map((item) => item.question).slice(-60)
      });
      const questions = Array.isArray(result.questions) ? result.questions.map(normalizeClientBankQuestion) : [];
      aspectQuestions.push(...filterDiverseQuestions(
        questions,
        [...bank, ...aspectQuestions].map((item) => item.question),
        aspectQuestions.map((item) => item.focusSubpoint)
      ));
    }
    bank.push(...aspectQuestions.slice(0, BANK_QUESTIONS_PER_ASPECT));
    state.bankProgress[index] = {
      aspect,
      status: aspectQuestions.length >= BANK_QUESTIONS_PER_ASPECT ? "done" : aspectQuestions.length > 0 ? "partial" : "pending",
      count: aspectQuestions.length
    };
    renderBankProgress({
      title: `已完成：${aspect}`,
      detail: `已完成 ${index + 1}/${state.coveragePlan.length} 个内容方面，当前题库 ${bank.length} 题。`,
      completedCount: bank.length
    });
    persistSession();
  }
  state.questionBank = bank;
  state.questionIndex = 0;
  state.bankReady = bank.length > 0;
  if (!bank.length) {
    throw new Error("题库生成完成但没有有效客观题，请重试或换一个更明确的关键词。");
  }
  renderBankProgress({
    title: "题库生成完成",
    detail: `已生成 ${bank.length} 道客观题，覆盖 ${state.coveragePlan.length} 个内容方面。`,
    completedCount: bank.length
  });
  return bank;
}

function evaluateObjectiveAnswer(question, answerIds) {
  const selected = [...new Set(answerIds)].sort();
  const correct = [...new Set(question.correctAnswer || [])].sort();
  const selectedSet = new Set(selected);
  const correctSet = new Set(correct);
  const exact = selected.length === correct.length && selected.every((id) => correctSet.has(id));
  const rightSelected = selected.filter((id) => correctSet.has(id)).length;
  const wrongSelected = selected.filter((id) => !correctSet.has(id)).length;
  const missed = correct.filter((id) => !selectedSet.has(id)).length;
  const partial = correct.length ? Math.max(0, Math.round((rightSelected / correct.length - wrongSelected * 0.35) * 100)) : 0;
  const score = exact ? 100 : Math.min(70, partial);
  const selectedLabel = selected.length ? selected.join("、") : "未选择";
  const correctLabel = correct.join("、");
  const optionExplanations = (question.options || []).map((option) => {
    const template = (question.optionExplanations || []).find((item) => item.id === option.id);
    const isCorrect = correctSet.has(option.id);
    const wasSelected = selectedSet.has(option.id);
    return {
      id: option.id,
      text: option.text,
      isCorrect,
      wasSelected,
      explanation: normalizeFeedbackText(template?.explanation || (isCorrect
        ? "该选项符合本题标准答案。"
        : "该选项不符合本题标准答案。"))
    };
  });
  return {
    mastered: false,
    score,
    stage: question.stage || state.currentStage || "-",
    knowledgeAspect: question.knowledgeAspect || "未标注方面",
    focusSubpoint: question.focusSubpoint || "",
    coveragePlan: state.coveragePlan,
    answeredQuestionType: question.questionType,
    questionType: question.questionType,
    question: question.question,
    options: question.options || [],
    correctAnswer: correct,
    conclusion: exact
      ? `回答正确。你的选择是 ${selectedLabel}，标准答案是 ${correctLabel}。`
      : `回答错误。你的选择是 ${selectedLabel}，标准答案是 ${correctLabel}。`,
    questionAnalysis: normalizeFeedbackText(question.questionAnalysis || `本题考察 ${question.knowledgeAspect || "当前内容方面"} 的关键判断。`),
    answerComparison: {
      selectedIds: selected,
      correctIds: correct,
      selected: selected.length ? (question.options || []).filter((item) => selectedSet.has(item.id)).map((item) => `${item.id}. ${item.text}`) : ["未选择"],
      correct: (question.options || []).filter((item) => correctSet.has(item.id)).map((item) => `${item.id}. ${item.text}`)
    },
    remedialPoint: "",
    nextTimeStrategy: "",
    optionExplanations,
    objectiveCorrect: exact,
    verdict: exact ? "客观题回答正确。" : "客观题回答错误。",
    basis: [
      `你的选择是 ${selectedLabel}，标准答案是 ${correctLabel}。`,
      ...compactItems(question.basis, 1)
    ].slice(0, 2),
    positivePoints: exact ? [`本题选择正确，说明你理解了「${question.knowledgeAspect || "当前内容方面"}」的关键判断。`] : [],
    errorPoints: exact ? [] : [`本题选择不正确：你的选择是 ${selectedLabel}，标准答案是 ${correctLabel}。`],
    missingPoints: missed ? [`漏选 ${missed} 个正确选项。`] : [],
    gaps: exact ? [] : [question.knowledgeAspect || "当前内容方面"],
    correction: "",
    explanation: "",
    followupAnswer: "",
    needsVerification: false,
    verificationNote: "",
    nextQuestion: "",
    nextQuestionReason: "",
    masterySummary: ""
  };
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
    lastAnsweredQuestionType: "short_answer",
    lastAnsweredOptions: [],
    lastAnsweredCorrectAnswer: [],
    lastAnsweredSelectedAnswerIds: [],
    pendingReview: null,
    awaitingNext: false,
    followupOpen: false,
    followupMessages: [],
    questionBank: [],
    questionIndex: 0,
    coveragePlan: [],
    aspectSubpoints: {},
    bankProgress: [],
    bankReady: false,
    planningNote: ""
  });
  feedbackPanel.hidden = true;
  followupPanel.hidden = true;
  hideBankProgress();
  historyList.replaceChildren();
  scoreLabel.textContent = "-";
  setSessionLabels();
  setBusy(true, "正在生成完整题库...");

  try {
    const bank = await generateQuestionBank(topic, options);
    applyBankQuestion(bank[0], 0);
    persistSession();
    saveTopicSnapshot();
    setBusy(false, `题库已生成 ${bank.length} 道客观题，覆盖 ${state.coveragePlan.length} 个内容方面。请回答当前问题。`);
  } catch (error) {
    questionText.textContent = "生成题库失败，请检查服务端日志和 DeepSeek 配置。";
    renderBankProgress({
      title: "题库生成失败",
      detail: error.message,
      completedCount: state.questionBank.length || 0
    });
    setBusy(false, error.message);
  }
}

async function submitAnswer(answer) {
  const question = state.currentQuestion;
  const answerIds = [...state.selectedAnswerIds];
  const displayAnswer = isObjectiveQuestion() ? answerIds.join("、") : answer;
  setBusy(true, isObjectiveQuestion() ? "正在判分..." : "正在评估回答...");

  try {
    if (isObjectiveQuestion()) {
      const bankQuestion = bankQuestionAt() || {
        question,
        questionType: state.currentQuestionType,
        options: state.currentOptions,
        correctAnswer: state.currentCorrectAnswer,
        stage: state.currentStage,
        knowledgeAspect: "未标注方面"
      };
      const review = evaluateObjectiveAnswer(bankQuestion, answerIds);
      review.answeredQuestion = question;
      review.answeredAnswer = displayAnswer;
      state.lastAnsweredQuestion = question;
      state.lastAnsweredAnswer = displayAnswer;
      state.lastAnsweredQuestionType = state.currentQuestionType;
      state.lastAnsweredOptions = state.currentOptions.map((option) => ({ ...option }));
      state.lastAnsweredCorrectAnswer = [...state.currentCorrectAnswer];
      state.lastAnsweredSelectedAnswerIds = [...answerIds];
      state.history.push({ question, answer: displayAnswer, evaluation: review });
      state.lastReview = review;
      state.pendingReview = review;
      state.awaitingNext = true;
      state.followupOpen = false;
      state.followupMessages = [];
      state.mastered = false;
      followupPanel.hidden = true;
      renderOptions();
      renderFeedback(review);
      renderHistory();
      persistSession();
      saveTopicSnapshot();
      setBusy(false, `已显示解析。点击“下一题”继续，或点击“结束回顾”。${masteryStatusSentence()}`);
      return;
    }

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
    state.lastAnsweredQuestionType = state.currentQuestionType;
    state.lastAnsweredOptions = state.currentOptions.map((option) => ({ ...option }));
    state.lastAnsweredCorrectAnswer = [...state.currentCorrectAnswer];
    state.lastAnsweredSelectedAnswerIds = [...answerIds];
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
    const masterySentence = masteryStatusSentence();
    setBusy(false, review.mastered
      ? `已达到掌握标准，可以结束回顾。${masterySentence}`
      : `已显示解析。点击“下一题”继续，或点击“结束回顾”。${masterySentence}`);
  } catch (error) {
    setBusy(false, error.message);
  }
}

async function requestQuestionMode(mode, message) {
  if (!canAct()) {
    return;
  }
  if (mode === "explain" && isObjectiveQuestion()) {
    const bankQuestion = bankQuestionAt() || {
      question: state.currentQuestion,
      questionType: state.currentQuestionType,
      options: state.currentOptions,
      correctAnswer: state.currentCorrectAnswer,
      stage: state.currentStage,
      knowledgeAspect: "未标注方面"
    };
    const review = evaluateObjectiveAnswer(bankQuestion, []);
    review.verdict = "已显示本题解析。";
    review.explanation = bankQuestion.questionAnalysis || "";
    review.answeredQuestion = state.currentQuestion;
    review.answeredAnswer = "我不会";
    state.lastAnsweredQuestion = state.currentQuestion;
    state.lastAnsweredAnswer = "我不会";
    state.lastAnsweredQuestionType = state.currentQuestionType;
    state.lastAnsweredOptions = state.currentOptions.map((option) => ({ ...option }));
    state.lastAnsweredCorrectAnswer = [...state.currentCorrectAnswer];
    state.lastAnsweredSelectedAnswerIds = [];
    state.history.push({ question: state.currentQuestion, answer: "我不会", evaluation: review });
    state.lastReview = review;
    state.pendingReview = review;
    state.awaitingNext = true;
    renderOptions();
    renderFeedback(review);
    renderHistory();
    persistSession();
    saveTopicSnapshot();
    setBusy(false, `已显示解析。点击“下一题”继续，或点击“结束回顾”。${masteryStatusSentence()}`);
    return;
  }
  if (mode === "newQuestion" && state.questionIndex < state.questionBank.length - 1) {
    applyBankQuestion(state.questionBank[state.questionIndex + 1], state.questionIndex + 1);
    persistSession();
    saveTopicSnapshot();
    setBusy(false, "已从题库换到下一题。");
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
  if (!canSwitchQuestionMode()) {
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

async function requestObjectiveQuestion() {
  if (!canSwitchQuestionMode()) {
    return;
  }
  const nextBankQuestion = bankQuestionAt();
  if (nextBankQuestion) {
    applyBankQuestion(nextBankQuestion, state.questionIndex);
    persistSession();
    saveTopicSnapshot();
    setBusy(false, "已切回题库客观题，请作答。");
    return;
  }
  setBusy(false, "当前题库没有可切回的客观题。");
}

function toggleQuestionMode() {
  if (isObjectiveQuestion()) {
    requestSubjectiveQuestion();
  } else {
    requestObjectiveQuestion();
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
      questionType: state.lastAnsweredQuestionType || state.lastReview.answeredQuestionType || state.currentQuestionType,
      options: state.lastAnsweredOptions.length ? state.lastAnsweredOptions : state.currentOptions,
      correctAnswer: state.lastAnsweredCorrectAnswer.length ? state.lastAnsweredCorrectAnswer : state.currentCorrectAnswer,
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
    setBusy(false, "追问已回答。可以继续提问，也可以直接点“下一题”。");
  } catch (error) {
    state.followupMessages = [
      { role: "user", content: question },
      { role: "assistant", content: `追问回答失败：${error.message}` }
    ];
    renderFollowupMessages();
    setBusy(false, error.message);
  }
}

async function goToNextQuestion() {
  if (!state.awaitingNext) {
    return;
  }
  if (state.questionIndex >= state.questionBank.length - 1) {
    try {
      const added = await supplementQuestionBank();
      if (!added) {
        const message = "当前题库已没有可用下一题，且暂时没有补到不相似新题。可以结束回顾，或重新开始生成题库。";
        renderBankProgress({
          title: "暂时没有补到新题",
          detail: message,
          completedCount: state.questionBank.length
        });
        setBusy(false, message);
        return;
      }
    } catch (error) {
      const message = `补充下一题失败：${error.message}`;
      renderBankProgress({
        title: "补题失败",
        detail: message,
        completedCount: state.questionBank.length
      });
      setBusy(false, message);
      return;
    }
  }
  applyBankQuestion(state.questionBank[state.questionIndex + 1], state.questionIndex + 1);
  persistSession();
  saveTopicSnapshot();
  setBusy(false, "请回答当前问题。");
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
  state.lastAnsweredQuestion = "";
  state.lastAnsweredAnswer = "";
  state.lastAnsweredQuestionType = "short_answer";
  state.lastAnsweredOptions = [];
  state.lastAnsweredCorrectAnswer = [];
  state.lastAnsweredSelectedAnswerIds = [];
  questionText.textContent = `“${state.topic}”本轮回顾已结束。`;
  renderOptions();
  followupPanel.hidden = true;
  hideBankProgress();
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
    lastAnsweredQuestionType: "short_answer",
    lastAnsweredOptions: [],
    lastAnsweredCorrectAnswer: [],
    lastAnsweredSelectedAnswerIds: [],
    pendingReview: null,
    awaitingNext: false,
    followupOpen: false,
    followupMessages: [],
    questionBank: [],
    questionIndex: 0,
    coveragePlan: [],
    aspectSubpoints: {},
    bankProgress: [],
    bankReady: false,
    planningNote: ""
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
  hideBankProgress();
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

subjectiveBtn.addEventListener("click", toggleQuestionMode);
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
