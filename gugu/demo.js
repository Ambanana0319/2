(() => {
  const demo = window.GUGU_DEMO;
  const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
  const wordCount = (text) => String(text || "").replace(/\s/g, "").length;
  const totalWords = demo.chapters.reduce((sum, chapter) => sum + wordCount(chapter.body), 0);
  const now = "2026-08-13T09:00:00+08:00";
  const project = {
    id: "demo-sea",
    title: demo.project.title,
    source_id: "demo-source",
    source_title: demo.project.source,
    source_status: "analyzed",
    source_characters: 15000,
    chapter_count: 5,
    unit_count: 24,
    l_level: 3,
    d_level: 3,
    f_level: 1,
    w_target: totalWords,
    chapter_word_target: 2800,
    confirmed_chapters: { count: 5, words: totalWords },
    status: "writing",
    current_chapter: 6,
    outline_id: "demo-outline",
    premise_confirmed: true,
    director_profile_id: "mock",
    writer_profile_id: "mock",
    director_locked: true,
    is_active: 1,
    next_prepare_enabled: 0,
    updated_at: now,
    latest_task: null
  };
  const chapters = demo.chapters.map((chapter) => ({
    id: `demo-chapter-${chapter.number}`,
    number: chapter.number,
    title: chapter.title,
    body: chapter.body,
    status: "confirmed",
    word_count: wordCount(chapter.body),
    updated_at: now
  }));
  const outlineNodes = [
    {
      id: "route-root",
      level: 0,
      ordinal: 0,
      title: "白礁潮庭",
      summary: "海女没有以杀戮结束旧债，而是让海族、陆地王国与沿岸民众共同签下可执行的和平盟约。"
    },
    ...demo.route.flatMap((stage, index) => {
      const routeId = `route-${stage.n}`;
      return [
        {
          id: routeId,
          parent_id: "route-root",
          level: 1,
          ordinal: index + 1,
          title: stage.title,
          summary: stage.text
        },
        {
          id: `route-event-${stage.n}`,
          parent_id: routeId,
          level: 2,
          ordinal: index + 1,
          title: demo.chapters[index].title,
          summary: demo.chapters[index].summary,
          start_state: index === 0 ? "海女在婚宴之夜接过匕首，必须决定王子的生死。" : demo.route[index - 1].text,
          constraints: { storyline: index < 3 ? "海女与黑潮" : "海陆联合航线" }
        }
      ];
    })
  ];
  const source = {
    id: "demo-source",
    title: "海滨旧闻",
    filename: "海滨旧闻.txt",
    status: "analyzed",
    analysis_id: "demo-analysis",
    char_count: 15000,
    chapter_count: 5,
    unit_count: 24,
    disk_bytes: 48640,
    deletable: false,
    projects: [{ id: project.id, title: project.title }]
  };

  try {
    Storage.prototype.getItem = () => null;
    Storage.prototype.setItem = () => undefined;
    Storage.prototype.removeItem = () => undefined;
  } catch {}

  window.fetch = (input, init = {}) => {
    const raw = typeof input === "string" ? input : input?.url || "";
    const url = new URL(raw, window.location.href);
    const path = url.pathname;
    const method = String(init.method || "GET").toUpperCase();
    if (!path.startsWith("/api/")) return Promise.reject(new Error("静态演示不访问外部网络"));

    if (method === "GET" && path === "/api/projects") return Promise.resolve(jsonResponse({ projects: [project] }));
    if (method === "GET" && path === "/api/profiles") {
      return Promise.resolve(jsonResponse({ profiles: [{ id: "mock", name: "静态演示", model: "DEMO", has_key: false, last_test_ok: null, pricing_configured: false }] }));
    }
    if (method === "GET" && path === "/api/sources") return Promise.resolve(jsonResponse({ sources: [source] }));
    if (method === "GET" && path === `/api/projects/${project.id}`) return Promise.resolve(jsonResponse({ project }));
    if (method === "GET" && path === `/api/projects/${project.id}/chapters`) return Promise.resolve(jsonResponse({ chapters }));
    if (method === "GET" && path === `/api/projects/${project.id}/wishes`) {
      return Promise.resolve(jsonResponse({
        wishes: demo.requirements.map((text, index) => ({ id: `wish-${index + 1}`, text, scope: "future" })),
        messages: [{ role: "assistant", content: "五章演示正文已经完成；未来路线只在剧透确认后展示。", metadata_json: "{}" }]
      }));
    }
    if (method === "GET" && path === `/api/projects/${project.id}/book-generation`) {
      return Promise.resolve(jsonResponse({
        run: { id: "demo-run", status: "completed", end_chapter: 5, book_confirmed_chapters: 5, completed_chapters: 5, estimated_cost_cny: 0 },
        estimate: { available: true, total_chapters: 5, remaining_chapters: 0, next_chapter: 6, pricing_configured: true, estimated_duration_low_seconds: 0, estimated_duration_high_seconds: 0, estimated_total_cost_low_cny: 0, estimated_total_cost_high_cny: 0, estimated_api_calls_low: 0, estimated_api_calls_high: 0 }
      }));
    }
    if (method === "GET" && path === `/api/projects/${project.id}/preparations/next`) return Promise.resolve(jsonResponse({ preparation: null }));
    if (method === "GET" && path === `/api/projects/${project.id}/creative-brief`) {
      return Promise.resolve(jsonResponse({ brief: { title: demo.project.title, premise: demo.project.subtitle, requirements: demo.requirements } }));
    }
    if (method === "GET" && path === `/api/projects/${project.id}/export`) {
      const manuscript = chapters.map((chapter) => `第${chapter.number}章 ${chapter.title}\n\n${chapter.body}`).join("\n\n");
      return Promise.resolve(new Response(manuscript, { status: 200, headers: { "content-type": "text/plain;charset=utf-8" } }));
    }
    if (method === "POST" && path === `/api/projects/${project.id}/outline/spoiler-challenge`) {
      return Promise.resolve(jsonResponse({ token: "demo-spoiler", warning: "第二次确认：以下航线包含五章完整走向。仍要查看吗？" }));
    }
    if (method === "POST" && path === `/api/projects/${project.id}/outline/spoiler-unseal`) {
      return Promise.resolve(jsonResponse({ outline: { nodes: outlineNodes } }));
    }
    return Promise.resolve(jsonResponse({ ok: true, message: "静态演示不执行此操作" }));
  };

  document.addEventListener("DOMContentLoaded", () => {
    const notice = () => {
      const toast = document.getElementById("toast");
      if (!toast) return;
      toast.textContent = "静态演示：不会连接 API、上传文件或保存内容";
      toast.classList.remove("is-hidden");
      clearTimeout(notice.timer);
      notice.timer = setTimeout(() => toast.classList.add("is-hidden"), 2600);
    };
    const openDemoProject = () => {
      const openButton = document.querySelector(`[data-open-project="${project.id}"]`);
      if (openButton) openButton.click();
      else setTimeout(openDemoProject, 80);
    };

    let routeUnsealed = false;
    let sealStep = 1;
    const relationColors = { family: "#bf9a24", enemy: "#a9523f", romance: "#bd725d", ally: "#6d91a8", mentor: "#8d7b42", hierarchy: "#2f465f", other: "#3f6680" };
    const renderSeal = () => {
      document.getElementById("storyMapEyebrow").textContent = "SEALED ROUTE · 尚未发生的内容";
      document.getElementById("spoilerTitle").textContent = "航线图封条";
      document.getElementById("relationshipMapTab").classList.remove("is-active");
      document.getElementById("outlineMapTab").classList.remove("is-active");
      document.getElementById("outlineLayoutSwitch").classList.add("is-hidden");
      const second = sealStep === 2;
      document.getElementById("spoilerContent").innerHTML = `<section class="spoiler-seal ${second ? "is-second" : ""}"><div class="spoiler-seal-mark"><i></i><span>${second ? "02" : "01"}</span><i></i></div><p>${second ? "第二次确认" : "第一次确认"}</p><h3>${second ? "确认查看整条未来航线" : "这里包含还没有读到的关系与结局"}</h3><div class="spoiler-seal-copy">${second ? "解除后会显示五章剧情航线、人物关系变化和最终和平协议。" : "航线图包含人物关系的未来变化、隐藏事件阶段和故事结局；解除封条后才会进入完整航线图。"}</div><footer><button type="button" data-demo-spoiler="confirmed">只看已发生</button><button class="spoiler-unseal-action" type="button" data-demo-spoiler="${second ? "unseal" : "continue"}">${second ? "确认解除封条" : "继续确认"} <b>→</b></button></footer></section>`;
    };
    const relationLabel = (type) => ({ family: "亲缘", enemy: "敌对", romance: "婚约 / 伴侣", ally: "盟友", mentor: "引路 / 同盟", hierarchy: "权力 / 主从" }[type] || "关系");
    const renderRelationships = () => {
      const width = 860;
      const height = 470;
      const nodeById = new Map(demo.characters.map((node) => [node.id, node]));
      const edges = demo.relations;
      const lines = edges.map((edge, index) => {
        const from = nodeById.get(edge.from);
        const to = nodeById.get(edge.to);
        if (!from || !to) return "";
        const dash = edge.start > 5 ? "6 6" : "";
        return `<g class="relationship-edge type-${edge.type}" data-demo-edge="${index}"><line class="edge-hit" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"></line><line class="edge-line" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" ${dash ? `stroke-dasharray="${dash}"` : ""}></line></g>`;
      }).join("");
      const nodes = demo.characters.map((node) => `<g class="relationship-node color-${node.color} ${node.core ? "" : "is-peripheral"}" data-demo-node="${node.id}" transform="translate(${node.x} ${node.y})"><circle r="${node.core ? 28 : 22}"></circle><circle class="node-orbit" r="${node.core ? 37 : 29}"></circle><text text-anchor="middle" y="4">${escapeHtml(node.name)}</text></g>`).join("");
      document.getElementById("storyMapEyebrow").textContent = routeUnsealed ? "ROUTE MAP · 已解锁完整航线" : "ROUTE MAP · 已发生的人物关系";
      document.getElementById("spoilerTitle").textContent = "航线图";
      document.getElementById("relationshipMapTab").classList.add("is-active");
      document.getElementById("outlineMapTab").classList.remove("is-active");
      document.getElementById("outlineLayoutSwitch").classList.add("is-hidden");
      const legend = [...new Set(edges.map((edge) => edge.type))].map((type) => `<span><i style="border-color:${relationColors[type] || relationColors.other}"></i>${relationLabel(type)}</span>`).join("");
      document.getElementById("spoilerContent").innerHTML = `<section class="relationship-map-shell"><header><span>CORE CAST / ROUTE LINKS</span><p>9 位人物 · 11 条关系 · 五章演示全书</p></header><div class="relationship-legend">${legend}<small>点击人物或关系线查看说明</small></div><div class="relationship-stage"><div class="relationship-graph-wrap"><svg class="relationship-graph" viewBox="0 0 ${width} ${height}" aria-label="海的女儿新编人物关系图">${lines}${nodes}</svg></div><aside class="relationship-inspector" id="demoRelationshipInspector"><section class="relationship-detail is-hint"><span>HOW TO READ</span><b>人物关系已经接回正式航线图</b><p>有色实线表示五章中已经成立的关系。未来剧情仍由封条控制；解除后可切换到完整剧情航线。</p></section></aside></div></section>`;
    };
    const renderRoute = () => {
      if (!routeUnsealed) {
        sealStep = 1;
        renderSeal();
        return;
      }
      document.getElementById("storyMapEyebrow").textContent = "ADVANCED ROUTE · 已解除剧透封条";
      document.getElementById("spoilerTitle").textContent = "未来航线";
      document.getElementById("relationshipMapTab").classList.remove("is-active");
      document.getElementById("outlineMapTab").classList.add("is-active");
      document.getElementById("outlineLayoutSwitch").classList.remove("is-hidden");
      const phases = demo.route.map((stage, index) => `<span class="timeline-phase" style="grid-column:${index + 1}"><b>${String(stage.n).padStart(2, "0")}</b>${escapeHtml(stage.title)}</span>`).join("");
      const events = demo.chapters.map((chapter, index) => `<article class="timeline-event" style="grid-column:${index + 1}"><i aria-hidden="true"></i><details open><summary>${escapeHtml(chapter.title)}</summary><p>${escapeHtml(chapter.summary)}</p></details></article>`).join("");
      document.getElementById("spoilerContent").innerHTML = `<div class="timeline-scroll"><div class="timeline-map" style="--timeline-width:900px;--timeline-columns:5"><aside class="timeline-origin"><span>ORIGIN</span><i aria-hidden="true"></i><b>月下受刃</b><p>海女接过匕首，却拒绝以王子的死亡换回自己。</p></aside><div class="timeline-field"><div class="timeline-phases">${phases}</div><div class="timeline-lanes"><section class="timeline-lane"><header><span>01</span><b>海女与黑潮</b></header><div class="timeline-track">${events}</div></section></div></div><aside class="timeline-end"><span>DESTINATION</span><i aria-hidden="true"></i><b>白礁潮庭</b><p>海陆与女巫以公开盟约终止黑潮和报复。</p></aside></div></div>`;
    };
    const openStoryMap = () => {
      sealStep = 1;
      routeUnsealed = false;
      document.getElementById("spoilerModal").classList.remove("is-hidden");
      renderSeal();
    };

    document.querySelectorAll("[data-showcase-view]").forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.showcaseView === "reader") openDemoProject();
      if (button.dataset.showcaseView === "library") document.getElementById("brandButton")?.click();
      if (button.dataset.showcaseView === "create") document.getElementById("newProjectButton")?.click();
    }));

    document.getElementById("spoilerEntryButton")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      openStoryMap();
    }, true);
    document.getElementById("openSpoilerFromSettings")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      openStoryMap();
    }, true);
    document.getElementById("relationshipMapTab")?.addEventListener("click", renderRelationships);
    document.getElementById("outlineMapTab")?.addEventListener("click", renderRoute);
    document.getElementById("spoilerContent")?.addEventListener("click", (event) => {
      const gate = event.target.closest("[data-demo-spoiler]");
      if (gate) {
        if (gate.dataset.demoSpoiler === "confirmed") return renderRelationships();
        if (gate.dataset.demoSpoiler === "continue") { sealStep = 2; return renderSeal(); }
        if (gate.dataset.demoSpoiler === "unseal") { routeUnsealed = true; return renderRoute(); }
      }
      const nodeTarget = event.target.closest("[data-demo-node]");
      if (nodeTarget) {
        const node = nodeByIdForDemo(nodeTarget.dataset.demoNode);
        const related = demo.relations.filter((edge) => edge.from === node.id || edge.to === node.id);
        document.getElementById("demoRelationshipInspector").innerHTML = `<section class="relationship-character-card"><header><span>CHARACTER</span><b>${escapeHtml(node.name)}</b><small>${escapeHtml(node.role)}</small></header><div><article><small>人物轨迹</small><p>${node.states.map(escapeHtml).join(" → ")}</p></article><article><small>已确认关系</small><ul class="character-relations">${related.map((edge) => { const other = nodeByIdForDemo(edge.from === node.id ? edge.to : edge.from); return `<li><b>${escapeHtml(other.name)}</b><span>${escapeHtml(edge.label)}</span><p>${escapeHtml(edge.summary)}</p></li>`; }).join("")}</ul></article></div></section>`;
        return;
      }
      const edgeTarget = event.target.closest("[data-demo-edge]");
      if (edgeTarget) {
        const edge = demo.relations[Number(edgeTarget.dataset.demoEdge)];
        const from = nodeByIdForDemo(edge.from);
        const to = nodeByIdForDemo(edge.to);
        document.getElementById("demoRelationshipInspector").innerHTML = `<section class="relationship-detail"><span>RELATIONSHIP<small>${escapeHtml(edge.label)}</small></span><b>${escapeHtml(from.name)} ↔ ${escapeHtml(to.name)}</b><p>${escapeHtml(edge.summary)}</p></section>`;
      }
    });
    const nodeByIdForDemo = (id) => demo.characters.find((node) => node.id === id);

    const blocked = new Set([
      "apiForm", "wizardChatSend", "sendRequestButton", "applyCalibrationButton", "generateButton",
      "startBookRunButton", "pauseBookRunButton", "resumeBookRunButton", "stopButton", "confirmButton",
      "saveProjectSettings", "reindexSourceButton", "startSourceAnalysisButton", "exportButton",
      "testApiButton", "sendNextPrepMessage", "prepareNextButton"
    ]);
    document.addEventListener("submit", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      notice();
    }, true);
    document.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button || !blocked.has(button.id)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      notice();
    }, true);
  });
})();
