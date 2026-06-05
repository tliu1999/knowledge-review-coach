import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");

async function loadLocalEnv() {
  try {
    const content = await readFile(join(__dirname, ".env"), "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!match || process.env[match[1]]) {
        continue;
      }
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env is optional; production environments can provide real env vars.
  }
}

await loadLocalEnv();

const port = Number(process.env.PORT || 5177);
const deepseekModel = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const REVIEW_STAGES = ["定义", "机制", "适用场景", "边界与误区", "对比概念", "实际应用"];
const QUESTION_TYPES = ["true_false", "single_choice", "multiple_choice", "short_answer"];
const OBJECTIVE_TYPES = ["true_false", "single_choice", "multiple_choice"];
const MIN_CONTENT_ASPECTS_FOR_MASTERY = 6;
const MIN_OBJECTIVE_QUESTIONS_PER_ASPECT = 10;
const MIN_OBJECTIVE_QUESTIONS_FOR_MASTERY = MIN_CONTENT_ASPECTS_FOR_MASTERY * MIN_OBJECTIVE_QUESTIONS_PER_ASPECT;
const MIN_OBJECTIVE_ACCURACY_FOR_MASTERY = 0.85;
const BANK_ASPECT_COUNT = 10;
const BANK_QUESTIONS_PER_ASPECT = 10;
const BANK_QUESTIONS_PER_BATCH = 5;
const MAX_TOPIC_LENGTH = 80;
const MAX_ANSWER_LENGTH = 5000;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

async function readRequestJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 220_000) {
      throw new Error("REQUEST_TOO_LARGE");
    }
  }
  return JSON.parse(body || "{}");
}

function buildMessages(payload) {
  const historyText = (payload.history || [])
    .slice(-8)
    .map((item, index) => {
      const question = item.question || "";
      const answer = item.answer || "";
      const verdict = item.evaluation?.verdict || "未评估";
      const stage = item.evaluation?.stage || "未知阶段";
      const aspect = item.evaluation?.knowledgeAspect || "未知内容方面";
      const type = item.evaluation?.questionType || "unknown";
      return `第${index + 1}轮\n阶段：${stage}\n内容方面：${aspect}\n题型：${type}\n问题：${question}\n学习者回答：${answer}\n评估：${verdict}`;
    })
    .join("\n\n");
  const completedStages = getCoveredStages(payload.history || []);
  const nextStage = chooseNextStage(payload.history || []);
  const coveragePlan = getCoveragePlan(payload.history || []);
  const aspectStats = getAspectStats(payload.history || [], coveragePlan);
  const nextContentAspect = chooseNextContentAspect(payload.history || [], coveragePlan);
  const historyForQuestionType = payload.mode === "answer"
    ? [...(payload.history || []), { evaluation: { questionType: payload.questionType, objectiveCorrect: true, score: 100 } }]
    : (payload.history || []);
  const nextQuestionType = payload.mode === "subjective"
    ? "short_answer"
    : payload.mode === "objective"
    ? chooseNextQuestionType(payload.history || [])
    : ["explain", "newQuestion", "followup"].includes(payload.mode)
    ? payload.questionType || chooseNextQuestionType(payload.history || [])
    : chooseNextQuestionType(historyForQuestionType);
  const isFollowupChat = payload.mode === "followup" && payload.followupQuestion;
  const actionLabel = {
    answer: "评估本题回答，并按学习路径给下一题或结束",
    start: "开始新复习，请出第一题",
    explain: "学习者表示不会，请先解释当前题，再给同阶段更基础的新题",
    newQuestion: "学习者想换一题，请保持同一阶段重新出题",
    followup: isFollowupChat ? "学习者对本题解析追问，请只回答追问，不生成新题" : "学习者想追问当前题，请围绕当前题给一个更聚焦的追问",
    subjective: "学习者主动选择主观题，请出一道简答题检查表达、迁移和边界理解",
    objective: "学习者想从简答题切回客观题，请按建议下一题型生成一道客观题"
  }[payload.mode] || "继续复习";
  const focusText = payload.reviewMode === "weak" && payload.focus
    ? [
      "本轮是重点回顾，不是全部重来。",
      payload.focus.summary ? `重点摘要：${payload.focus.summary}` : "",
      Array.isArray(payload.focus.stages) && payload.focus.stages.length ? `重点阶段：${payload.focus.stages.join("、")}` : "",
      Array.isArray(payload.focus.notes) && payload.focus.notes.length ? `薄弱点：${payload.focus.notes.join("；")}` : ""
    ].filter(Boolean).join("\n")
    : "";

  const system = [
    "你是严谨的知识回顾问答教练，帮助学习者通过一问一答掌握一个知识点。",
    "你必须避免幻觉：只基于公认教材级知识、基础原理、题目上下文和学习者回答评估。",
    "不要编造论文、链接、作者、年份、精确数值或不存在的引用。",
    "除非用户明确要求来源，basis 不要写论文名、书名、作者、年份或链接；只写概念依据和推理依据。",
    "如果用户回答涉及你无法可靠判断的细节，把 needsVerification 设为 true，并说明需要核验什么。",
    `每轮只出一道题。学习路径固定为：${REVIEW_STAGES.join(" → ")}。`,
    `覆盖策略：必须围绕“知识点本身”拆出完整内容方面清单 coveragePlan，而不是只按通用阶段覆盖。coveragePlan 应包含 ${MIN_CONTENT_ASPECTS_FOR_MASTERY} 到 12 个该知识点特有的核心方面。`,
    `每个内容方面至少 ${MIN_OBJECTIVE_QUESTIONS_PER_ASPECT} 道客观题；所有内容方面未达标前，优先补齐未覆盖或题量不足的方面。`,
    "同一内容方面内的题目必须考察不同子点、不同边界、不同场景、不同混淆项或不同应用条件；不要只替换措辞生成相似题。",
    "所有内容方面都达到最低题量后，才允许优先回到薄弱内容方面继续出题；薄弱方面补题也必须换角度，不能重复历史题。",
    "禁止输出空泛模板题，例如“关于某知识点的某阶段，下列说法是否正确：需要区分核心原理、适用边界和常见误区”。题干必须包含该知识点的具体概念、结构、过程、对比对象或应用场景。",
    "题型路径优先级：以客观题为主，通过足够多的判断题、单选题、多选题完成复盘；简答题只是可选的表达检查。",
    "除非本次动作是追问、换一题、我不会或主观题，否则新题必须使用“建议下一题型”。",
    "如果本次动作是切回客观题，必须生成 true_false、single_choice 或 multiple_choice，不能生成 short_answer。",
    "只有本次动作是主观题时，才允许主动生成 short_answer；普通复习流程必须保持客观题。",
    "questionType 只能是 true_false、single_choice、multiple_choice、short_answer。",
    "true_false 必须给两个选项：A 正确，B 错误。single_choice 只有一个正确答案。multiple_choice 必须至少有两个正确答案。short_answer 不需要 options 和 correctAnswer。",
    "所有客观题必须提供 options 和 correctAnswer。correctAnswer 使用选项 id 数组，例如 [\"A\"] 或 [\"A\",\"C\"]。",
    "客观题选项必须清晰无争议，不要把正确性建立在不同教材或实现约定可能不同的表述上；如涉及实现约定，题干必须说明约定。",
    "如果本轮是重点回顾，题目应优先围绕薄弱阶段、错题、遗漏点和不确定内容，不要平均覆盖全部知识。",
    "不要自行放宽掌握标准；即使你认为掌握，也要由后端根据多轮表现最终判定。",
    "verdict、basis、positivePoints、errorPoints、missingPoints、correction 只能评估本题（学习者刚提交回答的题）和学习者刚提交的回答，不能解释你新出的下一题。",
    "basis 必须写本题判分的可核查概念依据，不要写空泛表扬，也不要写下一题的出题依据；不要使用“上一题”这个词。",
    "positivePoints 写本题回答中正确的点；errorPoints 写本题回答中的错误或混淆；missingPoints 写本题回答的关键遗漏。",
    "questionAnalysis 必须说明本题考察的核心知识点、关键辨析点、容易错在哪里。",
    "optionExplanations 必须逐一解释本题每个选项为什么正确或错误；客观题必须覆盖全部选项。",
    "如果本次动作是追问答疑，followupAnswer 直接回答学习者追问，避免编造依据；question、nextQuestion 不要推进学习路径。",
    "nextQuestionReason 简短说明为什么下一题适合当前学习状态。",
    "新出的 question/nextQuestion 不得与当前题重复，也不要只替换少量措辞后重复同一题。",
    "必须输出严格 JSON，不要 Markdown，不要额外解释。"
  ].join("\n");

  const user = [
    `知识点：${payload.topic}`,
    `本次动作：${actionLabel}`,
    `固定学习路径：${REVIEW_STAGES.join(" → ")}`,
    `已覆盖阶段：${completedStages.length ? completedStages.join("、") : "无"}`,
    `当前内容覆盖计划：${coveragePlan.length ? coveragePlan.join("、") : "尚未建立，请先为该知识点拆出完整 coveragePlan"}`,
    `内容方面覆盖统计：${aspectStats.length ? aspectStats.map((item) => `${item.aspect}=${item.count}/${MIN_OBJECTIVE_QUESTIONS_PER_ASPECT}题,弱点${item.weakCount}个,正确率${Math.round(item.accuracy * 100)}%`).join("；") : "无"}`,
    `建议下一内容方面：${nextContentAspect || "请先建立 coveragePlan 并选择第一个核心方面"}`,
    `建议下一阶段：${payload.stage || nextStage}`,
    `建议下一题型：${nextQuestionType}`,
    payload.reviewMode ? `复习模式：${payload.reviewMode === "weak" ? "重点回顾薄弱处" : "全部重新回顾"}` : "",
    focusText,
    payload.currentQuestion ? `本题：${payload.currentQuestion}` : "",
    payload.questionType ? `本题题型：${payload.questionType}` : "",
    payload.options ? `本题选项：${JSON.stringify(payload.options)}` : "",
    payload.correctAnswer ? `本题标准答案：${JSON.stringify(payload.correctAnswer)}` : "",
    payload.answerIds ? `学习者选择：${JSON.stringify(payload.answerIds)}` : "",
    payload.answer ? `学习者回答：${payload.answer}` : "",
    payload.lastReview ? `本题已有解析：${JSON.stringify(payload.lastReview).slice(0, 2500)}` : "",
    payload.followupQuestion ? `学习者追问：${payload.followupQuestion}` : "",
    historyText ? `历史记录：\n${historyText}` : "",
    "",
    "请按这个 JSON 结构输出：",
    "{",
    '  "mastered": false,',
    '  "score": 0,',
    '  "stage": "定义",',
    '  "knowledgeAspect": "本题覆盖的知识点内容方面，例如：卷积窗口与局部特征",',
    '  "coveragePlan": ["内容方面1", "内容方面2", "内容方面3"],',
    '  "questionType": "single_choice",',
    '  "question": "本轮要展示给学习者的问题",',
    '  "options": [{"id": "A", "text": "选项内容"}],',
    '  "correctAnswer": ["A"],',
    '  "questionAnalysis": "说明本题考察的核心知识点、关键辨析点和为什么这样问",',
    '  "optionExplanations": [{"id": "A", "explanation": "该选项为什么正确或错误"}],',
    '  "verdict": "回答质量的简短判断",',
    '  "basis": ["依据1", "依据2"],',
    '  "positivePoints": ["正确点1"],',
    '  "errorPoints": ["错误点1"],',
    '  "missingPoints": ["遗漏点1"],',
    '  "gaps": ["缺口1"],',
    '  "correction": "必要时给出纠正；如果没有明显问题，写空字符串",',
    '  "explanation": "学习者不会时的简短讲解；其他情况可为空字符串",',
    '  "followupAnswer": "追问答疑时回答学习者问题；其他情况写空字符串",',
    '  "needsVerification": false,',
    '  "verificationNote": "需要核验的内容；没有则写空字符串",',
    '  "nextQuestion": "下一题；必须与 question 相同；如果 mastered 为 true，写空字符串",',
    '  "nextQuestionReason": "下一题的设计理由；没有则写空字符串",',
    '  "masterySummary": "掌握后给学习者的总结；未掌握时写空字符串"',
    "}"
  ].filter(Boolean).join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

function buildObjectiveFeedbackMessages(payload) {
  const selected = normalizeAnswerIds(payload.answerIds);
  const correct = normalizeAnswerIds(payload.correctAnswer);
  const selectedLabel = selected.length ? selected.join("、") : "未选择";
  const correctLabel = correct.length ? correct.join("、") : "未提供";
  const optionLines = (Array.isArray(payload.options) ? payload.options : []).slice(0, 12)
    .map((option) => {
      const id = String(option.id || "").trim();
      const tags = [
        selected.includes(id) ? "学习者已选" : "学习者未选",
        correct.includes(id) ? "标准答案" : "干扰项"
      ].join("，");
      return `${id}. ${option.text || ""}（${tags}）`;
    })
    .join("\n");
  const providedExplanations = (Array.isArray(payload.optionExplanations) ? payload.optionExplanations : []).slice(0, 12)
    .map((item) => `${item.id}. ${item.explanation || ""}`)
    .join("\n");

  return [
    {
      role: "system",
      content: [
        "你是严谨的客观题错因分析助手。",
        "只分析用户刚回答的这一道题，不生成下一题，不改变标准答案，不重新判分。",
        "必须基于题干、选项、标准答案、学习者选择和已给选项解释来分析；不要编造题外资料、论文、链接、作者、年份或精确指标。",
        "错误点要解释用户错选的每个干扰项为什么不应选，并指出可能混淆的概念、阶段、条件、机制或边界。",
        "missingPoints 要解释用户没有选中的正确项为什么应该选，并指出它抓住的关键判断条件。",
        "多选题可以使用“你漏选了 X”；单选题和判断题不要说“漏选”，应写“正确答案是 X。X 正确：...”。",
        "如果没有错选或未选中的正确项，对应数组返回空数组。",
        "输出必须是严格 JSON，不要 Markdown。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `知识点：${payload.topic}`,
        `内容方面：${payload.knowledgeAspect || "未标注"}`,
        `具体子点：${payload.focusSubpoint || "未标注"}`,
        `题型：${payload.questionType}`,
        `题干：${payload.currentQuestion}`,
        `学习者选择：${selectedLabel}`,
        `标准答案：${correctLabel}`,
        "选项：",
        optionLines,
        payload.questionAnalysis ? `本题说明：${payload.questionAnalysis}` : "",
        payload.basis?.length ? `关键依据：${asList(payload.basis, 4).join("；")}` : "",
        providedExplanations ? `已有选项解释：\n${providedExplanations}` : "",
        "",
        "请按 JSON 输出：",
        "{",
        '  "errorPoints": ["你选择了 B，但 B ..."],',
        '  "missingPoints": ["多选题：你漏选了 C。C ...；单选题/判断题：正确答案是 B。B 正确：..."],',
        '  "basis": ["用于判断本题的关键依据"],',
        '  "nextTimeStrategy": "下次判断这类题应抓住的条件"',
        "}"
      ].filter(Boolean).join("\n")
    }
  ];
}

function parseModelJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("MODEL_JSON_PARSE_FAILED");
    }
    return JSON.parse(match[0]);
  }
}

function buildRepairJsonMessages(content, mode) {
  const expectedShape = mode === "bankQuestions"
    ? '{ "questions": [ { "questionType": "single_choice", "question": "...", "options": [{"id":"A","text":"..."}], "correctAnswer": ["A"], "stage": "定义", "knowledgeAspect": "...", "focusSubpoint": "...", "basis": ["..."], "questionAnalysis": "...", "optionExplanations": [{"id":"A","explanation":"..."}] } ] }'
    : '{ "contentAspects": [{"aspect": "...", "subpoints": ["..."]}], "coveragePlan": ["..."], "planningNote": "..." }';
  return [
    {
      role: "system",
      content: [
        "你是 JSON 修复器。",
        "只修复语法错误，不改写语义，不新增题目，不删除可恢复字段。",
        "输出必须是严格 JSON，不要 Markdown，不要解释。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `目标结构示例：${expectedShape}`,
        "下面 JSON 存在语法错误，请修复为可 JSON.parse 的严格 JSON：",
        String(content || "").slice(0, 18000)
      ].join("\n")
    }
  ];
}

function buildBankPlanMessages(payload) {
  const focusText = payload.reviewMode === "weak" && payload.focus
    ? [
      "本次是重点回顾题库，应优先覆盖学习者薄弱的具体内容方面。",
      payload.focus.summary ? `薄弱摘要：${payload.focus.summary}` : "",
      Array.isArray(payload.focus.aspects) && payload.focus.aspects.length ? `薄弱内容方面：${payload.focus.aspects.join("、")}` : "",
      Array.isArray(payload.focus.notes) && payload.focus.notes.length ? `薄弱点：${payload.focus.notes.join("；")}` : ""
    ].filter(Boolean).join("\n")
    : "本次是完整回顾题库，应覆盖该知识点的完整核心内容。";

  const system = [
    "你是严谨的知识题库规划专家。",
    "任务是把一个知识点拆成具体、完整、互不重复的内容方面，并为每个内容方面继续拆出可出题的子点。",
    "内容方面必须是该知识点本身的教材级组成内容、原理、关键结构、适用条件、边界、常见混淆和典型应用。",
    "禁止使用空泛标签，例如：定义、机制、应用、边界、误区、阶段、核心原理、适用场景。",
    "每个内容方面必须带有该知识点的具体对象或概念，不得泛泛而谈。",
    "每个内容方面必须给出 10 个不重复子点；子点要覆盖不同概念、步骤、条件、边界、混淆项或应用场景。",
    "不要编造论文、链接、作者、年份、精确指标。",
    "必须输出严格 JSON，不要 Markdown。"
  ].join("\n");

  const user = [
    `知识点：${payload.topic}`,
    focusText,
    `请生成 ${BANK_ASPECT_COUNT} 个内容方面。`,
    "要求：",
    "1. 合起来能覆盖该关键词的完整核心知识，而不是只覆盖几个熟悉片段。",
    "2. 方面之间不要重叠；每个方面后续都能生成 10 道绑定不同子点的不相似客观题。",
    "3. 如果关键词有常见上下文差异，请把上下文差异作为独立内容方面体现。",
    "",
    "请按 JSON 输出：",
    "{",
    '  "contentAspects": [{"aspect": "具体内容方面1", "subpoints": ["子点1", "子点2"]}],',
    '  "coveragePlan": ["具体内容方面1", "具体内容方面2"],',
    '  "planningNote": "一句话说明覆盖范围"',
    "}"
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

function buildBankExpandPlanMessages(payload) {
  const existingAspects = asList(payload.existingCoveragePlan, 24);
  const system = [
    "你是严谨的知识题库规划专家。",
    "任务是在已有内容方面补不出不相似题时，继续扩展新的知识点内容方面。",
    "新增内容方面必须仍属于该关键词的核心知识、重要边界、变体、跨场景应用、实践细节或常见混淆。",
    "禁止重复已有内容方面，禁止只换同义词，禁止泛泛使用定义、机制、应用、边界、误区等标签。",
    "每个新增内容方面必须给出 10 个不重复子点；子点要能生成不相似客观题。",
    "不要编造论文、链接、作者、年份、精确指标。",
    "必须输出严格 JSON，不要 Markdown。"
  ].join("\n");

  const user = [
    `知识点：${payload.topic}`,
    existingAspects.length ? `已有内容方面，禁止重复或同义改写：${existingAspects.join("、")}` : "已有内容方面：无",
    payload.existingQuestions?.length ? `已有题干样例，避免围绕同一角度继续出题：\n${asList(payload.existingQuestions, 30).map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "",
    "请新增 3 到 5 个尚未覆盖的具体内容方面。",
    "这些方面应该用于扩展知识点全覆盖，而不是继续补旧方面。",
    "",
    "请按 JSON 输出：",
    "{",
    '  "contentAspects": [{"aspect": "新增具体内容方面1", "subpoints": ["子点1", "子点2"]}],',
    '  "coveragePlan": ["新增具体内容方面1", "新增具体内容方面2"],',
    '  "planningNote": "一句话说明扩展了哪些覆盖范围"',
    "}"
  ].filter(Boolean).join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

function buildBankQuestionsMessages(payload) {
  const existingQuestions = asList(payload.existingQuestions, 40).map((item, index) => `${index + 1}. ${item}`).join("\n");
  const subpoints = asList(payload.subpointsForAspect, 20);
  const usedSubpoints = new Set(asList(payload.existingSubpoints, 40));
  const availableSubpoints = subpoints.filter((item) => !usedSubpoints.has(item));
  const aspectIndex = Number(payload.aspectIndex || 0) + 1;
  const questionCount = Math.max(1, Math.min(BANK_QUESTIONS_PER_ASPECT, Number(payload.questionCount || BANK_QUESTIONS_PER_BATCH)));
  const system = [
    "你是严谨的客观题出题专家。",
    "任务是围绕指定知识点和指定内容方面生成客观题。",
    "题目必须考察具体概念、结构、过程、条件、对比、边界或应用判断，不能是空泛模板题。",
    "同一批题必须覆盖该内容方面内不同子点，不得只是替换措辞或重复同一判断。",
    "每道题必须绑定一个 focusSubpoint；同一内容方面内不得重复使用同一个 focusSubpoint，除非所有子点都已经用完。",
    "题型只能是 true_false、single_choice、multiple_choice。",
    "true_false 必须给 A 正确、B 错误两个选项。",
    "single_choice 必须且只能有一个正确答案。",
    "multiple_choice 必须至少有两个正确答案；如果只有一个正确点，请改成 single_choice。",
    "每道题必须提供 questionAnalysis 和每个选项的 optionExplanations。",
    "optionExplanations 不能只写“符合/不符合标准答案”；正确选项要说明它抓住了哪个概念、机制、边界或判断条件，错误选项要说明错在哪里、容易和哪个概念混淆。",
    "依据只能写概念和判分理由，不要编造论文、链接、作者、年份、精确指标。",
    "必须输出严格 JSON，不要 Markdown。"
  ].join("\n");

  const user = [
    `知识点：${payload.topic}`,
    `内容方面 ${aspectIndex}/${BANK_ASPECT_COUNT}：${payload.aspect}`,
    `完整内容方面清单：${asList(payload.coveragePlan, 16).join("、")}`,
    subpoints.length ? `该内容方面完整子点清单：${subpoints.join("、")}` : "",
    availableSubpoints.length ? `本批优先使用尚未覆盖子点：${availableSubpoints.join("、")}` : "",
    usedSubpoints.size ? `已经覆盖过的子点，避免重复：${[...usedSubpoints].join("、")}` : "",
    existingQuestions ? `已生成题目，禁止重复或高度相似：\n${existingQuestions}` : "已生成题目：无",
    `请为该内容方面生成 ${questionCount} 道客观题。`,
    "题型分布建议：判断题、单选题、多选题都要有；多选题必须有至少两个正确选项。",
    "每题字段要求：",
    "- knowledgeAspect 必须等于当前内容方面。",
    "- focusSubpoint 必须来自该内容方面子点清单，表示本题具体考察的子点。",
    "- question 必须包含具体知识内容，不能出现“某阶段”“需要区分核心原理、适用边界和常见误区”等泛化句式。",
    "- basis 写 1-2 条本题判分所需的概念依据。",
    "- questionAnalysis 写本题考察的重点、关键辨析和易错点。",
    "- optionExplanations 覆盖所有选项；正确选项说明为什么应该选，错误选项说明为什么不能选、混淆点是什么。",
    "",
    "请按 JSON 输出：",
    "{",
    '  "questions": [',
    "    {",
    '      "questionType": "single_choice",',
    '      "question": "题干",',
    '      "options": [{"id": "A", "text": "选项"}],',
    '      "correctAnswer": ["A"],',
    '      "stage": "定义",',
    '      "knowledgeAspect": "当前内容方面",',
    '      "focusSubpoint": "当前内容方面下的具体子点",',
    '      "basis": ["依据1"],',
    '      "questionAnalysis": "本题考察什么、关键辨析是什么、容易错在哪里",',
    '      "optionExplanations": [{"id": "A", "explanation": "说明该选项为什么应选或不应选，以及对应的判断条件或混淆点"}]',
    "    }",
    "  ]",
    "}"
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

function asList(value, limit = 6) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, limit)
    : [];
}

function currentQuestionText(value) {
  return String(value || "").replaceAll("上一题", "本题");
}

function currentQuestionList(value) {
  return asList(value).map(currentQuestionText);
}

function normalizeQuestionType(value) {
  return QUESTION_TYPES.includes(value) ? value : "short_answer";
}

function normalizeOptions(value, type) {
  if (type === "short_answer") {
    return [];
  }
  const options = Array.isArray(value)
    ? value
      .map((item, index) => ({
        id: String(item?.id || String.fromCharCode(65 + index)).trim().toUpperCase(),
        text: String(item?.text || "").trim()
      }))
      .filter((item) => item.id && item.text)
      .slice(0, 6)
    : [];

  if (type === "true_false" && options.length < 2) {
    return [
      { id: "A", text: "正确" },
      { id: "B", text: "错误" }
    ];
  }
  return options;
}

function normalizeQuestionShape(raw) {
  const initialType = normalizeQuestionType(raw.questionType);
  const initialOptions = normalizeOptions(raw.options, initialType);
  const initialCorrectAnswer = initialType === "short_answer" ? [] : normalizeAnswerIds(raw.correctAnswer);
  const normalizedType = initialType === "multiple_choice" && initialCorrectAnswer.length < 2
    ? "single_choice"
    : initialType;

  if (OBJECTIVE_TYPES.includes(initialType)) {
    const optionIds = new Set(initialOptions.map((option) => option.id));
    const hasValidAnswer = initialCorrectAnswer.length > 0
      && initialCorrectAnswer.every((id) => optionIds.has(id));
    const hasEnoughOptions = initialType === "true_false"
      ? initialOptions.length >= 2
      : initialOptions.length >= 3;

    if (!hasEnoughOptions || !hasValidAnswer) {
      return {
        questionType: "short_answer",
        options: [],
        correctAnswer: []
      };
    }
  }

  return {
    questionType: normalizedType,
    options: initialOptions,
    correctAnswer: initialCorrectAnswer
  };
}

function normalizeAnswerIds(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[,，\s]+/);
  return [...new Set(values.map((item) => String(item).trim().toUpperCase()).filter(Boolean))].sort();
}

function normalizeOptionExplanations(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => ({
      id: String(item?.id || "").trim().toUpperCase(),
      explanation: currentQuestionText(item?.explanation || item?.text).trim()
    }))
    .filter((item) => item.id && item.explanation)
    .slice(0, 8);
}

function normalizeBankPlan(raw) {
  const contentAspects = Array.isArray(raw.contentAspects) ? raw.contentAspects : [];
  const aspectSubpoints = {};
  const contentAspectNames = contentAspects
    .map((item) => String(item?.aspect || "").trim())
    .filter(Boolean);
  contentAspects.forEach((item) => {
    const aspect = String(item?.aspect || "").trim();
    if (aspect) {
      aspectSubpoints[aspect] = asList(item?.subpoints, BANK_QUESTIONS_PER_ASPECT)
        .filter((subpoint) => subpoint.length >= 2);
    }
  });
  const coveragePlan = [...new Set([...contentAspectNames, ...asList(raw.coveragePlan, 16)]
    .map((item) => item.replace(/^["“”']|["“”']$/g, "").trim())
    .filter((item) => item.length >= 3))]
    .slice(0, BANK_ASPECT_COUNT);
  return {
    coveragePlan,
    aspectSubpoints,
    planningNote: String(raw.planningNote || "")
  };
}

function normalizeBankOptionExplanations(value, options, correctAnswer) {
  const explanations = normalizeOptionExplanations(value);
  const byId = new Map(explanations.map((item) => [item.id, item.explanation]));
  const correctSet = new Set(correctAnswer);
  return options.map((option) => {
    const fallback = correctSet.has(option.id)
      ? `该选项符合本题标准答案，属于本题考察内容的正确判断。`
      : `该选项不符合本题标准答案，容易与本题考察内容混淆。`;
    return {
      id: option.id,
      text: option.text,
      isCorrect: correctSet.has(option.id),
      wasSelected: false,
      explanation: currentQuestionText(byId.get(option.id) || fallback)
    };
  });
}

function normalizeBankQuestion(item, payload, index) {
  const { questionType, options, correctAnswer } = normalizeQuestionShape(item);
  if (!OBJECTIVE_TYPES.includes(questionType)) {
    return null;
  }
  const question = currentQuestionText(item.question || "").trim();
  if (!question || isGenericQuestion(question)) {
    return null;
  }
  const stage = REVIEW_STAGES.includes(item.stage) ? item.stage : REVIEW_STAGES[index % REVIEW_STAGES.length];
  const knowledgeAspect = String(item.knowledgeAspect || payload.aspect || "").trim();
  const focusSubpoint = String(item.focusSubpoint || item.subpoint || "").trim();
  return {
    id: `${Date.now()}-${payload.aspectIndex || 0}-${index}`,
    stage,
    knowledgeAspect,
    focusSubpoint,
    questionType,
    question,
    options,
    correctAnswer,
    basis: currentQuestionList(item.basis).slice(0, 2),
    questionAnalysis: currentQuestionText(item.questionAnalysis || `本题考察 ${knowledgeAspect} 中的关键判断。`),
    optionExplanations: normalizeBankOptionExplanations(item.optionExplanations, options, correctAnswer)
  };
}

function isGenericQuestion(question) {
  return /关于[“"]?.+[”"]?的[“"]?.+[”"]?阶段/.test(question)
    || question.includes("需要区分核心原理、适用边界和常见误区")
    || question.includes("在不同使用条件下，需要区分");
}

function textTokens(value) {
  const normalized = normalizeQuestionText(value);
  if (!normalized) {
    return [];
  }
  const chars = [...normalized];
  const grams = [];
  for (let index = 0; index < chars.length - 1; index += 1) {
    grams.push(`${chars[index]}${chars[index + 1]}`);
  }
  return grams.length ? grams : chars;
}

function jaccardSimilarity(left, right) {
  const a = new Set(textTokens(left));
  const b = new Set(textTokens(right));
  if (!a.size || !b.size) {
    return 0;
  }
  const intersection = [...a].filter((item) => b.has(item)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

function isSimilarQuestionText(candidate, existingQuestions) {
  const normalized = normalizeQuestionText(candidate);
  return existingQuestions.some((existing) => {
    const prior = normalizeQuestionText(existing);
    if (!prior || !normalized) {
      return false;
    }
    if (prior === normalized || prior.includes(normalized) || normalized.includes(prior)) {
      return true;
    }
    return jaccardSimilarity(prior, normalized) >= 0.72;
  });
}

function normalizeBankQuestions(raw, payload) {
  const source = Array.isArray(raw.questions) ? raw.questions : [];
  const seen = new Set();
  const existingQuestions = asList(payload.existingQuestions, 80);
  const existingSubpoints = new Set(asList(payload.existingSubpoints, 80));
  const seenSubpoints = new Set(existingSubpoints);
  const questions = source
    .map((item, index) => normalizeBankQuestion(item, payload, index))
    .filter(Boolean)
    .filter((item) => {
      const key = normalizeQuestionText(item.question);
      if (!key || seen.has(key) || isSimilarQuestionText(item.question, [...existingQuestions, ...seen])) {
        return false;
      }
      if (item.focusSubpoint && seenSubpoints.has(item.focusSubpoint)) {
        return false;
      }
      seen.add(key);
      if (item.focusSubpoint) {
        seenSubpoints.add(item.focusSubpoint);
      }
      return true;
    })
    .slice(0, BANK_QUESTIONS_PER_ASPECT);
  return {
    questions,
    generationWarning: raw.generationWarning ? String(raw.generationWarning) : ""
  };
}

function getCoveredStages(history) {
  return [...new Set(
    history
      .map((item) => item.evaluation?.stage)
      .filter((stage) => REVIEW_STAGES.includes(stage))
  )];
}

function getCoveragePlan(history) {
  const latestPlan = [...history]
    .reverse()
    .find((item) => Array.isArray(item.evaluation?.coveragePlan) && item.evaluation.coveragePlan.length)?.evaluation.coveragePlan || [];
  const aspects = history
    .map((item) => item.evaluation?.knowledgeAspect)
    .filter(Boolean);
  return [...new Set([...latestPlan, ...aspects].map((item) => String(item).trim()).filter(Boolean))].slice(0, 12);
}

function getAspectStats(history, plan = getCoveragePlan(history)) {
  return plan.map((aspect) => {
    const items = history.filter((item) => item.evaluation?.knowledgeAspect === aspect);
    const objective = items.filter((item) => OBJECTIVE_TYPES.includes(item.evaluation?.answeredQuestionType || item.evaluation?.questionType));
    const weak = items.filter((item) => {
      const evaluation = item.evaluation || {};
      return Number(evaluation.score || 0) < 85
        || evaluation.objectiveCorrect === false
        || evaluation.needsVerification
        || (evaluation.errorPoints || []).length > 0
        || (evaluation.missingPoints || []).length > 1;
    });
    return {
      aspect,
      count: objective.length,
      weakCount: weak.length,
      accuracy: objective.length
        ? objective.filter((item) => item.evaluation?.objectiveCorrect).length / objective.length
        : 0
    };
  });
}

function chooseNextStage(history) {
  const covered = getCoveredStages(history);
  return REVIEW_STAGES.find((stage) => !covered.includes(stage)) || REVIEW_STAGES.at(-1);
}

function chooseNextContentAspect(history, plan = getCoveragePlan(history)) {
  const aspectStats = getAspectStats(history, plan);
  const uncovered = aspectStats
    .filter((item) => item.count < MIN_OBJECTIVE_QUESTIONS_PER_ASPECT)
    .sort((a, b) => a.count - b.count);
  if (uncovered.length) {
    return uncovered[0].aspect;
  }
  const weak = aspectStats
    .filter((item) => item.weakCount > 0 || item.accuracy < MIN_OBJECTIVE_ACCURACY_FOR_MASTERY)
    .sort((a, b) => b.weakCount - a.weakCount || a.accuracy - b.accuracy);
  return weak[0]?.aspect || plan[0] || "";
}

function getObjectiveStats(history) {
  const objective = history.filter((item) => OBJECTIVE_TYPES.includes(item.evaluation?.answeredQuestionType || item.evaluation?.questionType));
  const correct = objective.filter((item) => item.evaluation?.objectiveCorrect).length;
  return {
    count: objective.length,
    correct,
    accuracy: objective.length ? correct / objective.length : 0
  };
}

function chooseNextQuestionType(history) {
  const objectiveStats = getObjectiveStats(history);
  return OBJECTIVE_TYPES[objectiveStats.count % OBJECTIVE_TYPES.length];
}

function normalizeQuestionText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[“”"'`，。！？、；：,.!?;:\s]/g, "");
}

function isSimilarQuestion(candidate, history) {
  const normalized = normalizeQuestionText(candidate);
  if (normalized.length < 8) {
    return false;
  }
  return history.some((item) => {
    const prior = normalizeQuestionText(item.question || item.evaluation?.question || "");
    return prior && (prior === normalized || prior.includes(normalized) || normalized.includes(prior));
  });
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeScore(value) {
  const numeric = Number(value || 0);
  const expanded = numeric > 0 && numeric <= 10 ? numeric * 10 : numeric;
  return Math.max(0, Math.min(100, expanded));
}

function scoreObjectiveAnswer(review, payload) {
  if (payload.mode !== "answer" || !OBJECTIVE_TYPES.includes(payload.questionType)) {
    return review;
  }

  const selected = normalizeAnswerIds(payload.answerIds);
  const correct = normalizeAnswerIds(payload.correctAnswer);
  const selectedSet = new Set(selected);
  const correctSet = new Set(correct);
  const exact = selected.length === correct.length && selected.every((id) => correctSet.has(id));
  const rightSelected = selected.filter((id) => correctSet.has(id)).length;
  const wrongSelected = selected.filter((id) => !correctSet.has(id)).length;
  const missed = correct.filter((id) => !selectedSet.has(id)).length;
  const missedCorrectTexts = (payload.options || [])
    .filter((option) => correctSet.has(option.id) && !selectedSet.has(option.id))
    .map((option) => payload.questionType === "multiple_choice"
      ? `你漏选了 ${option.id}. ${option.text}。该选项属于本题标准答案。`
      : `正确答案是 ${option.id}. ${option.text}。${option.id} 正确：该选项最符合题干的核心问法。`);
  const partial = correct.length ? Math.max(0, Math.round((rightSelected / correct.length - wrongSelected * 0.35) * 100)) : 0;
  const score = exact ? 100 : Math.min(70, partial);
  const answerLabel = selected.length ? selected.join("、") : "未选择";
  const correctLabel = correct.join("、");
  const objectiveBasis = exact
    ? [`你的选择 ${answerLabel} 与标准答案 ${correctLabel} 完全一致。`]
    : [`你的选择是 ${answerLabel}，标准答案是 ${correctLabel}。`];
  const questionTypeLabel = payload.questionType === "true_false" ? "判断题" : payload.questionType === "single_choice" ? "单选题" : "多选题";
  const selectedTexts = (payload.options || [])
    .filter((option) => selectedSet.has(option.id))
    .map((option) => `${option.id}. ${option.text}`);
  const correctTexts = (payload.options || [])
    .filter((option) => correctSet.has(option.id))
    .map((option) => `${option.id}. ${option.text}`);
  const optionExplanations = (payload.options || []).map((option) => {
    const isCorrect = correctSet.has(option.id);
    const wasSelected = selectedSet.has(option.id);
    const status = isCorrect
      ? wasSelected ? "你选中了这个正确选项" : "这是正确选项，但你没有选中"
      : wasSelected ? "你选中了这个错误选项" : "这是错误选项";
    const prefix = isCorrect ? "该选项是标准答案。" : "该选项不是标准答案。";
    return {
      id: option.id,
      text: option.text,
      isCorrect,
      wasSelected,
      explanation: `${prefix}${status}。选项内容为“${option.text}”，${isCorrect ? "符合" : "不符合"}本题标准答案集合 ${correctLabel}。`
    };
  });
  const answeredQuestionAnalysis = [
    `考点：${review.stage || "当前"}阶段的${questionTypeLabel}辨析。`,
    `关键：根据题干判断哪些选项符合本题标准答案。`
  ].join("");
  const answerComparison = {
    selected: selected.length ? selectedTexts : ["未选择"],
    correct: correctTexts,
    selectedIds: selected,
    correctIds: correct
  };
  const nextTimeStrategy = payload.questionType === "multiple_choice"
    ? "下次遇到多选题，先分别判断每个选项是否独立成立，再检查有没有漏选。"
    : payload.questionType === "single_choice"
      ? "下次遇到单选题，先找最直接回答题干核心问法的选项，再排除表述过宽或偏离题干的选项。"
      : "下次遇到判断题，先定位题干中的绝对化词、阶段限定和因果关系，再判断正误。";

  return {
    ...review,
    answeredQuestionType: payload.questionType,
    score,
    objectiveCorrect: exact,
    positivePoints: exact
      ? [`客观题选择正确：${answerLabel}`, ...review.positivePoints]
      : review.positivePoints.filter((point) => !point.includes("正确")),
    errorPoints: exact
      ? review.errorPoints
      : [`客观题选择不正确：你的选择是 ${answerLabel}，标准答案是 ${correctLabel}。`, ...review.errorPoints],
    missingPoints: missed
      ? [...review.missingPoints, ...missedCorrectTexts]
      : review.missingPoints,
    verdict: exact ? "客观题回答正确。" : "客观题回答错误。",
    conclusion: exact
      ? `回答正确。你的选择是 ${answerLabel}，标准答案是 ${correctLabel}。`
      : `回答错误。你的选择是 ${answerLabel}，标准答案是 ${correctLabel}。`,
    questionAnalysis: answeredQuestionAnalysis,
    answerComparison,
    remedialPoint: "",
    nextTimeStrategy,
    optionExplanations,
    basis: [...objectiveBasis, ...review.basis.filter((item) => !item.includes("论文") && !item.includes("Press") && !item.includes("201"))].slice(0, 5)
  };
}

function applyMasteryGate(review, payload) {
  if (payload.mode === "start" || payload.mode === "explain" || payload.mode === "newQuestion" || payload.mode === "followup" || payload.mode === "subjective" || payload.mode === "objective") {
    return { ...review, mastered: false, masterySummary: "" };
  }

  const prior = payload.history || [];
  const mergedHistory = [...prior, { evaluation: review }];
  const allScores = mergedHistory.map((item) => Number(item.evaluation?.score || 0));
  const recentAverage = average(allScores.slice(-3));
  const coveragePlan = getCoveragePlan(mergedHistory);
  const aspectStats = getAspectStats(mergedHistory, coveragePlan);
  const objectiveStats = getObjectiveStats(mergedHistory);
  const hasRecentWeakAnswer = allScores.slice(-3).some((score) => score < 75);
  const hasOpenRisk = review.needsVerification || review.errorPoints.length > 0 || review.missingPoints.length > 1;
  const requiredObjectiveCount = Math.max(
    MIN_OBJECTIVE_QUESTIONS_FOR_MASTERY,
    coveragePlan.length * MIN_OBJECTIVE_QUESTIONS_PER_ASPECT
  );
  const objectiveMasteryPassed = objectiveStats.count >= requiredObjectiveCount
    && objectiveStats.accuracy >= MIN_OBJECTIVE_ACCURACY_FOR_MASTERY;
  const aspectCoveragePassed = coveragePlan.length >= MIN_CONTENT_ASPECTS_FOR_MASTERY
    && aspectStats.every((item) => item.count >= MIN_OBJECTIVE_QUESTIONS_PER_ASPECT);
  const gatePassed = prior.length + 1 >= requiredObjectiveCount
    && recentAverage >= 85
    && review.score >= 85
    && aspectCoveragePassed
    && objectiveMasteryPassed
    && !hasRecentWeakAnswer
    && !hasOpenRisk;

  if (gatePassed) {
    return {
      ...review,
      mastered: true,
      nextQuestion: "",
      nextQuestionReason: "",
      masterySummary: review.masterySummary || `你已经通过 ${objectiveStats.count} 道客观题覆盖了 ${coveragePlan.join("、")} 等内容方面，每个方面至少完成 ${MIN_OBJECTIVE_QUESTIONS_PER_ASPECT} 道客观题，客观题正确率达到 ${Math.round(objectiveStats.accuracy * 100)}%，可以结束本轮复习。`
    };
  }

  const nextStage = chooseNextStage(mergedHistory);
  const nextAspect = chooseNextContentAspect(mergedHistory, coveragePlan);
  const nextType = chooseNextQuestionType(mergedHistory);
  const returnedQuestion = String(review.question || review.nextQuestion || "").trim();
  const repeatedQuestion = payload.currentQuestion && returnedQuestion === String(payload.currentQuestion).trim();
  const aspectCoveragePassedNow = coveragePlan.length >= MIN_CONTENT_ASPECTS_FOR_MASTERY
    && aspectStats.every((item) => item.count >= MIN_OBJECTIVE_QUESTIONS_PER_ASPECT);
  return {
    ...review,
    mastered: false,
    masterySummary: "",
    question: review.question,
    nextQuestion: review.nextQuestion || review.question,
    questionType: review.questionType || nextType,
    options: review.options,
    correctAnswer: review.correctAnswer,
    knowledgeAspect: nextAspect || review.knowledgeAspect,
    coveragePlan,
    nextQuestionReason: review.nextQuestionReason || `${repeatedQuestion ? "模型返回了与当前题相同的问题，下一轮会继续要求围绕不同子点出题。" : ""}还没有满足内容覆盖式复盘标准：每个内容方面至少 ${MIN_OBJECTIVE_QUESTIONS_PER_ASPECT} 道客观题、至少 ${MIN_CONTENT_ASPECTS_FOR_MASTERY} 个核心内容方面、正确率 ${Math.round(MIN_OBJECTIVE_ACCURACY_FOR_MASTERY * 100)}%。当前内容覆盖${aspectCoveragePassedNow ? "已达标，正在补薄弱方面" : "未达标，优先补齐未覆盖内容方面"}。`
  };
}

function normalizeReview(raw) {
  const stage = REVIEW_STAGES.includes(raw.stage) ? raw.stage : "定义";
  const { questionType, options, correctAnswer } = normalizeQuestionShape(raw);
  const question = String(raw.question || raw.nextQuestion || "");
  const coveragePlan = asList(raw.coveragePlan).slice(0, 12);
  const knowledgeAspect = String(raw.knowledgeAspect || coveragePlan[0] || stage || "综合理解").trim();
  return {
    configurationMissing: Boolean(raw.configurationMissing),
    mastered: Boolean(raw.mastered),
    score: normalizeScore(raw.score),
    stage,
    knowledgeAspect,
    coveragePlan,
    answeredQuestionType: normalizeQuestionType(raw.answeredQuestionType),
    questionType,
    question,
    options,
    correctAnswer,
    conclusion: currentQuestionText(raw.conclusion),
    questionAnalysis: currentQuestionText(raw.questionAnalysis),
    answerComparison: raw.answerComparison || null,
    remedialPoint: String(raw.remedialPoint || ""),
    nextTimeStrategy: String(raw.nextTimeStrategy || ""),
    optionExplanations: normalizeOptionExplanations(raw.optionExplanations),
    objectiveCorrect: Boolean(raw.objectiveCorrect),
    verdict: currentQuestionText(raw.verdict || "已收到回答。"),
    basis: currentQuestionList(raw.basis),
    positivePoints: currentQuestionList(raw.positivePoints),
    errorPoints: currentQuestionList(raw.errorPoints),
    missingPoints: currentQuestionList(raw.missingPoints),
    gaps: currentQuestionList(raw.gaps),
    correction: currentQuestionText(raw.correction),
    explanation: currentQuestionText(raw.explanation),
    followupAnswer: currentQuestionText(raw.followupAnswer),
    needsVerification: Boolean(raw.needsVerification),
    verificationNote: currentQuestionText(raw.verificationNote),
    nextQuestion: String(raw.nextQuestion || question),
    nextQuestionReason: String(raw.nextQuestionReason || ""),
    masterySummary: String(raw.masterySummary || "")
  };
}

function normalizeObjectiveFeedback(raw) {
  return {
    errorPoints: currentQuestionList(raw.errorPoints).slice(0, 4),
    missingPoints: currentQuestionList(raw.missingPoints).slice(0, 4),
    basis: currentQuestionList(raw.basis).slice(0, 3),
    nextTimeStrategy: currentQuestionText(raw.nextTimeStrategy)
  };
}

function ensureObjectiveQuestion(review, payload) {
  if (payload.mode !== "objective" || OBJECTIVE_TYPES.includes(review.questionType)) {
    return review;
  }
  const nextType = chooseNextQuestionType(payload.history || []);
  const stage = payload.stage || review.stage || chooseNextStage(payload.history || []);
  const plan = getCoveragePlan(payload.history || []);
  const aspect = chooseNextContentAspect(payload.history || [], plan) || review.knowledgeAspect || "核心内容";
  const question = `在“${payload.topic}”的“${aspect}”方面，下列哪一项最能体现该知识点的关键判断？`;
  return {
    ...review,
    mastered: false,
    stage,
    knowledgeAspect: aspect,
    coveragePlan: plan.length ? plan : review.coveragePlan,
    questionType: "single_choice",
    question,
    nextQuestion: question,
    options: [
      { id: "A", text: `需要结合 ${aspect} 的具体结构、条件或任务目标判断。` },
      { id: "B", text: `只要记住 ${payload.topic} 的名称，就能判断所有相关问题。` },
      { id: "C", text: `该方面与输入、结构、任务目标和边界条件都无关。` }
    ],
    correctAnswer: ["A"],
    nextQuestionReason: "用户从简答题切回客观题，按当前内容覆盖计划生成客观题。"
  };
}

async function requestDeepSeekJson(messages) {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: deepseekModel,
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DEEPSEEK_${response.status}: ${text.slice(0, 500)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "{}";
}

async function parseModelJsonWithRepair(content, payload) {
  try {
    return parseModelJson(content);
  } catch (error) {
    if (!["bankPlan", "bankExpandPlan", "bankQuestions"].includes(payload.mode)) {
      throw error;
    }
    try {
      const repaired = await requestDeepSeekJson(buildRepairJsonMessages(content, payload.mode));
      return parseModelJson(repaired);
    } catch (repairError) {
      if (payload.mode === "bankQuestions") {
        return {
          questions: [],
          generationWarning: `该批题目 JSON 解析失败，已跳过本批：${repairError.message}`
        };
      }
      throw repairError;
    }
  }
}

async function callDeepSeek(payload) {
  if (!process.env.DEEPSEEK_API_KEY) {
    if (payload.mode === "bankPlan") {
      return {
        configurationMissing: true,
        coveragePlan: [],
        planningNote: "还没有配置 DeepSeek API Key，无法生成题库计划。"
      };
    }
    if (payload.mode === "bankExpandPlan") {
      return {
        configurationMissing: true,
        coveragePlan: [],
        aspectSubpoints: {},
        planningNote: "还没有配置 DeepSeek API Key，无法扩展题库内容方面。"
      };
    }
    if (payload.mode === "bankQuestions") {
      return {
        configurationMissing: true,
        questions: []
      };
    }
    if (payload.mode === "objectiveFeedback") {
      return {
        configurationMissing: true,
        errorPoints: [],
        missingPoints: [],
        basis: [],
        nextTimeStrategy: ""
      };
    }
    return {
      configurationMissing: true,
      mastered: false,
      score: 0,
      stage: chooseNextStage(payload.history || []),
      knowledgeAspect: "基础概念",
      coveragePlan: [],
      answeredQuestionType: payload.questionType || "short_answer",
      questionType: "short_answer",
      question: payload.mode === "start" ? `请先用一句话解释：${payload.topic} 是什么？` : "",
      options: [],
      correctAnswer: [],
      conclusion: "",
      questionAnalysis: "",
      answerComparison: null,
      remedialPoint: "",
      nextTimeStrategy: "",
      optionExplanations: [],
      objectiveCorrect: false,
      verdict: "还没有配置 DeepSeek API Key。",
      basis: ["后端需要通过 DEEPSEEK_API_KEY 调用 DeepSeek API，当前环境变量为空。"],
      positivePoints: [],
      errorPoints: [],
      missingPoints: ["请先完成 API Key 配置。"],
      gaps: ["请先在 .env 或启动命令中配置 DEEPSEEK_API_KEY。"],
      correction: "",
      explanation: "",
      needsVerification: true,
      verificationNote: "未调用模型，因此没有生成真实评估。",
      nextQuestion: payload.mode === "start" ? `请先用一句话解释：${payload.topic} 是什么？` : "",
      nextQuestionReason: "API Key 缺失时只能提供占位问题。",
      masterySummary: ""
    };
  }

  const messages = payload.mode === "bankPlan"
    ? buildBankPlanMessages(payload)
    : payload.mode === "bankExpandPlan"
      ? buildBankExpandPlanMessages(payload)
    : payload.mode === "bankQuestions"
      ? buildBankQuestionsMessages(payload)
    : payload.mode === "objectiveFeedback"
      ? buildObjectiveFeedbackMessages(payload)
      : buildMessages(payload);

  const content = await requestDeepSeekJson(messages);
  const parsed = await parseModelJsonWithRepair(content, payload);
  if (payload.mode === "bankPlan" || payload.mode === "bankExpandPlan") {
    return normalizeBankPlan(parsed);
  }
  if (payload.mode === "bankQuestions") {
    return normalizeBankQuestions(parsed, payload);
  }
  if (payload.mode === "objectiveFeedback") {
    return normalizeObjectiveFeedback(parsed);
  }
  const review = ensureObjectiveQuestion(scoreObjectiveAnswer(normalizeReview(parsed), payload), payload);
  return applyMasteryGate(review, payload);
}

async function handleStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream"
    });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/review") {
    try {
      const payload = await readRequestJson(request);
      if (!payload.topic || !["start", "answer", "explain", "newQuestion", "followup", "subjective", "objective", "bankPlan", "bankExpandPlan", "bankQuestions", "objectiveFeedback"].includes(payload.mode)) {
        sendJson(response, 400, { error: "BAD_REQUEST" });
        return;
      }
      payload.topic = String(payload.topic).trim().slice(0, MAX_TOPIC_LENGTH);
      payload.answer = String(payload.answer || "").trim().slice(0, MAX_ANSWER_LENGTH);
      payload.followupQuestion = String(payload.followupQuestion || "").trim().slice(0, MAX_ANSWER_LENGTH);
      if (payload.questionType) {
        payload.questionType = normalizeQuestionType(payload.questionType);
      }
      payload.answerIds = normalizeAnswerIds(payload.answerIds);
      payload.correctAnswer = normalizeAnswerIds(payload.correctAnswer);
      const review = await callDeepSeek(payload);
      sendJson(response, 200, review);
    } catch (error) {
      sendJson(response, 500, {
        error: "REVIEW_FAILED",
        message: error.message.startsWith("DEEPSEEK_") ? "DeepSeek API 调用失败，请检查 Key、额度或网络。" : error.message
      });
    }
    return;
  }

  if (request.method === "GET") {
    await handleStatic(request, response);
    return;
  }

  response.writeHead(405);
  response.end("Method not allowed");
});

server.listen(port, () => {
  console.log(`Knowledge review coach: http://localhost:${port}`);
});
