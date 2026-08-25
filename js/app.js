import { getMaster, updateMaster, resetToDefaults, subscribe as subscribeMaster, exportConfigToJson, importConfigFromJson, importMasterFromExcel, addCoa, updateCoa, deleteCoa, addProgram, updateProgram, deleteProgram, addDonor, updateDonor, deleteDonor, addAlias, deleteAlias } from "./store/master_store.js";
import { classifyBatch } from "./engine/classifier.js";
import { testAIConnection } from "./engine/ai_matcher.js";
import { parseBankStatement, exportOdooExcel, exportOdooCsv } from "./services/excel_adapter.js";
import {
  getRows, getRowCount, setRows, mergeRows, updateRow, bulkUpdateRows, clearRows,
  getFilteredSorted, getPagedRows, getStats, getFilter, setFilter, getSortState, setSort,
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
  const overlay = e.target;
  if (overlay.classList.contains('modal-overlay')) closeModal(overlay.id);
});

// ─── JS Tooltip ───────────────────────────────────────────────────────────────

const _ttEl = document.getElementById('js-tooltip');
document.addEventListener('mouseover', e => {
  const el = e.target.closest('[data-tooltip]');
  if (!el) { _ttEl.style.display = 'none'; return; }
  _ttEl.textContent = el.dataset.tooltip;
  _ttEl.style.display = 'block';
});
document.addEventListener('mousemove', e => {
  if (_ttEl.style.display === 'none') return;
  const gap = 12;
  let x = e.clientX + gap;
  let y = e.clientY - _ttEl.offsetHeight - gap;
  if (x + _ttEl.offsetWidth > window.innerWidth) x = e.clientX - _ttEl.offsetWidth - gap;
  if (y < 0) y = e.clientY + gap;
  _ttEl.style.left = x + 'px';
  _ttEl.style.top = y + 'px';
});
document.addEventListener('mouseout', e => {
  if (!e.target.closest('[data-tooltip]')) _ttEl.style.display = 'none';
});

const PAGES = ['config', 'upload', 'dashboard'];
let _completedUpload = false;

function navigateTo(page) {
  PAGES.forEach(p => {
    document.getElementById(`page-${p}`).classList.toggle('hidden', p !== page);
    document.getElementById(`step-${p}`)?.classList.toggle('active', p === page);
  });
  if (page === 'config') renderConfigPage();
  if (page === 'dashboard') renderDashboard();
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

document.getElementById('config-subtabs').addEventListener('click', e => {
  const btn = e.target.closest('.subtab');
  if (!btn) return;
  document.querySelectorAll('.subtab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.subtab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`panel-${btn.dataset.tab}`)?.classList.add('active');
});

function renderConfigPage() {
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
}

// — COA —
function getSystemCodes(m) {
  const s = m.settings || {};
  return {
    unauth: s.defaultUnauthorizedCoa || 40201000,
    umum:   s.defaultBaselineCoa    || 40201001,
    expense: s.expenseCoa           || 60100008,
  };
}

function renderCoaTable(m) {
  const sys = getSystemCodes(m);
  const sysSet = new Set([sys.unauth, sys.umum, sys.expense]);
  document.getElementById('tbody-coa').innerHTML = m.coaList.map((c, i) => {
    const isSysMapped = sysSet.has(c.code);
    const sysLabel = c.code === sys.unauth ? 'Unauthorized' : c.code === sys.umum ? 'Infak Umum' : c.code === sys.expense ? 'Beban' : '';
    return `<tr>
      <td><code>${esc(c.code)}</code></td>
      <td>${esc(c.name)}${isSysMapped ? ` <span class="badge-sys" title="Dipetakan sebagai default ${sysLabel}">${sysLabel}</span>` : ''}</td>
      <td><span class="badge-cat">${esc(c.category || 'UMUM')}</span></td>
      <td>
        <button class="btn-icon-sm" data-action="edit-coa" data-idx="${i}" title="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="btn-icon-sm text-danger" data-action="del-coa" data-idx="${i}" title="Hapus"${isSysMapped ? ' disabled' : ''}><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" class="empty-state">Belum ada COA.</td></tr>';
}

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
      const newList = m.coaList.filter((_, i) => i !== idx);
      updateMaster({ coaList: newList });
      renderConfigPage();
    }
  }
});

document.getElementById('btn-save-coa').addEventListener('click', () => {
  const code = parseInt(document.getElementById('coa-code').value);
  const name = document.getElementById('coa-name').value.trim();
  const category = document.getElementById('coa-category').value.trim() || 'UMUM';
  if (!code || !name) { showToast('Kode dan Nama Akun wajib diisi', 'error'); return; }
  const m = getMaster();
  const idx = document.getElementById('coa-edit-idx').value;
  const newList = [...m.coaList];
  if (idx === '') {
    if (newList.some(c => c.code === code)) { showToast('Kode COA sudah ada', 'error'); return; }
    newList.push({ code, name, category });
    newList.sort((a, b) => a.code - b.code);
  } else {
    newList[parseInt(idx)] = { code, name, category };
  }
  updateMaster({ coaList: newList });
  closeModal('modal-coa');
  renderConfigPage();
  showToast('COA berhasil disimpan', 'success');
});

// — Program —
function renderProgramTable(m) {
  document.getElementById('tbody-program').innerHTML = m.programs.map((p, i) => `<tr>
    <td><code>${esc(p.id)}</code></td>
    <td>${esc(p.name)}</td>
    <td><code>${esc(p.coaCode)}</code></td>
    <td><code>${esc(p.tailCode || '-')}</code></td>
    <td class="text-xs text-muted">${esc((p.keywords || []).slice(0, 3).join(', '))}</td>
    <td>
      <button class="btn-icon-sm" data-action="edit-prog" data-idx="${i}" title="Edit"><i class="fa-solid fa-pen"></i></button>
      <button class="btn-icon-sm text-danger" data-action="del-prog" data-idx="${i}" title="Hapus"><i class="fa-solid fa-trash"></i></button>
    </td>
  </tr>`).join('') || '<tr><td colspan="6" class="empty-state">Belum ada program.</td></tr>';
}

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
      const newList = m.programs.filter((_, i) => i !== idx);
      updateMaster({ programs: newList });
      renderConfigPage();
    }
  }
});

document.getElementById('btn-save-program').addEventListener('click', () => {
  const id = document.getElementById('program-id').value.trim();
  const name = document.getElementById('program-name').value.trim();
  if (!id || !name) { showToast('ID dan Nama Program wajib diisi', 'error'); return; }
  const coaCode = parseInt(document.getElementById('program-coa').value) || 0;
  const tailCode = document.getElementById('program-tail').value.trim();
  const keywords = document.getElementById('program-keywords').value.split(';').map(k => k.trim()).filter(Boolean);
  const description = document.getElementById('program-desc').value.trim();
  const m = getMaster();
  const idx = document.getElementById('program-edit-idx').value;
  const newList = [...m.programs];
  if (idx === '') {
    if (newList.some(p => p.id === id)) { showToast('ID Program sudah ada', 'error'); return; }
    newList.push({ id, name, coaCode, tailCode, keywords, description });
  } else {
    newList[parseInt(idx)] = { id, name, coaCode, tailCode, keywords, description };
  }
  updateMaster({ programs: newList });
  closeModal('modal-program');
  renderConfigPage();
  showToast('Program berhasil disimpan', 'success');
});

// — Donor —
function renderDonorTable(m) {
  document.getElementById('tbody-donor').innerHTML = m.donors.map((d, i) => {
    const prog = m.programs.find(p => p.id === d.defaultProgramId);
    return `<tr>
      <td>${esc(d.name)}</td>
      <td>${esc(d.phone || '-')}</td>
      <td class="text-xs">${esc(prog ? prog.name : 'Umum')}</td>
      <td>
        <button class="btn-icon-sm" data-action="edit-donor" data-idx="${i}" title="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="btn-icon-sm text-danger" data-action="del-donor" data-idx="${i}" title="Hapus"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" class="empty-state">Belum ada donatur tetap.</td></tr>';
}

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
      const newList = m.donors.filter((_, i) => i !== idx);
      updateMaster({ donors: newList });
      renderConfigPage();
    }
  }
});

document.getElementById('btn-save-donor').addEventListener('click', () => {
  const name = document.getElementById('donor-name').value.trim();
  if (!name) { showToast('Nama Donatur wajib diisi', 'error'); return; }
  const phone = document.getElementById('donor-phone').value.trim();
  const defaultProgramId = document.getElementById('donor-program').value;
  const m = getMaster();
  const idx = document.getElementById('donor-edit-idx').value;
  const newList = [...m.donors];
  const entry = { id: `donor-${Date.now()}`, name, phone, defaultProgramId, defaultCoa: getSystemCodes(m).umum };
  if (idx === '') {
    newList.push(entry);
  } else {
    newList[parseInt(idx)] = { ...newList[parseInt(idx)], name, phone, defaultProgramId };
  }
  updateMaster({ donors: newList });
  closeModal('modal-donor');
  renderConfigPage();
  showToast('Donatur berhasil disimpan', 'success');
});

// — Alias —
function renderAliasList(m) {
  const list = m.companyAliases || [];
  document.getElementById('alias-list').innerHTML = list.map((a, i) => `
    <div class="alias-item">
      <span>${esc(a)}</span>
      <button class="btn-icon-sm text-danger" data-action="del-alias" data-idx="${i}"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('') || '<div class="text-muted text-xs p-3">Belum ada alias.</div>';
}

document.getElementById('btn-add-alias').addEventListener('click', () => {
  const val = prompt('Masukkan alias/nama lembaga yang akan disaring dari label mutasi:');
  if (!val?.trim()) return;
  const m = getMaster();
  const aliases = [...(m.companyAliases || [])];
  if (aliases.includes(val.trim())) { showToast('Alias sudah ada', 'error'); return; }
  aliases.push(val.trim());
  updateMaster({ companyAliases: aliases });
  renderConfigPage();
});

document.getElementById('alias-list').addEventListener('click', e => {
  const btn = e.target.closest('[data-action="del-alias"]');
  if (!btn) return;
  const idx = parseInt(btn.dataset.idx);
  const m = getMaster();
  const aliases = (m.companyAliases || []).filter((_, i) => i !== idx);
  updateMaster({ companyAliases: aliases });
  renderConfigPage();
});

// — AI Settings —
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
  const aiModelName = document.getElementById('ai-model-name').value.trim();
  const aiApiKey = document.getElementById('ai-api-key').value.trim();
  const ollamaEndpoint = document.getElementById('ollama-endpoint').value.trim();
  const confidenceThreshold = parseFloat(document.getElementById('confidence-threshold').value);
  const orgName = document.getElementById('org-name').value.trim();
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
    showToast(`✅ Koneksi AI Berhasil! Provider: ${res.provider} (${res.model})`, 'success');
  } catch (err) {
    showToast(`❌ Uji Koneksi Gagal: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
});

// — System COA Settings —
function renderSystemCoaSettings(m) {
  const sys = getSystemCodes(m);
  ['unauth','umum','expense'].forEach(key => {
    const elId = `sys-coa-${key}`;
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = m.coaList.map(c => `<option value="${c.code}">${c.code} - ${esc(c.name)}</option>`).join('');
    el.value = sys[key];
  });
}

['sys-coa-unauth','sys-coa-umum','sys-coa-expense'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', () => {
    const unauth  = parseInt(document.getElementById('sys-coa-unauth').value);
    const umum    = parseInt(document.getElementById('sys-coa-umum').value);
    const expense = parseInt(document.getElementById('sys-coa-expense').value);
    updateMaster({ settings: { ...getMaster().settings, defaultUnauthorizedCoa: unauth, defaultBaselineCoa: umum, expenseCoa: expense } });
    renderConfigPage();
    showToast('Akun Default Sistem diperbarui', 'success');
  });
});

// — Backup / Restore —
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
    if (entity === 'coa') {
      data = [
        { 'NO AKUN': 40201001, 'NAMA AKUN': 'Penerimaan Infak Umum', 'KATEGORI': 'INFAK / SEDEKAH' },
        { 'NO AKUN': 40202101, 'NAMA AKUN': 'Penerimaan Infak Program Pendidikan', 'KATEGORI': 'INFAK / SEDEKAH' }
      ];
    } else if (entity === 'program') {
      data = [
        { 'ID': 'prog-001', 'NAMA PROGRAM': 'Sedekah Subuh', 'COA': 40202101, 'KODE EKOR': '101', 'KEYWORDS': 'sedekah;subuh', 'DESKRIPSI': 'Program rutin sedekah subuh' },
        { 'ID': 'prog-002', 'NAMA PROGRAM': 'Zakat Fitrah', 'COA': 40100101, 'KODE EKOR': '999', 'KEYWORDS': 'zakat;fitrah', 'DESKRIPSI': 'Zakat fitrah Ramadan' }
      ];
    } else if (entity === 'donor') {
      data = [
        { 'NAMA': 'Ahmad Hidayat', 'NO HP': '08123456789', 'PROGRAM DEFAULT': 'prog-001' },
        { 'NAMA': 'Siti Nurhaliza', 'NO HP': '08129876543', 'PROGRAM DEFAULT': '' }
      ];
    }
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, `template-${entity}.xlsx`);
    showToast(`Template ${entity.toUpperCase()} diunduh`, 'success');
  });
});

document.getElementById('input-import-json').addEventListener('change', async e => {
  if (!e.target.files.length) return;
  try {
    const text = await e.target.files[0].text();
    importConfigFromJson(text);
    renderConfigPage();
    showToast('Config JSON berhasil diimpor', 'success');
  } catch (err) {
    showToast('Gagal impor: ' + err.message, 'error');
  }
  e.target.value = '';
});

document.getElementById('btn-reset-defaults').addEventListener('click', () => {
  if (!confirm('Reset semua konfigurasi ke default? Perubahan akan hilang.')) return;
  resetToDefaults();
  renderConfigPage();
  showToast('Konfigurasi direset ke default', 'success');
});

// — Import xlsx/csv per entitas —
function handleMasterImport(file, entity) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = globalThis.XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = globalThis.XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!data.length) throw new Error('Berkas kosong atau tidak ada data tabel');
      const headers = Object.keys(data[0]).map(h => h.toLowerCase().trim());

      if (entity === 'coa') {
        const hasCode = headers.some(h => /no\s*akun|no_akun|kode\s*akun|coa/.test(h));
        const hasName = headers.some(h => /nama\s*akun|nama_akun/.test(h));
        if (!hasCode || !hasName) throw new Error('Kolom wajib tidak ditemukan. Butuh: NO AKUN, NAMA AKUN');
        const count = importMasterFromExcel(wb);
        showToast(`${count} COA berhasil diimpor`, 'success');
      } else if (entity === 'program') {
        const hasId = headers.some(h => /^id$|id\s*program|kode\s*program/.test(h));
        const hasName = headers.some(h => /nama\s*program|^program$|^nama$/.test(h));
        if (!hasId || !hasName) throw new Error('Kolom wajib tidak ditemukan. Butuh: ID, NAMA PROGRAM');
        importMasterFromExcel(wb);
        showToast('Program berhasil diimpor', 'success');
      } else if (entity === 'donor') {
        const hasName = headers.some(h => /^nama$|nama\s*donatur/.test(h));
        if (!hasName) throw new Error('Kolom wajib tidak ditemukan. Butuh: NAMA');
        const m = getMaster();
        const newDonors = data.map(row => {
          const name = row['NAMA'] || row['Nama'] || row['nama'] || '';
          const phone = row['NO HP'] || row['PHONE'] || row['phone'] || row['no hp'] || '';
          if (!String(name).trim()) return null;
          return { id: `donor-${Date.now()}-${Math.random()}`, name: String(name).trim(), phone: String(phone).trim(), defaultProgramId: '', defaultCoa: 40201001 };
        }).filter(Boolean);
        updateMaster({ donors: [...m.donors, ...newDonors] });
        showToast(`${newDonors.length} donatur diimpor`, 'success');
      }
      renderConfigPage();
    } catch (err) {
      showToast('Import gagal: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

document.getElementById('input-import-coa').addEventListener('change', e => {
  if (e.target.files[0]) handleMasterImport(e.target.files[0], 'coa');
  e.target.value = '';
});
document.getElementById('input-import-program').addEventListener('change', e => {
  if (e.target.files[0]) handleMasterImport(e.target.files[0], 'program');
  e.target.value = '';
});
document.getElementById('input-import-donor').addEventListener('change', e => {
  if (e.target.files[0]) handleMasterImport(e.target.files[0], 'donor');
  e.target.value = '';
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
  if (_periodFilter !== 'CUSTOM') renderDashboard();
});

document.getElementById('btn-apply-date').addEventListener('click', () => {
  _dateFrom = document.getElementById('date-from').value;
  _dateTo = document.getElementById('date-to').value;
  renderDashboard();
});

// ─── SEARCH DEBOUNCE ──────────────────────────────────────────────────────────

let _searchDebounce = null;
document.getElementById('report-search-input').addEventListener('input', e => {
  if (_searchDebounce) clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => {
    setFilter({ searchTerm: e.target.value });
    const { total } = getPagedRows();
    const countEl = document.getElementById('search-result-count');
    if (countEl) countEl.textContent = e.target.value ? ` (${total} hasil)` : '';
  }, 250);
});
document.getElementById('report-search-scope').addEventListener('change', e => {
  setFilter({ searchScope: e.target.value });
});
document.getElementById('report-category-select').addEventListener('change', e => {
  setFilter({ filterCategory: e.target.value });
});

function applyPeriodFilter(rows) {
  if (_periodFilter === 'ALL') return rows;
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  return rows.filter(r => {
    if (!r.transactionDate) return false;
    const d = new Date(r.transactionDate);
    if (_periodFilter === 'THIS_MONTH') return d.getFullYear() === y && d.getMonth() === m;
    if (_periodFilter === 'LAST_MONTH') {
      const lm = m === 0 ? 11 : m - 1, ly = m === 0 ? y - 1 : y;
      return d.getFullYear() === ly && d.getMonth() === lm;
    }
    if (_periodFilter === 'THIS_YEAR') return d.getFullYear() === y;
    if (_periodFilter === 'CUSTOM' && _dateFrom && _dateTo) {
      return r.transactionDate >= _dateFrom && r.transactionDate <= _dateTo;
    }
    return true;
  });
}

function renderDashboard() {
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

  const filtered = applyPeriodFilter(allRows);

  const inflow = filtered.filter(r => !r.isExpense && r.rawAmount > 0).reduce((s, r) => s + r.rawAmount, 0);
  const expense = filtered.filter(r => r.isExpense || r.rawAmount < 0).reduce((s, r) => s + Math.abs(r.rawAmount), 0);
  const net = inflow - expense;
  const classified = filtered.filter(r => r.matchedLayer !== 'UNAUTHORIZED_FALLBACK').length;
  const sys = getSystemCodes(getMaster());
  const unauthorized = filtered.filter(r => r.matchedLayer === 'UNAUTHORIZED_FALLBACK' || r.assignedCoa === sys.unauth).length;

  document.getElementById('stat-inflow').textContent = fmtRp(inflow);
  document.getElementById('stat-expense').textContent = fmtRp(expense);

  const netEl = document.getElementById('stat-net');
  netEl.textContent = fmtRp(net);
  netEl.className = 'stat-value' + (net >= 0 ? ' text-emerald' : ' text-rose');

  document.getElementById('stat-classified').textContent = classified.toLocaleString('id-ID');
  document.getElementById('stat-unauthorized').textContent = unauthorized.toLocaleString('id-ID');

  renderCharts(filtered);
  renderTable();
  updateFooterBar(filtered);
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
  if (_chartTop5) { _chartTop5.destroy(); _chartTop5 = null; }
  if (!top5.length) return;

  _chartTop5 = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: top5.map(p => p.name.length > 14 ? p.name.slice(0, 14) + '…' : p.name),
      datasets: [{ data: top5.map(p => p.total), backgroundColor: CHART_COLORS.slice(0, top5.length), borderRadius: 6, borderSkipped: false }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'x',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => fmtRp(ctx.raw) + '  (' + top5[ctx.dataIndex].count + ' trx)' } }
      },
      scales: {
        y: { ticks: { callback: v => 'Rp ' + (v >= 1e9 ? (v/1e9).toFixed(1)+'M' : v >= 1e6 ? (v/1e6).toFixed(0)+'jt' : v.toLocaleString('id-ID')), color: '#8b99b0', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        x: { ticks: { color: '#8b99b0', font: { size: 11 } }, grid: { display: false } }
      }
    }
  });
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
  if (_chartCat) { _chartCat.destroy(); _chartCat = null; }
  if (!items.length) return;

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

// ─── TABLE ────────────────────────────────────────────────────────────────────

let _selectedIds = new Set();
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

      if (isCompact) {
        return `<tr class="${_selectedIds.has(row.id) ? 'row-selected' : ''}">
          <td><input type="checkbox" class="row-checkbox" data-id="${esc(row.id)}" ${_selectedIds.has(row.id) ? 'checked' : ''}></td>
          <td class="text-xs text-muted">${rowNum}</td>
          <td class="text-xs nowrap">${esc(row.transactionDate || '-')}</td>
          <td class="nowrap fw-semibold ${row.isExpense || row.rawAmount < 0 ? 'text-rose' : 'text-emerald'}">${fmtRp(row.rawAmount)}</td>
          <td class="text-xs" data-tooltip="${esc(labelTooltip)}">
            <div class="truncate-1">
              <span class="fw-semibold">${esc(label)}</span>
              ${row.extractedSenderName ? `<span class="text-muted"> (${esc(row.extractedSenderName)})</span>` : ''}
            </div>
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
          </td>
          <td class="text-xs table-reasoning-cell" data-tooltip="${esc(reasonDisplay)}">
            <div class="truncate-1 ${isAi ? 'text-accent fw-semibold' : 'text-muted'}">${isAi ? '<i class="fa-solid fa-wand-magic-sparkles text-xs"></i> ' : ''}${esc(reasonDisplay)}</div>
          </td>
          <td class="nowrap">${statusBadge}</td>
          <td class="nowrap">${waBtn}</td>
        </tr>`;
      } else {
        return `<tr class="${_selectedIds.has(row.id) ? 'row-selected' : ''}">
          <td><input type="checkbox" class="row-checkbox" data-id="${esc(row.id)}" ${_selectedIds.has(row.id) ? 'checked' : ''}></td>
          <td class="text-xs text-muted">${rowNum}</td>
          <td class="text-xs nowrap">${esc(row.transactionDate || '-')}</td>
          <td class="nowrap fw-semibold ${row.isExpense || row.rawAmount < 0 ? 'text-rose' : 'text-emerald'}">${fmtRp(row.rawAmount)}</td>
          <td class="text-xs">
            <div class="fw-semibold truncate-1" data-tooltip="${esc(row.rawLabel || '')}">${esc(row.rawLabel || label)}</div>
            ${row.extractedSenderName ? `<div class="text-muted text-xs truncate-1" data-tooltip="${esc(row.extractedSenderName)}"><i class="fa-solid fa-user-tag"></i> ${esc(row.extractedSenderName)}</div>` : ''}
          </td>
          <td>
            <select class="coa-select" data-id="${esc(row.id)}">
              ${master.coaList.map(c => `<option value="${c.code}" ${c.code === row.assignedCoa ? 'selected' : ''}>${esc(c.code)} - ${esc(c.name)}</option>`).join('')}
            </select>
            ${prog ? `<div class="text-muted text-xs mt-1 truncate-1" data-tooltip="${esc(prog.name)}"><i class="fa-solid fa-hand-holding-heart"></i> ${esc(prog.name)}</div>` : ''}
          </td>
          <td class="text-xs">
            <div class="fw-semibold">${layerBadge}${row.confidence != null && isAi ? ` <span class="conf-badge">${(row.confidence * 100).toFixed(0)}%</span>` : ''}</div>
          </td>
          <td class="text-xs table-reasoning-cell">
            <div class="${isAi ? 'text-accent fw-semibold' : 'text-muted'} reasoning-full">${isAi ? '<i class="fa-solid fa-wand-magic-sparkles text-xs"></i> ' : ''}${esc(reasonDisplay)}</div>
          </td>
          <td class="nowrap">${statusBadge}</td>
          <td class="nowrap">${waBtn}</td>
        </tr>`;
      }
    }).join('');
  }

  renderPagination(page, totalPages, total, start, end);
  document.getElementById('reporting-top-pagination-info').textContent =
    total ? `Menampilkan ${start}–${end} dari ${total.toLocaleString('id-ID')} transaksi` : '';

  document.getElementById('report-select-all').checked = rows.length > 0 && rows.every(r => _selectedIds.has(r.id));

  document.querySelectorAll('.row-checkbox').forEach(cb => cb.addEventListener('change', onRowCheckbox));
  document.querySelectorAll('.coa-select').forEach(sel => sel.addEventListener('change', onCoaChange));
  document.querySelectorAll('[data-action="open-wa"]').forEach(btn => btn.addEventListener('click', onWaClick));

  applyTableMode();
  updateSelectionBanner();
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
  if (th) { setSort(th.dataset.sort); renderTable(); }
});

document.getElementById('report-select-all').addEventListener('change', e => {
  const { rows } = getPagedRows();
  rows.forEach(r => e.target.checked ? _selectedIds.add(r.id) : _selectedIds.delete(r.id));
  renderTable();
});

function onRowCheckbox(e) {
  const id = e.target.dataset.id;
  e.target.checked ? _selectedIds.add(id) : _selectedIds.delete(id);
  updateSelectionBanner();
  e.target.closest('tr').classList.toggle('row-selected', e.target.checked);
  const { rows } = getPagedRows();
  document.getElementById('report-select-all').checked = rows.length > 0 && rows.every(r => _selectedIds.has(r.id));
}

function onCoaChange(e) {
  const id = e.target.dataset.id;
  const newCoa = parseInt(e.target.value);
  const master = getMaster();
  const coaEntry = master.coaList.find(c => c.code === newCoa);
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
}

function updateSelectionBanner() {
  const banner = document.getElementById('selection-banner');
  const badge = document.getElementById('selected-count-badge');
  if (_selectedIds.size > 0) {
    banner.classList.remove('hidden');
    badge.textContent = `${_selectedIds.size} transaksi dicentang`;
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
    if (_undoSnapshot) { bulkUpdateRows(_undoSnapshot.ids, _undoSnapshot.patches.reduce((acc, p) => { acc[p.id] = p; return acc; }, {})); }
    if (_undoTimer) clearTimeout(_undoTimer);
    t.remove();
    renderDashboard();
    showToast('Aksi massal dibatalkan', 'info');
    _undoSnapshot = null;
  });
  _undoTimer = setTimeout(() => { t.classList.add('fadeout'); setTimeout(() => t.remove(), 300); _undoSnapshot = null; }, 8000);
}

document.getElementById('btn-bulk-general').addEventListener('click', () => {
  const master = getMaster();
  const sys = getSystemCodes(master);
  const coa = master.coaList.find(c => c.code === sys.umum);
  const ids = [..._selectedIds];
  _undoSnapshot = { ids, patches: getRows().filter(r => ids.includes(r.id)).map(r => ({ ...r })) };
  bulkUpdateRows(ids, { assignedCoa: sys.umum, newName: coa?.name || 'Infak Umum', assignedProgramId: null, matchedLayer: 'MANUAL_OVERRIDE', isOverridden: true, confidence: 1.0, reasoning: 'Bulk set Infak Umum', isExpense: false });
  _selectedIds.clear();
  renderDashboard();
  showUndoToast(`${ids.length} transaksi diset ke Infak Umum.`);
});

document.getElementById('btn-bulk-expense').addEventListener('click', () => {
  const master = getMaster();
  const sys = getSystemCodes(master);
  const coa = master.coaList.find(c => c.code === sys.expense);
  const ids = [..._selectedIds];
  _undoSnapshot = { ids, patches: getRows().filter(r => ids.includes(r.id)).map(r => ({ ...r })) };
  bulkUpdateRows(ids, { assignedCoa: sys.expense, newName: coa?.name || 'Beban Lain-Lain', assignedProgramId: null, matchedLayer: 'EXPENSE', isOverridden: true, confidence: 1.0, reasoning: 'Bulk set Beban', isExpense: true });
  _selectedIds.clear();
  renderDashboard();
  showUndoToast(`${ids.length} transaksi diset ke Beban.`);
});

document.getElementById('btn-bulk-clear').addEventListener('click', () => {
  _selectedIds.clear();
  renderTable();
  updateSelectionBanner();
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
    btn.addEventListener('click', () => { setPage(parseInt(btn.dataset.p)); renderTable(); });
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
  const rows = getRows();
  if (!rows.length) { showToast('Tidak ada data untuk diekspor', 'error'); return; }
  try {
    const bytes = exportOdooExcel(rows);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `jurnal-ziswaf-${new Date().toISOString().slice(0,10)}.xlsx`; a.click();
    URL.revokeObjectURL(url);
    showToast('Jurnal .xlsx diekspor', 'success');
  } catch (err) { showToast('Gagal ekspor: ' + err.message, 'error'); }
});

document.getElementById('btn-export-csv2').addEventListener('click', () => {
  const rows = getRows();
  if (!rows.length) { showToast('Tidak ada data untuk diekspor', 'error'); return; }
  try {
    const csv = exportOdooCsv(rows);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `jurnal-ziswaf-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    showToast('Jurnal .csv diekspor', 'success');
  } catch (err) { showToast('Gagal ekspor: ' + err.message, 'error'); }
});

// ─── Subscribe session store ──────────────────────────────────────────────────

import { subscribe as subscribeSession } from "./store/session_store.js";
subscribeSession(() => {
  if (!document.getElementById('page-dashboard').classList.contains('hidden')) {
    renderDashboard();
  }
});

// ─── INIT ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  setupDropzone();
  navigateTo('config');
});
