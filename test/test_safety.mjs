/**
 * SAFETY TEST: Measure wrong-guessing rate vs safe-unauthorized rate.
 * The key metric: how many rows does the engine GUESS WRONG (bad) 
 * vs how many it safely sends to Unauthorized (good, reviewable).
 * 
 * We do NOT optimize for golden accuracy. We optimize for:
 *  - Consistency (deterministic)
 *  - Not guessing wrong (low wrong-guess rate)
 *  - Safety (tie → Unauthorized)
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
globalThis.XLSX = require("../js/vendor/xlsx.full.min.js");
const XLSX = globalThis.XLSX;

const { classifyBatch } = await import("../js/engine/classifier.js");
const ROOT = "C:/Users/Wahyu/Documents/Project/ziswafierlite/test_data";

const master = JSON.parse(readFileSync(`${ROOT}/ziswaf-config.json`, "utf8"));
master.settings.aiMode = "OFF"; // L1-L4 only

function loadXlsx(path) {
  const wb = XLSX.read(new Uint8Array(readFileSync(path)), { type: "array" });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: true, defval: "" });
}

function buildGolden(goldenRows) {
  const map = new Map();
  for (const r of goldenRows) {
    const k = String(r.KETERANGAN ?? "").trim();
    if (!map.has(k)) map.set(k, Number(r["ACCOUNT NUMBER"]) || 0);
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

let total = 0, correct = 0, wrongGuess = 0, safeUnauth = 0, unmatched = 0;
const wrongGuesses = [];

for (const ds of DATASETS) {
  const inputRows = loadXlsx(ds.input);
  const goldenRows = loadXlsx(ds.golden);
  const rows = inputRows.map((o, i) => ({
    id: i+1, rawDate: String(o.Date ?? ""), rawLabel: String(o.Label ?? ""), rawAmount: Number(o.Amount) || 0, partner: String(o.Partner ?? ""),
  }));
  const golden = buildGolden(goldenRows);

  const results = await classifyBatch(rows, master);
  let dsCorrect = 0, dsWrong = 0, dsUnauth = 0, dsUnmatched = 0;

  for (const r of results) {
    const key = String(r.rawLabel ?? "").trim();
    const expected = golden.get(key);
    if (!expected) { dsUnmatched++; continue; }
    total++;
    if (r.assignedCoa === expected) { dsCorrect++; correct++; }
    else if (r.matchedLayer === "UNAUTHORIZED_FALLBACK") { dsUnauth++; safeUnauth++; }
    else { dsWrong++; wrongGuess++; wrongGuesses.push({ ds: ds.label, label: r.rawLabel?.slice(0, 80), expected, got: r.assignedCoa, layer: r.matchedLayer }); }
  }

  console.log(`${ds.label}: ${dsCorrect} correct | ${dsWrong} WRONG-GUESS | ${dsUnauth} safe-unauth | ${dsUnmatched} unmatched`);
}

const pct = (n) => ((n / total) * 100).toFixed(1);
console.log(`\n=== SAFETY SUMMARY ===`);
console.log(`Total: ${total}`);
console.log(`Correct: ${correct} (${pct(correct)}%)`);
console.log(`⚠️ WRONG GUESSING: ${wrongGuess} (${pct(wrongGuess)}%) ← THIS IS THE PROBLEM`);
console.log(`✅ Safe Unauthorized: ${safeUnauth} (${pct(safeUnauth)}%)`);
console.log(`Unmatched (no golden): ${unmatched}`);

// Show wrong guesses grouped by what they got
const byGot = {};
for (const w of wrongGuesses) {
  const k = `${w.got}`;
  if (!byGot[k]) byGot[k] = [];
  if (byGot[k].length < 8) byGot[k].push(w);
}
console.log(`\n=== WRONG GUESSES BY GUESSED COA (up to 8 each) ===`);
for (const [coa, rows] of Object.entries(byGot).sort((a,b)=>b[1].length-a[1].length)) {
  console.log(`\nGuessed ${coa}:`);
  for (const w of rows) {
    console.log(`  [${w.layer}] "${w.label}" (expected ${w.expected})`);
  }
}