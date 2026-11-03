/**
 * Deterministic ZISWAF transaction resolver with optional AI fallback.
 * Single and batch classification intentionally share the same resolver.
 */
import { cleanTransactionText, normalizeForMatch } from "./sanitizer.js";
import { classifySemanticBatchClient } from "./ai_matcher.js";

const HONORIFIC_RE = /^\s*(?:bapak|pak|ibu|bu|dr\.?|drs\.?|prof\.?|hj?\.?|ustaz(?:ah)?|ust\.?|kh\.?|mrs?\.?|miss|ms\.?)\s+/i;
const ZAKAT_RE = /(?:^|[^a-z0-9])(?:zakat|zkt)(?=$|[^a-z0-9])/i;
const WAKAF_RE = /(?:^|[^a-z0-9])wakaf(?=$|[^a-z0-9])/i;
// A restricted fund (ZAKAT/WAKAF COA) may only be chosen when the text itself carries that signal.
const FUND_SIGNAL = {
  ZAKAT: /(?:^|[^a-z0-9])(?:zakat|zkt|fitrah|maal)(?=$|[^a-z0-9])/i,
  WAKAF: /(?:^|[^a-z0-9])(?:wakaf|wkf)(?=$|[^a-z0-9])/i
};
const DONATION_RE = /(?:^|[^a-z0-9])(?:donasi|sedekah|shodaqoh|shadaqah|sodaqoh|sdkh|infaq|infak|amal|sumbangan|bantuan)(?=$|[^a-z0-9])/i;
const EXPLICIT_EXPENSE_RE = /(?:^|[^a-z0-9])(?:biaya\s+admin(?:istrasi)?|admin\s+bank|bank\s+charge|fee\s+transfer|beban\s+bank)(?=$|[^a-z0-9])/i;
const NO_MATCH_REASON = 'Tidak ditemukan aturan deterministik; transaksi perlu ditinjau manual.';

const round4 = value => Math.round(value * 10000) / 10000;

function stripHonorific(name) {
  let value = String(name || '').trim();
  let previous;
  do { previous = value; value = value.replace(HONORIFIC_RE, '').trim(); } while (value !== previous);
  return value;
}

function matchDonorTokens(sender, donor) {
  const senderTokens = sender.split(/\s+/).filter(Boolean);
  const donorTokens = donor.split(/\s+/).filter(Boolean);
  if (!senderTokens.length || !donorTokens.length) return false;
  if (![...senderTokens, ...donorTokens].some(token => token.length >= 4)) return false;
  return senderTokens.every(token => donorTokens.includes(token))
    || donorTokens.every(token => senderTokens.includes(token));
}

function normalizeEvidence(value) {
  return normalizeForMatch(value).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function containsPhrase(haystack, phrase) {
  return Boolean(haystack && phrase && (` ${haystack} `).includes(` ${phrase} `));
}

function accountName(master, code) {
  return master.coaList.find(coa => Number(coa.code) === Number(code))?.name || '';
}

function baseResult(tx, master) {
  const sanitized = cleanTransactionText(tx.rawLabel, master.companyAliases || []);
  return {
    ...tx,
    transactionDate: tx.transactionDate || tx.rawDate,
    cleanedLabel: sanitized.cleanedLabel,
    extractedSenderName: sanitized.extractedSenderName,
    companyAliasMatched: sanitized.companyAliasMatched,
    assignedCoa: 0,
    assignedCoaName: '',
    assignedProgramId: null,
    matchedLayer: '',
    confidence: 0,
    reasoning: '',
    evidence: null,
    isExpense: false,
    isOverridden: false
  };
}

function assign(result, master, { coa, program = null, layer, confidence, reasoning, evidence = null, isExpense = false }) {
  result.assignedCoa = coa;
  result.assignedCoaName = accountName(master, coa);
  result.assignedProgramId = program?.id || null;
  result.matchedLayer = layer;
  result.confidence = round4(confidence);
  result.reasoning = reasoning;
  result.evidence = evidence;
  result.isExpense = isExpense;
  return result;
}

function quarantine(result, master, reasoning, evidence = null) {
  return assign(result, master, {
    coa: master.settings.defaultUnauthorizedCoa,
    layer: 'UNAUTHORIZED_FALLBACK',
    confidence: 0,
    reasoning,
    evidence
  });
}

function findDonorDecision(senderName, donors) {
  if (!senderName) return { donor: null, conflict: [] };
  const senderFull = normalizeEvidence(senderName);
  const senderBare = normalizeEvidence(stripHonorific(senderName));
  const candidates = (donors || []).map(donor => {
    const donorFull = normalizeEvidence(donor.name);
    const donorBare = normalizeEvidence(stripHonorific(donor.name));
    const exact = donorFull === senderFull || donorBare === senderBare;
    const partial = !exact && matchDonorTokens(senderBare, donorBare);
    return { donor, score: exact ? 2 : partial ? 1 : 0 };
  }).filter(candidate => candidate.score > 0);
  if (!candidates.length) return { donor: null, conflict: [] };
  const bestScore = Math.max(...candidates.map(candidate => candidate.score));
  const best = candidates.filter(candidate => candidate.score === bestScore);
  return best.length === 1
    ? { donor: best[0].donor, conflict: [] }
    : { donor: null, conflict: best.map(candidate => candidate.donor) };
}

const FUZZY_MIN_LENGTH = 6;

/** True when a and b differ by at most one insertion, deletion, substitution or adjacent swap. */
export function editDistanceAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // substitution
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // swap
  }
  const [longer, shorter] = a.length > b.length ? [a, b] : [b, a];
  return longer.slice(i + 1) === shorter.slice(i); // insertion/deletion
}

function programPriority(program) {
  return Number.isFinite(Number(program.priority)) ? Number(program.priority) : 5;
}

function programKeywords(program) {
  return [...(program.keywords || []), ...(program.hiddenKeywords || [])].map(normalizeEvidence).filter(Boolean);
}

/** Fallback when nothing matches exactly: single long keyword tokens tolerate one typo. */
function findFuzzyCandidates(label, programs) {
  const labelTokens = [...new Set(label.split(' ').filter(token => token.length >= FUZZY_MIN_LENGTH))];
  const candidates = [];
  if (!labelTokens.length) return candidates;
  for (const program of programs || []) {
    let bestKeyword = '';
    for (const keyword of programKeywords(program)) {
      if (keyword.length < FUZZY_MIN_LENGTH || keyword.includes(' ') || keyword.length <= bestKeyword.length) continue;
      if (labelTokens.some(token => editDistanceAtMostOne(token, keyword))) bestKeyword = keyword;
    }
    if (bestKeyword) {
      const priority = programPriority(program);
      candidates.push({ program, keyword: bestKeyword, priority, score: priority * 10000 + bestKeyword.length, fuzzy: true });
    }
  }
  return candidates;
}

function findKeywordDecision(label, programs) {
  let candidates = [];
  for (const program of programs || []) {
    let bestKeyword = '';
    for (const normalizedKeyword of programKeywords(program)) {
      if (containsPhrase(label, normalizedKeyword) && normalizedKeyword.length > bestKeyword.length) bestKeyword = normalizedKeyword;
    }
    if (bestKeyword) {
      const priority = programPriority(program);
      candidates.push({ program, keyword: bestKeyword, priority, score: priority * 10000 + bestKeyword.length });
    }
  }
  if (!candidates.length) candidates = findFuzzyCandidates(label, programs);
  candidates.sort((a, b) => b.score - a.score || a.program.id.localeCompare(b.program.id));
  if (!candidates.length) return { candidate: null, conflict: [] };
  const conflict = candidates.filter(candidate => candidate.score === candidates[0].score);
  return { candidate: conflict.length === 1 ? candidates[0] : null, conflict };
}

function categoryForCoa(master, code) {
  return String(master.coaList.find(coa => Number(coa.code) === Number(code))?.category || '').toUpperCase();
}

/** Runs layers 0–4. A blank matchedLayer means the row is eligible for AI. */
export function classifyDeterministic(tx, master) {
  const result = baseResult(tx, master);
  const programs = master.programs || [];
  const normalizedLabel = normalizeEvidence(result.cleanedLabel);
  const normalizedRaw = normalizeEvidence(tx.rawLabel);
  const amount = Number(tx.rawAmount) || 0;

  if (amount === 0) {
    return quarantine(result, master, 'Nominal transaksi tidak valid atau nol; perlu ditinjau manual.', {
      type: 'invalid_amount', value: tx.rawAmount ?? null
    });
  }
  if (amount < 0 || EXPLICIT_EXPENSE_RE.test(normalizedRaw)) {
    return assign(result, master, {
      coa: master.settings.expenseCoa,
      layer: 'EXPENSE',
      confidence: 1,
      reasoning: amount < 0 ? 'Nominal transaksi negatif (uang keluar).' : 'Keterangan memuat biaya administrasi bank yang eksplisit.',
      evidence: { type: amount < 0 ? 'negative_amount' : 'explicit_bank_fee', value: amount < 0 ? amount : normalizedRaw },
      isExpense: true
    });
  }

  const amountDigits = String(Math.trunc(Math.abs(amount)));
  const tailMatches = programs.filter(program => program.tailCode
    && amountDigits.length >= String(program.tailCode).length
    && amountDigits.endsWith(String(program.tailCode)));
  if (tailMatches.length > 1) {
    return quarantine(result, master, `Kode ekor nominal cocok dengan beberapa program: ${tailMatches.map(p => p.name).join(', ')}.`, {
      type: 'tail_conflict', value: tailMatches.map(p => p.id)
    });
  }
  const keywordDecision = findKeywordDecision(normalizedLabel, programs);
  if (tailMatches.length === 1) {
    const program = tailMatches[0];
    const keywordProgram = keywordDecision.candidate && !keywordDecision.candidate.fuzzy ? keywordDecision.candidate.program : undefined;
    // The approved order keeps the tail code decisive; a contradicting keyword only lowers confidence
    // and is recorded so reviewers can filter these rows.
    const contradicted = Boolean(keywordProgram && keywordProgram.id !== program.id);
    return assign(result, master, {
      coa: program.coaCode, program, layer: 'CAMPAIGN_TAIL',
      confidence: contradicted ? 0.8 : keywordProgram ? 0.97 : 0.95,
      reasoning: `Nominal berakhiran kode unik '${program.tailCode}' untuk program ${program.name}.`
        + (contradicted ? ` Peringatan: kata kunci '${keywordDecision.candidate.keyword}' mengarah ke program ${keywordProgram.name}; mohon periksa.` : ''),
      evidence: contradicted
        ? { type: 'tail_code', value: program.tailCode, contradictedByKeywordProgramId: keywordProgram.id }
        : { type: 'tail_code', value: program.tailCode }
    });
  }

  const donorDecision = findDonorDecision(result.extractedSenderName, master.donors || []);
  if (donorDecision.conflict.length > 1) {
    return quarantine(result, master, `Nama pengirim cocok dengan beberapa donatur: ${donorDecision.conflict.map(item => item.name).join(', ')}.`, {
      type: 'donor_conflict', value: donorDecision.conflict.map(item => item.id)
    });
  }
  const donor = donorDecision.donor;
  const donorProgram = donor ? programs.find(item => item.id === donor.defaultProgramId) || null : null;
  const donorCoa = donor ? donorProgram?.coaCode || donor.defaultCoa || master.settings.defaultBaselineCoa : 0;
  const donorCategory = categoryForCoa(master, donorCoa);
  // A zakat/wakaf-labelled transfer must not be auto-filed under a donor's non-matching default program.
  const donorFundConflict = Object.keys(FUND_SIGNAL).some(key => FUND_SIGNAL[key].test(normalizedLabel) && donorCategory !== key);
  if (donor && !donorFundConflict) {
    const program = donorProgram;
    const coa = donorCoa;
    return assign(result, master, {
      coa, program, layer: 'DONATUR_TETAP', confidence: 0.9,
      reasoning: `Pengirim cocok dengan donatur terdaftar: ${donor.name}.`,
      evidence: { type: 'donor', value: donor.id }
    });
  }

  if (keywordDecision.conflict.length > 1) {
    return quarantine(result, master, `Kata kunci memiliki skor sama pada beberapa program: ${keywordDecision.conflict.map(c => c.program.name).join(', ')}.`, {
      type: 'keyword_conflict', value: keywordDecision.conflict.map(c => ({ programId: c.program.id, keyword: c.keyword, score: c.score }))
    });
  }
  if (keywordDecision.candidate) {
    const { program, keyword, score, fuzzy } = keywordDecision.candidate;
    const category = categoryForCoa(master, program.coaCode);
    if (ZAKAT_RE.test(normalizedLabel) && category !== 'ZAKAT') {
      return quarantine(result, master, `Keterangan menyebut zakat tetapi program '${program.name}' bukan akun zakat.`, {
        type: 'fund_category_conflict', value: { signal: 'zakat', programId: program.id }
      });
    }
    if (WAKAF_RE.test(normalizedLabel) && category !== 'WAKAF') {
      return quarantine(result, master, `Keterangan menyebut wakaf tetapi program '${program.name}' bukan akun wakaf.`, {
        type: 'fund_category_conflict', value: { signal: 'wakaf', programId: program.id }
      });
    }
    const signal = FUND_SIGNAL[category];
    if (signal && !signal.test(normalizedLabel) && !signal.test(keyword)) {
      return quarantine(result, master, `Kata kunci '${keyword}' mengarah ke dana ${category.toLowerCase()} terikat, tetapi keterangan tidak menyebut jenis dana tersebut.`, {
        type: 'restricted_keyword_without_signal', value: { programId: program.id, keyword, category }
      });
    }
    return assign(result, master, {
      coa: program.coaCode, program, layer: 'KEYWORD', confidence: fuzzy ? 0.8 : 0.9,
      reasoning: fuzzy
        ? `Keterangan mirip kata kunci '${keyword}' (selisih satu huruf) pada program ${program.name}.`
        : `Keterangan cocok dengan kata kunci '${keyword}' pada program ${program.name}.`,
      evidence: fuzzy ? { type: 'keyword', value: keyword, score, fuzzy: true } : { type: 'keyword', value: keyword, score }
    });
  }

  const alias = (master.companyAliases || []).find(item => containsPhrase(normalizedRaw, normalizeEvidence(item)));
  if (alias) {
    return assign(result, master, {
      coa: master.settings.defaultBaselineCoa, layer: 'ORG_ALIAS', confidence: 0.9,
      reasoning: 'Keterangan memuat alias lembaga tanpa program khusus; dialokasikan ke akun baseline.',
      evidence: { type: 'organization_alias', value: alias }
    });
  }

  if (ZAKAT_RE.test(normalizedLabel) || WAKAF_RE.test(normalizedLabel)) {
    return quarantine(result, master, 'Transaksi zakat/wakaf tidak memiliki tujuan program yang cukup spesifik.', {
      type: 'restricted_fund_without_program', value: normalizedLabel
    });
  }
  if (DONATION_RE.test(normalizedLabel)) {
    return assign(result, master, {
      coa: master.settings.defaultBaselineCoa, layer: 'DONASI_UMUM', confidence: 0.8,
      reasoning: 'Keterangan memuat istilah donasi umum tanpa program khusus.',
      evidence: { type: 'generic_donation', value: normalizedLabel }
    });
  }
  return result;
}

function aiEnabled(settings) {
  const mode = String(settings.aiMode || '').toUpperCase();
  return mode !== 'OFF' && mode !== 'DISABLED' && mode !== '';
}

function aiContext(master) {
  return {
    companyAliases: master.companyAliases || [],
    orgName: master.settings.orgName || 'Yayasan / Lembaga Amil Zakat',
    defaultBaselineCoa: master.settings.defaultBaselineCoa,
    defaultUnauthorizedCoa: master.settings.defaultUnauthorizedCoa
  };
}

function applyAiResult(result, aiResult, master) {
  const threshold = Number(master.settings.confidenceThreshold) || 0.8;
  if (aiResult && aiResult.confidence >= threshold && aiResult.coa) {
    const program = (master.programs || []).find(item => item.id === aiResult.programId) || null;
    const coa = program?.coaCode || aiResult.coa;
    return assign(result, master, {
      coa, program, layer: 'AI_SEMANTIC', confidence: aiResult.confidence,
      reasoning: aiResult.reason || `Rekomendasi AI semantik (${master.settings.aiMode}).`,
      evidence: {
        type: 'ai',
        value: {
          provider: aiResult.provider || master.settings.aiMode,
          model: aiResult.model || master.settings.aiModelName || null,
          fingerprint: aiResult.fingerprint || null,
          status: aiResult.status || 'accepted_candidate',
          programId: aiResult.programId || null
        }
      }
    });
  }
  return quarantine(
    result,
    master,
    aiResult?.reason || 'Tidak ditemukan aturan deterministik atau rekomendasi AI yang cukup yakin.',
    aiResult ? { type: 'ai_rejected', value: { status: aiResult.status || 'no_match', provider: aiResult.provider, model: aiResult.model } } : null
  );
}

export async function classifySingle(tx, master) {
  const deterministic = classifyDeterministic(tx, master);
  if (deterministic.matchedLayer) return deterministic;
  if (!aiEnabled(master.settings) || !deterministic.cleanedLabel.trim()) {
    return quarantine(deterministic, master, NO_MATCH_REASON);
  }
  try {
    const [aiResult] = await classifySemanticBatchClient([deterministic], master.programs || [], master.settings, false, aiContext(master));
    return applyAiResult(deterministic, aiResult, master);
  } catch (error) {
    return quarantine(deterministic, master, `Gagal menghubungi AI: ${error.message}`);
  }
}

export async function classifyBatch(rows, master, onProgress) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const results = rows.map(row => classifyDeterministic(row, master));
  const pending = [];
  const layerCounts = {};
  let completed = 0;
  const report = result => {
    layerCounts[result.matchedLayer] = (layerCounts[result.matchedLayer] || 0) + 1;
    completed += 1;
    if (onProgress) onProgress(completed, rows.length, result, { ...layerCounts });
  };
  results.forEach((result, index) => result.matchedLayer ? report(result) : pending.push(index));
  if (!pending.length) return results;

  if (!aiEnabled(master.settings)) {
    for (const index of pending) {
      results[index] = quarantine(results[index], master, NO_MATCH_REASON);
      report(results[index]);
    }
    return results;
  }

  const chunkSize = 1;
  for (let start = 0; start < pending.length; start += chunkSize) {
    const indices = pending.slice(start, start + chunkSize);
    try {
      const aiResults = await classifySemanticBatchClient(indices.map(index => results[index]), master.programs || [], master.settings, false, aiContext(master));
      indices.forEach((index, offset) => {
        results[index] = applyAiResult(results[index], aiResults?.[offset], master);
        report(results[index]);
      });
    } catch (error) {
      for (const index of indices) {
        results[index] = quarantine(results[index], master, `Gagal menghubungi AI: ${error.message}`);
        report(results[index]);
      }
    }
  }
  return results;
}
