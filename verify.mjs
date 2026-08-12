import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import vm from "node:vm";

const root = new URL("./", import.meta.url);
const rootPath = decodeURIComponent(root.pathname);
const requiredFiles = [
  "index.html",
  "showcase.css",
  "gugu/index.html",
  "gugu/demo.css",
  "gugu/demo-data.js",
  "gugu/demo.js",
  "gugu/assets/gugu-launcher.png",
  "pengu/index.html",
  "pengu/demo.css",
  "pengu/demo-data.js",
  "pengu/demo.js",
  "pengu/assets/launcher-pengu.png",
  "pengu/assets/zpix.ttf"
];

for (const path of requiredFiles) await access(new URL(path, root), constants.R_OK);

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "qa"].includes(entry.name)) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else files.push(absolute);
  }
  return files;
}

function loadData(path, key) {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(path.source, context, { filename: path.name });
  return context.window[key];
}

const files = await walk(rootPath);
const forbiddenExtensions = new Set([".env", ".db", ".sqlite", ".sqlite3", ".log", ".docx", ".pdf"]);
const privatePatterns = [
  { label: "absolute local path", pattern: /\/(?:Users|home)\/[\w.-]+\//i },
  { label: "personal project material", pattern: /火火|斗破苍穹|萧炎|魂天帝|虚无吞炎/ },
  { label: "credential-like token", pattern: /(?:gh[opsu]_|sk-)[A-Za-z0-9_-]{16,}/ }
];

for (const file of files) {
  const name = relative(rootPath, file);
  if (forbiddenExtensions.has(extname(file).toLowerCase())) throw new Error(`Forbidden file: ${name}`);
  if (!/\.(?:html|css|js|mjs|json|md|svg)$/i.test(file) || name === "verify.mjs") continue;
  const source = await readFile(file, "utf8");
  for (const { label, pattern } of privatePatterns) {
    if (pattern.test(source)) throw new Error(`${label} found in ${name}`);
  }
}

for (const path of ["gugu/demo-data.js", "gugu/demo.js", "pengu/demo-data.js", "pengu/demo.js"]) {
  const source = await readFile(new URL(path, root), "utf8");
  new vm.Script(source, { filename: path });
}

const guguSource = await readFile(new URL("gugu/demo-data.js", root), "utf8");
const penguSource = await readFile(new URL("pengu/demo-data.js", root), "utf8");
const gugu = loadData({ name: "gugu/demo-data.js", source: guguSource }, "GUGU_DEMO");
const pengu = loadData({ name: "pengu/demo-data.js", source: penguSource }, "PENGU_DEMO");

if (gugu.chapters.length !== 5) throw new Error("Gugu must contain five chapters");
if (gugu.characters.length < 9) throw new Error("Gugu must contain at least nine characters");
for (const chapter of gugu.chapters) {
  const length = chapter.body.replace(/\s/g, "").length;
  if (length < 2500 || length > 3800) throw new Error(`Gugu chapter ${chapter.number} length out of demo range: ${length}`);
}
if (pengu.outlines.length !== 4) throw new Error("Pengu must contain four outlines");
if (pengu.candidates.length !== 6) throw new Error("Pengu must contain six candidates");
const essayLength = pengu.essay.sections.map((section) => section.p).join("").replace(/\s/g, "").length;
if (essayLength < 2300 || essayLength > 3200) throw new Error(`Pengu essay length out of range: ${essayLength}`);

const requiredIds = {
  "gugu/index.html": ["libraryView", "readerView", "routeView", "chapterList", "chapterBody", "relationshipGraph", "chapterRange", "futureToggle"],
  "pengu/index.html": ["briefPanel", "outlinePanel", "generatePanel", "comparePanel", "essayPanel", "outlineGrid", "skater", "candidateGrid"]
};
for (const [name, ids] of Object.entries(requiredIds)) {
  const html = await readFile(new URL(name, root), "utf8");
  for (const id of ids) if (!html.includes(`id="${id}"`)) throw new Error(`Missing interaction target in ${name}: #${id}`);
}

const htmlFiles = files.filter((file) => extname(file).toLowerCase() === ".html");
for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  if (/\b(?:fetch|XMLHttpRequest)\b|\/api\//i.test(html)) throw new Error(`Runtime API reference found in ${relative(rootPath, file)}`);
  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const ref = match[1];
    if (/^(?:https?:|mailto:|data:|javascript:)/i.test(ref) || ref === "./" || ref === "../") continue;
    const target = resolve(file, "..", ref.split(/[?#]/)[0]);
    await access(target, constants.R_OK).catch(() => { throw new Error(`Missing resource in ${relative(rootPath, file)}: ${ref}`); });
  }
}

for (const path of ["gugu/demo.js", "pengu/demo.js"]) {
  const source = await readFile(new URL(path, root), "utf8");
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\b|\/api\//i.test(source)) throw new Error(`Network code found in ${path}`);
}

console.log(JSON.stringify({
  status: "passed",
  files: files.length,
  guguChapterLengths: gugu.chapters.map((chapter) => chapter.body.replace(/\s/g, "").length),
  guguCharacters: gugu.characters.length,
  guguRelations: gugu.relations.length,
  penguEssayLength: essayLength,
  penguOutlines: pengu.outlines.length,
  penguCandidates: pengu.candidates.length
}, null, 2));
