const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  projects: [],
  profiles: [],
  activeProject: null,
  chapters: [],
  wishes: [],
  messages: [],
  selectedChapter: null,
  pendingChapterSelection: null,
  renderedChapterKey: null,
  selectedProfileId: "mock",
  sourceFile: null,
  sources: [],
  sourceMode: "upload",
  selectedSourceId: null,
  wizardStep: 1,
  ideas: [],
  draftProjectId: null,
  brief: null,
  preparation: null,
  modelView: "space",
  modelRotation: { x: -0.42, y: 0.68 },
  outlineLayout: "parallel",
  activeTask: null,
  pollTimer: null,
  wizardIntroTimer: null,
  editing: false,
  chapterFilter: "all",
  readingWide: false,
  readingTheme: "warm",
  readingFont: "song",
  bookRun: null,
  bookEstimate: null,
  bookRunCompact: false,
  spoilerOutlineNodes: [],
  pendingDeletion: null
};

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

const api = async (path, options = {}) => {
  const init = { ...options, headers: { ...(options.headers || {}) } };
  if (init.body && typeof init.body !== "string" && !(init.body instanceof ArrayBuffer) && !(init.body instanceof Blob)) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(init.body);
  }
  const response = await fetch(path, init);
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `请求失败 (${response.status})`);
  return data;
};

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.remove("is-hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("is-hidden"), 3000);
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
  ["white", "warm", "night"].forEach((theme) => manuscript.classList.toggle(`theme-${theme}`, state.readingTheme === theme));
  ["song", "kai", "sans"].forEach((font) => manuscript.classList.toggle(`font-${font}`, state.readingFont === font));
  $("#readingThemeSelect").value = state.readingTheme;
  $("#readingFontSelect").value = state.readingFont;
}

function rememberReaderPreferences() {
  try {
    localStorage.setItem("gugu-reading-theme", state.readingTheme);
    localStorage.setItem("gugu-reading-font", state.readingFont);
  } catch {}
}

function openModal(id) { $("#" + id).classList.remove("is-hidden"); }
function closeModal(id) { $("#" + id).classList.add("is-hidden"); }
function formatNumber(value) { return Number(value || 0).toLocaleString("zh-CN"); }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
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
  return "最近任务已完成";
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
function profileById(profileId) { return state.profiles.find((profile) => profile.id === profileId); }
function sourceById(sourceId) { return state.sources.find((source) => source.id === sourceId); }
function sourceReusable(source) { return Boolean(source && ["indexed", "analyzed"].includes(source.status) && (source.status !== "analyzed" || source.analysis_id)); }
function profileReady(profile) { return Boolean(profile && profile.id !== "mock" && profile.has_key && profile.last_test_ok === 1); }
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
    renderProjects();
    renderProfiles();
    renderSourceManager();
  } catch (error) {
    showToast("本地服务尚未启动：请运行 python3 app.py");
    state.projects = [];
    renderProjects(error.message);
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
    $("#featuredProject").innerHTML = `<p class="current-project-label"><span>当前创作</span><em>Current folio</em></p><div class="current-file-title"><span>02</span><h2>${escapeHtml(featured.title)}</h2></div><div class="current-file-info"><p><b>${escapeHtml(featured.source_title || "尚未导入")}</b><span>${formatBookSize(featured.source_characters)} · ${projectSourceState(featured)}</span></p><p><b>L${featured.l_level} · D${featured.d_level} · F${featured.f_level}</b><span>${escapeHtml(statusText[featured.status] || featured.status)}</span></p></div><div class="current-project-meta"><span>${formatNumber(projectWords(featured))} / ${formatNumber(featured.w_target)} 字</span><small>${projectConfirmed(featured)} 章已确认 · ${projectVersionLabel(featured)}</small></div><span class="current-progress"><i style="width:${progress}%"></i></span><div class="current-project-actions"><button class="version-action" data-restart-project="${featured.id}">重新开始</button><button class="version-action is-danger" data-archive-project="${featured.id}">废弃版本</button><button class="current-project-open" data-open-project="${featured.id}">继续阅读 <b>→</b></button></div>`;
  }
  const others = available.filter((item) => !featured || item.id !== featured.id);
  $("#otherProjectsCount").textContent = `${others.length} 个项目`;
  $("#projectGrid").innerHTML = others.map((project, index) => {
    const progress = project.w_target ? Math.min(100, projectWords(project) / project.w_target * 100) : 0;
    return `<article class="library-project-row ${projectConfirmed(project) ? "is-writing" : "is-preparing"}"><div class="library-project-top"><span class="library-project-number">${String(index + 3).padStart(2, "0")}</span><span class="library-project-state">${escapeHtml(statusText[project.status] || project.status)}</span></div><div class="library-project-title"><b>${escapeHtml(project.title)}</b><small>${projectVersionLabel(project)} · ${formatLibraryDate(project.updated_at)}</small></div><div class="library-file-info"><p><b>${escapeHtml(project.source_title || "尚未导入")}</b><span>${projectSourceState(project)}</span></p><p><b>L${project.l_level} · D${project.d_level} · F${project.f_level} · ${formatNumber(project.w_target)} 字</b><span class="${project.latest_task?.status === "failed" ? "is-error" : ""}">${project.latest_task?.status === "failed" ? projectTaskLabel(project) : `${projectConfirmed(project)} 章已确认`}</span></p></div><div class="library-project-progress"><span>${formatNumber(projectWords(project))} / ${formatNumber(project.w_target)} 字</span><i><b style="width:${progress}%"></b></i></div><div class="library-project-bottom"><span class="version-actions-inline"><button data-restart-project="${project.id}">重新开始</button><button data-archive-project="${project.id}">废弃版本</button></span><button class="library-project-open" data-open-project="${project.id}">打开 <b>→</b></button></div></article>`;
  }).join("");
  $("#archiveProjectCount").textContent = `${archived.length} 个版本`;
  const archivedRows = archived.map((project) => `<article class="archive-project-row"><div><span>${projectVersionLabel(project)} · ${formatLibraryDate(project.archived_at)}</span><b>${escapeHtml(project.title)}</b><small>${escapeHtml(project.source_title || "尚未导入原著")} · ${projectConfirmed(project)} 章 · ${formatNumber(projectWords(project))} 字</small></div><div class="archive-row-actions"><button data-restore-project="${project.id}">恢复为当前版本 <b>↗</b></button><button class="is-danger" data-delete-project="${project.id}">彻底删除</button></div></article>`).join("");
  $("#archiveProjectList").innerHTML = `${archivedRows || '<p class="archive-empty">完成、废弃或暂时收起的版本会保存在这里。</p>'}<p class="archive-signature" aria-hidden="true">Archive</p>`;
}

function sourceStatusLabel(source) {
  if (source.status === "analyzed") return "全书认识已完成";
  if (source.status === "indexed") return "分层切割已完成";
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
    const reusableSource = sourceReusable(source);
    return `<article class="source-register-row"><span class="source-register-no">${String(index + 1).padStart(2, "0")}</span><div class="source-register-title"><small>${escapeHtml(source.filename || "TXT")}</small><b>${escapeHtml(source.title)}</b><em>${sourceStatusLabel(source)}</em></div><div class="source-register-metrics"><p><span>原文字数</span><b>${formatNumber(source.char_count)}</b></p><p><span>章节 / 单元</span><b>${formatNumber(source.chapter_count)} / ${formatNumber(source.unit_count)}</b></p><p><span>本机空间</span><b>${formatFileSize(source.disk_bytes || source.byte_size)}</b></p></div><div class="source-register-links"><span>${projects.length ? `${projects.length} 个版本正在使用` : "未被引用"}</span><p>${references}</p></div><div class="source-register-actions"><button type="button" data-new-from-source="${source.id}" ${reusableSource ? "" : "disabled"}>用它新建故事 →</button><button type="button" class="source-delete-action" data-delete-source="${source.id}" ${source.deletable ? "" : "disabled"}>${source.deletable ? "彻底删除原著" : "使用中，不能删除"}</button></div></article>`;
  }).join("") : `<div class="source-register-empty"><span>EMPTY REGISTER</span><b>还没有导入原著</b><p>从这里或“新建项目”导入 TXT，完成后可以在多个故事版本之间复用。</p></div>`;
}

function openSourceManager() {
  clearTimeout(state.pollTimer);
  $("#libraryView").classList.add("is-hidden");
  $("#workbenchView").classList.add("is-hidden");
  $("#newProjectModal").classList.add("is-hidden");
  $("#sourceManagerView").classList.remove("is-hidden");
  renderSourceManager();
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
    const [projectData, chapterData, wishData, bookData] = await Promise.all([
      api(`/api/projects/${projectId}`),
      api(`/api/projects/${projectId}/chapters`),
      api(`/api/projects/${projectId}/wishes`),
      api(`/api/projects/${projectId}/book-generation`).catch(() => ({ run: null }))
    ]);
    state.activeProject = projectData.project;
    state.chapters = chapterData.chapters;
    state.wishes = wishData.wishes || [];
    state.messages = wishData.messages || [];
    state.bookRun = bookData.run || null;
    state.bookEstimate = bookData.estimate || buildLocalBookEstimate(state.activeProject, state.bookRun);
    if (projectChanged) state.bookRunCompact = Boolean(state.bookRun);
    state.preparation = null;
    if (state.activeProject.outline_id && ["writing", "draft"].includes(state.activeProject.status)) {
      try {
        state.preparation = (await api(`/api/projects/${projectId}/preparations/next`)).preparation;
      } catch {}
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
    showToast(error.message);
  }
}

function scheduleProjectPoll(projectId) {
  clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(() => refreshProject(projectId), 850);
}

function renderWorkbench() {
  const project = state.activeProject;
  if (!project) return;
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
  $("#manuscript").classList.toggle("is-wide-reading", state.readingWide);
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
    return { index: isIndexing ? "LOCAL INDEX / 01" : isOutline ? "SEALED ROUTE / 03" : "FULL READING / 02", title: task.message || (isIndexing ? "正在切割原著" : isOutline ? "正在整理隐藏故事路线" : "正在通读全书"), copy: isIndexing ? "原文、章节边界和叙事单元正在本机落盘。关闭页面不会丢失任务。" : isOutline ? "未来内容保持封存。完成结构校验后会自动启用，不需要阅读或确认大纲。" : "故事总控正在分批阅读全部叙事单元，并把剧情结论连接回原文证据。", progress: taskDisplayProgress(task), action: "" };
  }
  if (task?.status === "failed") {
    return { index: "PAUSED", title: "这一步没有完成", copy: task.error || "可以从已经保存的位置重新尝试。", progress: taskDisplayProgress(task), action: `<button class="primary-action" data-setup-action="retry" data-task-id="${task.id}">从断点重试 →</button>` };
  }
  if (project.status === "outline_review") {
    return { index: "SEALED OUTLINE / 03", title: "正在启用旧版故事路线", copy: "这是旧版本留下的待确认状态。系统会完成兼容启用，普通阅读模式不会展示未来走向。", progress: 1, action: `<button class="confirm-action" data-setup-action="confirm-outline">启用并开始阅读 →</button>` };
  }
  if (project.status === "writing" || project.status === "draft") {
    return { index: "NEXT CHAPTER / 04", title: "下一章等待落笔", copy: "总控会只取回这一章需要的原著证据，并把尚未到时点的未来留在封条后。", progress: 1, action: `<button class="primary-action" data-setup-action="generate">生成第 ${project.current_chapter} 章 →</button>` };
  }
  if (project.source_status === "indexed") {
    const director = profileById(project.director_profile_id);
    const ready = profileReady(director);
    return {
      index: "LOCAL INDEX / 01",
      title: "原著切割与全文索引已经完成",
      copy: `${formatNumber(project.source_characters)} 字 · ${formatNumber(project.chapter_count)} 个章节范围 · ${formatNumber(project.unit_count)} 个叙事单元。${ready ? "故事总控连接可用，可以继续全书阅读。" : "请先连接并测试故事总控 API；切割结果已经安全保存，不必重新上传。"}`,
      progress: 1,
      action: ready ? `<button class="primary-action" data-setup-action="analyze">开始全书阅读 →</button><button class="outline-button" data-setup-action="reindex">重新检查切割</button>` : `<button class="primary-action" data-setup-action="open-api">连接故事总控 API →</button><button class="outline-button" data-setup-action="reindex">重新检查切割</button>`
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
  $("#chapterCopy").innerHTML = `<div><span class="setup-index">${info.index}</span><h2>${escapeHtml(info.title)}</h2><p>${escapeHtml(info.copy)}</p><div class="setup-progress"><i><b style="width:${Math.round(info.progress * 100)}%"></b></i><span><em>${Math.round(info.progress * 100)}%</em><em>本机卷宗</em></span></div><div class="setup-actions">${info.action}</div></div>`;
}

function renderDeck(chapter) {
  const task = state.activeProject.latest_task;
  const busy = task && ["queued", "running"].includes(task.status);
  $(".task-caption").textContent = busy ? (task.message || "正在处理") : chapter?.status === "draft" ? "草稿已自动保存。确认之前，后续时间线不会改变。" : "总控只会为下一章打开需要的原著材料。";
  const canWrite = ["writing", "draft"].includes(state.activeProject.status);
  $("#generateButton").disabled = busy || !canWrite;
  $("#generateButton").textContent = chapter?.status === "draft" ? "重新生成本章 ↻" : `生成第 ${state.activeProject.current_chapter} 章 →`;
  $("#stopButton").disabled = !busy;
  $("#openCalibrationButton").disabled = !chapter || chapter.status !== "draft";
  $("#confirmButton").disabled = !chapter || chapter.status !== "draft";
  $("#confirmButton").classList.toggle("is-hidden", !chapter || chapter.status !== "draft");
  const sourceReady = state.activeProject.source_status === "analyzed";
  const sourceIndexed = ["indexed", "analyzed"].includes(state.activeProject.source_status);
  $(".source-note").classList.toggle("is-waiting", !sourceReady);
  $(".source-note").innerHTML = sourceReady ? "<span>◉</span> 原著资料已准备完成<br><small>全局锚定与局部材料均可用</small>" : sourceIndexed ? "<span>◐</span> 本地切割已经完成<br><small>等待故事总控完成全书阅读</small>" : "<span>○</span> 原著资料仍在切割<br><small>完成后再开始全书阅读</small>";
}

function renderBookRun() {
  const run = state.bookRun;
  const estimate = state.bookEstimate || buildLocalBookEstimate(state.activeProject, run);
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
  const labels = {
    queued: "整书任务正在等待开始。",
    running: `正在连续生成；预计剩余 ${formatDurationRange(run?.eta_low_seconds, run?.eta_high_seconds)}。`,
    pause_requested: "正在完成当前安全保存点，然后暂停。",
    stop_requested: "正在完成当前安全保存点，然后停止。",
    paused: "任务已暂停，已完成章节不会重新生成。",
    needs_review: `停在第 ${(run?.last_completed_chapter || 0) + 1} 章：${shortError}${String(run?.last_error || "").length > 92 ? "……" : ""}`,
    failed: `任务未完成：${shortError || "可以从断点继续"}`,
    completed: "整本书已经逐章确认完成，可以执行完整导出。"
  };
  $("#bookRunStatus").textContent = run
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
  $("#bookRunEstimateNote").textContent = estimate?.available
    ? estimate.pricing_configured === false
      ? `${estimateBasis}；当前写作者 API 尚未填写计费单价，因此只显示 Token 与调用量。`
      : `${estimateBasis}${run ? `；目前已用约 ¥${Number(run.estimated_cost_cny || 0).toFixed(2)}` : ""}。实际账单以 API 服务商为准。`
    : "隐藏大纲确定章节数量后，会显示时间、费用和 API 调用区间。";
  $("#bookRunMiniStatus").textContent = run?.status === "needs_review"
    ? `停在第 ${(run.last_completed_chapter || 0) + 1} 章 · 点击处理`
    : totalChapters
      ? `${confirmedChapters}/${totalChapters} 章 · ${ratio}%${active && estimate?.available ? ` · 约余 ${formatDurationRange(estimate.estimated_duration_low_seconds, estimate.estimated_duration_high_seconds)}` : ""}`
      : "等待隐藏大纲";
  $("#startBookRunButton").textContent = `从第 ${estimate?.next_chapter || state.activeProject.current_chapter || 1} 章生成整本书 →`;
  $("#startBookRunButton").classList.toggle("is-hidden", Boolean(run));
  $("#startBookRunButton").disabled = active || !["writing", "draft"].includes(state.activeProject.status) || finished || !estimate?.available;
  $("#pauseBookRunButton").classList.toggle("is-hidden", !active);
  $("#resumeBookRunButton").classList.toggle("is-hidden", !resumable);
}

function renderNextPreparation() {
  const project = state.activeProject;
  if (!project) return;
  const enabled = Boolean(Number(project.next_prepare_enabled));
  $("#nextPrepToggle").checked = enabled;
  const preparation = state.preparation;
  const labels = {
    collecting: "可以加入一条衔接当前章的补充要求",
    locked: "要求已锁定，等待开始",
    generating: "正在后台准备下一章",
    draft_ready: "下一章草稿已经准备好",
    failed: "准备没有完成，可以重试",
    stale: "当前章发生变化，需要重新准备"
  };
  $("#nextPrepStatus").textContent = enabled ? (labels[preparation?.status] || "已开启") : "默认关闭，不会产生额外调用";
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
    if (action === "retry") await api(`/api/tasks/${element.dataset.taskId}/retry`, { method: "POST", body: {} });
    if (action === "analyze") await api(`/api/projects/${projectId}/source/analyze`, { method: "POST", body: {} });
    if (action === "reindex") await api(`/api/projects/${projectId}/source/reindex`, { method: "POST", body: {} });
    if (action === "open-api") { openApiLibrary(state.activeProject?.director_profile_id); return; }
    if (action === "plan") await api(`/api/projects/${projectId}/outline/plan`, { method: "POST", body: {} });
    if (action === "confirm-outline") await api(`/api/projects/${projectId}/outline/confirm`, { method: "POST", body: {} });
    if (action === "continue-brief") { await openWizard(projectId, 2); return; }
    if (action === "generate") await generateChapter();
    await refreshProject(projectId);
  } catch (error) { showToast(error.message); }
}

async function generateChapter(request = $("#chapterRequest").value.trim()) {
  const targetChapter = Number(state.activeProject.current_chapter || 1);
  const result = await api(`/api/projects/${state.activeProject.id}/chapters/generate`, { method: "POST", body: { request } });
  state.pendingChapterSelection = targetChapter;
  state.activeTask = result.task;
  $("#chapterRequest").value = "";
  showToast("章节任务已经开始");
  scheduleProjectPoll(state.activeProject.id);
}

async function openWizard(projectId = null, startStep = 1) {
  state.wizardStep = startStep;
  state.sourceFile = null;
  state.draftProjectId = projectId;
  state.brief = null;
  const reusable = state.sources.filter(sourceReusable);
  state.sourceMode = projectId && reusable.length ? "existing" : "upload";
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
    } catch {}
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
  state.sourceMode = mode === "existing" && reusable.length ? "existing" : "upload";
  if (state.sourceMode === "existing" && !sourceReusable(sourceById(state.selectedSourceId))) {
    state.selectedSourceId = reusable[0]?.id || null;
  }
  $("#existingSourcePanel").classList.toggle("is-hidden", state.sourceMode !== "existing");
  $("#uploadSourcePanel").classList.toggle("is-hidden", state.sourceMode !== "upload");
  $("#reuseSourceMode").classList.toggle("is-active", state.sourceMode === "existing");
  $("#uploadSourceMode").classList.toggle("is-active", state.sourceMode === "upload");
  $("#reuseSourceMode").setAttribute("aria-selected", String(state.sourceMode === "existing"));
  $("#uploadSourceMode").setAttribute("aria-selected", String(state.sourceMode === "upload"));
  $("#reuseSourceMode").disabled = !reusable.length;
  applySelectedSourceModel();
}

function renderSourceLibrary() {
  const reusable = state.sources.filter(sourceReusable);
  $("#sourceLibraryList").innerHTML = reusable.length ? reusable.map((source) => {
    const ready = source.status === "analyzed" && source.analysis_id;
    const status = ready ? "全书资料已完成" : "切割完成";
    const model = ready ? `${source.analysis_profile_name || "故事总控"} · ${source.analysis_model || source.analysis_profile_id}` : "选择 A 端后继续全书阅读";
    return `<button type="button" class="source-library-card ${source.id === state.selectedSourceId ? "is-selected" : ""}" data-existing-source="${source.id}"><span class="source-card-mark" aria-hidden="true">${ready ? "◉" : "◐"}</span><span class="source-card-copy"><b>${escapeHtml(source.title)}</b><small>${formatNumber(source.char_count)} 字 · ${formatNumber(source.chapter_count)} 章 · ${formatNumber(source.unit_count)} 单元</small><em>${escapeHtml(status)} · ${escapeHtml(model)}</em></span><span class="source-card-use">${Number(source.project_count || 0)} 条故事线<br>选择 →</span></button>`;
  }).join("") : `<div class="source-library-empty"><b>还没有可复用的原著</b><span>请切换到“导入新的 TXT”。</span></div>`;
  setSourceMode(state.sourceMode);
}

function applySelectedSourceModel() {
  const source = selectedReusableSource();
  const lockedProfile = source?.analysis_profile_id;
  $("#directorApi").disabled = Boolean(lockedProfile);
  if (lockedProfile && profileById(lockedProfile)) $("#directorApi").value = lockedProfile;
  renderWizardRoleStatus();
}

function renderWizard() {
  $$(".wizard-panel").forEach((panel) => panel.classList.toggle("is-hidden", Number(panel.dataset.step) !== state.wizardStep));
  $$(".wizard-steps > span").forEach((step, index) => step.classList.toggle("is-current", index + 1 === state.wizardStep));
  $("#wizardPrevious").disabled = state.wizardStep === 1;
  $("#wizardNext").textContent = state.wizardStep === 4 ? "确认约定，准备故事 →" : "下一步 →";
  $("#wizardStepText").textContent = `第 ${state.wizardStep} 步，共 4 步`;
  if (state.wizardStep > 1) $("#newProjectModal").classList.add("is-condensed");
  if (state.wizardStep === 2) updateConstraintModel();
}

function validateWizardStep() {
  if (state.wizardStep === 1) {
    if (!$("#projectNameInput").value.trim()) throw new Error("请填写项目名称");
    if (state.sourceMode === "existing") {
      if (!sourceReusable(selectedReusableSource())) throw new Error("请选择一份已经准备好的原著");
    } else {
      if (!$("#sourceTitleInput").value.trim()) throw new Error("请填写原著名称");
      if (!state.sourceFile) throw new Error("请拖入或选择一份 TXT 原著");
      if (!state.sourceFile.name.toLowerCase().endsWith(".txt")) throw new Error("第一版只支持 TXT 原著");
    }
  }
  if (state.wizardStep === 4 && !$("#premiseText").value.trim()) throw new Error("请填写这条故事线的核心要求");
}

async function finishWizard() {
  validateWizardStep();
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
  $("#wizardNext").disabled = true;
  try {
    const project = await ensureWizardProject(payload);
    await api(`/api/projects/${project.id}`, { method: "PATCH", body: payload });
    await api(`/api/projects/${project.id}/creative-brief/confirm`, { method: "POST", body: {
      product_type: $("#productTypeInput").value.trim(),
      style_text: $("#styleTextInput").value.trim(),
      viewpoint_text: $("#viewpointInput").value.trim(),
      ending_type: $("#endingTypeInput").value,
      wish_text: $("#premiseText").value.trim()
    } });
    await api(`/api/projects/${project.id}/outline/plan`, { method: "POST", body: {} });
    $("#newProjectModal").classList.add("is-hidden");
    showToast("创作约定已封存，正在后台整理故事路线");
    await loadLibrary();
    await openProject(project.id);
  } catch (error) {
    showToast(error.message);
  } finally {
    $("#wizardNext").disabled = false;
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
  if (!selectedReusableSource()) {
    const file = state.sourceFile;
    await api(`/api/projects/${project.id}/source`, {
      method: "POST",
      headers: { "X-Filename": encodeURIComponent(file.name), "X-Source-Title": encodeURIComponent($("#sourceTitleInput").value.trim()) },
      body: await file.arrayBuffer()
    });
  }
  return project;
}

function acceptFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".txt")) return showToast("请使用 TXT 原著");
  state.sourceFile = file;
  $("#uploadHint").textContent = `${file.name} · ${formatNumber(file.size)} 字节 · 将完整保存在本机`;
}

function renderIdeas() {
  const messages = state.brief?.messages || [];
  $("#wizardChatHistory").innerHTML = messages.length
    ? messages.map((message) => `<div class="chat-bubble ${message.role}">${escapeHtml(message.content)}</div>`).join("")
    : `<div class="chat-bubble assistant">写好核心要求后，可以让我检查是否还缺少会影响大纲的关键信息。</div>`;
  $("#briefReadiness").textContent = state.brief?.status === "ready" ? "信息已经足够" : state.brief?.status === "collecting" ? "还有信息需要澄清" : "还没有开始询问";
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
  $("#modelRoleNote").textContent = source?.analysis_id ? `这本原著的 A 端已固定为 ${director?.name || source.analysis_profile_name || "原有总控"}；新项目直接复用它的全书认识，B 仍可自由选择。` : localOnly ? "当前可先完成本地切割；真实全书阅读会等 A 端连接可用后再开始。" : "A 在开始全书阅读后固定；B 可以在章节之间更换。";
  $("#modelRoleNote").classList.toggle("is-warning", localOnly || director?.last_test_ok === 0);
}

function renderProfiles() {
  $("#apiList").innerHTML = state.profiles.map((profile) => `<article class="api-profile ${profile.id === state.selectedProfileId ? "is-active" : ""} ${profile.last_test_ok === 1 ? "is-connected" : profile.last_test_ok === 0 ? "is-failed" : ""}" data-profile="${profile.id}"><i aria-hidden="true"></i><span><b>${escapeHtml(profile.name)}</b><small>${escapeHtml(profile.model)} · ${escapeHtml(profileStatus(profile))} · ${profile.pricing_configured ? "计费已设置" : "未设置单价"}</small></span><button type="button">编辑</button></article>`).join("");
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
  $("#projectSourceCard").innerHTML = project.source_id ? `<b>${escapeHtml(project.source_title || "原著")}</b><span>${formatNumber(project.source_characters)} 字 · ${formatNumber(project.chapter_count)} 章 · ${formatNumber(project.unit_count)} 单元</span><small>${project.source_status === "analyzed" ? "全书阅读已完成" : project.source_status === "indexed" ? "本地切割已完成" : "正在准备"}</small>` : `<b>尚未上传原著</b>`;
  $("#reindexSourceButton").disabled = !project.source_id || busy;
  $("#startSourceAnalysisButton").disabled = busy || project.source_status !== "indexed" || !profileReady(profileById(project.director_profile_id));
  $("#openSpoilerFromSettings").disabled = !project.outline_id;
  openModal("projectSettingsModal");
}

function outlineConstraints(node) {
  if (node?.constraints && typeof node.constraints === "object") return node.constraints;
  try { return JSON.parse(node?.constraints_json || "{}"); } catch { return {}; }
}

function renderSpoilerOutline() {
  const nodes = state.spoilerOutlineNodes || [];
  const root = nodes.find((node) => Number(node.level) === 0);
  const routes = nodes.filter((node) => Number(node.level) === 1).sort((a, b) => a.ordinal - b.ordinal);
  const rawChapters = nodes.filter((node) => Number(node.level) === 2);
  const childrenOf = (parentId) => rawChapters.filter((node) => node.parent_id === parentId).sort((a, b) => a.ordinal - b.ordinal);
  const routed = routes.flatMap((route) => childrenOf(route.id));
  const routedIds = new Set(routed.map((node) => node.id));
  const chapters = [...routed, ...rawChapters.filter((node) => !routedIds.has(node.id)).sort((a, b) => a.ordinal - b.ordinal)];
  const positionById = new Map(chapters.map((node, index) => [node.id, index + 1]));
  const positionOf = (node) => positionById.get(node.id) || 1;
  const descendants = (parentId) => chapters.filter((node) => node.parent_id === parentId);
  if (state.outlineLayout === "vertical") {
    const lanes = routes.length ? routes.map((route, index) => `<section class="outline-lane"><header><span>${String(index + 1).padStart(2, "0")}</span><div><b>${escapeHtml(route.title)}</b><p>${escapeHtml(route.summary)}</p></div></header><div class="outline-lane-track">${descendants(route.id).map((node) => `<article class="spoiler-node"><span>${["结局", "因果", "事件", "场景"][node.level] || "节点"}</span><div><b>${escapeHtml(node.title)}</b><p>${escapeHtml(node.summary)}</p></div></article>`).join("") || `<p>这条路线暂时没有更细的公开节点。</p>`}</div></section>`).join("") : chapters.map((node) => `<article class="spoiler-node"><span>事件</span><div><b>${escapeHtml(node.title)}</b><p>${escapeHtml(node.summary)}</p></div></article>`).join("");
    $("#spoilerContent").innerHTML = `${root ? `<div class="outline-destination"><span>DESTINATION</span><b>${escapeHtml(root.title)}</b><p>${escapeHtml(root.summary)}</p></div>` : ""}<div class="outline-routes is-vertical">${lanes}</div>`;
    return;
  }

  const grouped = new Map();
  chapters.forEach((node) => {
    const storyline = String(outlineConstraints(node).storyline || "主时间线").trim() || "主时间线";
    if (!grouped.has(storyline)) grouped.set(storyline, []);
    grouped.get(storyline).push(node);
  });
  if (!grouped.size && routes.length) grouped.set("主时间线", routes);
  const maxOrdinal = Math.max(1, chapters.length);
  const timelineWidth = Math.max(900, maxOrdinal * 168);
  const phaseMarkup = routes.map((route, index) => {
    const children = descendants(route.id);
    const start = children.length ? positionOf(children[0]) : Math.max(1, Number(route.ordinal) || index + 1);
    const nextChildren = routes[index + 1] ? descendants(routes[index + 1].id) : [];
    const nextStart = nextChildren.length ? positionOf(nextChildren[0]) : maxOrdinal + 1;
    const span = Math.max(1, nextStart - start);
    return `<span class="timeline-phase" style="grid-column:${start} / span ${span}"><b>${String(index + 1).padStart(2, "0")}</b>${escapeHtml(route.title)}</span>`;
  }).join("");
  const laneMarkup = [...grouped.entries()].map(([name, events], laneIndex) => `<section class="timeline-lane"><header><span>${String(laneIndex + 1).padStart(2, "0")}</span><b>${escapeHtml(name)}</b></header><div class="timeline-track">${events.map((node) => `<article class="timeline-event" style="grid-column:${positionOf(node)}"><i aria-hidden="true"></i><details><summary>${escapeHtml(node.title)}</summary><p>${escapeHtml(node.summary)}</p></details></article>`).join("")}</div></section>`).join("");
  const first = chapters[0];
  $("#spoilerContent").innerHTML = `<div class="timeline-scroll"><div class="timeline-map" style="--timeline-width:${timelineWidth}px;--timeline-columns:${maxOrdinal}"><aside class="timeline-origin"><span>ORIGIN</span><i aria-hidden="true"></i><b>故事起点</b><p>${escapeHtml(first?.start_state || "从已经确认的创作要求出发")}</p></aside><div class="timeline-field"><div class="timeline-phases">${phaseMarkup}</div><div class="timeline-lanes">${laneMarkup}</div></div><aside class="timeline-end"><span>DESTINATION</span><i aria-hidden="true"></i><b>${escapeHtml(root?.title || "故事终点")}</b><p>${escapeHtml(root?.summary || "")}</p></aside></div></div>`;
}

async function revealSpoilers() {
  if (!state.activeProject.outline_id) return showToast("这条故事线还没有隐藏大纲");
  if (!confirm("这里会展示尚未发生的故事。仍要进入吗？")) return;
  const challenge = await api(`/api/projects/${state.activeProject.id}/outline/spoiler-challenge`, { method: "POST", body: {} });
  if (!confirm(challenge.warning)) return;
  const result = await api(`/api/projects/${state.activeProject.id}/outline/spoiler-unseal`, { method: "POST", body: { token: challenge.token, confirmation: "我确认查看未来剧情" } });
  const nodes = result.outline.nodes || [];
  state.spoilerOutlineNodes = nodes;
  renderSpoilerOutline();
  $$('[data-outline-layout]').forEach((button) => button.classList.toggle("is-active", button.dataset.outlineLayout === state.outlineLayout));
  openModal("spoilerModal");
}

async function applyReaderRequest(text, scope) {
  if (!text) return showToast("请先写下你的意见");
  const projectId = state.activeProject.id;
  await api(`/api/projects/${projectId}/wishes`, { method: "POST", body: { text, scope, chapter_number: state.activeProject.current_chapter } });
  if (scope === "current") {
    await generateChapter(text);
  } else if (scope === "replan") {
    if (!confirm("这会重建全部尚未发生的未来，已确认章节不会改变。继续吗？")) return;
    await api(`/api/projects/${projectId}/outline/replan`, { method: "POST", body: { reason: text } });
    scheduleProjectPoll(projectId);
  } else {
    showToast("要求已经放入后续章节约束");
    await refreshProject(projectId);
  }
}

document.addEventListener("click", async (event) => {
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
  const profile = event.target.closest("[data-profile]");
  if (profile) { state.selectedProfileId = profile.dataset.profile; return renderProfiles(); }
  const closer = event.target.closest("[data-close]");
  if (closer) {
    closeModal(closer.dataset.close);
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
$("#importSourceFromManager").addEventListener("click", () => openWizard());
$("#apiButton").addEventListener("click", () => openApiLibrary(state.activeProject?.director_profile_id));
$("#openApiFromWizard").addEventListener("click", () => openApiLibrary($("#directorApi").value));
$("#helpButton").addEventListener("click", () => openModal("helpModal"));
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
$("#sourceFileInput").addEventListener("change", (event) => acceptFile(event.target.files[0]));
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
    const project = await ensureWizardProject();
    state.brief = (await api(`/api/projects/${project.id}/creative-brief/messages`, { method: "POST", body: {
      text: value,
      product_type: $("#productTypeInput").value.trim(),
      style_text: $("#styleTextInput").value.trim(),
      viewpoint_text: $("#viewpointInput").value.trim(),
      ending_type: $("#endingTypeInput").value,
      wish_text: $("#premiseText").value.trim()
    } })).brief;
    $("#wizardChatInput").value = "";
    renderIdeas();
  } catch (error) { showToast(error.message); }
});
$("#clearWizardChat").addEventListener("click", () => { $("#briefReadiness").textContent = "将按目前内容继续"; showToast("不会继续追问；确认后按目前内容建立故事路线"); });
$$("[data-style-prompt]").forEach((button) => button.addEventListener("click", () => {
  const field = button.dataset.stylePrompt.includes("长篇") ? $("#productTypeInput") : $("#styleTextInput");
  const parts = field.value.split(/[，,]/).map((item) => item.trim()).filter(Boolean);
  if (!parts.includes(button.dataset.stylePrompt)) parts.push(button.dataset.stylePrompt);
  field.value = parts.join("，");
}));
$("#generateButton").addEventListener("click", async () => { try { await generateChapter(); } catch (error) { showToast(error.message); } });
$("#startBookRunButton").addEventListener("click", async () => {
  if (!state.activeProject) return;
  const estimate = state.bookEstimate || buildLocalBookEstimate(state.activeProject, null);
  const estimateText = estimate?.available
    ? `\n\n预计剩余 ${formatDurationRange(estimate.estimated_duration_low_seconds, estimate.estimated_duration_high_seconds)}，整书费用约 ¥${Number(estimate.estimated_total_cost_low_cny || 0).toFixed(2)}～¥${Number(estimate.estimated_total_cost_high_cny || 0).toFixed(2)}。`
    : "";
  if (!confirm(`将从第 ${estimate?.next_chapter || state.activeProject.current_chapter || 1} 章开始，按隐藏路线连续生成剩余章节。${estimateText}\n\n校验警告或接口异常时会自动暂停，是否开始？`)) return;
  try {
    const result = await api(`/api/projects/${state.activeProject.id}/book-generation/start`, {
      method: "POST",
      body: { max_cost_cny: 30 }
    });
    state.bookRun = result.run || state.bookRun;
    state.bookEstimate = buildLocalBookEstimate(state.activeProject, state.bookRun);
    state.bookRunCompact = true;
    renderBookRun();
    showToast("整书生成已经开始，可以关闭页面");
    scheduleProjectPoll(state.activeProject.id);
  } catch (error) { showToast(error.message); }
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
    await api(`/api/projects/${state.activeProject.id}/book-generation/${state.bookRun.id}/resume`, { method: "POST", body: {} });
    showToast("正在从最后一个已确认章节继续");
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
$("#sendRequestButton").addEventListener("click", async () => {
  const text = $("#chapterRequest").value.trim();
  const scope = $("#requestScope").value;
  try { await applyReaderRequest(text, scope); $("#chapterRequest").value = ""; }
  catch (error) { showToast(error.message); }
});
$("#applyCalibrationButton").addEventListener("click", async () => {
  const text = $("#calibrationInput").value.trim();
  const scope = $("input[name='wishScope']:checked").value;
  try {
    await applyReaderRequest(text, scope);
    closeModal("calibrationModal"); $("#calibrationInput").value = "";
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
    await api(`/api/projects/${state.activeProject.id}`, { method: "PATCH", body: { director_profile_id: $("#directorSettingsSelect").value, writer_profile_id: $("#writerSettingsSelect").value } });
    closeModal("projectSettingsModal"); showToast("项目模型设置已保存"); await refreshProject();
  } catch (error) { showToast(error.message); }
});
$("#reindexSourceButton").addEventListener("click", async () => {
  try { await api(`/api/projects/${state.activeProject.id}/source/reindex`, { method: "POST", body: {} }); closeModal("projectSettingsModal"); showToast("正在重新检查原著切割"); scheduleProjectPoll(state.activeProject.id); }
  catch (error) { showToast(error.message); }
});
$("#startSourceAnalysisButton").addEventListener("click", async () => {
  try { await api(`/api/projects/${state.activeProject.id}/source/analyze`, { method: "POST", body: {} }); closeModal("projectSettingsModal"); showToast("全书阅读已经开始"); scheduleProjectPoll(state.activeProject.id); }
  catch (error) { showToast(error.message); }
});
$("#openSpoilerFromSettings").addEventListener("click", async () => { closeModal("projectSettingsModal"); try { await revealSpoilers(); } catch (error) { showToast(error.message); } });
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
$$("[data-font]").forEach((button) => button.addEventListener("click", () => {
  const copy = $("#chapterCopy");
  const size = parseFloat(getComputedStyle(copy).fontSize);
  copy.style.fontSize = `${Math.max(14, Math.min(24, size + (button.dataset.font === "plus" ? 1 : -1)))}px`;
}));
$("#readingWidthButton").addEventListener("click", () => { state.readingWide = !state.readingWide; $("#manuscript").classList.toggle("is-wide-reading", state.readingWide); });
$("#readingThemeSelect").addEventListener("change", (event) => { state.readingTheme = event.target.value; applyReaderPreferences(); rememberReaderPreferences(); });
$("#readingFontSelect").addEventListener("change", (event) => { state.readingFont = event.target.value; applyReaderPreferences(); rememberReaderPreferences(); });
$("#toggleControlDeck").addEventListener("click", () => $("#controlDeck").classList.toggle("is-collapsed"));
$("#closeControlDeck").addEventListener("click", () => $("#controlDeck").classList.add("is-collapsed"));
$("#spoilerEntryButton").addEventListener("click", async () => { try { await revealSpoilers(); } catch (error) { showToast(error.message); } });
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
$("#sendNextPrepMessage").addEventListener("click", async () => {
  const text = $("#nextPrepInput").value.trim();
  if (!text) return showToast("请先写下想加入下一章的补充要求");
  try {
    await api(`/api/projects/${state.activeProject.id}/preparations/next/messages`, { method: "POST", body: { text } });
    $("#nextPrepInput").value = "";
    await refreshProject();
  } catch (error) { showToast(error.message); }
});
$("#prepareNextButton").addEventListener("click", async () => {
  try {
    await api(`/api/projects/${state.activeProject.id}/preparations/next/generate`, { method: "POST", body: {} });
    showToast("下一章已经在后台准备");
    scheduleProjectPoll(state.activeProject.id);
  } catch (error) { showToast(error.message); }
});
$("#modelViewToggle").addEventListener("click", () => {
  state.modelView = state.modelView === "space" ? "flat" : "space";
  $("#cubeScene").classList.toggle("is-hidden", state.modelView === "flat");
  $("#flatModel").classList.toggle("is-hidden", state.modelView !== "flat");
  $("#modelViewToggle").textContent = state.modelView === "space" ? "切换平面视图" : "返回立体视图";
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
try {
  state.readingTheme = localStorage.getItem("gugu-reading-theme") || "warm";
  state.readingFont = localStorage.getItem("gugu-reading-font") || "song";
} catch {}
applyReaderPreferences();
updateConstraintModel();
loadLibrary();
