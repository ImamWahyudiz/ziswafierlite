/**
 * Analyze L1-L4 results: what goes wrong, what goes to unauthorized, and why.
 * This is the key to understanding the user's inconsistency problem.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
globalThis.XLSX = require("../js/vendor/xlsx.full.min.js");
const XLSX = globalThis.XLSX;

const { classifyBatch } = await import("../js/engine/classifier.js");
const ROOT = "C:/Users/Wahyu/Documents/Project/ziswafierlite/test_data";

const master = JSON.parse(readFileSync(`${ROOT}/ziswaf-config.json`, "utf8"));
master.settings.aiMode = "OFF";

function loadXlsx(path) {
  const wb = XLSX.read(new Uint8Array(readFileSync(path)), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { raw: true, defval: "" });
}

function buildGoldenMap(goldenRows) {
  const map = new Map();
  let collisions = 0;
  for (const r of goldenRows) {
    const key = String(r.KETERANGAN ?? "").trim();
    const coa = Number(r["ACCOUNT NUMBER"]) || 0;
    if (map.has(key)) collisions++;
    else map.set(key, { coa, accountName: String(r["ACCOUNT NAME"] ?? "") });
  }
  return { map, collisions };
}

// Process ALL training + test datasets
const DATASETS = [
  { input: `${ROOT}/train/Input/Input 1.xlsx`, golden: `${ROOT}/train/output/Output 1.xlsx`, label: "Train 1" },
  { input: `${ROOT}/train/Input/Input 2.xlsx`, golden: `${ROOT}/train/output/Output 2.xlsx`, label: "Train 2" },
  { input: `${ROOT}/train/Input/Input 3.xlsx`, golden: `${ROOT}/train/output/Output 3.xlsx`, label: "Train 3" },
  { input: `${ROOT}/train/Input/Input 4.xlsx`, golden: `${ROOT}/train/output/Output 4.xlsx`, label: "Train 4" },
  { input: `${ROOT}/test/input/Input 5.xlsx`, golden: `${ROOT}/test/output/Output 5.xlsx`, label: "Test 5" },
  { input: `${ROOT}/test/input/Input 6.xlsx`, golden: `${ROOT}/test/output/Output 6.xlsx`, label: "Test 6" },
];

let totalRows = 0, totalCorrect = 0, totalWrong = 0;
const errorByLayer = {};
const errorByGolden = {};
const wrongDetails = [];

for (const ds of DATASETS) {
  const inputRows = loadXlsx(ds.input);
  const goldenRows = loadXlsx(ds.golden);
  const rows = inputRows.map((o, i) => ({
    id: i + 1,
    rawDate: String(o.Date ?? ""),
    rawLabel: String(o.Label ?? ""),
    rawAmount: Number(o.Amount) || 0,
    partner: String(o.Partner ?? ""),
  }));

  const { map: goldenMap } = buildGoldenMap(goldenRows);

  const classified = await classifyBatch(rows, master);

  let dsCorrect = 0, dsWrong = 0;
  for (const r of classified) {
    const key = String(r.rawLabel ?? "").trim();
    const golden = goldenMap.get(key);
    if (!golden) continue;
    totalRows++;
    if (r.assignedCoa === golden.coa) {
      dsCorrect++;
      totalCorrect++;
    } else {
      dsWrong++;
      totalWrong++;
      if (!errorByLayer[r.matchedLayer]) errorByLayer[r.matchedLayer] = 0;
      errorByLayer[r.matchedLayer]++;
      
      const goldenKey = `${golden.coa}`;
      if (!errorByGolden[goldenKey]) errorByGolden[goldenKey] = 0;
      errorByGolden[goldenKey]++;
      
      wrongDetails.push({
        dataset: ds.label,
        id: r.id,
        label: r.rawLabel?.slice(0, 80),
        cleanedLabel: r.cleanedLabel?.slice(0, 60),
        amount: r.rawAmount,
        expected: golden.coa,
        got: r.assignedCoa,
        layer: r.matchedLayer,
        reasoning: r.reasoning?.slice(0, 60)
      });
    }
  }
  console.log(`${ds.label}: ${dsCorrect}/${dsCorrect + dsWrong} correct (${((dsCorrect / (dsCorrect + dsWrong)) * 100).toFixed(1)}%) | wrong: ${dsWrong}`);
}

console.log(`\n=== OVERALL: ${totalCorrect}/${totalRows} = ${((totalCorrect / totalRows) * 100).toFixed(1)}% ===`);
console.log(`\nErrors by classification layer:`);
for (const [layer, count] of Object.entries(errorByLayer).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${layer}: ${count} wrong`);
}
console.log(`\nErrors by expected COA:`);
for (const [coa, count] of Object.entries(errorByGolden).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${coa}: ${count} wrong`);
}

// Sample wrong rows for each category
console.log(`\n=== SAMPLE WRONG ROWS (up to 5 per expected COA) ===`);
const byExpected = {};
for (const w of wrongDetails) {
  if (!byExpected[w.expected]) byExpected[w.expected] = [];
  if (byExpected[w.expected].length < 5) byExpected[w.expected].push(w);
}
for (const [coa, rows] of Object.entries(byExpected).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\nExpected COA ${coa} (${rows.length} samples):`);
  for (const r of rows) {
    console.log(`  [${r.layer}] "${r.label}" → got ${r.got} (reason: ${r.reasoning})`);
  }
}
