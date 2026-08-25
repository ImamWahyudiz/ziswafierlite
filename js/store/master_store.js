import { DEFAULT_MASTER_DATA } from "../config/default_presets.js";

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

const SPECIAL_ACCOUNTS = [
  { code: 40201000, name: "Penerimaan Infak & Sedekah Tanpa Pembatasan - Unauthorized", category: "UMUM" },
  { code: 40201001, name: "Penerimaan Infak & Sedekah Tanpa Pembatasan - Umum", category: "UMUM" },
  { code: 60100008, name: "Beban Lain-Lain (Pengeluaran Bank)", category: "UMUM" },
  { code: 40100000, name: "Penerimaan Zakat Tanpa Pembatasan - Baseline", category: "UMUM" }
];

const SPECIAL_PROGRAMS = [
  { id: "BASELINE_UNAUTHORIZED", name: "Baseline - Unauthorized", coaCode: 40100000, tailCode: "001", keywords: "zakat;baseline", description: "Program baseline untuk penerimaan belum diotorisasi" },
  { id: "BASELINE_ZAKAT", name: "Baseline Zakat", coaCode: 40100000, tailCode: "002", keywords: "zakat;baseline", description: "Program baseline Zakat" },
  { id: "BASELINE_INFAK", name: "Baseline Infak", coaCode: 40201000, tailCode: "003", keywords: "infak;baseline", description: "Program baseline Infak" }
];

function normalizeColumn(value, aliases) {
  if (!value) return null;
  const lower = String(value).toLowerCase().trim();
  return aliases.some(alias => alias.toLowerCase() === lower) ? value : null;
}

function findColumn(headers, aliases) {
  for (const header of headers) {
    for (const alias of aliases) {
      if (String(header).toLowerCase().trim() === alias.toLowerCase()) {
        return header;
      }
    }
  }
  return null;
}

function findCOASheet(workbook) {
  if (!workbook.SheetNames || !workbook.Sheets) return null;
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    const data = globalThis.XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (data.length > 0) {
      const headers = Object.keys(data[0]);
      const hasNoAkun = headers.some(h => /no\s*akun|no_akun|kode\s*akun|coa/i.test(h));
      const hasNamaAkun = headers.some(h => /nama\s*akun|nama_akun|akun/i.test(h));
      if (hasNoAkun && hasNamaAkun) {
        return ws;
      }
    }
  }
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    const data = globalThis.XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (data.length > 0) {
      const headers = Object.keys(data[0]);
      const hasNoAkun = headers.some(h => /no\s*akun|no_akun|kode\s*akun|coa/i.test(h));
      const hasNamaAkun = headers.some(h => /nama\s*akun|nama_akun|akun/i.test(h));
      if (hasNoAkun && hasNamaAkun) {
        return ws;
      }
    }
  }
  return null;
}

function findProgramSheet(workbook) {
  if (!workbook.SheetNames || !workbook.Sheets) return null;
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    const data = globalThis.XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (data.length > 0) {
      const headers = Object.keys(data[0]);
      const hasProgram = headers.some(h => /program/i.test(h));
      const hasNamaProgram = headers.some(h => /nama\s*program|nama_program|program|nama/i.test(h));
      if (hasProgram || hasNamaProgram) {
        return ws;
      }
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

export function importMasterFromExcel(workbook) {
  const coaSheet = findCOASheet(workbook);
  if (!coaSheet) {
    return 0;
  }
  const coaData = globalThis.XLSX.utils.sheet_to_json(coaSheet, { defval: "" });
  const headers = coaData.length > 0 ? Object.keys(coaData[0]) : [];
  const codeCol = findColumn(headers, ["no akun", "no_akun", "kode akun", "coa"]);
  const nameCol = findColumn(headers, ["nama akun", "nama_akun", "akun"]);
  const categoryCol = findColumn(headers, ["kategori", "category"]);
  const newCoaList = [];
  for (const row of coaData) {
    const codeValue = codeCol ? row[codeCol] : row["NO AKUN"] || row["NO_AKUN"] || row["KODE AKUN"] || row["COA"];
    const nameValue = nameCol ? row[nameCol] : row["NAMA AKUN"] || row["NAMA_AKUN"] || row["AKUN"];
    const categoryValue = categoryCol ? row[categoryCol] : row["KATEGORI"] || row["CATEGORY"];
    const codeNum = Number(codeValue);
    if (!isNaN(codeNum) && codeNum > 0 && nameValue) {
      newCoaList.push({
        code: codeNum,
        name: String(nameValue).trim(),
        category: categoryValue ? String(categoryValue).trim() : "UMUM"
      });
    }
  }
  for (const special of SPECIAL_ACCOUNTS) {
    if (!newCoaList.some(c => c.code === special.code)) {
      newCoaList.push({ ...special });
    }
  }
  newCoaList.sort((a, b) => a.code - b.code);
  state.coaList = newCoaList;
  const programSheet = findProgramSheet(workbook);
  if (programSheet) {
    const programData = globalThis.XLSX.utils.sheet_to_json(programSheet, { defval: "" });
    const progHeaders = programData.length > 0 ? Object.keys(programData[0]) : [];
    const idCol = findColumn(progHeaders, ["id", "id program", "kode program"]);
    const nameColProg = findColumn(progHeaders, ["nama program", "program", "nama"]);
    const coaColProg = findColumn(progHeaders, ["no akun", "coa", "kode akun"]);
    const tailColProg = findColumn(progHeaders, ["kode ekor", "ekor"]);
    const keywordsColProg = findColumn(progHeaders, ["keywords", "kata kunci"]);
    const newPrograms = [];
    for (const row of programData) {
      const idValue = idCol ? row[idCol] : row["ID"] || row["ID PROGRAM"] || row["KODE PROGRAM"];
      const nameValue = nameColProg ? row[nameColProg] : row["NAMA PROGRAM"] || row["PROGRAM"] || row["NAMA"];
      if (idValue && nameValue) {
        const coaValue = coaColProg ? row[coaColProg] : row["NO AKUN"] || row["COA"] || row["KODE AKUN"];
        const tailValue = tailColProg ? row[tailColProg] : row["KODE EKOR"] || row["EKOR"];
        const keywordsValue = keywordsColProg ? row[keywordsColProg] : row["KEYWORDS"] || row["KATA KUNCI"];
        const keywordsStr = keywordsValue ? String(keywordsValue).split(/[;,]/).map(k => k.trim()).filter(k => k) : [];
        newPrograms.push({
          id: String(idValue).trim(),
          name: String(nameValue).trim(),
          coaCode: Number(coaValue) || 0,
          tailCode: tailValue ? String(tailValue).trim() : "",
          keywords: keywordsStr,
          description: ""
        });
      }
    }
    for (const special of SPECIAL_PROGRAMS) {
      if (!newPrograms.some(p => p.id === special.id)) {
        newPrograms.push({ ...special });
      }
    }
    state.programs = newPrograms;
  }
  persist();
  notify();
  return newCoaList.length;
}

export function addCoa(entry) {
  if (state.coaList.some(c => c.code === entry.code)) throw new Error('Kode COA sudah ada');
  state.coaList = [...state.coaList, entry].sort((a, b) => a.code - b.code);
  persist(); notify();
}

export function updateCoa(idx, entry) {
  state.coaList = state.coaList.map((c, i) => i === idx ? { ...c, ...entry } : c);
  persist(); notify();
}

export function deleteCoa(idx) {
  state.coaList = state.coaList.filter((_, i) => i !== idx);
  persist(); notify();
}

export function addProgram(entry) {
  if (state.programs.some(p => p.id === entry.id)) throw new Error('ID Program sudah ada');
  state.programs = [...state.programs, entry];
  persist(); notify();
}

export function updateProgram(idx, entry) {
  state.programs = state.programs.map((p, i) => i === idx ? { ...p, ...entry } : p);
  persist(); notify();
}

export function deleteProgram(idx) {
  state.programs = state.programs.filter((_, i) => i !== idx);
  persist(); notify();
}

export function addDonor(entry) {
  state.donors = [...state.donors, entry];
  persist(); notify();
}

export function updateDonor(idx, entry) {
  state.donors = state.donors.map((d, i) => i === idx ? { ...d, ...entry } : d);
  persist(); notify();
}

export function deleteDonor(idx) {
  state.donors = state.donors.filter((_, i) => i !== idx);
  persist(); notify();
}

export function addAlias(alias) {
  if (!state.companyAliases) state.companyAliases = [];
  if (state.companyAliases.includes(alias)) throw new Error('Alias sudah ada');
  state.companyAliases = [...state.companyAliases, alias];
  persist(); notify();
}

export function deleteAlias(idx) {
  state.companyAliases = (state.companyAliases || []).filter((_, i) => i !== idx);
  persist(); notify();
}

export function exportConfigToJson() {
  return JSON.stringify(deepClone(state), null, 2);
}

export function importConfigFromJson(jsonStr) {
  const parsed = JSON.parse(jsonStr);
  if (!parsed.coaList || !Array.isArray(parsed.coaList) || !parsed.programs || !Array.isArray(parsed.programs)) {
    throw new Error("Struktur konfigurasi tidak valid");
  }
  state = deepClone(parsed);
  persist();
  notify();
  return true;
}
