// Read-only local dataset audit; AI disabled, raw labels/names are not printed.
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const memory = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k)
} });
globalThis.XLSX = require('../js/vendor/xlsx.full.min.js');
const X = globalThis.XLSX;
const { DEFAULT_MASTER_DATA } = await import('../js/config/default_presets.js');
const { parseBankStatement } = await import('../js/services/excel_adapter.js');
const { classifyBatch, classifySingle } = await import('../js/engine/classifier.js');
const { setRows, mergeRows, getRows, clearRows } = await import('../js/store/session_store.js');
const master = structuredClone(DEFAULT_MASTER_DATA);
master.settings.aiMode = 'OFF';
const root = new URL('../test_data/test/', import.meta.url);
clearRows();
const collected = [];
let total = 0;
for (const name of readdirSync(root).filter(n => /\.xlsx$/i.test(n)).sort()) {
  const bytes = new Uint8Array(readFileSync(new URL(name, root)));
  const wb = X.read(bytes, { type: 'array' });
  const source = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: true, defval: '' });
  const rows = await parseBankStatement(bytes);
  const start = performance.now();
  const batch = await classifyBatch(rows, master);
  const elapsedMs = Math.round(performance.now() - start);
  const again = await classifyBatch(rows, master);
  let singleBatchMismatch = 0;
  for (let i = 0; i < rows.length; i++) {
    const s = await classifySingle(rows[i], master);
    if (s.assignedCoa !== batch[i].assignedCoa || s.matchedLayer !== batch[i].matchedLayer) singleBatchMismatch++;
  }
  const headerKeys = Object.keys(source[0] || {});
  const dateKey = headerKeys.find(k => /^(date|tanggal|tgl)$/i.test(k));
  const amountKey = headerKeys.find(k => /^(amount|nominal|jumlah|mutasi)$/i.test(k));
  const numericDates = source.filter(r => typeof r[dateKey] === 'number').length;
  const dateMismatch = source.filter((r, i) => typeof r[dateKey] === 'number' && rows[i]?.rawDate !== X.SSF.format('yyyy-mm-dd', r[dateKey])).length;
  const unknownAccounts = batch.filter(r => !master.coaList.some(c => c.code === r.assignedCoa)).length;
  const sumParsed = rows.reduce((n, r) => n + r.rawAmount, 0);
  const sumSource = source.reduce((n, r) => n + (typeof r[amountKey] === 'number' ? r[amountKey] : 0), 0);
  const layers = batch.reduce((o, r) => { o[r.matchedLayer] = (o[r.matchedLayer] || 0) + 1; return o; }, {});
  const duplicateKeys = rows.length - new Set(rows.map(r => JSON.stringify([r.rawDate, r.rawLabel, r.rawAmount]))).size;
  const added = total === 0 ? (setRows(batch), batch.length) : mergeRows(batch);
  total += rows.length;
  collected.push(...batch.map((r, i) => ({ ...r, sourceDate: source[i]?.[dateKey] })));
  console.log(JSON.stringify({ file: name, headers: headerKeys, sourceRows: source.length, parsedRows: rows.length, numericDates, dateMismatch, totalsAgree: sumParsed === sumSource, deterministic: JSON.stringify(batch) === JSON.stringify(again), singleBatchMismatch, unknownAccounts, duplicateKeys, addedOnMerge: added, elapsedMs, layers }));
}
console.log(JSON.stringify({ merge: { inputRows: total, retainedRows: getRows().length, uniqueIds: new Set(getRows().map(r => r.id)).size } }));
const formatFile = new URL('../test_data/output_formaat.xlsx', import.meta.url);
const formatWb = X.read(new Uint8Array(readFileSync(formatFile)), { type: 'array' });
console.log(JSON.stringify({ formatWorkbook: formatWb.SheetNames.map(name => {
  const data = X.utils.sheet_to_json(formatWb.Sheets[name], { header: 1, raw: true });
  return { sheet: name, rows: data.length, header: data[0] };
}) }));
// Candidate reference comparison. Do not assume this export is authoritative.
// Match date + label + amount, reject ambiguous COA keys, consume multiplicity.
const canonicalDate = d => typeof d === 'number' ? X.SSF.format('yyyy-mm-dd', d) : String(d ?? '').trim().slice(0, 10);
const key = (date, label, amount) => JSON.stringify([canonicalDate(date), String(label ?? '').trim(), Number(amount)]);
const referenceRows = X.utils.sheet_to_json(formatWb.Sheets[formatWb.SheetNames[0]], { raw: true, defval: '' })
  .map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim(), v])));
const buckets = new Map();
for (const r of referenceRows) {
  const k = key(r.DATE, r.KETERANGAN, r.NOMINAL);
  const b = buckets.get(k) || { coas: new Set(), count: 0 };
  b.coas.add(Number(r['ACCOUNT NUMBER'])); b.count++; buckets.set(k, b);
}
let comparable = 0, agreement = 0, absent = 0, ambiguous = 0;
const mismatchLayers = {};
for (const r of collected) {
  const b = buckets.get(key(r.sourceDate, r.rawLabel, r.rawAmount));
  if (!b || b.count === 0) { absent++; continue; }
  if (b.coas.size !== 1) { ambiguous++; continue; }
  b.count--; comparable++;
  if (b.coas.has(r.assignedCoa)) agreement++;
  else mismatchLayers[r.matchedLayer] = (mismatchLayers[r.matchedLayer] || 0) + 1;
}
console.log(JSON.stringify({ candidateReferenceComparison: { comparable, agreement, absent, ambiguous, mismatchLayers, referenceAmbiguousKeys: [...buckets.values()].filter(b => b.coas.size > 1).length, note: 'Uses original source dates to isolate classification from the confirmed import date bug; reference authority unverified.' } }));
