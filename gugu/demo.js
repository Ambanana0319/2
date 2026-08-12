(() => {
  const data = window.GUGU_DEMO;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const views = {library:$("#libraryView"),reader:$("#readerView"),route:$("#routeView")};
  let activeChapter = 1;
  let readerSize = 18;
  let routeTab = "relation";
  let showFuture = false;
  let selectedNode = "mermaid";
  let selectedEdge = null;

  function showToast(text){const toast=$("#toast");toast.textContent=text;toast.classList.remove("is-hidden");clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>toast.classList.add("is-hidden"),2200)}
  function showView(name){Object.entries(views).forEach(([key,node])=>node.classList.toggle("is-hidden",key!==name));$$('[data-view]').forEach(button=>button.classList.toggle("is-active",button.dataset.view===name));window.scrollTo({top:0,behavior:"smooth"});if(name==="route")renderRoute()}
  function chapterLabel(number){return ["零","一","二","三","四","五"][number]||number}

  function renderRequirements(){$("#requirementList").innerHTML=data.requirements.map((item,index)=>`<article class="requirement-item"><i>✓</i><p><b>0${index+1}</b> ${item}</p></article>`).join("")}
  function renderChapterList(){$("#chapterList").innerHTML=data.chapters.map(ch=>`<li><button data-chapter="${ch.number}" class="${ch.number===activeChapter?'is-active':''}"><span>${String(ch.number).padStart(2,"0")}</span><b>${ch.title}</b><small>${ch.location}</small></button></li>`).join("");$$('[data-chapter]').forEach(button=>button.addEventListener("click",()=>{activeChapter=Number(button.dataset.chapter);renderReader()}))}
  function renderReader(){const ch=data.chapters[activeChapter-1];$("#chapterNo").textContent=`第${chapterLabel(ch.number)}章`;$("#chapterTitle").textContent=ch.title;$("#chapterMeta").textContent=`${ch.location} · ${ch.body.replace(/\s/g,"").length.toLocaleString()} 字 · 已确认`;$("#chapterSummary").textContent=ch.summary;$("#chapterBody").innerHTML=ch.body.trim().split(/\n\s*\n/).map(p=>`<p>${p}</p>`).join("");$("#chapterBody").style.setProperty("--reader-size",`${readerSize}px`);$("#readerProgress").textContent=`${activeChapter} / ${data.chapters.length}`;$("#prevChapter").disabled=activeChapter===1;$("#nextChapter").disabled=activeChapter===data.chapters.length;renderChapterList();window.scrollTo({top:0,behavior:"smooth"})}

  function relationVisible(edge,chapter){return edge.start<=chapter||showFuture}
  function renderGraph(){const chapter=Number($("#chapterRange").value);$("#rangeValue").textContent=chapter;const nodes=data.characters.filter(n=>n.core||showFuture||n.id===selectedNode);const visibleNodeIds=new Set(nodes.map(n=>n.id));const edges=data.relations.map((edge,index)=>({...edge,index})).filter(edge=>relationVisible(edge,chapter)&&visibleNodeIds.has(edge.from)&&visibleNodeIds.has(edge.to));const nodeMap=new Map(nodes.map(n=>[n.id,n]));const edgeMarkup=edges.map(edge=>{const from=nodeMap.get(edge.from),to=nodeMap.get(edge.to);const future=edge.start>chapter;const ended=edge.end&&edge.end<chapter;return `<line class="edge ${edge.type} ${future?'future':''} ${ended?'ended':''} ${selectedEdge===edge.index?'selected':''}" data-edge="${edge.index}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"/>`}).join("");const nodeMarkup=nodes.map(node=>`<g class="node ${node.color} ${node.core?'':'peripheral'} ${selectedNode===node.id?'selected':''}" data-node="${node.id}" transform="translate(${node.x} ${node.y})"><circle r="${node.core?32:24}"></circle><text text-anchor="middle" y="4">${node.name}</text></g>`).join("");$("#relationshipGraph").innerHTML=edgeMarkup+nodeMarkup;$$('[data-node]').forEach(el=>el.addEventListener("click",()=>{selectedNode=el.dataset.node;selectedEdge=null;renderGraph()}));$$('[data-edge]').forEach(el=>el.addEventListener("click",()=>{selectedEdge=Number(el.dataset.edge);selectedNode=null;renderGraph()}));renderInspector()}
  function renderInspector(){const chapter=Number($("#chapterRange").value);if(selectedEdge!==null){const edge=data.relations[selectedEdge];if(edge){const from=data.characters.find(n=>n.id===edge.from),to=data.characters.find(n=>n.id===edge.to);$("#relationshipInspector").innerHTML=`<span>RELATIONSHIP</span><h2>${from.name} ↔ ${to.name}</h2><small>${edge.label}</small><dl><div><dt>关系性质</dt><dd>${edge.type}</dd></div><div><dt>当前状态</dt><dd>${edge.start>chapter?'尚未发生':edge.end&&edge.end<chapter?'已经结束或转化':edge.summary}</dd></div><div><dt>时间范围</dt><dd>第 ${edge.start} 章起${edge.end?` · 第 ${edge.end} 章止`:""}</dd></div></dl>`;return}}const node=data.characters.find(n=>n.id===selectedNode)||data.characters[0];const state=node.states[Math.min(chapter-1,node.states.length-1)]||node.states.at(-1);const relations=data.relations.filter(e=>(e.from===node.id||e.to===node.id)&&e.start<=chapter&&(!e.end||e.end>=chapter));$("#relationshipInspector").innerHTML=`<span>${node.core?'CORE CAST':'RELATED CAST'}</span><h2>${node.name}</h2><small>${node.role}</small><dl><div><dt>截至第 ${chapter} 章</dt><dd>${state}</dd></div><div><dt>当前连接</dt><dd>${relations.length?relations.map(e=>{const other=data.characters.find(n=>n.id===(e.from===node.id?e.to:e.from));return `${other.name} · ${e.label}`}).join("<br>"):"暂无已确认关系"}</dd></div><div><dt>演示说明</dt><dd>拖动章节滑块，可以观察人物状态与关系的出现、结束和转化。</dd></div></dl>`}
  function renderStoryRoute(){$("#routeLine").innerHTML=data.route.map(item=>`<article class="route-node"><span>0${item.n}</span><b>${item.title}</b><p>${item.text}</p></article>`).join("")}
  function renderRoute(){renderStoryRoute();$("#storyRoute").classList.toggle("is-hidden",routeTab!=="story");$("#relationshipShell").classList.toggle("is-hidden",routeTab!=="relation");$$('[data-route-tab]').forEach(button=>button.classList.toggle("is-active",button.dataset.routeTab===routeTab));if(routeTab==="relation")renderGraph()}

  renderRequirements();renderReader();renderRoute();
  $$('[data-view]').forEach(button=>button.addEventListener("click",()=>showView(button.dataset.view)));
  $$('[data-open-reader]').forEach(button=>button.addEventListener("click",()=>showView("reader")));
  $$('[data-open-route]').forEach(button=>button.addEventListener("click",()=>showView("route")));
  $$('[data-route-tab]').forEach(button=>button.addEventListener("click",()=>{routeTab=button.dataset.routeTab;renderRoute()}));
  $("#prevChapter").addEventListener("click",()=>{if(activeChapter>1){activeChapter--;renderReader()}});$("#nextChapter").addEventListener("click",()=>{if(activeChapter<data.chapters.length){activeChapter++;renderReader()}});
  $("#fontMinus").addEventListener("click",()=>{readerSize=Math.max(15,readerSize-1);renderReader()});$("#fontPlus").addEventListener("click",()=>{readerSize=Math.min(23,readerSize+1);renderReader()});
  $("#themeButton").addEventListener("click",()=>{document.body.classList.toggle("theme-night");$("#themeButton").textContent=document.body.classList.contains("theme-night")?"日间":"夜间"});
  $("#chapterRange").addEventListener("input",()=>{selectedEdge=null;renderGraph()});
  $("#futureToggle").addEventListener("click",()=>{showFuture=!showFuture;$("#futureToggle").textContent=showFuture?"未来已显示":"显示未来";showToast(showFuture?"已解除演示剧透封条":"未来关系已隐藏");renderGraph()});
})();
