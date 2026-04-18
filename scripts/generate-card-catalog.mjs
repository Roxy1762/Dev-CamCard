import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const RULES_DIR = path.join(repoRoot, "data/cards/rules");
const TEXT_DIR = path.join(repoRoot, "data/cards/text/zh-CN");
const OUTPUT_FILE = path.join(repoRoot, "docs/card-catalog.generated.md");

const mdEscape = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");

async function listJsonFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function normalizeRules(filesData) {
  const cards = [];
  for (const fileData of filesData) {
    if (!Array.isArray(fileData)) continue;
    for (const card of fileData) {
      if (!card || typeof card !== "object" || !card.id) continue;
      cards.push(card);
    }
  }
  return cards;
}

function normalizeText(filesData) {
  const byId = new Map();
  for (const fileData of filesData) {
    if (!fileData || typeof fileData !== "object" || !fileData.cards) continue;
    for (const [id, text] of Object.entries(fileData.cards)) {
      if (!id || !text || typeof text !== "object") continue;
      byId.set(id, {
        name: text.name ?? "",
        body: text.body ?? "",
      });
    }
  }
  return byId;
}

function buildMarkdown(cards, textById) {
  const lines = [];
  lines.push("# 卡牌目录（自动生成）");
  lines.push("");
  lines.push("> 本文件由 `pnpm generate:card-catalog` 基于 `data/cards/rules/*.json` 与 `data/cards/text/zh-CN/*.json` 自动生成，请勿手改。\n");
  lines.push("| card id | 中文名 | cost | lane | type | rarity | 主要效果文本 |\n|---|---|---:|---|---|---|---|");

  for (const card of cards) {
    const text = textById.get(card.id) ?? { name: "", body: "" };
    lines.push(
      `| ${mdEscape(card.id)} | ${mdEscape(text.name || card.id)} | ${mdEscape(card.cost)} | ${mdEscape(card.lane)} | ${mdEscape(card.type)} | ${mdEscape(card.rarity)} | ${mdEscape(text.body)} |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

async function main() {
  const [ruleFiles, textFiles] = await Promise.all([listJsonFiles(RULES_DIR), listJsonFiles(TEXT_DIR)]);
  const [ruleData, textData] = await Promise.all([
    Promise.all(ruleFiles.map(readJson)),
    Promise.all(textFiles.map(readJson)),
  ]);

  const cards = normalizeRules(ruleData).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const textById = normalizeText(textData);
  const markdown = buildMarkdown(cards, textById);

  await fs.writeFile(OUTPUT_FILE, markdown, "utf8");
  console.log(`Generated ${path.relative(repoRoot, OUTPUT_FILE)} with ${cards.length} cards.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
