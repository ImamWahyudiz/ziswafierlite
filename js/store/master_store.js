import { DEFAULT_MASTER_DATA } from "../config/default_presets.js";
import { sanitizeInputText, sanitizeSlug, sanitizePhone, sanitizeCoaCode } from "../engine/sanitizer.js";

const STORAGE_KEY = "ziswaf_demo_master_v1";

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

const storageAccessor = storage || memoryStorage;

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

let state = deepClone(DEFAULT_MASTER_DATA);
const subscribers = new Set();

function persist() {
  try {
    storageAccessor.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {}
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
        state = deepClone(parsed);
      }
    }
  } catch (e) {
    state = deepClone(DEFAULT_MASTER_DATA);
    persist();
  }
}

init();

export const SPECIAL_ACCOUNTS = [
  { code: 40201000, name: "Penerimaan Infak & Sedekah Tanpa Pembatasan - Unauthorized", category: "UMUM" },
  { code: 40201001, name: "Penerimaan Infak & Sedekah Tanpa Pembatasan - Umum", category: "UMUM" },
  { code: 60100008, name: "Beban Lain-Lain (Pengeluaran Bank)", category: "UMUM" },
  { code: 40100000, name: "Penerimaan Zakat Tanpa Pembatasan - Baseline", category: "UMUM" }
];

export const SPECIAL_PROGRAMS = [
  { id: "BASELINE_UNAUTHORIZED", name: "Baseline - Unauthorized", coaCode: 40100000, tailCode: "001", keywords: ["zakat", "baseline"], description: "Program baseline untuk penerimaan belum diotorisasi" },
  { id: "BASELINE_ZAKAT", name: "Baseline Zakat", coaCode: 40100000, tailCode: "002", keywords: ["zakat", "baseline"], description: "Program baseline Zakat" },
  { id: "BASELINE_INFAK", name: "Baseline Infak", coaCode: 40201000, tailCode: "003", keywords: ["infak", "baseline"], description: "Program baseline Infak" }
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

  const prevSys = getSystemCodes(state);

  state.settings = {
    ...state.settings,
    defaultUnauthorizedCoa: uCode,
    defaultUnauthorizedName: uName,
    defaultBaselineCoa: bCode,
    defaultBaselineName: bName,
    expenseCoa: eCode,
    expenseName: eName
  };

  // Sync to state.coaList
  const coaMap = new Map(state.coaList.map(c => [c.code, { ...c }]));

  // If codes changed from previous defaults, clean up old defaults if not in use
  [prevSys.unauth, prevSys.umum, prevSys.expense].forEach(oldCode => {
    if (oldCode && oldCode !== uCode && oldCode !== bCode && oldCode !== eCode) {
      if ([40201000, 40201001, 60100008].includes(oldCode)) {
        coaMap.delete(oldCode);
      }
    }
  });

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

  state.coaList = Array.from(coaMap.values()).sort((a, b) => a.code - b.code);

  persist();
  notify();
  return getSystemCodes(state);
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

export function updateMaster(patch) {
  state = deepMerge(state, patch);
  persist();
  notify();
  return deepClone(state);
}

export function resetToDefaults() {
  state = deepClone(DEFAULT_MASTER_DATA);
  persist();
  notify();
  return deepClone(state);
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
export function importMasterFromExcel(workbook, mode = 'merge', targetEntity = null) {
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
          description: descStr
        });
      } else if (rawId || rawName) {
        errorLogs.push(`Program Baris ${rowIdx + 2}: ID (${rawId}) atau Nama (${rawName}) tidak valid.`);
      }
    });

    if (parsedPrograms.length > 0) {
      if (mode === 'replace') {
        const newPrograms = [...parsedPrograms];
        SPECIAL_PROGRAMS.forEach(special => {
          if (!newPrograms.some(p => p.id === special.id)) {
            newPrograms.push({ ...special });
          }
        });
        state.programs = newPrograms;
        programCount = parsedPrograms.length;
      } else {
        // Merge mode
        const existingMap = new Map(state.programs.map(p => [p.id, p]));
        parsedPrograms.forEach(p => existingMap.set(p.id, p));
        SPECIAL_PROGRAMS.forEach(special => {
          if (!existingMap.has(special.id)) {
            existingMap.set(special.id, { ...special });
          }
        });
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

  persist();
  notify();

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

// ─── CRUD: COA ───────────────────────────────────────────────────────────────

export function addCoa(entry) {
  const code = sanitizeCoaCode(entry?.code);
  const name = sanitizeInputText(entry?.name, 120);
  const category = sanitizeInputText(entry?.category, 50) || 'UMUM';
  if (!code || !name) throw new Error('Kode dan Nama Akun wajib diisi dengan format valid');
  if (state.coaList.some(c => c.code === code)) throw new Error(`Kode COA ${code} sudah ada`);
  state.coaList = [...state.coaList, { code, name, category }].sort((a, b) => a.code - b.code);
  persist(); notify();
}

export function updateCoa(idx, entry) {
  const code = sanitizeCoaCode(entry?.code);
  const name = sanitizeInputText(entry?.name, 120);
  const category = sanitizeInputText(entry?.category, 50) || 'UMUM';
  if (!code || !name) throw new Error('Kode dan Nama Akun wajib diisi dengan format valid');
  if (state.coaList.some((c, i) => i !== idx && c.code === code)) throw new Error(`Kode COA ${code} sudah digunakan`);
  state.coaList = state.coaList.map((c, i) => i === idx ? { ...c, code, name, category } : c).sort((a, b) => a.code - b.code);
  persist(); notify();
}

export function deleteCoa(idx) {
  const c = state.coaList[idx];
  if (!c) return;
  const sys = getSystemCodes(state);
  if ([sys.unauth, sys.umum, sys.expense].includes(c.code)) {
    throw new Error(`COA ${c.code} dipetakan sebagai akun default sistem — ubah dulu di Akun Default Sistem`);
  }
  state.coaList = state.coaList.filter((_, i) => i !== idx);
  persist(); notify();
}

export function batchDeleteCoa(indices) {
  const set = new Set(indices.map(Number));
  const sys = getSystemCodes(state);
  const protectedCodes = [sys.unauth, sys.umum, sys.expense];
  let deletedCount = 0;
  state.coaList = state.coaList.filter((c, i) => {
    if (set.has(i)) {
      if (protectedCodes.includes(c.code)) return true; // keep protected
      deletedCount++;
      return false;
    }
    return true;
  });
  persist(); notify();
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

  if (!id || !name) throw new Error('ID dan Nama Program wajib diisi dengan format valid');
  if (state.programs.some(p => p.id === id)) throw new Error(`ID Program '${id}' sudah ada`);
  state.programs = [...state.programs, { id, name, coaCode, tailCode, keywords, description }];
  persist(); notify();
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

  if (!id || !name) throw new Error('ID dan Nama Program wajib diisi');
  if (state.programs.some((p, i) => i !== idx && p.id === id)) throw new Error(`ID Program '${id}' sudah digunakan`);
  state.programs = state.programs.map((p, i) => i === idx ? { id, name, coaCode, tailCode, keywords, description } : p);
  persist(); notify();
}

export function deleteProgram(idx) {
  state.programs = state.programs.filter((_, i) => i !== idx);
  persist(); notify();
}

export function batchDeletePrograms(indices) {
  const set = new Set(indices.map(Number));
  let deletedCount = 0;
  state.programs = state.programs.filter((_, i) => {
    if (set.has(i)) {
      deletedCount++;
      return false;
    }
    return true;
  });
  persist(); notify();
  return deletedCount;
}

// ─── CRUD: DONOR ──────────────────────────────────────────────────────────────

export function addDonor(entry) {
  const name = sanitizeInputText(entry?.name, 100);
  const phone = sanitizePhone(entry?.phone, 25);
  const defaultProgramId = sanitizeSlug(entry?.defaultProgramId, 50);
  const defaultCoa = sanitizeCoaCode(entry?.defaultCoa) || getSystemCodes(state).umum;
  if (!name) throw new Error('Nama Donatur wajib diisi');
  const id = entry?.id || `donor-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  state.donors = [...state.donors, { id, name, phone, defaultProgramId, defaultCoa }];
  persist(); notify();
}

export function updateDonor(idx, entry) {
  const name = sanitizeInputText(entry?.name, 100);
  const phone = sanitizePhone(entry?.phone, 25);
  const defaultProgramId = sanitizeSlug(entry?.defaultProgramId, 50);
  if (!name) throw new Error('Nama Donatur wajib diisi');
  state.donors = state.donors.map((d, i) => i === idx ? { ...d, name, phone, defaultProgramId } : d);
  persist(); notify();
}

export function deleteDonor(idx) {
  state.donors = state.donors.filter((_, i) => i !== idx);
  persist(); notify();
}

export function batchDeleteDonors(indices) {
  const set = new Set(indices.map(Number));
  let deletedCount = 0;
  state.donors = state.donors.filter((_, i) => {
    if (set.has(i)) {
      deletedCount++;
      return false;
    }
    return true;
  });
  persist(); notify();
  return deletedCount;
}

// ─── CRUD: ALIAS ──────────────────────────────────────────────────────────────

export function addAlias(alias) {
  const clean = sanitizeInputText(alias, 100);
  if (!clean) throw new Error('Nama alias wajib diisi');
  if (!state.companyAliases) state.companyAliases = [];
  if (state.companyAliases.some(a => a.toLowerCase() === clean.toLowerCase())) {
    throw new Error('Alias sudah ada');
  }
  state.companyAliases = [...state.companyAliases, clean];
  persist(); notify();
}

export function deleteAlias(idx) {
  state.companyAliases = (state.companyAliases || []).filter((_, i) => i !== idx);
  persist(); notify();
}

export function batchDeleteAliases(indices) {
  const set = new Set(indices.map(Number));
  let deletedCount = 0;
  state.companyAliases = (state.companyAliases || []).filter((_, i) => {
    if (set.has(i)) {
      deletedCount++;
      return false;
    }
    return true;
  });
  persist(); notify();
  return deletedCount;
}

// ─── CONFIG JSON EXPORT / IMPORT ──────────────────────────────────────────────

export function exportConfigToJson() {
  return JSON.stringify(deepClone(state), null, 2);
}

export function importConfigFromJson(jsonStr, mode = 'replace') {
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

  if (mode === 'replace') {
    const newState = deepClone(DEFAULT_MASTER_DATA);
    if (Array.isArray(parsed.coaList)) {
      newState.coaList = parsed.coaList.map(c => ({
        code: sanitizeCoaCode(c.code),
        name: sanitizeInputText(c.name, 120),
        category: sanitizeInputText(c.category, 50) || 'UMUM'
      })).filter(c => c.code && c.name);
      SPECIAL_ACCOUNTS.forEach(special => {
        if (!newState.coaList.some(c => c.code === special.code)) {
          newState.coaList.push({ ...special });
        }
      });
      newState.coaList.sort((a, b) => a.code - b.code);
    }
    if (Array.isArray(parsed.programs)) {
      newState.programs = parsed.programs.map(p => ({
        id: sanitizeSlug(p.id, 50),
        name: sanitizeInputText(p.name, 120),
        coaCode: sanitizeCoaCode(p.coaCode) || 0,
        tailCode: sanitizeInputText(p.tailCode, 10),
        keywords: Array.isArray(p.keywords) ? p.keywords.map(k => sanitizeInputText(k, 50)).filter(Boolean) : [],
        description: sanitizeInputText(p.description, 500)
      })).filter(p => p.id && p.name);
      SPECIAL_PROGRAMS.forEach(special => {
        if (!newState.programs.some(p => p.id === special.id)) {
          newState.programs.push({ ...special });
        }
      });
    }
    if (Array.isArray(parsed.donors)) {
      newState.donors = parsed.donors.map(d => ({
        id: d.id || `donor-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: sanitizeInputText(d.name, 100),
        phone: sanitizePhone(d.phone, 25),
        defaultProgramId: sanitizeSlug(d.defaultProgramId, 50),
        defaultCoa: sanitizeCoaCode(d.defaultCoa) || 40201001
      })).filter(d => d.name);
    }
    if (Array.isArray(parsed.companyAliases)) {
      newState.companyAliases = parsed.companyAliases.map(a => sanitizeInputText(a, 100)).filter(Boolean);
    }
    if (parsed.settings && typeof parsed.settings === 'object') {
      newState.settings = { ...DEFAULT_MASTER_DATA.settings, ...parsed.settings };
    }
    state = newState;
  } else {
    // Merge mode
    if (Array.isArray(parsed.coaList)) {
      const coaMap = new Map(state.coaList.map(c => [c.code, c]));
      parsed.coaList.forEach(c => {
        const code = sanitizeCoaCode(c.code);
        const name = sanitizeInputText(c.name, 120);
        const category = sanitizeInputText(c.category, 50) || 'UMUM';
        if (code && name) coaMap.set(code, { code, name, category });
      });
      state.coaList = Array.from(coaMap.values()).sort((a, b) => a.code - b.code);
    }
    if (Array.isArray(parsed.programs)) {
      const progMap = new Map(state.programs.map(p => [p.id, p]));
      parsed.programs.forEach(p => {
        const id = sanitizeSlug(p.id, 50);
        const name = sanitizeInputText(p.name, 120);
        const coaCode = sanitizeCoaCode(p.coaCode) || 0;
        const tailCode = sanitizeInputText(p.tailCode, 10);
        const keywords = Array.isArray(p.keywords) ? p.keywords.map(k => sanitizeInputText(k, 50)).filter(Boolean) : [];
        const description = sanitizeInputText(p.description, 500);
        if (id && name) progMap.set(id, { id, name, coaCode, tailCode, keywords, description });
      });
      state.programs = Array.from(progMap.values());
    }
    if (Array.isArray(parsed.donors)) {
      const donors = [...state.donors];
      parsed.donors.forEach(d => {
        const name = sanitizeInputText(d.name, 100);
        const phone = sanitizePhone(d.phone, 25);
        const defaultProgramId = sanitizeSlug(d.defaultProgramId, 50);
        if (name) {
          const matchIdx = donors.findIndex(x => (phone && x.phone === phone) || x.name.toLowerCase() === name.toLowerCase());
          if (matchIdx >= 0) {
            donors[matchIdx] = { ...donors[matchIdx], name, phone, defaultProgramId };
          } else {
            donors.push({ id: d.id || `donor-${Date.now()}`, name, phone, defaultProgramId, defaultCoa: 40201001 });
          }
        }
      });
      state.donors = donors;
    }
    if (Array.isArray(parsed.companyAliases)) {
      const aliasSet = new Set((state.companyAliases || []).map(a => a.toLowerCase()));
      const aliasList = [...(state.companyAliases || [])];
      parsed.companyAliases.forEach(a => {
        const clean = sanitizeInputText(a, 100);
        if (clean && !aliasSet.has(clean.toLowerCase())) {
          aliasSet.add(clean.toLowerCase());
          aliasList.push(clean);
        }
      });
      state.companyAliases = aliasList;
    }
    if (parsed.settings && typeof parsed.settings === 'object') {
      state.settings = { ...state.settings, ...parsed.settings };
    }
  }

  persist();
  notify();
  return true;
}
