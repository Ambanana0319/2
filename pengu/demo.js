(() => {
  const demo = window.PENGU_DEMO;
  const json = (value, status = 200) => new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
  const ranks = new Map([...demo.candidates].sort((a, b) => b.score - a.score).map((item, index) => [item.id, index + 1]));
  const fullEssay = demo.essay.sections.map((section) => `${section.h}\n\n${section.p}`).join("\n\n");
  const outlinePayload = demo.outlines.map((outline) => ({
    title: outline.title,
    content: outline.points.map((point, index) => `【第${index + 1}节】${point}`).join("\n"),
    difference: outline.summary
  }));
  const draft = (candidate) => ({
    id: candidate.id,
    title: candidate.title,
    content: candidate.id === 4 ? fullEssay : `${candidate.opening}\n\n这是静态演示候选，统一评分完成后会显示完整评价。`,
    status: "generated",
    score: null,
    rank: null
  });
  const reviewed = (candidate) => ({
    ...draft(candidate),
    content: candidate.id === 4 ? fullEssay : `${candidate.opening}\n\n${candidate.note}\n\n这是该候选的演示摘要；完整成品收录于本轮第一名《${demo.essay.title}》。`,
    score: candidate.score,
    rank: ranks.get(candidate.id),
    review: {
      score_label: "模拟统一评分",
      summary: candidate.note,
      breakdown: {
        "结构": `${candidate.structure}/100`,
        "表达": `${candidate.voice}/100`,
        "事实边界": candidate.risk === "低" ? "稳健" : "需留意"
      },
      issues: candidate.risk === "低" ? [] : [candidate.risk === "中" ? "个别判断需避免推得过满" : candidate.risk],
      citation_warnings: [],
      citation_errors: []
    }
  });

  function essayStream() {
    const events = [];
    demo.candidates.forEach((candidate, index) => events.push({ stage: "generating", progress: index + 1, total: 6, draft: draft(candidate) }));
    events.push({ stage: "scoring" });
    [...demo.candidates].sort((a, b) => b.score - a.score).forEach((candidate, index) => events.push({ stage: "reviewed", progress: index + 1, total: 6, essay: reviewed(candidate) }));
    events.push({ done: true });
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
      start(controller) {
        let index = 0;
        const emit = () => {
          if (index >= events.length) {
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(events[index])}\n`));
          index += 1;
          setTimeout(emit, index === 7 ? 500 : 180);
        };
        setTimeout(emit, 250);
      }
    }), { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" } });
  }

  window.fetch = async (input, init = {}) => {
    const raw = typeof input === "string" ? input : input?.url || "";
    const url = new URL(raw, window.location.href);
    if (url.pathname === "/api-settings") return json({ profiles: [], active_profile: "", active_name: "静态演示", active_model: "DEMO", keyring_available: false });
    if (url.pathname === "/generate-outlines") return json(outlinePayload);
    if (url.pathname === "/generate-essays") return essayStream();
    if (url.pathname === "/shutdown-app") return json({ ok: true, message: "静态演示无需关闭后台程序" });
    return json({ ok: false, error: "静态演示不会调用 API 或修改数据" }, 400);
  };

  window.addEventListener("load", () => setTimeout(() => {
    const articleReq = document.getElementById("articleReq");
    const persona = document.getElementById("persona");
    const wordLimit = document.getElementById("wordLimit");
    if (articleReq) articleReq.value = `${demo.task}\n\n${demo.brief}`;
    if (persona) persona.value = "清醒的荒诞观察者：守住动物学事实边界，再讨论照护、权力与归属；允许幽默，但不把动物拟人成虚假知识。";
    if (wordLimit) {
      wordLimit.value = "2500";
      wordLimit.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const reduceAI = document.getElementById("reduceAI");
    if (reduceAI) reduceAI.checked = true;
    const freeEssay = document.querySelector('input[name="style"][value="essay_free"]');
    if (freeEssay) {
      freeEssay.checked = true;
      freeEssay.dispatchEvent(new Event("change", { bubbles: true }));
    }
    articleReq?.dispatchEvent(new Event("input", { bubbles: true }));
    persona?.dispatchEvent(new Event("input", { bubbles: true }));
  }, 0));
})();
