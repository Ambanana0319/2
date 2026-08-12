(() => {
  const demo = window.PENGU_DEMO;
  const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[char]));

  try {
    Storage.prototype.getItem = () => null;
    Storage.prototype.setItem = () => undefined;
    Storage.prototype.removeItem = () => undefined;
  } catch {}

  window.fetch = (input) => {
    const raw = typeof input === "string" ? input : input?.url || "";
    const url = new URL(raw, window.location.href);
    if (url.pathname === "/api-settings") {
      return Promise.resolve(jsonResponse({ profiles: [], active_profile: "", active_name: "", active_model: "", keyring_available: false }));
    }
    return Promise.resolve(jsonResponse({ ok: true, outlines: [], essays: [], message: "静态演示不执行此操作" }));
  };

  document.addEventListener("DOMContentLoaded", () => {
    document.body.classList.add("showcase-mode");
    let demoInterval = null;
    let demoRunId = 0;
    const demoTimeouts = [];

    const articleReq = document.getElementById("articleReq");
    const persona = document.getElementById("persona");
    const wordLimit = document.getElementById("wordLimit");
    articleReq.value = `${demo.task}\n\n${demo.brief}`;
    persona.value = "清醒的荒诞观察者：先守住事实边界，再从日常语言进入权力、归属与照护问题；允许幽默，但不把动物拟人成虚假知识。";
    wordLimit.value = "2500";
    document.getElementById("wordLimitDisplay").textContent = "2500";
    document.getElementById("statusWords")?.replaceChildren(document.createTextNode("目标字数 2500"));
    document.getElementById("reduceAI").checked = true;
    document.querySelector('input[name="style"][value="essay_free"]')?.click();
    [articleReq, persona].forEach((field) => { field.autocomplete = "off"; });

    const notice = () => {
      const toast = document.getElementById("toast");
      if (!toast) return;
      toast.textContent = "STATIC MODE · 不连接 API，不生成或保存内容";
      toast.classList.add("show");
      toast.classList.remove("hidden");
      clearTimeout(notice.timer);
      notice.timer = setTimeout(() => {
        toast.classList.remove("show");
        toast.classList.add("hidden");
      }, 2600);
    };

    const later = (callback, delay, runId) => {
      const timer = setTimeout(() => { if (runId === demoRunId) callback(); }, delay);
      demoTimeouts.push(timer);
    };

    const clearDemo = () => {
      demoRunId += 1;
      demoTimeouts.splice(0).forEach(clearTimeout);
      clearInterval(demoInterval);
      demoInterval = null;
      document.body.classList.remove("waiting-active");
      document.querySelectorAll(".progress-pengu").forEach((penguin) => penguin.classList.remove("pengu-hold", "pengu-farewell"));
    };

    const renderDemoOutlines = () => {
      const outlineList = document.getElementById("outlineList");
      outlineList.className = "showcase-demo-outline";
      outlineList.innerHTML = demo.outlines.map((outline, index) => `
        <article class="card outline-card ${index === 3 ? "selected" : ""}">
          <div class="outline-seed-head">
            <span class="outline-seed-label">方案 ${String(index + 1).padStart(2, "0")} · ${escapeHtml(outline.tag)} · ${outline.score} 分</span>
            <div class="outline-seed-text">${escapeHtml(outline.title)}</div>
          </div>
          <div class="outline-scroll-body">
            <div class="outline-block"><div class="outline-block-title">核心方向</div><div class="outline-block-text">${escapeHtml(outline.summary)}</div></div>
            <div class="outline-block"><div class="outline-block-title">章节线索</div><div class="outline-block-text">${outline.points.map((point) => `• ${escapeHtml(point)}`).join("<br>")}</div></div>
          </div>
        </article>`).join("");
      [...outlineList.children].forEach((card) => card.addEventListener("click", () => {
        [...outlineList.children].forEach((item) => item.classList.toggle("selected", item === card));
      }));
      document.getElementById("step2").classList.remove("hidden");
      document.getElementById("btnRegenerate").style.display = "inline-block";
      document.getElementById("btnStartEssays").disabled = false;
    };

    const essayContent = () => demo.essay.sections.map((section) => `${section.h}\n\n${section.p}`).join("\n\n");
    const openEssay = (candidate) => {
      const isWinner = candidate.id === 4;
      const modalBody = document.getElementById("modalBody");
      modalBody.innerHTML = `
        <div class="format-preview">
          <h3>本轮第 ${demo.candidates.slice().sort((a, b) => b.score - a.score).findIndex((item) => item.id === candidate.id) + 1} 名 · 评分：${candidate.score}/100</h3>
          <p>${escapeHtml(candidate.note)}</p>
          <ul><li>结构：${candidate.structure}/100</li><li>表达：${candidate.voice}/100</li><li>风险：${escapeHtml(candidate.risk)}</li></ul>
        </div>
        <div class="essay-full-text">
          <h2>${escapeHtml(candidate.title)}</h2>
          ${isWinner ? `<p>${escapeHtml(demo.essay.subtitle)}</p>${demo.essay.sections.map((section) => `<h3>${escapeHtml(section.h)}</h3>${section.p.split(/\n\s*\n/).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}`).join("")}` : `<p>${escapeHtml(candidate.opening)}</p><p>这是该候选的演示摘要。完整成品收录于本轮第 1 名《${escapeHtml(demo.essay.title)}》。</p>`}
        </div>`;
      document.getElementById("essayModal").style.display = "flex";
    };

    const renderDemoResults = () => {
      const ranked = demo.candidates.slice().sort((a, b) => b.score - a.score);
      const container = document.getElementById("essayContainer");
      container.className = "";
      container.innerHTML = ranked.map((candidate, index) => `
        <div class="card essay-card" data-demo-essay="${candidate.id}" style="display:flex;justify-content:space-between;align-items:center;padding:12px 15px;">
          <span style="font-weight:bold;font-size:18px">${escapeHtml(candidate.title)}</span>
          <span class="essay-score">本轮第 ${index + 1} 名 · 评分：${candidate.score}/100</span>
          <button class="copy-btn" type="button" data-demo-copy="${candidate.id}">查看</button>
        </div>`).join("");
      container.querySelectorAll("[data-demo-essay]").forEach((card) => card.addEventListener("click", () => {
        openEssay(demo.candidates.find((candidate) => candidate.id === Number(card.dataset.demoEssay)));
      }));
      container.querySelectorAll("[data-demo-copy]").forEach((button) => button.addEventListener("click", (event) => {
        event.stopPropagation();
        openEssay(demo.candidates.find((candidate) => candidate.id === Number(button.dataset.demoCopy)));
      }));
      document.getElementById("btnDownload").classList.remove("hidden");
      window.PENGU_DEMO_BEST_ESSAY = essayContent();
    };

    const runEssayProgress = (runId = demoRunId) => {
      const step = document.getElementById("step3");
      const fill = document.getElementById("progressFill");
      const label = document.getElementById("progressText");
      const penguin = step.querySelector(".progress-pengu");
      const stages = [[8, "正在准备正文结构"], [20, "正在核对事实边界"], [34, "正在生成 1/6"], [48, "正在生成 2/6"], [61, "正在生成 3/6"], [74, "正在生成 4/6"], [85, "正在生成 5/6"], [92, "正在生成 6/6"], [97, "正在比较评分"], [100, "演示完成 6/6"]];
      let index = 0;
      step.classList.remove("hidden");
      document.body.classList.add("waiting-active");
      fill.style.width = "0%";
      label.textContent = "0/6";
      document.getElementById("essayContainer").replaceChildren();
      document.getElementById("btnDownload").classList.add("hidden");
      step.scrollIntoView({ behavior: "smooth", block: "start" });
      clearInterval(demoInterval);
      demoInterval = setInterval(() => {
        if (runId !== demoRunId) return clearInterval(demoInterval);
        const [percent, text] = stages[index];
        fill.style.width = `${percent}%`;
        label.textContent = text;
        document.getElementById("waitingStatusText").textContent = text;
        if ([34, 48, 61, 74, 85, 92].includes(percent) && typeof window.addPine === "function") window.addPine(percent);
        index += 1;
        if (index < stages.length) return;
        clearInterval(demoInterval);
        demoInterval = null;
        document.body.classList.remove("waiting-active");
        penguin?.classList.add("pengu-hold");
        renderDemoResults();
        document.getElementById("showcasePenguDemo").textContent = "重新播放演示 ↻";
        document.getElementById("btnGenerateOutlines").textContent = "重新播放全程演示";
      }, 700);
    };

    const runFullDemo = () => {
      clearDemo();
      const runId = demoRunId;
      document.body.classList.add("waiting-active");
      document.getElementById("waitingStatusText").textContent = "正在读取写作要求";
      document.querySelector(".waiting-track")?.classList.remove("hidden");
      document.getElementById("btnGenerateOutlines").textContent = "演示运行中…";
      document.getElementById("showcasePenguDemo").textContent = "演示运行中…";
      document.getElementById("step2").classList.add("hidden");
      document.getElementById("step3").classList.add("hidden");
      later(() => { document.getElementById("waitingStatusText").textContent = "正在整理四个大纲入口"; }, 500, runId);
      later(() => {
        renderDemoOutlines();
        document.getElementById("waitingStatusText").textContent = "已选择荒诞路线";
        document.getElementById("step2").scrollIntoView({ behavior: "smooth", block: "start" });
      }, 1300, runId);
      later(() => runEssayProgress(runId), 2500, runId);
    };

    document.getElementById("showcasePenguDemo")?.addEventListener("click", runFullDemo);
    const blockedIds = new Set(["btnGenerateOutlines", "btnStartEssays", "btnRegenerate", "btnDownload", "btnEnglishOutline", "btnEnglishChineseDraft", "btnEnglishDraft", "btnStopPengu", "apiSaveButton", "apiTestButton"]);
    const blockedCalls = /generate|regenerate|startEssays|download|formatDocx|analyzePersona|extractReference|saveApi|testApi|deleteApi|activateApi|shutdown/i;
    document.addEventListener("submit", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      notice();
    }, true);
    document.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      const inline = button.getAttribute("onclick") || "";
      if (!blockedIds.has(button.id) && !blockedCalls.test(inline)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (["btnGenerateOutlines", "btnRegenerate"].includes(button.id)) return runFullDemo();
      if (button.id === "btnStartEssays") {
        clearDemo();
        return runEssayProgress(demoRunId);
      }
      notice();
    }, true);
  });
})();
