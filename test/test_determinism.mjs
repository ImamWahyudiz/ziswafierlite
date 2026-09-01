/**
 * Determinism Test: Run L1-L4 classification multiple times on same data
 * Checks: same input → same output every time
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
globalThis.XLSX = require("../js/vendor/xlsx.full.min.js");
const XLSX = globalThis.XLSX;

const { classifyBatch } = await import("../js/engine/classifier.js");
const { cleanTransactionText, normalizeForMatch } = await import("../js/engine/sanitizer.js");

const ROOT = "C:/Users/Wahyu/Documents/Project/ziswafierlite/test_data";

// Load master config
const master = JSON.parse(readFileSync(`${ROOT}/ziswaf-config.json`, "utf8"));
master.settings.aiMode = "OFF"; // L1-L4 only, no AI

// Load a single input file
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

// Load input 1
const input1Rows = loadXlsx(`${ROOT}/train/Input/Input 1.xlsx`);
const rows1 = buildRows(input1Rows);

console.log(`Input 1: ${rows1.length} rows`);
console.log(`\nRunning L1-L4 classification 5 times on same data...\n`);

const results = [];
const RUNS = 5;

for (let run = 0; run < RUNS; run++) {
  const t0 = Date.now();
  const classified = await classifyBatch(rows1, master);
  const elapsed = Date.now() - t0;
  
  // Count by layer
  const layerCounts = {};
  let unauthCount = 0;
  for (const r of classified) {
    if (!layerCounts[r.matchedLayer]) layerCounts[r.matchedLayer] = 0;
    layerCounts[r.matchedLayer]++;
    if (r.assignedCoa === master.settings.defaultUnauthorizedCoa) unauthCount++;
  }
  
  results.push({
    run: run + 1,
    elapsed,
    unauthCount,
    layerCounts,
    // Take a fingerprint of first 10 results
    fingerprint: classified.slice(0, 10).map(r => ({
      id: r.id,
      coa: r.assignedCoa,
      layer: r.matchedLayer
    }))
  });
  
  console.log(`Run ${run + 1}: ${elapsed}ms | Unauth: ${unauthCount} | Layers:`, JSON.stringify(layerCounts));
}

// Check determinism
console.log("\n=== DETERMINISM CHECK ===");
const first = results[0];
let allMatch = true;
for (let i = 1; i < results.length; i++) {
  const r = results[i];
  if (r.unauthCount !== first.unauthCount) {
    console.log(`❌ NON-DETERMINISTIC: Run 1 unauth=${first.unauthCount}, Run ${r.run} unauth=${r.unauthCount}`);
    allMatch = false;
  }
  if (JSON.stringify(r.fingerprint) !== JSON.stringify(first.fingerprint)) {
    console.log(`❌ NON-DETERMINISTIC: First 10 results differ on Run ${r.run}`);
    allMatch = false;
  }
}

if (allMatch) {
  console.log("✅ ALL RUNS IDENTICAL — L1-L4 is deterministic");
} else {
  console.log("⚠️ INCONSISTENCY DETECTED — L1-L4 is NOT deterministic");
  // Show which rows differ
  const run1 = [];
  const run2 = [];
  // Re-run once more to find specific differing rows
  const c1 = await classifyBatch(rows1, master);
  const c2 = await classifyBatch(rows1, master);
  let diffCount = 0;
  for (let i = 0; i < c1.length; i++) {
    if (c1[i].assignedCoa !== c2[i].assignedCoa || c1[i].matchedLayer !== c2[i].matchedLayer) {
      diffCount++;
      if (diffCount <= 10) {
        console.log(`  Row ${i+1} (${c1[i].rawLabel?.slice(0,60)}): Run1=${c1[i].assignedCoa}/${c1[i].matchedLayer} vs Run2=${c2[i].assignedCoa}/${c2[i].matchedLayer}`);
      }
    }
  }
  console.log(`  Total differing rows: ${diffCount}`);
}
