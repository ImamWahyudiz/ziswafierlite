import {
  getMaster, updateMaster, resetToDefaults, subscribe as subscribeMaster,
  exportConfigToJson, importConfigFromJson, importMasterFromExcel, getSystemCodes, updateSystemAccounts,
  addCoa, updateCoa, deleteCoa, batchDeleteCoa,
  addProgram, updateProgram, deleteProgram, batchDeletePrograms,
  addDonor, updateDonor, deleteDonor, batchDeleteDonors,
  addAlias, deleteAlias, batchDeleteAliases
} from "./store/master_store.js";
import { sanitizeInputText, sanitizeSlug, sanitizePhone, sanitizeCoaCode } from "./engine/sanitizer.js";
import { classifyBatch } from "./engine/classifier.js";
import { testAIConnection } from "./engine/ai_matcher.js";
import { parseBankStatement, exportOdooExcel, exportOdooCsv } from "./services/excel_adapter.js";
import {
  getRows, getRowCount, setRows, mergeRows, updateRow, bulkUpdateRows, bulkPatchRows, deleteRows, restoreRows, clearRows,
  getFilteredSorted, getPagedRows, getStats, getFilter, setFilter, getSortState, setSort, getRowsByPeriod,
  getPage, setPage, getProgramTotals, getCategoryTotals, MAX_SESSION_ROWS
} from "./store/session_store.js";

// ─── Utils ────────────────────────────────────────────────────────────────────

function esc(text) {
  const d = document.createElement('div');
  d.textContent = String(text ?? '');
  return d.innerHTML;
}

function fmtRp(amount) {
  if (amount === undefined || amount === null) return 'Rp\u00A00';
  const num = Number(amount);
  const isNegative = num < 0;
  const absVal = Math.abs(num);
  const formatted = absVal.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return isNegative ? `-Rp\u00A0${formatted}` : `Rp\u00A0${formatted}`;
}

function normPhone(raw) {
  let p = String(raw ?? '').replace(/\D/g, '');
  if (p.startsWith('0')) p = '62' + p.slice(1);
  else if (!p.startsWith('62') && p.length > 8) p = '62' + p;
  return p;
}

function showToast(msg, type = 'info') {
  const root = document.getElementById('toast-root');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  root.appendChild(t);
  setTimeout(() => { t.classList.add('fadeout'); setTimeout(() => t.remove(), 300); }, 3500);
}

function openModal(id) { document.getElementById(id)?.classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-close]');
  if (btn) closeModal(btn.dataset.close);
  // Do not close modals on backdrop overlay click to prevent accidental loss of user input
});

// ─── JS Tooltip ───────────────────────────────────────────────────────────────

const _ttEl = document.getElementById('js-tooltip');
document.addEventListener('mouseover', e => {
  if (!_ttEl) return;
  const el = e.target.closest('[data-tooltip]');
  if (!el) { _ttEl.style.display = 'none'; return; }
  const text = el.dataset.tooltip;
  if (!text || !text.trim()) { _ttEl.style.display = 'none'; return; }
  _ttEl.textContent = text;
  _ttEl.style.display = 'block';
});
document.addEventListener('mousemove', e => {
  if (!_ttEl || _ttEl.style.display === 'none') return;
  const gap = 12;
  let x = e.clientX + gap;
  let y = e.clientY - _ttEl.offsetHeight - gap;
  if (x + _ttEl.offsetWidth > window.innerWidth - 12) x = window.innerWidth - _ttEl.offsetWidth - 12;
  if (x < 12) x = 12;
  if (y < 12) y = e.clientY + gap + 10;
  _ttEl.style.left = x + 'px';
  _ttEl.style.top = y + 'px';
});
document.addEventListener('mouseout', e => {
  if (!_ttEl) return;
  if (!e.target.closest('[data-tooltip]')) _ttEl.style.display = 'none';
});

const PAGES = ['config', 'upload', 'dashboard'];
let _completedUpload = false;

// ─── Scroll & Position Persistence ───────────────────────────────────────────
let _isRestoringScroll = false;
window.addEventListener('scroll', () => {
  if (!_isRestoringScroll) {
    try { sessionStorage.setItem('ziswaf_scroll_y', String(window.scrollY)); } catch (e) {}
  }
}, { passive: true });

function preserveScroll(fn) {
  const currentY = window.scrollY;
  fn();
  requestAnimationFrame(() => {
    window.scrollTo({ top: currentY, behavior: 'instant' });
  });
}

function restoreSavedScroll() {
  try {
    const saved = sessionStorage.getItem('ziswaf_scroll_y');
    if (saved !== null) {
      const y = parseInt(saved, 10);
      if (!isNaN(y)) {
        _isRestoringScroll = true;
        window.scrollTo({ top: y, behavior: 'instant' });
        setTimeout(() => { _isRestoringScroll = false; }, 100);
      }
    }
  } catch (e) {}
}

function navigateTo(page, keepScroll = false) {
  PAGES.forEach(p => {
    document.getElementById(`page-${p}`)?.classList.toggle('hidden', p !== page);
    document.getElementById(`step-${p}`)?.classList.toggle('active', p === page);
  });
  const earlyStyle = document.getElementById('early-page-style');
  if (earlyStyle) earlyStyle.remove();
  try { localStorage.setItem('ziswaf_active_page', page); } catch (e) {}
  const currentY = window.scrollY;
  if (page === 'config') renderConfigPage();
  if (page === 'dashboard') renderDashboard();
  if (keepScroll) {
    requestAnimationFrame(() => {
      window.scrollTo({ top: currentY, behavior: 'instant' });
    });
  }
}

document.getElementById('stepper').addEventListener('click', e => {
  const btn = e.target.closest('.step-btn');
  if (!btn) return;
  navigateTo(btn.dataset.page);
});

document.getElementById('btn-goto-upload').addEventListener('click', () => navigateTo('upload'));
document.getElementById('btn-goto-dashboard').addEventListener('click', () => navigateTo('dashboard'));
document.getElementById('btn-upload-new').addEventListener('click', () => navigateTo('upload'));
document.getElementById('btn-upload-another').addEventListener('click', () => {
  document.getElementById('upload-done').classList.add('hidden');
  document.getElementById('dropzone').classList.remove('hidden');
  document.getElementById('progress-section').classList.add('hidden');
});

// ─── Tutorial buttons (per config tab) ─────────────────────────────────────────
document.querySelectorAll('[data-tutorial]').forEach((btn) => {
  btn.addEventListener('click', () => openTutorial(btn.getAttribute('data-tutorial')));
});

// ─── Theme ────────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-icon').className = theme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
  try { localStorage.setItem('ziswaf_theme', theme); } catch (e) {}
}

document.getElementById('btn-theme-toggle').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
});

try {
  const currentTheme = document.documentElement.getAttribute('data-theme') || localStorage.getItem('ziswaf_theme') || 'dark';
  applyTheme(currentTheme);
} catch (e) {}

// ─── CONFIG PAGE ──────────────────────────────────────────────────────────────

const SUBTABS = ['coa', 'program', 'donor', 'alias', 'ai', 'backup'];

function switchSubtab(tab) {
  if (!SUBTABS.includes(tab)) tab = 'coa';
  document.querySelectorAll('.subtab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.subtab-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
  try { localStorage.setItem('ziswaf_active_subtab', tab); } catch (e) {}
}

document.getElementById('config-subtabs').addEventListener('click', e => {
  const btn = e.target.closest('.subtab');
  if (!btn) return;
  const currentY = window.scrollY;
  switchSubtab(btn.dataset.tab);
  requestAnimationFrame(() => {
    window.scrollTo({ top: currentY, behavior: 'instant' });
  });
});

function renderConfigPage() {
  const currentY = window.scrollY;
  const m = getMaster();
  document.getElementById('count-coa').textContent = m.coaList.length;
  document.getElementById('count-program').textContent = m.programs.length;
  document.getElementById('count-donor').textContent = m.donors.length;
  document.getElementById('count-alias').textContent = (m.companyAliases || []).length;
  renderCoaTable(m);
  renderProgramTable(m);
  renderDonorTable(m);
  renderAliasList(m);
  renderAiSettings(m);
  renderSystemCoaSettings(m);
  requestAnimationFrame(() => {
    window.scrollTo({ top: currentY, behavior: 'instant' });
  });
}

// ─── Master Data State & Selection ───────────────────────────────────────────
let _selectedCoa = new Set();
let _selectedPrograms = new Set();
let _selectedDonors = new Set();
let _selectedAliases = new Set();

function updateCoaSelectionUI() {
  const m = getMaster();
  const count = _selectedCoa.size;
  const statusEl = document.getElementById('coa-selection-status');
  const badgeEl = document.getElementById('coa-selected-badge');
  const selectAllCb = document.getElementById('coa-select-all');

  if (statusEl && badgeEl) {
    if (count > 0) {
      statusEl.classList.remove('hidden');
      badgeEl.textContent = `${count} COA dicentang`;
    } else {
      statusEl.classList.add('hidden');
    }
  }
  if (selectAllCb) {
    selectAllCb.checked = count > 0 && count === m.coaList.length;
    selectAllCb.indeterminate = count > 0 && count < m.coaList.length;
  }
}

function updateProgramSelectionUI() {
  const m = getMaster();
  const count = _selectedPrograms.size;
  const statusEl = document.getElementById('program-selection-status');
  const badgeEl = document.getElementById('program-selected-badge');
  const selectAllCb = document.getElementById('program-select-all');

  if (statusEl && badgeEl) {
    if (count > 0) {
      statusEl.classList.remove('hidden');
      badgeEl.textContent = `${count} program dicentang`;
    } else {
      statusEl.classList.add('hidden');
    }
  }
  if (selectAllCb) {
    selectAllCb.checked = count > 0 && count === m.programs.length;
    selectAllCb.indeterminate = count > 0 && count < m.programs.length;
  }
}

function updateDonorSelectionUI() {
  const m = getMaster();
  const count = _selectedDonors.size;
  const statusEl = document.getElementById('donor-selection-status');
  const badgeEl = document.getElementById('donor-selected-badge');
  const selectAllCb = document.getElementById('donor-select-all');

  if (statusEl && badgeEl) {
    if (count > 0) {
      statusEl.classList.remove('hidden');
      badgeEl.textContent = `${count} donatur dicentang`;
    } else {
      statusEl.classList.add('hidden');
    }
  }
  if (selectAllCb) {
    selectAllCb.checked = count > 0 && count === m.donors.length;
    selectAllCb.indeterminate = count > 0 && count < m.donors.length;
  }
}

function updateAliasSelectionUI() {
  const count = _selectedAliases.size;
  const statusEl = document.getElementById('alias-selection-status');
  const badgeEl = document.getElementById('alias-selected-badge');

  if (statusEl && badgeEl) {
    if (count > 0) {
      statusEl.classList.remove('hidden');
      badgeEl.textContent = `${count} alias dicentang`;
    } else {
      statusEl.classList.add('hidden');
    }
  }
}

// ─── COA ──────────────────────────────────────────────────────────────────────
function renderCoaTable(m) {
  const sys = getSystemCodes(m);
  const sysSet = new Set([sys.unauth, sys.umum, sys.expense]);
  document.getElementById('tbody-coa').innerHTML = m.coaList.map((c, i) => {
    const isSysMapped = sysSet.has(c.code);
    let sysBadge = '';
    if (c.code === sys.unauth) {
      sysBadge = ` <span class="badge badge-unauthorized-fallback text-xs ms-1" title="Akun Karantina (Unauthorized)">Karantina</span>`;
    } else if (c.code === sys.umum) {
      sysBadge = ` <span class="badge badge-donatur-tetap text-xs ms-1" title="Akun Baseline (Infak Umum)">Baseline</span>`;
    } else if (c.code === sys.expense) {
      sysBadge = ` <span class="badge badge-expense text-xs ms-1" title="Akun Uang Keluar (Beban Operasional)">Uang Keluar</span>`;
    }
    const isChecked = _selectedCoa.has(i);
    return `<tr>
      <td><input type="checkbox" class="coa-row-checkbox" data-idx="${i}" ${isChecked ? 'checked' : ''}></td>
      <td><code>${esc(c.code)}</code></td>
      <td>${esc(c.name)}${sysBadge}</td>
      <td><span class="badge-cat">${esc(c.category || 'UMUM')}</span></td>
      <td>
        <button class="btn-icon-sm" data-action="edit-coa" data-idx="${i}" title="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="btn-icon-sm text-danger" data-action="del-coa" data-idx="${i}" title="Hapus"${isSysMapped ? ' disabled' : ''}><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" class="empty-state">Belum ada COA.</td></tr>';

  updateCoaSelectionUI();
}

document.getElementById('coa-select-all')?.addEventListener('change', e => {
  const m = getMaster();
  if (e.target.checked) {
    m.coaList.forEach((_, i) => _selectedCoa.add(i));
  } else {
    _selectedCoa.clear();
  }
  document.querySelectorAll('.coa-row-checkbox').forEach(cb => {
    cb.checked = e.target.checked;
  });
  updateCoaSelectionUI();
});

document.getElementById('tbody-coa')?.addEventListener('change', e => {
  const cb = e.target.closest('.coa-row-checkbox');
  if (!cb) return;
  const idx = parseInt(cb.dataset.idx, 10);
  if (cb.checked) {
    _selectedCoa.add(idx);
  } else {
    _selectedCoa.delete(idx);
  }
  updateCoaSelectionUI();
});

document.getElementById('btn-batch-delete-coa')?.addEventListener('click', () => {
  if (_selectedCoa.size === 0) return;
  const count = _selectedCoa.size;
  if (!confirm(`Hapus ${count} akun COA terpilih?`)) return;
  try {
    const deleted = batchDeleteCoa(Array.from(_selectedCoa));
    _selectedCoa.clear();
    renderConfigPage();
    showToast(`${deleted} akun COA berhasil dihapus`, 'success');
  } catch (err) {
    showToast('Gagal menghapus: ' + err.message, 'error');
  }
});

document.getElementById('btn-add-coa').addEventListener('click', () => {
  document.getElementById('coa-edit-idx').value = '';
  document.getElementById('coa-code').value = '';
  document.getElementById('coa-name').value = '';
  document.getElementById('coa-category').value = '';
  document.getElementById('modal-coa-title').textContent = 'Tambah COA';
  openModal('modal-coa');
});

document.getElementById('tbody-coa').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const idx = parseInt(btn.dataset.idx);
  const m = getMaster();
  if (btn.dataset.action === 'edit-coa') {
    const c = m.coaList[idx];
    document.getElementById('coa-edit-idx').value = idx;
    document.getElementById('coa-code').value = c.code;
    document.getElementById('coa-name').value = c.name;
    document.getElementById('coa-category').value = c.category || '';
    document.getElementById('modal-coa-title').textContent = 'Edit COA';
    openModal('modal-coa');
  } else if (btn.dataset.action === 'del-coa') {
    const c = m.coaList[idx];
    const sys = getSystemCodes(m);
    if ([sys.unauth, sys.umum, sys.expense].includes(c.code)) {
      showToast(`COA ${c.code} dipetakan sebagai akun default sistem — ubah dulu pemetaan di "Akun Default Sistem"`, 'error');
      return;
    }
    if (confirm(`Hapus COA ${c.code} - ${c.name}?`)) {
      try {
        deleteCoa(idx);
        _selectedCoa.delete(idx);
        renderConfigPage();
        showToast('COA berhasil dihapus', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  }
});

document.getElementById('btn-save-coa').addEventListener('click', () => {
  const code = sanitizeCoaCode(document.getElementById('coa-code').value);
  const name = sanitizeInputText(document.getElementById('coa-name').value, 120);
  const category = sanitizeInputText(document.getElementById('coa-category').value, 50) || 'UMUM';
  if (!code || !name) { showToast('Kode Akun (angka) dan Nama Akun wajib diisi dengan benar', 'error'); return; }

  const idx = document.getElementById('coa-edit-idx').value;
  try {
    if (idx === '') {
      addCoa({ code, name, category });
    } else {
      updateCoa(parseInt(idx, 10), { code, name, category });
    }
    closeModal('modal-coa');
    renderConfigPage();
    showToast('COA berhasil disimpan', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ─── PROGRAM ──────────────────────────────────────────────────────────────────
function renderProgramTable(m) {
  document.getElementById('tbody-program').innerHTML = m.programs.map((p, i) => {
    const isChecked = _selectedPrograms.has(i);
    return `<tr>
      <td><input type="checkbox" class="program-row-checkbox" data-idx="${i}" ${isChecked ? 'checked' : ''}></td>
      <td><code>${esc(p.id)}</code></td>
      <td>${esc(p.name)}</td>
      <td><code>${esc(p.coaCode)}</code></td>
      <td><code>${esc(p.tailCode || '-')}</code></td>
      <td class="text-xs text-muted">${esc((p.keywords || []).slice(0, 3).join(', '))}</td>
      <td>
        <button class="btn-icon-sm" data-action="edit-prog" data-idx="${i}" title="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="btn-icon-sm text-danger" data-action="del-prog" data-idx="${i}" title="Hapus"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" class="empty-state">Belum ada program.</td></tr>';

  updateProgramSelectionUI();
}

document.getElementById('program-select-all')?.addEventListener('change', e => {
  const m = getMaster();
  if (e.target.checked) {
    m.programs.forEach((_, i) => _selectedPrograms.add(i));
  } else {
    _selectedPrograms.clear();
  }
  document.querySelectorAll('.program-row-checkbox').forEach(cb => {
    cb.checked = e.target.checked;
  });
  updateProgramSelectionUI();
});

document.getElementById('tbody-program')?.addEventListener('change', e => {
  const cb = e.target.closest('.program-row-checkbox');
  if (!cb) return;
  const idx = parseInt(cb.dataset.idx, 10);
  if (cb.checked) {
    _selectedPrograms.add(idx);
  } else {
    _selectedPrograms.delete(idx);
  }
  updateProgramSelectionUI();
});

document.getElementById('btn-batch-delete-program')?.addEventListener('click', () => {
  if (_selectedPrograms.size === 0) return;
  const count = _selectedPrograms.size;
  if (!confirm(`Hapus ${count} program terpilih?`)) return;
  try {
    const deleted = batchDeletePrograms(Array.from(_selectedPrograms));
    _selectedPrograms.clear();
    renderConfigPage();
    showToast(`${deleted} program berhasil dihapus`, 'success');
  } catch (err) {
    showToast('Gagal menghapus: ' + err.message, 'error');
  }
});

function populateProgramCoaSelect() {
  const m = getMaster();
  const sel = document.getElementById('program-coa');
  sel.innerHTML = m.coaList.map(c => `<option value="${c.code}">${c.code} - ${esc(c.name)}</option>`).join('');
}

document.getElementById('btn-add-program').addEventListener('click', () => {
  document.getElementById('program-edit-idx').value = '';
  ['program-id','program-name','program-tail','program-keywords','program-desc'].forEach(id => document.getElementById(id).value = '');
  populateProgramCoaSelect();
  document.getElementById('modal-program-title').textContent = 'Tambah Program';
  openModal('modal-program');
});

document.getElementById('tbody-program').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const idx = parseInt(btn.dataset.idx);
  const m = getMaster();
  if (btn.dataset.action === 'edit-prog') {
    const p = m.programs[idx];
    document.getElementById('program-edit-idx').value = idx;
    document.getElementById('program-id').value = p.id;
    document.getElementById('program-name').value = p.name;
    document.getElementById('program-tail').value = p.tailCode || '';
    document.getElementById('program-keywords').value = (p.keywords || []).join(';');
    document.getElementById('program-desc').value = p.description || '';
    populateProgramCoaSelect();
    document.getElementById('program-coa').value = p.coaCode;
    document.getElementById('modal-program-title').textContent = 'Edit Program';
    openModal('modal-program');
  } else if (btn.dataset.action === 'del-prog') {
    if (confirm(`Hapus program "${m.programs[idx].name}"?`)) {
      deleteProgram(idx);
      _selectedPrograms.delete(idx);
      renderConfigPage();
      showToast('Program berhasil dihapus', 'success');
    }
  }
});

document.getElementById('btn-save-program').addEventListener('click', () => {
  const id = sanitizeSlug(document.getElementById('program-id').value, 50);
  const name = sanitizeInputText(document.getElementById('program-name').value, 120);
  if (!id || !name) { showToast('ID dan Nama Program wajib diisi dengan benar', 'error'); return; }
  const coaCode = sanitizeCoaCode(document.getElementById('program-coa').value) || 0;
  const tailCode = sanitizeInputText(document.getElementById('program-tail').value, 10);
  const keywords = document.getElementById('program-keywords').value.split(/[;,]/).map(k => sanitizeInputText(k, 50)).filter(Boolean);
  const description = sanitizeInputText(document.getElementById('program-desc').value, 500);
  const idx = document.getElementById('program-edit-idx').value;

  try {
    if (idx === '') {
      addProgram({ id, name, coaCode, tailCode, keywords, description });
    } else {
      updateProgram(parseInt(idx, 10), { id, name, coaCode, tailCode, keywords, description });
    }
    closeModal('modal-program');
    renderConfigPage();
    showToast('Program berhasil disimpan', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ─── DONATUR ──────────────────────────────────────────────────────────────────
function renderDonorTable(m) {
  document.getElementById('tbody-donor').innerHTML = m.donors.map((d, i) => {
    const prog = m.programs.find(p => p.id === d.defaultProgramId);
    const isChecked = _selectedDonors.has(i);
    return `<tr>
      <td><input type="checkbox" class="donor-row-checkbox" data-idx="${i}" ${isChecked ? 'checked' : ''}></td>
      <td>${esc(d.name)}</td>
      <td>${esc(d.phone || '-')}</td>
      <td class="text-xs">${esc(prog ? prog.name : 'Umum')}</td>
      <td>
        <button class="btn-icon-sm" data-action="edit-donor" data-idx="${i}" title="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="btn-icon-sm text-danger" data-action="del-donor" data-idx="${i}" title="Hapus"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" class="empty-state">Belum ada donatur tetap.</td></tr>';

  updateDonorSelectionUI();
}

document.getElementById('donor-select-all')?.addEventListener('change', e => {
  const m = getMaster();
  if (e.target.checked) {
    m.donors.forEach((_, i) => _selectedDonors.add(i));
  } else {
    _selectedDonors.clear();
  }
  document.querySelectorAll('.donor-row-checkbox').forEach(cb => {
    cb.checked = e.target.checked;
  });
  updateDonorSelectionUI();
});

document.getElementById('tbody-donor')?.addEventListener('change', e => {
  const cb = e.target.closest('.donor-row-checkbox');
  if (!cb) return;
  const idx = parseInt(cb.dataset.idx, 10);
  if (cb.checked) {
    _selectedDonors.add(idx);
  } else {
    _selectedDonors.delete(idx);
  }
  updateDonorSelectionUI();
});

document.getElementById('btn-batch-delete-donor')?.addEventListener('click', () => {
  if (_selectedDonors.size === 0) return;
  const count = _selectedDonors.size;
  if (!confirm(`Hapus ${count} donatur terpilih?`)) return;
  try {
    const deleted = batchDeleteDonors(Array.from(_selectedDonors));
    _selectedDonors.clear();
    renderConfigPage();
    showToast(`${deleted} donatur berhasil dihapus`, 'success');
  } catch (err) {
    showToast('Gagal menghapus: ' + err.message, 'error');
  }
});

function populateDonorProgramSelect(selectedId) {
  const m = getMaster();
  const sel = document.getElementById('donor-program');
  sel.innerHTML = '<option value="">-- Donasi Umum / Tanpa Program --</option>' +
    m.programs.map(p => `<option value="${esc(p.id)}" ${p.id === selectedId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
}

document.getElementById('btn-add-donor').addEventListener('click', () => {
  document.getElementById('donor-edit-idx').value = '';
  document.getElementById('donor-name').value = '';
  document.getElementById('donor-phone').value = '';
  populateDonorProgramSelect('');
  document.getElementById('modal-donor-title').textContent = 'Tambah Donatur';
  openModal('modal-donor');
});

document.getElementById('tbody-donor').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const idx = parseInt(btn.dataset.idx);
  const m = getMaster();
  if (btn.dataset.action === 'edit-donor') {
    const d = m.donors[idx];
    document.getElementById('donor-edit-idx').value = idx;
    document.getElementById('donor-name').value = d.name;
    document.getElementById('donor-phone').value = d.phone || '';
    populateDonorProgramSelect(d.defaultProgramId || '');
    document.getElementById('modal-donor-title').textContent = 'Edit Donatur';
    openModal('modal-donor');
  } else if (btn.dataset.action === 'del-donor') {
    if (confirm(`Hapus donatur "${m.donors[idx].name}"?`)) {
      deleteDonor(idx);
      _selectedDonors.delete(idx);
      renderConfigPage();
      showToast('Donatur berhasil dihapus', 'success');
    }
  }
});

document.getElementById('btn-save-donor').addEventListener('click', () => {
  const name = sanitizeInputText(document.getElementById('donor-name').value, 100);
  if (!name) { showToast('Nama Donatur wajib diisi', 'error'); return; }
  const phone = sanitizePhone(document.getElementById('donor-phone').value, 25);
  const defaultProgramId = sanitizeSlug(document.getElementById('donor-program').value, 50);
  const idx = document.getElementById('donor-edit-idx').value;

  try {
    if (idx === '') {
      addDonor({ name, phone, defaultProgramId });
    } else {
      updateDonor(parseInt(idx, 10), { name, phone, defaultProgramId });
    }
    closeModal('modal-donor');
    renderConfigPage();
    showToast('Donatur berhasil disimpan', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ─── ALIAS ────────────────────────────────────────────────────────────────────
function renderAliasList(m) {
  const list = m.companyAliases || [];
  document.getElementById('alias-list').innerHTML = list.map((a, i) => {
    const isChecked = _selectedAliases.has(i);
    return `
    <div class="alias-item">
      <input type="checkbox" class="alias-row-checkbox" data-idx="${i}" ${isChecked ? 'checked' : ''}>
      <span>${esc(a)}</span>
      <button class="btn-icon-sm text-danger ms-auto" data-action="del-alias" data-idx="${i}" title="Hapus"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
  }).join('') || '<div class="text-muted text-xs p-3">Belum ada alias.</div>';

  updateAliasSelectionUI();
}

document.getElementById('alias-list')?.addEventListener('change', e => {
  const cb = e.target.closest('.alias-row-checkbox');
  if (!cb) return;
  const idx = parseInt(cb.dataset.idx, 10);
  if (cb.checked) {
    _selectedAliases.add(idx);
  } else {
    _selectedAliases.delete(idx);
  }
  updateAliasSelectionUI();
});

document.getElementById('btn-batch-delete-alias')?.addEventListener('click', () => {
  if (_selectedAliases.size === 0) return;
  const count = _selectedAliases.size;
  if (!confirm(`Hapus ${count} alias terpilih?`)) return;
  try {
    const deleted = batchDeleteAliases(Array.from(_selectedAliases));
    _selectedAliases.clear();
    renderConfigPage();
    showToast(`${deleted} alias berhasil dihapus`, 'success');
  } catch (err) {
    showToast('Gagal menghapus: ' + err.message, 'error');
  }
});

document.getElementById('btn-add-alias').addEventListener('click', () => {
  const val = prompt('Masukkan alias/nama lembaga yang akan disaring dari label mutasi:');
  if (!val) return;
  const clean = sanitizeInputText(val, 100);
  if (!clean) return;
  try {
    addAlias(clean);
    renderConfigPage();
    showToast(`Alias "${clean}" berhasil ditambahkan`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('alias-list').addEventListener('click', e => {
  const btn = e.target.closest('[data-action="del-alias"]');
  if (!btn) return;
  const idx = parseInt(btn.dataset.idx);
  try {
    deleteAlias(idx);
    _selectedAliases.delete(idx);
    renderConfigPage();
    showToast('Alias dihapus', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ─── AI Settings ──────────────────────────────────────────────────────────────
function renderAiSettings(m) {
  const s = m.settings || {};
  document.getElementById('ai-mode').value = s.aiMode || 'OFF';
  document.getElementById('ai-model-name').value = s.aiModelName || '';
  document.getElementById('ai-api-key').value = s.aiApiKey || '';
  document.getElementById('ollama-endpoint').value = s.ollamaEndpoint || 'http://localhost:11434/api/chat';
  document.getElementById('confidence-threshold').value = s.confidenceThreshold ?? 0.70;
  document.getElementById('org-name').value = s.orgName || '';
  toggleAiFields(s.aiMode || 'OFF');
}

function toggleAiFields(mode) {
  const isOff = mode === 'OFF';
  const isOllama = mode === 'LOCAL_OLLAMA';
  const modelEl = document.getElementById('ai-model-name');
  
  document.getElementById('group-ai-model').classList.toggle('hidden', isOff);
  document.getElementById('group-api-key').classList.toggle('hidden', isOff || isOllama);
  document.getElementById('group-ollama-endpoint').classList.toggle('hidden', !isOllama);

  if (modelEl) {
    if (mode === 'GEMINI') {
      modelEl.placeholder = 'gemini-2.0-flash';
    } else if (mode === 'OPENAI') {
      modelEl.placeholder = 'gpt-4o-mini';
    } else if (mode === 'LOCAL_OLLAMA') {
      modelEl.placeholder = 'qwen2.5:3b-instruct';
    }
  }
}

document.getElementById('ai-mode').addEventListener('change', e => toggleAiFields(e.target.value));

document.getElementById('btn-save-ai').addEventListener('click', () => {
  const aiMode = document.getElementById('ai-mode').value;
  const aiModelName = sanitizeInputText(document.getElementById('ai-model-name').value, 80);
  const aiApiKey = document.getElementById('ai-api-key').value.trim();
  const ollamaEndpoint = sanitizeInputText(document.getElementById('ollama-endpoint').value, 200);
  const confidenceThreshold = parseFloat(document.getElementById('confidence-threshold').value);
  const orgName = sanitizeInputText(document.getElementById('org-name').value, 120);
  updateMaster({ settings: { ...getMaster().settings, aiMode, aiModelName, aiApiKey, ollamaEndpoint, confidenceThreshold, orgName } });
  showToast('Pengaturan AI berhasil disimpan', 'success');
});

document.getElementById('btn-test-ai')?.addEventListener('click', async () => {
  const aiMode = document.getElementById('ai-mode').value;
  const aiModelName = document.getElementById('ai-model-name').value.trim();
  const aiApiKey = document.getElementById('ai-api-key').value.trim();
  const ollamaEndpoint = document.getElementById('ollama-endpoint').value.trim();
  
  if (aiMode === 'OFF') {
    showToast('Pilih provider AI (GEMINI / OPENAI / LOCAL OLLAMA) terlebih dahulu.', 'error');
    return;
  }

  const btn = document.getElementById('btn-test-ai');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menguji...';
  
  try {
    const res = await testAIConnection({ aiMode, aiModelName, aiApiKey, ollamaEndpoint });
    showToast(`✅ Koneksi AI Berhasil! [${res.provider} | ${res.model}] Latency: ${res.latency}ms. Hasil uji: ${res.programId || 'Program Terdeteksi'} (COA ${res.coa})`, 'success', 5000);
  } catch (err) {
    showToast(`❌ Uji Koneksi Gagal: ${err.message}`, 'error', 6000);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
});

// ─── System COA Settings ──────────────────────────────────────────────────────
function renderSystemCoaSettings(m) {
  const sys = getSystemCodes(m);
  const uCode = document.getElementById('sys-coa-unauth-code');
  const uName = document.getElementById('sys-coa-unauth-name');
  const bCode = document.getElementById('sys-coa-umum-code');
  const bName = document.getElementById('sys-coa-umum-name');
  const eCode = document.getElementById('sys-coa-expense-code');
  const eName = document.getElementById('sys-coa-expense-name');

  if (uCode) uCode.value = sys.unauth;
  if (uName) uName.value = sys.unauthName;
  if (bCode) bCode.value = sys.umum;
  if (bName) bName.value = sys.umumName;
  if (eCode) eCode.value = sys.expense;
  if (eName) eName.value = sys.expenseName;
}

function handleSaveSystemCoa() {
  const unauthCode = document.getElementById('sys-coa-unauth-code')?.value;
  const unauthName = document.getElementById('sys-coa-unauth-name')?.value;
  const umumCode = document.getElementById('sys-coa-umum-code')?.value;
  const umumName = document.getElementById('sys-coa-umum-name')?.value;
  const expenseCode = document.getElementById('sys-coa-expense-code')?.value;
  const expenseName = document.getElementById('sys-coa-expense-name')?.value;

  try {
    updateSystemAccounts({
      unauthCode,
      unauthName,
      umumCode,
      umumName,
      expenseCode,
      expenseName
    });
    renderConfigPage();
    showToast('Akun default sistem berhasil disimpan & disinkronkan ke tabel COA', 'success');
  } catch (err) {
    showToast('Gagal menyimpan akun sistem: ' + err.message, 'error');
  }
}

document.getElementById('btn-save-sys-coa')?.addEventListener('click', handleSaveSystemCoa);

// ─── Backup / Restore & Unified Importer ──────────────────────────────────────
document.getElementById('btn-export-json').addEventListener('click', () => {
  const json = exportConfigToJson();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'ziswaf-config.json'; a.click();
  URL.revokeObjectURL(url);
  showToast('Config JSON diekspor', 'success');
});

// Template Download Handlers
['coa', 'program', 'donor'].forEach(entity => {
  document.getElementById(`btn-download-template-${entity}`)?.addEventListener('click', () => {
    const XLSX = globalThis.XLSX;
    if (!XLSX) { showToast('SheetJS belum dimuat', 'error'); return; }
    let data = [];
    let sheetName = 'Template';
    if (entity === 'coa') {
      sheetName = 'COA';
      data = [
        { 'NO AKUN': 40201001, 'NAMA AKUN': 'Penerimaan Infak Umum', 'KATEGORI': 'INFAK / SEDEKAH' },
        { 'NO AKUN': 40202101, 'NAMA AKUN': 'Penerimaan Infak Program Pendidikan', 'KATEGORI': 'INFAK / SEDEKAH' }
      ];
    } else if (entity === 'program') {
      sheetName = 'Program';
      data = [
        { 'ID': 'prog-001', 'NAMA PROGRAM': 'Sedekah Subuh', 'COA': 40202101, 'KODE EKOR': '101', 'KEYWORDS': 'sedekah;subuh', 'DESKRIPSI': 'Program rutin sedekah subuh' },
        { 'ID': 'prog-002', 'NAMA PROGRAM': 'Zakat Fitrah', 'COA': 40100101, 'KODE EKOR': '999', 'KEYWORDS': 'zakat;fitrah', 'DESKRIPSI': 'Zakat fitrah Ramadan' }
      ];
    } else if (entity === 'donor') {
      sheetName = 'Donatur';
      data = [
        { 'NAMA': 'Ahmad Hidayat', 'NO HP': '08123456789', 'PROGRAM DEFAULT': 'prog-001' },
        { 'NAMA': 'Siti Nurhaliza', 'NO HP': '08129876543', 'PROGRAM DEFAULT': '' }
      ];
    }
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `template-${entity}.xlsx`);
    showToast(`Template ${entity.toUpperCase()} diunduh`, 'success');
  });
});

let _pendingMasterImport = null;

function initiateMasterImport(type, payload, fileName, targetEntity = null) {
  _pendingMasterImport = { type, payload, fileName, targetEntity };
  const promptEl = document.getElementById('master-import-prompt-text');
  if (promptEl) {
    const targetLabel = targetEntity === 'coa' ? 'Master COA' : targetEntity === 'program' ? 'Master Program' : targetEntity === 'donor' ? 'Master Donatur' : 'Master Data';
    promptEl.innerHTML = `Berkas <b>${esc(fileName)}</b> siap diimpor ke <b>${targetLabel}</b>.<br>Pilih metode impor:`;
  }
  openModal('modal-master-import-mode');
}

document.getElementById('btn-master-import-merge')?.addEventListener('click', () => {
  executePendingMasterImport('merge');
});

document.getElementById('btn-master-import-replace')?.addEventListener('click', () => {
  executePendingMasterImport('replace');
});

function executePendingMasterImport(mode) {
  if (!_pendingMasterImport) return;
  const { type, payload, fileName, targetEntity } = _pendingMasterImport;
  closeModal('modal-master-import-mode');
  _pendingMasterImport = null;

  try {
    if (type === 'json') {
      importConfigFromJson(payload, mode);
      renderConfigPage();
      showToast(`Config JSON berhasil ${mode === 'replace' ? 'ditimpa' : 'digabungkan'}`, 'success');
    } else if (type === 'excel') {
      const res = importMasterFromExcel(payload, mode, targetEntity);
      renderConfigPage();
      showToast(res.message || 'Master data berhasil diimpor', 'success');
    }
  } catch (err) {
    showToast('Gagal impor: ' + err.message, 'error');
  }
}

function handleMasterFileSelect(file, targetEntity = null) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = globalThis.XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      initiateMasterImport('excel', wb, file.name, targetEntity);
    } catch (err) {
      showToast('Gagal membaca berkas Excel/CSV: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

['coa', 'program', 'donor'].forEach(entity => {
  document.getElementById(`input-import-${entity}`)?.addEventListener('change', e => {
    if (e.target.files[0]) handleMasterFileSelect(e.target.files[0], entity);
    e.target.value = '';
  });
});

document.getElementById('input-import-json')?.addEventListener('change', async e => {
  if (!e.target.files.length) return;
  const file = e.target.files[0];
  try {
    const text = await file.text();
    JSON.parse(text); // validate basic json
    initiateMasterImport('json', text, file.name);
  } catch (err) {
    showToast('Gagal membaca berkas JSON: ' + err.message, 'error');
  }
  e.target.value = '';
});

document.getElementById('btn-reset-defaults').addEventListener('click', () => {
  if (!confirm('Reset semua konfigurasi ke default? Perubahan akan hilang.')) return;
  resetToDefaults();
  renderConfigPage();
  showToast('Konfigurasi direset ke default', 'success');
});

// ─── UPLOAD PAGE ──────────────────────────────────────────────────────────────

let _pendingFile = null;

function setupDropzone() {
  const dz = document.getElementById('dropzone');
  const fi = document.getElementById('file-input');
  document.getElementById('btn-browse').addEventListener('click', e => { e.stopPropagation(); fi.click(); });
  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); if (e.dataTransfer.files[0]) handleFileSelected(e.dataTransfer.files[0]); });
  fi.addEventListener('change', e => { if (e.target.files[0]) handleFileSelected(e.target.files[0]); e.target.value = ''; });
}

function handleFileSelected(file) {
  if (getRowCount() > 0) {
    _pendingFile = file;
    document.getElementById('rm-existing-count').textContent = getRowCount();
    openModal('modal-replace-merge');
  } else {
    processFile(file, false);
  }
}

document.getElementById('btn-replace-file').addEventListener('click', () => {
  closeModal('modal-replace-merge');
  if (_pendingFile) { clearRows(); processFile(_pendingFile, false); _pendingFile = null; }
});
document.getElementById('btn-merge-file').addEventListener('click', () => {
  closeModal('modal-replace-merge');
  if (_pendingFile) { processFile(_pendingFile, true); _pendingFile = null; }
});

const LAYER_LABELS = {
  EXPENSE: 'Beban', CAMPAIGN_TAIL: 'Kode Ekor', DONATUR_TETAP: 'Donatur Tetap',
  KEYWORD: 'Keyword', AI_SEMANTIC: 'AI', UNAUTHORIZED_FALLBACK: 'Unauthorized', MANUAL_OVERRIDE: 'Manual',
  ORG_ALIAS: 'Yayasan'
};

const TUTORIAL_CONTENT = {
  coa: {
    title: 'Cara Kerja — COA (Chart of Accounts)',
    html: `
      <p class="text-muted mb-2">Daftar akun buku besar syariah yang digunakan untuk mengelompokkan mutasi bank.</p>
      <ul class="tut-list">
        <li><b>NO AKUN</b> & <b>NAMA AKUN</b> wajib diisi, unik, dan tidak boleh kosong.</li>
        <li><b>3 Akun Default Sistem</b> (Beban <code>60100008</code>, Infak Umum <code>40201001</code>, Unauthorized <code>40201000</code>) tidak bisa dihapus karena dipakai mesin klasifikasi — edit nama tetap boleh.</li>
        <li>Lalu lintas baris transaksi yang masuk ke akun ini ditandai badge <code>[Beban]</code> / <code>[Infak Umum]</code> / <code>[Unauthorized]</code>.</li>
        <li>Import via xlsx/csv (tombol <i>Template</i> untuk contoh), atau Tambah COA manual.</li>
      </ul>`
  },
  program: {
    title: 'Cara Kerja — Program',
    html: `
      <p class="text-muted mb-2">Program penyaluran ZISWAF (zakat, infak, wakaf, dsb) yang menjadi tujuan alokasi.</p>
      <ul class="tut-list">
        <li><b>ID</b> (unik) & <b>NAMA PROGRAM</b> wajib. Satu program mengikat ke satu COA tujuan.</li>
        <li>Program jadi target klasifikasi Layer 2 (kode ekor) & Layer 4 (kata kunci).</li>
        <li>Jangan hapus program yang masih dipakai transaksi — ganti alokasinya lewat koreksi baris di Dashboard.</li>
      </ul>`
  },
  donor: {
    title: 'Cara Kerja — Donatur',
    html: `
      <p class="text-muted mb-2">Donatur tetap yang dikenali dari nama pengirim (Layer 3).</p>
      <ul class="tut-list">
        <li>Isi <b>NAMA</b> pengirim persis seperti di mutasi bank agar terdeteksi.</li>
        <li>Setiap donatur bisa diikat ke <b>Program Rutin</b> & <b>Default COA</b> (biasanya Infak Umum <code>40201001</code>).</li>
        <li>Jika nama dikenali tapi tanpa keterangan program → otomatis ke Default COA donatur, lalu bisa dikirim konfirmasi WA.</li>
      </ul>`
  },
  alias: {
    title: 'Cara Kerja — Alias Yayasan',
    html: `
      <p class="text-muted mb-2">Nama lembaga/yayasan yang difilter dari label mutasi agar tidak memicu false-positive.</p>
      <ul class="tut-list">
        <li>Masukkan nama yayasan (mis. <code>Yayasan Amil Zakat Kebumen</code>) — sistem menghapusnya dari teks sebelum klasifikasi.</li>
        <li>Jika mutasi <b>hanya</b> berisi nama lembaga (tidak ada teks lain), dialokasikan ke <b>Infak Umum <code>40201001</code></b> (layer Yayasan), bukan Unauthorized.</li>
        <li>Jika masih ada teks lain setelah penyaringan → lanjut ke jalur klasifikasi normal.</li>
      </ul>`
  },
  ai: {
    title: 'Cara Kerja — Pengaturan AI (Layer 5)',
    html: `
      <p class="text-muted mb-2">Layer terakhir: pencocokan semantik untuk mutasi yang belum terdeteksi Layer 0–4.</p>
      <ul class="tut-list">
        <li><b>AI Mode</b>: <code>OFF</code> (tanpa AI), <code>LOCAL OLLAMA</code>, <code>GEMINI</code>, atau <code>OPENAI</code>.</li>
        <li><b>Confidence Threshold</b>: minimal <code>0.70</code> agar rekomendasi AI diterima; di bawah itu → Unauthorized.</li>
        <li>Timeout <code>2 detik</code> — jika AI tidak respon, otomatis fallback ke Layer 4/Unauthorized tanpa menghentikan upload.</li>
        <li><b>API Key</b> hanya di sesi ini (tidak disimpan permanen).</li>
      </ul>`
  },
  backup: {
    title: 'Cara Kerja — Backup & Pulih',
    html: `
      <p class="text-muted mb-2">Simpan dan muat seluruh master data (COA, Program, Donatur, Alias).</p>
      <ul class="tut-list">
        <li><b>Ekspor Config JSON</b>: unduh semua master data ke satu file.</li>
        <li><b>Impor Config JSON</b>: muat kembali konfigurasi dari file (menimpa data sesi).</li>
        <li><b>Reset ke Default</b>: kembalikan ke data bawaan (hati-hati, menghapus perubahan Anda).</li>
      </ul>`
  }
};

function openTutorial(key) {
  const c = TUTORIAL_CONTENT[key];
  if (!c) return;
  document.getElementById('tutorial-title').textContent = c.title;
  document.getElementById('tutorial-body').innerHTML = c.html;
  openModal('modal-tutorial');
}

async function processFile(file, merge) {
  const dz = document.getElementById('dropzone');
  const ps = document.getElementById('progress-section');
  const pd = document.getElementById('upload-done');

  dz.classList.add('hidden');
  ps.classList.remove('hidden');
  pd.classList.add('hidden');

  const fill = document.getElementById('progress-fill');
  const label = document.getElementById('progress-label');
  const pct = document.getElementById('progress-pct');

  const layerCounts = { EXPENSE: 0, CAMPAIGN_TAIL: 0, DONATUR_TETAP: 0, KEYWORD: 0, AI_SEMANTIC: 0, UNAUTHORIZED_FALLBACK: 0 };

  try {
    const buf = await file.arrayBuffer();
    const parsed = await parseBankStatement(new Uint8Array(buf), file.name);
    if (!parsed?.length) { showToast('Tidak ada data yang dapat dibaca', 'error'); resetUploadUI(); return; }

    if (parsed.length > MAX_SESSION_ROWS) {
      showToast(`Berkas melebihi batas ${MAX_SESSION_ROWS.toLocaleString()} baris per sesi. File ini memiliki ${parsed.length} baris. Pisahkan file terlebih dahulu.`, 'error');
      resetUploadUI(); return;
    }

    parsed.sort((a, b) => b.rawAmount - a.rawAmount);
    const master = getMaster();

    const classified = await classifyBatch(parsed, master, (current, total, counts) => {
      const p = Math.round((current / total) * 100);
      fill.style.width = p + '%';
      pct.textContent = p + '%';
      label.textContent = `Memproses ${current} / ${total}`;
      if (counts) {
        Object.keys(counts).forEach(k => {
          const el = document.getElementById(`lc-${k}`);
          if (el) el.textContent = counts[k];
        });
      }
    });

    // Update final layer counters for both progress & done screen
    const finalCounts = { EXPENSE: 0, CAMPAIGN_TAIL: 0, DONATUR_TETAP: 0, KEYWORD: 0, AI_SEMANTIC: 0, UNAUTHORIZED_FALLBACK: 0 };
    classified.forEach(row => {
      if (row?.matchedLayer && finalCounts[row.matchedLayer] !== undefined) {
        finalCounts[row.matchedLayer]++;
      }
    });
    Object.keys(finalCounts).forEach(k => {
      const el1 = document.getElementById(`lc-${k}`);
      const el2 = document.getElementById(`done-lc-${k}`);
      if (el1) el1.textContent = finalCounts[k];
      if (el2) el2.textContent = finalCounts[k];
    });

    let added = classified.length;
    let skipped = 0;
    if (merge) {
      added = mergeRows(classified);
      skipped = classified.length - added;
    } else {
      setRows(classified);
    }

    ps.classList.add('hidden');
    pd.classList.remove('hidden');
    document.getElementById('done-text').textContent =
      merge
        ? `${added} baris baru ditambahkan, ${skipped} duplikat dilewati. Total: ${getRowCount()} transaksi.`
        : `${classified.length} transaksi berhasil diklasifikasi.`;

    showToast(`Selesai: ${merge ? added + ' baru ditambahkan' : classified.length + ' transaksi diklasifikasi'}`, 'success');

  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
    resetUploadUI();
  }
}

function resetUploadUI() {
  document.getElementById('dropzone').classList.remove('hidden');
  document.getElementById('progress-section').classList.add('hidden');
  document.getElementById('upload-done').classList.add('hidden');
  document.getElementById('progress-fill').style.width = '0%';
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

let _chartTop5 = null;
let _chartCat = null;
let _periodFilter = 'ALL';
let _dateFrom = null, _dateTo = null;

document.getElementById('report-period-select').addEventListener('change', e => {
  _periodFilter = e.target.value;
  const customRow = document.getElementById('custom-date-row');
  customRow.classList.toggle('hidden', _periodFilter !== 'CUSTOM');
  _selectedIds.clear();
  _isGlobalSelected = false;
  if (_periodFilter !== 'CUSTOM') {
    _dateFrom = null;
    _dateTo = null;
    setFilter({ periodFilter: _periodFilter, dateFrom: null, dateTo: null });
  }
});

document.getElementById('btn-apply-date').addEventListener('click', () => {
  _dateFrom = document.getElementById('date-from').value;
  _dateTo = document.getElementById('date-to').value;
  _selectedIds.clear();
  _isGlobalSelected = false;
  setFilter({ periodFilter: 'CUSTOM', dateFrom: _dateFrom, dateTo: _dateTo });
});

// ─── SEARCH DEBOUNCE ──────────────────────────────────────────────────────────

let _searchDebounce = null;
document.getElementById('report-search-input').addEventListener('input', e => {
  if (_searchDebounce) clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => {
    _selectedIds.clear();
    _isGlobalSelected = false;
    preserveScroll(() => {
      setFilter({ searchTerm: e.target.value });
      const { total } = getPagedRows();
      const countEl = document.getElementById('search-result-count');
      if (countEl) countEl.textContent = e.target.value ? ` (${total} hasil)` : '';
    });
  }, 250);
});
document.getElementById('report-search-scope').addEventListener('change', e => {
  _selectedIds.clear();
  _isGlobalSelected = false;
  preserveScroll(() => {
    setFilter({ searchScope: e.target.value });
  });
});
document.getElementById('report-category-select').addEventListener('change', e => {
  _selectedIds.clear();
  _isGlobalSelected = false;
  preserveScroll(() => {
    setFilter({ filterCategory: e.target.value });
  });
});
document.getElementById('card-stat-unauthorized')?.addEventListener('click', () => {
  const select = document.getElementById('report-category-select');
  const next = select.value === 'UNAUTHORIZED' ? 'ALL' : 'UNAUTHORIZED';
  select.value = next;
  _selectedIds.clear();
  _isGlobalSelected = false;
  preserveScroll(() => {
    setFilter({ filterCategory: next });
  });
});

function renderDashboard() {
  const currentY = window.scrollY;
  const allRows = getRows();

  const emptyState = document.getElementById('dashboard-empty-state');
  const dashContent = document.getElementById('dashboard-content');
  if (allRows.length === 0) {
    if (emptyState) emptyState.classList.remove('hidden');
    if (dashContent) dashContent.classList.add('hidden');
    return;
  }
  if (emptyState) emptyState.classList.add('hidden');
  if (dashContent) dashContent.classList.remove('hidden');

  const periodRows = getRowsByPeriod();

  const inflow = periodRows.filter(r => !r.isExpense && r.rawAmount > 0).reduce((s, r) => s + r.rawAmount, 0);
  const expense = periodRows.filter(r => r.isExpense || r.rawAmount < 0).reduce((s, r) => s + Math.abs(r.rawAmount), 0);
  const net = inflow - expense;
  const classified = periodRows.filter(r => r.matchedLayer !== 'UNAUTHORIZED_FALLBACK').length;
  const sys = getSystemCodes(getMaster());
  const unauthorized = periodRows.filter(r => r.matchedLayer === 'UNAUTHORIZED_FALLBACK' || r.assignedCoa === sys.unauth).length;

  document.getElementById('stat-inflow').textContent = fmtRp(inflow);
  document.getElementById('stat-expense').textContent = fmtRp(expense);

  const netEl = document.getElementById('stat-net');
  netEl.textContent = fmtRp(net);
  netEl.className = 'stat-value' + (net >= 0 ? ' text-emerald' : ' text-rose');

  document.getElementById('stat-classified').textContent = classified.toLocaleString('id-ID');
  document.getElementById('stat-unauthorized').textContent = unauthorized.toLocaleString('id-ID');

  const filter = getFilter();
  const isUnauthorized = filter.filterCategory === 'UNAUTHORIZED';
  const btnRescanToolbar = document.getElementById('btn-rescan-unauthorized');
  if (btnRescanToolbar) {
    btnRescanToolbar.classList.toggle('hidden', !isUnauthorized);
  }

  renderCharts(periodRows);
  renderTable();
  updateFooterBar(periodRows);
  requestAnimationFrame(() => {
    window.scrollTo({ top: currentY, behavior: 'instant' });
  });
}

function updateFooterBar(filtered) {
  const inflow = filtered.filter(r => !r.isExpense && r.rawAmount > 0).reduce((s, r) => s + r.rawAmount, 0);
  const expense = filtered.filter(r => r.isExpense || r.rawAmount < 0).reduce((s, r) => s + Math.abs(r.rawAmount), 0);
  document.getElementById('report-total-inflow').textContent = fmtRp(inflow);
  document.getElementById('report-total-outflow').textContent = fmtRp(expense);
  document.getElementById('report-total-rows').textContent = filtered.length.toLocaleString('id-ID') + ' Baris';
}

// ─── CHARTS ───────────────────────────────────────────────────────────────────

const CHART_COLORS = ['#38bdf8','#34d399','#a78bfa','#fbbf24','#f87171','#2dd4bf','#fb923c','#e879f9'];

function renderCharts(filtered) {
  const master = getMaster();
  const sys = getSystemCodes(master);
  renderTop5Chart(filtered, master);
  renderCatChart(filtered, sys);
}

function renderTop5Chart(filtered, master) {
  const progMap = {};
  filtered.forEach(r => {
    if (r.isExpense || r.rawAmount <= 0) return;
    const pid = r.assignedProgramId || '__none__';
    if (!progMap[pid]) progMap[pid] = { name: '', total: 0, count: 0 };
    progMap[pid].total += r.rawAmount;
    progMap[pid].count += 1;
  });
  master.programs.forEach(p => { if (progMap[p.id]) progMap[p.id].name = p.name; });
  if (progMap['__none__']) progMap['__none__'].name = 'Tidak Terprogram';

  const top5 = Object.values(progMap).sort((a, b) => b.total - a.total).slice(0, 5);

  const legendEl = document.getElementById('top5-legend');
  legendEl.innerHTML = top5.map((p, i) => `
    <div class="legend-item">
      <span class="legend-dot" style="background:${CHART_COLORS[i]}"></span>
      <span class="legend-name" title="${esc(p.name)}">${esc(p.name.length > 22 ? p.name.slice(0, 22) + '…' : p.name)}</span>
      <span class="legend-val">${fmtRp(p.total)}</span>
    </div>`).join('') || '<div class="text-muted text-xs">Tidak ada data penerimaan.</div>';

  const canvas = document.getElementById('chart-top5');
  if (!top5.length) {
    if (_chartTop5) { _chartTop5.destroy(); _chartTop5 = null; }
    return;
  }

  const isNarrow = (canvas.parentElement?.clientWidth && canvas.parentElement.clientWidth > 0)
    ? canvas.parentElement.clientWidth < 450
    : window.innerWidth < 640;

  if (_chartTop5) {
    _chartTop5.data.labels = top5.map(p => p.name.length > 10 ? p.name.slice(0, 10) + '…' : p.name);
    _chartTop5.data.datasets[0].data = top5.map(p => p.total);
    _chartTop5.data.datasets[0].backgroundColor = CHART_COLORS.slice(0, top5.length);
    _chartTop5.options.scales.x.ticks.display = !isNarrow;
    _chartTop5.update('none');
  } else {
    _chartTop5 = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: top5.map(p => p.name.length > 10 ? p.name.slice(0, 10) + '…' : p.name),
        datasets: [{ data: top5.map(p => p.total), backgroundColor: CHART_COLORS.slice(0, top5.length), borderRadius: 6, borderSkipped: false }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'x',
        onResize: (chart, size) => {
          const shouldHide = size.width < 450;
          if (chart.options.scales.x.ticks.display === shouldHide) {
            chart.options.scales.x.ticks.display = !shouldHide;
            chart.update('none');
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: items => top5[items[0]?.dataIndex]?.name || '',
              label: ctx => fmtRp(ctx.raw) + '  (' + top5[ctx.dataIndex].count + ' trx)'
            }
          }
        },
        scales: {
          y: { ticks: { callback: v => 'Rp ' + (v >= 1e9 ? (v/1e9).toFixed(1)+'M' : v >= 1e6 ? (v/1e6).toFixed(0)+'jt' : v.toLocaleString('id-ID')), color: '#8b99b0', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          x: {
            ticks: {
              display: !isNarrow,
              color: '#8b99b0',
              font: { size: 9.5 },
              maxRotation: 0,
              autoSkip: true
            },
            grid: { display: false }
          }
        }
      }
    });
  }
}

function renderCatChart(filtered, sys) {
  const umum = sys?.umum || 40201001;
  const GROUPS = {
    'Zakat': [40100000, 40100101, 40100102, 40100103],
    'Infak Umum': [umum],
    'Infak Terikat': [40201002, 40202101, 40202104, 40202201, 40202301, 40202302, 40202401, 40202501, 40202502],
    'DSKL': [40202601, 40202602],
    'Wakaf': [40301000, 40203110, 40203201],
  };
  const totals = {};
  Object.keys(GROUPS).forEach(g => totals[g] = 0);
  filtered.forEach(r => {
    if (r.isExpense || r.rawAmount <= 0) return;
    for (const [g, codes] of Object.entries(GROUPS)) {
      if (codes.includes(r.assignedCoa)) { totals[g] += r.rawAmount; return; }
    }
  });
  const items = Object.entries(totals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const grandTotal = items.reduce((s, [, v]) => s + v, 0);

  const catLegend = document.getElementById('cat-legend');
  catLegend.innerHTML = items.map(([name, val], i) => `
    <div class="legend-item">
      <span class="legend-dot" style="background:${CHART_COLORS[i]}"></span>
      <span class="legend-name">${esc(name)}</span>
      <span class="legend-val">${grandTotal ? (val / grandTotal * 100).toFixed(1) + '%' : '0%'}</span>
    </div>`).join('') || '<div class="text-muted text-xs">Tidak ada data penerimaan.</div>';

  const canvas = document.getElementById('chart-cat');
  if (!items.length) {
    if (_chartCat) { _chartCat.destroy(); _chartCat = null; }
    return;
  }

  if (_chartCat) {
    _chartCat.data.labels = items.map(([n]) => n);
    _chartCat.data.datasets[0].data = items.map(([, v]) => v);
    _chartCat.data.datasets[0].backgroundColor = CHART_COLORS.slice(0, items.length);
    _chartCat.update('none');
  } else {
    _chartCat = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: items.map(([n]) => n),
        datasets: [{ data: items.map(([, v]) => v), backgroundColor: CHART_COLORS.slice(0, items.length), borderWidth: 2, borderColor: 'transparent', hoverOffset: 6 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => fmtRp(ctx.raw) + (grandTotal ? ' (' + (ctx.raw / grandTotal * 100).toFixed(1) + '%)' : '') } }
        }
      }
    });
  }
}

// ─── TABLE ────────────────────────────────────────────────────────────────────

let _selectedIds = new Set();
let _isGlobalSelected = false;
let _tableMode = localStorage.getItem('ziswaf_demo_table_mode') || 'compact';

function applyTableMode() {
  const table = document.getElementById('transactions-table');
  const textEl = document.getElementById('toggle-mode-text');
  if (!table) return;
  if (_tableMode === 'compact') {
    table.classList.add('table-compact-mode');
    table.classList.remove('table-detail-mode');
    if (textEl) textEl.textContent = 'Ringkas';
  } else {
    table.classList.remove('table-compact-mode');
    table.classList.add('table-detail-mode');
    if (textEl) textEl.textContent = 'Detail';
  }
}

document.getElementById('btn-toggle-table-mode')?.addEventListener('click', () => {
  _tableMode = _tableMode === 'compact' ? 'detailed' : 'compact';
  localStorage.setItem('ziswaf_demo_table_mode', _tableMode);
  applyTableMode();
  renderTable();
});

function renderTable() {
  const { rows, total, totalPages, page, start, end } = getPagedRows();
  const master = getMaster();
  const { sortKey, sortDir } = getSortState();

  updateSortIcons(sortKey, sortDir);

  const tbody = document.getElementById('transactions-tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-state">${total === 0 && getRowCount() === 0 ? 'Belum ada data. Upload mutasi bank terlebih dahulu.' : 'Tidak ada data sesuai filter.'}</td></tr>`;
  } else {
    const coaOptions = master.coaList.map(c => `<option value="${c.code}">${esc(c.code)} - ${esc(c.name)}</option>`).join('');
    tbody.innerHTML = rows.map((row, i) => {
      const rowNum = start + i;
      const donor = master.donors.find(d => d.id === row.matchedDonorId);
      const phone = donor?.phone || '';
      const prog = master.programs.find(p => p.id === row.assignedProgramId);
      const label = row.cleanedLabel || row.rawLabel || '-';
      const isAi = row.matchedLayer === 'AI_SEMANTIC';
      const layerBadge = isAi
        ? `<span class="badge badge-ai-semantic"><i class="fa-solid fa-wand-magic-sparkles"></i> AI</span>`
        : `<span class="badge badge-${(row.matchedLayer || '').toLowerCase().replace(/_/g, '-')}">${LAYER_LABELS[row.matchedLayer] || row.matchedLayer || '-'}</span>`;
      
      const sys = getSystemCodes(master);
      const statusBadge = row.assignedCoa === sys.unauth
        ? '<span class="badge badge-unauthorized">Unauthorized</span>'
        : row.matchedLayer === 'MANUAL_OVERRIDE'
          ? '<span class="badge badge-manual">Manual</span>'
          : row.assignedCoa === sys.expense
            ? '<span class="badge badge-expense">Beban</span>'
            : '<span class="badge badge-ok">OK</span>';

      const waBtn = row.matchedDonorId ? `<button class="btn-icon-sm btn-wa${phone ? '' : ' disabled'}" data-action="open-wa" data-id="${esc(row.id)}"${phone ? '' : ' disabled title="Donatur tidak memiliki nomor HP"'} title="Kirim konfirmasi WA">
            <i class="fa-brands fa-whatsapp"></i>
          </button>` : '';

      const isCompact = _tableMode === 'compact';
      const coaTooltip = `No. Akun: ${row.assignedCoa || '-'}\nNama Akun: ${row.newName || '-'}\nProgram: ${prog?.name || '-'}`;
      const rationaleTooltip = `Layer: ${row.matchedLayer || 'MANUAL'}\nKeyakinan AI: ${row.confidence != null ? (row.confidence * 100).toFixed(0) + '%' : '-'}\nAlasan: ${row.reasoning || '-'}`;
      const labelTooltip = `Keterangan: ${row.rawLabel || '-'}\nPengirim: ${row.extractedSenderName || '-'}`;
      const reasonDisplay = row.reasoning || (row.matchedLayer === 'UNAUTHORIZED_FALLBACK' ? 'Tidak cocok kriteria (Unauthorized)' : '-');
      const senderClean = (row.extractedSenderName || '').trim();
      const labelClean = (label || '').trim();
      const showSender = senderClean && 
        senderClean.toLowerCase() !== labelClean.toLowerCase() && 
        !labelClean.toLowerCase().includes(senderClean.toLowerCase());

      const rawText = (row.rawLabel || row.cleanedLabel || '-').trim();

      if (isCompact) {
        return `<tr class="${_selectedIds.has(row.id) ? 'row-selected' : ''}">
          <td><input type="checkbox" class="row-checkbox" data-id="${esc(row.id)}" ${_selectedIds.has(row.id) ? 'checked' : ''}></td>
          <td class="text-xs text-muted">${rowNum}</td>
          <td class="text-xs nowrap">${esc(row.transactionDate || '-')}</td>
          <td class="nowrap fw-semibold ${row.isExpense || row.rawAmount < 0 ? 'text-rose' : 'text-emerald'}">${fmtRp(row.rawAmount)}</td>
          <td class="text-xs cell-keterangan" data-tooltip="${esc(rawText)}">
            <div class="keterangan-text">${esc(rawText)}</div>
          </td>
          <td data-tooltip="${esc(coaTooltip)}">
            <select class="coa-select" data-id="${esc(row.id)}">
              ${master.coaList.map(c => `<option value="${c.code}" ${c.code === row.assignedCoa ? 'selected' : ''}>${esc(c.code)} - ${esc(c.name)}</option>`).join('')}
            </select>
          </td>
          <td class="text-xs" data-tooltip="${esc(rationaleTooltip)}">
            <div class="layer-pill-compact">
              ${layerBadge}
              ${row.confidence != null && isAi ? `<span class="conf-badge">${(row.confidence * 100).toFixed(0)}%</span>` : ''}
            </div>
            <div class="truncate-1 text-muted text-xs mt-1 ${isAi ? 'text-accent' : ''}">${isAi ? '<i class="fa-solid fa-wand-magic-sparkles text-xs"></i> ' : ''}${esc(reasonDisplay)}</div>
          </td>
        </tr>`;
      } else {
        return `<tr class="${_selectedIds.has(row.id) ? 'row-selected' : ''}">
          <td><input type="checkbox" class="row-checkbox" data-id="${esc(row.id)}" ${_selectedIds.has(row.id) ? 'checked' : ''}></td>
          <td class="text-xs text-muted">${rowNum}</td>
          <td class="text-xs nowrap">${esc(row.transactionDate || '-')}</td>
          <td class="nowrap fw-semibold ${row.isExpense || row.rawAmount < 0 ? 'text-rose' : 'text-emerald'}">${fmtRp(row.rawAmount)}</td>
          <td class="text-xs cell-keterangan" data-tooltip="${esc(rawText)}">
            <div class="keterangan-text">${esc(rawText)}</div>
          </td>
          <td>
            <select class="coa-select" data-id="${esc(row.id)}">
              ${master.coaList.map(c => `<option value="${c.code}" ${c.code === row.assignedCoa ? 'selected' : ''}>${esc(c.code)} - ${esc(c.name)}</option>`).join('')}
            </select>
            ${prog ? `<div class="text-muted text-xs mt-1 truncate-1" data-tooltip="${esc(prog.name)}"><i class="fa-solid fa-hand-holding-heart"></i> ${esc(prog.name)}</div>` : ''}
          </td>
          <td class="text-xs">
            <div class="fw-semibold">${layerBadge}${row.confidence != null && isAi ? ` <span class="conf-badge">${(row.confidence * 100).toFixed(0)}%</span>` : ''}</div>
            <div class="${isAi ? 'text-accent' : 'text-muted'} reasoning-full mt-1">${isAi ? '<i class="fa-solid fa-wand-magic-sparkles text-xs"></i> ' : ''}${esc(reasonDisplay)}</div>
          </td>
        </tr>`;
      }
    }).join('');
  }

  renderPagination(page, totalPages, total, start, end);
  initAllStickyScrollbars();
  document.getElementById('reporting-top-pagination-info').textContent =
    total ? `Menampilkan ${start}–${end} dari ${total.toLocaleString('id-ID')} transaksi` : '';

  const allPageSelected = rows.length > 0 && rows.every(r => _selectedIds.has(r.id));
  document.getElementById('report-select-all').checked = allPageSelected;

  document.querySelectorAll('.row-checkbox').forEach(cb => cb.addEventListener('change', onRowCheckbox));
  document.querySelectorAll('.coa-select').forEach(sel => sel.addEventListener('change', onCoaChange));
  document.querySelectorAll('[data-action="open-wa"]').forEach(btn => btn.addEventListener('click', onWaClick));

  applyTableMode();
  updateSelectionBanner();
  updateGlobalSelectionBanner();
}

function updateSortIcons(key, dir) {
  ['date','amount','label','coa'].forEach(k => {
    const el = document.getElementById(`sort-icon-${k}`);
    if (!el) return;
    if (k === key) {
      el.className = `fa-solid ${dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down'} sort-icon active`;
    } else {
      el.className = 'fa-solid fa-sort sort-icon';
    }
  });
}

document.getElementById('transactions-table').addEventListener('click', e => {
  const th = e.target.closest('.th-sortable');
  if (th) {
    preserveScroll(() => {
      setSort(th.dataset.sort);
      renderTable();
    });
  }
});

function updateGlobalSelectionBanner() {
  const banner = document.getElementById('global-selection-banner');
  if (!banner) return;
  const { rows } = getPagedRows();
  const filtered = getFilteredSorted();
  const totalCount = filtered.length;
  const allPageSelected = rows.length > 0 && rows.every(r => _selectedIds.has(r.id));

  if (allPageSelected && totalCount > rows.length) {
    banner.classList.remove('hidden');
    banner.classList.add('show');
    const isChecked = _isGlobalSelected ? 'checked' : '';
    const activeClass = _isGlobalSelected ? 'text-emerald fw-bold' : '';
    const countFormatted = totalCount.toLocaleString('id-ID');

    banner.innerHTML = `
      <div class="d-flex align-items-center gap-2">
        <input type="checkbox" id="cb-global-select-scope" class="global-scope-checkbox" ${isChecked}>
        <label for="cb-global-select-scope" class="global-scope-label ${activeClass}">
          ${_isGlobalSelected ? `Semua <strong>${countFormatted}</strong> transaksi dipilih` : `Pilih semua <strong>${countFormatted}</strong> transaksi hasil filter ini`}
        </label>
      </div>
    `;

    const cbGlobal = banner.querySelector('#cb-global-select-scope');
    if (cbGlobal) {
      cbGlobal.addEventListener('change', e => {
        _isGlobalSelected = e.target.checked;
        const currentFiltered = getFilteredSorted();
        _selectedIds.clear();
        if (_isGlobalSelected) {
          currentFiltered.forEach(r => _selectedIds.add(r.id));
        } else {
          rows.forEach(r => _selectedIds.add(r.id));
        }
        updateSelectionBanner();
        updateGlobalSelectionBanner();
        renderTable();
      });
    }
  } else {
    banner.classList.add('hidden');
    banner.classList.remove('show');
    banner.innerHTML = '';
    if (!allPageSelected && _selectedIds.size === 0) {
      _isGlobalSelected = false;
    }
  }
}

document.getElementById('report-select-all').addEventListener('change', e => {
  const { rows } = getPagedRows();
  if (e.target.checked) {
    rows.forEach(r => _selectedIds.add(r.id));
  } else {
    rows.forEach(r => _selectedIds.delete(r.id));
    _isGlobalSelected = false;
  }
  updateSelectionBanner();
  updateGlobalSelectionBanner();
  renderTable();
});

function onRowCheckbox(e) {
  const id = e.target.dataset.id;
  e.target.checked ? _selectedIds.add(id) : _selectedIds.delete(id);
  _isGlobalSelected = false;
  e.target.closest('tr').classList.toggle('row-selected', e.target.checked);
  const { rows } = getPagedRows();
  document.getElementById('report-select-all').checked = rows.length > 0 && rows.every(r => _selectedIds.has(r.id));
  updateSelectionBanner();
  updateGlobalSelectionBanner();
}

function onCoaChange(e) {
  const id = e.target.dataset.id;
  const newCoa = parseInt(e.target.value);
  const master = getMaster();
  const coaEntry = master.coaList.find(c => c.code === newCoa);
  preserveScroll(() => {
    updateRow(id, {
      assignedCoa: newCoa,
      newName: coaEntry?.name || String(newCoa),
      matchedLayer: 'MANUAL_OVERRIDE',
      isOverridden: true,
      confidence: 1.0,
      reasoning: 'Override manual',
      isExpense: newCoa === 60100008
    });
    renderDashboard();
  });
}

function updateSelectionBanner() {
  const banner = document.getElementById('selection-banner');
  const badge = document.getElementById('selected-count-badge');
  const btnBulkGeneral = document.getElementById('btn-bulk-general');
  const btnBulkRescan = document.getElementById('btn-bulk-rescan');
  const activeFiltered = getFilteredSorted();
  const activeFilteredIdSet = new Set(activeFiltered.map(r => r.id));
  const validCount = _isGlobalSelected
    ? activeFiltered.length
    : [..._selectedIds].filter(id => activeFilteredIdSet.has(id)).length;

  if (validCount > 0) {
    banner.classList.remove('hidden');
    badge.textContent = `${validCount.toLocaleString('id-ID')} transaksi dicentang`;

    // Tombol "Infak Umum" & "Rescan 5-Layer" hanya muncul saat memfilter UNAUTHORIZED
    const filter = getFilter();
    const isUnauthorized = filter.filterCategory === 'UNAUTHORIZED';
    if (btnBulkGeneral) {
      btnBulkGeneral.classList.toggle('hidden', !isUnauthorized);
    }
    if (btnBulkRescan) {
      btnBulkRescan.classList.toggle('hidden', !isUnauthorized);
    }
  } else {
    banner.classList.add('hidden');
  }
}

// ─── BULK ACTIONS ─────────────────────────────────────────────────────────────

let _undoSnapshot = null;
let _undoTimer = null;

function showUndoToast(msg) {
  if (_undoTimer) clearTimeout(_undoTimer);
  const root = document.getElementById('toast-root');
  const old = document.getElementById('toast-undo');
  if (old) old.remove();
  const t = document.createElement('div');
  t.className = 'toast toast-info toast-undo';
  t.id = 'toast-undo';
  t.innerHTML = `${msg} <button class="btn-undo-inline" id="btn-undo-bulk">Urungkan</button>`;
  root.appendChild(t);
  document.getElementById('btn-undo-bulk').addEventListener('click', () => {
    if (_undoSnapshot) {
      if (_undoSnapshot.isDelete) {
        restoreRows(_undoSnapshot.deletedRows);
      } else {
        const patchMap = new Map(_undoSnapshot.patches.map(p => [p.id, p]));
        bulkPatchRows(patchMap);
      }
    }
    if (_undoTimer) clearTimeout(_undoTimer);
    t.remove();
    renderDashboard();
    showToast('Aksi dibatalkan', 'info');
    _undoSnapshot = null;
  });
  _undoTimer = setTimeout(() => { t.classList.add('fadeout'); setTimeout(() => t.remove(), 300); _undoSnapshot = null; }, 8000);
}

async function execute5LayerRescan(targetIds = null) {
  const master = getMaster();
  const sys = getSystemCodes(master);
  const activeFiltered = getFilteredSorted();

  let targetRows = [];
  if (targetIds && targetIds.length > 0) {
    targetRows = getRows().filter(r => targetIds.includes(r.id));
  } else {
    // Scan all currently filtered rows in Unauthorized
    targetRows = activeFiltered.filter(r => r.assignedCoa === sys.unauth || r.matchedLayer === 'UNAUTHORIZED_FALLBACK');
  }

  if (!targetRows.length) {
    showToast('Tidak ada transaksi Unauthorized untuk dipindai ulang.', 'info');
    return;
  }

  const btnToolbar = document.getElementById('btn-rescan-unauthorized');
  const btnBulk = document.getElementById('btn-bulk-rescan');
  const origToolbarHtml = btnToolbar ? btnToolbar.innerHTML : '';
  const origBulkHtml = btnBulk ? btnBulk.innerHTML : '';

  if (btnToolbar) {
    btnToolbar.disabled = true;
    btnToolbar.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> <span class="btn-text">Memindai...</span>';
  }
  if (btnBulk) {
    btnBulk.disabled = true;
    btnBulk.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> <span class="btn-text">Memindai...</span>';
  }

  // Show Live Rescan Progress Modal
  const modalProgress = document.getElementById('modal-rescan-progress');
  const rescanFill = document.getElementById('rescan-progress-fill');
  const rescanLabel = document.getElementById('rescan-progress-label');
  const rescanPct = document.getElementById('rescan-progress-pct');

  if (modalProgress) {
    modalProgress.classList.remove('hidden');
    if (rescanFill) rescanFill.style.width = '0%';
    if (rescanPct) rescanPct.textContent = '0%';
    if (rescanLabel) rescanLabel.textContent = `Memproses 0 / ${targetRows.length}`;
    ['EXPENSE', 'CAMPAIGN_TAIL', 'DONATUR_TETAP', 'KEYWORD', 'AI_SEMANTIC', 'UNAUTHORIZED_FALLBACK'].forEach(k => {
      const el = document.getElementById(`rescan-lc-${k}`);
      if (el) el.textContent = '0';
    });
  }

  try {
    // Snapshot for Undo before rescanning
    const snapshotIds = targetRows.map(r => r.id);
    const snapshotPatches = targetRows.map(r => ({ ...r }));
    _undoSnapshot = { isDelete: false, ids: snapshotIds, patches: snapshotPatches };

    // Run 5-Layer Classifier on the target rows with live progress updates!
    const newlyClassified = await classifyBatch(targetRows, master, (current, total, item, counts) => {
      const p = Math.round((current / total) * 100);
      if (rescanFill) rescanFill.style.width = p + '%';
      if (rescanPct) rescanPct.textContent = p + '%';
      if (rescanLabel) rescanLabel.textContent = `Memproses ${current} / ${total}`;
      if (counts) {
        Object.keys(counts).forEach(k => {
          const el = document.getElementById(`rescan-lc-${k}`);
          if (el) el.textContent = counts[k];
        });
      }
    });

    // Brief delay to let amil see 100% completion
    await new Promise(resolve => setTimeout(resolve, 350));

    // Build patch map for bulkPatchRows
    const patchMap = new Map();
    let promotedCount = 0;

    newlyClassified.forEach(item => {
      const isStillUnauth = item.assignedCoa === sys.unauth || item.matchedLayer === 'UNAUTHORIZED_FALLBACK';
      if (!isStillUnauth) {
        promotedCount++;
      }
      patchMap.set(item.id, {
        assignedCoa: item.assignedCoa,
        assignedCoaName: item.assignedCoaName,
        assignedProgramId: item.assignedProgramId,
        matchedLayer: item.matchedLayer,
        confidence: item.confidence,
        reasoning: item.reasoning,
        isExpense: item.isExpense,
        isOverridden: false
      });
    });

    bulkPatchRows(patchMap);

    _selectedIds.clear();
    _isGlobalSelected = false;
    renderDashboard();

    if (promotedCount > 0) {
      showUndoToast(`✅ Rescan 5-Layer selesai: <b>${promotedCount}</b> dari <b>${targetRows.length}</b> transaksi berhasil terklasifikasi!`);
    } else {
      showToast(`Pindai ulang selesai: ${targetRows.length} transaksi belum cocok dengan kata kunci atau program saat ini.`, 'info');
    }
  } catch (err) {
    showToast('Gagal memindai ulang: ' + err.message, 'error');
  } finally {
    if (modalProgress) {
      modalProgress.classList.add('hidden');
    }
    if (btnToolbar) {
      btnToolbar.disabled = false;
      btnToolbar.innerHTML = origToolbarHtml;
    }
    if (btnBulk) {
      btnBulk.disabled = false;
      btnBulk.innerHTML = origBulkHtml;
    }
  }
}

document.getElementById('btn-rescan-unauthorized')?.addEventListener('click', () => {
  execute5LayerRescan();
});

document.getElementById('btn-bulk-rescan')?.addEventListener('click', () => {
  const activeFiltered = getFilteredSorted();
  const activeFilteredIdSet = new Set(activeFiltered.map(r => r.id));
  const ids = _isGlobalSelected
    ? activeFiltered.map(r => r.id)
    : [..._selectedIds].filter(id => activeFilteredIdSet.has(id));
  execute5LayerRescan(ids);
});

document.getElementById('btn-bulk-general').addEventListener('click', () => {
  const master = getMaster();
  const sys = getSystemCodes(master);
  const coa = master.coaList.find(c => c.code === sys.umum);
  const activeFiltered = getFilteredSorted();
  const activeFilteredIdSet = new Set(activeFiltered.map(r => r.id));
  const ids = _isGlobalSelected
    ? activeFiltered.map(r => r.id)
    : [..._selectedIds].filter(id => activeFilteredIdSet.has(id));
  if (!ids.length) return;
  _undoSnapshot = { isDelete: false, ids, patches: getRows().filter(r => ids.includes(r.id)).map(r => ({ ...r })) };
  bulkUpdateRows(ids, { assignedCoa: sys.umum, newName: coa?.name || 'Infak Umum', assignedProgramId: null, matchedLayer: 'MANUAL_OVERRIDE', isOverridden: true, confidence: 1.0, reasoning: 'Bulk set Infak Umum', isExpense: false });
  _selectedIds.clear();
  _isGlobalSelected = false;
  renderDashboard();
  showUndoToast(`${ids.length} transaksi diset ke Infak Umum.`);
});

document.getElementById('btn-bulk-delete').addEventListener('click', () => {
  const activeFiltered = getFilteredSorted();
  const activeFilteredIdSet = new Set(activeFiltered.map(r => r.id));
  const ids = _isGlobalSelected
    ? activeFiltered.map(r => r.id)
    : [..._selectedIds].filter(id => activeFilteredIdSet.has(id));
  if (!ids.length) return;

  if (!confirm(`Apakah Anda yakin ingin menghapus ${ids.length} transaksi yang dicentang?`)) {
    return;
  }

  const deletedRows = getRows().filter(r => ids.includes(r.id)).map(r => ({ ...r }));
  _undoSnapshot = { isDelete: true, deletedRows };
  deleteRows(ids);
  _selectedIds.clear();
  _isGlobalSelected = false;
  renderDashboard();
  showUndoToast(`${ids.length} transaksi berhasil dihapus.`);
});

// ─── PAGINATION ───────────────────────────────────────────────────────────────

function renderPagination(page, totalPages, total, start, end) {
  const container = document.getElementById('reporting-pagination-container');
  if (totalPages <= 1) { container.innerHTML = ''; return; }

  const pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('…');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push('…');
    pages.push(totalPages);
  }

  container.innerHTML = `<div class="pagination-bar">
    <button class="page-btn" data-p="${page - 1}" ${page === 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>
    ${pages.map(p => p === '…'
      ? `<span class="page-ellipsis">…</span>`
      : `<button class="page-btn ${p === page ? 'active' : ''}" data-p="${p}">${p}</button>`
    ).join('')}
    <button class="page-btn" data-p="${page + 1}" ${page === totalPages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>
  </div>`;

  container.querySelectorAll('[data-p]').forEach(btn => {
    btn.addEventListener('click', () => {
      preserveScroll(() => {
        setPage(parseInt(btn.dataset.p));
        renderTable();
      });
    });
  });
}

// ─── WA COMPOSE ───────────────────────────────────────────────────────────────

function onWaClick(e) {
  const id = e.target.closest('[data-id]')?.dataset.id;
  if (!id) return;
  const row = getRows().find(r => r.id === id);
  if (!row) return;
  const master = getMaster();
  const donor = master.donors.find(d => d.id === row.matchedDonorId);
  const prog = master.programs.find(p => p.id === row.assignedProgramId);
  const orgName = master.settings?.orgName || 'Lembaga Amil ZISWAF';
  const progName = prog?.name || 'Donasi Umum';
  const phone = normPhone(donor?.phone || '');
  const donorName = donor?.name || 'Donatur';
  const nominal = fmtRp(row.rawAmount);
  const tgl = row.transactionDate || '-';

  const msg = `Assalamu'alaikum Warahmatullahi Wabarakatuh,\n\nYth. Bpk/Ibu *${donorName}*,\nTerima kasih atas kebaikan Anda. Kami mendeteksi transfer donasi sebesar *${nominal}* pada tanggal *${tgl}* yang kami alokasikan untuk *${progName}*.\n\nMohon konfirmasi alokasi niat donasi Anda:\n1️⃣ *1* - Benar Saya & Sesuai (${progName})\n2️⃣ *2* - Benar Saya, Ingin Ubah Program Lain\n3️⃣ *3* - Bukan Transfer Saya (Dibatalkan)\n4️⃣ *4* - Konsultasi dengan Petugas\n\nSemoga Allah SWT membalas dengan keberkahan yang berlipat ganda. Aamiin.\n\n— ${orgName}`;

  document.getElementById('wa-phone').value = phone;
  document.getElementById('wa-message').value = msg;
  openModal('modal-wa');
}

document.getElementById('btn-open-wa').addEventListener('click', () => {
  let phone = normPhone(document.getElementById('wa-phone').value);
  const msg = document.getElementById('wa-message').value;
  if (!phone) { showToast('Nomor HP wajib diisi', 'error'); return; }
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
  closeModal('modal-wa');
});

// ─── EXPORT ───────────────────────────────────────────────────────────────────

document.getElementById('btn-export-xlsx').addEventListener('click', () => {
  const activeFiltered = getFilteredSorted();
  const activeFilteredIdSet = new Set(activeFiltered.map(r => r.id));
  const rows = _selectedIds.size > 0
    ? activeFiltered.filter(r => _selectedIds.has(r.id))
    : activeFiltered;
  if (!rows.length) { showToast('Tidak ada data untuk diekspor', 'error'); return; }
  try {
    const bytes = exportOdooExcel(rows);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `jurnal-ziswaf-${new Date().toISOString().slice(0,10)}.xlsx`; a.click();
    URL.revokeObjectURL(url);
    showToast(`${rows.length} transaksi diekspor ke .xlsx`, 'success');
  } catch (err) { showToast('Gagal ekspor: ' + err.message, 'error'); }
});

document.getElementById('btn-export-csv2').addEventListener('click', () => {
  const activeFiltered = getFilteredSorted();
  const activeFilteredIdSet = new Set(activeFiltered.map(r => r.id));
  const rows = _selectedIds.size > 0
    ? activeFiltered.filter(r => _selectedIds.has(r.id))
    : activeFiltered;
  if (!rows.length) { showToast('Tidak ada data untuk diekspor', 'error'); return; }
  try {
    const csv = exportOdooCsv(rows);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `jurnal-ziswaf-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    showToast(`${rows.length} transaksi diekspor ke .csv`, 'success');
  } catch (err) { showToast('Gagal ekspor: ' + err.message, 'error'); }
});

// ─── Subscribe session store ──────────────────────────────────────────────────

import { subscribe as subscribeSession } from "./store/session_store.js";
subscribeSession(() => {
  if (!document.getElementById('page-dashboard').classList.contains('hidden')) {
    renderDashboard();
  }
});

// ─── STICKY HORIZONTAL SCROLLBAR ─────────────────────────────────────────────

export class StickyHorizontalScrollbar {
  constructor(targetContainer) {
    if (!targetContainer) return;
    this.target = targetContainer;
    this.bar = document.createElement("div");
    this.dummy = document.createElement("div");
    this.isSyncing = false;
    this._boundUpdate = this.update.bind(this);

    this.init();
  }

  init() {
    this.bar.className = "floating-table-scrollbar";
    this.dummy.className = "floating-table-scrollbar-dummy";
    this.bar.appendChild(this.dummy);
    document.body.appendChild(this.bar);

    this.bar.addEventListener("scroll", () => {
      if (this.isSyncing) return;
      this.isSyncing = true;
      this.target.scrollLeft = this.bar.scrollLeft;
      this.isSyncing = false;
    }, { passive: true });

    this.target.addEventListener("scroll", () => {
      if (this.isSyncing) return;
      this.isSyncing = true;
      this.bar.scrollLeft = this.target.scrollLeft;
      this.isSyncing = false;
    }, { passive: true });

    window.addEventListener("scroll", this._boundUpdate, { passive: true });
    window.addEventListener("resize", this._boundUpdate, { passive: true });

    if (window.ResizeObserver) {
      this.ro = new ResizeObserver(this._boundUpdate);
      this.ro.observe(this.target);
      const tbl = this.target.querySelector("table");
      if (tbl) this.ro.observe(tbl);
    }

    requestAnimationFrame(this._boundUpdate);
  }

  update() {
    if (!this.target || !document.body.contains(this.target)) {
      this.bar.style.display = "none";
      return;
    }

    const targetRect = this.target.getBoundingClientRect();
    const hasHorizontalOverflow = this.target.scrollWidth > (this.target.clientWidth + 2);
    const isPartiallyVisible = targetRect.bottom > 80 && targetRect.top < (window.innerHeight - 20);
    const isNativeScrollbarVisible = targetRect.bottom <= (window.innerHeight + 6);

    if (!hasHorizontalOverflow || !isPartiallyVisible || isNativeScrollbarVisible) {
      this.bar.style.display = "none";
      return;
    }

    this.bar.style.display = "block";
    this.bar.style.position = "fixed";
    this.bar.style.left = `${targetRect.left}px`;
    this.bar.style.width = `${targetRect.width}px`;
    this.bar.style.bottom = "0px";
    this.bar.style.zIndex = "45";

    this.dummy.style.width = `${this.target.scrollWidth}px`;
    this.dummy.style.height = "1px";

    if (!this.isSyncing) {
      this.isSyncing = true;
      this.bar.scrollLeft = this.target.scrollLeft;
      this.isSyncing = false;
    }
  }

  destroy() {
    window.removeEventListener("scroll", this._boundUpdate);
    window.removeEventListener("resize", this._boundUpdate);
    if (this.ro) this.ro.disconnect();
    if (this.bar && this.bar.parentNode) {
      this.bar.parentNode.removeChild(this.bar);
    }
  }
}

export function initAllStickyScrollbars() {
  document.querySelectorAll(".table-responsive").forEach(el => {
    if (!el._stickyScrollbar) {
      el._stickyScrollbar = new StickyHorizontalScrollbar(el);
    } else {
      el._stickyScrollbar.update();
    }
  });
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  setupDropzone();

  // 1. Restore Filter Controls DOM values from persistent session state
  const curFilter = getFilter();
  const catSelect = document.getElementById('report-category-select');
  if (catSelect && curFilter.filterCategory) catSelect.value = curFilter.filterCategory;

  const scopeSelect = document.getElementById('report-search-scope');
  if (scopeSelect && curFilter.searchScope) scopeSelect.value = curFilter.searchScope;

  const searchInput = document.getElementById('report-search-input');
  if (searchInput && curFilter.searchTerm) {
    searchInput.value = curFilter.searchTerm;
    const countEl = document.getElementById('search-result-count');
    if (countEl) countEl.textContent = ` (${getPagedRows().total} hasil)`;
  }

  const periodSelect = document.getElementById('report-period-select');
  if (periodSelect && curFilter.periodFilter) {
    periodSelect.value = curFilter.periodFilter;
    const customRow = document.getElementById('custom-date-row');
    if (customRow) customRow.classList.toggle('hidden', curFilter.periodFilter !== 'CUSTOM');
  }

  // 2. Restore active page & subtab
  let savedPage = null;
  try { savedPage = localStorage.getItem('ziswaf_active_page'); } catch (e) {}
  if (!savedPage || !PAGES.includes(savedPage)) {
    savedPage = getRowCount() > 0 ? 'dashboard' : 'config';
  }
  navigateTo(savedPage, true);

  let savedSubtab = null;
  try { savedSubtab = localStorage.getItem('ziswaf_active_subtab'); } catch (e) {}
  if (savedSubtab && SUBTABS.includes(savedSubtab)) {
    switchSubtab(savedSubtab);
  }

  initAllStickyScrollbars();

  // 3. Restore window scroll position
  requestAnimationFrame(() => {
    restoreSavedScroll();
  });
});
