/**
 * AI Determinism Test: Only send L1-L4 leftovers to AI, 3 runs.
 * Measures: is AI consistent for the same labels?
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
master.settings.aiMode = "GEMINI";

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

function buildGoldenMap(goldenRows) {
  const map = new Map();
  for (const r of goldenRows) {
    const key = String(r.KETERANGAN ?? "").trim();
    const coa = Number(r["ACCOUNT NUMBER"]) || 0;
    if (!map.has(key)) map.set(key, { coa });
  }
  return map;
}

const DATASETS = [
  { input: `${ROOT}/train/Input/Input 1.xlsx`, golden: `${ROOT}/train/output/Output 1.xlsx`, label: "Train 1" },
  { input: `${ROOT}/train/Input/Input 2.xlsx`, golden: `${ROOT}/train/output/Output 2.xlsx`, label: "Train 2" },
  { input: `${ROOT}/train/Input/Input 3.xlsx`, golden: `${ROOT}/train/output/Output 3.xlsx`, label: "Train 3" },
  { input: `${ROOT}/train/Input/Input 4.xlsx`, golden: `${ROOT}/train/output/Output 4.xlsx`, label: "Train 4" },
  { input: `${ROOT}/test/input/Input 5.xlsx`, golden: `${ROOT}/test/output/Output 5.xlsx`, label: "Test 5" },
  { input: `${ROOT}/test/input/Input 6.xlsx`, golden: `${ROOT}/test/output/Output 6.xlsx`, label: "Test 6" },
];

// First: run L1-L4 on ALL datasets to collect leftover wrong rows
console.log("=== PHASE 1: Collecting leftover wrong rows from L1-L4 ===");
const allLeftovers = [];
let totalL1L4 = 0, correctL1L4 = 0;

for (const ds of DATASETS) {
  const inputRows = loadXlsx(ds.input);
  const goldenRows = loadXlsx(ds.golden);
  const rows = buildRows(inputRows);
  const goldenMap = buildGoldenMap(goldenRows);

  const classified = await classifyBatch(rows, master);
  
  for (const r of classified) {
    const key = String(r.rawLabel ?? "").trim();
    const golden = goldenMap.get(key);
    if (!golden) continue;
    totalL1L4++;
    if (r.assignedCoa === golden.coa) {
      correctL1L4++;
    } else {
      allLeftovers.push({ ...r, dataset: ds.label, expected: golden.coa });
    }
  }
}

console.log(`L1-L4: ${correctL1L4}/${totalL1L4} correct (${((correctL1L4 / totalL1L4) * 100).toFixed(1)}%)`);
console.log(`Leftovers for AI: ${allLeftovers.length}`);

// Now run AI on these leftovers 3 times and compare results
console.log(`\n=== PHASE 2: Testing AI consistency on ${allLeftovers.length} leftovers, 3 runs ===`);

const RUNS = 3;
const aiResults = [];

for (let run = 0; run < RUNS; run++) {
  clearAiCache();
  const t0 = Date.now();
  const classified = await classifyBatch(rowsForAI(allLeftovers), master);
  const elapsed = Date.now() - t0;

  // Build lookup: label → { coa, confidence, reason }
  const byLabel = new Map();
  for (const r of classified) {
    const key = r.rawLabel ?? '';
    byLabel.set(key, { coa: r.assignedCoa, confidence: r.confidence, reasoning: r.reasoning, layer: r.matchedLayer });
  }
  
  aiResults.push({ run: run + 1, elapsed, byLabel });
  console.log(`Run ${run + 1}: ${elapsed}ms | AI classified: ${classified.filter(r => r.matchedLayer === 'AI_SEMANTIC').length}/${allLeftovers.length} | Unauth: ${classified.filter(r => r.matchedLayer === 'UNAUTHORIZED_FALLBACK').length}`);
}

// Compare AI consistency
console.log(`\n=== AI CONSISTENCY CHECK ===`);
let consistent = 0, inconsistent = 0;
const flipExamples = [];

for (const leftover of allLeftovers) {
  const key = leftover.rawLabel ?? '';
  const r1 = aiResults[0].byLabel.get(key);
  const r2 = aiResults[1].byLabel.get(key);
  const r3 = aiResults[2].byLabel.get(key);
  
  if (r1 && r2 && r3 && r1.coa === r2.coa && r2.coa === r3.coa) {
    consistent++;
  } else {
    inconsistent++;
    if (flipExamples.length < 10) {
      flipExamples.push({
        label: key.slice(0, 80),
        expected: leftover.expected,
        run1: `${r1?.coa}/${r1?.layer}`,
        run2: `${r2?.coa}/${r2?.layer}`,
        run3: `${r3?.coa}/${r3?.layer}`,
      });
    }
  }
}

console.log(`Consistent: ${consistent}/${allLeftovers.length}`);
console.log(`Inconsistent: ${inconsistent}/${allLeftovers.length}`);
if (flipExamples.length > 0) {
  console.log(`\nFlip examples:`);
  for (const f of flipExamples) {
    console.log(`  "${f.label}" expected=${f.expected} | R1=${f.run1} | R2=${f.run2} | R3=${f.run3}`);
  }
}

function rowsForAI(leftovers) {
  return leftovers.map(l => ({
    id: l.id, rawDate: l.rawDate, rawLabel: l.rawLabel,
    rawAmount: l.rawAmount, partner: l.partner,
  }));
}
