const MAX_ROWS = 10_000;
const subscribers = new Set();
const STORAGE_KEY_SESSION = "ziswaf_demo_session_rows_v1";
let generatedRowId = 0;

function canonicalizeRow(row) {
  const assignedCoaName = String(row?.assignedCoaName || row?.newName || '');
  return { ...row, assignedCoaName, newName: assignedCoaName };
}

function canonicalizePatch(patch) {
  const next = { ...patch };
  if (Object.prototype.hasOwnProperty.call(next, 'newName') && !Object.prototype.hasOwnProperty.call(next, 'assignedCoaName')) {
    next.assignedCoaName = next.newName;
  }
  if (Object.prototype.hasOwnProperty.call(next, 'assignedCoaName') && !Object.prototype.hasOwnProperty.call(next, 'newName')) {
    next.newName = next.assignedCoaName;
  }
  return next;
}

function uniqueRowId(preferred, usedIds) {
  const base = String(preferred || `TX-${Date.now().toString(36)}-${++generatedRowId}`);
  let id = base;
  let suffix = 1;
  while (usedIds.has(id)) id = `${base}-${++suffix}`;
  usedIds.add(id);
  return id;
}

function normalizeRowsWithUniqueIds(inputRows, usedIds = new Set()) {
  return inputRows.map(row => {
    const normalized = canonicalizeRow(row);
    return { ...normalized, id: uniqueRowId(normalized.id, usedIds) };
  });
}

export function getTransactionFingerprint(row) {
  const date = String(row?.transactionDate || row?.rawDate || '').trim();
  const label = String(row?.rawLabel || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('id-ID');
  const amount = Number(row?.rawAmount);
  return `${date}|${Number.isFinite(amount) ? amount : 'INVALID'}|${label}`;
}

const storage = (() => {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage?.getItem === "function" && typeof localStorage?.setItem === "function") return localStorage;
  } catch (e) {}
  return null;
})();

function loadPersistedRows() {
  try {
    const raw = storage?.getItem(STORAGE_KEY_SESSION);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return normalizeRowsWithUniqueIds(parsed);
    }
  } catch (e) {
    console.warn("Gagal memuat sesi tersimpan:", e);
  }
  return [];
}

function persistRows(nextRows = rows) {
  try {
    if (storage) {
      if (nextRows.length === 0) {
        storage.removeItem(STORAGE_KEY_SESSION);
      } else {
        storage.setItem(STORAGE_KEY_SESSION, JSON.stringify(nextRows));
      }
    }
  } catch (error) {
    throw new Error(`Transaksi tidak dapat disimpan di browser: ${error?.message || 'kapasitas penyimpanan tidak mencukupi'}`);
  }
}

const STORAGE_KEY_STATE = "ziswaf_session_view_state_v1";

function loadPersistedState() {
  try {
    const raw = storage?.getItem(STORAGE_KEY_STATE);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {};
}

function persistState() {
  try {
    if (storage) {
      storage.setItem(STORAGE_KEY_STATE, JSON.stringify({
        sortKey,
        sortDir,
        currentPage,
        searchTerm,
        searchScope,
        filterCategory,
        periodFilter,
        dateFrom,
        dateTo
      }));
    }
  } catch (e) {}
}

let rows = loadPersistedRows();
const _savedState = loadPersistedState();
let sortKey = _savedState.sortKey || 'date';
let sortDir = _savedState.sortDir || 'desc';
let currentPage = typeof _savedState.currentPage === 'number' && _savedState.currentPage > 0 ? _savedState.currentPage : 1;
const PAGE_SIZE = 80;
let searchTerm = _savedState.searchTerm || '';
let searchScope = _savedState.searchScope || 'ALL';
let filterCategory = _savedState.filterCategory || 'ALL';
let periodFilter = _savedState.periodFilter || 'ALL';
let dateFrom = _savedState.dateFrom || null;
let dateTo = _savedState.dateTo || null;

export const MAX_SESSION_ROWS = MAX_ROWS;

function notify() {
  subscribers.forEach(cb => { try { cb(); } catch (e) {} });
}

export function subscribe(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function getRows() { return rows; }
export function getRowCount() { return rows.length; }
export function isSessionStoragePersistent() { return Boolean(storage); }

export function previewMergeRows(newRows) {
  if (!Array.isArray(newRows)) throw new Error('Dataset transaksi harus berupa array.');
  const seen = new Set(rows.map(getTransactionFingerprint));
  let added = 0;
  let duplicates = 0;
  for (const row of newRows) {
    const fingerprint = getTransactionFingerprint(row);
    if (seen.has(fingerprint)) duplicates++;
    else {
      seen.add(fingerprint);
      added++;
    }
  }
  return { incoming: newRows.length, added, duplicates, projectedTotal: rows.length + added };
}

export function setRows(newRows) {
  if (!Array.isArray(newRows)) throw new Error('Dataset transaksi harus berupa array.');
  if (newRows.length > MAX_ROWS) throw new Error(`Batas sesi ${MAX_ROWS.toLocaleString('id-ID')} transaksi terlampaui.`);
  const nextRows = normalizeRowsWithUniqueIds(newRows);
  persistRows(nextRows);
  rows = nextRows;
  currentPage = 1;
  searchTerm = '';
  filterCategory = 'ALL';
  periodFilter = 'ALL';
  dateFrom = null;
  dateTo = null;
  persistState();
  notify();
}

export function mergeRows(newRows) {
  if (!Array.isArray(newRows)) throw new Error('Dataset transaksi harus berupa array.');
  const existing = new Set(rows.map(getTransactionFingerprint));
  const usedIds = new Set(rows.map(r => r.id));
  const added = [];
  for (const row of newRows) {
    const fingerprint = getTransactionFingerprint(row);
    if (existing.has(fingerprint)) continue;
    existing.add(fingerprint);
    const normalized = canonicalizeRow(row);
    added.push({ ...normalized, id: uniqueRowId(normalized.id, usedIds) });
  }
  if (rows.length + added.length > MAX_ROWS) {
    throw new Error(`Hasil gabungan melebihi batas sesi ${MAX_ROWS.toLocaleString('id-ID')} transaksi.`);
  }
  const nextRows = [...rows, ...added];
  persistRows(nextRows);
  rows = nextRows;
  currentPage = 1;
  notify();
  return added.length;
}

export function updateRow(id, patch) {
  const idx = rows.findIndex(r => r.id === id);
  if (idx === -1) return;
  const nextRows = rows.map((row, index) => index === idx ? canonicalizeRow({ ...row, ...canonicalizePatch(patch) }) : row);
  persistRows(nextRows);
  rows = nextRows;
  notify();
}

export function bulkUpdateRows(ids, patch) {
  const set = new Set(ids);
  const normalizedPatch = canonicalizePatch(patch);
  const nextRows = rows.map(r => set.has(r.id) ? canonicalizeRow({ ...r, ...normalizedPatch }) : r);
  persistRows(nextRows);
  rows = nextRows;
  notify();
}

export function bulkPatchRows(patchMap) {
  const isMap = patchMap instanceof Map;
  const nextRows = rows.map(r => {
    const patch = isMap ? patchMap.get(r.id) : patchMap[r.id];
    return patch ? canonicalizeRow({ ...r, ...canonicalizePatch(patch) }) : r;
  });
  persistRows(nextRows);
  rows = nextRows;
  notify();
}

export function deleteRows(ids) {
  const set = new Set(ids);
  const nextRows = rows.filter(r => !set.has(r.id));
  persistRows(nextRows);
  rows = nextRows;
  const filtered = getFilteredSorted();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = Math.max(1, totalPages);
  notify();
}

export function restoreRows(restoredRows) {
  const existingIds = new Set(rows.map(r => r.id));
  const toAdd = normalizeRowsWithUniqueIds(restoredRows.filter(r => !existingIds.has(r.id)), existingIds);
  if (rows.length + toAdd.length > MAX_ROWS) throw new Error(`Batas sesi ${MAX_ROWS.toLocaleString('id-ID')} transaksi terlampaui.`);
  const nextRows = [...rows, ...toAdd];
  persistRows(nextRows);
  rows = nextRows;
  notify();
}

export function clearRows() {
  persistRows([]);
  rows = [];
  currentPage = 1;
  searchTerm = '';
  filterCategory = 'ALL';
  periodFilter = 'ALL';
  persistState();
  notify();
}

export function getSortState() { return { sortKey, sortDir }; }
export function setSort(key) {
  if (sortKey === key) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey = key;
    sortDir = key === 'amount' ? 'desc' : 'desc';
  }
  persistState();
  notify();
}

export function getFilter() { return { searchTerm, searchScope, filterCategory, periodFilter, dateFrom, dateTo }; }
export function setFilter(patch, keepPage = false) {
  if (patch.searchTerm !== undefined) searchTerm = patch.searchTerm;
  if (patch.searchScope !== undefined) searchScope = patch.searchScope;
  if (patch.filterCategory !== undefined) filterCategory = patch.filterCategory;
  if (patch.periodFilter !== undefined) periodFilter = patch.periodFilter;
  if (patch.dateFrom !== undefined) dateFrom = patch.dateFrom;
  if (patch.dateTo !== undefined) dateTo = patch.dateTo;
  if (!keepPage && patch.currentPage === undefined) {
    currentPage = 1;
  } else if (patch.currentPage !== undefined) {
    currentPage = patch.currentPage;
  }
  persistState();
  notify();
}

export function getPage() { return currentPage; }
export function setPage(p) { 
  currentPage = p; 
  persistState();
  notify(); 
}

export function getRowsByPeriod(p = periodFilter, from = dateFrom, to = dateTo) {
  if (p === 'ALL') return rows;
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  return rows.filter(r => {
    if (!r.transactionDate) return false;
    const d = new Date(r.transactionDate);
    if (p === 'THIS_MONTH') return d.getFullYear() === y && d.getMonth() === m;
    if (p === 'LAST_MONTH') {
      const lm = m === 0 ? 11 : m - 1, ly = m === 0 ? y - 1 : y;
      return d.getFullYear() === ly && d.getMonth() === lm;
    }
    if (p === 'THIS_YEAR') return d.getFullYear() === y;
    if (p === 'CUSTOM' && from && to) {
      return r.transactionDate >= from && r.transactionDate <= to;
    }
    return true;
  });
}

export function getFilteredSorted() {
  let result = getRowsByPeriod();

  if (filterCategory !== 'ALL') {
    if (filterCategory === 'UNAUTHORIZED' || filterCategory === 'UNAUTHORIZED_FALLBACK') {
      result = result.filter(r => r.matchedLayer === 'UNAUTHORIZED_FALLBACK');
    } else if (filterCategory === 'EXPENSE') {
      result = result.filter(r => r.isExpense || r.matchedLayer === 'EXPENSE');
    } else if (filterCategory === 'MANUAL_OVERRIDE') {
      result = result.filter(r => r.matchedLayer === 'MANUAL_OVERRIDE' || r.isOverridden);
    } else if (filterCategory === 'KEYWORD') {
      result = result.filter(r => r.matchedLayer === 'KEYWORD');
    } else if (filterCategory === 'DONATUR_TETAP') {
      result = result.filter(r => r.matchedLayer === 'DONATUR_TETAP');
    } else if (filterCategory === 'CAMPAIGN_TAIL') {
      result = result.filter(r => r.matchedLayer === 'CAMPAIGN_TAIL');
    } else if (filterCategory === 'ORG_ALIAS') {
      result = result.filter(r => r.matchedLayer === 'ORG_ALIAS');
    } else if (filterCategory === 'AI_SEMANTIC') {
      result = result.filter(r => r.matchedLayer === 'AI_SEMANTIC');
    } else if (filterCategory === 'LEARNED') {
      result = result.filter(r => r.matchedLayer === 'LEARNED');
    }
  }

  if (searchTerm) {
    const t = searchTerm.toLowerCase();
    result = result.filter(r => {
      if (searchScope === 'COA') return String(r.assignedCoa || '').includes(t);
      if (searchScope === 'COA_NAME') return (r.assignedCoaName || '').toLowerCase().includes(t);
      if (searchScope === 'LABEL') return (r.cleanedLabel || r.rawLabel || '').toLowerCase().includes(t) || (r.partner || '').toLowerCase().includes(t);
      const label = (r.cleanedLabel || r.rawLabel || '').toLowerCase();
      const partner = (r.partner || '').toLowerCase();
      const coa = String(r.assignedCoa || '');
      const coaName = (r.assignedCoaName || '').toLowerCase();
      return label.includes(t) || partner.includes(t) || coa.includes(t) || coaName.includes(t);
    });
  }

  result = [...result].sort((a, b) => {
    let av, bv;
    if (sortKey === 'date') { av = a.transactionDate || ''; bv = b.transactionDate || ''; }
    else if (sortKey === 'amount') { av = a.rawAmount || 0; bv = b.rawAmount || 0; }
    else if (sortKey === 'label') { av = (a.cleanedLabel || a.rawLabel || '').toLowerCase(); bv = (b.cleanedLabel || b.rawLabel || '').toLowerCase(); }
    else if (sortKey === 'coa') { av = a.assignedCoa || 0; bv = b.assignedCoa || 0; }
    else { av = ''; bv = ''; }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  return result;
}

export function getPagedRows() {
  const filtered = getFilteredSorted();
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  return {
    rows: filtered.slice(start, end),
    total,
    totalPages,
    page: safePage,
    start: total === 0 ? 0 : start + 1,
    end: Math.min(end, total),
    pageSize: PAGE_SIZE
  };
}

export function getStats() {
  const inflow = rows.filter(r => !r.isExpense && r.rawAmount > 0).reduce((s, r) => s + r.rawAmount, 0);
  const expense = rows.filter(r => r.isExpense || r.rawAmount < 0).reduce((s, r) => s + Math.abs(r.rawAmount), 0);
  const classified = rows.filter(r => r.matchedLayer !== 'UNAUTHORIZED_FALLBACK').length;
  const unauthorized = rows.filter(r => r.matchedLayer === 'UNAUTHORIZED_FALLBACK').length;
  const net = inflow - expense;
  return { inflow, expense, classified, unauthorized, net, total: rows.length };
}

export function getProgramTotals(programs) {
  const map = {};
  rows.forEach(r => {
    if (r.isExpense || r.rawAmount <= 0 || r.matchedLayer === 'UNAUTHORIZED_FALLBACK') return;
    const pid = r.assignedProgramId || '__none__';
    if (!map[pid]) map[pid] = { id: pid, name: '', total: 0, count: 0 };
    map[pid].total += r.rawAmount;
    map[pid].count += 1;
  });
  programs.forEach(p => {
    if (map[p.id]) map[p.id].name = p.name;
  });
  if (map['__none__']) map['__none__'].name = 'Tidak Terprogram';
  return Object.values(map).sort((a, b) => b.total - a.total);
}

export function getCategoryTotals(coaList) {
  const categoryByCode = new Map((coaList || []).map(coa => [Number(coa.code), String(coa.category || 'LAINNYA').trim()]));
  const labelFor = category => {
    const upper = category.toUpperCase();
    if (upper === 'ZAKAT') return 'Zakat';
    if (upper === 'WAKAF') return 'Wakaf';
    if (upper === 'DSKL') return 'DSKL';
    if (upper.includes('INFAK') || upper.includes('SEDEKAH')) return 'Infak / Sedekah';
    return category || 'Lainnya';
  };
  const result = {};

  rows.forEach(r => {
    if (r.isExpense || r.rawAmount <= 0 || r.matchedLayer === 'UNAUTHORIZED_FALLBACK') return;
    const category = categoryByCode.get(Number(r.assignedCoa));
    if (!category || category.toUpperCase() === 'BEBAN') return;
    const label = labelFor(category);
    result[label] = (result[label] || 0) + r.rawAmount;
  });

  return Object.entries(result)
    .map(([name, total]) => ({ name, total }))
    .filter(g => g.total > 0)
    .sort((a, b) => b.total - a.total);
}
