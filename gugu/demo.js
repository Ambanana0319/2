(() => {
  const demo = window.GUGU_DEMO;
  const json = (value, status = 200) => new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
  const count = (text) => String(text || "").replace(/\s/g, "").length;
  const totalWords = demo.chapters.reduce((sum, chapter) => sum + count(chapter.body), 0);
  const now = "2026-08-13T09:00:00+08:00";
  const projectId = "demo-sea";

  const project = {
    id: projectId,
    title: demo.project.title,
    source_id: "demo-source",
    source_title: demo.project.source,
    source_status: "analyzed",
    source_characters: totalWords,
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
    creative_brief_status: "confirmed",
    director_profile_id: "mock",
    writer_profile_id: "mock",
    director_locked: true,
    next_prepare_enabled: 0,
    double_chapter_enabled: 0,
    aesthetic_observation_enabled: 1,
    aesthetic_feedback_mode: "record",
    writing_style_skill: "",
    is_active: 1,
    updated_at: now,
    latest_task: null
  };

  const chapters = demo.chapters.map((chapter) => ({
    id: `demo-chapter-${chapter.number}`,
    number: chapter.number,
    title: chapter.title,
    body: chapter.body,
    status: "confirmed",
    word_count: count(chapter.body),
    updated_at: now
  }));

  const charactersById = new Map(demo.characters.map((character) => [character.id, character]));
  const characterState = (character, chapter) => character.states[Math.min(character.states.length - 1, Math.max(0, chapter - 1))];
  const node = (character, chapter, peripheral = false) => ({
    id: character.name,
    name: character.name,
    color: character.color,
    peripheral,
    card: {
      function: character.role,
      current_state: characterState(character, chapter),
      fixed_facts: [character.role],
      current_knowledge: [{ fact: characterState(character, chapter), state: "known", effective_time: `第 ${chapter} 章` }]
    }
  });
  const edge = (relation) => {
    const from = charactersById.get(relation.from)?.name || relation.from;
    const to = charactersById.get(relation.to)?.name || relation.to;
    return {
      id: `${relation.from}-${relation.to}-${relation.start}`,
      from,
      to,
      type: relation.type,
      label: relation.label,
      relationship_label: relation.label,
      summary: relation.summary,
      current_state: relation.summary,
      latest_change: relation.summary,
      lifecycle_status: relation.end ? "ended" : "active",
      turning_points: [{
        chapter: relation.start,
        summary: relation.summary,
        lifecycle_status: relation.end ? "ended" : "active"
      }]
    };
  };
  const allEdges = demo.relations.map(edge);

  function relationshipMap(chapter = 5, full = false) {
    const through = Math.max(1, Math.min(5, Number(chapter) || 5));
    return {
      nodes: demo.characters.slice(0, 6).map((character) => node(character, through)),
      related_nodes: demo.characters.slice(6).map((character) => node(character, through, true)),
      edges: allEdges.filter((item) => item.turning_points[0].chapter <= through && demo.characters.slice(0, 6).some((character) => character.name === item.from) && demo.characters.slice(0, 6).some((character) => character.name === item.to)),
      related_edges: allEdges.filter((item) => item.turning_points[0].chapter <= through && !(demo.characters.slice(0, 6).some((character) => character.name === item.from) && demo.characters.slice(0, 6).some((character) => character.name === item.to))),
      future_nodes: [],
      future_edges: [],
      routes: demo.route,
      effective_chapter: through,
      confirmed_chapter: 5,
      maximum_chapter: 5,
      spoiler_level: full ? "full" : "confirmed"
    };
  }

  function continuity(chapter = 5) {
    const through = Math.max(1, Math.min(5, Number(chapter) || 5));
    const relationships = Object.fromEntries(
      allEdges
        .filter((item) => item.turning_points[0].chapter <= through)
        .map((item) => [`${item.from}—${item.to}`, { from: item.from, to: item.to, current_state: item.summary }])
    );
    return {
      chapter: through,
      snapshot: {
        characters: Object.fromEntries(demo.characters.map((character) => [character.name, {
          state: characterState(character, through),
          location: demo.chapters[through - 1].location
        }])),
        relationships
      }
    };
  }

  const outline = {
    title: "白礁潮庭",
    summary: "海女没有以杀戮结束旧债，而是让海族、陆地王国与沿岸民众共同签下可执行的和平盟约。",
    phases: demo.route.map((stage, index) => ({
      name: stage.title,
      main_event: stage.text,
      response: demo.requirements[Math.min(index, demo.requirements.length - 1)],
      storylines: [{
        name: index < 3 ? "海女与黑潮" : "海陆联合航线",
        events: [{
          title: demo.chapters[index].title,
          summary: demo.chapters[index].summary,
          characters: index === 0 ? ["小海女", "白石王子", "北岸公主"] : index === 4 ? ["小海女", "潮汐女巫", "北岸公主"] : ["小海女", "赤甲", "潮汐女巫"],
          original_position: `演示正文第 ${index + 1} 章`,
          later_impact: index === 4 ? "和平从个人原谅转为公开制度。" : demo.route[Math.min(index + 1, 4)].text,
          uncertainties: []
        }]
      }]
    })),
    requirement_tracks: {
      stages: demo.route.map((stage) => ({ name: stage.title, summary: stage.text })),
      requirements: demo.requirements.map((text, requirementIndex) => ({
        text,
        points: demo.route.map((_, stageIndex) => stageIndex >= requirementIndex ? ({ meaning: stageIndex === requirementIndex ? "生效" : stageIndex === 4 ? "兑现" : "继续发展" }) : null)
      }))
    }
  };

  const source = {
    id: "demo-source",
    title: demo.project.source,
    filename: "海滨旧闻.txt",
    status: "analyzed",
    analysis_id: "demo-analysis",
    char_count: totalWords,
    chapter_count: 5,
    unit_count: 24,
    disk_bytes: 48640,
    deletable: false,
    projects: [{ id: project.id, title: project.title }]
  };

  window.fetch = async (input, init = {}) => {
    const raw = typeof input === "string" ? input : input?.url || "";
    const url = new URL(raw, window.location.href);
    const path = url.pathname;
    const method = String(init.method || "GET").toUpperCase();
    if (!path.startsWith("/api/")) throw new Error("静态演示不会连接外部服务");

    if (method === "GET" && path === "/api/projects") return json({ projects: [project] });
    if (method === "GET" && path === "/api/profiles") return json({ profiles: [{ id: "mock", name: "静态演示", model: "DEMO", has_key: false, last_test_ok: null, pricing_configured: false }] });
    if (method === "GET" && path === "/api/sources") return json({ sources: [source] });
    if (method === "GET" && path === `/api/projects/${projectId}`) return json({ project });
    if (method === "GET" && path === `/api/projects/${projectId}/chapters`) return json({ chapters });
    if (method === "GET" && path === `/api/projects/${projectId}/wishes`) return json({
      wishes: demo.requirements.map((text, index) => ({ id: `wish-${index + 1}`, text, scope: "future" })),
      messages: [{ role: "assistant", content: "五章演示正文已经完成；未来路线只在两次剧透确认后展示。", metadata_json: "{}" }]
    });
    if (method === "GET" && path === `/api/projects/${projectId}/book-generation`) return json({
      run: { id: "demo-run", status: "completed", end_chapter: 5, book_confirmed_chapters: 5, completed_chapters: 5, estimated_cost_cny: 0 },
      estimate: { available: true, total_chapters: 5, remaining_chapters: 0, next_chapter: 6, pricing_configured: true, estimated_duration_low_seconds: 0, estimated_duration_high_seconds: 0, estimated_total_cost_low_cny: 0, estimated_total_cost_high_cny: 0, estimated_api_calls_low: 0, estimated_api_calls_high: 0 }
    });
    if (method === "GET" && path === `/api/projects/${projectId}/preparations/next`) return json({ preparation: null });
    if (method === "GET" && path === `/api/projects/${projectId}/creative-brief`) return json({ brief: { title: project.title, premise: demo.project.subtitle, requirements: demo.requirements } });
    if (method === "GET" && path === `/api/projects/${projectId}/relationship-map`) return json({ relationship_map: relationshipMap(url.searchParams.get("chapter"), false) });
    if (method === "GET" && path === `/api/projects/${projectId}/continuity`) return json({ continuity: continuity(url.searchParams.get("chapter")) });
    if (method === "GET" && path === `/api/projects/${projectId}/export`) {
      return new Response(chapters.map((chapter) => `第${chapter.number}章 ${chapter.title}\n\n${chapter.body}`).join("\n\n"), { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    if (method === "POST" && path === `/api/projects/${projectId}/outline/spoiler-challenge`) return json({ token: "demo-spoiler", warning: "第二次确认：以下内容包含五章完整航线、人物关系变化和最终结局。" });
    if (method === "POST" && path === `/api/projects/${projectId}/outline/spoiler-unseal`) return json({ outline, relationship_map: relationshipMap(5, true) });
    if (method === "POST" && path === "/api/shutdown-app") return json({ ok: true, message: "静态演示无需关闭后台程序" });
    return json({ ok: true, message: "静态演示不会修改数据" });
  };
})();
