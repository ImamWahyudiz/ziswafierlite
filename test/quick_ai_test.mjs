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

const inputRows = loadXlsx(`${ROOT}/train/Input/Input 1.xlsx`);
const rows = inputRows.map((o, i) => ({
  id: i+1, rawDate: String(o.Date??""), rawLabel: String(o.Label??""), rawAmount: Number(o.Amount)||0, partner: String(o.Partner??""),
}));

// Find leftovers (L1-L4 wrong rows)
master.settings.aiMode = "OFF";
const l1l4 = await classifyBatch(rows, master);
const goldenMap = new Map();
const goldenWb = XLSX.read(new Uint8Array(readFileSync(`${ROOT}/train/output/Output 1.xlsx`)), { type: "array" });
const gd = XLSX.utils.sheet_to_json(goldenWb.Sheets[goldenWb.SheetNames[0]], { raw: true, defval: "" });
for (const r of gd) { const k = String(r.KETERANGAN??"").trim(); if (!goldenMap.has(k)) goldenMap.set(k, Number(r["ACCOUNT NUMBER"])||0); }

const leftovers = [];
for (const r of l1l4) {
  const k = String(r.rawLabel??"").trim();
  if (goldenMap.has(k) && r.assignedCoa !== goldenMap.get(k)) leftovers.push(r);
}

console.log(`L1-L4 wrong: ${leftovers.length}/${rows.length}`);
console.log(`Testing AI on ${leftovers.length} leftovers, 3 runs...\n`);

// Enable AI
master.settings.aiMode = "GEMINI";
const RUNS = 3;
const allResults = [];

for (let run = 0; run < RUNS; run++) {
  clearAiCache();
  const t0 = Date.now();
  const classified = await classifyBatch(rows, master);
  const elapsed = Date.now() - t0;

  const byLabel = new Map();
  for (const r of classified) {
    const k = String(r.rawLabel??"").trim();
    if (!byLabel.has(k)) byLabel.set(k, []);
    byLabel.get(k).push(r);
  }

  // Count how many of the leftovers were correctly classified
  let fixedCorrect = 0, fixedWrong = 0, unchanged = 0;
  for (const l of leftovers) {
    const k = String(l.rawLabel??"").trim();
    const results = byLabel.get(k);
    if (results && results.length > 0) {
      const final = results[results.length - 1];
      const expectedCoa = goldenMap.get(k);
      if (final.assignedCoa === expectedCoa) fixedCorrect++;
      else fixedWrong++;
    } else unchanged++;
  }

  const unauthCount = classified.filter(r => r.matchedLayer === "UNAUTHORIZED_FALLBACK").length;
  console.log(`Run ${run+1}: ${elapsed}ms | unauth: ${unauthCount} | AI fixed correct: ${fixedCorrect} | AI fixed wrong: ${fixedWrong}`);
  allResults.push({ byLabel, unauthCount, fixedCorrect, fixedWrong });
}

// Compare consistency
console.log("\n=== CONSISTENCY ===");
let same = 0, diff = 0;
for (const l of leftovers) {
  const k = String(l.rawLabel??"").trim();
  const coas = allResults.map(r => r.byLabel.get(k)?.[r.byLabel.get(k)?.length-1]?.assignedCoa);
  if (coas[0] === coas[1] && coas[1] === coas[2]) same++;
  else { diff++; if (diff <= 10) console.log(`  FLIP: "${k.slice(0,60)}" → ${coas.join("/")}`); }
}
console.log(`Consistent: ${same}/${leftovers.length}, Inconsistent: ${diff}`);

// Unauth variance
const unauthCounts = allResults.map(r => r.unauthCount);
console.log(`Unauth variance: ${Math.min(...unauthCounts)}-${Math.max(...unauthCounts)} (range ${Math.max(...unauthCounts)-Math.min(...unauthCounts)})`);

function loadXlsx(path) {
  const wb = XLSX.read(new Uint8Array(readFileSync(path)), { type: "array" });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: true, defval: "" });
}
