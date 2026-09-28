// Audit checks: synthetic data, mocked AI, no network or browser-storage writes.
// Run: node docs/audit-repro.mjs. Failures document unresolved defects.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const memory = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k)
} });
globalThis.XLSX = require('../js/vendor/xlsx.full.min.js');
const X = globalThis.XLSX;
const { DEFAULT_MASTER_DATA: defaults } = await import('../js/config/default_presets.js');
const { classifySingle, classifyBatch } = await import('../js/engine/classifier.js');
const adapter = await import('../js/services/excel_adapter.js');
const session = await import('../js/store/session_store.js');
const store = await import('../js/store/master_store.js');
const ai = await import('../js/engine/ai_matcher.js');
const { generateKeywordSuggestions } = await import('../js/engine/keyword_generator.js');
const clone = () => structuredClone(defaults);
const tx = (rawLabel, extra = {}) => ({ id: 'audit-1', rawDate: '2026-09-01', rawLabel, rawAmount: 100000, ...extra });
function book(rows) {
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), 'Sheet1');
  return X.write(wb, { type: 'array', bookType: 'xlsx' });
}
const parse = rows => adapter.parseBankStatement(book(rows));
let failures = 0;
let checks = 0;
async function check(name, fn) {
  checks++;
  try { await fn(); console.log(`PASS ${name}`); }
  catch (e) { failures++; console.log(`FAIL ${name}: ${e.message}`); }
}
await check('Excel serial date must agree with SheetJS', async () => {
  const [r] = await parse([['tanggal', 'keterangan', 'nominal'], [45000, 'audit', 100000]]);
  assert.equal(r.rawDate, X.SSF.format('yyyy-mm-dd', 45000));
});
await check('Indonesian integer thousands Rp 100.000 = 100000', async () => {
  const [r] = await parse([['tanggal', 'keterangan', 'nominal'], ['2026-09-01', 'audit', 'Rp 100.000']]);
  assert.equal(r.rawAmount, 100000);
});
await check('English thousands and decimal 1,234.56 = 1234.56', async () => {
  const [r] = await parse([['tanggal', 'keterangan', 'nominal'], ['2026-09-01', 'audit', '1,234.56']]);
  assert.equal(r.rawAmount, 1234.56);
});
await check('Header must be detected independently per row', async () => {
  const [r] = await parse([['keterangan'], ['tanggal', 'keterangan', 'nominal'], ['2026-09-01', 'AUDIT LABEL', 12345]]);
  assert.equal(r.rawLabel, 'AUDIT LABEL');
});
await check('Merge two files must retain unique transaction IDs', async () => {
  const a = await parse([['tanggal', 'keterangan', 'nominal'], ['2026-09-01', 'first', 12345]]);
  const b = await parse([['tanggal', 'keterangan', 'nominal'], ['2026-09-02', 'second', 23456]]);
  session.setRows(await classifyBatch(a, clone()));
  session.mergeRows(await classifyBatch(b, clone()));
  assert.equal(new Set(session.getRows().map(r => r.id)).size, 2);
});
await check('Deleting one merged ID must not delete both transactions', () => {
  session.deleteRows([session.getRows()[0].id]);
  assert.equal(session.getRows().length, 1);
});
await check('Manual edit must export the corrected account name', async () => {
  session.setRows([await classifySingle(tx('zakat maal'), clone())]);
  session.updateRow('audit-1', { assignedCoa: 40201001, newName: 'Infak Umum', matchedLayer: 'MANUAL_OVERRIDE', isOverridden: true });
  const csv = adapter.exportOdooCsv(session.getRows());
  assert.ok(csv.includes(';40201001;Infak Umum;'), csv);
});
await check('Account name search must find fresh classified rows', async () => {
  session.clearRows();
  session.setRows([await classifySingle(tx('zakat maal'), clone())]);
  session.setFilter({ searchScope: 'COA_NAME', searchTerm: 'Zakat Maal', periodFilter: 'ALL' });
  assert.equal(session.getFilteredSorted().length, 1);
});
await check('Zakat Fitrah program must point to the Fitrah COA', async () => {
  const r = await classifySingle(tx('zakat fitrah'), clone());
  assert.equal(r.assignedCoa, defaults.coaList.find(c => c.name === 'Zakat Fitrah').code);
});
await check('Positive donation mentioning biaya must not become expense', async () => {
  const r = await classifySingle(tx('Donasi untuk biaya sekolah'), clone());
  assert.equal(r.isExpense, false);
});
await check('Substring mal inside sender Jamal must not imply Zakat Maal', async () => {
  const r = await classifySingle(tx('TRF DARI - JAMAL'), clone());
  assert.equal(r.matchedLayer, 'UNAUTHORIZED_FALLBACK');
});
await check('Single and batch donor fallback must agree', async () => {
  const m = clone(); m.programs = []; m.companyAliases = [];
  m.donors = [{ id: 'd', name: 'Budi Santoso', defaultProgramId: '', defaultCoa: 0 }];
  const t = tx('TRF DARI - BUDI SANTOSO');
  assert.equal((await classifySingle(t, m)).assignedCoa, (await classifyBatch([t], m))[0].assignedCoa);
});
await check('Single and batch alias spelling normalization must agree', async () => {
  const m = clone(); m.companyAliases = ['ORGTEST']; m.donors = [];
  m.programs = [{ id: 'p', name: 'Wakaf', coaCode: 40301000, keywords: ['WAKAF'] }];
  const t = tx('ORGTEST WAQAF');
  assert.equal((await classifySingle(t, m)).assignedCoa, (await classifyBatch([t], m))[0].assignedCoa);
});
await check('Program priority must survive JSON backup roundtrip', () => {
  store.resetToDefaults(); const m = store.getMaster(); m.programs[0].priority = 9;
  store.updateMaster({ programs: m.programs });
  store.importConfigFromJson(store.exportConfigToJson());
  assert.equal(store.getMaster().programs[0].priority, 9);
});
await check('Program edit must preserve existing priority', () => {
  store.resetToDefaults(); const m = store.getMaster(); m.programs[0].priority = 9;
  store.updateMaster({ programs: m.programs }); store.updateProgram(0, m.programs[0]);
  assert.equal(store.getMaster().programs[0].priority, 9);
});
await check('Keyword suggestions persist only through an explicit master update', () => {
  store.resetToDefaults(); const m = store.getMaster();
  m.programs[0].hiddenKeywords.push('audit-keyword');
  assert.ok(!store.getMaster().programs[0].hiddenKeywords.includes('audit-keyword'));
  store.updateMaster({ programs: m.programs });
  assert.ok(store.getMaster().programs[0].hiddenKeywords.includes('audit-keyword'));
});
await check('Renaming program ID must preserve donor references', () => {
  store.resetToDefaults(); const m = store.getMaster();
  const id = m.donors[0].defaultProgramId; const i = m.programs.findIndex(p => p.id === id);
  store.updateProgram(i, { ...m.programs[i], id: 'renamed-program' });
  const next = store.getMaster();
  assert.ok(next.programs.some(p => p.id === next.donors[0].defaultProgramId));
});
await check('Custom system account change must not orphan program COA', () => {
  store.resetToDefaults();
  store.updateSystemAccounts({ unauthCode: 40201000, umumCode: 49999999, expenseCode: 60100008 });
  const m = store.getMaster();
  const p = m.programs.find(p => p.id === 'prog-sdq-subuh');
  assert.ok(m.coaList.some(c => c.code === p.coaCode));
});
const realFetch = globalThis.fetch;
const settings = { aiMode: 'OPENAI', aiApiKey: 'synthetic-test-key', aiModelName: 'synthetic-model' };
function mock(content) { globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) }); }
try {
  await check('AI direct account assignment must be quarantined', async () => {
    ai.clearAiCache(); ai.resetCircuitBreaker();
    mock(JSON.stringify({ decisions: [{ item_id: 'audit-1', program_id: null, no_akun: 99999999, confidence: 0.99, reason: 'langsung' }] }));
    const m = clone(); m.settings = { ...m.settings, ...settings };
    const r = (await classifyBatch([tx('REF-AUDIT-XYZ')], m))[0];
    assert.equal(r.assignedCoa, m.settings.defaultUnauthorizedCoa);
  });
  await check('AI cache must include context/system account mapping', async () => {
    ai.clearAiCache(); ai.resetCircuitBreaker();
    const items = [{ id: 'audit-context', cleanedLabel: 'audit cache context' }];
    mock(JSON.stringify({ decisions: [{ item_id: 'audit-context', program_id: null, confidence: 0.99, reason: 'umum' }] }));
    await ai.classifySemanticBatchClient(items, [], settings, false, { defaultBaselineCoa: 40201001 });
    mock(JSON.stringify({ decisions: [{ item_id: 'audit-context', program_id: null, confidence: 0.99, reason: 'umum' }] }));
    const [r] = await ai.classifySemanticBatchClient(items, [], settings, false, { defaultBaselineCoa: 49999999 });
    assert.equal(r.coa, 49999999);
  });
  await check('Markdown-wrapped keyword analysis must retain suggestions', async () => {
    const payload = { collisions: [{ keyword: 'WAKAF', programs: ['a', 'b'] }], missing: [], variants: [], hierarchy_fixes: [] };
    mock('```json\n' + JSON.stringify(payload) + '\n```');
    const m = clone(); m.settings = { ...m.settings, ...settings };
    const result = await generateKeywordSuggestions(m, m.settings);
    assert.equal(result.collisions.length, 1);
  });
} finally { globalThis.fetch = realFetch; }
await check('CSV must not emit executable spreadsheet formula cells', () => {
  const csv = adapter.exportOdooCsv([{ ...tx('=1+1'), assignedCoa: 40201001 }]);
  assert.ok(!csv.split('\r\n')[1].endsWith(';=1+1'), csv);
});
console.log(`\nAUDIT: ${checks} checks, ${failures} unresolved failures.`);
process.exitCode = failures ? 1 : 0;
