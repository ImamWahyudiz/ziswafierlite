/**
 * 5-Layer ZISWAF Cashflow Reconciliation Classifier
 * Browser Engine Port of app/engine/classifier.py
 */

import { cleanTransactionText } from "./sanitizer.js";
import { classifySemanticClient, classifySemanticBatchClient } from "./ai_matcher.js";

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

/**
 * Classifies a single transaction row
 */
export async function classifySingle(tx, master) {
  const { settings, coaList, programs, donors } = master;
  const expenseCoa = settings.expenseCoa;
  const defaultUnauthorizedCoa = settings.defaultUnauthorizedCoa;
  const defaultBaselineCoa = settings.defaultBaselineCoa;
  const confidenceThreshold = settings.confidenceThreshold || 0.70;
  
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
  const rawLower = String(tx.rawLabel || '').toLowerCase();

  // Layer 1: Expense
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
  
  // Layer 3: Donatur Tetap (Registered Donor)
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

  // COMPANY_UMUM: Inflow from official foundation account without program keywords
  let companyMatched = false;
  for (const alias of (master.companyAliases || [])) {
    const aliasClean = alias?.trim().toLowerCase();
    if (aliasClean && (rawLower.includes(aliasClean) || (extractedSenderName && aliasClean === extractedSenderName.trim().toLowerCase()))) {
      companyMatched = true;
      break;
    }
  }
  if (companyMatched) {
    let hasProgramKeyword = false;
    for (const prog of programs) {
      for (const k of prog.keywords) {
        const ktrimmed = k?.trim().toLowerCase();
        if (ktrimmed && cleanedLower.includes(ktrimmed)) {
          hasProgramKeyword = true;
          break;
        }
      }
      if (hasProgramKeyword) break;
    }
    if (!hasProgramKeyword) {
      result.assignedCoa = defaultBaselineCoa;
      result.assignedCoaName = coaList.find(c => c.code === defaultBaselineCoa)?.name || '';
      result.assignedProgramId = null;
      result.matchedLayer = 'ORG_ALIAS';
      result.confidence = 0.90;
      result.reasoning = 'Transfer dari akun resmi yayasan tanpa keterangan program (dialokasikan ke Umum)';
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
  const aiMode = (settings.aiMode || '').toUpperCase();
  if (aiMode !== 'OFF' && aiMode !== 'DISABLED' && cleanedLabel.trim()) {
    try {
      const res = await classifySemanticClient(cleanedLabel, programs, settings);
      if (res && res.confidence >= confidenceThreshold && res.coa) {
        // Sanitize against program/COA list
        let matchedProgram = programs.find(p => p.id === res.programId);
        let finalCoa = matchedProgram ? matchedProgram.coaCode : res.coa;
        
        result.assignedCoa = finalCoa;
        result.assignedCoaName = coaList.find(c => c.code === finalCoa)?.name || '';
        result.assignedProgramId = matchedProgram ? matchedProgram.id : null;
        result.matchedLayer = 'AI_SEMANTIC';
        result.confidence = round4(res.confidence);
        result.reasoning = res.reason || `Rekomendasi AI semantik (${aiMode})`;
        return result;
      }
    } catch (e) {
      result.matchedLayer = '';
    }
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

/**
 * High-performance batch classification with Phase 1 (Deterministic) and Phase 2 (Micro-Batch AI)
 * Port of classify_batch_with_progress from app/engine/classifier.py
 */
export async function classifyBatch(rows, master, onProgress) {
  if (!rows || rows.length === 0) {
    return [];
  }
  
  const { settings, coaList, programs, donors } = master;
  const expenseCoa = settings.expenseCoa;
  const defaultUnauthorizedCoa = settings.defaultUnauthorizedCoa;
  const defaultBaselineCoa = settings.defaultBaselineCoa;
  const confidenceThreshold = settings.confidenceThreshold || 0.70;
  const aiMode = (settings.aiMode || '').toUpperCase();
  
  const results = new Array(rows.length);
  const needsAiIndices = [];
  
  // Phase 1: Deterministic Layers (0 - 4)
  for (let i = 0; i < rows.length; i++) {
    const tx = rows[i];
    const { cleanedLabel, extractedSenderName, companyAliasMatched } = cleanTransactionText(tx.rawLabel, master.companyAliases || []);
    
    const item = {
      id: tx.id,
      rawDate: tx.rawDate,
      transactionDate: tx.rawDate,
      rawLabel: tx.rawLabel,
      rawAmount: tx.rawAmount,
      partner: tx.partner,
      cleanedLabel,
      extractedSenderName,
      companyAliasMatched,
      assignedCoa: 0,
      assignedCoaName: '',
      assignedProgramId: null,
      matchedLayer: '',
      confidence: 0,
      reasoning: '',
      isExpense: false,
      isOverridden: false
    };

    const cleanedLower = cleanedLabel.toLowerCase();
    const rawLower = String(tx.rawLabel || '').toLowerCase();

    // Layer 1: Expense
    if (tx.rawAmount < 0 || rawLower.includes('trf ke') || rawLower.includes('biaya')) {
      item.assignedCoa = expenseCoa;
      item.assignedCoaName = coaList.find(c => c.code === expenseCoa)?.name || '';
      item.assignedProgramId = null;
      item.matchedLayer = 'EXPENSE';
      item.confidence = 1.0;
      item.reasoning = 'Terdeteksi sebagai transaksi pengeluaran/beban (nominal negatif atau biaya operasional)';
      item.isExpense = true;
      results[i] = item;
      if (onProgress) onProgress(i + 1, rows.length, item);
      continue;
    }

    // Layer 2: Campaign Tail Code
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
      results[i] = item;
      if (onProgress) onProgress(i + 1, rows.length, item);
      continue;
    }

    // Layer 3: Donatur Tetap
    let donorMatched = false;
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
        let targetCoa = 0;
        let targetProgram = null;
        if (matchedDonor.defaultProgramId) {
          const prog = programs.find(p => p.id === matchedDonor.defaultProgramId);
          targetCoa = prog ? prog.coaCode : defaultBaselineCoa;
          targetProgram = prog ? prog.id : null;
        } else {
          targetCoa = defaultBaselineCoa;
          targetProgram = null;
        }

        for (const prog of programs) {
          for (const k of prog.keywords) {
            const ktrimmed = k?.trim().toLowerCase();
            if (ktrimmed && cleanedLower.includes(ktrimmed)) {
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
        donorMatched = true;
        results[i] = item;
        if (onProgress) onProgress(i + 1, rows.length, item);
        continue;
      }
    }

    // COMPANY_UMUM
    let companyMatched = false;
    for (const alias of (master.companyAliases || [])) {
      const aliasClean = alias?.trim().toLowerCase();
      if (aliasClean && (rawLower.includes(aliasClean) || (extractedSenderName && aliasClean === extractedSenderName.trim().toLowerCase()))) {
        companyMatched = true;
        break;
      }
    }
    if (companyMatched) {
      let hasProgramKeyword = false;
      for (const prog of programs) {
        for (const k of prog.keywords) {
          const ktrimmed = k?.trim().toLowerCase();
          if (ktrimmed && cleanedLower.includes(ktrimmed)) {
            hasProgramKeyword = true;
            break;
          }
        }
        if (hasProgramKeyword) break;
      }
      if (!hasProgramKeyword) {
        item.assignedCoa = defaultBaselineCoa;
        item.assignedCoaName = coaList.find(c => c.code === defaultBaselineCoa)?.name || '';
        item.assignedProgramId = null;
        item.matchedLayer = 'ORG_ALIAS';
        item.confidence = 0.90;
        item.reasoning = 'Transfer dari akun resmi yayasan tanpa keterangan program (dialokasikan ke Umum)';
        results[i] = item;
        if (onProgress) onProgress(i + 1, rows.length, item);
        continue;
      }
    }

    // Layer 4: Keywords
    let keywordMatched = false;
    for (const prog of programs) {
      for (const k of prog.keywords) {
        const ktrimmed = k?.trim().toLowerCase();
        if (ktrimmed && cleanedLower.includes(ktrimmed)) {
          item.assignedCoa = prog.coaCode;
          item.assignedCoaName = coaList.find(c => c.code === prog.coaCode)?.name || '';
          item.assignedProgramId = prog.id;
          item.matchedLayer = 'KEYWORD';
          item.confidence = 0.90;
          item.reasoning = `Deskripsi cocok dengan kata kunci '${ktrimmed}' pada program ${prog.name}`;
          keywordMatched = true;
          break;
        }
      }
      if (keywordMatched) break;
    }
    if (keywordMatched) {
      results[i] = item;
      if (onProgress) onProgress(i + 1, rows.length, item);
      continue;
    }

    // Collect for Layer 5 AI
    results[i] = item;
    needsAiIndices.push(i);
  }

  // Phase 2: Micro-Batch Layer 5 AI Execution
  if (needsAiIndices.length > 0) {
    if (aiMode !== 'OFF' && aiMode !== 'DISABLED') {
      const chunkSize = (aiMode === 'LOCAL_OLLAMA' || aiMode === 'OLLAMA') ? 5 : 15;
      for (let chunkStart = 0; chunkStart < needsAiIndices.length; chunkStart += chunkSize) {
        const chunkIndices = needsAiIndices.slice(chunkStart, chunkStart + chunkSize);
        const chunkItems = chunkIndices.map(idx => results[idx]);

        try {
          const aiBatchResults = await classifySemanticBatchClient(chunkItems, programs, settings);

          for (let cPos = 0; cPos < chunkIndices.length; cPos++) {
            const origIdx = chunkIndices[cPos];
            const it = results[origIdx];
            const aiRes = aiBatchResults && aiBatchResults[cPos];

            if (aiRes && aiRes.confidence >= confidenceThreshold && aiRes.coa) {
              const matchedProgram = programs.find(p => p.id === aiRes.programId);
              const finalCoa = matchedProgram ? matchedProgram.coaCode : aiRes.coa;

              it.assignedCoa = finalCoa;
              it.assignedCoaName = coaList.find(c => c.code === finalCoa)?.name || '';
              it.assignedProgramId = matchedProgram ? matchedProgram.id : null;
              it.matchedLayer = 'AI_SEMANTIC';
              it.confidence = round4(aiRes.confidence);
              it.reasoning = aiRes.reason || `Rekomendasi AI semantik (${aiMode})`;
            } else {
              it.assignedCoa = defaultUnauthorizedCoa;
              it.assignedCoaName = coaList.find(c => c.code === defaultUnauthorizedCoa)?.name || '';
              it.assignedProgramId = null;
              it.matchedLayer = 'UNAUTHORIZED_FALLBACK';
              it.confidence = aiRes ? round4(aiRes.confidence) : 0.0;
              it.reasoning = aiRes?.reason || 'Tidak ditemukan kata kunci atau kepastian AI (Karantina Mutasi Buta / Unauthorized)';
            }

            if (onProgress) onProgress(origIdx + 1, rows.length, it);
          }
        } catch (chunkErr) {
          for (const origIdx of chunkIndices) {
            const it = results[origIdx];
            it.assignedCoa = defaultUnauthorizedCoa;
            it.assignedCoaName = coaList.find(c => c.code === defaultUnauthorizedCoa)?.name || '';
            it.assignedProgramId = null;
            it.matchedLayer = 'UNAUTHORIZED_FALLBACK';
            it.confidence = 0.0;
            it.reasoning = 'Gagal menghubungi AI: ' + chunkErr.message;
            if (onProgress) onProgress(origIdx + 1, rows.length, it);
          }
        }
      }
    } else {
      // AI is DISABLED
      for (const origIdx of needsAiIndices) {
        const it = results[origIdx];
        it.assignedCoa = defaultUnauthorizedCoa;
        it.assignedCoaName = coaList.find(c => c.code === defaultUnauthorizedCoa)?.name || '';
        it.assignedProgramId = null;
        it.matchedLayer = 'UNAUTHORIZED_FALLBACK';
        it.confidence = 0.0;
        it.reasoning = 'Modul AI nonaktif dan tidak ditemukan kata kunci (Karantina Mutasi Buta / Unauthorized)';
        if (onProgress) onProgress(origIdx + 1, rows.length, it);
      }
    }
  }

  return results;
}
