import assert from "node:assert";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
globalThis.XLSX = require("../js/vendor/xlsx.full.min.js");
const XLSX = globalThis.XLSX;

const { DEFAULT_MASTER_DATA } = await import("../js/config/default_presets.js");
const { cleanTransactionText } = await import("../js/engine/sanitizer.js");
const { classifySingle, classifyBatch, classifyDeterministic } = await import("../js/engine/classifier.js");
const aiMatcher = await import("../js/engine/ai_matcher.js");
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
  const alias = ALIASES[0];
  const r = cleanTransactionText(`Transfer zakat ke ${alias} program quran`, ALIASES);
  assert.ok(!r.cleanedLabel.toLowerCase().includes(alias.toLowerCase()));
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
await ok("L1 'TRF KE' positive inflow -> not EXPENSE (donation transfer)", async () => {
  // Positive "TRF KE" is a transfer TO an institution (donation/receipt), not an expense.
  // Only negative amounts and explicit "biaya" trigger the EXPENSE layer.
  const r = await classifySingle(tx(2, "TRF KE - 009876543210", 25000), M);
  assert.strictEqual(r.matchedLayer !== "EXPENSE", true);
  assert.strictEqual(r.isExpense, false);
});
await ok("L2 tail code -> campaign program COA", async () => {
  const r = await classifySingle(tx(3, "TRANSFER IN", 2500101), M);
  assert.strictEqual(r.matchedLayer, "CAMPAIGN_TAIL");
  assert.strictEqual(r.assignedProgramId, "prog-zkt-maal");
});
await ok("L3 registered donor -> routine program", async () => {
  const donor = M.donors[0];
  const r = await classifySingle(tx(4, `TRF DARI - BCA - ${donor.name}`, 10000), M);
  assert.strictEqual(r.matchedLayer, "DONATUR_TETAP");
  assert.strictEqual(r.assignedProgramId, donor.defaultProgramId);
});
await ok("ambiguous partial donor names are quarantined", async () => {
  const ambiguousMaster = JSON.parse(JSON.stringify(M));
  ambiguousMaster.donors = [
    { id: 'donor-ahmad-1', name: 'Ahmad Hidayat', defaultProgramId: '', defaultCoa: 40201001 },
    { id: 'donor-ahmad-2', name: 'Ahmad Fauzi', defaultProgramId: '', defaultCoa: 40201001 }
  ];
  const r = await classifySingle(tx(41, 'TRF DARI - AHMAD', 10000), ambiguousMaster);
  assert.strictEqual(r.matchedLayer, 'UNAUTHORIZED_FALLBACK');
  assert.strictEqual(r.evidence?.type, 'donor_conflict');
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
  const r = await classifySingle(tx(7, M.companyAliases[0], 100000), M);
  assert.strictEqual(r.matchedLayer, "ORG_ALIAS");
  assert.strictEqual(r.assignedCoa, 40201001);
});
await ok("alias + non-keyword text -> COMPANY_UMUM / ORG_ALIAS", async () => {
  const r = await classifySingle(tx(8, `${M.companyAliases[0]} transfer dana`, 100000), M);
  assert.strictEqual(r.matchedLayer, "ORG_ALIAS");
  assert.strictEqual(r.assignedCoa, 40201001);
});
await ok("alias + program keyword -> Layer 4 KEYWORD", async () => {
  const r = await classifySingle(tx(81, `${M.companyAliases[0]} Zakat Maal Bpk Fulan`, 100000), M);
  assert.strictEqual(r.matchedLayer, "KEYWORD");
  assert.strictEqual(r.assignedCoa, 40100101);
});
await ok("name-only transfer from unregistered sender -> UNAUTHORIZED_FALLBACK (not Infak Umum)", async () => {
  const r = await classifySingle(tx(9, "TRF DARI - SITI FATIMAH", 250000), M);
  assert.strictEqual(r.matchedLayer, "UNAUTHORIZED_FALLBACK");
  assert.strictEqual(r.assignedCoa, 40201000);
});
await ok("unrecognized code -> UNAUTHORIZED_FALLBACK", async () => {
  const r = await classifySingle(tx(10, "TRF CR Z1Z91", 300000), M);
  assert.strictEqual(r.matchedLayer, "UNAUTHORIZED_FALLBACK");
});
await ok("AI prompt includes company aliases and instructs allocation to Infak Umum", async () => {
  const { classifyBatch } = await import("../js/engine/classifier.js");
  const customMaster = {
    ...M,
    companyAliases: ["Yayasan Nurul Falah", "lazis nurul falah"],
    settings: { ...M.settings, aiMode: "OFF" }
  };
  const res = await classifyBatch([tx(99, "Infaq kas Yayasan Nurul Falah", 50000)], customMaster);
  assert.strictEqual(res[0].assignedCoa, 40201001);
  // "infaq" matches prog-sdq-subuh keyword → KEYWORD layer (company alias + keyword falls through to L4)
  assert.strictEqual(res[0].matchedLayer, "KEYWORD");
});

await ok("single and batch share exactly the same deterministic resolver", async () => {
  const samples = [
    tx(201, "Donasi untuk biaya sekolah", 100000),
    tx(202, "TRF DARI - JAMAL", 100000),
    tx(203, `${M.companyAliases[0]} WAQAF`, 100000),
    tx(204, "sedekah mushaf quran", 100000),
    tx(205, "biaya administrasi bank", 5000)
  ];
  const batch = await classifyBatch(samples, M);
  for (let i = 0; i < samples.length; i++) {
    const single = await classifySingle(samples[i], M);
    assert.deepStrictEqual(single, batch[i]);
  }
});

await ok("duplicate tail and equal keyword scores are quarantined deterministically", () => {
  const conflictMaster = JSON.parse(JSON.stringify(M));
  conflictMaster.programs = [
    { id: "a", name: "A", coaCode: 40201001, tailCode: "123", keywords: ["program sama"], priority: 5 },
    { id: "b", name: "B", coaCode: 40201002, tailCode: "123", keywords: ["program sama"], priority: 5 }
  ];
  const tail = classifyDeterministic(tx(210, "transfer", 100123), conflictMaster);
  assert.strictEqual(tail.matchedLayer, "UNAUTHORIZED_FALLBACK");
  assert.strictEqual(tail.evidence.type, "tail_conflict");
  const keyword = classifyDeterministic(tx(211, "program sama", 100000), conflictMaster);
  assert.strictEqual(keyword.matchedLayer, "UNAUTHORIZED_FALLBACK");
  assert.strictEqual(keyword.evidence.type, "keyword_conflict");
});

await ok("explicit program priority resolves keyword overlap without array-order dependence", () => {
  const priorityMaster = JSON.parse(JSON.stringify(M));
  priorityMaster.programs = [
    { id: "low", name: "Rendah", coaCode: 40201001, tailCode: "", keywords: ["peduli"], priority: 2 },
    { id: "high", name: "Tinggi", coaCode: 40201002, tailCode: "", keywords: ["peduli"], priority: 8 }
  ];
  const result = classifyDeterministic(tx(212, "donasi peduli", 100000), priorityMaster);
  assert.strictEqual(result.assignedProgramId, "high");
  assert.strictEqual(result.evidence.type, "keyword");
});

await ok("approved layer order resolves tail then donor before keyword", () => {
  const ordered = JSON.parse(JSON.stringify(M));
  ordered.programs = [
    { id: "tail", name: "Kode Ekor", coaCode: 40201002, tailCode: "321", keywords: [] },
    { id: "routine", name: "Rutin", coaCode: 40201001, tailCode: "", keywords: [] },
    { id: "keyword", name: "Kata Kunci", coaCode: 40202101, tailCode: "", keywords: ["bencana"] }
  ];
  ordered.donors = [{ id: "d", name: "Budi Santoso", defaultProgramId: "routine", defaultCoa: 40201001 }];
  assert.strictEqual(classifyDeterministic(tx(213, "TRF DARI - BUDI SANTOSO bencana", 100321), ordered).assignedProgramId, "tail");
  assert.strictEqual(classifyDeterministic(tx(214, "TRF DARI - BUDI SANTOSO bencana", 100000), ordered).assignedProgramId, "routine");
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
    { 'ID': 'prog-custom-2', 'NAMA PROGRAM': 'Wakaf Sumur Air', 'COA': 40202502, 'KODE EKOR': '124', 'KEYWORDS': 'wakaf;sumur' }
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

await ok("default preset has schema v2 and no orphan or duplicate references", () => {
  store.resetToDefaults();
  const m = store.getMaster();
  assert.strictEqual(m.schemaVersion, 2);
  assert.strictEqual(store.validateMasterData(m), true);
  assert.strictEqual(new Set(m.coaList.map(c => c.code)).size, m.coaList.length);
  assert.strictEqual(new Set(m.programs.map(p => p.id)).size, m.programs.length);
  const tails = m.programs.map(p => p.tailCode).filter(Boolean);
  assert.strictEqual(new Set(tails).size, tails.length);
  assert.ok(m.donors.every(d => /^Donatur Contoh/.test(d.name)));
});

await ok("JSON roundtrip preserves program metadata and AI credentials", () => {
  store.resetToDefaults();
  const m = store.getMaster();
  m.programs[0].priority = 9;
  m.programs[0].hiddenKeywords = ["varian rahasia"];
  m.programs[0].metadata = { source: "manual" };
  m.settings.aiApiKey = "backup-api-key";
  store.updateMaster(m);
  const json = store.exportConfigToJson();
  assert.strictEqual(JSON.parse(json).settings.aiApiKey, "backup-api-key");
  const preview = store.previewConfigImport(json, "replace");
  assert.strictEqual(preview.schemaVersion, 2);
  assert.ok(preview.changes && preview.changes.coa && preview.changes.programs);
  assert.deepStrictEqual(Object.keys(preview.changes.coa).sort(), ['added', 'removed', 'updated']);
  store.importConfigFromJson(json, "replace");
  const restored = store.getMaster().programs[0];
  assert.strictEqual(restored.priority, 9);
  assert.deepStrictEqual(restored.hiddenKeywords, ["varian rahasia"]);
  assert.deepStrictEqual(restored.metadata, { source: "manual" });
  assert.strictEqual(store.getMaster().settings.aiApiKey, "backup-api-key");
});

await ok("JSON merge imports AI credentials from backup", () => {
  store.resetToDefaults();
  const current = store.getMaster();
  current.settings.aiApiKey = "key-lama";
  store.updateMaster(current);
  store.importConfigFromJson(JSON.stringify({ settings: { aiApiKey: "key-dari-backup" } }), "merge");
  assert.strictEqual(store.getMaster().settings.aiApiKey, "key-dari-backup");
});

await ok("invalid JSON config is rejected atomically", () => {
  store.resetToDefaults();
  const before = store.exportConfigToJson();
  const invalid = JSON.parse(before);
  invalid.programs[0].coaCode = 99999999;
  assert.throws(() => store.importConfigFromJson(JSON.stringify(invalid), "replace"), /tidak ada/);
  assert.strictEqual(store.exportConfigToJson(), before);
});

await ok("COA rename migrates program, donor, and system references", () => {
  store.resetToDefaults();
  const before = store.getMaster();
  const oldCode = before.settings.defaultBaselineCoa;
  const idx = before.coaList.findIndex(c => c.code === oldCode);
  store.updateCoa(idx, { ...before.coaList[idx], code: 49990001 });
  const after = store.getMaster();
  assert.strictEqual(after.settings.defaultBaselineCoa, 49990001);
  assert.ok(!after.programs.some(p => p.coaCode === oldCode || p.parentCoaCode === oldCode));
  assert.ok(!after.donors.some(d => d.defaultCoa === oldCode));
  assert.strictEqual(store.validateMasterData(after), true);
});

await ok("referenced COA and program deletion is rejected", () => {
  store.resetToDefaults();
  const m = store.getMaster();
  const program = m.programs.find(p => p.id === m.donors[0].defaultProgramId);
  const coaIdx = m.coaList.findIndex(c => c.code === program.coaCode);
  const programIdx = m.programs.findIndex(p => p.id === program.id);
  assert.throws(() => store.deleteCoa(coaIdx), /masih dipakai|akun default sistem/);
  assert.throws(() => store.deleteProgram(programIdx), /masih menjadi default/);
});

await ok("program ID and system account changes migrate dependent references", () => {
  store.resetToDefaults();
  let m = store.getMaster();
  const oldProgramId = m.donors[0].defaultProgramId;
  const idx = m.programs.findIndex(p => p.id === oldProgramId);
  store.updateProgram(idx, { ...m.programs[idx], id: "program-diganti" });
  assert.strictEqual(store.getMaster().donors[0].defaultProgramId, "program-diganti");
  store.updateSystemAccounts({ unauthCode: 49000001, umumCode: 49000002, expenseCode: 69000001 });
  m = store.getMaster();
  assert.strictEqual(store.validateMasterData(m), true);
  assert.ok(!m.programs.some(p => [40201000, 40201001, 60100008].includes(p.coaCode)));
});

await ok("legacy config migration preserves custom data while repairing old conflicts", () => {
  store.resetToDefaults();
  const legacy = store.getMaster();
  delete legacy.schemaVersion;
  legacy.programs[1].tailCode = legacy.programs[0].tailCode;
  legacy.programs[1].coaCode = 99999999;
  legacy.programs[1].metadata = { legacy: true };
  legacy.donors[0].defaultProgramId = "program-yang-hilang";
  const migrated = store.migrateMasterData(legacy);
  assert.strictEqual(migrated.schemaVersion, 2);
  assert.strictEqual(migrated.programs[1].tailCode, "");
  assert.strictEqual(migrated.programs[1].coaCode, migrated.settings.defaultBaselineCoa);
  assert.deepStrictEqual(migrated.programs[1].metadata, { legacy: true });
  assert.strictEqual(migrated.donors[0].defaultProgramId, "");
  assert.strictEqual(store.validateMasterData(migrated), true);
});

await ok("legacy migration repairs duplicate donor IDs", () => {
  const candidate = store.getMaster();
  candidate.donors = [
    { ...candidate.donors[0], id: 'donor-duplikat' },
    { ...candidate.donors[1], id: 'donor-duplikat' }
  ];
  const migrated = store.migrateMasterData(candidate);
  assert.strictEqual(new Set(migrated.donors.map(donor => donor.id)).size, 2);
});

await ok("automatic config backup can be restored", () => {
  store.resetToDefaults();
  const original = store.getMaster();
  const originalOrg = original.settings.orgName;
  original.settings.aiApiKey = 'key-sebelum-impor';
  store.updateMaster(original);
  const imported = store.getMaster();
  imported.settings.orgName = 'Organisasi Setelah Impor';
  imported.settings.aiApiKey = 'key-setelah-impor';
  store.importConfigFromJson(JSON.stringify(imported), 'replace');
  assert.strictEqual(store.hasConfigBackup(), true);
  assert.strictEqual(store.getMaster().settings.orgName, 'Organisasi Setelah Impor');
  store.restoreLastConfigBackup();
  assert.strictEqual(store.getMaster().settings.orgName, originalOrg);
  assert.strictEqual(store.getMaster().settings.aiApiKey, 'key-sebelum-impor');
});

await ok("master store falls back safely when localStorage is blocked during initialization", () => {
  const script = `
    globalThis.localStorage = { getItem(){ throw new Error('blocked'); }, setItem(){ throw new Error('blocked'); }, removeItem(){ throw new Error('blocked'); } };
    const store = await import('./js/store/master_store.js?blocked=' + Date.now());
    console.log(JSON.stringify({ loaded: true, coa: store.getMaster().coaList.length }));
  `;
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], { cwd: process.cwd(), encoding: 'utf8' }).trim());
  assert.strictEqual(result.loaded, true);
  assert.ok(result.coa > 0);
});

await ok("failed localStorage writes do not mutate active master state", () => {
  const script = `
    const memory = new Map(); let fail = false;
    globalThis.localStorage = {
      getItem: key => memory.get(key) ?? null,
      setItem: (key, value) => { if (fail) throw new Error('quota'); memory.set(key, value); },
      removeItem: key => { if (fail) throw new Error('quota'); memory.delete(key); }
    };
    const store = await import('./js/store/master_store.js?quota=' + Date.now());
    store.resetToDefaults(); const before = store.getMaster(); fail = true;
    for (const operation of [
      () => store.deleteDonor(0),
      () => store.addAlias('ALIAS GAGAL'),
      () => store.updateSystemAccounts({ unauthCode: 49000001, umumCode: 49000002, expenseCode: 69000001 })
    ]) { try { operation(); } catch {} }
    const after = store.getMaster();
    console.log(JSON.stringify({
      donors: after.donors.length === before.donors.length,
      alias: !after.companyAliases.includes('ALIAS GAGAL'),
      system: after.settings.defaultUnauthorizedCoa === before.settings.defaultUnauthorizedCoa
    }));
  `;
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], { cwd: process.cwd(), encoding: 'utf8' }).trim());
  assert.deepStrictEqual(result, { donors: true, alias: true, system: true });
});
store.resetToDefaults();

console.log("== UNIT: BANK IMPORT & EXPORT ==");
function workbookFromRows(rows, date1904 = false) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Mutasi");
  if (date1904) wb.Workbook = { WBProps: { date1904: true } };
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

await ok("bank parser preserves Excel calendar dates and detects the complete header row", async () => {
  const input = workbookFromRows([
    ["keterangan"],
    ["tanggal", "keterangan", "nominal"],
    [45000, "Donasi pangan", 100000]
  ]);
  const [row] = await adapter.parseBankStatement(input, "tanggal.xlsx");
  assert.strictEqual(row.rawDate, XLSX.SSF.format("yyyy-mm-dd", 45000));
  assert.strictEqual(row.rawLabel, "Donasi pangan");
  assert.strictEqual(row.sourceName, "tanggal.xlsx");
  assert.strictEqual(row.sourceRow, 3);
});

await ok("bank parser honors the Excel 1904 date system", async () => {
  const input = workbookFromRows([
    ["tanggal", "keterangan", "nominal"],
    [1, "Donasi", 100000]
  ], true);
  const [row] = await adapter.parseBankStatement(input);
  assert.strictEqual(row.rawDate, "1904-01-02");
});

await ok("bank parser supports Indonesian and international formatted amounts", async () => {
  const input = workbookFromRows([
    ["tanggal", "keterangan", "nominal"],
    ["2026-09-01", "Indonesia", "Rp 100.000"],
    ["2026-09-02", "International", "1,234.56"],
    ["2026-09-03", "Decimal Indonesia", "1.234,56"]
  ]);
  const rows = await adapter.parseBankStatement(input);
  assert.deepStrictEqual(rows.map(row => row.rawAmount), [100000, 1234.56, 1234.56]);
});

await ok("separate imports receive unique transaction IDs", async () => {
  const input = workbookFromRows([["tanggal", "keterangan", "nominal"], ["2026-09-01", "Donasi", 100000]]);
  const [first] = await adapter.parseBankStatement(input);
  const [second] = await adapter.parseBankStatement(input);
  assert.notStrictEqual(first.id, second.id);
});

await ok("journal export uses the corrected account name and neutralizes formulas", () => {
  const csv = adapter.exportOdooCsv([{
    rawDate: "2026-09-01", assignedCoa: 40201001,
    assignedCoaName: "Infak Umum", rawAmount: 100000, rawLabel: "=1+1"
  }]);
  assert.ok(csv.includes(";40201001;Infak Umum;100000;'=1+1"));
});

await ok("replace upload validates the new file before replacing the active session", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const handler = appSource.match(/btn-replace-file'[\s\S]*?btn-merge-file'/)?.[0] || '';
  assert.ok(handler.includes('processFile(_pendingFile, false, _pendingParsedRows)'));
  assert.ok(!handler.includes('clearRows()'));
});

await ok("5-layer rescan preserves the production AI cache", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const rescan = appSource.match(/async function execute5LayerRescan[\s\S]*?\/\/ ─── EXPORT/)?.[0] || '';
  assert.ok(rescan.length > 0, 'rescan function source not found');
  assert.ok(!rescan.includes('clearAiCache('));
});

console.log("== UNIT: SESSION STORE ==");
const sessionStore = await import("../js/store/session_store.js");
await ok("sessionStore merge removes normalized duplicates within and across files", () => {
  sessionStore.setRows([{ id: "old", transactionDate: "2026-09-01", rawLabel: " Donasi  Pangan ", rawAmount: 100000 }]);
  const added = sessionStore.mergeRows([
    { id: "new-1", transactionDate: "2026-09-01", rawLabel: "donasi pangan", rawAmount: 100000 },
    { id: "new-2", transactionDate: "2026-09-02", rawLabel: "Wakaf", rawAmount: 200000 },
    { id: "new-3", transactionDate: "2026-09-02", rawLabel: " WAKAF ", rawAmount: 200000 }
  ]);
  assert.strictEqual(added, 1);
  assert.strictEqual(sessionStore.getRowCount(), 2);
  sessionStore.clearRows();
});

await ok("sessionStore previews duplicate impact without mutating the active session", () => {
  sessionStore.setRows([{ id: 'existing', transactionDate: '2026-09-01', rawLabel: 'Donasi Pangan', rawAmount: 100000 }]);
  const before = JSON.stringify(sessionStore.getRows());
  const preview = sessionStore.previewMergeRows([
    { id: 'same', transactionDate: '2026-09-01', rawLabel: ' donasi  pangan ', rawAmount: 100000 },
    { id: 'new', transactionDate: '2026-09-02', rawLabel: 'Donasi Pendidikan', rawAmount: 200000 },
    { id: 'new-duplicate', transactionDate: '2026-09-02', rawLabel: 'Donasi Pendidikan', rawAmount: 200000 }
  ]);
  assert.deepStrictEqual(preview, { incoming: 3, added: 1, duplicates: 2, projectedTotal: 2 });
  assert.strictEqual(JSON.stringify(sessionStore.getRows()), before);
  sessionStore.clearRows();
});

await ok("sessionStore repairs duplicate IDs so one edit affects one row", () => {
  sessionStore.setRows([
    { id: "same", transactionDate: "2026-09-01", rawLabel: "A", rawAmount: 1 },
    { id: "same", transactionDate: "2026-09-02", rawLabel: "B", rawAmount: 2 }
  ]);
  const ids = sessionStore.getRows().map(row => row.id);
  assert.strictEqual(new Set(ids).size, 2);
  sessionStore.updateRow(ids[0], { assignedCoa: 40201001 });
  assert.strictEqual(sessionStore.getRows().filter(row => row.assignedCoa === 40201001).length, 1);
  sessionStore.clearRows();
});
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

  // Test 4: Category filter DONATUR_TETAP
  sessionStore.setFilter({ filterCategory: "DONATUR_TETAP", periodFilter: "ALL" });
  filtered = sessionStore.getFilteredSorted();
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].id, "tx-c1");

  // Cleanup
  sessionStore.setFilter({ filterCategory: "ALL", periodFilter: "ALL", dateFrom: null, dateTo: null });
  sessionStore.clearRows();
});

await ok("session filters, stats, and category totals do not depend on default COA numbers", () => {
  const customCoas = [
    { code: 710001, name: "Karantina Custom", category: "INFAK / SEDEKAH" },
    { code: 710002, name: "Zakat Custom", category: "ZAKAT" },
    { code: 710003, name: "Beban Custom", category: "BEBAN" }
  ];
  sessionStore.setRows([
    { id: "custom-u", transactionDate: "2026-09-01", rawAmount: 100, assignedCoa: 710001, matchedLayer: "UNAUTHORIZED_FALLBACK" },
    { id: "custom-z", transactionDate: "2026-09-01", rawAmount: 200, assignedCoa: 710002, matchedLayer: "KEYWORD" },
    { id: "custom-e", transactionDate: "2026-09-01", rawAmount: -50, assignedCoa: 710003, matchedLayer: "EXPENSE", isExpense: true }
  ]);
  sessionStore.setFilter({ filterCategory: "UNAUTHORIZED", periodFilter: "ALL" });
  assert.deepStrictEqual(sessionStore.getFilteredSorted().map(r => r.id), ["custom-u"]);
  sessionStore.setFilter({ filterCategory: "EXPENSE", periodFilter: "ALL" });
  assert.deepStrictEqual(sessionStore.getFilteredSorted().map(r => r.id), ["custom-e"]);
  assert.strictEqual(sessionStore.getStats().unauthorized, 1);
  assert.deepStrictEqual(sessionStore.getCategoryTotals(customCoas), [
    { name: "Zakat", total: 200 }
  ]);
  sessionStore.setFilter({ filterCategory: "ALL", periodFilter: "ALL" });
  sessionStore.clearRows();
});

await ok("sessionStore bulkPatchRows and 5-layer rescan workflow", async () => {
  store.resetToDefaults();
  // Initially, an unknown transaction is categorized as UNAUTHORIZED_FALLBACK
  const unauthRow = {
    id: "tx-unauth-test",
    rawDate: "2026-08-10",
    transactionDate: "2026-08-10",
    rawLabel: "TRF CR DARI BUDI KEBUMEN BANTUAN BERAS CIANJUR",
    rawAmount: 500000,
    partner: "BANK",
    assignedCoa: 40201000,
    assignedCoaName: "Penerimaan Infak & Sedekah - Unauthorized",
    assignedProgramId: null,
    matchedLayer: "UNAUTHORIZED_FALLBACK"
  };
  sessionStore.setRows([unauthRow]);

  // Now, amil adds a new program with keyword 'beras cianjur'
  store.addProgram({
    id: "prog-beras-cianjur",
    name: "Bantuan Pangan Beras Cianjur",
    coaCode: 40202302,
    keywords: ["beras cianjur", "pangan cianjur"],
    tailCode: ""
  });

  // Rescan via classifyBatch
  const currentMaster = store.getMaster();
  const rescanned = await classifyBatch(sessionStore.getRows(), currentMaster);
  assert.strictEqual(rescanned.length, 1);
  assert.strictEqual(rescanned[0].assignedCoa, 40202302);
  assert.strictEqual(rescanned[0].matchedLayer, "KEYWORD");
  assert.strictEqual(rescanned[0].assignedProgramId, "prog-beras-cianjur");

  // Apply patch via bulkPatchRows
  const patchMap = new Map();
  patchMap.set(rescanned[0].id, {
    assignedCoa: rescanned[0].assignedCoa,
    assignedCoaName: rescanned[0].assignedCoaName,
    assignedProgramId: rescanned[0].assignedProgramId,
    matchedLayer: rescanned[0].matchedLayer
  });
  sessionStore.bulkPatchRows(patchMap);

  const updated = sessionStore.getRows().find(r => r.id === "tx-unauth-test");
  assert.strictEqual(updated.assignedCoa, 40202302);
  assert.strictEqual(updated.matchedLayer, "KEYWORD");
  sessionStore.clearRows();
  store.resetToDefaults();
});

await ok("5-layer rescan guardrail protects manual overrides and already valid rows", async () => {
  store.resetToDefaults();
  const sys = store.getSystemCodes();

  const testRows = [
    {
      id: "tx-manual",
      rawDate: "2026-08-01",
      transactionDate: "2026-08-01",
      rawLabel: "TRF DARI AHMAD KEBUMEN",
      rawAmount: 100000,
      assignedCoa: 40201001,
      assignedCoaName: "Penerimaan Infak & Sedekah - Umum",
      newName: "Penerimaan Infak & Sedekah - Umum",
      matchedLayer: "MANUAL_OVERRIDE",
      isOverridden: true
    },
    {
      id: "tx-valid-keyword",
      rawDate: "2026-08-02",
      transactionDate: "2026-08-02",
      rawLabel: "Bantuan Beras Santri Gizi",
      rawAmount: 250000,
      assignedCoa: 40202302,
      assignedCoaName: "Bantuan Gizi Santri & Pangan Dhuafa",
      newName: "Bantuan Gizi Santri & Pangan Dhuafa",
      matchedLayer: "KEYWORD",
      isOverridden: false
    },
    {
      id: "tx-unauth-eligible",
      rawDate: "2026-08-03",
      transactionDate: "2026-08-03",
      rawLabel: "TRF DARI H FULAN UNTUK PALESTINA PEDULI",
      rawAmount: 300000,
      assignedCoa: sys.unauth,
      assignedCoaName: "Penerimaan Infak & Sedekah - Unauthorized",
      newName: "Penerimaan Infak & Sedekah - Unauthorized",
      matchedLayer: "UNAUTHORIZED_FALLBACK",
      isOverridden: false
    }
  ];

  sessionStore.setRows(testRows);

  // Guardrail logic matching execute5LayerRescan:
  const isEligibleUnauthorized = (r) => {
    if (r.isOverridden || r.matchedLayer === 'MANUAL_OVERRIDE') return false;
    return Number(r.assignedCoa) === Number(sys.unauth) || r.matchedLayer === 'UNAUTHORIZED_FALLBACK';
  };

  // When all 3 row IDs are selected:
  const allIds = testRows.map(r => r.id);
  const eligibleRows = sessionStore.getRows().filter(r => allIds.includes(r.id) && isEligibleUnauthorized(r));

  // Only tx-unauth-eligible should be scanned!
  assert.strictEqual(eligibleRows.length, 1);
  assert.strictEqual(eligibleRows[0].id, "tx-unauth-eligible");

  // Manual override and valid keyword row are immune
  assert.strictEqual(eligibleRows.some(r => r.id === "tx-manual"), false);
  assert.strictEqual(eligibleRows.some(r => r.id === "tx-valid-keyword"), false);

  // Rescan eligible rows
  const currentMaster = store.getMaster();
  const rescanned = await classifyBatch(eligibleRows, currentMaster);
  assert.strictEqual(rescanned.length, 1);
  assert.strictEqual(rescanned[0].id, "tx-unauth-eligible");
  // "palestina" keyword matches Tanggap Bencana & Kemanusiaan (40202101)
  assert.strictEqual(rescanned[0].assignedCoa, 40202101);
  assert.strictEqual(rescanned[0].matchedLayer, "KEYWORD");

  // Apply patch including newName
  const patchMap = new Map();
  patchMap.set(rescanned[0].id, {
    assignedCoa: rescanned[0].assignedCoa,
    assignedCoaName: rescanned[0].assignedCoaName,
    newName: rescanned[0].assignedCoaName,
    assignedProgramId: rescanned[0].assignedProgramId,
    matchedLayer: rescanned[0].matchedLayer,
    confidence: rescanned[0].confidence,
    reasoning: rescanned[0].reasoning,
    isExpense: rescanned[0].isExpense,
    isOverridden: false
  });
  sessionStore.bulkPatchRows(patchMap);

  const finalRows = sessionStore.getRows();
  const manualRow = finalRows.find(r => r.id === "tx-manual");
  const keywordRow = finalRows.find(r => r.id === "tx-valid-keyword");
  const promotedRow = finalRows.find(r => r.id === "tx-unauth-eligible");

  assert.strictEqual(manualRow.matchedLayer, "MANUAL_OVERRIDE");
  assert.strictEqual(manualRow.isOverridden, true);
  assert.strictEqual(keywordRow.assignedCoa, 40202302);
  assert.strictEqual(promotedRow.assignedCoa, 40202101);
  assert.strictEqual(promotedRow.newName, "Infak Kebencanaan & Kemanusiaan");

  sessionStore.clearRows();
  store.resetToDefaults();
});

console.log("== UNIT: AI HARNESS ==");
const AI_PROGRAMS = [{
  id: 'prog-test',
  name: 'Program Test',
  coaCode: 40202101,
  keywords: ['program test'],
  description: 'Program khusus untuk pengujian'
}];
const AI_CONTEXT = {
  defaultBaselineCoa: 40201001,
  defaultUnauthorizedCoa: 40201000,
  companyAliases: ['Yayasan Contoh'],
  donors: [{ name: 'NAMA DONATUR RAHASIA' }]
};
const AI_SETTINGS = { aiMode: 'OPENAI', aiApiKey: 'test-only-key', confidenceThreshold: 0.80 };

await ok("AI cache is stable for the same fingerprint and excludes donor data from prompts", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let requestBody = '';
  aiMatcher.clearAiCache();
  aiMatcher.resetCircuitBreaker();
  globalThis.fetch = async (_url, options) => {
    calls++;
    requestBody = String(options.body || '');
    return {
      ok: true,
      status: 200,
      json: async () => ({ output_text: '{"decisions":[{"item_id":"ai-cache","program_id":"prog-test","confidence":0.91,"reason":"cocok"}]}' })
    };
  };
  try {
    const item = [{ id: 'ai-cache', cleanedLabel: 'transfer program test yang tidak deterministik' }];
    const first = await aiMatcher.classifySemanticBatchClient(item, AI_PROGRAMS, AI_SETTINGS, false, AI_CONTEXT);
    const second = await aiMatcher.classifySemanticBatchClient(item, AI_PROGRAMS, AI_SETTINGS, false, AI_CONTEXT);
    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(second, first);
    assert.ok(!requestBody.includes('NAMA DONATUR RAHASIA'));
    assert.ok(requestBody.includes('gpt-5.6-luna'));
  } finally {
    globalThis.fetch = originalFetch;
    aiMatcher.clearAiCache();
    aiMatcher.resetCircuitBreaker();
  }
});

await ok("AI cache fingerprint changes when the master context changes", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  aiMatcher.clearAiCache();
  aiMatcher.resetCircuitBreaker();
  globalThis.fetch = async () => {
    calls++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ output_text: '{"decisions":[{"item_id":"ai-context","program_id":null,"confidence":0.9,"reason":"umum"}]}' })
    };
  };
  try {
    const item = [{ id: 'ai-context', cleanedLabel: 'transfer umum tanpa keyword lokal' }];
    await aiMatcher.classifySemanticBatchClient(item, AI_PROGRAMS, AI_SETTINGS, false, AI_CONTEXT);
    await aiMatcher.classifySemanticBatchClient(item, AI_PROGRAMS, AI_SETTINGS, false, { ...AI_CONTEXT, companyAliases: ['Alias Berubah'] });
    assert.strictEqual(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    aiMatcher.clearAiCache();
    aiMatcher.resetCircuitBreaker();
  }
});

await ok("classifier derives AI account locally from an accepted program ID", async () => {
  const originalFetch = globalThis.fetch;
  aiMatcher.clearAiCache();
  aiMatcher.resetCircuitBreaker();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ output_text: '{"decisions":[{"item_id":"ai-integration","program_id":"prog-test","confidence":0.92,"reason":"program sesuai"}]}' })
  });
  try {
    const master = JSON.parse(JSON.stringify(M));
    master.programs = AI_PROGRAMS;
    master.settings = { ...master.settings, ...AI_SETTINGS };
    const result = await classifySingle(tx('ai-integration', 'semantic khusus tanpa keyword lokal', 100000), master);
    assert.strictEqual(result.matchedLayer, 'AI_SEMANTIC');
    assert.strictEqual(result.assignedProgramId, 'prog-test');
    assert.strictEqual(result.assignedCoa, 40202101);
  } finally {
    globalThis.fetch = originalFetch;
    aiMatcher.clearAiCache();
    aiMatcher.resetCircuitBreaker();
  }
});

await ok("classifyBatch runs AI calls with bounded concurrency, one call per distinct label, correct row mapping", async () => {
  const originalFetch = globalThis.fetch;
  aiMatcher.clearAiCache();
  aiMatcher.resetCircuitBreaker();
  let calls = 0, inFlight = 0, maxInFlight = 0;
  const labels = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]; // odd positions -> prog-test, even -> no match
  globalThis.fetch = async (_url, options) => {
    const body = String(options.body || "");
    const idx = labels.findIndex(label => body.includes(`semantic khusus ${label}`));
    const itemId = (body.match(/cx-\d+/) || [])[0];
    calls++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(resolve => setTimeout(resolve, (labels.length - idx) * 12)); // earlier labels finish last
    inFlight--;
    const decision = idx % 2 === 0
      ? { item_id: itemId, program_id: "prog-test", confidence: 0.92, reason: "sesuai" }
      : { item_id: itemId, program_id: null, confidence: 0, reason: "tidak cocok" };
    return { ok: true, status: 200, json: async () => ({ output_text: JSON.stringify({ decisions: [decision] }) }) };
  };
  try {
    const master = JSON.parse(JSON.stringify(M));
    master.programs = AI_PROGRAMS;
    master.settings = { ...master.settings, ...AI_SETTINGS };
    const rows = labels.map((label, i) => tx(`cx-${i}`, `semantic khusus ${label}`, 100000 + i * 1000));
    rows.push(tx("cx-6", "semantic khusus alpha", 150000)); // duplicate label of cx-0
    rows.push(tx("cx-7", "semantic khusus beta", 160000));  // duplicate label of cx-1
    const out = await classifyBatch(rows, master);
    assert.strictEqual(calls, labels.length, "one provider call per distinct label");
    assert.ok(maxInFlight >= 2 && maxInFlight <= 4, `maxInFlight=${maxInFlight}`);
    out.forEach((row, i) => {
      const labelIdx = i < labels.length ? i : i === 6 ? 0 : 1;
      assert.strictEqual(row.id, rows[i].id);
      assert.strictEqual(row.matchedLayer, labelIdx % 2 === 0 ? "AI_SEMANTIC" : "UNAUTHORIZED_FALLBACK", row.id);
    });
  } finally {
    globalThis.fetch = originalFetch;
    aiMatcher.clearAiCache();
    aiMatcher.resetCircuitBreaker();
  }
});

await ok("AI isolates labels and rejects unknown IDs, direct COA, bad confidence, and wrong identity", async () => {
  const originalFetch = globalThis.fetch;
  let call = 0;
  const requestBodies = [];
  aiMatcher.clearAiCache();
  aiMatcher.resetCircuitBreaker();
  globalThis.fetch = async (_url, options) => {
    requestBodies.push(String(options.body || ''));
    call++;
    const decisions = [
      { item_id: 'ai-1', program_id: 'program-palsu', confidence: 0.99, reason: 'palsu' },
      { item_id: 'ai-2', program_id: null, no_akun: 40202101, confidence: 0.99, reason: 'coa langsung' },
      { item_id: 'ai-3', program_id: null, confidence: 99, reason: 'manipulatif' },
      { item_id: 'ai-salah', program_id: 'prog-test', confidence: 0.95, reason: 'identitas salah' }
    ];
    return { ok: true, status: 200, json: async () => ({ output_text: JSON.stringify({ decisions: [decisions[call - 1]] }) }) };
  };
  try {
    const items = [1, 2, 3, 4].map(idx => ({ id: `ai-${idx}`, cleanedLabel: `label asing ${idx}` }));
    const result = await aiMatcher.classifySemanticBatchClient(items, AI_PROGRAMS, AI_SETTINGS, true, AI_CONTEXT);
    assert.strictEqual(result[0].status, 'guardrail_rejected');
    assert.strictEqual(result[1].status, 'invalid_response');
    assert.strictEqual(result[2].status, 'guardrail_rejected');
    assert.strictEqual(result[3].status, 'guardrail_rejected');
    assert.ok(result.every(entry => entry.confidence === 0));
    assert.strictEqual(call, 4);
    requestBodies.forEach((body, index) => {
      assert.ok(body.includes(`label asing ${index + 1}`));
      assert.ok(!body.includes(`label asing ${index === 0 ? 2 : 1}`));
    });
  } finally {
    globalThis.fetch = originalFetch;
    aiMatcher.resetCircuitBreaker();
  }
});

await ok("broken AI JSON fails closed and is not cached", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  aiMatcher.clearAiCache();
  aiMatcher.resetCircuitBreaker();
  globalThis.fetch = async () => {
    calls++;
    const output_text = calls === 1
      ? '```json\n[{broken]\n```'
      : '{"decisions":[{"item_id":"broken","program_id":null,"confidence":0,"reason":"tidak cocok"}]}';
    return { ok: true, status: 200, json: async () => ({ output_text }) };
  };
  try {
    const item = [{ id: 'broken', cleanedLabel: 'label rusak' }];
    const first = await aiMatcher.classifySemanticBatchClient(item, AI_PROGRAMS, AI_SETTINGS, false, AI_CONTEXT);
    const second = await aiMatcher.classifySemanticBatchClient(item, AI_PROGRAMS, AI_SETTINGS, false, AI_CONTEXT);
    assert.strictEqual(first[0].status, 'invalid_response');
    assert.strictEqual(second[0].status, 'no_match');
    assert.strictEqual(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    aiMatcher.resetCircuitBreaker();
  }
});

await ok("AI provider and threshold normalization stays conservative", () => {
  store.resetToDefaults();
  store.updateMaster({ settings: { ...store.getMaster().settings, aiMode: 'OPENROUTER', confidenceThreshold: 0.2 } });
  assert.strictEqual(store.getMaster().settings.aiMode, 'OFF');
  assert.strictEqual(store.getMaster().settings.confidenceThreshold, 0.80);
  assert.strictEqual(aiMatcher.resolveAiModel({ aiMode: 'OPENAI' }), 'gpt-5.6-luna');
  assert.strictEqual(aiMatcher.resolveAiModel({ aiMode: 'GEMINI' }), 'gemini-3.5-flash-lite');
  assert.strictEqual(aiMatcher.resolveAiModel({ aiMode: 'LOCAL_OLLAMA' }), 'qwen2.5:3b-instruct');
  store.resetToDefaults();
});


console.log("== UNIT: SENDER PATTERNS ==");
await ok("sender extracted from TRF DARI with numeric reference segment", () => {
  assert.strictEqual(cleanTransactionText("TRF DARI - 123456 - BUDI SANTOSO", []).extractedSenderName, "BUDI SANTOSO");
});
await ok("sender extracted from BI-FAST CR and SWITCHING CR formats", () => {
  assert.strictEqual(cleanTransactionText("BI-FAST CR TRANSFER DR 100426 BUDI SANTOSO", []).extractedSenderName, "BUDI SANTOSO");
  assert.strictEqual(cleanTransactionText("SWITCHING CR TRF DR 100426 SITI AMINAH", []).extractedSenderName, "SITI AMINAH");
  assert.strictEqual(cleanTransactionText("SWITCHING CR TRANSFER DR 100426 SITI AMINAH", []).extractedSenderName, "SITI AMINAH");
});
await ok("donation note words are cut off the extracted sender name", () => {
  const s = (label) => cleanTransactionText(label, []).extractedSenderName;
  assert.strictEqual(s("BI-FAST CR TRANSFER DR 100426 BUDI SANTOSO infaq jumat"), "BUDI SANTOSO");
  assert.strictEqual(s("SWITCHING CR TRF DR 100426 SITI AMINAH untuk zakat fitrah"), "SITI AMINAH");
  assert.strictEqual(s("TRF DARI - 123456 - BUDI SANTOSO sedekah subuh"), "BUDI SANTOSO");
  assert.strictEqual(s("0102/Ftscy/Ws95271 50000.00 Rio Kurnia Setyawa wakaf"), "Rio Kurnia Setyawa");
  // nothing but a note: no person name
  assert.strictEqual(s("SWITCHING CR TRF DR 100426 INFAQ JUMAT"), null);
  // names that merely look like donation words stay intact
  assert.strictEqual(s("BI-FAST CR TRANSFER DR 100426 AMAL HAKIM"), "AMAL HAKIM");
  assert.strictEqual(s("TRF DARI - SINTA PATIMAH"), "SINTA PATIMAH");
});
await ok("QRIS aggregator and merchant labels have no person sender", () => {
  assert.strictEqual(cleanTransactionText("QR DSKL QURBAN", []).extractedSenderName, null);
  assert.strictEqual(cleanTransactionText("QR 123 456 MASJID ISLAM CENTER", []).extractedSenderName, null);
  assert.strictEqual(cleanTransactionText("BIAYA PEMINDAHBUKUAN E-BANKING", []).extractedSenderName, null);
});

console.log("== UNIT: CLASSIFIER EVAL HARNESS ==");
const { evaluate } = await import("./classifier_eval.js");
const evalFixture = JSON.parse(readFileSync(new URL("./fixtures/classifier_cases.json", import.meta.url), "utf8"));
const detTx = (rawLabel, rawAmount) => classifyDeterministic({ id: "t", rawDate: "2026-01-01", rawLabel, rawAmount }, structuredClone(DEFAULT_MASTER_DATA));
await ok("classifier eval harness reports coverage and precision on fixtures", () => {
  const report = evaluate(evalFixture.cases, structuredClone(DEFAULT_MASTER_DATA), classifyDeterministic);
  console.log(`    eval: total=${report.total} decided=${report.decided} coverage=${report.coverage.toFixed(2)} precision=${report.precision.toFixed(2)}`);
  assert.strictEqual(report.total, evalFixture.cases.length);
  assert.deepStrictEqual(report.wrongCases, []);
  assert.strictEqual(report.precision, 1);
  assert.ok(report.coverage >= 0.5);
});

await ok("restricted program keyword without fund signal is quarantined", () => {
  const r = detTx("sumbangan masjid kampung", 100000);
  assert.notStrictEqual(r.assignedCoa, 40203201);
  assert.strictEqual(r.matchedLayer, "UNAUTHORIZED_FALLBACK");
  assert.strictEqual(r.evidence?.type, "restricted_keyword_without_signal");
});
await ok("restricted program keyword with explicit fund signal still classifies", () => {
  assert.strictEqual(detTx("wakaf pesantren", 100000).assignedCoa, 40203201);
  assert.strictEqual(detTx("zakat fitrah", 100000).assignedCoa, 40100102);
  assert.strictEqual(detTx("fitrah", 100000).assignedCoa, 40100102);
});
await ok("donor with non-zakat default program sending zakat label is not auto-filed", () => {
  const r = detTx("Trf Dari - Donatur Contoh 01 - zakat fitrah", 100000);
  assert.notStrictEqual(r.assignedProgramId, "prog-sdq-subuh");
  assert.notStrictEqual(r.matchedLayer, "DONATUR_TETAP");
});
await ok("donor sending label without fund signal still uses default program", () => {
  assert.strictEqual(detTx("Trf Dari - Donatur Contoh 01 - transfer", 100000).assignedProgramId, "prog-sdq-subuh");
});

await ok("tail code contradicted by keyword keeps approved order but is flagged with lower confidence", () => {
  const r = detTx("Zakat fitrah keluarga", 50302);
  assert.strictEqual(r.matchedLayer, "CAMPAIGN_TAIL");
  assert.strictEqual(r.assignedProgramId, "prog-gizi");
  assert.strictEqual(r.confidence, 0.8);
  assert.strictEqual(r.evidence.contradictedByKeywordProgramId, "prog-zkt-fitrah");
});
await ok("tail code agreeing with keyword is boosted and tail alone still decides", () => {
  const agree = detTx("Zakat fitrah", 50007);
  assert.strictEqual(agree.matchedLayer, "CAMPAIGN_TAIL");
  assert.strictEqual(agree.confidence, 0.97);
  const alone = detTx("transfer", 50302);
  assert.strictEqual(alone.matchedLayer, "CAMPAIGN_TAIL");
  assert.strictEqual(alone.assignedProgramId, "prog-gizi");
});

await ok("zero and non-numeric amounts are quarantined as invalid, valid ones unaffected", () => {
  for (const bad of [0, NaN, "abc", null, undefined]) {
    const r = detTx("infaq", bad);
    assert.strictEqual(r.matchedLayer, "UNAUTHORIZED_FALLBACK", `amount ${String(bad)}`);
    assert.strictEqual(r.evidence?.type, "invalid_amount", `amount ${String(bad)}`);
  }
  assert.strictEqual(detTx("infaq", 100000).matchedLayer, "KEYWORD");
  assert.strictEqual(detTx("biaya admin", -6500).matchedLayer, "EXPENSE");
});

await ok("single-edit typo in a long keyword matches with lower confidence and fuzzy evidence", () => {
  const exact = detTx("bayar fidyah ramadhan", 100000);
  assert.strictEqual(exact.matchedLayer, "KEYWORD");
  for (const typo of ["bayar fidiyah ramadhan", "bayar fidyha ramadhan"]) {
    const r = detTx(typo, 100000);
    assert.strictEqual(r.matchedLayer, "KEYWORD", typo);
    assert.strictEqual(r.assignedCoa, exact.assignedCoa, typo);
    assert.strictEqual(r.evidence.fuzzy, true, typo);
    assert.strictEqual(r.confidence, 0.8, typo);
  }
  assert.strictEqual(exact.evidence.fuzzy, undefined);
});
await ok("fuzzy keyword matching ignores short tokens and two-edit differences", () => {
  // An empty layer means "no deterministic rule" (AI-eligible, quarantined later).
  assert.strictEqual(detTx("sumor desa", 100000).matchedLayer, "");
  assert.strictEqual(detTx("bayar fidxxah ramadhan", 100000).matchedLayer, "");
});

console.log("== UNIT: LEARNED CORRECTIONS ==");
const learnedStore = await import("../js/store/learned_store.js");
const learnedOpts = { lookupLearned: learnedStore.lookupLearned };
const detLearned = (rawLabel, rawAmount) => classifyDeterministic({ id: "t", rawDate: "2026-01-01", rawLabel, rawAmount }, structuredClone(DEFAULT_MASTER_DATA), learnedOpts);
await ok("learn key ignores digits, case, and bank prefix noise", () => {
  const { normalizeLearnKey } = learnedStore;
  assert.strictEqual(normalizeLearnKey("TRF DARI - Budi - infaq jumat 123456"), normalizeLearnKey("Trf Dari - Budi - Infaq Jumat 987654"));
  assert.strictEqual(normalizeLearnKey("infaq"), "");
  assert.strictEqual(normalizeLearnKey(""), "");
});
await ok("a learned correction is reused as LEARNED layer, other labels are untouched", () => {
  learnedStore.clearLearned();
  assert.strictEqual(detLearned("pembayaran xyz bapak budi", 100000).matchedLayer, "");
  learnedStore.learnFromCorrection("pembayaran xyz bapak budi", null, 40202201);
  const r = detLearned("Pembayaran XYZ Bapak Budi 555", 100000);
  assert.strictEqual(r.matchedLayer, "LEARNED");
  assert.strictEqual(r.assignedCoa, 40202201);
  assert.strictEqual(r.confidence, 0.97);
  assert.strictEqual(r.evidence.type, "learned");
  assert.strictEqual(detLearned("pembayaran xyz", 100000).matchedLayer, "");
  assert.strictEqual(detLearned("bapak budi", 100000).matchedLayer, "");
});
await ok("learned memory never overrides expense or invalid amount and ignores stale COA", () => {
  learnedStore.clearLearned();
  learnedStore.learnFromCorrection("pembayaran xyz bapak budi", null, 40202201);
  assert.strictEqual(detLearned("pembayaran xyz bapak budi", -5000).matchedLayer, "EXPENSE");
  assert.strictEqual(detLearned("pembayaran xyz bapak budi", 0).evidence.type, "invalid_amount");
  learnedStore.learnFromCorrection("lain lagi kegiatan", null, 99999999);
  assert.strictEqual(detLearned("lain lagi kegiatan", 100000).matchedLayer, "");
});
await ok("conflicting corrections for one label disable the learned entry; clearLearned empties memory", () => {
  learnedStore.clearLearned();
  learnedStore.learnFromCorrection("pembayaran xyz bapak budi", null, 40202201);
  learnedStore.learnFromCorrection("pembayaran xyz bapak budi", null, 40202301);
  assert.strictEqual(learnedStore.lookupLearned("pembayaran xyz bapak budi"), null);
  learnedStore.clearLearned();
  assert.strictEqual(learnedStore.lookupLearned("pembayaran xyz bapak budi"), null);
});
await ok("classification without learned options is unchanged", () => {
  learnedStore.clearLearned();
  learnedStore.learnFromCorrection("pembayaran xyz bapak budi", null, 40202201);
  assert.strictEqual(detTx("pembayaran xyz bapak budi", 100000).matchedLayer, "");
  learnedStore.clearLearned();
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
