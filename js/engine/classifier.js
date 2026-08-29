import { cleanTransactionText } from "./sanitizer.js";
import { classifySemanticClient, classifySemanticBatchClient } from "./ai_matcher.js";

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchKeywordInText(text, keyword) {
  if (!text || !keyword) return false;
  const k = String(keyword).trim().toLowerCase();
  if (k.length < 2) return false; // Strict guard: single char keywords (like 'z') are ignored
  
  const t = String(text).toLowerCase();
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRe(k)}([^a-z0-9]|$)`, 'i');
  return pattern.test(t);
}

export function isSenderNameOnly(cleanedLabel, extractedSenderName) {
  if (!extractedSenderName || !cleanedLabel) return false;
  const c = cleanedLabel.toLowerCase().trim();
  const s = extractedSenderName.toLowerCase().trim();
  if (!c || !s) return false;
  if (c === s) return true;

  const sTokens = s.split(/\s+/).filter(tok => tok.length >= 2);
  let remaining = c;
  for (const tok of sTokens) {
    remaining = remaining.replace(new RegExp(`(^|[^a-z0-9])${escapeRe(tok)}([^a-z0-9]|$)`, 'gi'), ' ');
  }
  remaining = remaining.replace(/\b(trf|cr|dr|dari|ke|via|bifast|transfer|bank|bca|bni|bri|mandiri|bsi)\b/gi, ' ').trim();
  return remaining.length === 0;
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
          if (matchKeywordInText(cleanedLabel, k)) {
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
  
  for (const prog of programs) {
    for (const k of prog.keywords) {
      if (matchKeywordInText(cleanedLabel, k)) {
        result.assignedCoa = prog.coaCode;
        result.assignedCoaName = coaList.find(c => c.code === prog.coaCode)?.name || '';
        result.assignedProgramId = prog.id;
        result.matchedLayer = 'KEYWORD';
        result.confidence = 0.90;
        result.reasoning = `Deskripsi cocok dengan kata kunci '${k}' pada program ${prog.name}`;
        return result;
      }
    }
  }

  // Guard against AI hallucinating on name-only or code-only transactions:
  const isNameOnly = isSenderNameOnly(cleanedLabel, extractedSenderName);
  const isCodeOnly = /^[a-z0-9_-]{1,10}$/i.test(cleanedLabel.trim());

  if (isNameOnly) {
    result.assignedCoa = defaultUnauthorizedCoa;
    result.assignedCoaName = coaList.find(c => c.code === defaultUnauthorizedCoa)?.name || '';
    result.assignedProgramId = null;
    result.matchedLayer = 'UNAUTHORIZED_FALLBACK';
    result.confidence = 0.0;
    result.reasoning = 'Mutasi hanya berisi nama pengirim tanpa keterangan program (Karantina / Unauthorized)';
    return result;
  }

  if (isCodeOnly) {
    result.assignedCoa = defaultUnauthorizedCoa;
    result.assignedCoaName = coaList.find(c => c.code === defaultUnauthorizedCoa)?.name || '';
    result.assignedProgramId = null;
    result.matchedLayer = 'UNAUTHORIZED_FALLBACK';
    result.confidence = 0.0;
    result.reasoning = 'Deskripsi hanya berupa kode referensi tanpa kata kunci program (Karantina / Unauthorized)';
    return result;
  }
  
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
  
  if (companyAliasMatched && !cleanedLabel.trim()) {
    result.assignedCoa = defaultBaselineCoa;
    result.assignedCoaName = coaList.find(c => c.code === defaultBaselineCoa)?.name || '';
    result.assignedProgramId = null;
    result.matchedLayer = 'ORG_ALIAS';
    result.confidence = 0.5;
    result.reasoning = 'Mutasi hanya berisi nama lembaga/alias → dialokasikan ke Infak Umum';
    return result;
  }

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
  
  const { settings, coaList, programs, donors } = master;
  const defaultUnauthorizedCoa = settings.defaultUnauthorizedCoa;
  const defaultBaselineCoa = settings.defaultBaselineCoa;
  const expenseCoa = settings.expenseCoa;
  const results = [];
  const needsAi = [];

  // Pass 1: Local Rule-Based (Layer 0, 1, 2, 3, ORG_ALIAS) — Runs instantly for all rows
  for (let i = 0; i < rows.length; i++) {
    const tx = rows[i];
    const item = {
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
    item.cleanedLabel = cleanedLabel;
    item.extractedSenderName = extractedSenderName;
    item.companyAliasMatched = companyAliasMatched;

    const cleanedLower = cleanedLabel.toLowerCase();
    const rawLower = String(tx.rawLabel || '').toLowerCase();

    // Layer 0: Expense
    if (tx.rawAmount < 0 || rawLower.includes('trf ke') || rawLower.includes('biaya')) {
      item.assignedCoa = expenseCoa;
      item.assignedCoaName = coaList.find(c => c.code === expenseCoa)?.name || '';
      item.assignedProgramId = null;
      item.matchedLayer = 'EXPENSE';
      item.confidence = 1.0;
      item.reasoning = 'Terdeteksi sebagai transaksi pengeluaran/beban (nominal negatif atau biaya operasional)';
      item.isExpense = true;
      results.push(item);
      continue;
    }

    // Layer 1: Campaign Tail Code
    const s = String(Math.trunc(Math.abs(tx.rawAmount)));
    let tailMatched = false;
    for (const prog of programs) {
      if (prog.tailCode && s.endsWith(prog.tailCode) && s.length >= prog.tailCode.length) {
        item.assignedCoa = prog.coaCode;
        item.assignedCoaName = coaList.find(c => c.code === prog.coaCode)?.name || '';
        item.assignedProgramId = prog.id;
        item.matchedLayer = 'CAMPAIGN_TAIL';
        item.confidence = 0.95;
        item.reasoning = `Nominal berakhiran kode unik kampanye '${prog.tailCode}' untuk program ${prog.name}`;
        tailMatched = true;
        break;
      }
    }
    if (tailMatched) {
      results.push(item);
      continue;
    }

    // Layer 2: Registered Donor
    if (extractedSenderName) {
      let matchedDonor = null;
      const senderNameLower = extractedSenderName.toLowerCase();
      for (const donor of donors) {
        const donorName = donor.name.toLowerCase();
        if (donorName === senderNameLower || donorName.includes(senderNameLower) || senderNameLower.includes(donorName)) {
          matchedDonor = donor;
          break;
        }
      }
      if (matchedDonor) {
        let targetCoa = matchedDonor.defaultProgramId
          ? (programs.find(p => p.id === matchedDonor.defaultProgramId)?.coaCode || defaultBaselineCoa)
          : defaultBaselineCoa;
        let targetProgram = matchedDonor.defaultProgramId || null;

        for (const prog of programs) {
          for (const k of prog.keywords) {
            if (matchKeywordInText(cleanedLabel, k)) {
              targetCoa = prog.coaCode;
              targetProgram = prog.id;
              break;
            }
          }
        }

        item.assignedCoa = targetCoa;
        item.assignedCoaName = coaList.find(c => c.code === targetCoa)?.name || '';
        item.assignedProgramId = targetProgram;
        item.matchedLayer = 'DONATUR_TETAP';
        item.confidence = 0.90;
        item.reasoning = `Pengirim terdaftar sebagai Donatur Tetap: ${matchedDonor.name}`;
        results.push(item);
        continue;
      }
    }

    // Layer 3: Keyword Match
    let keywordMatched = false;
    for (const prog of programs) {
      for (const k of prog.keywords) {
        if (matchKeywordInText(cleanedLabel, k)) {
          item.assignedCoa = prog.coaCode;
          item.assignedCoaName = coaList.find(c => c.code === prog.coaCode)?.name || '';
          item.assignedProgramId = prog.id;
          item.matchedLayer = 'KEYWORD';
          item.confidence = 0.90;
          item.reasoning = `Deskripsi cocok dengan kata kunci '${k}' pada program ${prog.name}`;
          keywordMatched = true;
          break;
        }
      }
      if (keywordMatched) break;
    }
    if (keywordMatched) {
      results.push(item);
      continue;
    }

    // Guard against AI hallucinating on name-only or code-only transactions:
    const isNameOnly = isSenderNameOnly(cleanedLabel, extractedSenderName);
    const isCodeOnly = /^[a-z0-9_-]{1,10}$/i.test(cleanedLabel.trim());

    if (isNameOnly) {
      item.assignedCoa = defaultUnauthorizedCoa;
      item.assignedCoaName = coaList.find(c => c.code === defaultUnauthorizedCoa)?.name || '';
      item.assignedProgramId = null;
      item.matchedLayer = 'UNAUTHORIZED_FALLBACK';
      item.confidence = 0.0;
      item.reasoning = 'Mutasi hanya berisi nama pengirim tanpa keterangan program (Karantina / Unauthorized)';
      results.push(item);
      continue;
    }

    if (isCodeOnly) {
      item.assignedCoa = defaultUnauthorizedCoa;
      item.assignedCoaName = coaList.find(c => c.code === defaultUnauthorizedCoa)?.name || '';
      item.assignedProgramId = null;
      item.matchedLayer = 'UNAUTHORIZED_FALLBACK';
      item.confidence = 0.0;
      item.reasoning = 'Deskripsi hanya berupa kode referensi tanpa kata kunci program (Karantina / Unauthorized)';
      results.push(item);
      continue;
    }

    // Collect for AI Semantic Match (Layer 4)
    results.push(item);
    if (cleanedLabel.trim()) {
      needsAi.push(item);
    }
  }

  function getCurrentCounts() {
    const c = { EXPENSE: 0, CAMPAIGN_TAIL: 0, DONATUR_TETAP: 0, KEYWORD: 0, AI_SEMANTIC: 0, UNAUTHORIZED_FALLBACK: 0 };
    for (const it of results) {
      if (it.matchedLayer && c[it.matchedLayer] !== undefined) {
        c[it.matchedLayer]++;
      }
    }
    return c;
  }

  if (onProgress) {
    onProgress(rows.length - needsAi.length, rows.length, getCurrentCounts());
  }

  // Pass 2: Batch AI Semantic Match (Layer 4) — Process in chunks of 15
  if (settings.aiMode !== 'OFF' && needsAi.length > 0) {
    const BATCH_SIZE = 15;
    for (let b = 0; b < needsAi.length; b += BATCH_SIZE) {
      const chunk = needsAi.slice(b, b + BATCH_SIZE);
      const aiPredictions = await classifySemanticBatchClient(chunk, programs, settings);
      
      for (const pred of aiPredictions) {
        const targetItem = chunk.find(it => it.id === pred.id);
        if (targetItem && pred.confidence >= settings.confidenceThreshold) {
          targetItem.assignedCoa = pred.coa;
          targetItem.assignedCoaName = coaList.find(c => c.code === pred.coa)?.name || '';
          targetItem.assignedProgramId = pred.programId;
          targetItem.matchedLayer = 'AI_SEMANTIC';
          targetItem.confidence = round4(pred.confidence);
          targetItem.reasoning = pred.reason;
        }
      }
      if (onProgress) {
        onProgress(Math.min(rows.length - needsAi.length + b + chunk.length, rows.length), rows.length, getCurrentCounts());
      }
    }
  }

  // Pass 3: Final Fallback for unassigned rows
  for (const item of results) {
    if (!item.matchedLayer) {
      if (item.companyAliasMatched && !item.cleanedLabel.trim()) {
        item.assignedCoa = defaultBaselineCoa;
        item.assignedCoaName = coaList.find(c => c.code === defaultBaselineCoa)?.name || '';
        item.assignedProgramId = null;
        item.matchedLayer = 'ORG_ALIAS';
        item.confidence = 0.5;
        item.reasoning = 'Mutasi hanya berisi nama lembaga/alias → dialokasikan ke Infak Umum';
      } else {
        item.assignedCoa = defaultUnauthorizedCoa;
        item.assignedCoaName = coaList.find(c => c.code === defaultUnauthorizedCoa)?.name || '';
        item.assignedProgramId = null;
        item.matchedLayer = 'UNAUTHORIZED_FALLBACK';
        item.confidence = 0.0;
        item.reasoning = 'Tidak ditemukan kata kunci atau identitas donatur (Karantina Mutasi Buta / Unauthorized)';
      }
    }
  }

  if (onProgress) {
    onProgress(rows.length, rows.length, getCurrentCounts());
  }

  return results;
}
