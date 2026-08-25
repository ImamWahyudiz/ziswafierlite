const MAX_ROWS = 10_000;
const subscribers = new Set();
let rows = [];
let sortKey = 'date';
let sortDir = 'desc';
let currentPage = 1;
const PAGE_SIZE = 80;
let searchTerm = '';
let searchScope = 'ALL';
let filterCategory = 'ALL';

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

export function setRows(newRows) {
  rows = newRows;
  currentPage = 1;
  searchTerm = '';
  filterCategory = 'ALL';
  notify();
}

export function mergeRows(newRows) {
  const existing = new Set(rows.map(r => `${r.transactionDate}|${r.rawLabel}|${r.rawAmount}`));
  const added = newRows.filter(r => !existing.has(`${r.transactionDate}|${r.rawLabel}|${r.rawAmount}`));
  rows = [...rows, ...added];
  currentPage = 1;
  notify();
  return added.length;
}

export function updateRow(id, patch) {
  const idx = rows.findIndex(r => r.id === id);
  if (idx === -1) return;
  rows[idx] = { ...rows[idx], ...patch };
  notify();
}

export function bulkUpdateRows(ids, patch) {
  const set = new Set(ids);
  rows = rows.map(r => set.has(r.id) ? { ...r, ...patch } : r);
  notify();
}

export function clearRows() {
  rows = [];
  currentPage = 1;
  searchTerm = '';
  filterCategory = 'ALL';
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
  currentPage = 1;
  notify();
}

export function getFilter() { return { searchTerm, searchScope, filterCategory }; }
export function setFilter(patch) {
  if (patch.searchTerm !== undefined) searchTerm = patch.searchTerm;
  if (patch.searchScope !== undefined) searchScope = patch.searchScope;
  if (patch.filterCategory !== undefined) filterCategory = patch.filterCategory;
  currentPage = 1;
  notify();
}

export function getPage() { return currentPage; }
export function setPage(p) { currentPage = p; notify(); }

export function getFilteredSorted() {
  let result = rows;

  if (filterCategory !== 'ALL') {
    if (filterCategory === 'UNAUTHORIZED') {
      result = result.filter(r => r.assignedCoa === 40201000 || r.matchedLayer === 'UNAUTHORIZED_FALLBACK');
    } else if (filterCategory === 'EXPENSE') {
      result = result.filter(r => r.isExpense || r.assignedCoa === 60100008);
    } else if (filterCategory === 'MANUAL_OVERRIDE') {
      result = result.filter(r => r.matchedLayer === 'MANUAL_OVERRIDE');
    }
  }

  if (searchTerm) {
    const t = searchTerm.toLowerCase();
    result = result.filter(r => {
      if (searchScope === 'COA') return String(r.assignedCoa || '').includes(t);
      if (searchScope === 'COA_NAME') return (r.newName || '').toLowerCase().includes(t);
      if (searchScope === 'LABEL') return (r.cleanedLabel || r.rawLabel || '').toLowerCase().includes(t) || (r.partner || '').toLowerCase().includes(t);
      const label = (r.cleanedLabel || r.rawLabel || '').toLowerCase();
      const partner = (r.partner || '').toLowerCase();
      const coa = String(r.assignedCoa || '');
      const coaName = (r.newName || '').toLowerCase();
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
  const unauthorized = rows.filter(r => r.matchedLayer === 'UNAUTHORIZED_FALLBACK' || r.assignedCoa === 40201000).length;
  const net = inflow - expense;
  return { inflow, expense, classified, unauthorized, net, total: rows.length };
}

export function getProgramTotals(programs) {
  const map = {};
  rows.forEach(r => {
    if (r.isExpense || r.rawAmount <= 0) return;
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
  const GROUPS = {
    'Zakat': [40100000, 40100101, 40100102, 40100103],
    'Infak Umum': [40201001],
    'Infak Terikat': [40201002, 40202101, 40202104, 40202201, 40202301, 40202302, 40202401, 40202501, 40202502],
    'DSKL': [40202601, 40202602],
    'Wakaf': [40301000, 40203110, 40203201],
  };
  const result = {};
  Object.keys(GROUPS).forEach(g => { result[g] = 0; });

  rows.forEach(r => {
    if (r.isExpense || r.rawAmount <= 0) return;
    for (const [group, codes] of Object.entries(GROUPS)) {
      if (codes.includes(r.assignedCoa)) {
        result[group] += r.rawAmount;
        return;
      }
    }
  });

  return Object.entries(result)
    .map(([name, total]) => ({ name, total }))
    .filter(g => g.total > 0)
    .sort((a, b) => b.total - a.total);
}
