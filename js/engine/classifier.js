import { cleanTransactionText } from "./sanitizer.js";
import { classifySemanticClient } from "./ai_matcher.js";

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

export async function classifySingle(tx, master) {
  const { settings, coaList, programs, donors } = master;
  const expenseCoa = settings.expenseCoa;
  const defaultUnauthorizedCoa = settings.defaultUnauthorizedCoa;
  const defaultBaselineCoa = settings.defaultBaselineCoa;
  
  const result = {
    id: tx.id,
    rawDate: tx.rawDate,
    transactionDate: tx.rawDate,
    rawLabel: tx.rawLabel,
    rawAmount: tx.rawAmount,
    partner: tx.partner,
    cleanedLabel: '',
    extractedSenderName: null,
    assignedCoa: 0,
    assignedCoaName: '',
    assignedProgramId: null,
    matchedLayer: '',
    confidence: 0,
    reasoning: '',
    isExpense: false,
    isOverridden: false
  };
  
  const { cleanedLabel, extractedSenderName, companyAliasMatched } = cleanTransactionText(tx.rawLabel, master.companyAliases || []);
  result.cleanedLabel = cleanedLabel;
  result.extractedSenderName = extractedSenderName;
  result.companyAliasMatched = companyAliasMatched;
  
  const cleanedLower = cleanedLabel.toLowerCase();
  
  // Layer 1: Expense
  const rawLower = String(tx.rawLabel || '').toLowerCase();
  if (tx.rawAmount < 0 || rawLower.includes('trf ke') || rawLower.includes('biaya')) {
    result.assignedCoa = expenseCoa;
    result.assignedCoaName = coaList.find(c => c.code === expenseCoa)?.name || '';
    result.assignedProgramId = null;
    result.matchedLayer = 'EXPENSE';
    result.confidence = 1.0;
    result.reasoning = 'Terdeteksi sebagai transaksi pengeluaran/beban (nominal negatif atau biaya operasional)';
    result.isExpense = true;
    return result;
  }
  
  // Layer 2: Campaign Tail Code
  const s = String(Math.trunc(Math.abs(tx.rawAmount)));
  for (const prog of programs) {
    if (prog.tailCode) {
      if (s.endsWith(prog.tailCode) && s.length >= prog.tailCode.length) {
        result.assignedCoa = prog.coaCode;
        result.assignedCoaName = coaList.find(c => c.code === prog.coaCode)?.name || '';
        result.assignedProgramId = prog.id;
        result.matchedLayer = 'CAMPAIGN_TAIL';
        result.confidence = 0.95;
        result.reasoning = `Nominal berakhiran kode unik kampanye '${prog.tailCode}' untuk program ${prog.name}`;
        return result;
      }
    }
  }
  
  // Layer 3: Registered Donor
  if (extractedSenderName) {
    let matchedDonor = null;
    for (const donor of donors) {
      const donorName = donor.name.toLowerCase();
      const senderNameLower = extractedSenderName.toLowerCase();
      if (donorName === senderNameLower || donorName.includes(senderNameLower) || senderNameLower.includes(donorName)) {
        matchedDonor = donor;
        break;
      }
    }
    
    if (matchedDonor) {
      let targetCoa = 0;
      let targetProgram = null;
      
      if (matchedDonor.defaultProgramId) {
        const prog = programs.find(p => p.id === matchedDonor.defaultProgramId);
        if (prog) {
          targetCoa = prog.coaCode;
          targetProgram = prog.id;
        } else {
          targetCoa = defaultBaselineCoa;
          targetProgram = null;
        }
      } else {
        targetCoa = defaultBaselineCoa;
        targetProgram = null;
      }
      
      let keywordOverrideFound = false;
      for (const prog of programs) {
        for (const k of prog.keywords) {
          const ktrimmed = k?.trim().toLowerCase();
          if (ktrimmed && cleanedLower.includes(ktrimmed)) {
            targetCoa = prog.coaCode;
            targetProgram = prog.id;
            keywordOverrideFound = true;
            break;
          }
        }
        if (keywordOverrideFound) break;
      }
      
      result.assignedCoa = targetCoa;
      result.assignedCoaName = coaList.find(c => c.code === targetCoa)?.name || '';
      result.assignedProgramId = targetProgram;
      result.matchedLayer = 'DONATUR_TETAP';
      result.confidence = 0.90;
      result.reasoning = `Pengirim terdaftar sebagai Donatur Tetap: ${matchedDonor.name}`;
      return result;
    }
  }
  
  // Layer 4: Keywords
  for (const prog of programs) {
    for (const k of prog.keywords) {
      const ktrimmed = k?.trim().toLowerCase();
      if (ktrimmed && cleanedLower.includes(ktrimmed)) {
        result.assignedCoa = prog.coaCode;
        result.assignedCoaName = coaList.find(c => c.code === prog.coaCode)?.name || '';
        result.assignedProgramId = prog.id;
        result.matchedLayer = 'KEYWORD';
        result.confidence = 0.90;
        result.reasoning = `Deskripsi cocok dengan kata kunci '${ktrimmed}' pada program ${prog.name}`;
        return result;
      }
    }
  }
  
  // Layer 5: Semantic AI Matcher
  if (settings.aiMode !== 'OFF' && cleanedLabel) {
    try {
      const res = await classifySemanticClient(cleanedLabel, programs, settings);
      if (res && res.coa && res.confidence >= settings.confidenceThreshold) {
        result.assignedCoa = res.coa;
        result.assignedCoaName = coaList.find(c => c.code === res.coa)?.name || '';
        result.assignedProgramId = res.programId;
        result.matchedLayer = 'AI_SEMANTIC';
        result.confidence = round4(res.confidence);
        result.reasoning = res.reason;
        return result;
      }
    } catch (e) {
      result.matchedLayer = '';
    }
  }
  
  // Fallback: Org Alias
  if (companyAliasMatched && !cleanedLabel.trim()) {
    result.assignedCoa = defaultBaselineCoa;
    result.assignedCoaName = coaList.find(c => c.code === defaultBaselineCoa)?.name || '';
    result.assignedProgramId = null;
    result.matchedLayer = 'ORG_ALIAS';
    result.confidence = 0.5;
    result.reasoning = 'Mutasi hanya berisi nama lembaga/alias → dialokasikan ke Infak Umum';
    return result;
  }

  // Fallback: Unauthorized
  result.assignedCoa = defaultUnauthorizedCoa;
  result.assignedCoaName = coaList.find(c => c.code === defaultUnauthorizedCoa)?.name || '';
  result.assignedProgramId = null;
  result.matchedLayer = 'UNAUTHORIZED_FALLBACK';
  result.confidence = 0.0;
  result.reasoning = 'Tidak ditemukan kata kunci atau identitas donatur (Karantina Mutasi Buta / Unauthorized)';
  return result;
}

export async function classifyBatch(rows, master, onProgress) {
  if (!rows || rows.length === 0) {
    return [];
  }
  
  const results = [];
  for (let i = 0; i < rows.length; i++) {
    const result = await classifySingle(rows[i], master);
    results.push(result);
    if (onProgress) {
      onProgress(i + 1, rows.length, result);
    }
  }
  return results;
}
