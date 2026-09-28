import { DEFAULT_MASTER_DATA } from "../config/default_presets.js";
import { sanitizeInputText, sanitizeSlug, sanitizePhone, sanitizeCoaCode } from "../engine/sanitizer.js";

const STORAGE_KEY = "ziswaf_demo_master_v1";
const BACKUP_STORAGE_KEY = "ziswaf_last_config_backup_v1";
export const CURRENT_SCHEMA_VERSION = 2;

const storage = (() => {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage?.getItem === "function" && typeof localStorage?.setItem === "function") return localStorage;
  } catch (e) {}
  return null;
})();

const memoryStorage = {
  data: {},
  getItem(key) {
    return this.data[key] ?? null;
  },
  setItem(key, value) {
    this.data[key] = value;
  },
  removeItem(key) {
    delete this.data[key];
  }
};

let storageAccessor = storage || memoryStorage;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

function cleanStringList(value, max = 50) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[;,]/);
  return [...new Set(values.map(item => sanitizeInputText(item, max)).filter(Boolean))];
}

function normalizeCoa(entry) {
  return {
    ...entry,
    code: sanitizeCoaCode(entry?.code),
    name: sanitizeInputText(entry?.name, 120),
    category: sanitizeInputText(entry?.category, 50) || 'UMUM'
  };
}

function normalizeProgram(entry) {
  return {
    ...entry,
    id: sanitizeSlug(entry?.id, 50),
    name: sanitizeInputText(entry?.name, 120),
    coaCode: sanitizeCoaCode(entry?.coaCode),
    tailCode: sanitizeInputText(entry?.tailCode, 10),
    parentCoaCode: sanitizeCoaCode(entry?.parentCoaCode) || null,
    keywords: cleanStringList(entry?.keywords),
    hiddenKeywords: cleanStringList(entry?.hiddenKeywords),
    description: sanitizeInputText(entry?.description, 500),
    ...(entry?.priority !== undefined ? { priority: Number(entry.priority) || 0 } : {})
  };
}

function normalizeDonor(entry, fallbackCoa) {
  return {
    ...entry,
    id: sanitizeSlug(entry?.id, 80) || `donor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: sanitizeInputText(entry?.name, 100),
    phone: sanitizePhone(entry?.phone, 25),
    defaultProgramId: sanitizeSlug(entry?.defaultProgramId, 50),
    defaultCoa: sanitizeCoaCode(entry?.defaultCoa) || fallbackCoa
  };
}

function normalizeSettings(value = {}) {
  const defaults = DEFAULT_MASTER_DATA.settings;
  const merged = { ...defaults, ...value };
  const legacyModes = { GOOGLE_GEMINI: 'GEMINI', OLLAMA: 'LOCAL_OLLAMA', DISABLED: 'OFF' };
  const requestedMode = legacyModes[String(merged.aiMode || '').toUpperCase()] || String(merged.aiMode || '').toUpperCase();
  const aiMode = ['OFF', 'GEMINI', 'OPENAI', 'LOCAL_OLLAMA'].includes(requestedMode) ? requestedMode : 'OFF';
  const threshold = Number(merged.confidenceThreshold);
  return {
    ...merged,
    defaultUnauthorizedCoa: sanitizeCoaCode(merged.defaultUnauthorizedCoa) || defaults.defaultUnauthorizedCoa,
    defaultBaselineCoa: sanitizeCoaCode(merged.defaultBaselineCoa) || defaults.defaultBaselineCoa,
    expenseCoa: sanitizeCoaCode(merged.expenseCoa) || defaults.expenseCoa,
    aiMode,
    aiModelName: sanitizeInputText(merged.aiModelName, 80),
    confidenceThreshold: Math.min(1, Math.max(0.80, Number.isFinite(threshold) ? threshold : defaults.confidenceThreshold)),
    aiApiKey: typeof merged.aiApiKey === 'string' ? merged.aiApiKey : ''
  };
}

function ensureSystemCoas(master) {
  const settings = master.settings;
  const required = [
    [settings.defaultUnauthorizedCoa, settings.defaultUnauthorizedName || 'Penerimaan Infak & Sedekah - Perlu Ditinjau', 'INFAK / SEDEKAH'],
    [settings.defaultBaselineCoa, settings.defaultBaselineName || 'Penerimaan Infak & Sedekah - Umum', 'INFAK / SEDEKAH'],
    [settings.expenseCoa, settings.expenseName || 'Beban Lain-Lain (Pengeluaran Bank)', 'BEBAN']
  ];
  for (const [code, name, category] of required) {
    if (!master.coaList.some(coa => coa.code === code)) master.coaList.push({ code, name, category });
  }
  master.coaList.sort((a, b) => a.code - b.code);
}

export function validateMasterData(candidate) {
  const errors = [];
  const coaCodes = new Set();
  for (const coa of candidate.coaList || []) {
    if (!coa.code || !coa.name) errors.push('Setiap COA wajib memiliki kode dan nama.');
    if (coaCodes.has(coa.code)) errors.push(`Kode COA ${coa.code} duplikat.`);
    coaCodes.add(coa.code);
  }
  const programIds = new Set();
  const tailCodes = new Set();
  for (const program of candidate.programs || []) {
    if (!program.id || !program.name) errors.push('Setiap program wajib memiliki ID dan nama.');
    if (programIds.has(program.id)) errors.push(`ID Program '${program.id}' duplikat.`);
    programIds.add(program.id);
    if (program.tailCode) {
      if (tailCodes.has(program.tailCode)) errors.push(`Kode ekor '${program.tailCode}' dipakai lebih dari satu program.`);
      tailCodes.add(program.tailCode);
    }
    if (!coaCodes.has(program.coaCode)) errors.push(`Program '${program.id}' merujuk COA ${program.coaCode || '(kosong)'} yang tidak ada.`);
    if (program.parentCoaCode && !coaCodes.has(program.parentCoaCode)) errors.push(`Induk COA program '${program.id}' tidak ada.`);
  }
  const donorIds = new Set();
  for (const donor of candidate.donors || []) {
    if (!donor.id || !donor.name) errors.push('Setiap donatur wajib memiliki ID dan nama.');
    if (donorIds.has(donor.id)) errors.push(`ID Donatur '${donor.id}' duplikat.`);
    donorIds.add(donor.id);
    if (donor.defaultProgramId && !programIds.has(donor.defaultProgramId)) errors.push(`Donatur '${donor.name}' merujuk program yang tidak ada.`);
    if (!coaCodes.has(donor.defaultCoa)) errors.push(`Donatur '${donor.name}' merujuk COA ${donor.defaultCoa} yang tidak ada.`);
  }
  const settings = candidate.settings || {};
  for (const [label, code] of [['karantina', settings.defaultUnauthorizedCoa], ['baseline', settings.defaultBaselineCoa], ['beban', settings.expenseCoa]]) {
    if (!coaCodes.has(code)) errors.push(`Akun sistem ${label} (${code}) tidak ada di master COA.`);
  }
  if (errors.length) throw new Error(errors.slice(0, 8).join('\n'));
  return true;
}

function normalizeMaster(candidate, { repair = false } = {}) {
  const normalized = {
    ...deepClone(candidate || {}),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    coaList: (candidate?.coaList || []).map(normalizeCoa).filter(coa => coa.code && coa.name),
    programs: (candidate?.programs || []).map(normalizeProgram).filter(program => program.id && program.name),
    donors: [],
    companyAliases: cleanStringList(candidate?.companyAliases, 100),
    settings: normalizeSettings(candidate?.settings)
  };
  ensureSystemCoas(normalized);
  const fallbackCoa = normalized.settings.defaultBaselineCoa;
  normalized.donors = (candidate?.donors || []).map(donor => normalizeDonor(donor, fallbackCoa)).filter(donor => donor.name);
  if (repair) {
    const coaMap = new Map();
    normalized.coaList.forEach(coa => coaMap.set(coa.code, coa));
    normalized.coaList = Array.from(coaMap.values()).sort((a, b) => a.code - b.code);

    const programIds = new Set();
    const tailCodes = new Set();
    normalized.programs = normalized.programs.map((program, index) => {
      let id = program.id;
      let suffix = 2;
      while (programIds.has(id)) id = `${program.id}-${suffix++}`;
      programIds.add(id);
      const tailCode = program.tailCode && !tailCodes.has(program.tailCode) ? program.tailCode : '';
      if (tailCode) tailCodes.add(tailCode);
      return { ...program, id: id || `program-migrasi-${index + 1}`, tailCode };
    });

    const donorIds = new Set();
    normalized.donors = normalized.donors.map((donor, index) => {
      let id = donor.id;
      let suffix = 2;
      while (donorIds.has(id)) id = `${donor.id}-${suffix++}`;
      donorIds.add(id);
      return { ...donor, id: id || `donor-migrasi-${index + 1}` };
    });
  }
  const coaCodes = new Set(normalized.coaList.map(coa => coa.code));
  if (repair) {
    const programIds = new Set(normalized.programs.map(program => program.id));
    normalized.programs = normalized.programs.map(program => ({
      ...program,
      coaCode: coaCodes.has(program.coaCode) ? program.coaCode : fallbackCoa,
      parentCoaCode: coaCodes.has(program.parentCoaCode) ? program.parentCoaCode : null
    }));
    normalized.donors = normalized.donors.map(donor => ({
      ...donor,
      defaultProgramId: programIds.has(donor.defaultProgramId) ? donor.defaultProgramId : '',
      defaultCoa: coaCodes.has(donor.defaultCoa) ? donor.defaultCoa : fallbackCoa
    }));
  }
  validateMasterData(normalized);
  return normalized;
}

function commitMaster(candidate, options) {
  const nextState = normalizeMaster(candidate, options);
  persist(nextState);
  state = nextState;
  notify();
  return deepClone(state);
}

export function migrateMasterData(candidate) {
  return normalizeMaster(candidate, { repair: true });
}

let state = deepClone(DEFAULT_MASTER_DATA);
const subscribers = new Set();

function persist(value = state) {
  try {
    storageAccessor.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch (error) {
    throw new Error(`Konfigurasi tidak dapat disimpan di browser: ${error?.message || 'penyimpanan tidak tersedia'}`);
  }
}

function notify() {
  const clonedState = deepClone(state);
  subscribers.forEach(cb => {
    try {
      cb(clonedState);
    } catch (e) {}
  });
}

function init() {
  try {
    const stored = storageAccessor.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.coaList && parsed.programs) {
        const migrationInput = deepClone(parsed);
        if (Array.isArray(migrationInput.programs)) {
          migrationInput.programs = migrationInput.programs.filter(p => !String(p.id).startsWith("BASELINE_"));
        }
        state = migrateMasterData(migrationInput);
        persist();
      }
    }
  } catch (e) {
    state = normalizeMaster(DEFAULT_MASTER_DATA);
    try {
      persist();
    } catch {
      storageAccessor = memoryStorage;
      persist();
    }
  }
}

init();

export const SPECIAL_ACCOUNTS = [
  { code: 40201000, name: "Penerimaan Infak & Sedekah Tanpa Pembatasan - Unauthorized", category: "UMUM" },
  { code: 40201001, name: "Penerimaan Infak & Sedekah Tanpa Pembatasan - Umum", category: "UMUM" },
  { code: 60100008, name: "Beban Lain-Lain (Pengeluaran Bank)", category: "UMUM" },
  { code: 40100000, name: "Penerimaan Zakat Tanpa Pembatasan - Baseline", category: "UMUM" }
];

export function getSystemCodes(m) {
  const current = m || state;
  const settings = current?.settings || {};
  const unauthCode = settings.defaultUnauthorizedCoa || 40201000;
  const umumCode = settings.defaultBaselineCoa || 40201001;
  const expenseCode = settings.expenseCoa || 60100008;

  const coaList = current?.coaList || [];
  const unauthEntry = coaList.find(c => c.code === unauthCode);
  const umumEntry = coaList.find(c => c.code === umumCode);
  const expenseEntry = coaList.find(c => c.code === expenseCode);

  return {
    unauth: unauthCode,
    unauthName: settings.defaultUnauthorizedName || unauthEntry?.name || "Penerimaan Infak & Sedekah - Unauthorized",
    umum: umumCode,
    umumName: settings.defaultBaselineName || umumEntry?.name || "Penerimaan Infak & Sedekah - Umum",
    expense: expenseCode,
    expenseName: settings.expenseName || expenseEntry?.name || "Beban Lain-Lain (Pengeluaran Bank)"
  };
}

export function updateSystemAccounts({ unauthCode, unauthName, umumCode, umumName, expenseCode, expenseName }) {
  const uCode = sanitizeCoaCode(unauthCode);
  const bCode = sanitizeCoaCode(umumCode);
  const eCode = sanitizeCoaCode(expenseCode);

  if (!uCode || !bCode || !eCode) {
    throw new Error("Nomor akun untuk Karantina, Baseline, dan Beban harus berupa angka valid.");
  }
  if (uCode === bCode || uCode === eCode || bCode === eCode) {
    throw new Error("Nomor akun Karantina, Baseline, dan Beban tidak boleh sama satu sama lain.");
  }

  const uName = sanitizeInputText(unauthName, 120) || "Penerimaan Infak & Sedekah - Unauthorized";
  const bName = sanitizeInputText(umumName, 120) || "Penerimaan Infak & Sedekah - Umum";
  const eName = sanitizeInputText(expenseName, 120) || "Beban Lain-Lain (Pengeluaran Bank)";

  const next = deepClone(state);
  const prevSys = getSystemCodes(next);
  const replacements = new Map([
    [prevSys.unauth, uCode],
    [prevSys.umum, bCode],
    [prevSys.expense, eCode]
  ]);

  next.settings = {
    ...next.settings,
    defaultUnauthorizedCoa: uCode,
    defaultUnauthorizedName: uName,
    defaultBaselineCoa: bCode,
    defaultBaselineName: bName,
    expenseCoa: eCode,
    expenseName: eName
  };

  // Sync to state.coaList
  const coaMap = new Map(next.coaList.map(c => [c.code, { ...c }]));

  next.programs = next.programs.map(program => ({
    ...program,
    coaCode: replacements.get(program.coaCode) || program.coaCode,
    parentCoaCode: replacements.get(program.parentCoaCode) || program.parentCoaCode
  }));
  next.donors = next.donors.map(donor => ({
    ...donor,
    defaultCoa: replacements.get(donor.defaultCoa) || donor.defaultCoa
  }));

  coaMap.set(uCode, {
    code: uCode,
    name: uName,
    category: coaMap.get(uCode)?.category || "UMUM"
  });

  coaMap.set(bCode, {
    code: bCode,
    name: bName,
    category: coaMap.get(bCode)?.category || "UMUM"
  });

  coaMap.set(eCode, {
    code: eCode,
    name: eName,
    category: coaMap.get(eCode)?.category || "BEBAN"
  });

  next.coaList = Array.from(coaMap.values()).sort((a, b) => a.code - b.code);

  for (const oldCode of [prevSys.unauth, prevSys.umum, prevSys.expense]) {
    if (oldCode && oldCode !== uCode && oldCode !== bCode && oldCode !== eCode) {
      const stillReferenced = next.programs.some(p => p.coaCode === oldCode || p.parentCoaCode === oldCode)
        || next.donors.some(d => d.defaultCoa === oldCode);
      if (!stillReferenced && [40201000, 40201001, 60100008].includes(oldCode)) {
        next.coaList = next.coaList.filter(coa => coa.code !== oldCode);
      }
    }
  }

  const committed = commitMaster(next);
  return getSystemCodes(committed);
}

function findColumn(headers, aliases, excludedCols = []) {
  if (!headers || !headers.length) return null;
  const excludedSet = new Set(excludedCols.filter(Boolean).map(c => String(c).toLowerCase().trim()));
  const available = headers.filter(h => !excludedSet.has(String(h).toLowerCase().trim()));

  // Pass 1: exact match
  for (const alias of aliases) {
    const aClean = alias.toLowerCase().replace(/[\s_.-]+/g, " ").trim();
    for (const header of available) {
      const hClean = String(header).toLowerCase().replace(/[\s_.-]+/g, " ").trim();
      if (hClean === aClean) return header;
    }
  }

  // Pass 2: prefix or whole-word match
  for (const alias of aliases) {
    const aClean = alias.toLowerCase().replace(/[\s_.-]+/g, " ").trim();
    for (const header of available) {
      const hClean = String(header).toLowerCase().replace(/[\s_.-]+/g, " ").trim();
      // If we are looking for a name/text column, do not match headers that signify code/number
      if (["nama", "nama akun", "nama program", "nama donatur", "uraian", "keterangan", "deskripsi", "akun", "program", "donatur"].includes(aClean)) {
        if (/^(no|nomor|kode|id|kd)\b|[\s_.-](no|nomor|kode|id|kd)\b/i.test(hClean)) {
          continue;
        }
      }
      if (hClean.startsWith(aClean) || hClean.endsWith(aClean) || hClean.includes(aClean)) {
        return header;
      }
    }
  }
  return null;
}

function findCOASheet(workbook) {
  if (!workbook.SheetNames || !workbook.Sheets) return null;
  // 1. Check Sheet Name
  for (const sheetName of workbook.SheetNames) {
    if (/coa|chart|akun|rekening|perkiraan/i.test(sheetName.trim())) {
      return workbook.Sheets[sheetName];
    }
  }
  // 2. Check Sheet Headers
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    const data = globalThis.XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (data.length > 0) {
      const headers = Object.keys(data[0]);
      const hasCode = headers.some(h => /no\s*akun|kode\s*akun|no\s*rek|kode\s*rek|no\s*perkiraan|kode\s*perkiraan|^coa$|^kode$|^no$/i.test(h));
      const hasName = headers.some(h => /nama\s*akun|nama\s*rek|nama\s*perkiraan|^nama$|uraian|keterangan/i.test(h));
      const hasIdProg = headers.some(h => /^id$|id\s*program|kode\s*program/i.test(h));
      const hasPhone = headers.some(h => /no\s*hp|phone|telepon|handphone/i.test(h));
      if (hasCode && hasName && !hasIdProg && !hasPhone) return ws;
    }
  }
  return null;
}

function findProgramSheet(workbook) {
  if (!workbook.SheetNames || !workbook.Sheets) return null;
  // 1. Check Sheet Name
  for (const sheetName of workbook.SheetNames) {
    if (/program|campaign|kegiatan/i.test(sheetName.trim())) {
      return workbook.Sheets[sheetName];
    }
  }
  // 2. Check Sheet Headers
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    const data = globalThis.XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (data.length > 0) {
      const headers = Object.keys(data[0]);
      const hasId = headers.some(h => /^id$|id\s*program|kode\s*program/i.test(h));
      const hasName = headers.some(h => /nama\s*program|^program$|^nama$/i.test(h));
      if (hasId && hasName) return ws;
    }
  }
  return null;
}

function findDonorSheet(workbook) {
  if (!workbook.SheetNames || !workbook.Sheets) return null;
  // 1. Check Sheet Name
  for (const sheetName of workbook.SheetNames) {
    if (/donatur|donor|muzakki|munfiq/i.test(sheetName.trim())) {
      return workbook.Sheets[sheetName];
    }
  }
  // 2. Check Sheet Headers
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    const data = globalThis.XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (data.length > 0) {
      const headers = Object.keys(data[0]);
      const hasDonorTitle = headers.some(h => /nama\s*donatur|^donatur$|muzakki/i.test(h));
      const hasPhone = headers.some(h => /no\s*hp|phone|telepon|hp/i.test(h));
      const isCoa = headers.some(h => /no\s*akun|kode\s*akun|no\s*rek|kode\s*rek|coa/i.test(h));
      const isProg = headers.some(h => /^id$|id\s*program|kode\s*program/i.test(h));
      if ((hasDonorTitle || hasPhone) && !isCoa && !isProg) return ws;
    }
  }
  return null;
}

export function getMaster() {
  return deepClone(state);
}

export function isMasterStoragePersistent() {
  return Boolean(storage) && storageAccessor === storage;
}

export function updateMaster(patch) {
  return commitMaster(deepMerge(state, patch));
}

export function resetToDefaults() {
  return commitMaster(DEFAULT_MASTER_DATA);
}

export function subscribe(callback) {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

/**
 * Unified Excel/CSV Master Importer:
 * Supports importing COA, Program, Donatur from single-sheet or multi-sheet workbooks.
 * @param {Object} workbook - SheetJS workbook object
 * @param {'merge'|'replace'} mode - 'merge' (append & update) or 'replace' (wipe old data & load new)
 * @param {'coa'|'program'|'donor'|null} targetEntity - Explicit target entity if imported from specific tab
 */
function importMasterFromExcelDraft(workbook, mode = 'merge', targetEntity = null) {
  if (!workbook || !workbook.SheetNames || !workbook.SheetNames.length) {
    throw new Error('Berkas Excel/CSV tidak memuat lembar kerja yang dapat dibaca.');
  }

  let coaSheet = null;
  let programSheet = null;
  let donorSheet = null;

  if (targetEntity === 'coa') {
    coaSheet = findCOASheet(workbook) || workbook.Sheets[workbook.SheetNames[0]];
  } else if (targetEntity === 'program') {
    programSheet = findProgramSheet(workbook) || workbook.Sheets[workbook.SheetNames[0]];
  } else if (targetEntity === 'donor') {
    donorSheet = findDonorSheet(workbook) || workbook.Sheets[workbook.SheetNames[0]];
  } else {
    coaSheet = findCOASheet(workbook);
    programSheet = findProgramSheet(workbook);
    donorSheet = findDonorSheet(workbook);

    // Fallback: If no sheet identified by strict rules and there is only 1 sheet, analyze headers
    if (!coaSheet && !programSheet && !donorSheet && workbook.SheetNames.length === 1) {
      const singleWs = workbook.Sheets[workbook.SheetNames[0]];
      const data = globalThis.XLSX.utils.sheet_to_json(singleWs, { defval: "" });
      if (data.length > 0) {
        const headers = Object.keys(data[0]);
        if (headers.some(h => /no\s*akun|kode\s*akun|no\s*rek|kode\s*rek|^coa$|^kode$|^no$/i.test(h))) {
          coaSheet = singleWs;
        } else if (headers.some(h => /^id$|id\s*program|kode\s*program|program/i.test(h))) {
          programSheet = singleWs;
        } else if (headers.some(h => /donatur|phone|no\s*hp/i.test(h))) {
          donorSheet = singleWs;
        }
      }
    }
  }

  if (!coaSheet && !programSheet && !donorSheet) {
    throw new Error(
      'Format tabel tidak dikenali. Kolom wajib yang didukung:\n' +
      '• COA: NO AKUN, NAMA AKUN\n' +
      '• Program: ID, NAMA PROGRAM\n' +
      '• Donatur: NAMA, NO HP'
    );
  }

  let coaCount = 0;
  let programCount = 0;
  let donorCount = 0;
  const errorLogs = [];

  // 1. Process COA Sheet
  if (coaSheet) {
    const coaData = globalThis.XLSX.utils.sheet_to_json(coaSheet, { defval: "" });
    const headers = coaData.length > 0 ? Object.keys(coaData[0]) : [];
    const codeCol = findColumn(headers, ["no akun", "no_akun", "kode akun", "kode_akun", "no rekening", "kode rekening", "no perkiraan", "kode perkiraan", "coa", "kode", "nomor", "no"]);
    const nameCol = findColumn(headers, ["nama akun", "nama_akun", "nama rekening", "nama perkiraan", "nama coa", "uraian", "keterangan", "deskripsi", "nama"], [codeCol]);
    const categoryCol = findColumn(headers, ["kategori", "category", "tipe", "type", "jenis"], [codeCol, nameCol]);

    const parsedCoa = [];
    coaData.forEach((row, rowIdx) => {
      const rawCode = codeCol ? row[codeCol] : row["NO AKUN"] || row["COA"] || row["KODE AKUN"];
      const rawName = nameCol ? row[nameCol] : row["NAMA AKUN"] || row["AKUN"] || row["NAMA"];
      const rawCategory = categoryCol ? row[categoryCol] : row["KATEGORI"] || row["CATEGORY"];

      const codeNum = sanitizeCoaCode(rawCode);
      const nameStr = sanitizeInputText(rawName, 120);
      const catStr = sanitizeInputText(rawCategory, 50) || "UMUM";

      if (codeNum && nameStr) {
        parsedCoa.push({ code: codeNum, name: nameStr, category: catStr });
      } else if (rawCode || rawName) {
        errorLogs.push(`COA Baris ${rowIdx + 2}: Kode (${rawCode}) atau Nama (${rawName}) tidak valid.`);
      }
    });

    if (parsedCoa.length > 0) {
      const sys = getSystemCodes(state);
      const systemCoas = [
        { code: sys.unauth, name: sys.unauthName, category: "UMUM" },
        { code: sys.umum, name: sys.umumName, category: "UMUM" },
        { code: sys.expense, name: sys.expenseName, category: "BEBAN" }
      ];

      if (mode === 'replace') {
        const newCoaList = [...parsedCoa];
        systemCoas.forEach(sysAccount => {
          const matchIdx = newCoaList.findIndex(c => c.code === sysAccount.code);
          if (matchIdx >= 0) {
            // Update name of system account from imported data if matched
            state.settings = {
              ...state.settings,
              ...(sysAccount.code === sys.unauth ? { defaultUnauthorizedName: newCoaList[matchIdx].name } : {}),
              ...(sysAccount.code === sys.umum ? { defaultBaselineName: newCoaList[matchIdx].name } : {}),
              ...(sysAccount.code === sys.expense ? { expenseName: newCoaList[matchIdx].name } : {})
            };
          } else {
            // Preserve configured system account
            newCoaList.push({ ...sysAccount });
          }
        });
        newCoaList.sort((a, b) => a.code - b.code);
        state.coaList = newCoaList;
        coaCount = parsedCoa.length;
      } else {
        // Merge mode
        const existingMap = new Map(state.coaList.map(c => [c.code, c]));
        parsedCoa.forEach(c => existingMap.set(c.code, c));
        systemCoas.forEach(sysAccount => {
          if (!existingMap.has(sysAccount.code)) {
            existingMap.set(sysAccount.code, { ...sysAccount });
          }
        });
        state.coaList = Array.from(existingMap.values()).sort((a, b) => a.code - b.code);
        coaCount = parsedCoa.length;
      }
    }
  }

  // 2. Process Program Sheet
  if (programSheet) {
    const programData = globalThis.XLSX.utils.sheet_to_json(programSheet, { defval: "" });
    const progHeaders = programData.length > 0 ? Object.keys(programData[0]) : [];
    const idCol = findColumn(progHeaders, ["id", "id program", "kode program", "id_program", "kode"]);
    const nameColProg = findColumn(progHeaders, ["nama program", "nama_program", "program", "nama"], [idCol]);
    const coaColProg = findColumn(progHeaders, ["no akun", "coa", "kode akun", "no_akun", "kode_akun"], [idCol, nameColProg]);
    const tailColProg = findColumn(progHeaders, ["kode ekor", "ekor", "kode_ekor", "tail"], [idCol, nameColProg, coaColProg]);
    const keywordsColProg = findColumn(progHeaders, ["keywords", "kata kunci", "kata_kunci"], [idCol, nameColProg, coaColProg, tailColProg]);
    const descColProg = findColumn(progHeaders, ["deskripsi", "description", "keterangan"], [idCol, nameColProg, coaColProg, tailColProg, keywordsColProg]);

    const parsedPrograms = [];
    programData.forEach((row, rowIdx) => {
      const rawId = idCol ? row[idCol] : row["ID"] || row["ID PROGRAM"] || row["KODE PROGRAM"];
      const rawName = nameColProg ? row[nameColProg] : row["NAMA PROGRAM"] || row["PROGRAM"] || row["NAMA"];
      const rawCoa = coaColProg ? row[coaColProg] : row["NO AKUN"] || row["COA"] || row["KODE AKUN"];
      const rawTail = tailColProg ? row[tailColProg] : row["KODE EKOR"] || row["EKOR"];
      const rawKeywords = keywordsColProg ? row[keywordsColProg] : row["KEYWORDS"] || row["KATA KUNCI"];
      const rawDesc = descColProg ? row[descColProg] : row["DESKRIPSI"] || row["KETERANGAN"];

      const idStr = sanitizeSlug(rawId, 50);
      const nameStr = sanitizeInputText(rawName, 120);
      const coaNum = sanitizeCoaCode(rawCoa) || 0;
      const tailStr = sanitizeInputText(rawTail, 10);
      const descStr = sanitizeInputText(rawDesc, 500);

      let keywordsArr = [];
      if (Array.isArray(rawKeywords)) {
        keywordsArr = rawKeywords.map(k => sanitizeInputText(k, 50)).filter(Boolean);
      } else if (rawKeywords) {
        keywordsArr = String(rawKeywords).split(/[;,]/).map(k => sanitizeInputText(k, 50)).filter(Boolean);
      }

      if (idStr && nameStr) {
        parsedPrograms.push({
          id: idStr,
          name: nameStr,
          coaCode: coaNum,
          tailCode: tailStr,
          keywords: keywordsArr,
          hiddenKeywords: [],
          parentCoaCode: sanitizeCoaCode(row["PARENT COA"]) || sanitizeCoaCode(row["PARENT_COA"]) || sanitizeCoaCode(row["INDUK"]) || null,
          description: descStr
        });
      } else if (rawId || rawName) {
        errorLogs.push(`Program Baris ${rowIdx + 2}: ID (${rawId}) atau Nama (${rawName}) tidak valid.`);
      }
    });

    if (parsedPrograms.length > 0) {
      if (mode === 'replace') {
        state.programs = [...parsedPrograms];
        programCount = parsedPrograms.length;
      } else {
        // Merge mode
        const existingMap = new Map(state.programs.map(p => [p.id, p]));
        parsedPrograms.forEach(p => existingMap.set(p.id, p));
        state.programs = Array.from(existingMap.values());
        programCount = parsedPrograms.length;
      }
    }
  }

  // 3. Process Donor Sheet
  if (donorSheet) {
    const donorData = globalThis.XLSX.utils.sheet_to_json(donorSheet, { defval: "" });
    const headers = donorData.length > 0 ? Object.keys(donorData[0]) : [];
    const nameCol = findColumn(headers, ["nama donatur", "nama_donatur", "donatur", "nama lengkap", "nama"]);
    const phoneCol = findColumn(headers, ["no hp", "no_hp", "phone", "telepon", "handphone", "hp", "no telepon"], [nameCol]);
    const progCol = findColumn(headers, ["program default", "program_default", "program", "id program"], [nameCol, phoneCol]);

    const parsedDonors = [];
    const defaultCoa = getSystemCodes(state).umum;

    donorData.forEach((row, rowIdx) => {
      const rawName = nameCol ? row[nameCol] : row["NAMA"] || row["DONATUR"];
      const rawPhone = phoneCol ? row[phoneCol] : row["NO HP"] || row["PHONE"];
      const rawProg = progCol ? row[progCol] : row["PROGRAM DEFAULT"] || row["PROGRAM"];

      const nameStr = sanitizeInputText(rawName, 100);
      const phoneStr = sanitizePhone(rawPhone, 25);
      const progStr = sanitizeSlug(rawProg, 50);

      if (nameStr) {
        parsedDonors.push({
          id: `donor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: nameStr,
          phone: phoneStr,
          defaultProgramId: progStr,
          defaultCoa
        });
      } else if (rawName || rawPhone) {
        errorLogs.push(`Donatur Baris ${rowIdx + 2}: Nama tidak valid.`);
      }
    });

    if (parsedDonors.length > 0) {
      if (mode === 'replace') {
        state.donors = parsedDonors;
        donorCount = parsedDonors.length;
      } else {
        // Merge mode: match by phone or name
        const existing = [...state.donors];
        parsedDonors.forEach(newD => {
          const matchIdx = existing.findIndex(d => (newD.phone && d.phone === newD.phone) || d.name.toLowerCase() === newD.name.toLowerCase());
          if (matchIdx >= 0) {
            existing[matchIdx] = { ...existing[matchIdx], ...newD, id: existing[matchIdx].id };
          } else {
            existing.push(newD);
          }
        });
        state.donors = existing;
        donorCount = parsedDonors.length;
      }
    }
  }

  const totalImported = coaCount + programCount + donorCount;
  if (totalImported === 0) {
    const errorDetails = errorLogs.length ? `\nDetail: ${errorLogs.slice(0, 3).join(', ')}` : '';
    throw new Error('Tidak ada baris data valid yang berhasil diimpor.' + errorDetails);
  }

  const summary = [];
  if (coaCount) summary.push(`${coaCount} COA`);
  if (programCount) summary.push(`${programCount} Program`);
  if (donorCount) summary.push(`${donorCount} Donatur`);

  return {
    success: true,
    coaCount,
    programCount,
    donorCount,
    totalImported,
    message: `${summary.join(', ')} berhasil ${mode === 'replace' ? 'ditimpa' : 'ditambahkan'}.`,
    errors: errorLogs
  };
}

export function importMasterFromExcel(workbook, mode = 'merge', targetEntity = null) {
  const original = deepClone(state);
  try {
    const result = importMasterFromExcelDraft(workbook, mode, targetEntity);
    commitMaster(state, { repair: mode === 'replace' });
    return result;
  } catch (error) {
    state = original;
    throw error;
  }
}

// ─── CRUD: COA ───────────────────────────────────────────────────────────────

export function addCoa(entry) {
  const code = sanitizeCoaCode(entry?.code);
  const name = sanitizeInputText(entry?.name, 120);
  const category = sanitizeInputText(entry?.category, 50) || 'UMUM';
  if (!code || !name) throw new Error('Kode dan Nama Akun wajib diisi dengan format valid');
  if (state.coaList.some(c => c.code === code)) throw new Error(`Kode COA ${code} sudah ada`);
  commitMaster({ ...state, coaList: [...state.coaList, { ...entry, code, name, category }].sort((a, b) => a.code - b.code) });
}

export function updateCoa(idx, entry) {
  const code = sanitizeCoaCode(entry?.code);
  const name = sanitizeInputText(entry?.name, 120);
  const category = sanitizeInputText(entry?.category, 50) || 'UMUM';
  if (!code || !name) throw new Error('Kode dan Nama Akun wajib diisi dengan format valid');
  if (state.coaList.some((c, i) => i !== idx && c.code === code)) throw new Error(`Kode COA ${code} sudah digunakan`);
  const previous = state.coaList[idx];
  if (!previous) throw new Error('COA tidak ditemukan');
  const next = deepClone(state);
  next.coaList = next.coaList.map((c, i) => i === idx ? { ...c, ...entry, code, name, category } : c);
  if (previous.code !== code) {
    next.programs = next.programs.map(p => ({
      ...p,
      coaCode: p.coaCode === previous.code ? code : p.coaCode,
      parentCoaCode: p.parentCoaCode === previous.code ? code : p.parentCoaCode
    }));
    next.donors = next.donors.map(d => ({ ...d, defaultCoa: d.defaultCoa === previous.code ? code : d.defaultCoa }));
    if (next.settings.defaultUnauthorizedCoa === previous.code) next.settings.defaultUnauthorizedCoa = code;
    if (next.settings.defaultBaselineCoa === previous.code) next.settings.defaultBaselineCoa = code;
    if (next.settings.expenseCoa === previous.code) next.settings.expenseCoa = code;
  }
  commitMaster(next);
}

export function deleteCoa(idx) {
  const c = state.coaList[idx];
  if (!c) return;
  const sys = getSystemCodes(state);
  if ([sys.unauth, sys.umum, sys.expense].includes(c.code)) {
    throw new Error(`COA ${c.code} dipetakan sebagai akun default sistem — ubah dulu di Akun Default Sistem`);
  }
  const referencedByProgram = state.programs.find(p => p.coaCode === c.code || p.parentCoaCode === c.code);
  const referencedByDonor = state.donors.find(d => d.defaultCoa === c.code);
  if (referencedByProgram || referencedByDonor) {
    throw new Error(`COA ${c.code} masih dipakai oleh ${referencedByProgram ? `program '${referencedByProgram.name}'` : `donatur '${referencedByDonor.name}'`}.`);
  }
  commitMaster({ ...state, coaList: state.coaList.filter((_, i) => i !== idx) });
}

export function batchDeleteCoa(indices) {
  const set = new Set(indices.map(Number));
  const sys = getSystemCodes(state);
  const protectedCodes = [sys.unauth, sys.umum, sys.expense];
  const selected = state.coaList.filter((_, i) => set.has(i));
  const blocked = selected.find(c => protectedCodes.includes(c.code)
    || state.programs.some(p => p.coaCode === c.code || p.parentCoaCode === c.code)
    || state.donors.some(d => d.defaultCoa === c.code));
  if (blocked) throw new Error(`COA ${blocked.code} masih menjadi akun sistem atau dipakai data lain.`);
  const deletedCount = selected.length;
  commitMaster({ ...state, coaList: state.coaList.filter((_, i) => !set.has(i)) });
  return deletedCount;
}

// ─── CRUD: PROGRAM ────────────────────────────────────────────────────────────

export function addProgram(entry) {
  const id = sanitizeSlug(entry?.id, 50);
  const name = sanitizeInputText(entry?.name, 120);
  const coaCode = sanitizeCoaCode(entry?.coaCode) || 0;
  const tailCode = sanitizeInputText(entry?.tailCode, 10);
  const description = sanitizeInputText(entry?.description, 500);
  const keywords = Array.isArray(entry?.keywords)
    ? entry.keywords.map(k => sanitizeInputText(k, 50)).filter(Boolean)
    : String(entry?.keywords || '').split(/[;,]/).map(k => sanitizeInputText(k, 50)).filter(Boolean);
  const parentCoaCode = sanitizeCoaCode(entry?.parentCoaCode) || null;
  const hiddenKeywords = Array.isArray(entry?.hiddenKeywords)
    ? entry.hiddenKeywords.map(k => sanitizeInputText(k, 50)).filter(Boolean)
    : [];

  if (!id || !name) throw new Error('ID dan Nama Program wajib diisi dengan format valid');
  if (!state.coaList.some(c => c.code === coaCode)) throw new Error(`COA ${coaCode || '(kosong)'} tidak ada di master COA`);
  if (parentCoaCode && !state.coaList.some(c => c.code === parentCoaCode)) throw new Error(`Induk COA ${parentCoaCode} tidak ada di master COA`);
  if (state.programs.some(p => p.id === id)) throw new Error(`ID Program '${id}' sudah ada`);
  if (tailCode && state.programs.some(p => p.tailCode === tailCode)) throw new Error(`Kode ekor '${tailCode}' sudah digunakan`);
  commitMaster({
    ...state,
    programs: [...state.programs, { ...entry, id, name, coaCode, tailCode, keywords, description, parentCoaCode, hiddenKeywords }]
  });
}

export function updateProgram(idx, entry) {
  const id = sanitizeSlug(entry?.id, 50);
  const name = sanitizeInputText(entry?.name, 120);
  const coaCode = sanitizeCoaCode(entry?.coaCode) || 0;
  const tailCode = sanitizeInputText(entry?.tailCode, 10);
  const description = sanitizeInputText(entry?.description, 500);
  const keywords = Array.isArray(entry?.keywords)
    ? entry.keywords.map(k => sanitizeInputText(k, 50)).filter(Boolean)
    : String(entry?.keywords || '').split(/[;,]/).map(k => sanitizeInputText(k, 50)).filter(Boolean);
  const parentCoaCode = entry?.parentCoaCode !== undefined ? sanitizeCoaCode(entry?.parentCoaCode) || null : undefined;
  const existingProgram = state.programs[idx];
  const hiddenKeywords = entry?.hiddenKeywords !== undefined
    ? Array.isArray(entry?.hiddenKeywords)
      ? entry.hiddenKeywords.map(k => sanitizeInputText(k, 50)).filter(Boolean)
      : []
    : (existingProgram ? existingProgram.hiddenKeywords : []);

  if (!id || !name) throw new Error('ID dan Nama Program wajib diisi');
  if (!existingProgram) throw new Error('Program tidak ditemukan');
  if (!state.coaList.some(c => c.code === coaCode)) throw new Error(`COA ${coaCode || '(kosong)'} tidak ada di master COA`);
  if (parentCoaCode && !state.coaList.some(c => c.code === parentCoaCode)) throw new Error(`Induk COA ${parentCoaCode} tidak ada di master COA`);
  if (state.programs.some((p, i) => i !== idx && p.id === id)) throw new Error(`ID Program '${id}' sudah digunakan`);
  if (tailCode && state.programs.some((p, i) => i !== idx && p.tailCode === tailCode)) throw new Error(`Kode ekor '${tailCode}' sudah digunakan`);
  const next = deepClone(state);
  next.programs[idx] = {
    ...existingProgram,
    ...entry,
    id,
    name,
    coaCode,
    tailCode,
    keywords,
    description,
    parentCoaCode: parentCoaCode === undefined ? existingProgram.parentCoaCode || null : parentCoaCode,
    hiddenKeywords
  };
  if (existingProgram.id !== id) {
    next.donors = next.donors.map(donor => donor.defaultProgramId === existingProgram.id
      ? { ...donor, defaultProgramId: id, defaultCoa: coaCode }
      : donor);
  }
  commitMaster(next);
}

export function deleteProgram(idx) {
  const program = state.programs[idx];
  if (!program) return;
  const donor = state.donors.find(d => d.defaultProgramId === program.id);
  if (donor) throw new Error(`Program '${program.name}' masih menjadi default donatur '${donor.name}'.`);
  commitMaster({ ...state, programs: state.programs.filter((_, i) => i !== idx) });
}

export function batchDeletePrograms(indices) {
  const set = new Set(indices.map(Number));
  const selected = state.programs.filter((_, i) => set.has(i));
  const selectedIds = new Set(selected.map(p => p.id));
  const donor = state.donors.find(d => selectedIds.has(d.defaultProgramId));
  if (donor) throw new Error(`Program yang dipilih masih menjadi default donatur '${donor.name}'.`);
  const deletedCount = selected.length;
  commitMaster({ ...state, programs: state.programs.filter((_, i) => !set.has(i)) });
  return deletedCount;
}

// ─── CRUD: DONOR ──────────────────────────────────────────────────────────────

export function addDonor(entry) {
  const name = sanitizeInputText(entry?.name, 100);
  const phone = sanitizePhone(entry?.phone, 25);
  const defaultProgramId = sanitizeSlug(entry?.defaultProgramId, 50);
  const defaultCoa = sanitizeCoaCode(entry?.defaultCoa) || getSystemCodes(state).umum;
  if (!name) throw new Error('Nama Donatur wajib diisi');
  if (defaultProgramId && !state.programs.some(p => p.id === defaultProgramId)) throw new Error(`Program default '${defaultProgramId}' tidak ada`);
  if (!state.coaList.some(c => c.code === defaultCoa)) throw new Error(`COA default ${defaultCoa} tidak ada`);
  const id = sanitizeSlug(entry?.id, 80) || `donor-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  if (state.donors.some(d => d.id === id)) throw new Error(`ID Donatur '${id}' sudah digunakan`);
  commitMaster({ ...state, donors: [...state.donors, { ...entry, id, name, phone, defaultProgramId, defaultCoa }] });
}

export function updateDonor(idx, entry) {
  const name = sanitizeInputText(entry?.name, 100);
  const phone = sanitizePhone(entry?.phone, 25);
  const defaultProgramId = sanitizeSlug(entry?.defaultProgramId, 50);
  if (!name) throw new Error('Nama Donatur wajib diisi');
  if (defaultProgramId && !state.programs.some(p => p.id === defaultProgramId)) throw new Error(`Program default '${defaultProgramId}' tidak ada`);
  const linkedProgram = state.programs.find(p => p.id === defaultProgramId);
  commitMaster({
    ...state,
    donors: state.donors.map((d, i) => i === idx
      ? { ...d, ...entry, name, phone, defaultProgramId, defaultCoa: sanitizeCoaCode(entry?.defaultCoa) || linkedProgram?.coaCode || d.defaultCoa }
      : d)
  });
}

export function deleteDonor(idx) {
  commitMaster({ ...state, donors: state.donors.filter((_, i) => i !== idx) });
}

export function batchDeleteDonors(indices) {
  const set = new Set(indices.map(Number));
  const deletedCount = state.donors.filter((_, i) => set.has(i)).length;
  commitMaster({ ...state, donors: state.donors.filter((_, i) => !set.has(i)) });
  return deletedCount;
}

// ─── CRUD: ALIAS ──────────────────────────────────────────────────────────────

export function addAlias(alias) {
  const clean = sanitizeInputText(alias, 100);
  if (!clean) throw new Error('Nama alias wajib diisi');
  const aliases = state.companyAliases || [];
  if (aliases.some(a => a.toLowerCase() === clean.toLowerCase())) {
    throw new Error('Alias sudah ada');
  }
  commitMaster({ ...state, companyAliases: [...aliases, clean] });
}

export function deleteAlias(idx) {
  commitMaster({ ...state, companyAliases: (state.companyAliases || []).filter((_, i) => i !== idx) });
}

export function batchDeleteAliases(indices) {
  const set = new Set(indices.map(Number));
  const aliases = state.companyAliases || [];
  const deletedCount = aliases.filter((_, i) => set.has(i)).length;
  commitMaster({ ...state, companyAliases: aliases.filter((_, i) => !set.has(i)) });
  return deletedCount;
}

// ─── CONFIG JSON EXPORT / IMPORT ──────────────────────────────────────────────

export function exportConfigToJson() {
  const exported = deepClone(state);
  exported.schemaVersion = CURRENT_SCHEMA_VERSION;
  exported.settings.aiApiKey = '';
  return JSON.stringify(exported, null, 2);
}

function parseConfigJson(jsonStr) {
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`Format JSON tidak valid: ${err.message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Berkas JSON harus berupa objek konfigurasi valid.');
  }

  if (!parsed.coaList && !parsed.programs && !parsed.donors && !parsed.companyAliases && !parsed.settings) {
    throw new Error('Berkas JSON tidak memuat konfigurasi ZISWAF yang dikenali.');
  }
  return parsed;
}

function buildConfigDraft(parsed, mode) {
  if (!['replace', 'merge'].includes(mode)) throw new Error(`Mode impor '${mode}' tidak dikenal.`);
  const base = mode === 'replace' ? deepClone(DEFAULT_MASTER_DATA) : deepClone(state);
  if (parsed.settings && typeof parsed.settings === 'object') {
    base.settings = normalizeSettings({ ...base.settings, ...parsed.settings, aiApiKey: state.settings.aiApiKey || '' });
  }
  if (mode === 'replace') {
    if (Array.isArray(parsed.coaList)) {
      base.coaList = parsed.coaList.map(normalizeCoa).filter(c => c.code && c.name);
    }
    if (Array.isArray(parsed.programs)) {
      base.programs = parsed.programs.map(normalizeProgram).filter(p => p.id && p.name);
    }
    if (Array.isArray(parsed.donors)) {
      base.donors = parsed.donors.map(d => normalizeDonor(d, base.settings.defaultBaselineCoa)).filter(d => d.name);
    }
    if (Array.isArray(parsed.companyAliases)) {
      base.companyAliases = cleanStringList(parsed.companyAliases, 100);
    }
  } else {
    if (Array.isArray(parsed.coaList)) {
      const coaMap = new Map(base.coaList.map(c => [c.code, c]));
      parsed.coaList.forEach(c => {
        const normalized = normalizeCoa(c);
        if (normalized.code && normalized.name) coaMap.set(normalized.code, normalized);
      });
      base.coaList = Array.from(coaMap.values()).sort((a, b) => a.code - b.code);
    }
    if (Array.isArray(parsed.programs)) {
      const progMap = new Map(base.programs.map(p => [p.id, p]));
      parsed.programs.forEach(p => {
        const normalized = normalizeProgram(p);
        if (normalized.id && normalized.name) progMap.set(normalized.id, { ...(progMap.get(normalized.id) || {}), ...normalized });
      });
      base.programs = Array.from(progMap.values());
    }
    if (Array.isArray(parsed.donors)) {
      const donors = [...base.donors];
      parsed.donors.forEach(d => {
        const normalized = normalizeDonor(d, base.settings.defaultBaselineCoa);
        if (normalized.name) {
          const matchIdx = donors.findIndex(x => (normalized.phone && x.phone === normalized.phone) || x.name.toLowerCase() === normalized.name.toLowerCase());
          if (matchIdx >= 0) {
            donors[matchIdx] = { ...donors[matchIdx], ...normalized, id: donors[matchIdx].id };
          } else {
            donors.push(normalized);
          }
        }
      });
      base.donors = donors;
    }
    if (Array.isArray(parsed.companyAliases)) {
      const aliasSet = new Set((base.companyAliases || []).map(a => a.toLowerCase()));
      const aliasList = [...(base.companyAliases || [])];
      parsed.companyAliases.forEach(a => {
        const clean = sanitizeInputText(a, 100);
        if (clean && !aliasSet.has(clean.toLowerCase())) {
          aliasSet.add(clean.toLowerCase());
          aliasList.push(clean);
        }
      });
      base.companyAliases = aliasList;
    }
  }
  return normalizeMaster(base);
}

export function previewConfigImport(jsonStr, mode = 'replace') {
  const draft = buildConfigDraft(parseConfigJson(jsonStr), mode);
  const summarize = (currentItems, nextItems, keyOf) => {
    const currentMap = new Map(currentItems.map(item => [keyOf(item), JSON.stringify(item)]));
    const nextMap = new Map(nextItems.map(item => [keyOf(item), JSON.stringify(item)]));
    let added = 0, updated = 0, removed = 0;
    for (const [key, value] of nextMap) {
      if (!currentMap.has(key)) added++;
      else if (currentMap.get(key) !== value) updated++;
    }
    for (const key of currentMap.keys()) if (!nextMap.has(key)) removed++;
    return { added, updated, removed };
  };
  return {
    schemaVersion: draft.schemaVersion,
    coaCount: draft.coaList.length,
    programCount: draft.programs.length,
    donorCount: draft.donors.length,
    aliasCount: draft.companyAliases.length,
    changes: {
      coa: summarize(state.coaList, draft.coaList, item => String(item.code)),
      programs: summarize(state.programs, draft.programs, item => item.id),
      donors: summarize(state.donors, draft.donors, item => item.id),
      aliases: summarize(state.companyAliases, draft.companyAliases, item => item.toLocaleLowerCase('id-ID'))
    },
    mode
  };
}

export function importConfigFromJson(jsonStr, mode = 'replace') {
  const draft = buildConfigDraft(parseConfigJson(jsonStr), mode);
  try {
    storageAccessor.setItem(BACKUP_STORAGE_KEY, exportConfigToJson());
  } catch (error) {
    throw new Error(`Backup sebelum impor tidak dapat dibuat: ${error?.message || 'penyimpanan tidak tersedia'}`);
  }
  commitMaster(draft);
  return true;
}

export function hasConfigBackup() {
  try {
    return Boolean(storageAccessor.getItem(BACKUP_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function restoreLastConfigBackup() {
  let raw;
  try {
    raw = storageAccessor.getItem(BACKUP_STORAGE_KEY);
  } catch (error) {
    throw new Error(`Backup otomatis tidak dapat dibaca: ${error?.message || 'penyimpanan tidak tersedia'}`);
  }
  if (!raw) throw new Error('Belum ada backup otomatis yang dapat dipulihkan.');
  const draft = buildConfigDraft(parseConfigJson(raw), 'replace');
  commitMaster(draft);
  return true;
}
