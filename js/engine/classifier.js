/**
 * 5-Layer ZISWAF Cashflow Reconciliation Classifier
 * Browser Engine Port of app/engine/classifier.py
 */

import { cleanTransactionText, normalizeForMatch } from "./sanitizer.js";
import { classifySemanticClient, classifySemanticBatchClient } from "./ai_matcher.js";

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

/**
 * Strips common Indonesian honorifics/salutations from a name so that
 * "Pak Budi", "Bapak Budi", "Bu Chelsi", "Ibu Chelsi", "H. Ahmad", "Hj. Siti"
 * all normalise to the bare name for matching.
 */
const HONORIFIC_RE = /^\s*(?:bapak|pak|ibu|bu|dr\.?|drs\.?|prof\.?|hj?\.?|ustaz(?:ah)?|ust\.?|kh\.?|mrs?\.?|miss|ms\.?)\s+/i;
function stripHonorific(name) {
  if (!name) return name;
  // Strip repeatedly in case of stacked titles, e.g. "Bapak H. Budi"
  let s = name.trim();
  let prev;
  do { prev = s; s = s.replace(HONORIFIC_RE, '').trim(); } while (s !== prev);
  return s;
}

/**
 * Token-based donor matching: checks both directions.
 * - All sender tokens in donor (sender is subset of donor): "Amalia Faridahjse" → "Ibu Amalia Faridahjse Kamil"
 * - All donor tokens in sender (donor is subset of sender): "Helen Dasa Indah S Pi" → "Ibu Helen Dasa Indah"
 * Requires at least one matching token >= 4 chars to avoid single-short-word false matches.
 * Prevents false positives like "Wahyu" → "Indah Wahyudi".
 */
function matchDonorTokens(senderBare, donorBare) {
  const senderTokens = senderBare.split(/\s+/).filter(t => t.length > 0);
  const donorTokens = donorBare.split(/\s+/).filter(t => t.length > 0);
  if (senderTokens.length === 0 || donorTokens.length === 0) return false;
  const hasLongToken = senderTokens.some(t => t.length >= 4) || donorTokens.some(t => t.length >= 4);
  if (!hasLongToken) return false;
  // Direction 1: sender is subset of donor (sender tokens all appear in donor)
  const senderSubset = senderTokens.every(st => donorTokens.includes(st));
  // Direction 2: donor is subset of sender (donor tokens all appear in sender)
  const donorSubset = donorTokens.every(dt => senderTokens.includes(dt));
  return senderSubset || donorSubset;
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
  // Engine-level canonical form for matching (handles WAQAF→WAKAF, QUR'AN→QURAN, etc.)
  const normalizedLabel = normalizeForMatch(cleanedLabel);

  // Layer 1: Expense — only negative amount or explicit "biaya" (transfer fee)
  if (tx.rawAmount < 0 || rawLower.includes('biaya')) {
    result.assignedCoa = expenseCoa;
    result.assignedCoaName = coaList.find(c => c.code === expenseCoa)?.name || '';
    result.assignedProgramId = null;
    result.matchedLayer = 'EXPENSE';
    result.confidence = 1.0;
    result.reasoning = 'Terdeteksi sebagai transaksi pengeluaran/beban (nominal negatif atau biaya operasional)';
    result.isExpense = true;
    return result;
  }
  
  // Layer 2: Campaign Tail Code — DEFERRED (like donor, keywords take priority)
  // Only use tailCode if no keyword matches
  const s = String(Math.trunc(Math.abs(tx.rawAmount)));
  let tailMatchedProg = null;
  for (const prog of programs) {
    if (prog.tailCode && s.endsWith(prog.tailCode) && s.length >= prog.tailCode.length) {
      tailMatchedProg = prog;
      break; // first match (program order)
    }
  }
  
  // Layer 3: Donatur Tetap (Registered Donor) — stored but NOT resolved yet
  // Keywords take priority over donor defaults when both match
  let donorTargetCoa = 0;
  let donorTargetProgram = null;
  let donorName = null;
  if (extractedSenderName) {
    let matchedDonor = null;
    const senderBare = stripHonorific(extractedSenderName).toLowerCase();
    const senderNameLower = extractedSenderName.toLowerCase();
    for (const donor of donors) {
      const donorBare = stripHonorific(donor.name).toLowerCase();
      const donorFull = donor.name.toLowerCase();
      if (
        donorBare === senderBare ||
        donorFull === senderNameLower ||
        matchDonorTokens(senderBare, donorBare)
      ) {
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
          targetCoa = matchedDonor.defaultCoa || defaultBaselineCoa;
          targetProgram = null;
        }
      } else {
        targetCoa = matchedDonor.defaultCoa || defaultBaselineCoa;
        targetProgram = null;
      }
      
      // Store donor info but DON'T resolve yet — keywords take priority
      donorTargetCoa = targetCoa;
      donorTargetProgram = targetProgram;
      donorName = matchedDonor.name;
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
      const allKw = [...(prog.keywords || []), ...(prog.hiddenKeywords || [])];
      for (const k of allKw) {
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
  
  // Layer 4: Keywords — weighted scoring (highest score wins)
  // score = program.priority * 10 + sum of matched keyword lengths
  // Both label and keywords normalized via engine-level canonicalization
  // Include both regular keywords and hiddenKeywords (AI-generated typo/synonym variants)
  let bestKeywordProg = null;
  let bestKeywordScore = 0;
  let bestKeywordMatched = '';
  for (const prog of programs) {
    const allKeywords = [...(prog.keywords || []), ...(prog.hiddenKeywords || [])];
    const progPriority = prog.priority || 5;
    let progScore = 0;
    let progMatchedKw = '';
    for (const k of allKeywords) {
      const ktrimmed = normalizeForMatch(k?.trim());
      if (ktrimmed && normalizedLabel.includes(ktrimmed)) {
        const kwScore = ktrimmed.length;
        if (kwScore > progScore) {
          progScore = kwScore;
          progMatchedKw = ktrimmed;
        }
      }
    }
    if (progScore > 0) {
      const totalScore = progPriority * 10 + progScore;
      if (totalScore > bestKeywordScore) {
        bestKeywordScore = totalScore;
        bestKeywordProg = prog;
        bestKeywordMatched = progMatchedKw;
      }
    }
  }
  // SPECIAL OVERRIDE: Zakat without FITRAH/FITRI → Penerimaan Dana Zakat (parent category)
  // Zakat is a special category; beneficiary words (YATIM, etc.) don't override it
  // Only override if current match is NOT already a specific Zakat program
  const ZAKAT_GENERIC_RE = /\b(?:zakat|zkt)\b/i;
  const FITRAH_RE = /\b(?:fitrah|fitri|fitr)\b/i;
  if (bestKeywordProg && ZAKAT_GENERIC_RE.test(normalizedLabel) && 
      !FITRAH_RE.test(normalizedLabel) &&
      bestKeywordProg.coaCode !== 40100103 && // not already Fitrah
      bestKeywordProg.coaCode !== 40100101 && // not already Maal
      bestKeywordProg.coaCode !== 40100000) { // not already parent
    const zakatParentProg = programs.find(p => p.coaCode === 40100000);
    if (zakatParentProg) {
      bestKeywordProg = zakatParentProg;
      bestKeywordMatched = 'ZAKAT';
    }
  }
  if (bestKeywordProg) {
    result.assignedCoa = bestKeywordProg.coaCode;
    result.assignedCoaName = coaList.find(c => c.code === bestKeywordProg.coaCode)?.name || '';
    result.assignedProgramId = bestKeywordProg.id;
    result.matchedLayer = 'KEYWORD';
    result.confidence = 0.90;
    result.reasoning = `Deskripsi cocok dengan kata kunci '${bestKeywordMatched}' pada program ${bestKeywordProg.name}`;
    return result;
  }
  
  // Layer 2.5: Campaign Tail Code fallback — no keyword matched, use tailCode
  if (tailMatchedProg) {
    result.assignedCoa = tailMatchedProg.coaCode;
    result.assignedCoaName = coaList.find(c => c.code === tailMatchedProg.coaCode)?.name || '';
    result.assignedProgramId = tailMatchedProg.id;
    result.matchedLayer = 'CAMPAIGN_TAIL';
    result.confidence = 0.90;
    result.reasoning = `Nominal berakhiran kode unik kampanye '${tailMatchedProg.tailCode}' untuk program ${tailMatchedProg.name}`;
    return result;
  }
  
  // Layer 3.5: Donor fallback — keyword didn't match, use donor default
  if (donorName) {
    result.assignedCoa = donorTargetCoa;
    result.assignedCoaName = coaList.find(c => c.code === donorTargetCoa)?.name || '';
    result.assignedProgramId = donorTargetProgram;
    result.matchedLayer = 'DONATUR_TETAP';
    result.confidence = 0.90;
    result.reasoning = `Pengirim terdaftar sebagai Donatur Tetap: ${donorName}`;
    return result;
  }
  
  // Layer 4.5: DONASI_UMUM / ZAKAT_WAKAF_UNAUTH — deterministic donation word catch
  // zakat & wakaf MUST have a specific COA — if no keyword matched, send to UNAUTHORIZED for review
  // all other donation words → Infak Umum
  const ZAKAT_WAKAF_RE = /\b(zakat|zkt|wakaf|waqaf)\b/i;
  const DONASI_UMUM_RE = /\b(donasi|sedekah|shadaqah|sodaqoh|sdkh|infaq?|amal|sumbangan|bantuan)\b/i;
  if (ZAKAT_WAKAF_RE.test(cleanedLabel) || ZAKAT_WAKAF_RE.test(rawLower)) {
    result.assignedCoa = defaultUnauthorizedCoa;
    result.assignedCoaName = coaList.find(c => c.code === defaultUnauthorizedCoa)?.name || '';
    result.assignedProgramId = null;
    result.matchedLayer = 'UNAUTHORIZED_FALLBACK';
    result.confidence = 0.0;
    result.reasoning = 'Transaksi zakat/wakaf tanpa kata kunci program spesifik — wajib diverifikasi manual';
    return result;
  }
  if (DONASI_UMUM_RE.test(cleanedLabel) || DONASI_UMUM_RE.test(rawLower)) {
    result.assignedCoa = defaultBaselineCoa;
    result.assignedCoaName = coaList.find(c => c.code === defaultBaselineCoa)?.name || '';
    result.assignedProgramId = null;
    result.matchedLayer = 'DONASI_UMUM';
    result.confidence = 0.80;
    result.reasoning = 'Terdeteksi kata donasi/sedekah/infaq tanpa kata kunci program spesifik (Infak Umum)';
    return result;
  }

  // Layer 5: Semantic AI Matcher
  const aiMode = (settings.aiMode || '').toUpperCase();
  if (aiMode !== 'OFF' && aiMode !== 'DISABLED' && cleanedLabel.trim()) {
    try {
      const singleContextOptions = {
        companyAliases: master.companyAliases || [],
        orgName: settings.orgName || 'Yayasan / Lembaga Amil Zakat',
        defaultBaselineCoa,
        defaultUnauthorizedCoa,
        donors: donors || []
      };
      const res = await classifySemanticBatchClient(
        [{ id: 'single_1', cleanedLabel }], programs, settings, false, singleContextOptions
      );
      const aiRes = res && res[0];
      if (aiRes && aiRes.confidence >= confidenceThreshold && aiRes.coa) {
        let matchedProgram = programs.find(p => p.id === aiRes.programId);
        let finalCoa = matchedProgram ? matchedProgram.coaCode : aiRes.coa;
        
        result.assignedCoa = finalCoa;
        result.assignedCoaName = coaList.find(c => c.code === finalCoa)?.name || '';
        result.assignedProgramId = matchedProgram ? matchedProgram.id : null;
        result.matchedLayer = 'AI_SEMANTIC';
        result.confidence = round4(aiRes.confidence);
        result.reasoning = aiRes.reason || `Rekomendasi AI semantik (${aiMode})`;
        return result;
      }
    } catch (e) {
      result.matchedLayer = '';
    }
  }

  // Fallback: Unauthorized (AI disabled or no match)
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
  const layerCounts = { EXPENSE: 0, CAMPAIGN_TAIL: 0, DONATUR_TETAP: 0, KEYWORD: 0, AI_SEMANTIC: 0, UNAUTHORIZED_FALLBACK: 0 };
  let resolvedCount = 0;
  
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
    const normalizedLabel = normalizeForMatch(cleanedLabel);

    // Layer 1: Expense — only negative amount or explicit "biaya" (transfer fee)
    if (tx.rawAmount < 0 || rawLower.includes('biaya')) {
      item.assignedCoa = expenseCoa;
      item.assignedCoaName = coaList.find(c => c.code === expenseCoa)?.name || '';
      item.assignedProgramId = null;
      item.matchedLayer = 'EXPENSE';
      item.confidence = 1.0;
      item.reasoning = 'Terdeteksi sebagai transaksi pengeluaran/beban (nominal negatif atau biaya operasional)';
      item.isExpense = true;
      results[i] = item;
      resolvedCount++;
      layerCounts.EXPENSE++;
      if (onProgress) onProgress(resolvedCount, rows.length, item, layerCounts);
      continue;
    }

    // Layer 2: Campaign Tail Code — DEFERRED like donor, keywords take priority
    const s = String(Math.trunc(Math.abs(tx.rawAmount)));
    let tailMatchedProg = null;
    for (const prog of programs) {
      if (prog.tailCode && s.endsWith(prog.tailCode) && s.length >= prog.tailCode.length) {
        tailMatchedProg = prog;
        break;
      }
    }

    // Layer 3: Donatur Tetap — donor match stored but NOT resolved (keywords take priority)
    let matchedDonor = null;
    let donorTargetCoa = 0;
    let donorTargetProgram = null;
    if (extractedSenderName) {
      const senderBare = stripHonorific(extractedSenderName).toLowerCase();
      const senderNameLower = extractedSenderName.toLowerCase();
      for (const donor of donors) {
        const donorBare = stripHonorific(donor.name).toLowerCase();
        const donorFull = donor.name.toLowerCase();
        if (
          donorBare === senderBare ||
          donorFull === senderNameLower ||
          matchDonorTokens(senderBare, donorBare)
        ) {
          matchedDonor = donor;
          break;
        }
      }
      if (matchedDonor) {
        if (matchedDonor.defaultProgramId) {
          const prog = programs.find(p => p.id === matchedDonor.defaultProgramId);
          donorTargetCoa = prog ? prog.coaCode : defaultBaselineCoa;
          donorTargetProgram = prog ? prog.id : null;
        } else {
          donorTargetCoa = matchedDonor.defaultCoa || 0;
          donorTargetProgram = null;
        }
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
        const allKw = [...(prog.keywords || []), ...(prog.hiddenKeywords || [])];
        for (const k of allKw) {
          const ktrimmed = normalizeForMatch(k?.trim());
          if (ktrimmed && normalizedLabel.includes(ktrimmed)) {
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
        resolvedCount++;
        layerCounts.DONATUR_TETAP++; // ORG_ALIAS counted in standard layers
        if (onProgress) onProgress(resolvedCount, rows.length, item, layerCounts);
        continue;
      }
      // Donor block - remove keyword override loop, use donor default program directly
      // Fall through to normal classification after this block
    }

    // Layer 4: Keywords — weighted scoring (highest score wins)
    // score = program.priority * 10 + sum of matched keyword lengths
    // Both regular keywords and hiddenKeywords (AI-generated typo/synonym variants) are included
    // Specific keywords (longer, higher-priority programs) beat generic ones
    let bestKeywordProg = null;
    let bestKeywordScore = 0;
    let bestKeywordMatched = '';
    for (const prog of programs) {
      const allKeywords = [...(prog.keywords || []), ...(prog.hiddenKeywords || [])];
      const progPriority = prog.priority || 5;
      let progScore = 0;
      let progMatchedKw = '';
      for (const k of allKeywords) {
        const ktrimmed = normalizeForMatch(k?.trim());
        if (ktrimmed && normalizedLabel.includes(ktrimmed)) {
          const kwScore = ktrimmed.length;
          if (kwScore > progScore) {
            progScore = kwScore;
            progMatchedKw = ktrimmed;
          }
        }
      }
      if (progScore > 0) {
        const totalScore = progPriority * 10 + progScore;
        if (totalScore > bestKeywordScore) {
          bestKeywordScore = totalScore;
          bestKeywordProg = prog;
          bestKeywordMatched = progMatchedKw;
        }
      }
    }
    // SPECIAL OVERRIDE: Zakat without FITRAH/FITRI → Penerimaan Dana Zakat (parent)
    // Zakat is a special category; beneficiary words (YATIM, etc.) don't override it
    // Only override if current match is NOT already a specific Zakat program
    const ZAKAT_GENERIC_RE_BATCH = /\b(?:zakat|zkt)\b/i;
    const FITRAH_RE_BATCH = /\b(?:fitrah|fitri|fitr)\b/i;
    if (bestKeywordProg && ZAKAT_GENERIC_RE_BATCH.test(normalizedLabel) && 
        !FITRAH_RE_BATCH.test(normalizedLabel) &&
        bestKeywordProg.coaCode !== 40100103 && // not already Fitrah
        bestKeywordProg.coaCode !== 40100101 && // not already Maal
        bestKeywordProg.coaCode !== 40100000) { // not already parent
    const zakatParentProg = programs.find(p => p.coaCode === 40100000);
    if (zakatParentProg) {
      bestKeywordProg = zakatParentProg;
      bestKeywordMatched = 'ZAKAT';
    }
    }

    if (bestKeywordProg) {
      item.assignedCoa = bestKeywordProg.coaCode;
      item.assignedCoaName = coaList.find(c => c.code === bestKeywordProg.coaCode)?.name || '';
      item.assignedProgramId = bestKeywordProg.id;
      item.matchedLayer = 'KEYWORD';
      item.confidence = 0.90;
      item.reasoning = `Deskripsi cocok dengan kata kunci '${bestKeywordMatched}' pada program ${bestKeywordProg.name}`;
      results[i] = item;
      resolvedCount++;
      layerCounts.KEYWORD++;
      if (onProgress) onProgress(resolvedCount, rows.length, item, layerCounts);
      continue;
    }

    // Layer 2.5: Campaign Tail Code fallback — no keyword matched, use tailCode
    if (tailMatchedProg) {
      item.assignedCoa = tailMatchedProg.coaCode;
      item.assignedCoaName = coaList.find(c => c.code === tailMatchedProg.coaCode)?.name || '';
      item.assignedProgramId = tailMatchedProg.id;
      item.matchedLayer = 'CAMPAIGN_TAIL';
      item.confidence = 0.90;
      item.reasoning = `Nominal berakhiran kode unik kampanye '${tailMatchedProg.tailCode}' untuk program ${tailMatchedProg.name}`;
      results[i] = item;
      resolvedCount++;
      layerCounts.CAMPAIGN_TAIL++;
      if (onProgress) onProgress(resolvedCount, rows.length, item, layerCounts);
      continue;
    }

    // Layer 3.5: Donor fallback — if donor was found but keyword didn't match,
    // use donor's default. This means keyword explicitly overrides donor default.
    if (matchedDonor) {
      item.assignedCoa = donorTargetCoa;
      item.assignedCoaName = coaList.find(c => c.code === donorTargetCoa)?.name || '';
      item.assignedProgramId = donorTargetProgram;
      item.matchedLayer = 'DONATUR_TETAP';
      item.confidence = 0.90;
      item.reasoning = `Pengirim terdaftar sebagai Donatur Tetap: ${matchedDonor.name}`;
      results[i] = item;
      resolvedCount++;
      layerCounts.DONATUR_TETAP++;
      if (onProgress) onProgress(resolvedCount, rows.length, item, layerCounts);
      continue;
    }

    // Layer 4.5: DONASI_UMUM / ZAKAT_WAKAF_UNAUTH — deterministic donation word catch
    // Use same regex as classifySingle for consistent single-vs-batch behavior
    const ZAKAT_WAKAF_RE = /\b(zakat|zkt|wakaf|waqaf)\b/i;
    const DONASI_UMUM_RE = /\b(donasi|sedekah|shadaqah|sodaqoh|sdkh|infaq?|amal|sumbangan|bantuan)\b/i;
    if (ZAKAT_WAKAF_RE.test(cleanedLabel) || ZAKAT_WAKAF_RE.test(rawLower)) {
      item.assignedCoa = defaultUnauthorizedCoa;
      item.assignedCoaName = coaList.find(c => c.code === defaultUnauthorizedCoa)?.name || '';
      item.assignedProgramId = null;
      item.matchedLayer = 'UNAUTHORIZED_FALLBACK';
      item.confidence = 0.0;
      item.reasoning = 'Transaksi zakat/wakaf tanpa kata kunci program spesifik — wajib diverifikasi manual';
      results[i] = item;
      resolvedCount++;
      layerCounts.UNAUTHORIZED_FALLBACK++;
      if (onProgress) onProgress(resolvedCount, rows.length, item, layerCounts);
      continue;
    }
    if (DONASI_UMUM_RE.test(cleanedLabel) || DONASI_UMUM_RE.test(rawLower)) {
      item.assignedCoa = defaultBaselineCoa;
      item.assignedCoaName = coaList.find(c => c.code === defaultBaselineCoa)?.name || '';
      item.assignedProgramId = null;
      item.matchedLayer = 'DONASI_UMUM';
      item.confidence = 0.80;
      item.reasoning = 'Terdeteksi kata donasi/sedekah/infaq tanpa kata kunci program spesifik (Infak Umum)';
      results[i] = item;
      resolvedCount++;
      layerCounts.KEYWORD++;
      if (onProgress) onProgress(resolvedCount, rows.length, item, layerCounts);
      continue;
    }

    // Collect for Layer 5 AI
    results[i] = item;
    needsAiIndices.push(i);
  }

  // Phase 2: Micro-Batch Layer 5 AI Execution
  if (needsAiIndices.length > 0) {
    if (aiMode !== 'OFF' && aiMode !== 'DISABLED') {
      const chunkSize = (aiMode === 'LOCAL_OLLAMA' || aiMode === 'OLLAMA' || aiMode === 'CUSTOM_OPENAI') ? 5 : 15;
      for (let chunkStart = 0; chunkStart < needsAiIndices.length; chunkStart += chunkSize) {
        const chunkIndices = needsAiIndices.slice(chunkStart, chunkStart + chunkSize);
        const chunkItems = chunkIndices.map(idx => results[idx]);

        try {
          const contextOptions = {
            companyAliases: master.companyAliases || [],
            orgName: settings.orgName || 'Yayasan / Lembaga Amil Zakat',
            defaultBaselineCoa,
            defaultUnauthorizedCoa,
            donors: donors || []
          };
          const aiBatchResults = await classifySemanticBatchClient(chunkItems, programs, settings, false, contextOptions);

          for (let cPos = 0; cPos < chunkIndices.length; cPos++) {
            const origIdx = chunkIndices[cPos];
            const it = results[origIdx];
            const aiRes = aiBatchResults && aiBatchResults[cPos];

            if (aiRes && aiRes.confidence >= confidenceThreshold && aiRes.coa) {
              const matchedProgram = programs.find(p => p.id === aiRes.programId);
              const finalCoa = matchedProgram ? matchedProgram.coaCode : aiRes.coa;

              it.assignedCoa = finalCoa;
              it.assignedCoaName = coaList.find(c => c.code === finalCoa)?.name || (finalCoa === defaultBaselineCoa ? 'Penerimaan Infak & Sedekah - Umum' : '');
              it.assignedProgramId = matchedProgram ? matchedProgram.id : null;
              it.matchedLayer = 'AI_SEMANTIC';
              it.confidence = round4(aiRes.confidence);
              it.reasoning = aiRes.reason || `Rekomendasi AI semantik (${aiMode})`;
              layerCounts.AI_SEMANTIC++;
            } else {
              it.assignedCoa = defaultUnauthorizedCoa;
              it.assignedCoaName = coaList.find(c => c.code === defaultUnauthorizedCoa)?.name || '';
              it.assignedProgramId = null;
              it.matchedLayer = 'UNAUTHORIZED_FALLBACK';
              it.confidence = aiRes ? round4(aiRes.confidence) : 0.0;
              it.reasoning = aiRes?.reason || 'Tidak ditemukan kata kunci atau kepastian AI (Karantina Mutasi Buta / Unauthorized)';
              layerCounts.UNAUTHORIZED_FALLBACK++;
            }

            resolvedCount++;
            if (onProgress) onProgress(resolvedCount, rows.length, it, layerCounts);
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
            layerCounts.UNAUTHORIZED_FALLBACK++;
            resolvedCount++;
            if (onProgress) onProgress(resolvedCount, rows.length, it, layerCounts);
          }
        }
      }
    } else {
      // AI is DISABLED — route unmatched rows to Unauthorized for manual review
      for (const origIdx of needsAiIndices) {
        const it = results[origIdx];
        it.assignedCoa = defaultUnauthorizedCoa;
        it.assignedCoaName = coaList.find(c => c.code === defaultUnauthorizedCoa)?.name || '';
        it.assignedProgramId = null;
        it.matchedLayer = 'UNAUTHORIZED_FALLBACK';
        it.confidence = 0.0;
        it.reasoning = 'Modul AI nonaktif dan tidak ditemukan kata kunci — perlu review manual (Unauthorized)';
        layerCounts.UNAUTHORIZED_FALLBACK++;
        resolvedCount++;
        if (onProgress) onProgress(resolvedCount, rows.length, it, layerCounts);
      }
    }
  }

  return results;
}
