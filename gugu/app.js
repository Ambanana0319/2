import { api, createApiRequestId, projectApiActivity } from "./js/api.js";
import {
  consolidateRelationshipEdges as consolidateRelationshipEdgesData,
  limitRelationshipEdges,
  mergeHistoricalRelationshipMap as mergeHistoricalRelationshipMapData,
  plannedRelationshipEdges as plannedRelationshipEdgesData,
  readableCharacterCardValues as readableCharacterCardValuesData,
  readerSafeCharacterCard as readerSafeCharacterCardData,
  recoverSpoilerConfirmation,
  relationshipEdgesThroughChapter as relationshipEdgesThroughChapterData,
  relationshipKind as relationshipKindData,
  relationshipMainNodes as relationshipMainNodesData
} from "./js/relationship-map.js";
import { state } from "./js/state.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const APP_THEME_STORAGE_KEY = "gugu-app-theme";

function applyAppTheme(theme) {
  const night = theme === "night";
  document.body.classList.toggle("theme-night", night);
  const button = $("#themeToggleButton");
  button.setAttribute("aria-pressed", String(night));
  button.setAttribute("aria-label", night ? "切换到浅色模式" : "切换到夜间模式");
  button.title = night ? "切换到浅色模式" : "切换到夜间模式";
  button.querySelector(".theme-toggle-label").textContent = night ? "日间" : "夜间";
  $("#themeColorMeta").content = night ? "#1b1e21" : "#fafaf8";
}

function beginButtonFeedback(button, label) {
  if (!button) return;
  clearTimeout(button._feedbackTimer);
  if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent;
  button.disabled = true;
  button.classList.add("is-sending");
  button.setAttribute("aria-busy", "true");
  button.textContent = label;
}

function finishButtonFeedback(button, label = "已传达 ✓", delay = 850, reenable = true) {
  if (!button) return;
  button.classList.remove("is-sending");
  button.removeAttribute("aria-busy");
  button.textContent = label;
  button._feedbackTimer = setTimeout(() => {
    if (reenable) button.disabled = false;
    button.textContent = button.dataset.idleLabel || "发送";
    delete button.dataset.idleLabel;
  }, delay);
}

function failButtonFeedback(button, label = "未送达 · 点击重试") {
  if (!button) return;
  button.classList.remove("is-sending");
  button.removeAttribute("aria-busy");
  button.disabled = false;
  button.textContent = label;
}

const statusText = {
  setup: "等待原著",
  preparing: "正在准备原著",
  source_ready: "切割完成，等待全书阅读",
  premise: "可以规划故事",
  planning: "等待原著资料",
  outline_review: "旧版大纲待启用",
  writing: "等待下一章",
  draft: "本章草稿待确认",
  archived: "已废弃"
};

const levelNames = {
  l: ["一件事或场景", "局部连续剧情", "一条完整主线", "整部小说"],
  d: ["只写结局", "说明因果", "呈现事件", "展开剧场"],
  f: ["借用原著元素", "改写原著主线", "沿原著主线", "忠实还原原著"]
};

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.remove("is-hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("is-hidden"), 3000);
}

function renderLibraryStatusNotice() {
  let notice = $("#libraryStatusNotice");
  if (!state.libraryError) {
    notice?.remove();
    return;
  }
  if (!notice) {
    notice = document.createElement("section");
    notice.id = "libraryStatusNotice";
    notice.className = "persistent-status is-error";
    $("#libraryOverview")?.insertAdjacentElement("afterend", notice);
  }
  notice.innerHTML = `<span>STATUS HOLD</span><b>最新状态暂时读取失败</b><p>${escapeHtml(state.libraryError)}。页面保留上一次成功读取的项目，不会把它们误显示为空。</p>`;
}

function renderProjectStatusNotice() {
  let notice = $("#projectStatusNotice");
  const messages = [state.projectRefreshError, state.preparationError].filter(Boolean);
  if (!messages.length) {
    notice?.remove();
    return;
  }
  if (!notice) {
    notice = document.createElement("section");
    notice.id = "projectStatusNotice";
    notice.className = "persistent-status is-error";
    $("#workbenchView .reading-shell")?.insertAdjacentElement("beforebegin", notice);
  }
  notice.innerHTML = `<span>LAST GOOD STATE PRESERVED</span><b>部分最新状态暂时无法读取</b><p>${escapeHtml(messages.join("；"))}。当前章节、进度和任务记录仍保留上一次有效结果。</p>`;
}

function formatDurationRange(low, high) {
  const format = (seconds) => {
    const minutes = Math.max(1, Math.round(Number(seconds || 0) / 60));
    if (minutes < 60) return `${minutes} 分钟`;
    const hours = minutes / 60;
    return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} 小时`;
  };
  return `${format(low)}～${format(high)}`;
}

function buildLocalBookEstimate(project, run) {
  if (!project?.outline_id) return { available: false, reason: "隐藏大纲完成后才能估算整书章节数" };
  const chapterTarget = Math.max(500, Number(project.chapter_word_target || 3500));
  const totalChapters = Number(run?.end_chapter || Math.ceil(Number(project.w_target || 0) / chapterTarget));
  const confirmed = Number(run?.book_confirmed_chapters ?? projectConfirmed(project));
  const remaining = Math.max(0, totalChapters - confirmed);
  const spent = Number(run?.estimated_cost_cny || 0);
  const measured = Number(run?.completed_chapters || 0);
  const observedCost = measured ? spent / measured : 0;
  const wordScale = chapterTarget / 3500;
  const mock = project.writer_profile_id === "mock";
  const profile = profileById(project.writer_profile_id);
  const rates = run?.settings?.rates_cny_per_million || profile?.pricing || {};
  const pricingConfigured = mock || ["input", "cached_input", "output"].every((key) => Number.isFinite(Number(rates[key])));
  const remainingWords = remaining * chapterTarget;
  const estimateTokenCost = (promptTokens, completionTokens) => (
    (promptTokens * Number(rates.input || 0) + completionTokens * Number(rates.output || 0)) / 1_000_000
  );
  const costLow = pricingConfigured
    ? (mock ? 0 : remaining * (observedCost ? observedCost * .72 : 0) || estimateTokenCost(remainingWords * 8, remainingWords * 1.2))
    : null;
  const costHigh = pricingConfigured
    ? (mock ? 0 : remaining * (observedCost ? observedCost * 1.52 : 0) || estimateTokenCost(remainingWords * 18, remainingWords * 4))
    : null;
  return {
    available: true,
    basis: measured ? "project_history" : "target_length",
    sample_chapters: measured,
    confidence: measured >= 8 ? "high" : measured ? "medium" : "low",
    pricing_configured: pricingConfigured,
    pricing_profile_id: project.writer_profile_id,
    rates_cny_per_million: rates,
    total_chapters: totalChapters,
    next_chapter: confirmed + 1,
    end_chapter: totalChapters,
    remaining_chapters: remaining,
    estimated_duration_low_seconds: Number(run?.eta_low_seconds || remaining * (mock ? 1 : 150 * wordScale)),
    estimated_duration_high_seconds: Number(run?.eta_high_seconds || remaining * (mock ? 5 : 480 * wordScale)),
    estimated_remaining_cost_low_cny: costLow,
    estimated_remaining_cost_high_cny: costHigh,
    estimated_total_cost_low_cny: costLow == null ? null : spent + costLow,
    estimated_total_cost_high_cny: costHigh == null ? null : spent + costHigh,
    spent_cost_cny: spent,
    estimated_api_calls_low: remaining * (mock ? 1 : 2),
    estimated_api_calls_high: remaining * (mock ? 1 : 6)
  };
}

function applyReaderPreferences() {
  const manuscript = $("#manuscript");
  if (!manuscript) return;
  ["white", "warm", "night", "custom"].forEach((theme) => manuscript.classList.toggle(`theme-${theme}`, state.readingTheme === theme));
  ["song", "kai", "sans"].forEach((font) => manuscript.classList.toggle(`font-${font}`, state.readingFont === font));
  ["deep", "soft", "contrast", "custom"].forEach((tone) => manuscript.classList.toggle(`tone-${tone}`, state.readingTone === tone));
  state.readingFontSize = Math.max(14, Math.min(28, Number(state.readingFontSize) || 18));
  state.readingLineWidth = Math.max(480, Math.min(980, Number(state.readingLineWidth) || 700));
  manuscript.style.setProperty("--reader-font-size", `${state.readingFontSize}px`);
  manuscript.style.setProperty("--reader-line-width", `${state.readingLineWidth}px`);
  manuscript.style.setProperty("--reader-paper-color", state.readingPaperColor);
  manuscript.style.setProperty("--reader-ink-color", state.readingInkColor);
  $("#readingThemeSelect").value = state.readingTheme;
  $("#readingFontSelect").value = state.readingFont;
  $("#readingToneSelect").value = state.readingTone;
  $("#readingPaperColor").value = state.readingPaperColor;
  $("#readingInkColor").value = state.readingInkColor;
  $("#readingSizeValue").textContent = `${state.readingFontSize} px`;
  $("#readingWidthValue").textContent = `${state.readingLineWidth} px`;
  updateReaderContrast();
}

function syncReaderThemeToApp() {
  state.readingTheme = document.body.classList.contains("theme-night") ? "night" : "white";
  state.readingTone = "deep";
  applyReaderPreferences();
}

function rememberReaderPreferences() {
  try {
    localStorage.setItem("gugu-reading-theme", state.readingTheme);
    localStorage.setItem("gugu-reading-font", state.readingFont);
    localStorage.setItem("gugu-reading-font-size", String(state.readingFontSize));
    localStorage.setItem("gugu-reading-line-width", String(state.readingLineWidth));
    localStorage.setItem("gugu-reading-tone", state.readingTone);
    localStorage.setItem("gugu-reading-paper-color", state.readingPaperColor);
    localStorage.setItem("gugu-reading-ink-color", state.readingInkColor);
  } catch {}
}

function readerColor(value, fallback) {
  const match = String(value || "").match(/^#([0-9a-f]{6})$/i);
  return match ? match[0] : fallback;
}

function colorLuminance(color) {
  const hex = readerColor(color, "#ffffff").slice(1);
  const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

function updateReaderContrast() {
  const paper = state.readingTheme === "custom" ? state.readingPaperColor
    : ({ white: "#ffffff", warm: "#f8f3e8", night: "#171a1e" }[state.readingTheme] || "#f8f3e8");
  const night = state.readingTheme === "night";
  const ink = state.readingTone === "custom" ? state.readingInkColor
    : night
      ? ({ deep: "#e8e6df", soft: "#b9c0c4", contrast: "#ffffff" }[state.readingTone] || "#e8e6df")
      : ({ deep: "#27333d", soft: "#566168", contrast: "#111820" }[state.readingTone] || "#27333d");
  const values = [colorLuminance(paper), colorLuminance(ink)].sort((a, b) => b - a);
  const ratio = (values[0] + .05) / (values[1] + .05);
  const note = $("#readerContrastNote");
  if (!note) return;
  note.classList.toggle("is-low", ratio < 4.5);
  note.querySelector("span").textContent = ratio < 4.5 ? `当前对比偏低 · ${ratio.toFixed(1)}:1` : `纸面与墨色清晰 · ${ratio.toFixed(1)}:1`;
}

function openModal(id) { $("#" + id).classList.remove("is-hidden"); }
function closeModal(id) { $("#" + id).classList.add("is-hidden"); }
function formatNumber(value) { return Number(value || 0).toLocaleString("zh-CN"); }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function messageMetadata(message) {
  if (message?.metadata && typeof message.metadata === "object") return message.metadata;
  try { return JSON.parse(message?.metadata_json || "{}"); } catch { return {}; }
}

function normalizeClarificationQuestion(item, index = 0) {
  if (typeof item === "string") {
    const text = item.trim();
    return text ? { key: `missing-${index}`, question: `请确认：${text}`, options: [] } : null;
  }
  if (!item || typeof item !== "object") return null;
  const question = String(item.question || item.text || item.prompt || item.label || "").trim();
  if (!question) return null;
  const options = Array.isArray(item.options)
    ? item.options.map((option) => typeof option === "string" ? option : option?.label || option?.value).filter(Boolean).slice(0, 4)
    : [];
  return { key: String(item.key || item.id || `question-${index}`), question, options };
}

function briefSystemValidationIssues(brief = state.brief) {
  const notices = brief?.route_preview?.status?.notices || [];
  return notices.filter((item) => item?.kind === "system_repair");
}

function briefUserDecisionQuestions(brief = state.brief) {
  const validation = brief?.route_preview?.status?.notices || [];
  const characters = Array.isArray(brief?.route_preview?.receipt?.core_characters)
    ? brief.route_preview.receipt.core_characters
    : [];
  const byName = new Map(characters.map((item) => [String(item?.name || ""), item]));
  const questions = [];
  validation.filter((item) => item?.kind === "user_decision").forEach((item, issueIndex) => {
    if (item.characters?.length) {
      (Array.isArray(item.characters) ? item.characters : []).forEach((name, characterIndex) => {
        const card = byName.get(String(name || "")) || {};
        const points = Array.isArray(card.uncertain_points)
          ? card.uncertain_points.map((value) => String(value || "").trim()).filter(Boolean)
          : [];
        if (!points.length) return;
        questions.push({
          key: `character-${issueIndex}-${characterIndex}`,
          question: `${name}：请确认${points.join("；")}。如果原始要求已经写明，直接重述已确定答案即可。`,
          options: []
        });
      });
      if (questions.length) return;
    }
    const question = String(item.question || item.message || "").trim();
    if (question) questions.push({ key: `validation-${issueIndex}`, question, options: [] });
  });
  return questions;
}

function briefTechnicalNotices(brief = state.brief) {
  const pattern = /(中断|超时|网络|限流|连接|服务|请求|返回截断|JSON|结构化输出|provider|timeout|rate.?limit)/i;
  const missing = Array.isArray(brief?.missing) ? brief.missing : [];
  const systemIssues = briefSystemValidationIssues(brief);
  const systemMessages = new Set(systemIssues.map((item) => String(item.message || "").trim()).filter(Boolean));
  const notices = missing.filter((item) => pattern.test(String(item || "")) || systemMessages.has(String(item || "").trim()));
  if (brief?.route_preview?.status?.recompile_required) {
    notices.push(brief.route_preview.status.message || "方向合同需要由当前机器编译器重新编译");
  }
  systemIssues.forEach((item) => {
    if (item.message) notices.push(String(item.message));
  });
  return [...new Set(notices.filter(Boolean))];
}

function briefClarificationQuestions(brief = state.brief) {
  const previewSemantics = brief?.route_preview?.receipt?.semantics || {};
  const latestAssistant = [...(brief?.messages || [])].reverse().find((message) => message.role === "assistant");
  const latestMessageQuestions = messageMetadata(latestAssistant).questions;
  if (Array.isArray(latestMessageQuestions) && latestMessageQuestions.length) {
    return latestMessageQuestions
      .map((item, index) => normalizeClarificationQuestion(item, index))
      .filter(Boolean)
      .slice(0, 12);
  }
  const userDecisionIssues = (brief?.route_preview?.status?.notices || [])
    .filter((item) => item?.kind === "user_decision");
  const userDecisionMessages = new Set(
    userDecisionIssues.map((item) => String(item?.message || "").trim()).filter(Boolean)
  );
  const candidates = [
    ...briefUserDecisionQuestions(brief),
    ...(Array.isArray(brief?.clarification_questions) ? brief.clarification_questions : []),
    ...(Array.isArray(brief?.questions) ? brief.questions : []),
    ...(Array.isArray(latestMessageQuestions) ? latestMessageQuestions : []),
    ...(Array.isArray(brief?.semantic_receipt?.questions) ? brief.semantic_receipt.questions : []),
    ...(Array.isArray(previewSemantics.questions) ? previewSemantics.questions : []),
    ...(Array.isArray(brief?.missing) ? brief.missing.filter((item) => (
      !briefTechnicalNotices(brief).includes(item)
      && !userDecisionMessages.has(String(item || "").trim())
    )) : [])
  ];
  const seen = new Set();
  const questions = [];
  candidates.forEach((item, index) => {
    const normalized = normalizeClarificationQuestion(item, index);
    if (!normalized) return;
    const marker = normalized.question.replace(/\s+/g, "");
    if (seen.has(marker)) return;
    seen.add(marker);
    questions.push(normalized);
  });
  return questions.slice(0, 12);
}

function clarificationGateState(brief = state.brief) {
  const questions = briefClarificationQuestions(brief);
  const technicalNotices = briefTechnicalNotices(brief);
  const messages = brief?.messages || [];
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const assistantState = messageMetadata(latestAssistant);
  const semanticReceipt = brief?.semantic_receipt || brief?.route_preview?.receipt?.semantics || {};
  const userMissing = (brief?.missing || []).filter((item) => !briefTechnicalNotices(brief).includes(item));
  const technicalOnly = technicalNotices.length > 0
    && !userMissing.length
    && !questions.length
    && !(Object.keys(semanticReceipt).length > 0 && semanticReceipt.ready === false);
  const latestRoundResolved = assistantState.ready === true && questions.length === 0 && !userMissing.length;
  const explicitlyPending = (brief?.status === "needs_clarification" && !latestRoundResolved && !technicalOnly)
    || Boolean(questions.length)
    || Boolean(userMissing.length)
    || (Object.keys(semanticReceipt).length > 0 && semanticReceipt.ready === false && !latestRoundResolved)
    || (brief?.status === "collecting" && Boolean(latestAssistant) && assistantState.ready !== true);
  return { pending: explicitlyPending, questions, technicalOnly };
}

function startWizardWait(label, projectId = null, requestId = "") {
  clearInterval(state.wizardWaitTimer);
  state.wizardWaitStartedAt = Date.now();
  state.wizardWaitGeneration = Number(state.wizardWaitGeneration || 0) + 1;
  const generation = state.wizardWaitGeneration;
  let polling = false;
  let lastPollAt = 0;
  const update = async () => {
    const seconds = Math.max(0, Math.floor((Date.now() - state.wizardWaitStartedAt) / 1000));
    if ($("#briefReadiness")) $("#briefReadiness").textContent = `${label} · 已等待 ${seconds} 秒`;
    if (!projectId || polling || Date.now() - lastPollAt < 1500) return;
    polling = true;
    lastPollAt = Date.now();
    try {
      const activity = (await projectApiActivity(projectId)).activity || {};
      if (generation !== state.wizardWaitGeneration) return;
      const sameRequest = (item) => !requestId || item?.request_id === requestId;
      const active = [...(activity.active || [])].reverse().find(sameRequest);
      const recent = (activity.recent || []).find(sameRequest);
      if (active && $("#briefReadiness")) {
        const limit = active.timeout_seconds ? ` / 上限 ${active.timeout_seconds} 秒` : "";
        const attempt = active.attempt > 1 ? ` · 第 ${active.attempt} 次调用` : "";
        $("#briefReadiness").textContent = `${active.phase_label}${attempt} · 已运行 ${active.elapsed_seconds} 秒${limit}`;
      } else if (recent && $("#briefReadiness")) {
        $("#briefReadiness").textContent = recent.status === "failed"
          ? `${recent.phase_label}失败（${recent.error_code || "provider_error"}），正在返回可恢复结果`
          : `${recent.phase_label}已返回，后端正在完成结构校验 · 已等待 ${seconds} 秒`;
      }
    } catch (_error) {
      // The main request remains authoritative. A failed read-only poll keeps
      // the elapsed-time label instead of masking or cancelling the operation.
    } finally {
      polling = false;
    }
  };
  update();
  state.wizardWaitTimer = setInterval(update, 1000);
}

function stopWizardWait() {
  clearInterval(state.wizardWaitTimer);
  state.wizardWaitTimer = null;
  state.wizardWaitStartedAt = 0;
  state.wizardWaitGeneration = Number(state.wizardWaitGeneration || 0) + 1;
}

function projectWords(project) { return Number(project.confirmed_chapters?.words || 0); }
function projectConfirmed(project) { return Number(project.confirmed_chapters?.count || 0); }
function formatLibraryDate(value) {
  if (!value) return "尚无记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}
function formatBookSize(value) {
  const count = Number(value || 0);
  if (count >= 10000) return `${Math.round(count / 10000)} 万字`;
  return `${formatNumber(count)} 字`;
}
function formatFileSize(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
function projectSourceState(project) {
  if (project.source_status === "analyzed") return "全书资料可用";
  if (project.source_status === "indexed") return "切割索引完成";
  if (project.source_id) return "原著正在准备";
  return "尚未选择原著";
}
function projectVersionLabel(project) {
  return project.parent_project_id ? "衍生版本" : "起始版本";
}
function projectTaskLabel(project) {
  const task = project.latest_task;
  if (!task) return "暂无后台任务";
  if (task.status === "running") return task.message || "后台处理中";
  if (task.status === "queued") return "任务等待开始";
  if (task.status === "failed") return "最近任务未完成";
  if (task.status === "cancelled") return "最近任务已停止";
  if (task.status === "needs_review") return task.message || "已暂停，等待你的决定";
  return "最近任务已完成";
}
function projectBookCompleted(project, run = null) {
  const task = project?.latest_task;
  return run?.status === "completed"
    || (task?.kind === "generate_book" && task.status === "completed" && Number(task.progress || 0) >= 1);
}
function projectStatusLabel(project) {
  return projectBookCompleted(project) ? "全书完成" : statusText[project.status] || project.status;
}
function taskDisplayProgress(task) {
  if (!task) return 0;
  if (task.status === "completed") return 1;
  if (task.kind !== "analyze_source") return Number(task.progress || 0);
  const current = Number(task.current_item || 0);
  const total = Number(task.total_items || 0);
  if ((task.message?.includes("合并剧情阶段") || Number(task.progress || 0) >= 0.83) && total) {
    return 0.82 + 0.13 * current / total;
  }
  if (total) return 0.82 * current / total;
  return 0;
}
function taskProgressDetail(task) {
  if (!task) return "等待任务";
  const current = Number(task.current_item || 0);
  const total = Number(task.total_items || 0);
  const units = total ? `${Math.min(current, total)} / ${total}` : "正在等待第一个检查点";
  const attempts = Number(task.attempts || 0) > 1 ? ` · 已恢复 ${Number(task.attempts) - 1} 次` : "";
  return `${units}${attempts}`;
}
function profileById(profileId) { return state.profiles.find((profile) => profile.id === profileId); }
function sourceById(sourceId) { return state.sources.find((source) => source.id === sourceId); }
function sourceReusable(source) {
  if (!source || !["indexed", "analyzed"].includes(source.status)) return false;
  return Boolean(source.scene_cut?.activated_at || (source.status === "analyzed" && source.analysis_id));
}
function profileReady(profile) { return Boolean(profile && profile.id !== "mock" && profile.has_key && profile.last_test_ok === 1); }
function analysisProfileReady(profile) { return Boolean(profile?.id === "mock" || profileReady(profile)); }
function profileStatus(profile) {
  if (!profile) return "配置不存在";
  if (profile.id === "mock") return "仅供流程演示";
  if (!profile.has_key) return "尚未保存密钥";
  if (profile.last_test_ok === 1) return "最近连接成功";
  if (profile.last_test_ok === 0) return "最近连接失败";
  return "已保存，尚未测试";
}

async function loadLibrary() {
  try {
    const [projectData, profileData, sourceData] = await Promise.all([api("/api/projects"), api("/api/profiles"), api("/api/sources")]);
    state.projects = projectData.projects;
    state.profiles = profileData.profiles;
    state.sources = sourceData.sources;
    state.libraryError = null;
    renderProjects();
    renderProfiles();
    renderSourceManager();
    renderLibraryStatusNotice();
  } catch (error) {
    state.libraryError = error.message || "本地服务暂时无法连接";
    showToast("本地服务暂时无法读取；页面已保留上一次状态");
    renderProjects(error.message);
    renderLibraryStatusNotice();
  }
}

function renderProjects(error = "") {
  const projects = state.projects;
  const archived = projects.filter((item) => item.archived_at);
  const available = projects.filter((item) => !item.archived_at);
  $("#projectCountLabel").textContent = `${projects.length} 个项目`;
  $("#projectCountFooter").textContent = `共 ${projects.length} 个项目`;
  const totalWords = available.reduce((sum, item) => sum + projectWords(item), 0);
  const readySources = new Set(available.filter((item) => item.source_status === "analyzed").map((item) => item.source_id)).size;
  $("#libraryOverview").innerHTML = [
    ["进行中的版本", `${available.length}`],
    ["已确认正文", `${formatNumber(totalWords)} 字`],
    ["可复用原著", `${readySources} 部`]
  ].map(([label, value]) => `<div class="overview-cell"><span>${label}</span><b>${value}</b></div>`).join("");
  const featured = available.find((item) => Number(item.is_active) === 1) || available[0];
  if (!featured) {
    $("#featuredProject").innerHTML = `<p class="current-project-label"><span>当前创作</span><em>empty folio</em></p><div class="current-file-title"><span>02</span><h2>${error ? "本地服务未连接" : "还没有故事卷宗"}</h2></div><div class="current-file-info"><p>${error ? escapeHtml(error) : "从左侧新建一个项目，导入 TXT 原著。"}</p></div>`;
  } else {
    const progress = featured.w_target ? Math.min(100, projectWords(featured) / featured.w_target * 100) : 0;
    $("#featuredProject").innerHTML = `<p class="current-project-label"><span>当前创作</span><em>Current folio</em></p><div class="current-file-title"><span>02</span><h2>${escapeHtml(featured.title)}</h2></div><div class="current-file-info"><p><b>${escapeHtml(featured.source_title || "尚未导入")}</b><span>${formatBookSize(featured.source_characters)} · ${projectSourceState(featured)}</span></p><p><b>L${featured.l_level} · D${featured.d_level} · F${featured.f_level}</b><span>${escapeHtml(projectStatusLabel(featured))}</span></p></div><div class="current-project-meta"><span>${formatNumber(projectWords(featured))} / ${formatNumber(featured.w_target)} 字</span><small>${projectConfirmed(featured)} 章已确认 · ${projectVersionLabel(featured)}</small></div><span class="current-progress"><i style="width:${progress}%"></i></span><div class="current-project-actions"><button class="version-action" data-restart-project="${featured.id}">重新开始</button><button class="version-action is-danger" data-archive-project="${featured.id}">废弃版本</button><button class="current-project-open" data-open-project="${featured.id}">继续阅读 <b>→</b></button></div>`;
  }
  const others = available.filter((item) => !featured || item.id !== featured.id);
  $("#otherProjectsCount").textContent = `${others.length} 个项目`;
  $("#projectGrid").innerHTML = others.map((project, index) => {
    const progress = project.w_target ? Math.min(100, projectWords(project) / project.w_target * 100) : 0;
    return `<article class="library-project-row ${projectConfirmed(project) ? "is-writing" : "is-preparing"}"><div class="library-project-top"><span class="library-project-number">${String(index + 3).padStart(2, "0")}</span><span class="library-project-state">${escapeHtml(projectStatusLabel(project))}</span></div><div class="library-project-title"><b>${escapeHtml(project.title)}</b><small>${projectVersionLabel(project)} · ${formatLibraryDate(project.updated_at)}</small></div><div class="library-file-info"><p><b>${escapeHtml(project.source_title || "尚未导入")}</b><span>${projectSourceState(project)}</span></p><p><b>L${project.l_level} · D${project.d_level} · F${project.f_level} · ${formatNumber(project.w_target)} 字</b><span class="${project.latest_task?.status === "failed" ? "is-error" : ""}">${project.latest_task?.status === "failed" ? projectTaskLabel(project) : `${projectConfirmed(project)} 章已确认`}</span></p></div><div class="library-project-progress"><span>${formatNumber(projectWords(project))} / ${formatNumber(project.w_target)} 字</span><i><b style="width:${progress}%"></b></i></div><div class="library-project-bottom"><span class="version-actions-inline"><button data-restart-project="${project.id}">重新开始</button><button data-archive-project="${project.id}">废弃版本</button></span><button class="library-project-open" data-open-project="${project.id}">打开 <b>→</b></button></div></article>`;
  }).join("");
  $("#archiveProjectCount").textContent = `${archived.length} 个版本`;
  const archivedRows = archived.map((project) => `<article class="archive-project-row"><div><span>${projectVersionLabel(project)} · ${formatLibraryDate(project.archived_at)}</span><b>${escapeHtml(project.title)}</b><small>${escapeHtml(project.source_title || "尚未导入原著")} · ${projectConfirmed(project)} 章 · ${formatNumber(projectWords(project))} 字</small></div><div class="archive-row-actions"><button data-restore-project="${project.id}">恢复为当前版本 <b>↗</b></button><button class="is-danger" data-delete-project="${project.id}">彻底删除</button></div></article>`).join("");
  $("#archiveProjectList").innerHTML = `${archivedRows || '<p class="archive-empty">完成、废弃或暂时收起的版本会保存在这里。</p>'}<p class="archive-signature" aria-hidden="true">Archive</p>`;
}

function sourceStatusLabel(source) {
  const cut = source.scene_cut;
  if (cut?.activated_at) return `场景精切已启用 · ${escapeHtml(cut.profile_model || cut.profile_name || "模型未记录")} · ${formatNumber(cut.scene_count)} 个场景`;
  if (cut?.status === "completed") return `场景精切已完成 · 等待启用`;
  if (cut?.status === "running") return `正在精切 ${formatNumber(cut.completed_chapters)} / ${formatNumber(cut.chapter_count)} 章`;
  if (cut?.status === "failed") return `场景精切暂停 · ${escapeHtml(cut.error || "可以重试")}`;
  if (source.status === "analyzed") return "全书认识已完成";
  if (source.status === "indexed") return "章节地图已完成，等待场景精切";
  if (source.status === "stored") return "TXT 已保存，等待切割";
  if (source.status === "failed") return "准备未完成";
  return source.status || "等待处理";
}

function renderSourceManager() {
  const sources = state.sources || [];
  const totalCharacters = sources.reduce((sum, source) => sum + Number(source.char_count || 0), 0);
  const totalDisk = sources.reduce((sum, source) => sum + Number(source.disk_bytes || source.byte_size || 0), 0);
  const reusable = sources.filter(sourceReusable).length;
  $("#sourceManagerSummary").innerHTML = [
    ["本机原著", `${sources.length} 部`],
    ["可直接复用", `${reusable} 部`],
    ["原文总量", formatBookSize(totalCharacters)],
    ["占用空间", formatFileSize(totalDisk)]
  ].map(([label, value], index) => `<div><span>0${index + 1}</span><small>${label}</small><b>${value}</b></div>`).join("");
  $("#sourceRegisterList").innerHTML = sources.length ? sources.map((source, index) => {
    const projects = source.projects || [];
    const references = projects.length
      ? projects.slice(0, 3).map((project) => escapeHtml(project.title)).join(" / ") + (projects.length > 3 ? ` / 另 ${projects.length - 3} 个` : "")
      : "没有故事版本引用，可以删除";
    const cut = source.scene_cut || {};
    const cutBusy = ["running"].includes(cut.status) || ["queued", "running"].includes(source.scene_task?.status);
    const cutReady = Boolean(cut.activated_at);
    const cutProgress = cut.chapter_count ? Math.round(Number(cut.completed_chapters || 0) / Number(cut.chapter_count) * 100) : 0;
    const cutAction = cutBusy
      ? `<button type="button" data-stop-source-task="${source.scene_task?.id || ""}" ${source.scene_task?.id ? "" : "disabled"}>安全停止精切 · ${cutProgress}%</button>`
      : cut.status === "completed" && !cutReady
        ? `<button type="button" data-activate-source-cut="${source.id}" data-cut-id="${cut.id}">启用新版并删除旧版 →</button>`
        : `<button type="button" data-refine-source="${source.id}">${cut.status === "failed" ? "从断点继续精切" : cutReady ? "重新精切全书" : "开始场景精切"} →</button>`;
    return `<article class="source-register-row"><span class="source-register-no">${String(index + 1).padStart(2, "0")}</span><div class="source-register-title"><small>${escapeHtml(source.filename || "TXT")}</small><b>${escapeHtml(source.title)}</b><em>${sourceStatusLabel(source)}</em></div><div class="source-register-metrics"><p><span>原文字数</span><b>${formatNumber(source.char_count)}</b></p><p><span>章节 / 场景</span><b>${formatNumber(source.chapter_count)} / ${formatNumber(cut.scene_count || 0)}</b></p><p><span>本机空间</span><b>${formatFileSize(source.disk_bytes || source.byte_size)}</b></p></div><div class="source-register-links"><span>${projects.length ? `${projects.length} 个版本正在使用` : "未被引用"}</span><p>${references}</p></div><div class="source-register-actions">${cutAction}<button type="button" class="source-delete-action" data-delete-source="${source.id}" ${source.deletable ? "" : "disabled"}>${source.deletable ? "彻底删除原著" : "使用中，不能删除"}</button></div></article>`;
  }).join("") : `<div class="source-register-empty"><span>EMPTY REGISTER</span><b>还没有导入原著</b><p>从这里或“新建项目”导入 TXT，完成后可以在多个故事版本之间复用。</p></div>`;
}

function openSourceManager() {
  clearTimeout(state.pollTimer);
  $("#libraryView").classList.add("is-hidden");
  $("#workbenchView").classList.add("is-hidden");
  $("#newProjectModal").classList.add("is-hidden");
  $("#sourceManagerView").classList.remove("is-hidden");
  $("#sourceManagerTitle").closest("header").querySelector(":scope > p").textContent = "这里只管理 TXT、章节地图、场景精切与切割版本；故事约定和写作模型在新建项目中设置。";
  renderSourceManager();
  scheduleSourceManagerPoll();
}

function flashProfile() {
  return state.profiles.find((profile) => profile.model === "deepseek-v4-flash" && profile.has_key);
}

function scheduleSourceManagerPoll() {
  clearTimeout(state.sourcePollTimer);
  const busy = state.sources.some((source) => ["queued", "running"].includes(source.scene_task?.status));
  if (!busy || $("#sourceManagerView").classList.contains("is-hidden")) return;
  state.sourcePollTimer = setTimeout(async () => {
    await loadLibrary();
    scheduleSourceManagerPoll();
  }, 1800);
}

async function importSourceFromManager(file) {
  if (!file || !file.name.toLowerCase().endsWith(".txt")) throw new Error("请使用 TXT 原著");
  const title = file.name.replace(/\.txt$/i, "") || "未命名原著";
  const result = await api("/api/sources", {
    method: "POST",
    headers: { "X-Filename": encodeURIComponent(file.name), "X-Source-Title": encodeURIComponent(title) },
    body: await file.arrayBuffer()
  });
  showToast("TXT 已保存，正在建立章节地图");
  await loadLibrary();
  scheduleSourceManagerPoll();
  return result;
}

function openDeletionDialog(type, item) {
  if (!item) return;
  const isProject = type === "project";
  state.pendingDeletion = { type, id: item.id, title: item.title };
  $("#deleteConfirmEyebrow").textContent = isProject ? "DELETE STORY VERSION" : "DELETE ORIGINAL SOURCE";
  $("#deleteConfirmTitle").textContent = isProject ? "彻底删除故事版本" : "彻底删除原著资料";
  $("#deleteConfirmDescription").textContent = isProject
    ? `“${item.title}”将从项目库永久移除。它使用的原著不会受到影响。`
    : `“${item.title}”的 TXT、切割索引和全书认识将从原著库移除。`;
  $("#deleteImpact").innerHTML = isProject
    ? `<span>VERSION</span><b>${projectConfirmed(item)} 章</b><b>${formatNumber(projectWords(item))} 字</b>`
    : `<span>ORIGINAL</span><b>${formatNumber(item.char_count)} 字</b><b>${formatNumber(item.unit_count)} 个单元</b>`;
  $("#deleteConfirmInput").value = "";
  $("#deleteConfirmInput").placeholder = item.title;
  $("#confirmPermanentDelete").disabled = true;
  openModal("deleteConfirmModal");
  setTimeout(() => $("#deleteConfirmInput").focus(), 0);
}

async function openProject(projectId) {
  clearTimeout(state.pollTimer);
  syncReaderThemeToApp();
  $("#libraryView").classList.add("is-hidden");
  $("#newProjectModal").classList.add("is-hidden");
  $("#sourceManagerView").classList.add("is-hidden");
  $("#workbenchView").classList.remove("is-hidden");
  await refreshProject(projectId);
}

function resolveReaderChapter(chapters, selectedChapter, pendingChapterSelection, projectChanged) {
  const firstChapter = chapters[0]?.number || null;
  if (projectChanged) return { selectedChapter: firstChapter, pendingChapterSelection: null };
  if (chapters.some((item) => item.number === pendingChapterSelection)) {
    return { selectedChapter: pendingChapterSelection, pendingChapterSelection: null };
  }
  if (chapters.some((item) => item.number === selectedChapter)) {
    return { selectedChapter, pendingChapterSelection };
  }
  return { selectedChapter: firstChapter, pendingChapterSelection };
}

async function refreshProject(projectId = state.activeProject?.id) {
  if (!projectId) return;
  try {
    const projectChanged = state.activeProject?.id !== projectId;
    const previousPreparation = state.preparation;
    const [projectData, chapterData, wishData, bookResult] = await Promise.all([
      api(`/api/projects/${projectId}`),
      api(`/api/projects/${projectId}/chapters`),
      api(`/api/projects/${projectId}/wishes`),
      api(`/api/projects/${projectId}/book-generation`)
        .then((data) => ({ data, error: null }))
        .catch((error) => ({ data: null, error }))
    ]);
    state.activeProject = projectData.project;
    state.chapters = chapterData.chapters;
    state.wishes = wishData.wishes || [];
    state.messages = wishData.messages || [];
    state.projectRefreshError = null;
    if (bookResult.error) {
      state.bookRunError = bookResult.error.message || "整书任务状态暂时无法读取";
      if (projectChanged) {
        state.bookRun = null;
        state.bookEstimate = null;
      }
    } else {
      state.bookRunError = null;
      state.bookRun = bookResult.data.run || null;
      state.bookEstimate = bookResult.data.estimate || buildLocalBookEstimate(state.activeProject, state.bookRun);
    }
    if (projectChanged) state.bookRunCompact = Boolean(state.bookRun);
    if (projectChanged) {
      state.relationshipMap = null;
      state.relationshipContinuity = null;
      state.relationshipContinuityError = null;
      state.relationshipViewChapter = null;
      state.relationshipExpanded = new Set();
      state.relationshipViewport = { x: 0, y: 0, scale: 1 };
      state.relationshipPanEnabled = false;
      state.selectedRelationshipNodeId = null;
      state.selectedRelationshipEdgeIndex = null;
      state.outlineUnsealed = false;
      state.spoilerGateStep = 0;
      state.spoilerChallenge = null;
      state.spoilerOutlineView = null;
    }
    if (projectChanged) state.preparation = null;
    if (state.activeProject.outline_id && ["writing", "draft"].includes(state.activeProject.status)) {
      try {
        state.preparation = (await api(`/api/projects/${projectId}/preparations/next`)).preparation;
        state.preparationError = null;
      } catch (error) {
        state.preparation = projectChanged ? null : previousPreparation;
        state.preparationError = error.message || "下一章准备状态暂时无法读取";
      }
    } else {
      state.preparation = null;
      state.preparationError = null;
    }
    const readerSelection = resolveReaderChapter(
      state.chapters,
      state.selectedChapter,
      state.pendingChapterSelection,
      projectChanged
    );
    state.selectedChapter = readerSelection.selectedChapter;
    state.pendingChapterSelection = readerSelection.pendingChapterSelection;
    renderWorkbench();
    const task = state.activeProject.latest_task;
    if (task && ["queued", "running"].includes(task.status)) scheduleProjectPoll(projectId);
  } catch (error) {
    state.projectRefreshError = error.message || "项目最新状态暂时无法读取";
    if (state.activeProject?.id === projectId) renderWorkbench();
    showToast(error.message);
    const task = state.activeProject?.latest_task;
    if (task && ["queued", "running"].includes(task.status) && !$("#workbenchView").classList.contains("is-hidden")) {
      clearTimeout(state.pollTimer);
      state.pollTimer = setTimeout(() => refreshProject(projectId), 2500);
    }
  }
}

function scheduleProjectPoll(projectId) {
  clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(() => refreshProject(projectId), 850);
}

function renderWorkbench() {
  const project = state.activeProject;
  if (!project) return;
  $("#workbenchView").classList.toggle("is-focus-reading", state.readingFocus);
  $("#focusReadingButton").textContent = state.readingFocus ? "退出沉浸阅读" : "沉浸阅读";
  $("#focusReadingButton").setAttribute("aria-pressed", String(state.readingFocus));
  $("#workbenchTitle").textContent = project.title;
  $("#workbenchSource").textContent = `原著 · ${project.source_title || "尚未导入"}`;
  $("#progressWords").textContent = formatNumber(projectWords(project));
  $("#targetWords").textContent = `${formatNumber(project.w_target)} 字`;
  $("#progressFill").style.width = `${Math.min(100, projectWords(project) / Math.max(1, project.w_target) * 100)}%`;
  $("#chapterCount").textContent = `已确认 ${projectConfirmed(project)} 章`;
  $("#bookRunPanel").classList.toggle("is-hidden", !project.outline_id);
  renderChapterRail();
  const chapter = state.chapters.find((item) => item.number === state.selectedChapter);
  if (chapter) {
    const renderKey = `${chapter.id}:${chapter.status}:${chapter.updated_at || ""}:${state.editing}`;
    if (renderKey !== state.renderedChapterKey) {
      renderChapter(chapter);
      state.renderedChapterKey = renderKey;
    }
  } else {
    state.renderedChapterKey = null;
    renderSetup();
  }
  renderDeck(chapter);
  renderDialogue();
  renderWriterQuickSelect();
  renderNextPreparation();
  renderBookRun();
  renderProjectStatusNotice();
}

function renderChapterRail() {
  const visible = state.chapters.filter((chapter) => state.chapterFilter === "all" || chapter.status === state.chapterFilter);
  $("#chapterList").innerHTML = visible.length ? visible.map((chapter) => `<li><button data-chapter="${chapter.number}" class="${chapter.number === state.selectedChapter ? "is-active" : ""}"><span class="chapter-no">${String(chapter.number).padStart(2, "0")}</span><span class="chapter-name">${escapeHtml(chapter.title)}</span><span class="chapter-state ${chapter.status}">${chapter.status === "confirmed" ? "已定" : "草稿"}</span></button></li>`).join("") : `<li class="chapter-filter-empty">这个分类里还没有章节。</li>`;
  $$('[data-chapter-filter]').forEach((button) => button.classList.toggle("is-active", button.dataset.chapterFilter === state.chapterFilter));
}

function renderChapter(chapter) {
  $("#manuscript").classList.remove("setup-dossier");
  $("#nextPrepStrip").classList.remove("is-hidden");
  $(".manuscript-meta").classList.remove("is-hidden");
  $(".chapter-title-row").classList.remove("is-hidden");
  $("#chapterTitle").classList.remove("is-hidden");
  $("#draftBadge").textContent = chapter.status === "draft" ? "草稿 · 尚未写入故事历史" : "已确认 · 正式历史";
  $("#chapterWordCount").textContent = `${formatNumber(chapter.word_count)} 字`;
  $("#chapterNumber").textContent = `第${chapter.number}章`;
  $("#chapterTitle").textContent = chapter.title;
  $("#chapterCopy").classList.remove("is-empty");
  $("#chapterCopy").innerHTML = String(chapter.body || "").split(/\n\s*\n/).filter(Boolean).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
  applyReaderPreferences();
  $("#chapterEditor").value = chapter.body || "";
  $("#chapterCopy").classList.toggle("is-hidden", state.editing);
  $("#chapterEditor").classList.toggle("is-hidden", !state.editing);
  $("#manuscriptFooter").classList.remove("is-hidden");
  $("#toggleEditorButton").textContent = state.editing ? "保存修改" : "手动修改";
}

function renderDialogue() {
  const chapterNumber = state.selectedChapter || state.activeProject?.current_chapter;
  const relevantMessages = state.messages.filter((message) => {
    const metadata = (() => { try { return JSON.parse(message.metadata_json || "{}"); } catch { return {}; } })();
    return !metadata.chapter_number || metadata.chapter_number === chapterNumber;
  }).slice(-8);
  $("#dialogueHistory").innerHTML = relevantMessages.length ? relevantMessages.map((message) => {
    let metadata = {};
    try { metadata = JSON.parse(message.metadata_json || "{}"); } catch {}
    const scope = { current: "当前章", future: "未来", replan: "重排" }[metadata.scope] || "Gugu";
    return `<article class="dialogue-message ${message.role}"><span>${escapeHtml(scope)}</span><p>${escapeHtml(message.content)}</p></article>`;
  }).join("") : `<p>这一章还没有对话记录。你可以直接提出修改，不必进入大纲。</p>`;
}

function renderWriterQuickSelect() {
  const project = state.activeProject;
  if (!project) return;
  const options = state.profiles.map((profile) => `<option value="${profile.id}">${escapeHtml(profile.name)} · ${escapeHtml(profile.model)}</option>`).join("");
  $("#writerQuickSelect").innerHTML = options;
  $("#writerQuickSelect").value = project.writer_profile_id;
  const writer = profileById(project.writer_profile_id);
  $("#writerQuickStatus").textContent = profileStatus(writer) + "；更换后从下一次生成生效。";
}

function setupContent() {
  const project = state.activeProject;
  const task = project.latest_task;
  if (task && ["queued", "running"].includes(task.status)) {
    const isIndexing = task.kind === "index_source";
    const isOutline = ["plan_outline", "replan_outline"].includes(task.kind);
    const stage = isOutline ? "隐藏大纲" : isIndexing ? "本地切割" : "全书阅读";
    const baseCopy = isIndexing
      ? "原文、章节边界和叙事单元正在本机落盘。关闭页面不会丢失任务。"
      : isOutline
        ? "未来内容保持封存。每个阶段通过后会写入检查点，结构校验完成才进入阅读。"
        : "故事总控正在分批阅读全部叙事单元，并把剧情结论连接回原文证据。";
    return {
      index: isIndexing ? "LOCAL INDEX / 01" : isOutline ? "SEALED ROUTE / 03" : "FULL READING / 02",
      title: task.message || (isIndexing ? "正在切割原著" : isOutline ? "正在生成隐藏大纲" : "正在通读全书"),
      copy: `${baseCopy} 当前 ${taskProgressDetail(task)}。`,
      progress: taskDisplayProgress(task),
      progressLabel: `${stage} · ${taskProgressDetail(task)}`,
      action: ""
    };
  }
  if (project.creative_brief_status && project.creative_brief_status !== "confirmed") {
    const recompile = Boolean(project.creative_brief_recompile_required);
    return {
      index: "DIRECTION CONTRACT / 02",
      title: recompile ? "方向合同需要升级" : "方向合同等待完成",
      copy: recompile
        ? "原始要求和旧方向结果都已保留。请用当前事件合同重新编译方向；完成确认前不会错误启动隐藏大纲。"
        : "方向仍需补全、重新生成或确认；完成后才会建立隐藏大纲。",
      progress: 1,
      action: `<button class="primary-action" data-setup-action="recompile-brief">${recompile ? "重新编译方向合同" : "继续完成方向"} →</button>`
    };
  }
  if (task?.status === "failed") {
    return { index: "PAUSED", title: "这一步没有完成", copy: `${task.error || "可以从已经保存的位置重新尝试。"} 已保留进度：${taskProgressDetail(task)}。`, progress: taskDisplayProgress(task), progressLabel: `失败位置 · ${taskProgressDetail(task)}`, action: `<button class="primary-action" data-setup-action="retry" data-task-id="${task.id}">从断点重试 →</button>` };
  }
  // A review state is not automatically resumable.  Deterministic route blocks
  // keep their real backend error and suppress the button: replaying the same
  // digest cannot repair a missing implementation or an unchanged contract.
  if (task?.status === "needs_review") {
    const review = task.result && typeof task.result === "object" ? task.result : {};
    const resumeAllowed = review.resume_allowed !== false;
    const blockedChapter = Number(review.chapter_number || project.current_chapter || 0);
    const rewriteAvailable = state.chapters.some((chapter) => chapter.number === blockedChapter && chapter.status === "draft");
    const reviewError = task.error || review.error || task.message || "这一章遇到需要处理的阻断。";
    const action = rewriteAvailable
      ? `<button class="primary-action" data-setup-action="rewrite-resume-book">重写草稿并继续 →</button>`
      : resumeAllowed ? `<button class="primary-action" data-setup-action="resume-book">查看并继续 →</button>` : "";
    return { index: "REVIEW / 02", title: rewriteAvailable ? "草稿需要重写后继续" : resumeAllowed ? "生成已暂停，等待你确认" : "生成已停止，重复继续不会改变结果", copy: `${reviewError} 已保留进度：${taskProgressDetail(task)}。`, progress: taskDisplayProgress(task), progressLabel: `暂停位置 · ${taskProgressDetail(task)}`, action };
  }
  if (project.status === "outline_review") {
    return { index: "SEALED OUTLINE / 03", title: "正在启用旧版故事路线", copy: "这是旧版本留下的待确认状态。系统会完成兼容启用，普通阅读模式不会展示未来走向。", progress: 1, action: `<button class="confirm-action" data-setup-action="confirm-outline">启用并开始阅读 →</button>` };
  }
  if (project.status === "writing" || project.status === "draft") {
    return { index: "NEXT CHAPTER / 04", title: "下一章等待落笔", copy: "总控会只取回这一章需要的原著证据，并把尚未到时点的未来留在封条后。", progress: 1, action: `<button class="primary-action" data-setup-action="generate">生成第 ${project.current_chapter} 章 →</button>` };
  }
  if (project.source_status === "indexed") {
    const director = profileById(project.director_profile_id);
    const ready = analysisProfileReady(director);
    const mockReading = director?.id === "mock";
    return {
      index: "LOCAL INDEX / 01",
      title: "原著切割与全文索引已经完成",
      copy: `${formatNumber(project.source_characters)} 字 · ${formatNumber(project.chapter_count)} 个章节范围 · ${formatNumber(project.unit_count)} 个叙事单元。${mockReading ? "当前使用本地模拟，只演练完整流程，不代表真实全书理解。" : ready ? "故事总控连接可用，可以继续全书阅读。" : "请先连接并测试故事总控 API；切割结果已经安全保存，不必重新上传。"}`,
      progress: 1,
      action: ready ? `<button class="primary-action" data-setup-action="analyze">${mockReading ? "模拟全书阅读 · 演练流程" : "开始全书阅读 →"}</button><button class="outline-button" data-setup-action="reindex">无损检查切割</button>` : `<button class="primary-action" data-setup-action="open-api">连接故事总控 API →</button><button class="outline-button" data-setup-action="reindex">无损检查切割</button>`
    };
  }
  if (project.premise_confirmed && project.source_status === "analyzed") {
    return { index: "STORY PLAN / 02", title: "原著资料已经准备好", copy: "下一步会根据正式前提、L / D / W / F 与全书核心剧情建立隐藏执行大纲。未来仍不会直接展示给读者。", progress: 1, action: `<button class="primary-action" data-setup-action="plan">建立隐藏大纲 →</button>` };
  }
  if (!project.premise_confirmed && project.source_status === "analyzed") {
    return { index: "CREATIVE BRIEF / 02", title: "原著资料已经准备好", copy: "现在可以确定故事坐标、成品气质和最想看到的改变。原著未来仍然保持封存。", progress: 1, action: `<button class="primary-action" data-setup-action="continue-brief">填写创作约定 →</button>` };
  }
  return { index: "WAITING", title: "卷宗还缺少一项材料", copy: "请回到项目库重新导入 TXT，或等待正在进行的原著准备任务。", progress: 0, action: "" };
}

function renderSetup() {
  const info = setupContent();
  const manuscript = $("#manuscript");
  manuscript.classList.add("setup-dossier");
  $("#nextPrepStrip").classList.add("is-hidden");
  $(".manuscript-meta").classList.add("is-hidden");
  $(".chapter-title-row").classList.add("is-hidden");
  $("#chapterTitle").classList.add("is-hidden");
  $("#chapterEditor").classList.add("is-hidden");
  $("#manuscriptFooter").classList.add("is-hidden");
  $("#chapterCopy").classList.remove("is-hidden");
  $("#chapterCopy").classList.add("is-empty");
  $("#chapterCopy").innerHTML = `<div><span class="setup-index">${info.index}</span><h2>${escapeHtml(info.title)}</h2><p>${escapeHtml(info.copy)}</p><div class="setup-progress ${info.progress < 1 ? "is-running" : ""}"><i><b style="width:${Math.round(info.progress * 100)}%"></b></i><span><em>${Math.round(info.progress * 100)}%</em><em>${escapeHtml(info.progressLabel || "本机卷宗")}</em></span></div><div class="setup-actions">${info.action}</div></div>`;
}

function renderDeck(chapter) {
  const task = state.activeProject.latest_task;
  const busy = task && ["queued", "running"].includes(task.status);
  const bookRunActive = state.bookRun && ["queued", "running", "pause_requested", "stop_requested"].includes(state.bookRun.status);
  $(".task-caption").textContent = busy ? (task.message || "正在处理") : chapter?.status === "draft" ? "草稿已自动保存。确认之前，后续时间线不会改变。" : "总控只会为下一章打开需要的原著材料。";
  const canWrite = ["writing", "draft"].includes(state.activeProject.status);
  const bookFinished = projectBookCompleted(state.activeProject, state.bookRun) || Number(state.bookEstimate?.remaining_chapters) === 0;
  $("#generateButton").disabled = busy || !canWrite || bookFinished;
  $("#generateButton").textContent = bookFinished ? "全书已完成" : chapter?.status === "draft" ? "重新生成本章 ↻" : `生成第 ${state.activeProject.current_chapter} 章 →`;
  $("#stopButton").disabled = !busy;
  $("#openCalibrationButton").disabled = !chapter || chapter.status !== "draft";
  $("#confirmButton").disabled = !chapter || chapter.status !== "draft";
  $("#confirmButton").classList.toggle("is-hidden", !chapter || chapter.status !== "draft");
  const previousChapter = chapter && [...state.chapters].reverse().find((item) => item.number < chapter.number);
  const nextChapter = chapter && state.chapters.find((item) => item.number > chapter.number);
  const previousButton = $("#previousChapterButton");
  previousButton.dataset.previousChapter = previousChapter?.number || "";
  previousButton.disabled = !previousChapter;
  previousButton.innerHTML = previousChapter
    ? `<span>←</span> 上一章 · 第 ${previousChapter.number} 章`
    : "已经是第一章";
  const nextButton = $("#nextChapterButton");
  nextButton.dataset.nextChapter = nextChapter?.number || "";
  nextButton.dataset.action = "";
  if (nextChapter) {
    nextButton.disabled = false;
    nextButton.innerHTML = `下一章 · 第 ${nextChapter.number} 章 <span>→</span>`;
    $("#manuscriptFooterHint").textContent = chapter.status === "draft" ? "这一章仍是草稿；也可以先查看已经准备好的下一章。" : "继续阅读不会影响后台生成进度。";
  } else if (chapter?.status === "draft") {
    nextButton.disabled = true;
    nextButton.innerHTML = "确认本章后继续";
    $("#manuscriptFooterHint").textContent = "确认之前，这一章不会进入正式历史。";
  } else if (bookRunActive || busy) {
    nextButton.disabled = true;
    nextButton.innerHTML = `正在生成第 ${Number(chapter?.number || 0) + 1} 章…`;
    $("#manuscriptFooterHint").textContent = "可以留在本章阅读；下一章完成后按钮会自动出现。";
  } else if (state.bookRun?.status === "completed" || Number(state.bookEstimate?.remaining_chapters) === 0) {
    nextButton.disabled = true;
    nextButton.innerHTML = "已读到最后一章";
    $("#manuscriptFooterHint").textContent = "当前故事线已经生成完成。";
  } else {
    nextButton.disabled = !canWrite;
    nextButton.dataset.action = "generate";
    nextButton.innerHTML = `生成第 ${state.activeProject.current_chapter} 章 <span>→</span>`;
    $("#manuscriptFooterHint").textContent = "下一章尚未生成，可以从这里直接继续。";
  }
  const sourceReady = state.activeProject.source_status === "analyzed";
  const sourceIndexed = ["indexed", "analyzed"].includes(state.activeProject.source_status);
  $(".source-note").classList.toggle("is-waiting", !sourceReady);
  $(".source-note").innerHTML = sourceReady ? "<span>◉</span> 原著资料已准备完成<br><small>全局锚定与局部材料均可用</small>" : sourceIndexed ? "<span>◐</span> 本地切割已经完成<br><small>等待故事总控完成全书阅读</small>" : "<span>○</span> 原著资料仍在切割<br><small>完成后再开始全书阅读</small>";
}

function renderBookRun() {
  const run = state.bookRun;
  const statusError = state.bookRunError;
  const estimate = state.bookEstimate || (statusError ? null : buildLocalBookEstimate(state.activeProject, run));
  const active = run && ["queued", "running", "pause_requested", "stop_requested"].includes(run.status);
  const resumable = run && ["paused", "needs_review", "failed"].includes(run.status);
  const finished = run?.status === "completed";
  const totalChapters = Number(run?.end_chapter || estimate?.total_chapters || 0);
  const confirmedChapters = Number(run?.book_confirmed_chapters ?? projectConfirmed(state.activeProject));
  const ratio = totalChapters ? Math.min(100, Math.round(confirmedChapters / totalChapters * 100)) : 0;
  $("#bookRunPanel").classList.toggle("is-compact", Boolean(state.bookRunCompact));
  $("#bookRunFill").style.width = `${ratio}%`;
  $("#bookRunMiniFill").style.width = `${ratio}%`;
  $("#bookRunRatio").textContent = totalChapters
    ? `${confirmedChapters} / ${totalChapters} 章 · ${ratio}%`
    : "等待大纲";
  const shortError = String(run?.last_error || "需要人工检查").replace(/\s+/g, " ").slice(0, 92);
  const nextBookChapter = Math.min(totalChapters || Infinity, Number(run?.last_completed_chapter || 0) + 1);
  const runningPosition = totalChapters && Number.isFinite(nextBookChapter)
    ? `正在处理第 ${nextBookChapter} / ${totalChapters} 章`
    : "正在等待下一章检查点";
  const labels = {
    queued: "整书任务正在等待开始。",
    running: `${runningPosition}；预计剩余 ${formatDurationRange(run?.eta_low_seconds, run?.eta_high_seconds)}。`,
    pause_requested: "正在完成当前安全保存点，然后暂停。",
    stop_requested: "正在完成当前安全保存点，然后停止。",
    paused: "任务已暂停，已完成章节不会重新生成。",
    needs_review: `停在第 ${(run?.last_completed_chapter || 0) + 1} 章：${shortError}${String(run?.last_error || "").length > 92 ? "……" : ""}`,
    failed: `任务未完成：${shortError || "可以从断点继续"}`,
    completed: "整本书已经逐章确认完成，可以执行完整导出。"
  };
  $("#bookRunStatus").textContent = statusError
    ? `暂时无法读取最新整书状态，保留上一次有效记录：${statusError}`
    : run
    ? labels[run.status] || "等待后端状态"
    : estimate?.available
      ? `将从第 ${estimate.next_chapter || 1} 章开始，逐章生成、校验并写入正式连续性。`
      : estimate?.reason || "按隐藏路线逐章生成、校验并保存；异常时会停在原地。";
  $("#bookRunEta").textContent = estimate?.available
    ? (Number(estimate.remaining_chapters || 0) ? formatDurationRange(estimate.estimated_duration_low_seconds, estimate.estimated_duration_high_seconds) : "已经完成")
    : "等待大纲";
  $("#bookRunCost").textContent = estimate?.available
    ? estimate.pricing_configured === false || estimate.estimated_total_cost_low_cny == null
      ? "未设置 API 单价"
      : `¥${Number(estimate.estimated_total_cost_low_cny || 0).toFixed(2)}～¥${Number(estimate.estimated_total_cost_high_cny || 0).toFixed(2)}`
    : "等待估算";
  $("#bookRunApi").textContent = estimate?.available
    ? `${formatNumber(estimate.estimated_api_calls_low)}～${formatNumber(estimate.estimated_api_calls_high)} 次`
    : "等待估算";
  const estimateBasis = estimate?.basis === "project_history"
    ? `依据本项目最近 ${estimate.sample_chapters || run?.completed_chapters || 0} 章实测动态推算`
    : "依据目标篇幅与章节数量作初步区间估算";
  $("#bookRunEstimateNote").textContent = statusError
    ? "状态恢复前不会清空旧进度，也不会允许重复启动整书任务。"
    : estimate?.available
    ? estimate.pricing_configured === false
      ? `${estimateBasis}；当前写作者 API 尚未填写计费单价，因此只显示 Token 与调用量。`
      : `${estimateBasis}${run ? `；目前已用约 ¥${Number(run.estimated_cost_cny || 0).toFixed(2)}` : ""}。实际账单以 API 服务商为准。`
    : "隐藏大纲确定章节数量后，会显示时间、费用和 API 调用区间。";
  $("#bookRunMiniStatus").textContent = statusError
    ? "状态读取暂时中断 · 保留旧进度"
    : run?.status === "needs_review"
    ? `停在第 ${(run.last_completed_chapter || 0) + 1} 章 · 点击处理`
    : totalChapters
      ? `${confirmedChapters}/${totalChapters} 章 · ${ratio}%${active && estimate?.available ? ` · 约余 ${formatDurationRange(estimate.estimated_duration_low_seconds, estimate.estimated_duration_high_seconds)}` : ""}`
      : "等待隐藏大纲";
  $("#startBookRunButton").textContent = `从第 ${estimate?.next_chapter || state.activeProject.current_chapter || 1} 章生成整本书 →`;
  $("#startBookRunButton").classList.toggle("is-hidden", Boolean(run));
  $("#startBookRunButton").disabled = Boolean(statusError) || active || !["writing", "draft"].includes(state.activeProject.status) || finished || !estimate?.available;
  $("#pauseBookRunButton").classList.toggle("is-hidden", !active);
  $("#resumeBookRunButton").classList.toggle("is-hidden", !resumable);
}

function renderNextPreparation() {
  const project = state.activeProject;
  if (!project) return;
  const enabled = Boolean(Number(project.next_prepare_enabled));
  const doubleEnabled = Boolean(Number(project.double_chapter_enabled));
  $("#nextPrepToggle").checked = enabled;
  $("#doubleChapterToggle").checked = doubleEnabled;
  const preparation = state.preparation;
  const labels = {
    collecting: "可以加入一条衔接当前章的补充要求",
    locked: "要求已锁定，等待开始",
    generating: "正在后台准备下一章",
    draft_ready: "下一章草稿已经准备好",
    failed: "准备没有完成，可以重试",
    stale: "当前章发生变化，需要重新准备"
  };
  $("#nextPrepStatus").textContent = state.preparationError
    ? "状态读取中断 · 保留上一次记录"
    : enabled
    ? (labels[preparation?.status] || (doubleEnabled ? "已开启；每次只提前一个双章批次" : "已开启"))
    : (doubleEnabled ? "双章连写已开启；不会额外预生成四章" : "按单章生成，不会提前调用");
  $("#doubleChapterStatus").textContent = doubleEnabled
    ? "已开启 · 合计不超过 8000 字时一次写完并拆成两章"
    : "一次写作调用，阅读与确认仍按单章";
  $("#openNextPrepPanel").disabled = !enabled || !preparation;
  $("#nextPrepHistory").innerHTML = preparation?.messages?.length
    ? preparation.messages.slice(-6).map((message) => `<p class="${message.role}">${escapeHtml(message.content)}</p>`).join("")
    : `<p>这里的补充要求只影响下一章；若与隐藏路线冲突，Gugu 会先询问，不会擅自重排。</p>`;
  $("#prepareNextButton").disabled = !enabled || ["generating", "draft_ready"].includes(preparation?.status);
  $("#sendNextPrepMessage").disabled = !enabled || ["locked", "generating", "draft_ready"].includes(preparation?.status);
}

async function performSetupAction(action, element) {
  const projectId = state.activeProject.id;
  try {
    if (action === "retry") {
      const result = await api(`/api/tasks/${element.dataset.taskId}/retry`, { method: "POST", body: {} });
      if (result.requires_direction) {
        showToast(result.reason || "请先重新编译并确认方向合同");
        await openWizard(projectId, 4);
        return;
      }
    }
    if (action === "analyze") await api(`/api/projects/${projectId}/source/analyze`, { method: "POST", body: { allow_mock: state.activeProject.director_profile_id === "mock" } });
    if (action === "reindex") await api(`/api/projects/${projectId}/source/reindex`, { method: "POST", body: {} });
    if (action === "open-api") { openApiLibrary(state.activeProject?.director_profile_id); return; }
    if (action === "plan") {
      const result = await api(`/api/projects/${projectId}/outline/plan`, { method: "POST", body: {} });
      if (result.requires_direction) {
        showToast(result.reason || "请先重新编译并确认方向合同");
        await openWizard(projectId, 4);
        return;
      }
    }
    if (action === "confirm-outline") await api(`/api/projects/${projectId}/outline/confirm`, { method: "POST", body: {} });
    if (action === "continue-brief") { await openWizard(projectId, 2); return; }
    if (action === "recompile-brief") { await openWizard(projectId, 4); return; }
    if (action === "generate") await generateChapter();
    // A run halted for review must continue as the whole-book run that owns the
    // remaining chapters. Calling generateChapter() here would start a competing
    // single-chapter task and leave the run stranded in needs_review.
    if (action === "resume-book" || action === "rewrite-resume-book") {
      const runId = state.bookRun?.id;
      if (!runId) {
        showToast("整书任务信息尚未载入，请稍后重试");
        return;
      }
      const rewriteDraft = action === "rewrite-resume-book";
      await api(`/api/projects/${projectId}/book-generation/${runId}/resume`, { method: "POST", body: { rewrite_draft: rewriteDraft } });
      showToast(rewriteDraft ? "正在重写当前草稿，完成后会继续整书生成" : "正在从最后一个已确认章节继续");
      scheduleProjectPoll(projectId);
      return;
    }
    await refreshProject(projectId);
  } catch (error) { showToast(error.message); }
}

async function generateChapter(request = $("#chapterRequest").value.trim()) {
  if (projectBookCompleted(state.activeProject, state.bookRun) || Number(state.bookEstimate?.remaining_chapters) === 0) {
    showToast("整本书已经生成完成");
    return;
  }
  const targetChapter = Number(state.activeProject.current_chapter || 1);
  const pendingGuidance = state.activeProject.aesthetic_guidance_pending || [];
  if (state.activeProject.aesthetic_feedback_mode === "ask" && pendingGuidance.length) {
    const noticeKey = `${state.activeProject.id}:${pendingGuidance.map((item) => item.code).join(",")}`;
    if (!state.aestheticGuidanceNotified.has(noticeKey)) {
      state.aestheticGuidanceNotified.add(noticeKey);
      showToast("最近章节出现了稳定的审美观察，可在项目设置中选择是否用于后续；本次生成不会被阻断");
    }
  }
  const result = await api(`/api/projects/${state.activeProject.id}/chapters/generate`, { method: "POST", body: { request } });
  state.pendingChapterSelection = targetChapter;
  state.activeTask = result.task;
  $("#chapterRequest").value = "";
  showToast("章节任务已经开始");
  scheduleProjectPoll(state.activeProject.id);
}

async function openWizard(projectId = null, startStep = 1) {
  stopWizardWait();
  state.wizardStep = startStep;
  state.sourceFile = null;
  state.draftProjectId = projectId;
  state.brief = null;
  state.clarificationDrafts.clear();
  state.rawRequirementsExpanded = false;
  state.receiptCastView = "primary";
  const reusable = state.sources.filter(sourceReusable);
  if (!projectId && !reusable.length) {
    openSourceManager();
    showToast("请先在原著管理中完成一部原著的场景精切");
    return;
  }
  state.sourceMode = "existing";
  state.selectedSourceId = reusable[0]?.id || null;
  state.ideas = [];
  $("#newProjectForm").reset();
  $("#wTarget").value = 108000;
  $("#premiseText").value = "";
  $("#productTypeInput").value = "";
  $("#styleTextInput").value = "";
  $("#viewpointInput").value = "";
  $("#endingTypeInput").value = "不预设";
  $("#uploadHint").textContent = "原著会完整保存在这台电脑，不会进入浏览器云端。";
  fillProfileSelects();
  if (projectId) {
    const project = state.projects.find((item) => item.id === projectId) || (await api(`/api/projects/${projectId}`)).project;
    state.selectedSourceId = project.source_id;
    state.sourceMode = "existing";
    $("#projectNameInput").value = project.title;
    $("#lLevel").value = project.l_level;
    $("#dLevel").value = project.d_level;
    $("#wTarget").value = project.w_target;
    $("#inferredAxis").value = project.inferred_axis;
    $("#chapterLength").value = project.chapter_word_target;
    const fidelity = $(`input[name='fidelity'][value='${project.f_level}']`);
    if (fidelity) fidelity.checked = true;
    $("#directorApi").value = project.director_profile_id;
    $("#writerApi").value = project.writer_profile_id;
    try {
      state.brief = (await api(`/api/projects/${projectId}/creative-brief`)).brief;
      $("#productTypeInput").value = state.brief.product_type || "";
      $("#styleTextInput").value = state.brief.style_text || "";
      $("#viewpointInput").value = state.brief.viewpoint_text || "";
      $("#endingTypeInput").value = state.brief.ending_type || "不预设";
      $("#premiseText").value = state.brief.wish_text || "";
    } catch (error) {
      showToast(`创作约定暂时无法读取：${error.message}`);
      throw error;
    }
  }
  renderIdeas();
  renderSourceLibrary();
  renderWizard();
  $("#libraryView").classList.add("is-hidden");
  $("#workbenchView").classList.add("is-hidden");
  $("#sourceManagerView").classList.add("is-hidden");
  $("#newProjectModal").classList.remove("is-hidden");
  clearTimeout(state.wizardIntroTimer);
  $("#newProjectModal").classList.toggle("is-condensed", startStep > 1);
  if (startStep === 1) {
    state.wizardIntroTimer = setTimeout(() => $("#newProjectModal").classList.add("is-condensed"), 1300);
  }
}

function selectedReusableSource() {
  return state.sourceMode === "existing" ? sourceById(state.selectedSourceId) : null;
}

function setSourceMode(mode) {
  const reusable = state.sources.filter(sourceReusable);
  state.sourceMode = "existing";
  if (state.sourceMode === "existing" && !sourceReusable(sourceById(state.selectedSourceId))) {
    state.selectedSourceId = reusable[0]?.id || null;
  }
  $("#existingSourcePanel").classList.toggle("is-hidden", state.sourceMode !== "existing");
  $("#uploadSourcePanel").classList.toggle("is-hidden", state.sourceMode !== "upload");
  $("#reuseSourceMode").classList.toggle("is-active", state.sourceMode === "existing");
  $("#uploadSourceMode").classList.remove("is-active");
  $("#reuseSourceMode").setAttribute("aria-selected", String(state.sourceMode === "existing"));
  $("#uploadSourceMode").setAttribute("aria-selected", "false");
  $("#reuseSourceMode").disabled = !reusable.length;
  $("#uploadSourceMode").classList.add("is-hidden");
  $("#reuseSourceMode").textContent = "选择已经切割完成的原著";
  applySelectedSourceModel();
}

function renderSourceLibrary() {
  const reusable = state.sources.filter(sourceReusable);
  $("#sourceLibraryList").innerHTML = reusable.length ? reusable.map((source) => {
    const ready = source.status === "analyzed" && source.analysis_id;
    const cutModel = source.scene_cut?.profile_model || source.scene_cut?.profile_name || "模型未记录";
    const analysisModel = source.analysis_model || source.analysis_profile_name || source.analysis_profile_id;
    const status = source.scene_cut?.activated_at ? "场景精切已完成" : ready ? "全书资料已完成" : "切割完成";
    const model = ready
      ? `精切：${cutModel} · 历史全书分析：${analysisModel}`
      : `精切：${cutModel} · 选择 A 端后继续`;
    return `<button type="button" class="source-library-card ${source.id === state.selectedSourceId ? "is-selected" : ""}" data-existing-source="${source.id}"><span class="source-card-mark" aria-hidden="true">${ready ? "◉" : "◐"}</span><span class="source-card-copy"><b>${escapeHtml(source.title)}</b><small>${formatNumber(source.char_count)} 字 · ${formatNumber(source.chapter_count)} 章 · ${formatNumber(source.unit_count)} 单元</small><em>${escapeHtml(status)} · ${escapeHtml(model)}</em></span><span class="source-card-use">${Number(source.project_count || 0)} 条故事线<br>选择 →</span></button>`;
  }).join("") : `<div class="source-library-empty"><b>还没有可复用的原著</b><span>请切换到“导入新的 TXT”。</span></div>`;
  setSourceMode(state.sourceMode);
}

function applySelectedSourceModel() {
  const source = selectedReusableSource();
  $("#directorApi").disabled = false;
  renderWizardRoleStatus();
}

function directionPreviewReady(brief = state.brief) {
  const preview = brief?.route_preview || {};
  return brief?.status === "preview_ready"
    && !preview.status?.stale
    && !preview.status?.blocked
    && Array.isArray(preview.phases)
    && preview.phases.length === 3
    && !clarificationGateState(brief).pending;
}

function renderWizard() {
  $$(".wizard-panel").forEach((panel) => panel.classList.toggle("is-hidden", Number(panel.dataset.step) !== state.wizardStep));
  $$(".wizard-steps > span").forEach((step, index) => step.classList.toggle("is-current", index + 1 === state.wizardStep));
  $("#wizardPrevious").disabled = state.wizardStep === 1;
  const nextButton = $("#wizardNext");
  const clarification = clarificationGateState();
  const waitingForAnswers = state.wizardStep === 4 && !directionPreviewReady() && clarification.pending;
  nextButton.textContent = state.wizardStep === 4
    ? directionPreviewReady()
      ? "确认方向，建立隐藏大纲 →"
      : clarification.technicalOnly
        ? "安全重试方向样本 →"
      : waitingForAnswers
        ? `先回答本轮 ${Math.max(1, clarification.questions.length)} 个问题`
        : "生成无剧透方向样本 →"
    : "下一步 →";
  if (nextButton.getAttribute("aria-busy") !== "true") nextButton.disabled = waitingForAnswers;
  $("#wizardStepText").textContent = `第 ${state.wizardStep} 步，共 4 步`;
  if (state.wizardStep > 1) $("#newProjectModal").classList.add("is-condensed");
  if (state.wizardStep === 2) updateConstraintModel();
}

function validateWizardStep() {
  if (state.wizardStep === 1) {
    if (!$("#projectNameInput").value.trim()) throw new Error("请填写项目名称");
    if (state.sourceMode === "existing") {
      if (!sourceReusable(selectedReusableSource())) throw new Error("请选择一份已经准备好的原著");
    } else throw new Error("请先在原著管理中完成原著切割");
  }
  if (state.wizardStep === 4 && !$("#premiseText").value.trim()) throw new Error("请填写这条故事线的核心要求");
}

async function finishWizard() {
  validateWizardStep();
  const clarification = clarificationGateState();
  if (!directionPreviewReady() && clarification.pending) {
    $("#wizardChatHistory")?.scrollIntoView({ behavior: "smooth", block: "center" });
    throw new Error("请先回答 AI 窗口本轮提出的问题；未完成澄清不会进入大纲页面");
  }
  const fidelity = Number($("input[name='fidelity']:checked").value);
  const payload = {
    title: $("#projectNameInput").value.trim(),
    l_level: Number($("#lLevel").value),
    d_level: Number($("#dLevel").value),
    w_target: Number($("#wTarget").value),
    inferred_axis: $("#inferredAxis").value,
    f_level: fidelity,
    chapter_word_target: Number($("#chapterLength").value),
    director_profile_id: $("#directorApi").value,
    writer_profile_id: $("#writerApi").value,
    source_id: selectedReusableSource()?.id || null
  };
  const nextButton = $("#wizardNext");
  beginButtonFeedback(nextButton, directionPreviewReady() ? "正在确认并提交大纲…" : "正在整理方向样本…");
  startWizardWait(directionPreviewReady() ? "正在确认设定" : "正在编译方向合同");
  try {
    const project = await ensureWizardProject(payload);
    await api(`/api/projects/${project.id}`, { method: "PATCH", body: payload });
    const briefFields = {
      product_type: $("#productTypeInput").value.trim(),
      style_text: $("#styleTextInput").value.trim(),
      viewpoint_text: $("#viewpointInput").value.trim(),
      ending_type: $("#endingTypeInput").value,
      wish_text: $("#premiseText").value.trim()
    };
    if (!directionPreviewReady()) {
      const previewRequestId = createApiRequestId();
      startWizardWait("正在编译方向合同", project.id, previewRequestId);
      state.brief = (await api(`/api/projects/${project.id}/creative-brief/preview`, {
        method: "POST",
        body: briefFields,
        requestId: previewRequestId,
        timeoutMs: 15 * 60 * 1000
      })).brief;
      stopWizardWait();
      renderIdeas();
      renderWizard();
      $("#routePreview").scrollIntoView({ behavior: "smooth", block: "center" });
      const accepted = directionPreviewReady(state.brief);
      showToast(accepted
        ? "方向样本已生成；确认详略分配后再建立隐藏大纲"
        : "方向合同尚未通过校验，请查看标出的缺项后重新生成");
      const waitingForAnswer = clarificationGateState().pending;
      nextButton.dataset.idleLabel = accepted
        ? "确认方向，建立隐藏大纲 →"
        : waitingForAnswer
          ? "请先回答 AI 窗口问题"
          : "重新生成方向样本 →";
      finishButtonFeedback(nextButton, accepted ? "方向样本已就绪 ✓" : "仍有结构缺项", 600, !waitingForAnswer);
      return;
    }
    await api(`/api/projects/${project.id}/creative-brief/confirm`, { method: "POST", body: {
      ...briefFields
    } });
    startWizardWait("设定已确认，正在创建大纲任务");
    const feedback = $("#outlineSubmitFeedback");
    feedback.classList.remove("is-hidden");
    feedback.classList.add("is-indeterminate");
    $("#outlineSubmitText").textContent = "创作约定已确认，正在创建大纲任务";
    $("#outlineSubmitFill").style.width = "8%";
    const outlineResult = await api(`/api/projects/${project.id}/outline/plan`, { method: "POST", body: {} });
    state.activeTask = outlineResult.task || null;
    $("#outlineSubmitText").textContent = "任务已经进入后台，正在转入进度页面";
    feedback.classList.remove("is-indeterminate");
    $("#outlineSubmitFill").style.width = `${Math.round(taskDisplayProgress(state.activeTask) * 100)}%`;
    stopWizardWait();
    finishButtonFeedback(nextButton, "大纲任务已提交 ✓", 500);
    $("#newProjectModal").classList.add("is-hidden");
    showToast("创作约定已封存，正在后台整理故事路线");
    await loadLibrary();
    await openProject(project.id);
  } catch (error) {
    stopWizardWait();
    failButtonFeedback(nextButton);
    showToast(error.message);
  }
}

async function ensureWizardProject(settings = null) {
  if (state.draftProjectId) return (await api(`/api/projects/${state.draftProjectId}`)).project;
  validateWizardStep();
  const fidelity = Number($("input[name='fidelity']:checked")?.value || 2);
  const payload = settings || {
    title: $("#projectNameInput").value.trim(),
    l_level: Number($("#lLevel").value), d_level: Number($("#dLevel").value),
    w_target: Number($("#wTarget").value), inferred_axis: $("#inferredAxis").value,
    f_level: fidelity, chapter_word_target: Number($("#chapterLength").value),
    director_profile_id: $("#directorApi").value, writer_profile_id: $("#writerApi").value,
    source_id: selectedReusableSource()?.id || null
  };
  const project = (await api("/api/projects", { method: "POST", body: payload })).project;
  state.draftProjectId = project.id;
  return project;
}

function acceptFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".txt")) return showToast("请使用 TXT 原著");
  state.sourceFile = file;
  $("#uploadHint").textContent = `${file.name} · ${formatNumber(file.size)} 字节 · 将完整保存在本机`;
}

function receiptCharacterGroups(receipt = {}, brief = state.brief) {
  const explicit = Array.isArray(receipt.core_characters) ? receipt.core_characters : [];
  const focalizers = [receipt.primary_focalizer, ...(receipt.secondary_focalizers || [])].filter(Boolean);
  const characters = new Map();
  const add = (raw, fallbackRole = "") => {
    if (!raw) return;
    const name = String(typeof raw === "string" ? raw : raw.name || "").trim();
    if (!name) return;
    const current = characters.get(name) || { name, role: fallbackRole, importance: "supporting", fixed_facts: [], user_fixed_facts: [], user_overrides: [], relationship_states: [], uncertain_points: [] };
    const fixedFacts = Array.isArray(raw.fixed_facts) ? raw.fixed_facts : [];
    const readerChanges = Array.isArray(raw.reader_changes) ? raw.reader_changes : [];
    const uncertain = Array.isArray(raw.uncertain_points) ? raw.uncertain_points : [];
    characters.set(name, {
      ...current,
      role: String(raw.role || current.role || fallbackRole || "配合故事阶段推进"),
      importance: raw.importance === "core" ? "core" : "supporting",
      original_behavior_status: "complete",
      fixed_facts: [...new Set([...current.fixed_facts, ...fixedFacts].filter(Boolean))],
      user_fixed_facts: [...new Set([...(current.user_fixed_facts || []), ...readerChanges].filter(Boolean))],
      uncertain_points: [...new Set([...current.uncertain_points, ...uncertain].filter(Boolean))]
    });
  };
  explicit.forEach((character) => add(character, "承担已确认的故事作用"));
  focalizers.forEach((name, index) => add(name, index ? "辅助承载部分阶段" : "主要承载故事过程"));
  const ordered = [...characters.values()];
  const primaryNames = new Set(ordered.filter((item) => item.importance === "core").map((item) => item.name));
  if (!primaryNames.size) focalizers.slice(0, 2).forEach((name) => primaryNames.add(String(name).trim()));
  if (!primaryNames.size && ordered.length) primaryNames.add(ordered[0].name);
  return {
    primary: ordered.filter((character) => primaryNames.has(character.name)).slice(0, 12),
    support: ordered.filter((character) => !primaryNames.has(character.name)).slice(0, 24)
  };
}

function receiptCharacterMarkup(character, index, kind, lockedRules = []) {
  const relatedLocks = lockedRules.filter((item) => String(item).includes(character.name));
  const fixed = [...new Set([...(character.fixed_facts || []), ...relatedLocks])].slice(0, 5);
  const userFixed = [...new Set(character.user_fixed_facts || [])].slice(0, 5);
  const overrides = [...new Set(character.user_overrides || [])].slice(0, 4);
  const uncertain = (character.uncertain_points || []).slice(0, 4);
  const behaviorGap = character.original_behavior_status !== "complete"
    ? `<li class="is-unspecified">原著人格证据状态：${escapeHtml(character.original_behavior_status || "unknown")}${(character.original_behavior_missing_fields || []).length ? `；待补 ${escapeHtml(character.original_behavior_missing_fields.join("、"))}` : ""}</li>`
    : "";
  const facts = fixed.length || userFixed.length || overrides.length
    ? fixed.map((item) => `<li class="is-fixed">${escapeHtml(item)}</li>`).join("")
    : `<li class="is-unspecified">尚未单独追加人物铁律；性格以原著行为基线和用户覆盖共同确定</li>`;
  const userFixedMarkup = userFixed.map((item) => `<li class="is-fixed">用户固定事实：${escapeHtml(item)}</li>`).join("");
  const overrideMarkup = overrides.map((item) => `<li class="is-override">用户明确修改：${escapeHtml(item)}</li>`).join("");
  const relationshipMarkup = relationshipStateRows(character.relationship_states, character.name)
    .map((item) => `<li class="is-relationship">分阶段关系 · ${escapeHtml(item.label)}：${escapeHtml(item.text)}</li>`).join("");
  return `<article class="receipt-character"><span>${String(index + 1).padStart(2, "0")}</span><div><small>${kind === "support" ? "SUPPORTING CAST" : "CORE CAST"}</small><b>${escapeHtml(character.name)}</b><p>${escapeHtml(character.role || "承担相关故事阶段")}</p></div><ul>${facts}${userFixedMarkup}${overrideMarkup}${behaviorGap}${relationshipMarkup}${uncertain.map((item) => `<li class="is-uncertain">待确认：${escapeHtml(item)}</li>`).join("")}</ul></article>`;
}

function renderIdeas() {
  const messages = state.brief?.messages || [];
  const clarification = clarificationGateState();
  const technicalNotices = briefTechnicalNotices();
  const questionMarkup = clarification.questions.length
    ? `<section class="clarification-round"><header><span>本轮需要确认</span><b>本轮 ${clarification.questions.length} 项</b></header><p class="clarification-round-note">这些就是当前轮的全部问题。提交后系统会重新校验；如果仍有高影响歧义，下一轮会直接显示在这里。</p><div>${clarification.questions.map((item, index) => `<article data-clarification-key="${escapeHtml(item.key)}"><p><i>${String(index + 1).padStart(2, "0")}</i>${escapeHtml(item.question)}</p>${item.options.length ? `<div class="clarification-options">${item.options.map((option) => `<button type="button" data-clarification-option="${escapeHtml(index)}" data-option-value="${escapeHtml(option)}">${escapeHtml(option)}</button>`).join("")}</div>` : ""}<textarea rows="3" data-clarification-response="${index}" data-clarification-key="${escapeHtml(item.key)}" placeholder="回答这一项；也可以写“交给系统按原著决定”"></textarea></article>`).join("")}</div><footer><small>请回答本轮全部项目；系统不会因为提交一次就跳过后续校验。</small><button type="button" data-submit-clarifications>提交并重新校验</button></footer></section>`
    : clarification.pending
      ? `<section class="clarification-round is-compose-only"><header><span>仍需澄清</span><b>01</b></header><p>请在下方输入框回答 Gugu 上一条问题。信息未完整前，不会进入隐藏大纲。</p></section>`
      : "";
  const technicalMarkup = technicalNotices.length
    ? `<section class="brief-technical-notice"><span>DELIVERY NOTICE</span><div><b>这不是剧情问题，不需要你补充设定</b><p>${escapeHtml(technicalNotices.slice(0, 2).join("；"))}</p><small>可以安全重试；系统会保留已经确认的要求与方向结果。</small></div></section>`
    : "";
  $("#wizardChatHistory").innerHTML = `${messages.length
    ? messages.map((message) => `<div class="chat-bubble ${message.role}">${escapeHtml(message.content)}</div>`).join("")
    : `<div class="chat-bubble assistant">写好核心要求后，可以让我检查是否还缺少会影响大纲的关键信息。</div>`}${technicalMarkup}${questionMarkup}`;
  clarification.questions.forEach((item, index) => {
    const input = $(`[data-clarification-response="${index}"]`);
    if (input) input.value = state.clarificationDrafts.get(item.key) || "";
  });
  const preview = state.brief?.route_preview || {};
  const hasPreview = Boolean(preview.interpretation);
  const previewStale = Boolean(preview.status?.stale || state.brief?.status === "preview_stale");
  const previewLegacy = hasPreview && (!Array.isArray(preview.phases) || preview.phases.length !== 3);
  const previewBlocked = Boolean(preview.status?.blocked || previewLegacy || state.brief?.status === "needs_clarification");
  const collapseRawRequirements = hasPreview && !state.rawRequirementsExpanded;
  $("#premiseCard")?.classList.toggle("is-compiled", hasPreview);
  $("#rawRequirementEditor")?.classList.toggle("is-collapsed", collapseRawRequirements);
  $("#toggleRawRequirements")?.classList.toggle("is-hidden", !hasPreview);
  $("#toggleRawRequirements")?.setAttribute("aria-expanded", String(!collapseRawRequirements));
  if ($("#toggleRawRequirements")) $("#toggleRawRequirements").textContent = collapseRawRequirements ? "查看或修改原始要求" : "收起原始要求";
  $("#clearWizardChat").disabled = clarification.pending;
  $("#clearWizardChat").textContent = clarification.pending ? "正在等待本轮回答" : (messages.length ? "重新检查是否有遗漏" : "检查是否还有关键缺项");
  $("#briefReadiness").textContent = clarification.pending
    ? (clarification.questions.length ? `等待回答 ${clarification.questions.length} 个问题` : "还需要一项补充")
    : clarification.technicalOnly
      ? "技术中断，内容已保留，可以安全重试"
    : hasPreview && previewBlocked
    ? "方向合同仍有结构缺项"
    : hasPreview && previewStale
    ? "修改已保存，方向样本待合并"
    : hasPreview
      ? "方向样本等待确认"
    : ["ready", "contract_ready"].includes(state.brief?.status)
      ? "信息已经足够"
      : state.brief?.status === "compiling"
        ? "正在编译方向合同"
      : state.brief?.status === "collecting"
        ? "还有信息需要澄清"
        : "还没有开始询问";
  $("#routePreview").classList.toggle("is-hidden", !hasPreview);
  $("#routePreview").classList.toggle("is-stale", hasPreview && (previewStale || previewBlocked));
  $("#routePreviewStatus").classList.toggle("is-hidden", !hasPreview || (!previewStale && !previewBlocked));
  if (hasPreview && (previewStale || previewBlocked)) {
    const validationText = (preview.status?.notices || []).map((item) => item.message).filter(Boolean).slice(0, 4).join("；");
    $("#routePreviewStatusText").textContent = previewBlocked
      ? (validationText || (previewLegacy
        ? "这份旧方向样本把章节或视角当成了时间阶段，需要按新的前段—中段—后段合同重新生成。"
        : "方向合同缺少必要的时间、身份或人物边界信息，请重新生成。"))
      : (preview.status?.message || "新的修改已经保存，但尚未合并到下方样本；重新生成失败也不会丢失这份旧样本。");
  }
  let receiptPanel = $("#intentReceipt");
  if (!receiptPanel) {
    receiptPanel = document.createElement("section");
    receiptPanel.id = "intentReceipt";
    receiptPanel.className = "intent-receipt";
    $("#routeSample").insertAdjacentElement("beforebegin", receiptPanel);
  }
  receiptPanel.classList.toggle("is-hidden", !hasPreview || !preview.receipt);
  if (hasPreview) {
    $("#routeInterpretation").textContent = preview.interpretation || "";
    $("#routeForeground").textContent = preview.foreground || "按核心要求展开";
    $("#routeBackground").textContent = preview.background || "原著主线只在必要时进入";
    $("#routeCarrier").textContent = preview.carrier || "由最适合当前过程的人物承载";
    const phases = preview.phases || preview.sample || [];
    const phaseNames = { front: "前段", middle: "中段", end: "后段" };
    $("#routeSample").innerHTML = phases.map((item, index) => {
      const label = item.name || phaseNames[item.phase_id] || String(index + 1).padStart(2, "0");
      const details = item.details || {};
      const detailRows = [
        details.characters?.length ? `主要人物：${details.characters.join("、")}` : "",
        details.original_position ? `原著位置：${details.original_position}` : "",
        details.later_impact ? `后续影响：${details.later_impact}` : "",
        details.uncertainties?.length ? `未确定：${details.uncertainties.join("；")}` : ""
      ].filter(Boolean);
      const expandable = detailRows.length
        ? `<details><summary>展开阶段细节</summary><p>${escapeHtml(detailRows.join("\n")).replaceAll("\n", "<br>")}</p></details>`
        : "";
      return `<li><span>${escapeHtml(label)}</span><i aria-hidden="true"></i><p><b>${escapeHtml(item.main_event || "该节点正在整理")}</b><em>${escapeHtml(item.response || "继续回应已经确认的核心要求")}</em>${expandable}</p></li>`;
    }).join("");
    const receipt = preview.receipt || {};
    const semantics = receipt.semantics || {};
    const semanticQuestions = clarification.questions;
    const compact = (items, fallback, limit = 2) => {
      if (!Array.isArray(items) || !items.length) return fallback;
      const shown = items.slice(0, limit).join("；");
      return items.length > limit ? `${shown}；另 ${items.length - limit} 项已收起` : shown;
    };
    const characterGroups = receiptCharacterGroups(receipt);
    if (state.receiptCastView === "support" && !characterGroups.support.length) state.receiptCastView = "primary";
    const visibleCharacterGroup = characterGroups[state.receiptCastView] || characterGroups.primary;
    const characterMarkup = visibleCharacterGroup.length
      ? visibleCharacterGroup.map((character, index) => receiptCharacterMarkup(character, index, state.receiptCastView, semantics.locked_rules || [])).join("")
      : `<article class="receipt-character is-empty"><span>--</span><div><small>CAST</small><b>尚未指定核心人物</b><p>系统会按故事重心选择最合适的承载者；这不是错误。</p></div></article>`;
    const characterSwitch = `<div class="receipt-character-switch" role="tablist" aria-label="人物卡类型"><button type="button" role="tab" data-receipt-cast="primary" class="${state.receiptCastView === "primary" ? "is-active" : ""}" aria-selected="${state.receiptCastView === "primary"}">核心人物 <b>${characterGroups.primary.length}</b></button><button type="button" role="tab" data-receipt-cast="support" class="${state.receiptCastView === "support" ? "is-active" : ""}" aria-selected="${state.receiptCastView === "support"}" ${characterGroups.support.length ? "" : "disabled"}>相关配角 <b>${characterGroups.support.length}</b></button><span>红色为待确认，灰色为尚未单独指定</span></div>`;
    const termMeanings = semantics.term_meanings || [];
    const semanticMarkup = semantics.change_route?.length || semantics.locked_rules?.length || termMeanings.length || semanticQuestions.length
      ? `<section class="semantic-receipt"><header><span>CHANGE CHECK</span><b>${semantics.ready && !semanticQuestions.length ? "人物变化规则已经清楚" : "红色项目需要你确认"}</b></header>${semantics.change_route?.length ? `<div class="semantic-route">${semantics.change_route.map((item, index) => `<span><i>${String(index + 1).padStart(2, "0")}</i>${escapeHtml(item)}</span>`).join("")}</div>` : ""}${termMeanings.length ? `<details class="term-meaning-index"><summary>查看本次使用的 ${termMeanings.length} 个特殊词义</summary>${termMeanings.map((item) => `<p><b>${escapeHtml(item.term)}</b><span>${escapeHtml(item.meaning)}</span></p>`).join("")}</details>` : ""}${semanticQuestions.length ? `<p class="semantic-question-forward">上方 AI 窗口有 ${semanticQuestions.length} 项待确认；全部回答后才会开放大纲。</p>` : ""}</section>`
      : "";
    const guardText = [
      compact(receipt.preserve_rules, "按 F 等级保持原著核心逻辑"),
      receipt.avoid_rules?.length ? `避免：${compact(receipt.avoid_rules, "", 2)}` : ""
    ].filter(Boolean).join("；");
    receiptPanel.innerHTML = `<header><div><span>INTENT RECEIPT</span><b>确认系统将怎样理解这次改写</b></div><em class="${semanticQuestions.length ? "needs-check" : "is-ready"}">${semanticQuestions.length ? `${semanticQuestions.length} 项待确认` : "可以建立大纲"}</em></header><section class="receipt-thesis"><article><small>核心变化</small><p>${escapeHtml(receipt.core_change || preview.interpretation || "按核心要求展开")}</p></article><article><small>这次主要阅读什么</small><p>${escapeHtml(receipt.story_focus || preview.foreground || "变化怎样发生")}</p></article></section>${characterSwitch}<section class="receipt-character-grid">${characterMarkup}</section><section class="receipt-boundaries"><article><small>必须抵达</small><p>${escapeHtml(compact(receipt.hard_outcomes, "没有额外锁死结局细节"))}</p></article><article><small>不可偏离</small><p>${escapeHtml(guardText)}</p></article><article><small>观看位置</small><p>${escapeHtml(`${receipt.primary_focalizer || "由最合适的人物承载"}${receipt.secondary_focalizers?.length ? `；辅助：${receipt.secondary_focalizers.join("、")}` : ""}`)}</p></article></section>${semanticMarkup}`;
  }
}

async function sendWizardMessage(text, button = $("#wizardChatSend"), pendingLabel = "正在核对补充", metadata = {}) {
  const value = String(text || "").trim();
  if (!value) throw new Error("请先写下想补充或回答的内容");
  beginButtonFeedback(button, "正在传达…");
  startWizardWait(pendingLabel);
  try {
    const project = await ensureWizardProject();
    const messageRequestId = createApiRequestId();
    startWizardWait(pendingLabel, project.id, messageRequestId);
    state.brief = (await api(`/api/projects/${project.id}/creative-brief/messages`, { method: "POST", body: {
      text: value,
      product_type: $("#productTypeInput").value.trim(),
      style_text: $("#styleTextInput").value.trim(),
      viewpoint_text: $("#viewpointInput").value.trim(),
      ending_type: $("#endingTypeInput").value,
      wish_text: $("#premiseText").value.trim(),
      ...metadata
    }, requestId: messageRequestId, timeoutMs: 10 * 60 * 1000 })).brief;
    stopWizardWait();
    renderIdeas();
    renderWizard();
    const reenable = button?.id !== "clearWizardChat" || !clarificationGateState().pending;
    finishButtonFeedback(button, "已传达 ✓", 850, reenable);
    return true;
  } catch (error) {
    stopWizardWait();
    failButtonFeedback(button);
    $("#briefReadiness").textContent = "没有送达，可以重试";
    throw error;
  }
}

function invalidateRoutePreview() {
  if (!state.brief?.route_preview || !Object.keys(state.brief.route_preview).length) return;
  state.brief = {
    ...state.brief,
    status: "preview_stale",
    route_preview: {
      ...state.brief.route_preview,
      status: {
        ...(state.brief.route_preview.status || {}),
        stale: true,
        message: "页面中的创作规格或核心要求已经修改，尚未合并到这份方向样本"
      }
    }
  };
  renderIdeas();
  renderWizard();
}

function renderWireModel(activeL, activeD, activeF) {
  const svg = $("#cubeScene");
  if (!svg) return;
  const ax = state.modelRotation.x;
  const ay = state.modelRotation.y;
  const points = [];
  for (let l = 0; l < 4; l++) for (let d = 0; d < 4; d++) for (let f = 0; f < 4; f++) {
    const x = (d - 1.5) * 70;
    const y = (1.5 - l) * 70;
    const z = (f - 1.5) * 70;
    const x1 = x * Math.cos(ay) + z * Math.sin(ay);
    const z1 = -x * Math.sin(ay) + z * Math.cos(ay);
    const y1 = y * Math.cos(ax) - z1 * Math.sin(ax);
    const z2 = y * Math.sin(ax) + z1 * Math.cos(ax);
    const perspective = 520 / (520 + z2);
    points.push({ l, d, f, x: 280 + x1 * perspective, y: 192 - y1 * perspective, z: z2, active: l === activeL && d === activeD && f === activeF });
  }
  const byKey = new Map(points.map((point) => [`${point.l}-${point.d}-${point.f}`, point]));
  const lines = [];
  points.forEach((point) => [[1,0,0],[0,1,0],[0,0,1]].forEach(([dl, dd, df]) => {
    const next = byKey.get(`${point.l + dl}-${point.d + dd}-${point.f + df}`);
    if (!next) return;
    const onRoute = (point.l === activeL && next.l === activeL) || (point.d === activeD && next.d === activeD) || (point.f === activeF && next.f === activeF);
    lines.push({ a: point, b: next, z: (point.z + next.z) / 2, onRoute });
  }));
  lines.sort((a, b) => b.z - a.z);
  const lineMarkup = lines.map(({ a, b, onRoute }) => `<line class="wire-edge ${onRoute ? "is-route" : ""}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`).join("");
  points.sort((a, b) => b.z - a.z);
  const nodeMarkup = points.map((point) => `<circle class="wire-node ${point.active ? "is-active" : ""}" data-cube-node="${point.l}-${point.d}-${point.f}" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${point.active ? 6 : 2.6}"><title>L${point.l} D${point.d} F${point.f}</title></circle>`).join("");
  svg.innerHTML = `<g class="wire-edges">${lineMarkup}</g><g class="wire-nodes">${nodeMarkup}</g><text x="28" y="32">DRAG TO ORBIT</text><text x="470" y="365">64 / GATE</text>`;
}

function updateConstraintModel() {
  const l = Number($("#lLevel").value);
  const d = Number($("#dLevel").value);
  const f = Number($("input[name='fidelity']:checked")?.value || 2);
  const inferred = $("#inferredAxis").value;
  const base = [2500, 15000, 60000, 150000];
  const factors = [0.12, 0.32, 0.72, 1.2];
  if (inferred === "w") $("#wTarget").value = Math.max(300, Math.round(base[l] * factors[d] / 500) * 500);
  if (inferred === "d") {
    const ratio = Number($("#wTarget").value) / base[l];
    $("#dLevel").value = factors.map((value) => Math.abs(value - ratio)).indexOf(Math.min(...factors.map((value) => Math.abs(value - ratio))));
  }
  if (inferred === "l") {
    const expected = Number($("#wTarget").value) / factors[d];
    $("#lLevel").value = base.map((value) => Math.abs(value - expected)).indexOf(Math.min(...base.map((value) => Math.abs(value - expected))));
  }
  const resolvedL = Number($("#lLevel").value);
  const resolvedD = Number($("#dLevel").value);
  $("#lLevel").disabled = inferred === "l";
  $("#dLevel").disabled = inferred === "d";
  $("#wTarget").readOnly = inferred === "w";
  [["#lLevel", "l"], ["#dLevel", "d"], ["#wTarget", "w"]].forEach(([selector, axis]) => $(selector).dataset.inferred = String(inferred === axis));
  const grid = $("#cubeGrid");
  if (!grid.children.length) grid.innerHTML = Array.from({ length: 16 }, (_, index) => {
    const row = Math.floor(index / 4);
    const column = index % 4;
    return `<button type="button" data-coordinate-cell="${row}-${column}" aria-label="L${row} D${column}"></button>`;
  }).join("");
  [...grid.children].forEach((cell, index) => {
    const row = Math.floor(index / 4);
    const column = index % 4;
    cell.classList.toggle("is-axis", row === resolvedL || column === resolvedD);
    cell.classList.toggle("is-active", row === resolvedL && column === resolvedD);
  });
  renderWireModel(resolvedL, resolvedD, f);
  $$("#fidelityRulers button").forEach((line, index) => line.classList.toggle("is-active", index === f));
  $("#cubeCoordinate").textContent = `L${resolvedL} · D${resolvedD} · F${f}`;
  $("#cubeMeaning").textContent = `${levelNames.l[resolvedL]} / ${levelNames.d[resolvedD]} / ${levelNames.f[f]}`;
  $("#combinationIndex").textContent = `组合 ${f * 16 + resolvedL * 4 + resolvedD + 1} / 64`;
  const notices = [];
  if (f === 3 && resolvedD <= 1) notices.push("高忠实度会优先守住事实与因果，但简略描写无法复现大量原文细节。");
  if (resolvedL === 3 && resolvedD === 3) notices.push("整书剧场化篇幅很大，当前字数只作为估算，允许约 20% 浮动。");
  if (f === 0 && resolvedD === 3) notices.push("细写会增加新内容；F0 下这些细节不保证沿用原著事件。");
  $("#constraintNotice").textContent = notices[0] || "系统根据覆盖范围与描写密度估算总字数；允许约 20% 浮动。";
  $("#constraintNotice").classList.toggle("is-warning", Boolean(notices.length));
}

function fillProfileSelects() {
  const options = state.profiles.map((profile) => `<option value="${profile.id}">${escapeHtml(profile.name)} · ${escapeHtml(profile.model)}${profile.has_key ? "" : "（未配置密钥）"}${profile.last_test_ok === 0 ? "（测试失败）" : ""}</option>`).join("");
  const preferred = state.profiles.find(profileReady) || state.profiles.find((profile) => profile.id !== "mock" && profile.has_key) || state.profiles.find((profile) => profile.id === "mock");
  $("#directorApi").innerHTML = options;
  $("#writerApi").innerHTML = options;
  $("#directorApi").value = preferred?.id || "mock";
  $("#writerApi").value = preferred?.id || "mock";
  applySelectedSourceModel();
}

function renderWizardRoleStatus() {
  const director = profileById($("#directorApi").value);
  const writer = profileById($("#writerApi").value);
  $("#directorStatus").textContent = profileStatus(director);
  $("#writerStatus").textContent = profileStatus(writer);
  const source = selectedReusableSource();
  const localOnly = director?.id === "mock" || !director?.has_key;
  $("#modelRoleNote").textContent = source?.analysis_id ? `场景精切：${source.scene_cut?.profile_model || "模型未记录"}；历史静态分析：${source.analysis_model || source.analysis_profile_name || "模型未记录"}。当前故事线 A 使用 ${director?.name || "所选模型"}，提交后固定；三者互不强制绑定。` : localOnly ? "当前可先完成本地切割；真实全书阅读会等 A 端连接可用后再开始。" : "A 在开始全书阅读后固定；B 可以在章节之间更换。";
  $("#modelRoleNote").classList.toggle("is-warning", localOnly || director?.last_test_ok === 0);
}

function renderProfiles() {
  $("#apiList").innerHTML = state.profiles.map((profile) => `<article class="api-profile ${profile.id === state.selectedProfileId ? "is-active" : ""} ${profile.last_test_ok === 1 ? "is-connected" : profile.last_test_ok === 0 ? "is-failed" : ""}" data-profile="${profile.id}"><i aria-hidden="true"></i><span><b>${escapeHtml(profile.name)}</b><small>${escapeHtml(profile.model)} · ${escapeHtml(profileStatus(profile))} · ${profile.pricing_configured ? "计费已设置" : "未设置单价"}</small></span>${profile.preset || profile.id === "mock" ? "" : `<button class="profile-delete" type="button" data-delete-profile="${escapeHtml(profile.id)}" title="删除此 API 配置" aria-label="删除 ${escapeHtml(profile.name)}">×</button>`}<button type="button">编辑</button></article>`).join("");
  fillApiProfileForm(profileById(state.selectedProfileId));
}

function openApiLibrary(preferredId = "") {
  const preferred = profileById(preferredId);
  if (preferred && preferred.id !== "mock") state.selectedProfileId = preferred.id;
  else if (!profileById(state.selectedProfileId) || state.selectedProfileId === "mock") {
    state.selectedProfileId = state.profiles.find(profileReady)?.id || "mock";
  }
  renderProfiles();
  openModal("apiModal");
}

function fillApiProfileForm(profile = null) {
  $("#apiIdInput").value = profile?.id === "mock" ? "" : profile?.id || "";
  $("#apiNameInput").value = profile?.id === "mock" ? "" : profile?.name || "";
  $("#apiUrlInput").value = profile?.id === "mock" ? "" : profile?.base_url || "";
  $("#apiModelInput").value = profile?.id === "mock" ? "" : profile?.model || "";
  $("#apiTimeoutInput").value = profile?.id === "mock" ? 120 : profile?.timeout || 120;
  $("#apiInputRate").value = profile?.id === "mock" ? "" : profile?.pricing?.input ?? "";
  $("#apiCachedInputRate").value = profile?.id === "mock" ? "" : profile?.pricing?.cached_input ?? "";
  $("#apiOutputRate").value = profile?.id === "mock" ? "" : profile?.pricing?.output ?? "";
  $("#apiKeyInput").value = "";
  $("#apiFormTitle").textContent = profile && profile.id !== "mock" ? `编辑 ${profile.name}` : "新建配置";
  $("#apiTestState").textContent = profile ? profileStatus(profile) : "尚未测试";
  $("#apiTestState").className = profile?.last_test_ok === 1 ? "is-ok" : profile?.last_test_ok === 0 ? "is-error" : "";
}

function openProjectSettings() {
  const project = state.activeProject;
  if (!project) return;
  const busy = Boolean(project.latest_task && ["queued", "running"].includes(project.latest_task.status));
  const options = state.profiles.map((profile) => `<option value="${profile.id}">${escapeHtml(profile.name)} · ${escapeHtml(profile.model)} · ${escapeHtml(profileStatus(profile))}</option>`).join("");
  $("#directorSettingsSelect").innerHTML = options;
  $("#writerSettingsSelect").innerHTML = options;
  $("#directorSettingsSelect").value = project.director_profile_id;
  $("#writerSettingsSelect").value = project.writer_profile_id;
  $("#directorSettingsSelect").disabled = Boolean(project.director_locked);
  $("#directorLockNote").textContent = project.director_locked ? "全书阅读已经开始，A 端已随本故事线锁定。" : "开始全书阅读前可以更换。";
  $("#aestheticObservationEnabled").checked = Boolean(Number(project.aesthetic_observation_enabled));
  $("#aestheticFeedbackMode").value = project.aesthetic_feedback_mode || "record";
  $("#writingStyleSkillInput").value = project.writing_style_skill || "";
  $("#aestheticFeedbackMode").disabled = !$("#aestheticObservationEnabled").checked;
  const pendingGuidance = project.aesthetic_guidance_pending || [];
  $("#aestheticGuidancePanel").classList.toggle("is-hidden", !pendingGuidance.length);
  $("#aestheticGuidanceList").innerHTML = pendingGuidance.map((item) => `
    <article class="aesthetic-guidance-item">
      <div><p>${escapeHtml(item.instruction || "已形成一条稳定审美观察")}</p><small>${escapeHtml(item.code)} · 证据章节 ${escapeHtml((item.evidence_chapters || []).join(" / "))} · 从第 ${Number(item.effective_from_chapter || project.current_chapter || 1)} 章起</small></div>
      <div class="aesthetic-guidance-actions"><button type="button" data-aesthetic-action="dismiss" data-aesthetic-code="${escapeHtml(item.code)}">不采用</button><button type="button" data-aesthetic-action="apply" data-aesthetic-code="${escapeHtml(item.code)}">用于后续</button></div>
    </article>`).join("");
  $("#projectSourceCard").innerHTML = project.source_id ? `<b>${escapeHtml(project.source_title || "原著")}</b><span>${formatNumber(project.source_characters)} 字 · ${formatNumber(project.chapter_count)} 章 · ${formatNumber(project.unit_count)} 单元</span><small>${project.source_status === "analyzed" ? "全书阅读已完成" : project.source_status === "indexed" ? "本地切割已完成" : "正在准备"}</small>` : `<b>尚未上传原著</b>`;
  $("#reindexSourceButton").disabled = !project.source_id || busy;
  const analysisProfile = profileById(project.director_profile_id);
  $("#startSourceAnalysisButton").disabled = busy || project.source_status !== "indexed" || !analysisProfileReady(analysisProfile);
  $("#startSourceAnalysisButton").textContent = analysisProfile?.id === "mock" ? "模拟全书阅读 · 仅演练流程" : "开始全书阅读";
  openModal("projectSettingsModal");
}

function futureEventDetails(event = {}) {
  return [
    event.characters?.length ? `主要人物：${event.characters.join("、")}` : "",
    event.original_position ? `原著位置：${event.original_position}` : "",
    event.later_impact ? `后续影响：${event.later_impact}` : "",
    event.uncertainties?.length ? `未确定：${event.uncertainties.join("；")}` : ""
  ].filter(Boolean);
}

function outlineChangeConsoleMarkup() {
  return `<section class="outline-change-console"><header><span>ADJUST ROUTE</span><b id="outlineChangeScope">讨论全部未发生路线</b></header><div><textarea id="outlineChangeInput" rows="3" placeholder="例如：让这一阶段更重视人物关系，或改为主要跟随另一位人物。"></textarea><button type="button" id="previewOutlineChange">先看影响范围</button></div><div class="outline-change-preview is-hidden" id="outlineChangePreview"></div></section>`;
}

function requirementTrackMarkup(outline = {}) {
  const tracks = outline.requirement_tracks || {};
  const stages = tracks.stages || [];
  const requirements = tracks.requirements || [];
  const width = Math.max(760, stages.length * 178);
  const stageMarkup = stages.map((stage, index) => `<article class="requirement-track-stage"><span>${String(index + 1).padStart(2, "0")}</span><i aria-hidden="true"></i><b>${escapeHtml(stage.name || `第 ${index + 1} 阶段`)}</b><p>${escapeHtml(stage.summary || "该阶段正在整理")}</p></article>`).join("");
  const rowMarkup = requirements.map((requirement) => `<div class="requirement-track-row"><b title="${escapeHtml(requirement.text)}">${escapeHtml(requirement.text)}</b><span class="requirement-track-points">${stages.map((stage, index) => {
    const point = requirement.points?.[index];
    const explanation = point
      ? `${stage.name} · ${point.meaning}`
      : `${stage.name} · 暂无直接作用`;
    return `<i class="${point ? "is-linked" : ""}" title="${escapeHtml(explanation)}" aria-label="${escapeHtml(explanation)}"></i>`;
  }).join("")}</span></div>`).join("");
  return `<section class="requirement-track-map"><header><div><span>REQUIREMENT TRACKS</span><h3>要求兑现轨</h3></div><p>每一行是一项已经确认的创作要求；金色节点表示它在对应阶段开始生效、继续发展、改变走向或得到兑现。</p></header><div class="requirement-track-legend"><span><i></i>阶段位置</span><span><i class="is-linked"></i>要求产生作用</span><small>将鼠标停在金色节点上可查看作用类型。</small></div><div class="requirement-track-scroll"><div class="requirement-track-table" style="--requirement-track-width:${width}px;--requirement-track-columns:${stages.length}"><div class="requirement-track-heading"><b>已确认的创作要求</b><div class="requirement-track-stages">${stageMarkup}</div></div><div class="requirement-track-rows">${rowMarkup}</div></div></div></section>`;
}

function renderSpoilerOutline() {
  $("#spoilerModal .spoiler-modal").classList.remove("is-sealed-route");
  $("#storyMapEyebrow").textContent = "ADVANCED ROUTE · 已解除剧透封条";
  $("#spoilerTitle").textContent = "未来航线";
  $("#relationshipMapTab").classList.remove("is-active");
  $("#outlineMapTab").classList.add("is-active");
  $("#outlineLayoutSwitch").classList.remove("is-hidden");
  const outline = state.spoilerOutlineView || {};
  const phases = outline.phases || [];
  const hasRequirementTracks = Boolean(
    outline.requirement_tracks?.stages?.length
    && outline.requirement_tracks?.requirements?.length
  );
  if (state.outlineLayout === "requirements" && !hasRequirementTracks) state.outlineLayout = "parallel";
  $("#outlineLayoutSwitch").innerHTML = `<button type="button" data-outline-layout="parallel">横向时间图</button><button type="button" data-outline-layout="vertical">纵向列表</button>${hasRequirementTracks ? `<button type="button" data-outline-layout="requirements">要求兑现轨</button>` : ""}`;
  $$('[data-outline-layout]').forEach((button) => button.classList.toggle("is-active", button.dataset.outlineLayout === state.outlineLayout));
  if (state.outlineLayout === "requirements") {
    $("#spoilerContent").innerHTML = `${requirementTrackMarkup(outline)}${outlineChangeConsoleMarkup()}`;
    return;
  }
  if (state.outlineLayout === "vertical") {
    const phaseMarkup = phases.map((phase, phaseIndex) => {
      const events = (phase.storylines || []).flatMap((storyline) =>
        (storyline.events || []).map((event) => ({ ...event, storyline: storyline.name || "主线" }))
      );
      return `<section class="outline-lane"><header><span>${String(phaseIndex + 1).padStart(2, "0")}</span><div><b>${escapeHtml(phase.name || `第 ${phaseIndex + 1} 阶段`)}</b><p>${escapeHtml(phase.main_event || "该节点正在整理")}</p><small>${escapeHtml(phase.response || "继续回应已经确认的核心要求")}</small></div></header><div class="outline-lane-track">${events.map((event) => {
        const details = [event.summary, ...futureEventDetails(event)].filter(Boolean);
        return `<article class="spoiler-node is-future"><span>${escapeHtml(event.storyline)}</span><div><b>${escapeHtml(event.title || "该节点正在整理")}</b><p>${escapeHtml(details.join("\n")).replaceAll("\n", "<br>")}</p></div></article>`;
      }).join("") || `<p>该阶段的细节正在整理。</p>`}</div></section>`;
    }).join("");
    $("#spoilerContent").innerHTML = `<div class="outline-destination"><span>DESTINATION</span><b>${escapeHtml(outline.title || "故事终点")}</b><p>${escapeHtml(outline.summary || "未来故事已经解锁")}</p></div><div class="outline-routes is-vertical">${phaseMarkup || `<p>未来阶段正在整理。</p>`}</div>${outlineChangeConsoleMarkup()}`;
    return;
  }

  const lanes = new Map();
  const phasePositions = [];
  let nextColumn = 1;
  phases.forEach((phase, phaseIndex) => {
    const storylines = phase.storylines || [];
    const span = Math.max(1, ...storylines.map((storyline) => (storyline.events || []).length));
    phasePositions.push({ phase, start: nextColumn, span });
    storylines.forEach((storyline) => {
      const name = storyline.name || "主线";
      if (!lanes.has(name)) lanes.set(name, []);
      (storyline.events || []).forEach((event, eventIndex) => {
        lanes.get(name).push({ event, column: nextColumn + eventIndex, phaseIndex });
      });
    });
    nextColumn += span;
  });
  if (!lanes.size) lanes.set("主线", []);
  const timelineColumns = Math.max(1, nextColumn - 1);
  const timelineWidth = Math.max(760, timelineColumns * 168);
  const phaseMarkup = phasePositions.map(({ phase, start, span }, index) => `<span class="timeline-phase" style="grid-column:${start} / span ${span}" title="${escapeHtml(phase.main_event || "")}"><b>${String(index + 1).padStart(2, "0")}</b>${escapeHtml(phase.name || `第 ${index + 1} 阶段`)}</span>`).join("");
  const laneMarkup = [...lanes.entries()].map(([name, events], laneIndex) => `<section class="timeline-lane"><header><span>${String(laneIndex + 1).padStart(2, "0")}</span><b>${escapeHtml(name)}</b></header><div class="timeline-track">${events.map(({ event, column }) => {
    const details = [event.summary, ...futureEventDetails(event)].filter(Boolean);
    return `<article class="timeline-event" style="grid-column:${column}"><i aria-hidden="true"></i><details><summary>${escapeHtml(event.title || "该节点正在整理")}</summary><p>${escapeHtml(details.join("\n") || "该节点正在整理").replaceAll("\n", "<br>")}</p></details></article>`;
  }).join("")}</div></section>`).join("");
  $("#spoilerContent").innerHTML = `<div class="timeline-scroll"><div class="timeline-map" style="--timeline-width:${timelineWidth}px;--timeline-columns:${timelineColumns}"><aside class="timeline-origin"><span>ORIGIN</span><i aria-hidden="true"></i><b>已确认内容之后</b><p>从当前正文和已经发生的人物关系继续。</p></aside><div class="timeline-field"><div class="timeline-phases">${phaseMarkup}</div><div class="timeline-lanes">${laneMarkup}</div></div><aside class="timeline-end"><span>DESTINATION</span><i aria-hidden="true"></i><b>${escapeHtml(outline.title || "故事终点")}</b><p>${escapeHtml(outline.summary || "未来故事已经解锁")}</p></aside></div></div>${outlineChangeConsoleMarkup()}`;
}

function relationshipKind(text = "") {
  return relationshipKindData(text);
}

function relationshipEdgesThroughChapter(rawEdges, throughChapter) {
  return relationshipEdgesThroughChapterData(rawEdges, throughChapter);
}

function consolidateRelationshipEdges(rawEdges, status = "confirmed", throughChapter = 0) {
  return consolidateRelationshipEdgesData(rawEdges, status, throughChapter);
}

function plannedRelationshipEdges(confirmedEdges = [], throughChapter = 0) {
  return plannedRelationshipEdgesData(confirmedEdges, throughChapter);
}

function readerSafeCharacterCard(name, edges, supplied = {}, throughChapter = 0, mapEffectiveChapter = 0) {
  return readerSafeCharacterCardData(
    name,
    edges,
    supplied,
    throughChapter,
    mapEffectiveChapter
  );
}

function characterKnowledgeRows(card = {}) {
  const raw = card.current_knowledge || card.knowledge_states || card.knowledge || [];
  if (Array.isArray(raw)) return raw.flatMap((item) => {
    if (typeof item === "string") return [{ fact: item, state: "known", time: "当前" }];
    if (!item || typeof item !== "object") return [];
    return [{
      fact: String(item.fact_label || item.fact || item.label || item.knowledge || "").trim(),
      state: String(item.state || item.status || "known").trim(),
      time: String(item.effective_time || item.time || item.since || "当前").trim()
    }];
  }).filter((item) => item.fact).slice(0, 12);
  if (raw && typeof raw === "object") return Object.entries(raw).slice(0, 12).map(([fact, value]) => ({
    fact,
    state: typeof value === "string" ? value : value?.state || value?.status || "known",
    time: typeof value === "object" ? value?.effective_time || value?.time || "当前" : "当前"
  }));
  return [];
}

function readableCharacterCardValues(value, limit = 6) {
  return readableCharacterCardValuesData(value, limit);
}

function originalBehaviorRows(profile = {}) {
  const labels = {
    goals: "长期目标",
    priority_order: "判断优先级",
    decision_under_pressure: "压力下的选择",
    speech_patterns: "说话方式",
    emotion_expression: "情绪表达",
    power_usage: "力量使用",
    moral_boundaries: "行为底线",
    inner_conflicts: "内在矛盾"
  };
  return Object.entries(labels).flatMap(([key, label]) => {
    const values = readableCharacterCardValues(profile?.[key]);
    return values.length ? [{ label, text: values.join("；") }] : [];
  });
}

function hardLockRows(locks = []) {
  const dimensions = {
    pairing_role: "长期关系位置",
    intimate_position: "亲密行为位置",
    gender_identity: "性别认同",
    gender_expression: "性别表达",
    body_form: "身体形态",
    personality: "性格",
    power: "能力与战力",
    relationship_power: "关系主导权"
  };
  return (Array.isArray(locks) ? locks : []).flatMap((lock) => {
    if (!lock || typeof lock !== "object") return [];
    const value = readableCharacterCardValues(lock.value, 3).join("、");
    if (!value) return [];
    const label = dimensions[lock.dimension] || String(lock.dimension || "固定约定");
    return [{ label, text: `${value}${lock.mutable === false ? "（不可改写）" : ""}` }];
  }).slice(0, 10);
}

function bodyStageRows(stages = []) {
  const fields = [
    ["body_form", "身体"],
    ["reproductive_capacity", "生殖能力"],
    ["gender_identity", "性别认同"],
    ["gender_expression", "性别表达"],
    ["public_identity", "公开身份"],
    ["memory_state", "记忆"],
    ["narrative_pronoun", "叙述代称"],
    ["effective_at", "生效时点"]
  ];
  return (Array.isArray(stages) ? stages : []).flatMap((stage, index) => {
    if (!stage || typeof stage !== "object") return [];
    const details = fields.flatMap(([key, label]) => {
      const value = readableCharacterCardValues(stage[key], 2).join("、");
      return value ? [`${label}：${value}`] : [];
    });
    if (!details.length) return [];
    return [{ label: String(stage.label || `阶段 ${index + 1}`), text: details.join("；") }];
  }).slice(0, 8);
}

function relationshipStateRows(states = [], characterName = "") {
  return (Array.isArray(states) ? states : []).flatMap((stateItem) => {
    if (!stateItem || typeof stateItem !== "object") return [];
    const parties = readableCharacterCardValues(stateItem.parties, 6);
    const counterparts = parties.filter((name) => name !== characterName);
    const stage = readableCharacterCardValues(
      stateItem.stage_label || stateItem.active_range || stateItem.effective_time || stateItem.stage_ids,
      3
    ).join("、");
    const details = readableCharacterCardValues([
      stateItem.objective_relation,
      stateItem.public_status,
      stateItem.affection,
      stateItem.trust,
      stateItem.power
    ], 8).join("；");
    if (!details) return [];
    return [{
      label: [counterparts.length ? `与${counterparts.join("、")}` : "人物关系", stage].filter(Boolean).join(" · "),
      text: details
    }];
  }).slice(0, 12);
}

function characterCardFactList(rows = []) {
  return rows.length
    ? `<ul class="character-card-facts">${rows.map((item) => `<li><b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.text)}</span></li>`).join("")}</ul>`
    : "";
}

function relationshipMainNodes(map) {
  return relationshipMainNodesData(map);
}

function relationshipMaximumChapter(map = state.relationshipMap || {}) {
  const confirmedMaximum = Math.max(
    1,
    Number(map.confirmed_chapter || map.effective_chapter || 1)
  );
  if (!state.outlineUnsealed) return confirmedMaximum;
  const plannedMaximum = Number(map.maximum_chapter || 0);
  return Math.max(confirmedMaximum, plannedMaximum);
}

function renderRelationshipMap(selectedEdgeIndex = state.selectedRelationshipEdgeIndex) {
  $("#spoilerModal .spoiler-modal").classList.remove("is-sealed-route");
  const map = state.relationshipMap || { nodes: [], edges: [], related_nodes: [], related_edges: [], effective_chapter: 0 };
  const chapterMaximum = relationshipMaximumChapter(map);
  const viewedChapter = Math.max(0, Math.min(
    Number(state.relationshipViewChapter ?? state.selectedChapter ?? map.effective_chapter ?? 0),
    chapterMaximum
  ));
  const suppliedConfirmedNodes = [...(map.nodes || []), ...(map.related_nodes || [])]
    .filter((node, index, items) => items.findIndex((candidate) => (candidate.id || candidate.name) === (node.id || node.name)) === index);
  const coreNodes = relationshipMainNodes(map);
  const coreIds = new Set(coreNodes.map((node) => node.id || node.name));
  const availableConfirmedEdges = relationshipEdgesThroughChapter([...(map.edges || []), ...(map.related_edges || [])], viewedChapter);
  const coreConfirmedEdges = consolidateRelationshipEdges(availableConfirmedEdges.filter((edge) => coreIds.has(edge.from) && coreIds.has(edge.to)).map((edge) => {
    const kind = relationshipKind(edge.summary);
    return { ...edge, type: edge.type || kind.type, label: edge.label || kind.label, status: "confirmed" };
  }), "confirmed", viewedChapter);
  const availableRelatedEdges = availableConfirmedEdges.filter((edge) => !(coreIds.has(edge.from) && coreIds.has(edge.to)));
  const relatedEdges = consolidateRelationshipEdges(
    availableRelatedEdges
      .filter((edge) => state.relationshipExpanded.has(edge.from) || state.relationshipExpanded.has(edge.to)),
    "confirmed",
    viewedChapter
  );
  const confirmedEdges = [...coreConfirmedEdges, ...relatedEdges];
  const relatedIds = new Set(relatedEdges.flatMap((edge) => [edge.from, edge.to]).filter((name) => !coreIds.has(name)));
  const availableFutureEdges = plannedRelationshipEdges(confirmedEdges, viewedChapter);
  const matchingFutureEdges = availableFutureEdges.filter((edge) =>
    (coreIds.has(edge.from) && coreIds.has(edge.to))
    || state.relationshipExpanded.has(edge.from)
    || state.relationshipExpanded.has(edge.to)
  );
  const limitedFutureEdges = limitRelationshipEdges(matchingFutureEdges);
  const hiddenFutureEdgeCount = limitedFutureEdges.hiddenCount;
  const futureEdges = limitedFutureEdges.edges;
  const futureRelatedIds = new Set(futureEdges.flatMap((edge) => [edge.from, edge.to]).filter((name) => !coreIds.has(name)));
  const relatedNodes = suppliedConfirmedNodes.filter((node) => {
    const id = node.id || node.name;
    return !coreIds.has(id) && (relatedIds.has(id) || futureRelatedIds.has(id));
  });
  const suppliedNodeById = new Map([
    ...(map.nodes || []),
    ...(map.related_nodes || []),
    ...(map.future_nodes || [])
  ].map((node) => [node.id || node.name, node]));
  const edges = [...confirmedEdges, ...futureEdges];
  const knownNodeIds = new Set([...coreNodes, ...relatedNodes].map((node) => node.id || node.name));
  const futureNodeNames = futureEdges
    .flatMap((edge) => [edge.from, edge.to])
    .filter((name, index, items) => name && !knownNodeIds.has(name) && items.indexOf(name) === index);
  const futureNodes = futureNodeNames.map((name) => ({
    ...(suppliedNodeById.get(name) || {}),
    id: name,
    name,
    color: suppliedNodeById.get(name)?.color || "ink",
    peripheral: suppliedNodeById.get(name)?.peripheral !== false,
    status: "planned",
    temporal_status: "future",
    future: true
  }));
  const nodeById = new Map([...coreNodes, ...relatedNodes, ...futureNodes].map((node) => [node.id || node.name, { ...node }]));
  const nodes = [...nodeById.values()];
  $("#storyMapEyebrow").textContent = state.outlineUnsealed
    ? `ROUTE MAP · 阅读至第 ${viewedChapter} 章 / 未来已解封`
    : `CONFIRMED ROUTE · 阅读至第 ${viewedChapter} 章`;
  $("#spoilerTitle").textContent = "航线图";
  $("#relationshipMapTab").classList.add("is-active");
  $("#outlineMapTab").classList.remove("is-active");
  $("#outlineLayoutSwitch").classList.add("is-hidden");
  if (!nodes.length) {
    $("#spoilerContent").innerHTML = `<section class="relationship-empty"><span>RELATIONSHIP MAP</span><b>还没有可以公开的人物关系</b><p>确认第一章后，已发生的关系会在这里逐渐连起来；查看未来剧情仍需单独解除剧透封条。</p></section>`;
    return;
  }
  const width = 920;
  const height = 470;
  const center = { x: width / 2, y: height / 2 };
  const visibleCore = nodes.filter((node) => node.core || node.layoutAnchor || !node.peripheral);
  const radiusX = Math.min(320, 145 + visibleCore.length * 22);
  const radiusY = Math.min(155, 85 + visibleCore.length * 8);
  const positions = new Map(visibleCore.map((node, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / Math.max(1, visibleCore.length);
    return [node.id || node.name, { x: center.x + Math.cos(angle) * radiusX, y: center.y + Math.sin(angle) * radiusY }];
  }));
  const peripheralByAnchor = new Map();
  [...relatedNodes, ...futureNodes].sort((left, right) => Number(left.depth || 1) - Number(right.depth || 1)).forEach((node) => {
    const id = node.id || node.name;
    const edge = edges.find((item) => item.from === id || item.to === id);
    const anchor = edge ? (edge.from === id ? edge.to : edge.from) : visibleCore[0]?.id;
    if (!peripheralByAnchor.has(anchor)) peripheralByAnchor.set(anchor, []);
    peripheralByAnchor.get(anchor).push(node);
  });
  peripheralByAnchor.forEach((group, anchorId) => {
    const anchor = positions.get(anchorId) || center;
    const outward = Math.atan2(anchor.y - center.y, anchor.x - center.x);
    group.forEach((node, index) => {
      const angle = outward + (index - (group.length - 1) / 2) * .38;
      positions.set(node.id || node.name, { x: anchor.x + Math.cos(angle) * 118, y: anchor.y + Math.sin(angle) * 94 });
    });
  });
  const pairGroups = new Map();
  edges.forEach((edge, index) => {
    const key = [edge.from, edge.to].sort().join("\u0000");
    if (!pairGroups.has(key)) pairGroups.set(key, []);
    pairGroups.get(key).push(index);
  });
  const edgeMarkup = edges.map((edge, index) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return "";
    const key = [edge.from, edge.to].sort().join("\u0000");
    const siblings = pairGroups.get(key) || [index];
    const lane = siblings.indexOf(index) - (siblings.length - 1) / 2;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const bend = lane * 34;
    const controlX = (from.x + to.x) / 2 - dy / length * bend;
    const controlY = (from.y + to.y) / 2 + dx / length * bend;
    const path = `M ${from.x} ${from.y} Q ${controlX} ${controlY} ${to.x} ${to.y}`;
    const type = ["family", "enemy", "romance", "ally", "mentor", "hierarchy"].includes(edge.type) ? edge.type : "other";
    const statusClass = edge.status === "planned" ? "is-planned" : "is-confirmed";
    const lifecycleClass = edge.lifecycle_status === "ended" || edge.lifecycle_status === "superseded" ? "is-ended" : "";
    return `<g class="relationship-edge type-${type} ${statusClass} ${lifecycleClass} ${index === selectedEdgeIndex ? "is-selected" : ""}" data-relationship-edge="${index}" role="button" tabindex="0" aria-label="${escapeHtml(edge.from)}与${escapeHtml(edge.to)}：${escapeHtml(edge.label || "关系")}${edge.status === "planned" ? "，尚未发生" : edge.lifecycle_status === "ended" ? "，已经结束" : ""}"><path class="edge-hit" d="${path}"></path><path class="edge-line" d="${path}"></path></g>`;
  }).join("");
  const expandableTargets = new Map();
  [...availableRelatedEdges, ...availableFutureEdges].forEach((edge) => {
    [edge.from, edge.to].forEach((anchor) => {
      if (!coreIds.has(anchor)) return;
      const target = edge.from === anchor ? edge.to : edge.from;
      if (coreIds.has(target)) return;
      if (!expandableTargets.has(anchor)) expandableTargets.set(anchor, new Set());
      expandableTargets.get(anchor).add(target);
    });
  });
  const expandableIds = new Set(expandableTargets.keys());
  const relatedCountById = new Map([...expandableTargets].map(([id, targets]) => [id, targets.size]));
  const nodeMarkup = nodes.map((node) => {
    const id = node.id || node.name;
    const position = positions.get(id);
    if (!position) return "";
    const expandable = expandableIds.has(id);
    return `<g class="relationship-node color-${escapeHtml(node.color || "navy")} ${node.peripheral ? "is-peripheral" : ""} ${node.future ? "is-future" : ""} ${expandable ? "is-expandable" : ""} ${state.relationshipExpanded.has(id) ? "is-expanded" : ""} ${state.selectedRelationshipNodeId === id ? "is-selected" : ""}" data-relationship-node="${escapeHtml(id)}" transform="translate(${position.x} ${position.y})"><circle r="${node.peripheral ? 23 : 31}"></circle><circle class="node-orbit" r="${node.peripheral ? 29 : 38}"></circle><text text-anchor="middle" y="4">${escapeHtml(node.name || node.id)}</text>${expandable ? `<text class="node-expand-mark" text-anchor="middle" y="53">${state.relationshipExpanded.has(id) ? "收起" : `＋${relatedCountById.get(id) || 0}`}</text>` : ""}</g>`;
  }).join("");
  const selected = Number.isInteger(selectedEdgeIndex) ? edges[selectedEdgeIndex] : null;
  const selectedNode = state.selectedRelationshipNodeId ? nodeById.get(state.selectedRelationshipNodeId) : null;
  const card = readerSafeCharacterCard(state.selectedRelationshipNodeId, edges, selectedNode?.card || {}, viewedChapter, map.effective_chapter);
  const cardRelations = card.relationships || [];
  const knowledgeRows = characterKnowledgeRows(card);
  const knowledgeMarkup = knowledgeRows.length
    ? `<ul class="character-knowledge">${knowledgeRows.map((item) => `<li class="state-${escapeHtml(item.state)}"><b>${escapeHtml(item.fact)}</b><span>${escapeHtml(item.state === "known" ? "已知" : item.state === "suspects" || item.state === "suspected" ? "怀疑" : item.state === "partial" ? "部分知情" : item.state === "unknown" ? "未知" : item.state)}</span><small>${escapeHtml(item.time)}</small></li>`).join("")}</ul>`
    : `<p>当前时间点尚无单独的知情记录</p>`;
  const showFullCharacterCard = state.outlineUnsealed && map.spoiler_level === "full";
  const fixedFactRows = showFullCharacterCard
    ? readableCharacterCardValues(card.fixed_facts, 8).map((text) => ({ label: "已确认事实", text }))
    : [];
  const fixedFactMarkup = characterCardFactList(fixedFactRows);
  const overrideRows = showFullCharacterCard
    ? readableCharacterCardValues(card.reader_changes, 8).map((text) => ({ label: "读者明确修改", text }))
    : [];
  const overrideMarkup = characterCardFactList(overrideRows);
  const uncertaintyMarkup = showFullCharacterCard
    ? characterCardFactList(readableCharacterCardValues(card.uncertainties, 8).map((text) => ({ label: "仍待确认", text })))
    : "";
  const contractCardMarkup = `${fixedFactMarkup ? `<article><small>已确认事实</small>${fixedFactMarkup}</article>` : ""}${overrideMarkup ? `<article><small>读者明确修改</small>${overrideMarkup}</article>` : ""}${uncertaintyMarkup ? `<article><small>未确定内容</small>${uncertaintyMarkup}</article>` : ""}`;
  const nodeDetailMarkup = selectedNode
    ? `<section class="relationship-character-card"><header><span>${selectedNode.future ? "FUTURE CAST" : selectedNode.peripheral ? "RELATED CAST" : "CORE CAST"}</span><b>${escapeHtml(selectedNode.name || selectedNode.id)}</b></header><div><article><small>本故事作用</small><p>${escapeHtml(card.function || "尚未单独标注")}</p></article><article><small>当前状态</small><p>${escapeHtml(selectedNode.future ? "尚未进入当前已确认时间点" : card.current_state || "正文尚未形成明确状态记录")}</p></article><article><small>当前知情</small>${knowledgeMarkup}</article><article><small>当前关系 · 每行一对人物</small>${cardRelations.length ? `<ul class="character-relations">${cardRelations.map((item) => `<li><b>${escapeHtml(item.with)}</b><span>${escapeHtml(item.label || "关系")}</span><p>${escapeHtml(item.summary || "")}</p></li>`).join("")}</ul>` : `<p>尚无已经确认的关系记录</p>`}</article><article><small>正文记录</small><p>${card.last_confirmed_chapter ? `最近在第 ${Number(card.last_confirmed_chapter)} 章连续性中出现` : "尚无已确认章节记录"}</p></article>${contractCardMarkup}</div></section>`
    : "";
  const detailMarkup = selected
    ? `<section class="relationship-detail ${selected.status === "planned" ? "is-future" : ""} ${selected.lifecycle_status === "ended" || selected.lifecycle_status === "superseded" ? "is-ended" : ""}"><span>${escapeHtml(selected.from)} ↔ ${escapeHtml(selected.to)}<small>${escapeHtml(selected.relationship_label || selected.label || "关系")}</small></span><dl><div><dt>关系性质</dt><dd>${escapeHtml(selected.relationship_label || selected.label || "关系")}</dd></div><div><dt>当前状态</dt><dd>${escapeHtml(selected.status === "planned" ? "尚未发生" : selected.lifecycle_status === "ended" ? "这段关系已经结束" : selected.lifecycle_status === "superseded" ? "这段关系已被后续事实纠正" : selected.current_state || selected.summary || "关系已有记录")}</dd></div><div><dt>最新变化</dt><dd>${escapeHtml(selected.latest_change || selected.summary || "尚无新的变化")}</dd></div></dl>${selected.status === "planned" ? `<p>灰线表示这段关系属于尚未发生的未来内容。</p>` : selected.turning_points?.length ? `<ol>${selected.turning_points.slice().reverse().map((point) => `<li><small>第 ${point.chapter} 章</small><p>${escapeHtml(point.summary)}</p></li>`).join("")}</ol>` : ""}</section>`
    : nodeDetailMarkup || `<section class="relationship-detail is-hint"><span>HOW TO READ</span><b>点击人物或关系线查看状态</b><p>有色实线是截至当前章节已经成立的关系；解除剧透封条后，能够可靠提取的未来关系以灰色虚线叠加显示。</p></section>`;
  const countText = `${coreNodes.length} 个主要角色始终显示 · ${confirmedEdges.length} 对已发生关系${futureEdges.length ? ` · ${futureEdges.length} 对未来关系` : ""}${hiddenFutureEdgeCount ? ` · 还有 ${hiddenFutureEdgeCount} 对未显示` : ""} · 点击主要角色展开相关配角`;
  const viewingFuture = state.outlineUnsealed && viewedChapter > Number(map.effective_chapter || 0);
  const continuityWarning = state.relationshipContinuityError ? `连续性状态暂时未更新：${state.relationshipContinuityError}` : viewingFuture ? `第 ${viewedChapter} 章为隐藏大纲中的预计关系阶段` : "人物状态和关系显示到所选章节结束时";
  const chapterScopeLabel = state.outlineUnsealed ? `全书共 ${chapterMaximum} 章` : `已确认 ${chapterMaximum} 章`;
  const legend = `<div class="relationship-legend"><span><i class="is-confirmed"></i>有色实线 · 已发生</span>${state.outlineUnsealed ? `<span><i class="is-planned"></i>灰色虚线 · 尚未发生</span>` : ""}<label class="relationship-chapter-picker" for="relationshipViewChapter"><span>查看至第</span><input id="relationshipViewChapter" type="number" inputmode="numeric" min="1" max="${chapterMaximum}" value="${Math.max(1, viewedChapter)}" aria-label="手动输入要查看人物关系的章节"><span>章</span><em>/ ${chapterScopeLabel}</em></label><small class="${state.relationshipContinuityError ? "is-error" : ""}">${escapeHtml(continuityWarning)}</small></div>`;
  const viewport = state.relationshipViewport;
  $("#spoilerContent").innerHTML = `<section class="relationship-map-shell"><header><span>CORE CAST / ROUTE LINKS</span><p>${countText}</p></header>${legend}<div class="relationship-stage"><div class="relationship-graph-wrap"><div class="relationship-graph-tools"><button type="button" class="graph-pan-toggle ${state.relationshipPanEnabled ? "is-active" : ""}" data-graph-pan>${state.relationshipPanEnabled ? "完成移动" : "移动视图"}</button><button type="button" data-graph-zoom="out" aria-label="缩小">−</button><button type="button" data-graph-zoom="reset">复位</button><button type="button" data-graph-zoom="in" aria-label="放大">＋</button></div><svg class="relationship-graph ${state.relationshipPanEnabled ? "is-pan-enabled" : ""}" viewBox="0 0 ${width} ${height}" aria-label="人物关系航线图"><g id="relationshipGraphScene" transform="translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})">${edgeMarkup}${nodeMarkup}</g></svg></div><aside class="relationship-inspector" aria-live="polite">${detailMarkup}</aside></div></section>`;
  bindRelationshipGraphInteractions();
}

function bindRelationshipGraphInteractions() {
  const chapterPicker = $("#relationshipViewChapter");
  if (chapterPicker) {
    const applyChapter = async () => {
      const maximum = relationshipMaximumChapter();
      const requested = Math.max(1, Math.min(maximum, Math.round(Number(chapterPicker.value) || 1)));
      await refreshRelationshipChapter(requested);
    };
    chapterPicker.addEventListener("change", () => { applyChapter(); });
    chapterPicker.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      applyChapter();
    });
  }
  const svg = $(".relationship-graph");
  const scene = $("#relationshipGraphScene");
  if (!svg || !scene) return;
  const apply = () => {
    const viewport = state.relationshipViewport;
    scene.setAttribute("transform", `translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`);
  };
  let drag = null;
  let suppressClick = false;
  svg.addEventListener("pointerdown", (event) => {
    if (!state.relationshipPanEnabled) return;
    drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false };
  });
  svg.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const rect = svg.getBoundingClientRect();
    const screenDistance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.moved && screenDistance >= 7) {
      drag.moved = true;
      try { svg.setPointerCapture(event.pointerId); } catch {}
    }
    if (!drag.moved) return;
    const dx = (event.clientX - drag.x) * 920 / Math.max(1, rect.width);
    const dy = (event.clientY - drag.y) * 470 / Math.max(1, rect.height);
    state.relationshipViewport.x += dx;
    state.relationshipViewport.y += dy;
    drag.x = event.clientX;
    drag.y = event.clientY;
    apply();
  });
  svg.addEventListener("pointerup", (event) => {
    suppressClick = Boolean(drag?.moved);
    if (svg.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    drag = null;
  });
  svg.addEventListener("pointercancel", () => { drag = null; suppressClick = true; });
  svg.addEventListener("click", (event) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  svg.addEventListener("wheel", (event) => {
    if (!state.relationshipPanEnabled) return;
    event.preventDefault();
    state.relationshipViewport.scale = Math.max(.62, Math.min(2.4, state.relationshipViewport.scale * (event.deltaY < 0 ? 1.1 : .9)));
    apply();
  }, { passive: false });
}

function mergeHistoricalRelationshipMap(fullMap, historicalMap) {
  return mergeHistoricalRelationshipMapData(fullMap, historicalMap);
}

async function refreshRelationshipChapter(chapter) {
  if (!state.activeProject) return;
  const requested = Math.max(1, Math.round(Number(chapter) || 1));
  const requestSerial = ++state.relationshipChapterRequestSerial;
  const path = `/api/projects/${state.activeProject.id}`;
  const [mapResult, continuityResult] = await Promise.all([
    api(`${path}/relationship-map?chapter=${requested}`)
      .then((data) => ({ data, error: null }))
      .catch((error) => ({ data: null, error })),
    api(`${path}/continuity?chapter=${requested}`)
      .then((data) => ({ data, error: null }))
      .catch((error) => ({ data: null, error }))
  ]);
  if (requestSerial !== state.relationshipChapterRequestSerial) return;
  if (mapResult.data?.relationship_map) {
    state.relationshipMap = mergeHistoricalRelationshipMap(
      state.relationshipMap,
      mapResult.data.relationship_map
    );
  }
  if (continuityResult.data) {
    state.relationshipContinuity = continuityResult.data.continuity || {};
  }
  const errors = [mapResult.error?.message, continuityResult.error?.message].filter(Boolean);
  state.relationshipContinuityError = errors.join("；") || null;
  state.relationshipViewChapter = requested;
  state.selectedRelationshipNodeId = null;
  state.selectedRelationshipEdgeIndex = null;
  renderRelationshipMap();
}

async function openStoryMapEntry() {
  if (!state.activeProject?.outline_id) return showToast("这条故事线还没有隐藏大纲");
  if (state.outlineUnsealed) {
    openModal("spoilerModal");
    renderRelationshipMap();
    return;
  }
  state.spoilerGateStep = 0;
  state.spoilerChallenge = null;
  openModal("spoilerModal");
  renderSpoilerGate();
}

async function openStoryMap() {
  if (!state.activeProject) return;
  const requestedChapter = Math.max(1, Number(
    state.selectedChapter || state.activeProject.current_chapter || 1
  ));
  const [result, continuityResult] = await Promise.all([
    api(`/api/projects/${state.activeProject.id}/relationship-map?chapter=${requestedChapter}`),
    api(`/api/projects/${state.activeProject.id}/continuity?chapter=${requestedChapter}`)
      .then((data) => ({ ...data, error: null }))
      .catch((error) => ({ continuity: state.relationshipContinuity || {}, error }))
  ]);
  state.relationshipMap = result.relationship_map || { nodes: [], edges: [] };
  state.relationshipContinuity = continuityResult.continuity || {};
  state.relationshipContinuityError = continuityResult.error?.message || null;
  state.relationshipViewChapter = Math.max(1, Math.min(
    requestedChapter,
    Number(state.relationshipMap.effective_chapter || state.selectedChapter || 1)
  ));
  state.selectedRelationshipNodeId = null;
  state.selectedRelationshipEdgeIndex = null;
  openModal("spoilerModal");
  renderRelationshipMap();
}

function renderSpoilerGate() {
  $("#spoilerModal .spoiler-modal").classList.add("is-sealed-route");
  $("#storyMapEyebrow").textContent = "SEALED ROUTE · 尚未发生的内容";
  $("#spoilerTitle").textContent = "航线图封条";
  $("#relationshipMapTab").classList.remove("is-active");
  $("#outlineMapTab").classList.remove("is-active");
  $("#outlineLayoutSwitch").classList.add("is-hidden");
  const second = state.spoilerGateStep === 1;
  $("#spoilerContent").innerHTML = `<section class="spoiler-seal ${second ? "is-second" : ""}"><div class="spoiler-seal-hints"><span>人物关系 · 已发生</span><span>剧情航线 · 未来</span></div><div class="spoiler-seal-check"><span>${second ? "02 / FINAL CHECK" : "01 / FIRST CHECK · 可能看到未来"}</span><h3>${second ? "确认查看整条未来航线" : "确认是否继续"}</h3><p>${second ? escapeHtml(state.spoilerChallenge?.warning || "确认后将展开尚未发生的人物关系、剧情阶段与结局。") : "继续后才会展开尚未发生的人物关系、事件阶段、要求兑现与结局。"}</p></div><div class="spoiler-route-tree" aria-hidden="true"><svg viewBox="0 0 620 180"><line x1="28" y1="90" x2="265" y2="90"/><line x1="265" y1="90" x2="430" y2="42"/><line x1="265" y1="90" x2="430" y2="138"/><line x1="430" y1="42" x2="594" y2="42"/><line x1="430" y1="138" x2="594" y2="138"/><circle cx="28" cy="90" r="5"/><circle cx="265" cy="90" r="6"/><circle cx="430" cy="42" r="5"/><circle cx="430" cy="138" r="5"/><circle cx="594" cy="42" r="5"/><circle cx="594" cy="138" r="5"/><text x="20" y="112">NOW</text><text x="242" y="112">BRANCH</text><text x="445" y="31">RELATION</text><text x="445" y="160">EVENT</text><text x="552" y="29">ENDING</text><text x="550" y="158">PAYOFF</text></svg>${second ? "" : '<em>Future route</em>'}</div><footer class="spoiler-seal-actions"><button type="button" data-spoiler-gate="confirmed">只看已发生</button><button class="spoiler-unseal-action" type="button" data-spoiler-gate="${second ? "unseal" : "continue"}">${second ? "确认查看" : "继续确认"} <b>→</b></button></footer></section>`;
}

function renderSealedFutureMap() {
  $("#spoilerModal .spoiler-modal").classList.remove("is-sealed-route");
  $("#storyMapEyebrow").textContent = "SEALED ROUTE · 尚未发生的内容";
  $("#spoilerTitle").textContent = "航线图";
  $("#relationshipMapTab").classList.remove("is-active");
  $("#outlineMapTab").classList.add("is-active");
  $("#outlineLayoutSwitch").classList.add("is-hidden");
  $("#spoilerContent").innerHTML = `<section class="sealed-future-route"><span>DESTINATION · 封闭区</span><i aria-hidden="true"></i><b>未来终点仍未解封</b><p>这里不会预取或保存尚未确认的事件与关系。关闭航线图后重新从“航线图”入口进入，才可以进行两次确认。</p></section>`;
}

async function continueSpoilerGate() {
  if (!state.activeProject?.outline_id) return showToast("这条故事线还没有隐藏大纲");
  state.spoilerChallenge = await api(`/api/projects/${state.activeProject.id}/outline/spoiler-challenge`, { method: "POST", body: {} });
  state.spoilerGateStep = 1;
  renderSpoilerGate();
}

async function revealSpoilers() {
  if (!state.spoilerChallenge?.token) return continueSpoilerGate();
  const requestedChapter = Math.max(1, Number(
    state.relationshipViewChapter || state.selectedChapter || 1
  ));
  let result;
  let continuityResult;
  try {
    [result, continuityResult] = await Promise.all([
      api(`/api/projects/${state.activeProject.id}/outline/spoiler-unseal`, {
        method: "POST",
        body: {
          token: state.spoilerChallenge.token,
          confirmation: "我确认查看未来剧情",
          chapter: requestedChapter
        }
      }),
      api(`/api/projects/${state.activeProject.id}/continuity?chapter=${requestedChapter}`)
        .then((data) => ({ ...data, error: null }))
        .catch((error) => ({ continuity: state.relationshipContinuity || {}, error }))
    ]);
  } catch (error) {
    if (recoverSpoilerConfirmation(state, error)) {
      renderSpoilerGate();
      showToast("确认已过期，请重新进行两次确认");
      return;
    }
    throw error;
  }
  state.spoilerOutlineView = result.outline || null;
  state.relationshipMap = result.relationship_map || state.relationshipMap;
  state.relationshipContinuity = continuityResult.continuity || {};
  state.relationshipContinuityError = continuityResult.error?.message || null;
  state.outlineUnsealed = true;
  state.selectedCausalNodeId = null;
  state.outlineChangeProposal = null;
  state.spoilerGateStep = 0;
  state.spoilerChallenge = null;
  state.relationshipViewChapter = Math.max(
    1,
    Number(state.relationshipMap?.maximum_chapter || state.relationshipMap?.effective_chapter || 1)
  );
  state.selectedRelationshipNodeId = null;
  state.selectedRelationshipEdgeIndex = null;
  renderRelationshipMap();
  $$('[data-outline-layout]').forEach((button) => button.classList.toggle("is-active", button.dataset.outlineLayout === state.outlineLayout));
  openModal("spoilerModal");
}

async function applyReaderRequest(text, scope) {
  if (!text) { showToast("请先写下你的意见"); return false; }
  const projectId = state.activeProject.id;
  if (scope === "replan") {
    if (!confirm("这会重建全部尚未发生的未来，已确认章节不会改变。继续吗？")) return false;
    await api(`/api/projects/${projectId}/outline/replan`, {
      method: "POST",
      body: {
        reason: text,
        record_wish: true,
        chapter_number: state.activeProject.current_chapter
      }
    });
    scheduleProjectPoll(projectId);
    return true;
  }
  await api(`/api/projects/${projectId}/wishes`, { method: "POST", body: { text, scope, chapter_number: state.activeProject.current_chapter } });
  if (scope === "current") {
    await generateChapter(text);
  } else {
    showToast("要求已经放入后续章节约束");
    await refreshProject(projectId);
  }
  return true;
}

document.addEventListener("click", async (event) => {
  if (!event.target.closest(".reader-settings")) setReaderSettingsOpen(false);
  const receiptCast = event.target.closest("[data-receipt-cast]");
  if (receiptCast && !receiptCast.disabled) {
    state.receiptCastView = receiptCast.dataset.receiptCast === "support" ? "support" : "primary";
    renderIdeas();
    return;
  }
  const clarificationOption = event.target.closest("[data-clarification-option]");
  if (clarificationOption) {
    const index = Number(clarificationOption.dataset.clarificationOption);
    const input = $(`[data-clarification-response="${index}"]`);
    if (input) {
      input.value = clarificationOption.dataset.optionValue || clarificationOption.textContent.trim();
      const key = input.dataset.clarificationKey;
      if (key) state.clarificationDrafts.set(key, input.value);
      input.focus();
    }
    return;
  }
  const clarificationSubmit = event.target.closest("[data-submit-clarifications]");
  if (clarificationSubmit) {
    const questions = briefClarificationQuestions();
    const answers = questions.map((question, index) => ({
      key: question.key,
      question: question.question,
      answer: $(`[data-clarification-response="${index}"]`)?.value.trim() || ""
    }));
    if (!answers.length || answers.some((item) => !item.answer)) {
      showToast("请回答本轮全部问题；不想指定时可以写“交给系统按原著决定”");
      return;
    }
    const combined = answers.map((item, index) => `问题 ${index + 1}：${item.question}\n回答：${item.answer}`).join("\n\n");
    try {
      await sendWizardMessage(
        combined,
        clarificationSubmit,
        `正在核对 ${answers.length} 项回答`,
        { clarification_answers: answers }
      );
      answers.forEach((item) => state.clarificationDrafts.delete(item.key));
      renderIdeas();
    }
    catch (error) { showToast(error.message); }
    return;
  }
  const spoilerGate = event.target.closest("[data-spoiler-gate]");
  if (spoilerGate) {
    try {
      if (spoilerGate.dataset.spoilerGate === "confirmed") await openStoryMap();
      else if (spoilerGate.dataset.spoilerGate === "continue") await continueSpoilerGate();
      else await revealSpoilers();
    } catch (error) { showToast(error.message); }
    return;
  }
  const graphPan = event.target.closest("[data-graph-pan]");
  if (graphPan) {
    state.relationshipPanEnabled = !state.relationshipPanEnabled;
    renderRelationshipMap();
    return;
  }
  const graphZoom = event.target.closest("[data-graph-zoom]");
  if (graphZoom) {
    const direction = graphZoom.dataset.graphZoom;
    if (direction === "reset") state.relationshipViewport = { x: 0, y: 0, scale: 1 };
    else state.relationshipViewport.scale = Math.max(.62, Math.min(2.4, state.relationshipViewport.scale * (direction === "in" ? 1.18 : .84)));
    renderRelationshipMap();
    return;
  }
  const relationshipNode = event.target.closest("[data-relationship-node]");
  if (relationshipNode) {
    const id = relationshipNode.dataset.relationshipNode;
    state.selectedRelationshipNodeId = id;
    state.selectedRelationshipEdgeIndex = null;
    const hasRelated = relationshipNode.classList.contains("is-expandable");
    if (hasRelated) {
      if (state.relationshipExpanded.has(id)) state.relationshipExpanded.delete(id);
      else state.relationshipExpanded.add(id);
    }
    renderRelationshipMap();
    return;
  }
  const relationshipEdge = event.target.closest("[data-relationship-edge]");
  if (relationshipEdge) {
    state.selectedRelationshipNodeId = null;
    state.selectedRelationshipEdgeIndex = Number(relationshipEdge.dataset.relationshipEdge);
    renderRelationshipMap(state.selectedRelationshipEdgeIndex);
    return;
  }
  const semanticAnswer = event.target.closest("[data-semantic-answer]");
  if (semanticAnswer) {
    const value = semanticAnswer.dataset.semanticAnswer || "";
    const question = semanticAnswer.closest(".semantic-question")?.querySelector("p")?.textContent || "";
    $("#wizardChatInput").value = value ? `${question}\n${value}` : `${question}\n`;
    $("#wizardChatInput").focus();
    return;
  }
  const causalNode = event.target.closest("[data-causal-node]");
  if (causalNode) {
    state.selectedCausalNodeId = causalNode.dataset.causalNode;
    $$("[data-causal-node]").forEach((item) => item.classList.toggle("is-selected", item === causalNode));
    const title = causalNode.querySelector("b")?.textContent || state.selectedCausalNodeId;
    if ($("#outlineChangeScope")) $("#outlineChangeScope").textContent = `正在讨论：${title}`;
    return;
  }
  if (event.target.closest("#previewOutlineChange")) {
    const text = $("#outlineChangeInput")?.value.trim();
    if (!text) return showToast("请先写下想调整的内容");
    const button = $("#previewOutlineChange");
    button.disabled = true;
    try {
      const result = await api(`/api/projects/${state.activeProject.id}/outline/change-preview`, {
        method: "POST",
        body: { text, selected_node_id: state.selectedCausalNodeId || "" }
      });
      state.outlineChangeProposal = result.proposal;
      const proposal = result.proposal;
      const preview = $("#outlineChangePreview");
      preview.classList.remove("is-hidden");
      const blocked = proposal.requires_branch || proposal.requires_clarification;
      preview.innerHTML = `<span>${proposal.kind === "lens" ? "只调整镜头" : proposal.requires_branch ? "需要新故事版本" : proposal.requires_clarification ? "需要补充一处定义" : proposal.semantic_change ? "更新人物变化约定" : "将重建未发生路线"}</span><p>${escapeHtml(proposal.summary)}</p>${proposal.semantic_summary ? `<small>约定：${escapeHtml(proposal.semantic_summary)}</small>` : ""}${proposal.affected_nodes?.length ? `<small>影响：${escapeHtml(proposal.affected_nodes.map((item) => item.title).join("、"))}</small>` : ""}${proposal.conflicts?.length ? `<small class="is-conflict">冲突：${escapeHtml(proposal.conflicts.join("；"))}</small>` : ""}<button type="button" id="applyOutlineChange" ${blocked ? "disabled" : ""}>${proposal.kind === "lens" ? "确认更新镜头" : proposal.requires_clarification ? "补充后重新预览" : "确认并重建未来"}</button>`;
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (event.target.closest("#applyOutlineChange")) {
    const proposal = state.outlineChangeProposal;
    if (!proposal) return;
    const button = $("#applyOutlineChange");
    button.disabled = true;
    try {
      const result = await api(`/api/projects/${state.activeProject.id}/outline/change-apply`, {
        method: "POST",
        body: { proposal_id: proposal.id }
      });
      if (result.action === "lens_updated") {
        state.spoilerOutlineView = result.outline || state.spoilerOutlineView;
        state.outlineChangeProposal = null;
        renderSpoilerOutline();
        showToast("镜头方案已经更新，因果主干保持不变");
      } else {
        closeModal("spoilerModal");
        showToast("修改已确认，正在重建未发生的故事路线");
        scheduleProjectPoll(state.activeProject.id);
      }
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
    }
    return;
  }
  const restartButton = event.target.closest("[data-restart-project]");
  if (restartButton) {
    const project = state.projects.find((item) => item.id === restartButton.dataset.restartProject);
    if (!project || !confirm(`重新开始“${project.title}”吗？\n\n系统会保留当前版本，并用同一原著、创作前提和模型设置建立一个全新版本。`)) return;
    restartButton.disabled = true;
    try {
      await api(`/api/projects/${project.id}/clone`, { method: "POST", body: { through_chapter: 0, title: `${project.title} · 重新开始` } });
      await loadLibrary();
      showToast("新版本已经建立，原版本仍然保留");
    } catch (error) {
      restartButton.disabled = false;
      showToast(error.message);
    }
    return;
  }
  const archiveButton = event.target.closest("[data-archive-project]");
  if (archiveButton) {
    const project = state.projects.find((item) => item.id === archiveButton.dataset.archiveProject);
    if (!project || !confirm(`废弃“${project.title}”这个版本吗？\n\n正文和原著不会删除，它会移到页面底部的归档区，之后仍可恢复。`)) return;
    archiveButton.disabled = true;
    try {
      await api(`/api/projects/${project.id}/archive`, { method: "POST", body: {} });
      await loadLibrary();
      showToast("版本已移入归档区，可以随时恢复");
    } catch (error) {
      archiveButton.disabled = false;
      showToast(error.message);
    }
    return;
  }
  const restoreButton = event.target.closest("[data-restore-project]");
  if (restoreButton) {
    restoreButton.disabled = true;
    try {
      await api(`/api/projects/${restoreButton.dataset.restoreProject}/restore`, { method: "POST", body: {} });
      await loadLibrary();
      showToast("版本已经恢复并设为当前创作");
    } catch (error) {
      restoreButton.disabled = false;
      showToast(error.message);
    }
    return;
  }
  const deleteProjectButton = event.target.closest("[data-delete-project]");
  if (deleteProjectButton) {
    const project = state.projects.find((item) => item.id === deleteProjectButton.dataset.deleteProject);
    if (project) openDeletionDialog("project", project);
    return;
  }
  const deleteSourceButton = event.target.closest("[data-delete-source]");
  if (deleteSourceButton && !deleteSourceButton.disabled) {
    const source = state.sources.find((item) => item.id === deleteSourceButton.dataset.deleteSource);
    if (source) openDeletionDialog("source", source);
    return;
  }
  const refineSourceButton = event.target.closest("[data-refine-source]");
  if (refineSourceButton) {
    const profile = flashProfile();
    if (!profile) return showToast("请先在模型与连接中保存 DeepSeek V4 Flash 的 Key");
    refineSourceButton.disabled = true;
    try {
      await api(`/api/sources/${refineSourceButton.dataset.refineSource}/refine`, {
        method: "POST",
        body: { profile_id: profile.id, require_flash: true }
      });
      await loadLibrary();
      scheduleSourceManagerPoll();
      showToast("全书场景精切已经开始，可关闭页面");
    } catch (error) {
      refineSourceButton.disabled = false;
      showToast(error.message);
    }
    return;
  }
  const activateSourceCutButton = event.target.closest("[data-activate-source-cut]");
  if (activateSourceCutButton) {
    activateSourceCutButton.disabled = true;
    try {
      await api(`/api/sources/${activateSourceCutButton.dataset.activateSourceCut}/activate-cut`, {
        method: "POST",
        body: { cut_id: activateSourceCutButton.dataset.cutId, delete_older: true }
      });
      await loadLibrary();
      showToast("新版场景切割已经启用，旧切割版本已删除");
    } catch (error) {
      activateSourceCutButton.disabled = false;
      showToast(error.message);
    }
    return;
  }
  const stopSourceTaskButton = event.target.closest("[data-stop-source-task]");
  if (stopSourceTaskButton?.dataset.stopSourceTask) {
    stopSourceTaskButton.disabled = true;
    try {
      await api(`/api/tasks/${stopSourceTaskButton.dataset.stopSourceTask}/cancel`, { method: "POST", body: {} });
      showToast("正在保存当前批次并安全停止");
      scheduleSourceManagerPoll();
    } catch (error) {
      stopSourceTaskButton.disabled = false;
      showToast(error.message);
    }
    return;
  }
  const newFromSourceButton = event.target.closest("[data-new-from-source]");
  if (newFromSourceButton && !newFromSourceButton.disabled) {
    await openWizard();
    state.selectedSourceId = newFromSourceButton.dataset.newFromSource;
    state.sourceMode = "existing";
    renderSourceLibrary();
    return;
  }
  const openButton = event.target.closest("[data-open-project]");
  if (openButton) return openProject(openButton.dataset.openProject);
  const chapterButton = event.target.closest("[data-chapter]");
  if (chapterButton) {
    state.selectedChapter = Number(chapterButton.dataset.chapter);
    state.pendingChapterSelection = null;
    state.editing = false;
    return renderWorkbench();
  }
  const filterButton = event.target.closest("[data-chapter-filter]");
  if (filterButton) { state.chapterFilter = filterButton.dataset.chapterFilter; return renderChapterRail(); }
  const coordinateCell = event.target.closest("[data-coordinate-cell]");
  if (coordinateCell) {
    const [l, d] = coordinateCell.dataset.coordinateCell.split("-");
    $("#lLevel").value = l; $("#dLevel").value = d; $("#inferredAxis").value = "w";
    return updateConstraintModel();
  }
  const cubeNode = event.target.closest("[data-cube-node]");
  if (cubeNode) {
    const [l, d, f] = cubeNode.dataset.cubeNode.split("-");
    $("#lLevel").value = l; $("#dLevel").value = d;
    const radio = $(`input[name='fidelity'][value='${f}']`);
    if (radio) radio.checked = true;
    $("#inferredAxis").value = "w";
    return updateConstraintModel();
  }
  const fidelityButton = event.target.closest("[data-fidelity-level]");
  if (fidelityButton) {
    const radio = $(`input[name='fidelity'][value='${fidelityButton.dataset.fidelityLevel}']`);
    if (radio) radio.checked = true;
    return updateConstraintModel();
  }
  const outlineLayoutButton = event.target.closest("[data-outline-layout]");
  if (outlineLayoutButton) {
    state.outlineLayout = outlineLayoutButton.dataset.outlineLayout;
    $$("[data-outline-layout]").forEach((button) => button.classList.toggle("is-active", button === outlineLayoutButton));
    renderSpoilerOutline();
    return;
  }
  const sourceButton = event.target.closest("[data-existing-source]");
  if (sourceButton) {
    state.selectedSourceId = sourceButton.dataset.existingSource;
    state.sourceMode = "existing";
    if (!$("#projectNameInput").value.trim()) $("#projectNameInput").value = `${sourceById(state.selectedSourceId)?.title || "原著"} · 新故事`;
    return renderSourceLibrary();
  }
  const setupButton = event.target.closest("[data-setup-action]");
  if (setupButton) return performSetupAction(setupButton.dataset.setupAction, setupButton);
  const deleteProfile = event.target.closest("[data-delete-profile]");
  if (deleteProfile) {
    const profile = profileById(deleteProfile.dataset.deleteProfile);
    if (!profile || !window.confirm(`删除 API 配置“${profile.name}”及本机钥匙串中的密钥？`)) return;
    try {
      await api(`/api/profiles/${encodeURIComponent(profile.id)}`, { method: "DELETE", body: {} });
      state.selectedProfileId = "";
      await loadLibrary();
      fillProfileSelects();
      renderProfiles();
      showToast("API 配置已删除");
    } catch (error) { showToast(error.message); }
    return;
  }
  const profile = event.target.closest("[data-profile]");
  if (profile) { state.selectedProfileId = profile.dataset.profile; return renderProfiles(); }
  const closer = event.target.closest("[data-close]");
  if (closer) {
    closeModal(closer.dataset.close);
    if (closer.dataset.close === "spoilerModal" && !state.outlineUnsealed) {
      state.spoilerGateStep = 0;
      state.spoilerChallenge = null;
    }
    if (closer.dataset.close === "newProjectModal") {
      $("#libraryView").classList.remove("is-hidden");
      loadLibrary();
    }
  }
});

$("#newProjectButton").addEventListener("click", () => openWizard());
$("#brandButton").addEventListener("click", () => $("#backToLibrary").click());
$("#backToLibrary").addEventListener("click", async () => {
  clearTimeout(state.pollTimer);
  $("#workbenchView").classList.add("is-hidden");
  $("#sourceManagerView").classList.add("is-hidden");
  $("#newProjectModal").classList.add("is-hidden");
  $("#libraryView").classList.remove("is-hidden");
  await loadLibrary();
});
$("#backFromSources").addEventListener("click", () => $("#backToLibrary").click());
$("#sourceManagerButton").addEventListener("click", openSourceManager);
$("#importSourceFromManager").addEventListener("click", () => {
  state.sourceImportFromManager = true;
  $("#sourceFileInput").value = "";
  $("#sourceFileInput").click();
});
$("#apiButton").addEventListener("click", () => openApiLibrary(state.activeProject?.director_profile_id));
$("#openApiFromWizard").addEventListener("click", () => openApiLibrary($("#directorApi").value));
$("#helpButton").addEventListener("click", () => openModal("helpModal"));
const helpSections = {
  1: ["先认识 Gugu 的角色与历史", "A 管全书路线，C 整理当前成立的事实，B 负责把本章写成正文。", [
    ["故事总控", "A / DIRECTOR", "理解全书、建立长期路线并检查章节。", "A 负责全书阅读、用户要求、隐藏大纲和章节校验。开始全书阅读后，A 会与当前故事版本绑定，避免中途更换总控造成长期路线和人物理解漂移。"],
    ["当时真相", "C / CURRENT TRUTH", "整理本章已经成立、人物此刻可知的事实。", "C 自动整理已经发生的事件、人物当前状态、知识边界、本章入口和必须完成的任务，再交给 B。它不是需要用户单独配置的第三个模型。"],
    ["章节写作者", "B / WRITER", "读取当前章节包并创作正文。", "B 不需要重新阅读整部原著，也不会查看全部未来路线。它只读取当前章安全材料；可以在章节之间更换，新写作者从下一次生成开始生效。"]
  ]],
  2: ["把原著准备成可使用的资料", "导入完整 TXT，完成场景精切，再由 A 建立全书认识；同一原著可以被多个故事版本复用。", [
    ["导入或复用", "SOURCE / LOCAL", "选择新的 TXT，或复用已经准备好的原著。", "原著、故事版本和正文彼此独立。同一部原著可以建立多条故事线，不必重复导入，也不会继承其他版本的要求、大纲或正文。"],
    ["场景精切", "SEGMENT / INDEX", "把长篇原著整理成可准确取回的小块。", "精切建立章节、场景和原文位置索引，不会修改原始 TXT。正常情况下不必反复重建；只有索引缺失、损坏或页面明确提示时才需要重新建立。"],
    ["全书阅读", "READ / ANCHOR", "由 A 建立人物、事件、关系与因果的整体认识。", "切割负责找到原文，全书阅读负责理解全局。完成以后，隐藏大纲和每章写作才有稳定依据；较长原著需要等待，但任务可以在后台继续。"]
  ]],
  3: ["决定故事怎样展开", "设置范围、详略、长度和原著约束，再用自己的话说明想看到的变化。", [
    ["故事坐标", "L · D · W · F", "L 管范围，D 管详略，W 管预计长度，F 管原著约束。", "W 是整部成品的软目标，事件完整和自然收束优先。F 不是质量等级：从借用人物世界，到尽量保留原著事实、因果和结局条件，代表不同的改写距离。"],
    ["成品规格", "FORMAT / FOCUS", "说明作品类型、故事重心与视角中心；点击查看完整例子。", "例子：假设核心要求始终是“梁山伯与祝英台最终在一起，梁祝两家也化解了矛盾”。结局不变，故事重心决定主要展开哪一段过程。\n\n感情发展：可以写“重点描写两人怎样确认感情、消除顾虑并建立信任”。正文会增加相处、犹豫和共同选择的篇幅，家族矛盾主要用来考验两人的关系。\n\n祝英台成长：可以写“重点描写祝英台怎样从服从安排，到学会表达意愿并承担选择的后果”。正文会更重视她的主动选择，不能只靠梁山伯解决问题。\n\n家族和解：可以写“重点描写两家矛盾的来源、双方为何不愿退让，以及立场怎样逐步改变”。正文会详细展开利益、旧怨和和解过程，不反复制造梁祝之间的误会。\n\n共同抗争：可以写“重点描写两人怎样共同制定办法、承担风险并解决婚约阻力”。正文会偏向行动、合作和解决问题，两个人都必须实际参与。\n\n群像变化：可以写“重点描写梁祝的选择怎样影响父母、朋友和周围社会”。正文会给相关人物更多篇幅，让两家的和解也表现为旧观念开始改变。\n\n所以，核心要求决定故事必须抵达哪里，故事重心决定读者主要通过哪条道路抵达那里。"],
    ["自然表达要求", "REQUEST / CLARIFY", "写变化、关键情节和不能发生的内容；不需要提示词格式。", "不需要学习提示词格式。例如可以直接说：“我想让祝英台最终不接受原来的婚约，和梁山伯一起解决两家的阻力。特别想看她在婚礼前主动作出决定，也想看两家真正谈清旧怨。不要把她写成只会等待梁山伯来救的人。”\n\n这里已经包含三类有效信息：想看到的变化、特别想看的关键场面，以及不能发生的人物写法。你不必自行设计完整大纲；信息不足时，Gugu 只会继续询问真正影响方向的问题。没有偏好时也可以回答“交给系统按原著决定”。"]
  ]],
  4: ["确认方向，再建立隐藏航线", "先确认无剧透的方向样本，再安排人物变化、剧情阶段和每项要求的兑现路线。", [
    ["方向样本", "PREVIEW / SAFE", "先确认 Gugu 是否理解了重点和边界。", "方向样本只展示背景、核心变化和承载方式，不直接透露结局。理解有偏差时应在这里修正，再建立长期路线。"],
    ["隐藏大纲", "FUTURE / SEALED", "安排每章功能、事件顺序与长期收束。", "隐藏大纲记录尚未发生的路线。未来内容默认封存；查看时需要二次确认。重排未来会保留已确认章节，但重新规划全部尚未发生内容，并增加等待和 API 成本。"],
    ["航线与兑现", "RELATION / PAYOFF", "查看已发生关系、未来推进和要求兑现轨。", "人物关系默认只显示已经发生的内容；解除封条后可以查看未来关系与剧情阶段。要求兑现轨标出每项要求何时开始生效、发展、改变走向或得到兑现。"]
  ]],
  5: ["选择怎样生成、修改和继续", "可以逐章阅读调整，也可以连续生成整本书；系统会在每章背后准备材料、写作、检查和修复。", [
    ["逐章或整书", "CHAPTER / AUTO ROUTE", "逐章先得到草稿；整书模式会连续写作并确认。", "逐章模式适合边读边改；一键整书适合方向已经稳定的故事。单章生成不只是一次模型调用，还包含材料准备、事实整理、校验和必要修补，因此可能需要较长时间。"],
    ["当前章、未来、重排", "REWRITE / REPLAN", "三种意见范围彼此独立；点击查看操作例子。", "当前章：如果这一章里人物接受得太快，可以写“他不应该立刻同意，先让他尝试自己的解释”。系统会重写眼前草稿，不改变已经确认的旧章节。\n\n未来：如果当前草稿没有问题，但希望后面逐渐增加某种变化，可以写“从下一章开始，让她越来越主动参与家族谈判”。系统会把它加入后续约束，不立即重写当前章。\n\n重排：如果发现尚未发生的后半段方向整体不对，可以写“后半段不要再依靠误会推进，改成两人共同解决两家的旧怨”。系统会保留所有已确认章节，重新规划全部尚未发生内容。\n\n未确认草稿不会进入正式连续性；三种操作不会偷偷改写已经确认的历史。"],
    ["检查与恢复", "VALIDATE / RECOVER", "普通技术和连续性问题由系统尽量自动处理。", "系统会修补格式、事实、人物状态、遗漏事件和结束状态等问题。真正需要用户介入的主要是创作方向选择、权威事实冲突或 API 认证与额度问题；无法收敛时会明确停止，避免重复消耗。"]
  ]],
  6: ["阅读成品并管理本机资料", "收起创作界面安静阅读，调整显示，导出正式章节，并了解项目设置与数据边界。", [
    ["沉浸阅读与导出", "READER / EXPORT", "专注阅读，并将已确认章节导出为整本 TXT。", "日间进入默认白纸，夜间进入默认黑色夜读；仍可调整字体、字号、行宽、纸面和墨色。导出只包含当前故事版本中已经确认的章节，不包含草稿或原著。"],
    ["项目设置", "STYLE / AESTHETIC", "管理 A、B、文章风格和审美观察。", "文章风格 Skill 只影响后续正文表达，不改变剧情事实。审美观察可以只记录、稳定后询问，或在一键生成时用于后续章节；自动使用只做低风险语言调整。"],
    ["API 与本机数据", "LOCAL / COST", "密钥进钥匙串，项目资料长期保存在本机。", "原著、索引、要求、大纲、草稿、正式正文和恢复点都保存在本机；任务需要的片段仍会发送给所选 API。费用还包含阅读、规划、校验和恢复调用，不只计算最终正文字数。"]
  ]]
};
function collapseHelpTopics() {
  $$("[data-help-topic]").forEach((item) => {
    item.setAttribute("aria-expanded", "false");
    item.classList.remove("is-expanded");
    item.querySelector("[data-help-topic-detail]").hidden = true;
  });
}
function selectHelpStep(step) {
  const section = helpSections[step];
  if (!section) return;
  $$("[data-help-step]").forEach((item) => {
    const current = item.dataset.helpStep === String(step);
    item.classList.toggle("is-current", current);
    item.setAttribute("aria-pressed", String(current));
  });
  $$("[data-help-detail]").forEach((item) => {
    const current = item.dataset.helpDetail === String(step);
    item.classList.toggle("is-current", current);
    item.hidden = !current;
  });
  $("[data-help-section-title]").textContent = section[0];
  $("[data-help-section-note]").textContent = section[1];
  $$("[data-help-topic]").forEach((item, index) => {
    const [title, label, summary, detail] = section[2][index];
    item.querySelector("[data-help-topic-title]").textContent = title;
    item.querySelector("[data-help-topic-label]").textContent = label;
    item.querySelector("[data-help-topic-summary]").textContent = summary;
    item.querySelector("[data-help-topic-detail]").textContent = detail;
  });
  collapseHelpTopics();
}
$$('[data-help-step]').forEach((item) => {
  item.addEventListener("click", () => selectHelpStep(item.dataset.helpStep));
  item.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    selectHelpStep(item.dataset.helpStep);
  });
});
$$("[data-help-topic]").forEach((item) => {
  const toggle = () => {
    const wasExpanded = item.getAttribute("aria-expanded") === "true";
    collapseHelpTopics();
    if (wasExpanded) return;
    item.setAttribute("aria-expanded", "true");
    item.classList.add("is-expanded");
    item.querySelector("[data-help-topic-detail]").hidden = false;
  };
  item.addEventListener("click", toggle);
  item.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    toggle();
  });
});
selectHelpStep(1);
const aestheticFeedbackMode = $("#aestheticFeedbackMode");
aestheticFeedbackMode?.closest("header")?.addEventListener("click", (event) => {
  if (event.target === aestheticFeedbackMode) return;
  event.preventDefault();
  aestheticFeedbackMode.focus();
  if (aestheticFeedbackMode.showPicker) aestheticFeedbackMode.showPicker();
  else aestheticFeedbackMode.click();
});
$$('.settings-role').forEach((item) => item.addEventListener("click", (event) => {
  const select = item.querySelector("select");
  if (event.target === select) return;
  event.preventDefault();
  if (select.disabled) {
    showToast(item.querySelector("small")?.textContent || "这项设置当前不可更换");
    return;
  }
  select.focus();
  if (select.showPicker) select.showPicker();
  else select.click();
}));
$("#deleteConfirmInput").addEventListener("input", () => {
  $("#confirmPermanentDelete").disabled = $("#deleteConfirmInput").value.trim() !== state.pendingDeletion?.title;
});
$("#confirmPermanentDelete").addEventListener("click", async () => {
  const pending = state.pendingDeletion;
  if (!pending || $("#deleteConfirmInput").value.trim() !== pending.title) return;
  const button = $("#confirmPermanentDelete");
  button.disabled = true;
  button.textContent = "正在删除…";
  try {
    const path = pending.type === "project" ? `/api/projects/${pending.id}` : `/api/sources/${pending.id}`;
    await api(path, { method: "DELETE", body: { confirmation: pending.title } });
    closeModal("deleteConfirmModal");
    state.pendingDeletion = null;
    await loadLibrary();
    showToast(pending.type === "project" ? "故事版本已彻底删除，原著仍然保留" : "原著及其索引已从原著库删除");
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  } finally {
    button.textContent = "确认彻底删除";
  }
});
$("#wizardPrevious").addEventListener("click", () => { if (state.wizardStep > 1) { state.wizardStep--; renderWizard(); } });
$("#wizardNext").addEventListener("click", async () => {
  try {
    validateWizardStep();
    if (state.wizardStep === 1) {
      const project = await ensureWizardProject();
      const source = selectedReusableSource();
      if (!source || source.status !== "analyzed") {
        $("#newProjectModal").classList.add("is-hidden");
        showToast(source ? "原著切割已复用，完成全书阅读后继续创作约定" : "原著已保存，正在后台建立本地索引");
        await loadLibrary();
        await openProject(project.id);
        return;
      }
      state.wizardStep = 2;
      renderWizard();
    }
    else if (state.wizardStep < 4) { state.wizardStep++; renderWizard(); }
    else await finishWizard();
  } catch (error) { showToast(error.message); }
});
$("#reuseSourceMode").addEventListener("click", () => setSourceMode("existing"));
$("#uploadSourceMode").addEventListener("click", () => setSourceMode("upload"));
$("#sourceFileInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!state.sourceImportFromManager) return acceptFile(file);
  state.sourceImportFromManager = false;
  try { await importSourceFromManager(file); }
  catch (error) { showToast(error.message); }
});
const uploadZone = $(".upload-zone");
["dragenter", "dragover"].forEach((name) => uploadZone.addEventListener(name, (event) => { event.preventDefault(); uploadZone.classList.add("is-dragging"); }));
["dragleave", "drop"].forEach((name) => uploadZone.addEventListener(name, (event) => { event.preventDefault(); uploadZone.classList.remove("is-dragging"); }));
uploadZone.addEventListener("drop", (event) => acceptFile(event.dataTransfer.files[0]));
$$("#lLevel,#dLevel,#wTarget,#inferredAxis,input[name='fidelity']").forEach((element) => element.addEventListener("change", updateConstraintModel));
[$("#directorApi"), $("#writerApi")].forEach((element) => element.addEventListener("change", renderWizardRoleStatus));
$("#wizardChatSend").addEventListener("click", async () => {
  const value = $("#wizardChatInput").value.trim();
  if (!value) return;
  try {
    if (await sendWizardMessage(value, $("#wizardChatSend"), "Gugu 正在确认这条补充")) $("#wizardChatInput").value = "";
  } catch (error) {
    showToast(error.message);
  }
});
$("#clearWizardChat").addEventListener("click", async (event) => {
  if (!$("#premiseText").value.trim()) return showToast("请先写下核心要求，再检查缺项");
  try {
    await sendWizardMessage("请检查目前的创作要求是否仍有会改变人物、事件、时间或关系的关键缺项；如有，请一次列出最多三个问题。", event.currentTarget, "正在检查关键缺项");
  } catch (error) { showToast(error.message); }
});
$("#toggleRawRequirements").addEventListener("click", () => {
  state.rawRequirementsExpanded = !state.rawRequirementsExpanded;
  renderIdeas();
  if (state.rawRequirementsExpanded) $("#premiseText").focus();
});
$$("[data-style-prompt]").forEach((button) => button.addEventListener("click", () => {
  const field = button.dataset.stylePrompt.includes("长篇") ? $("#productTypeInput") : $("#styleTextInput");
  const parts = field.value.split(/[，,]/).map((item) => item.trim()).filter(Boolean);
  if (!parts.includes(button.dataset.stylePrompt)) parts.push(button.dataset.stylePrompt);
  field.value = parts.join("，");
  invalidateRoutePreview();
}));
[$("#productTypeInput"), $("#styleTextInput"), $("#viewpointInput"), $("#endingTypeInput"), $("#premiseText")].forEach((element) => element.addEventListener("input", invalidateRoutePreview));
$("#generateButton").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  beginButtonFeedback(button, "任务正在提交…");
  try {
    await generateChapter();
    finishButtonFeedback(button, "章节任务已提交 ✓", 850, false);
  } catch (error) {
    failButtonFeedback(button);
    showToast(error.message);
  }
});
$("#nextChapterButton").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (button.disabled) return;
  const chapterNumber = Number(button.dataset.nextChapter || 0);
  if (chapterNumber) {
    state.selectedChapter = chapterNumber;
    state.pendingChapterSelection = null;
    state.editing = false;
    renderWorkbench();
    $("#manuscript").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (button.dataset.action === "generate") {
    beginButtonFeedback(button, "任务正在提交…");
    try {
      await generateChapter("");
      finishButtonFeedback(button, "章节任务已提交 ✓", 850, false);
    } catch (error) {
      failButtonFeedback(button);
      showToast(error.message);
    }
  }
});
$("#previousChapterButton").addEventListener("click", (event) => {
  const chapterNumber = Number(event.currentTarget.dataset.previousChapter || 0);
  if (!chapterNumber) return;
  state.selectedChapter = chapterNumber;
  state.pendingChapterSelection = null;
  state.editing = false;
  renderWorkbench();
  $("#manuscript").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("#startBookRunButton").addEventListener("click", async (event) => {
  if (!state.activeProject) return;
  const estimate = state.bookEstimate || buildLocalBookEstimate(state.activeProject, null);
  const estimateText = estimate?.available
    ? `\n\n预计剩余 ${formatDurationRange(estimate.estimated_duration_low_seconds, estimate.estimated_duration_high_seconds)}，整书费用约 ¥${Number(estimate.estimated_total_cost_low_cny || 0).toFixed(2)}～¥${Number(estimate.estimated_total_cost_high_cny || 0).toFixed(2)}。`
    : "";
  if (!confirm(`将从第 ${estimate?.next_chapter || state.activeProject.current_chapter || 1} 章开始，按隐藏路线连续生成剩余章节。${estimateText}\n\n校验警告或接口异常时会自动暂停，是否开始？`)) return;
  const button = event.currentTarget;
  beginButtonFeedback(button, "正在启动整书任务…");
  try {
    const result = await api(`/api/projects/${state.activeProject.id}/book-generation/start`, {
      method: "POST",
      body: { max_cost_cny: 30 }
    });
    state.bookRun = result.run || state.bookRun;
    state.bookRunError = null;
    state.bookEstimate = buildLocalBookEstimate(state.activeProject, state.bookRun);
    state.bookRunCompact = true;
    renderBookRun();
    showToast("整书生成已经开始，可以关闭页面");
    finishButtonFeedback(button, "整书任务已启动 ✓", 850, false);
    scheduleProjectPoll(state.activeProject.id);
  } catch (error) { failButtonFeedback(button); showToast(error.message); }
});
$("#pauseBookRunButton").addEventListener("click", async () => {
  if (!state.activeProject || !state.bookRun) return;
  try {
    await api(`/api/projects/${state.activeProject.id}/book-generation/${state.bookRun.id}/pause`, { method: "POST", body: {} });
    showToast("将在当前安全保存点暂停");
    scheduleProjectPoll(state.activeProject.id);
  } catch (error) { showToast(error.message); }
});
$("#collapseBookRunButton").addEventListener("click", () => {
  state.bookRunCompact = true;
  renderBookRun();
});
$("#expandBookRunButton").addEventListener("click", () => {
  state.bookRunCompact = false;
  renderBookRun();
});
$("#resumeBookRunButton").addEventListener("click", async () => {
  if (!state.activeProject || !state.bookRun) return;
  try {
    const blockedChapter = Number(state.bookRun.last_completed_chapter || 0) + 1;
    const rewriteDraft = state.bookRun.status === "needs_review"
      && state.chapters.some((chapter) => chapter.number === blockedChapter && chapter.status === "draft");
    await api(`/api/projects/${state.activeProject.id}/book-generation/${state.bookRun.id}/resume`, { method: "POST", body: { rewrite_draft: rewriteDraft } });
    showToast(rewriteDraft ? "正在重写当前草稿，完成后会继续整书生成" : "正在从最后一个已确认章节继续");
    scheduleProjectPoll(state.activeProject.id);
  } catch (error) { showToast(error.message); }
});
$("#stopButton").addEventListener("click", async () => {
  const task = state.activeProject.latest_task;
  if (!task) return;
  try { await api(`/api/tasks/${task.id}/cancel`, { method: "POST", body: {} }); scheduleProjectPoll(state.activeProject.id); } catch (error) { showToast(error.message); }
});
$("#confirmButton").addEventListener("click", async () => {
  const chapter = state.chapters.find((item) => item.number === state.selectedChapter);
  if (!chapter || chapter.status !== "draft") return;
  try { await api(`/api/projects/${state.activeProject.id}/chapters/${chapter.number}/confirm`, { method: "POST", body: {} }); state.editing = false; showToast("这一章已写入正式历史"); await refreshProject(); } catch (error) { showToast(error.message); }
});
$("#toggleEditorButton").addEventListener("click", async () => {
  const chapter = state.chapters.find((item) => item.number === state.selectedChapter);
  if (!chapter) return;
  if (chapter.status !== "draft") {
    if (!confirm(`第 ${chapter.number} 章已经成为正式历史。要从它之前创建另一条故事线吗？`)) return;
    try {
      const result = await api(`/api/projects/${state.activeProject.id}/clone`, { method: "POST", body: { through_chapter: Math.max(0, chapter.number - 1), title: `${state.activeProject.title} · 另一条路` } });
      showToast("另一条故事线已经建立，原故事仍然保留");
      return openProject(result.project.id);
    } catch (error) { return showToast(error.message); }
  }
  if (!state.editing) { state.editing = true; return renderWorkbench(); }
  try {
    await api(`/api/projects/${state.activeProject.id}/chapters/${chapter.number}/draft`, { method: "PATCH", body: { body: $("#chapterEditor").value } });
    state.editing = false; await refreshProject(); showToast("手动修改已保存");
  } catch (error) { showToast(error.message); }
});
$("#openCalibrationButton").addEventListener("click", () => openModal("calibrationModal"));
$$('[data-request-scope]').forEach((button) => button.addEventListener("click", () => {
  $("#requestScope").value = button.dataset.requestScope;
  $$('[data-request-scope]').forEach((option) => {
    const active = option === button;
    option.classList.toggle("is-active", active);
    option.setAttribute("aria-pressed", String(active));
  });
}));
$("#sendRequestButton").addEventListener("click", async (event) => {
  const text = $("#chapterRequest").value.trim();
  const scope = $("#requestScope").value;
  if (!text) return showToast("请先写下你的意见");
  const button = event.currentTarget;
  beginButtonFeedback(button, "正在传达…");
  try {
    if (await applyReaderRequest(text, scope)) {
      $("#chapterRequest").value = "";
      finishButtonFeedback(button, scope === "future" ? "要求已记录 ✓" : "修改任务已提交 ✓", 850, scope === "future");
    } else failButtonFeedback(button, "未提交 · 点击重试");
  }
  catch (error) { failButtonFeedback(button); showToast(error.message); }
});
$("#applyCalibrationButton").addEventListener("click", async () => {
  const text = $("#calibrationInput").value.trim();
  const scope = $("input[name='wishScope']:checked").value;
  try {
    if (await applyReaderRequest(text, scope)) {
      closeModal("calibrationModal"); $("#calibrationInput").value = "";
    }
  } catch (error) { showToast(error.message); }
});
$("#projectSettingsButton").addEventListener("click", openProjectSettings);
$("#writerQuickSelect").addEventListener("change", async () => {
  try {
    await api(`/api/projects/${state.activeProject.id}`, { method: "PATCH", body: { writer_profile_id: $("#writerQuickSelect").value } });
    showToast("章节写作者已更新"); await refreshProject();
  } catch (error) { showToast(error.message); }
});
$("#saveProjectSettings").addEventListener("click", async () => {
  try {
    await api(`/api/projects/${state.activeProject.id}`, { method: "PATCH", body: { director_profile_id: $("#directorSettingsSelect").value, writer_profile_id: $("#writerSettingsSelect").value, writing_style_skill: $("#writingStyleSkillInput").value.trim(), aesthetic_observation_enabled: $("#aestheticObservationEnabled").checked, aesthetic_feedback_mode: $("#aestheticFeedbackMode").value } });
    closeModal("projectSettingsModal"); showToast("项目模型设置已保存"); await refreshProject();
  } catch (error) { showToast(error.message); }
});
document.addEventListener("input", (event) => {
  const input = event.target.closest?.("[data-clarification-key]");
  if (input?.matches("textarea")) state.clarificationDrafts.set(input.dataset.clarificationKey, input.value);
});
$("#aestheticObservationEnabled").addEventListener("change", (event) => {
  $("#aestheticFeedbackMode").disabled = !event.target.checked;
});
$("#aestheticGuidanceList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-aesthetic-action]");
  if (!button || !state.activeProject) return;
  try {
    await api(`/api/projects/${state.activeProject.id}/aesthetic-guidance/${button.dataset.aestheticCode}/${button.dataset.aestheticAction}`, { method: "POST", body: {} });
    showToast(button.dataset.aestheticAction === "apply" ? "这条调整将从后续章节开始使用" : "这条观察已保留记录，但不会影响后续写作");
    await refreshProject(state.activeProject.id);
    openProjectSettings();
  } catch (error) { showToast(error.message); }
});
$("#reindexSourceButton").addEventListener("click", async () => {
  try { await api(`/api/projects/${state.activeProject.id}/source/reindex`, { method: "POST", body: {} }); closeModal("projectSettingsModal"); showToast("正在重新检查原著切割"); scheduleProjectPoll(state.activeProject.id); }
  catch (error) { showToast(error.message); }
});
$("#startSourceAnalysisButton").addEventListener("click", async () => {
  try { await api(`/api/projects/${state.activeProject.id}/source/analyze`, { method: "POST", body: { allow_mock: state.activeProject.director_profile_id === "mock" } }); closeModal("projectSettingsModal"); showToast(state.activeProject.director_profile_id === "mock" ? "模拟流程已经开始，不代表真实全书理解" : "全书阅读已经开始"); scheduleProjectPoll(state.activeProject.id); }
  catch (error) { showToast(error.message); }
});
$("#exportButton").addEventListener("click", async () => {
  if (!state.activeProject) return;
  try {
    const response = await fetch(`/api/projects/${state.activeProject.id}/export`);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "整书导出失败");
    }
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${state.activeProject.title}.txt`;
    document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(link.href);
    showToast("整本书已经导出");
  } catch (error) { showToast(error.message); }
});
$("#apiForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const pricing = {
      input: $("#apiInputRate").value,
      cached_input: $("#apiCachedInputRate").value,
      output: $("#apiOutputRate").value
    };
    const result = await api("/api/profiles", { method: "POST", body: { id: $("#apiIdInput").value, name: $("#apiNameInput").value, base_url: $("#apiUrlInput").value, model: $("#apiModelInput").value, timeout: Number($("#apiTimeoutInput").value), pricing, api_key: $("#apiKeyInput").value } });
    state.selectedProfileId = result.profile.id; $("#apiKeyInput").value = ""; await loadLibrary(); fillProfileSelects(); showToast("API 配置已保存在本机");
  } catch (error) { showToast(error.message); }
});
$("#newApiProfile").addEventListener("click", () => { state.selectedProfileId = ""; renderProfiles(); });
$("#testApiButton").addEventListener("click", async () => { try { if (!state.selectedProfileId || state.selectedProfileId === "mock") return showToast("请先保存一个真实 API 配置"); const result = await api(`/api/profiles/${state.selectedProfileId}/test`, { method: "POST", body: {} }); await loadLibrary(); showToast(result.message); } catch (error) { await loadLibrary(); showToast(error.message); } });
function setReaderSettingsOpen(open) {
  $("#readerSettingsPanel").classList.toggle("is-hidden", !open);
  $("#readerSettingsButton").setAttribute("aria-expanded", String(open));
}
$("#readerSettingsButton").addEventListener("click", () => setReaderSettingsOpen($("#readerSettingsPanel").classList.contains("is-hidden")));
$("#closeReaderSettings").addEventListener("click", () => setReaderSettingsOpen(false));
$("#focusReadingButton").addEventListener("click", () => {
  state.readingFocus = !state.readingFocus;
  if (state.readingFocus) {
    syncReaderThemeToApp();
    $("#controlDeck").classList.add("is-collapsed");
  }
  setReaderSettingsOpen(false);
  renderWorkbench();
});
$("#readingThemeSelect").addEventListener("change", (event) => { state.readingTheme = event.target.value; applyReaderPreferences(); rememberReaderPreferences(); });
$("#readingFontSelect").addEventListener("change", (event) => { state.readingFont = event.target.value; applyReaderPreferences(); rememberReaderPreferences(); });
$("#readingToneSelect").addEventListener("change", (event) => { state.readingTone = event.target.value; applyReaderPreferences(); rememberReaderPreferences(); });
$("#readingPaperColor").addEventListener("input", (event) => { state.readingPaperColor = readerColor(event.target.value, "#f8f3e8"); state.readingTheme = "custom"; applyReaderPreferences(); rememberReaderPreferences(); });
$("#readingInkColor").addEventListener("input", (event) => { state.readingInkColor = readerColor(event.target.value, "#27333d"); state.readingTone = "custom"; applyReaderPreferences(); rememberReaderPreferences(); });
$$('[data-reader-adjust]').forEach((button) => button.addEventListener("click", () => {
  const delta = Number(button.dataset.delta || 0);
  if (button.dataset.readerAdjust === "font-size") state.readingFontSize += delta;
  if (button.dataset.readerAdjust === "line-width") state.readingLineWidth += delta;
  applyReaderPreferences();
  rememberReaderPreferences();
}));
$("#restoreReaderContrast").addEventListener("click", () => {
  state.readingTheme = "white";
  state.readingTone = "deep";
  state.readingPaperColor = "#ffffff";
  state.readingInkColor = "#27333d";
  applyReaderPreferences();
  rememberReaderPreferences();
});
$("#toggleControlDeck").addEventListener("click", () => $("#controlDeck").classList.toggle("is-collapsed"));
$("#closeControlDeck").addEventListener("click", () => $("#controlDeck").classList.add("is-collapsed"));
$("#spoilerEntryButton").addEventListener("click", async () => { try { await openStoryMapEntry(); } catch (error) { showToast(error.message); } });
$("#relationshipMapTab").addEventListener("click", async () => {
  try {
    if (state.relationshipMap) renderRelationshipMap();
    else await openStoryMap();
  } catch (error) { showToast(error.message); }
});
$("#outlineMapTab").addEventListener("click", async () => {
  try {
    if (state.outlineUnsealed) renderSpoilerOutline();
    else renderSealedFutureMap();
  } catch (error) { showToast(error.message); }
});
$("#openNextPrepPanel").addEventListener("click", () => {
  $("#controlDeck").classList.remove("is-collapsed");
  $("#nextPrepPanel").classList.toggle("is-hidden");
});
$("#nextPrepToggle").addEventListener("change", async (event) => {
  try {
    await api(`/api/projects/${state.activeProject.id}`, { method: "PATCH", body: { next_prepare_enabled: event.target.checked } });
    if (event.target.checked) $("#nextPrepPanel").classList.remove("is-hidden");
    await refreshProject();
  } catch (error) { event.target.checked = !event.target.checked; showToast(error.message); }
});
$("#doubleChapterToggle").addEventListener("change", async (event) => {
  try {
    await api(`/api/projects/${state.activeProject.id}`, { method: "PATCH", body: { double_chapter_enabled: event.target.checked } });
    await refreshProject();
  } catch (error) { event.target.checked = !event.target.checked; showToast(error.message); }
});
$("#sendNextPrepMessage").addEventListener("click", async (event) => {
  const text = $("#nextPrepInput").value.trim();
  if (!text) return showToast("请先写下想加入下一章的补充要求");
  const button = event.currentTarget;
  beginButtonFeedback(button, "正在传达…");
  try {
    await api(`/api/projects/${state.activeProject.id}/preparations/next/messages`, { method: "POST", body: { text } });
    $("#nextPrepInput").value = "";
    await refreshProject();
    const reenable = !["locked", "generating", "draft_ready"].includes(state.preparation?.status);
    finishButtonFeedback(button, "已传达 ✓", 850, reenable);
  } catch (error) { failButtonFeedback(button); showToast(error.message); }
});
$("#prepareNextButton").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  beginButtonFeedback(button, "正在启动准备任务…");
  try {
    await api(`/api/projects/${state.activeProject.id}/preparations/next/generate`, { method: "POST", body: {} });
    showToast("下一章已经在后台准备");
    finishButtonFeedback(button, "准备任务已提交 ✓", 850, false);
    scheduleProjectPoll(state.activeProject.id);
  } catch (error) { failButtonFeedback(button); showToast(error.message); }
});
$("#modelViewToggle").addEventListener("click", () => {
  state.modelView = state.modelView === "space" ? "flat" : "space";
  $("#cubeScene").classList.toggle("is-hidden", state.modelView === "flat");
  $("#flatModel").classList.toggle("is-hidden", state.modelView !== "flat");
  $("#modelViewToggle").textContent = state.modelView === "space" ? "切换平面视图" : "返回立体视图";
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !state.readingFocus) return;
  state.readingFocus = false;
  renderWorkbench();
});
let orbitPointer = null;
$("#cubeScene").addEventListener("pointerdown", (event) => {
  orbitPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  $("#cubeScene").setPointerCapture(event.pointerId);
});
$("#cubeScene").addEventListener("pointermove", (event) => {
  if (!orbitPointer || orbitPointer.id !== event.pointerId) return;
  state.modelRotation.y += (event.clientX - orbitPointer.x) * 0.008;
  state.modelRotation.x = Math.max(-1.15, Math.min(1.15, state.modelRotation.x + (event.clientY - orbitPointer.y) * 0.008));
  orbitPointer.x = event.clientX; orbitPointer.y = event.clientY;
  renderWireModel(Number($("#lLevel").value), Number($("#dLevel").value), Number($("input[name='fidelity']:checked")?.value || 2));
});
$("#cubeScene").addEventListener("pointerup", () => { orbitPointer = null; });

document.body.classList.add("archive-mode");
let appTheme = "light";
try { appTheme = localStorage.getItem(APP_THEME_STORAGE_KEY) === "night" ? "night" : "light"; } catch {}
applyAppTheme(appTheme);
$("#themeToggleButton").addEventListener("click", () => {
  appTheme = document.body.classList.contains("theme-night") ? "light" : "night";
  applyAppTheme(appTheme);
  try { localStorage.setItem(APP_THEME_STORAGE_KEY, appTheme); } catch {}
});
$("#shutdownGuguButton").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (button.disabled) return;
  if (!confirm("这会停止 Gugu 后台服务。关闭 Safari 页面本身不会停止后台。确认继续吗？")) return;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "停止中…";
  try {
    const result = await api("/api/shutdown-app", { method: "POST", body: {} });
    showToast(result.message || "Gugu 正在停止");
    setTimeout(() => {
      button.textContent = "已停止";
      alert("Gugu 已收到停止指令。可以关闭当前页面；需要再次使用时，重新双击 Gugu 入口即可。");
    }, 350);
  } catch (error) {
    button.disabled = false;
    button.textContent = label;
    showToast(error.message || "停止失败");
  }
});
try {
  state.readingTheme = localStorage.getItem("gugu-reading-theme") || "warm";
  state.readingFont = localStorage.getItem("gugu-reading-font") || "song";
  state.readingTone = localStorage.getItem("gugu-reading-tone") || "deep";
  const oldSize = localStorage.getItem("gugu-reading-size");
  const oldWidth = localStorage.getItem("gugu-reading-width");
  state.readingFontSize = Number(localStorage.getItem("gugu-reading-font-size")) || ({ small: 16, standard: 18, large: 21 }[oldSize] || 18);
  state.readingLineWidth = Number(localStorage.getItem("gugu-reading-line-width")) || (oldWidth === "wide" ? 880 : 700);
  state.readingPaperColor = readerColor(localStorage.getItem("gugu-reading-paper-color"), "#f8f3e8");
  state.readingInkColor = readerColor(localStorage.getItem("gugu-reading-ink-color"), "#27333d");
} catch {}
applyReaderPreferences();
updateConstraintModel();
loadLibrary();
