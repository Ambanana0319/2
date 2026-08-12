import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = new URL("./", import.meta.url);
const rootPath = fileURLToPath(root);
const required = [
  "index.html",
  "showcase.css",
  "gugu/index.html",
  "gugu/app.js",
  "gugu/demo-data.js",
  "gugu/demo.js",
  "gugu/archive-index.css",
  "gugu/gugu-ui.css",
  "pengu/index.html",
  "pengu/demo-data.js",
  "pengu/demo.js",
  "pengu/assets/zpix.ttf"
];

for (const path of required) await access(new URL(path, root), constants.R_OK);

const ignoredDirectories = new Set([".git", "node_modules", "qa"]);
const forbiddenExtensions = new Set([".py", ".db", ".sqlite", ".sqlite3", ".log", ".env", ".txt", ".docx", ".pdf"]);
const forbiddenText = [
  /\/Users\/say/i,
  /斗破苍穹|萧炎|魂天帝|萧战|萧玄|虚无吞炎/,
  /gho_[A-Za-z0-9]+/,
  /sk-[A-Za-z0-9_-]{16,}/,
  /AIza[A-Za-z0-9_-]{20,}/,
  /FEE0-F20D/
];

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name) || entry.name === ".DS_Store") continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else files.push(absolute);
  }
  return files;
}

const files = await walk(rootPath);
for (const file of files) {
  const name = relative(rootPath, file);
  if (forbiddenExtensions.has(extname(file).toLowerCase())) throw new Error(`Forbidden file: ${name}`);
  if (!/[.](?:html|css|js|mjs|json|md|svg)$/i.test(file)) continue;
  const source = await readFile(file, "utf8");
  if (name !== "verify.mjs") {
    for (const pattern of forbiddenText) {
      if (pattern.test(source)) throw new Error(`Private or unsafe text matched in ${name}: ${pattern}`);
    }
  }
}

for (const path of ["gugu/app.js", "gugu/demo.js", "pengu/demo.js"]) {
  const source = await readFile(new URL(path, root), "utf8");
  new vm.Script(source, { filename: path });
}

const guguHtml = await readFile(new URL("gugu/index.html", root), "utf8");
const penguHtml = await readFile(new URL("pengu/index.html", root), "utf8");
const requiredIds = {
  "gugu/index.html": ["wizardNext", "wizardPrevious", "chapterList", "chapterCopy", "readingThemeSelect", "nextPrepToggle"],
  "pengu/index.html": ["showcasePenguDemo", "btnGenerateOutlines", "btnStartEssays", "step2", "step3", "progressFill", "progressText", "essayContainer"]
};
for (const [name, ids] of Object.entries(requiredIds)) {
  const html = name.startsWith("gugu/") ? guguHtml : penguHtml;
  for (const id of ids) {
    if (!html.includes(`id="${id}"`)) throw new Error(`Missing interaction target in ${name}: #${id}`);
  }
}

const inlineScripts = [...penguHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1].trim())
  .filter(Boolean);
for (const [index, source] of inlineScripts.entries()) new vm.Script(source, { filename: `pengu-inline-${index + 1}.js` });

console.log(`Static showcase verification passed (${files.length} files, ${inlineScripts.length} inline scripts).`);
