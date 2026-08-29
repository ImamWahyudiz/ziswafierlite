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

console.log("== UNIT: INPUT SANITIZERS & VALIDATION ==");
const { sanitizeInputText, sanitizeSlug, sanitizePhone, sanitizeCoaCode } = await import("../js/engine/sanitizer.js");

await ok("sanitizeInputText removes script tags and escapes control chars", () => {
  const dirty = "<script>alert('xss')</script><b>Program Peduli</b> \n\r\t";
  const clean = sanitizeInputText(dirty, 50);
  assert.strictEqual(clean, "Program Peduli");
  assert.ok(!clean.includes("<script>"));
});

await ok("sanitizeSlug converts to valid identifier", () => {
  assert.strictEqual(sanitizeSlug("Prog Sedekah Subuh #01!"), "prog-sedekah-subuh-01");
  assert.strictEqual(sanitizeSlug("---prog_test---"), "prog_test");
});

await ok("sanitizePhone strips non-digits and normalizes", () => {
  assert.strictEqual(sanitizePhone("+62 812-3456-7890"), "+6281234567890");
  assert.strictEqual(sanitizePhone("0812-999-888"), "0812999888");
});

await ok("sanitizeCoaCode parses valid account code numbers", () => {
  assert.strictEqual(sanitizeCoaCode("40201001"), 40201001);
  assert.strictEqual(sanitizeCoaCode(" 40201002 "), 40201002);
  assert.strictEqual(sanitizeCoaCode("invalid"), null);
});

console.log("== UNIT: MASTER STORE & IMPORT/EXPORT ==");
store.resetToDefaults();
await ok("defaults present after reset", () => {
  const m = store.getMaster();
  assert.ok(m.coaList && m.coaList.length >= 20);
  for (const code of [40201000, 40201001, 60100008]) assert.ok(m.coaList.some((c) => Number(c.code) === code), `missing ${code}`);
});

await ok("importMasterFromExcel imports PROGRAM-ONLY sheet without COA sheet", () => {
  store.resetToDefaults();
  const progRows = [
    { 'ID': 'prog-custom-1', 'NAMA PROGRAM': 'Peduli Yatim Piatu', 'COA': 40202101, 'KODE EKOR': '123', 'KEYWORDS': 'yatim;piatu' },
    { 'ID': 'prog-custom-2', 'NAMA PROGRAM': 'Wakaf Sumur Air', 'COA': 40202102, 'KODE EKOR': '124', 'KEYWORDS': 'wakaf;sumur' }
  ];
  const ws = XLSX.utils.json_to_sheet(progRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Program');
  
  const res = store.importMasterFromExcel(wb, 'merge');
  assert.strictEqual(res.programCount, 2);
  const m = store.getMaster();
  const found = m.programs.find(p => p.id === 'prog-custom-1');
  assert.ok(found, "Imported program-only sheet should insert program into store");
  assert.strictEqual(found.name, 'Peduli Yatim Piatu');
});

await ok("importMasterFromExcel support replace mode", () => {
  store.resetToDefaults();
  const progRows = [
    { 'ID': 'prog-unique-only', 'NAMA PROGRAM': 'Program Khusus', 'COA': 40202101 }
  ];
  const ws = XLSX.utils.json_to_sheet(progRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Program');
  
  store.importMasterFromExcel(wb, 'replace');
  const m = store.getMaster();
  assert.ok(m.programs.some(p => p.id === 'prog-unique-only'));
  // No artificial baseline programs should be injected
  assert.strictEqual(m.programs.length, 1);
  assert.ok(!m.programs.some(p => p.id === 'BASELINE_ZAKAT'));
});

await ok("importConfigFromJson roundtrip export & import (replace & merge)", () => {
  store.resetToDefaults();
  store.addAlias("Yayasan Berkah Bersama");
  const jsonStr = store.exportConfigToJson();
  
  // Test valid json
  store.resetToDefaults();
  assert.ok(!store.getMaster().companyAliases.includes("Yayasan Berkah Bersama"));
  
  store.importConfigFromJson(jsonStr, 'replace');
  assert.ok(store.getMaster().companyAliases.includes("Yayasan Berkah Bersama"));
});

await ok("batchDelete functions work properly on COA, Program, Donor, Alias", () => {
  store.resetToDefaults();
  store.addCoa({ code: 49999001, name: "Akun Hapus 1", category: "UMUM" });
  store.addCoa({ code: 49999002, name: "Akun Hapus 2", category: "UMUM" });
  
  let m = store.getMaster();
  const idx1 = m.coaList.findIndex(c => c.code === 49999001);
  const idx2 = m.coaList.findIndex(c => c.code === 49999002);
  assert.ok(idx1 >= 0 && idx2 >= 0);
  
  const deletedCoa = store.batchDeleteCoa([idx1, idx2]);
  assert.strictEqual(deletedCoa, 2);
  assert.ok(!store.getMaster().coaList.some(c => c.code === 49999001 || c.code === 49999002));
});

await ok("updateMaster patch visible + notify", () => {
  let notified = false;
  const unsub = store.subscribe(() => { notified = true; });
  store.updateMaster({ companyAliases: ["test-alias"] });
  unsub();
  assert.ok(notified);
  assert.strictEqual(store.getMaster().companyAliases[0], "test-alias");
});

await ok("updateSystemAccounts configures custom codes & names and syncs to coaList", () => {
  store.resetToDefaults();
  store.updateSystemAccounts({
    unauthCode: 41000000,
    unauthName: "Dana Karantina Belum Jelas",
    umumCode: 42000000,
    umumName: "Dana Infak Kotak Keliling",
    expenseCode: 51000000,
    expenseName: "Biaya Operasional Kantor"
  });

  const sys = store.getSystemCodes();
  assert.strictEqual(sys.unauth, 41000000);
  assert.strictEqual(sys.unauthName, "Dana Karantina Belum Jelas");
  assert.strictEqual(sys.umum, 42000000);
  assert.strictEqual(sys.umumName, "Dana Infak Kotak Keliling");
  assert.strictEqual(sys.expense, 51000000);
  assert.strictEqual(sys.expenseName, "Biaya Operasional Kantor");

  const m = store.getMaster();
  assert.ok(m.coaList.some(c => c.code === 41000000 && c.name === "Dana Karantina Belum Jelas"));
  assert.ok(m.coaList.some(c => c.code === 42000000 && c.name === "Dana Infak Kotak Keliling"));
  assert.ok(m.coaList.some(c => c.code === 51000000 && c.name === "Biaya Operasional Kantor"));
});

await ok("importMasterFromExcel correctly maps NO AKUN and NAMA AKUN without number duplication", () => {
  store.resetToDefaults();
  const coaRows = [
    { "NO AKUN": 40100102, "NAMA AKUN": "Zakat Fitrah Ramadan", "KATEGORI": "ZAKAT" },
    { "NO AKUN": 40201002, "NAMA AKUN": "Infak Kemanusiaan Palestina", "KATEGORI": "INFAK / SEDEKAH" }
  ];
  const ws = XLSX.utils.json_to_sheet(coaRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "COA");

  const res = store.importMasterFromExcel(wb, "replace", "coa");
  assert.strictEqual(res.coaCount, 2);

  const m = store.getMaster();
  const zakat = m.coaList.find(c => c.code === 40100102);
  assert.ok(zakat, "COA 40100102 should exist");
  assert.strictEqual(zakat.code, 40100102);
  assert.strictEqual(zakat.name, "Zakat Fitrah Ramadan", "Account name should be 'Zakat Fitrah Ramadan', NOT the account number");
  
  // Ensure it was NOT imported into Donatur
  assert.strictEqual(res.donorCount, 0);
  assert.ok(!m.donors.some(d => d.name === "Zakat Fitrah Ramadan"));
});
store.resetToDefaults();

console.log("== UNIT: SESSION STORE ==");
const sessionStore = await import("../js/store/session_store.js");
await ok("sessionStore deleteRows and restoreRows", () => {
  sessionStore.setRows([
    { id: "tx-1", transactionDate: "2025-08-01", rawAmount: 100000, assignedCoa: 40201001 },
    { id: "tx-2", transactionDate: "2025-08-02", rawAmount: 200000, assignedCoa: 40201001 },
    { id: "tx-3", transactionDate: "2025-08-03", rawAmount: 300000, assignedCoa: 40201001 },
  ]);
  assert.strictEqual(sessionStore.getRowCount(), 3);
  
  sessionStore.deleteRows(["tx-1", "tx-3"]);
  assert.strictEqual(sessionStore.getRowCount(), 1);
  assert.strictEqual(sessionStore.getRows()[0].id, "tx-2");
  
  sessionStore.restoreRows([
    { id: "tx-1", transactionDate: "2025-08-01", rawAmount: 100000, assignedCoa: 40201001 },
    { id: "tx-3", transactionDate: "2025-08-03", rawAmount: 300000, assignedCoa: 40201001 }
  ]);
  assert.strictEqual(sessionStore.getRowCount(), 3);
  sessionStore.clearRows();
});

await ok("sessionStore category and period filtering scopes getFilteredSorted correctly", () => {
  sessionStore.setRows([
    { id: "tx-u1", transactionDate: "2026-08-01", rawAmount: 100000, assignedCoa: 40201000, matchedLayer: "UNAUTHORIZED_FALLBACK" },
    { id: "tx-u2", transactionDate: "2026-07-15", rawAmount: 150000, assignedCoa: 40201000, matchedLayer: "UNAUTHORIZED_FALLBACK" },
    { id: "tx-c1", transactionDate: "2026-08-05", rawAmount: 200000, assignedCoa: 40201001, matchedLayer: "DONATUR_TETAP" },
    { id: "tx-e1", transactionDate: "2026-08-10", rawAmount: -50000, assignedCoa: 60100008, isExpense: true, matchedLayer: "EXPENSE" },
  ]);

  // Test 1: Category filter UNAUTHORIZED should only return unauthorized rows
  sessionStore.setFilter({ filterCategory: "UNAUTHORIZED", periodFilter: "ALL" });
  let filtered = sessionStore.getFilteredSorted();
  assert.strictEqual(filtered.length, 2);
  assert.ok(filtered.every(r => r.id === "tx-u1" || r.id === "tx-u2"));

  // Test 2: Period filter CUSTOM date range within 2026-08-01 to 2026-08-31
  sessionStore.setFilter({ filterCategory: "ALL", periodFilter: "CUSTOM", dateFrom: "2026-08-01", dateTo: "2026-08-31" });
  filtered = sessionStore.getFilteredSorted();
  assert.strictEqual(filtered.length, 3);
  assert.ok(!filtered.some(r => r.id === "tx-u2")); // July row excluded

  // Test 3: Combined Period (August) + Category (UNAUTHORIZED)
  sessionStore.setFilter({ filterCategory: "UNAUTHORIZED", periodFilter: "CUSTOM", dateFrom: "2026-08-01", dateTo: "2026-08-31" });
  filtered = sessionStore.getFilteredSorted();
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].id, "tx-u1");

  // Cleanup
  sessionStore.setFilter({ filterCategory: "ALL", periodFilter: "ALL", dateFrom: null, dateTo: null });
  sessionStore.clearRows();
});

console.log("== E2E PARITY: sample/inputt.xlsx vs sample/output.xlsx ==");
let parityPct = -1;
try {
  const { existsSync } = await import("node:fs");
  if (!existsSync("sample/inputt.xlsx") || !existsSync("sample/output.xlsx")) {
    console.log("  SKIP: sample/inputt.xlsx or sample/output.xlsx not found in repo (skipping E2E parity check)");
  } else {
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
    passed++;
  }
} catch (e) {
  failed++; fails.push("E2E parity");
  console.log(`  FAIL E2E parity: ${e.message}`);
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed, parity=${parityPct < 0 ? "n/a" : parityPct + "%"}`);
if (fails.length) console.log("Failed: " + fails.join("; "));
process.exit(failed ? 1 : 0);
