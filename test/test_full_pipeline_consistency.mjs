/**
 * Full Pipeline Determinism Test (L1-L5 with AI ON)
 * Runs the SAME data through the full pipeline 3 times and compares results.
 * The goal: quantify how much variance AI (L5) introduces vs L1-L4.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
globalThis.XLSX = require("../js/vendor/xlsx.full.min.js");
const XLSX = globalThis.XLSX;

const { clearAiCache } = await import("../js/engine/ai_matcher.js");
const { classifyBatch } = await import("../js/engine/classifier.js");

const ROOT = "C:/Users/Wahyu/Documents/Project/ziswafierlite/test_data";
const master = JSON.parse(readFileSync(`${ROOT}/ziswaf-config.json`, "utf8"));
// AI ON for full pipeline
master.settings.aiMode = "GEMINI";
master.settings.aiApiKey = "REDACTED";

function loadXlsx(path) {
  const wb = XLSX.read(new Uint8Array(readFileSync(path)), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { raw: true, defval: "" });
}

function buildRows(inputRows) {
  return inputRows.map((o, i) => ({
    id: i + 1,
    rawDate: String(o.Date ?? ""),
    rawLabel: String(o.Label ?? ""),
    rawAmount: Number(o.Amount) || 0,
    partner: String(o.Partner ?? ""),
  }));
}

// Use a smaller file for speed - Input 1 (999 rows) but dedupe labels first (AI caches by label)
const input1Rows = loadXlsx(`${ROOT}/train/Input/Input 1.xlsx`);
const rows1 = buildRows(input1Rows);

console.log(`Input 1: ${rows1.length} rows, AI=GEMINI`);
console.log(`Running full pipeline 3 times...\n`);

const RUNS = 3;
const runs = [];

for (let run = 0; run < RUNS; run++) {
  clearAiCache(); // fresh cache each run to simulate fresh upload
  const t0 = Date.now();
  const classified = await classifyBatch(rows1, master);
  const elapsed = Date.now() - t0;

  const layerCounts = {};
  const coaCounts = {};
  for (const r of classified) {
    if (!layerCounts[r.matchedLayer]) layerCounts[r.matchedLayer] = 0;
    layerCounts[r.matchedLayer]++;
    if (!coaCounts[r.assignedCoa]) coaCounts[r.assignedCoa] = 0;
    coaCounts[r.assignedCoa]++;
  }

  runs.push({ run: run + 1, elapsed, layerCounts, coaCounts, classified });
  console.log(
    `Run ${run + 1}: ${elapsed}ms | Layers:`,
    JSON.stringify(layerCounts)
  );
}

// Compare coa assignment consistency across runs
console.log("\n=== CONSISTENCY CHECK (full pipeline with AI) ===");
const r1 = runs[0], r2 = runs[1], r3 = runs[2];
let consistentPairs = 0;
const diffs12 = [], diffs23 = [], diffs13 = [];

for (let i = 0; i < r1.classified.length; i++) {
  const c1 = r1.classified[i], c2 = r2.classified[i], c3 = r3.classified[i];
  if (c1.assignedCoa === c2.assignedCoa && c2.assignedCoa === c3.assignedCoa) consistentPairs++;
  if (c1.assignedCoa !== c2.assignedCoa) diffs12.push({ i, label: c1.rawLabel?.slice(0, 60), coa1: c1.assignedCoa, layer1: c1.matchedLayer, coa2: c2.assignedCoa, layer2: c2.matchedLayer });
  if (c2.assignedCoa !== c3.assignedCoa) diffs23.push({ i, label: c2.rawLabel?.slice(0, 60), coa2: c2.assignedCoa, layer2: c2.matchedLayer, coa3: c3.assignedCoa, layer3: c3.matchedLayer });
  if (c1.assignedCoa !== c3.assignedCoa) diffs13.push({ i, label: c1.rawLabel?.slice(0, 60), coa1: c1.assignedCoa, coa3: c3.assignedCoa });
}

console.log(`Rows identical across all 3 runs: ${consistentPairs}/${r1.classified.length}`);
console.log(`Run1 vs Run2 differ: ${diffs12.length}`);
console.log(`Run2 vs Run3 differ: ${diffs23.length}`);
console.log(`Run1 vs Run3 differ: ${diffs13.length}`);

// Show examples of inconsistency
const uniqueDiffLabels = new Set();
for (const d of diffs12) uniqueDiffLabels.add(d.label);
for (const d of diffs23) uniqueDiffLabels.add(d.label);

console.log(`\nUnique labels that flip: ${uniqueDiffLabels.size}`);
let shown = 0;
for (const label of uniqueDiffLabels) {
  if (shown >= 12) break;
  const all = runs.flatMap((r, idx) => {
    const found = r.classified.find(c => c.rawLabel === label);
    return found ? [`Run${idx + 1}:${found.assignedCoa}/${found.matchedLayer}`] : [];
  });
  console.log(`  "${label}" → ${all.join(' | ')}`);
  shown++;
}