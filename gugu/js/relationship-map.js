import { state } from "./state.js";

export function relationshipKind(text = "") {
  const value = String(text || "");
  const groups = [
    ["mentor", [["师徒", "师徒"], ["师生", "师生"], ["导师", "师生"], ["老师", "师生"], ["师父", "师徒"], ["为徒", "师徒"]]],
    ["family", [["母子", "母子"], ["母女", "母女"], ["父子", "父子"], ["父女", "父女"], ["兄妹", "兄妹"], ["姐弟", "姐弟"], ["兄弟", "兄弟"], ["姐妹", "姐妹"], ["唤母", "母子"], ["生父", "亲子"], ["生母", "亲子"], ["母亲", "亲子"], ["父亲", "亲子"], ["亲子", "亲子"], ["血缘", "血缘"], ["血亲", "血缘"], ["家族", "家族"]]],
    ["enemy", [["死敌", "死敌"], ["宿敌", "宿敌"], ["仇敌", "仇敌"], ["敌对", "敌对"], ["仇人", "仇敌"], ["对手", "对手"], ["裂痕", "冲突"], ["嫌隙", "冲突"], ["公开冲突", "冲突"]]],
    ["romance", [["夫妻", "夫妻"], ["配偶", "夫妻"], ["丈夫", "夫妻"], ["妻子", "夫妻"], ["恋人", "恋人"], ["伴侣", "伴侣"], ["婚约", "婚约"], ["青梅竹马", "青梅竹马 · 感情关系"], ["红颜知己", "知己"], ["相爱", "恋人"], ["爱人", "伴侣"], ["情感纠葛", "情感"], ["情感依赖", "情感"]]],
    ["hierarchy", [["主从", "主从"], ["君臣", "君臣"], ["上下级", "上下级"], ["效忠", "主从"]]],
    ["ally", [["盟友", "盟友"], ["同盟", "盟友"], ["朋友", "朋友"], ["同伴", "同伴"], ["合作", "合作"]]]
  ];
  for (const [type, candidates] of groups) {
    const match = candidates.find(([keyword]) => value.includes(keyword));
    if (match) return { type, label: match[1] };
  }
  return { type: "other", label: "关系" };
}

function canonicalRelationshipName(raw, names) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (names.includes(value)) return value;
  const withoutForm = value.replace(/[（(][^）)]*[）)]/g, "").trim();
  for (const name of names) {
    const aliases = [name, ...String(name).split(/[/／、]/)]
      .map((item) => item.trim())
      .filter(Boolean);
    if (
      aliases.includes(withoutForm)
      || aliases.some(
        (alias) => withoutForm === alias || withoutForm.startsWith(`${alias}·`)
      )
    ) return name;
  }
  return withoutForm;
}

export function relationshipEdgesThroughChapter(rawEdges, throughChapter) {
  const limit = Number(throughChapter || 0);
  return (rawEdges || []).flatMap((edge) => {
    const points = (edge.turning_points || [])
      .filter(
        (point) => Number(point?.chapter || 0) > 0 && Number(point.chapter) <= limit
      )
      .sort((left, right) => Number(left.chapter) - Number(right.chapter));
    if (!points.length) return [];
    const latest = points[points.length - 1];
    const stable = points.reduce((result, point) => {
      const kind = relationshipKind(point.summary);
      return kind.type === "other" ? result : { point, kind };
    }, null);
    const relationshipLabel = edge.relationship_label
      || stable?.kind.label
      || edge.label
      || "关系";
    const currentState = edge.current_state
      || stable?.point.summary
      || edge.summary
      || latest.summary;
    return [{
      ...edge,
      status: "confirmed",
      type: edge.type || stable?.kind.type || "other",
      label: relationshipLabel,
      relationship_label: relationshipLabel,
      summary: currentState,
      current_state: currentState,
      latest_change: latest.summary || edge.latest_change || currentState,
      lifecycle_status: latest.lifecycle_status || edge.lifecycle_status || "active",
      turning_points: points
    }];
  });
}

function currentRelationshipStates(edges, throughChapter) {
  const names = [...new Set([
    ...(state.relationshipMap?.nodes || []).map((node) => node.id || node.name),
    ...(state.relationshipMap?.related_nodes || []).map((node) => node.id || node.name),
    ...(edges || []).flatMap((edge) => [edge.from, edge.to])
  ].filter(Boolean))];
  const relationships = state.relationshipContinuity?.snapshot?.relationships || {};
  const result = new Map();
  if (
    Number(state.relationshipContinuity?.chapter || 0) > Number(throughChapter || 0)
  ) return result;
  const rows = Array.isArray(relationships)
    ? relationships
    : relationships && typeof relationships === "object"
      ? Object.entries(relationships).map(([pair, detail]) => ({ pair, detail }))
      : [];
  rows.forEach((raw) => {
    if (!raw || typeof raw !== "object") return;
    const parties = Array.isArray(raw.parties) ? raw.parties : [];
    let leftRaw = String(raw.from || raw.from_name || raw.source || parties[0] || "").trim();
    let rightRaw = String(raw.to || raw.to_name || raw.target || parties[1] || "").trim();
    const rawPair = String(raw.pair || "");
    if ((!leftRaw || !rightRaw) && rawPair) {
      const parts = rawPair.split(/\s*(?:-|—|–|↔|→|与)\s*/, 2);
      if (parts.length === 2) [leftRaw, rightRaw] = parts;
    }
    if (!leftRaw || !rightRaw) return;
    const left = canonicalRelationshipName(leftRaw, names);
    const right = canonicalRelationshipName(rightRaw, names);
    if (!left || !right || left === right) return;
    const key = [left, right].sort().join("\u0000");
    const confidence = Number(names.includes(leftRaw)) + Number(names.includes(rightRaw));
    if ((result.get(key)?._confidence || 0) > confidence) return;
    result.set(key, {
      from: left,
      to: right,
      summary: String(raw.current_state || raw.detail || raw.summary || raw.value || raw.relationship || raw.label || ""),
      _confidence: confidence
    });
  });
  return result;
}

export function consolidateRelationshipEdges(
  rawEdges,
  status = "confirmed",
  throughChapter = 0
) {
  const states = currentRelationshipStates(rawEdges, throughChapter);
  const groups = new Map();
  (rawEdges || []).forEach((edge) => {
    if (!edge?.from || !edge?.to || edge.from === edge.to) return;
    const key = [edge.from, edge.to].sort().join("\u0000");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(edge);
  });
  const priority = {
    mentor: 7,
    family: 6,
    romance: 5,
    hierarchy: 4,
    enemy: 3,
    ally: 2,
    other: 1
  };
  return [...groups.entries()].map(([key, group]) => {
    const current = states.get(key);
    const currentKind = relationshipKind(current?.summary || "");
    const candidates = group.map((edge) => {
      const inferred = relationshipKind(edge.summary);
      return {
        ...edge,
        type: edge.type || inferred.type,
        label: edge.label || inferred.label
      };
    });
    const matchingCurrent = currentKind.type === "other"
      ? null
      : candidates.find((edge) => edge.type === currentKind.type);
    const primary = matchingCurrent || candidates.slice().sort(
      (left, right) => (priority[right.type] || 0) - (priority[left.type] || 0)
    )[0];
    const turningPoints = candidates
      .flatMap((edge) => edge.turning_points || [])
      .sort(
        (left, right) => Number(left.chapter || 0) - Number(right.chapter || 0)
      );
    const uniqueTurning = [];
    const seenTurning = new Set();
    turningPoints.forEach((point) => {
      const marker = `${point.chapter || 0}\u0000${point.summary || ""}`;
      if (seenTurning.has(marker)) return;
      seenTurning.add(marker);
      uniqueTurning.push(point);
    });
    return {
      ...primary,
      from: current?.from || primary.from,
      to: current?.to || primary.to,
      type: currentKind.type !== "other" ? currentKind.type : primary.type,
      label: currentKind.type !== "other"
        ? (matchingCurrent?.label || currentKind.label)
        : primary.label,
      status,
      relationship_label: primary.relationship_label || primary.label,
      current_state: currentKind.type !== "other"
        ? current?.summary
        : primary.current_state || primary.summary,
      latest_change: current?.summary || primary.latest_change || primary.summary,
      lifecycle_status: primary.lifecycle_status || "active",
      summary: currentKind.type !== "other"
        ? current?.summary
        : primary.current_state || primary.summary,
      turning_points: uniqueTurning.slice(-16)
    };
  });
}

export function plannedRelationshipEdges(confirmedEdges = [], throughChapter = 0) {
  if (!state.outlineUnsealed) return [];
  const rawItems = state.relationshipMap?.spoiler_level === "full"
    && Array.isArray(state.relationshipMap?.future_edges)
    ? state.relationshipMap.future_edges
    : [];
  const confirmedKeys = new Set((confirmedEdges || []).flatMap((edge) => {
    if (!edge?.from || !edge?.to) return [];
    const pairKey = [edge.from, edge.to].sort().join("\u0000");
    const kind = edge.type || relationshipKind(edge.summary).type;
    return [`${pairKey}\u0000${kind}`, `${pairKey}\u0000*`];
  }));
  const seen = new Set();
  return rawItems.flatMap((raw) => {
    const characters = Array.isArray(raw.characters) ? raw.characters : [];
    const from = String(
      raw.from || raw.left || raw.source || characters[0] || ""
    ).trim();
    const to = String(
      raw.to || raw.right || raw.target || characters[1] || ""
    ).trim();
    if (!from || !to || from === to) return [];
    const summary = String(
      raw.summary
      || raw.description
      || raw.state
      || raw.relationship
      || raw.label
      || "关系尚未发生"
    );
    const kind = relationshipKind(summary);
    const type = raw.type || kind.type;
    const pairKey = [from, to].sort().join("\u0000");
    const relationKey = String(
      raw.relationship_state_id || raw.id || "unregistered"
    ).trim();
    const semanticKey = `${pairKey}\u0000planned\u0000${relationKey}\u0000${type}`;
    const startChapter = Number(raw.start_chapter || 0);
    const endChapter = Number(raw.end_chapter || 0);
    if (startChapter > 0 && Number(throughChapter || 0) < startChapter) return [];
    if (endChapter > 0 && Number(throughChapter || 0) > endChapter) return [];
    if (
      confirmedKeys.has(`${pairKey}\u0000${type}`)
      || (type === "other" && confirmedKeys.has(`${pairKey}\u0000*`))
    ) return [];
    if (seen.has(semanticKey)) return [];
    seen.add(semanticKey);
    return [{
      id: raw.id || raw.relationship_state_id || "",
      relationship_state_id: raw.relationship_state_id || raw.id || "",
      from,
      to,
      type,
      label: raw.label || kind.label,
      status: "planned",
      temporal_status: raw.temporal_status || "future",
      summary,
      start_chapter: startChapter || null,
      end_chapter: endChapter || null,
      turning_points: []
    }];
  });
}

export function readerSafeCharacterCard(
  name,
  edges,
  supplied = {},
  throughChapter = 0,
  mapEffectiveChapter = 0
) {
  const continuity = state.relationshipContinuity || {};
  const snapshot = continuity.snapshot || {};
  const continuityMatchesView = Number(continuity.chapter || 0)
    <= Number(throughChapter || 0);
  const rawCharacters = continuityMatchesView ? snapshot.characters : null;
  const rawState = Array.isArray(rawCharacters)
    ? rawCharacters.find((item) => item && typeof item === "object" && (
      item.canonical_name === name || item.name === name || item.character === name
    ))
    : rawCharacters?.[name];
  const currentState = typeof rawState === "string"
    ? rawState
    : rawState && typeof rawState === "object"
      ? [rawState.state, rawState.status, rawState.condition, rawState.location]
        .filter(Boolean)
        .join("；")
      : "";
  const relationships = (edges || [])
    .filter(
      (edge) => edge.status !== "planned" && (edge.from === name || edge.to === name)
    )
    .map((edge) => ({
      with: edge.from === name ? edge.to : edge.from,
      label: edge.label || "关系",
      summary: edge.summary || "",
      status: "confirmed"
    }));
  const mentioned = Boolean(rawState) || relationships.length > 0;
  const lastEdgeChapter = Math.max(
    0,
    ...(edges || [])
      .filter((edge) => edge.from === name || edge.to === name)
      .flatMap((edge) => edge.turning_points || [])
      .map((point) => Number(point.chapter || 0))
  );
  const mapMatchesView = Number(mapEffectiveChapter || 0) <= Number(throughChapter || 0);
  return {
    ...supplied,
    current_state: mapMatchesView ? (supplied.current_state || currentState) : currentState,
    relationships: relationships.length
      ? relationships
      : mapMatchesView
        ? (supplied.relationships || [])
        : [],
    last_confirmed_chapter: lastEdgeChapter
      || (mentioned && continuityMatchesView ? Number(continuity.chapter || 0) : 0)
  };
}

export function mergeHistoricalRelationshipMap(fullMap, historicalMap) {
  if (fullMap?.spoiler_level !== "full") return historicalMap;
  const fullNodes = [
    ...(fullMap.nodes || []),
    ...(fullMap.related_nodes || []),
    ...(fullMap.future_nodes || [])
  ];
  const fullById = new Map(fullNodes.map((node) => [node.id || node.name, node]));
  const mergeNodes = (nodes) => (nodes || []).map((node) => {
    const fullNode = fullById.get(node.id || node.name) || {};
    return {
      ...fullNode,
      ...node,
      card: { ...(fullNode.card || {}), ...(node.card || {}) }
    };
  });
  return {
    ...fullMap,
    ...historicalMap,
    nodes: mergeNodes(historicalMap.nodes),
    related_nodes: mergeNodes(historicalMap.related_nodes),
    future_nodes: fullMap.future_nodes || [],
    future_edges: fullMap.future_edges || [],
    routes: fullMap.routes || [],
    maximum_chapter: Math.max(
      Number(fullMap.maximum_chapter || 0),
      Number(historicalMap.maximum_chapter || 0)
    ),
    spoiler_level: "full"
  };
}

export function isSpoilerConfirmationError(error) {
  return /剧透确认.*(?:无效|过期)/.test(String(error?.message || ""));
}

export function recoverSpoilerConfirmation(targetState, error) {
  if (!isSpoilerConfirmationError(error)) return false;
  targetState.spoilerChallenge = null;
  targetState.spoilerGateStep = 0;
  return true;
}

export function readableCharacterCardValues(value, limit = 6) {
  const values = [];
  const visit = (item) => {
    if (item == null || item === "") return;
    if (Array.isArray(item)) return item.forEach(visit);
    if (typeof item === "object") return Object.values(item).forEach(visit);
    const text = String(item).trim();
    if (text && !values.includes(text)) values.push(text);
  };
  visit(value);
  return values.slice(0, limit);
}

export function relationshipMainNodes(map) {
  const supplied = [
    ...(map.nodes || []),
    ...(map.related_nodes || []),
    ...(map.future_nodes || [])
  ].filter(
    (node, index, items) => items.findIndex(
      (candidate) => (candidate.id || candidate.name) === (node.id || node.name)
    ) === index
  );
  const authoritative = map.nodes || [];
  if (authoritative.length) {
    return authoritative.map((node) => ({ ...node, core: true, peripheral: false }));
  }
  const connectedIds = new Set([...(map.edges || []), ...(map.related_edges || [])]
    .flatMap((edge) => [edge.from, edge.to])
    .filter(Boolean));
  const anchors = supplied
    .filter((node) => connectedIds.has(node.id || node.name))
    .slice(0, 2);
  return (anchors.length ? anchors : supplied.slice(0, 1)).map((node) => ({
    ...node,
    core: false,
    layoutAnchor: true
  }));
}

export function limitRelationshipEdges(edges, maximum = 24) {
  const visible = (edges || []).slice(0, maximum);
  return {
    edges: visible,
    hiddenCount: Math.max(0, (edges || []).length - visible.length)
  };
}
