import assert from "node:assert";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
globalThis.XLSX = require("../js/vendor/xlsx.full.min.js");
const XLSX = globalThis.XLSX;

const { DEFAULT_MASTER_DATA } = await import("../js/config/default_presets.js");
const { cleanTransactionText } = await import("../js/engine/sanitizer.js");
const { classifySingle, classifyBatch } = await import("../js/engine/classifier.js");
const store = await import("../js/store/master_store.js");
const adapter = await import("../js/services/excel_adapter.js");

let passed = 0;
let failed = 0;
const fails = [];
function ok(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  PASS ${name}`); })
    .catch((e) => { failed++; fails.push(name); console.log(`  FAIL ${name}: ${e.message}`); });
}
function serialToISO(n) {
  return XLSX.SSF ? XLSX.SSF.format("yyyy-mm-dd", n) : new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
}

console.log("== UNIT: SANITIZER ==");
const ALIASES = DEFAULT_MASTER_DATA.companyAliases;
await ok("bifast prefix stripped + sender extracted", () => {
  const r = cleanTransactionText("BIFAST - TRF DARI - BANK MANDIRI - BUDI SANTOSO - wakaf", ALIASES);
  assert.strictEqual(r.extractedSenderName, "BUDI SANTOSO");
  assert.ok(!r.cleanedLabel.toLowerCase().includes("bifast"));
});
await ok("trf dari simple sender", () => {
  const r = cleanTransactionText("TRF DARI - SINTA PATIMAH", []);
  assert.strictEqual(r.extractedSenderName, "SINTA PATIMAH");
});
await ok("bank token skipped in sender extraction", () => {
  const r = cleanTransactionText("TRF DARI - BCA - TITIK SUNARNI", []);
  assert.strictEqual(r.extractedSenderName, "TITIK SUNARNI");
});
await ok("company alias removed", () => {
  const r = cleanTransactionText("Transfer zakat ke Yayasan Amil Zakat Kebumen program quran", ALIASES);
  assert.ok(!r.cleanedLabel.toLowerCase().includes("yayasan amil"));
});
await ok("dana wallet noise removed", () => {
  const r = cleanTransactionText("TRF DARI - ANDI PRATAMA - Dana20250214Danaidj1010O9995748782S", []);
  assert.ok(!/dana\d{8}/i.test(r.cleanedLabel));
});

console.log("== UNIT: CLASSIFIER ROUTING ==");
const M = JSON.parse(JSON.stringify(DEFAULT_MASTER_DATA));
M.settings.aiMode = "OFF";
const tx = (id, label, amount) => ({ id, rawDate: "2025-08-01", rawLabel: label, rawAmount: amount });
await ok("L1 negative amount -> 60100008", async () => {
  const r = await classifySingle(tx(1, "TRF KE - 123456789 - Biaya operasional", -150000), M);
  assert.strictEqual(r.matchedLayer, "EXPENSE");
  assert.strictEqual(r.assignedCoa, 60100008);
});
await ok("L1 'TRF KE' outflow -> EXPENSE", async () => {
  const r = await classifySingle(tx(2, "TRF KE - 009876543210", 25000), M);
  assert.strictEqual(r.matchedLayer, "EXPENSE");
});
await ok("L2 tail code -> campaign program COA", async () => {
  const r = await classifySingle(tx(3, "TRANSFER IN", 2500101), M);
  assert.strictEqual(r.matchedLayer, "CAMPAIGN_TAIL");
  assert.strictEqual(r.assignedProgramId, "prog-zkt-maal");
});
await ok("L3 registered donor -> routine program", async () => {
  const r = await classifySingle(tx(4, "TRF DARI - BCA - TITIK SUNARNI", 10000), M);
  assert.strictEqual(r.matchedLayer, "DONATUR_TETAP");
  assert.strictEqual(r.assignedProgramId, "prog-sdq-subuh");
});
await ok("L4 keyword -> program COA (not unauthorized)", async () => {
  const r = await classifySingle(tx(5, "sedekah pembelian mushaf quran", 50000), M);
  assert.strictEqual(r.matchedLayer, "KEYWORD");
  assert.notStrictEqual(r.assignedCoa, 40201000);
});
await ok("blind inflow -> 40201000 Unauthorized", async () => {
  const r = await classifySingle(tx(6, "INCOMING TRANSFER XYZQW", 77777), M);
  assert.strictEqual(r.matchedLayer, "UNAUTHORIZED_FALLBACK");
  assert.strictEqual(r.assignedCoa, 40201000);
});
await ok("alias-only label -> 40201001 Umum (ORG_ALIAS)", async () => {
  const r = await classifySingle(tx(7, "Yayasan Amil Zakat Kebumen", 100000), M);
  assert.strictEqual(r.matchedLayer, "ORG_ALIAS");
  assert.strictEqual(r.assignedCoa, 40201001);
});
await ok("alias + other text -> still Unauthorized", async () => {
  const r = await classifySingle(tx(8, "Yayasan Amil Zakat Kebumen transfer dana", 100000), M);
  assert.strictEqual(r.matchedLayer, "UNAUTHORIZED_FALLBACK");
});

console.log("== UNIT: MASTER STORE ==");
store.resetToDefaults();
await ok("defaults present after reset", () => {
  const m = store.getMaster();
  assert.ok(m.coaList && m.coaList.length >= 20);
  for (const code of [40201000, 40201001, 60100008]) assert.ok(m.coaList.some((c) => Number(c.code) === code), `missing ${code}`);
});
await ok("updateMaster patch visible + notify", () => {
  let notified = false;
  const unsub = store.subscribe(() => { notified = true; });
  store.updateMaster({ companyAliases: ["test-alias"] });
  unsub();
  assert.ok(notified);
  assert.strictEqual(store.getMaster().companyAliases[0], "test-alias");
});
store.resetToDefaults();

console.log("== E2E PARITY: sample/inputt.xlsx vs sample/output.xlsx ==");
let parityPct = -1;
try {
  const inBuf = new Uint8Array(readFileSync("sample/inputt.xlsx"));
  const rows = await adapter.parseBankStatement(inBuf);
  assert.ok(rows.length > 0, `parseBankStatement returned ${rows.length} rows`);
  const masterOff = JSON.parse(JSON.stringify(store.getMaster()));
  masterOff.settings.aiMode = "OFF";
  const classified = await classifyBatch(rows, masterOff);

  assert.strictEqual(classified.length, rows.length, "journal rows != input rows");
  const unclassified = classified.filter((r) => !r.assignedCoa);
  assert.strictEqual(unclassified.length, 0, `${unclassified.length} rows unclassified`);

  const sumIn = rows.reduce((a, r) => a + Number(r.rawAmount || 0), 0);
  const sumOut = classified.reduce((a, r) => a + Number(r.rawAmount || 0), 0);
  assert.ok(Math.abs(sumIn - sumOut) < 1e-6, `totals diverge: ${sumIn} vs ${sumOut}`);

  const outWb = XLSX.read(new Uint8Array(readFileSync("sample/output.xlsx")), { type: "array" });
  const golden = XLSX.utils.sheet_to_json(outWb.Sheets[outWb.SheetNames[0]], { header: 1, raw: true }).slice(1)
    .filter((r) => r && r.length >= 5 && r[0] !== "" && r[0] != null)
    .map((r) => ({ date: String(r[0]), coa: Number(r[1]), ket: String(r[4] ?? "").trim() }));

  let matched = 0;
  let mismatched = 0;
  let covered = 0;
  const diffs = [];
  for (const r of classified) {
    const key = String(r.rawLabel).trim();
    const isoDate = String(r.rawDate).slice(0, 10);
    const g = golden.find((x) => x.ket === key && serialToISO(Number(x.date)) === isoDate);
    if (!g) continue;
    covered++;
    if (Number(g.coa) === Number(r.assignedCoa)) matched++;
    else { mismatched++; diffs.push(`    [DIFF] "${key.slice(0, 48)}" expected=${g.coa} actual=${r.assignedCoa} (${r.matchedLayer})`); }
  }
  parityPct = matched + mismatched > 0 ? Math.round((matched / (matched + mismatched)) * 100) : 0;
  console.log(`  input rows: ${rows.length}, classified: ${classified.length}`);
  console.log(`  golden coverage: ${covered}/${rows.length} (output.xlsx is a larger production export)`);
  console.log(`  parity vs production golden: ${matched}/${matched + mismatched} = ${parityPct}%`);
  for (const d of diffs.slice(0, 12)) console.log(d);
  console.log("  (mismatches are WARN-only: production golden ran with AI layer enabled)");
  assert.ok(parityPct >= 50, `parity too low: ${parityPct}%`);
} catch (e) {
  failed++; fails.push("E2E parity");
  console.log(`  FAIL E2E parity: ${e.message}`);
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed, parity=${parityPct < 0 ? "n/a" : parityPct + "%"}`);
if (fails.length) console.log("Failed: " + fails.join("; "));
process.exit(failed ? 1 : 0);
