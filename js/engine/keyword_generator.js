/**
 * AI Keyword Generator Engine for ZISWAF Program Analysis
 * Detects collisions, generates typo/synonym/abbreviation variants,
 * and respects COA hierarchy for keyword quality assessment.
 */

import { callGemini, callOpenAICompatible, callOllama, cleanJsonResponse, fetchWithTimeout } from "./ai_matcher.js";

/**
 * Generates typo/synonym/abbreviation variants for a keyword.
 * Returns up to 10 variants with edit distance ≤ 2 (approximate).
 */
export function generateVariants(keyword) {
  const variants = new Set();

  // Add the original keyword (upper and lower case)
  const upper = keyword.toUpperCase();
  const lower = keyword.toLowerCase();
  variants.add(upper);
  variants.add(lower);

  // --- Indonesian typo variants ---
  const typoVariants = [];

  // Transposition: swap adjacent characters
  for (let i = 0; i < keyword.length - 1; i++) {
    const swapped = keyword.slice(0, i) + keyword[i + 1] + keyword[i] + keyword.slice(i + 2);
    if (swapped !== keyword) typoVariants.push(swapped);
  }

  // Duplication: repeat a character
  for (let i = 0; i < keyword.length; i++) {
    const duplicated = keyword.slice(0, i) + keyword[i] + keyword.slice(i);
    if (duplicated !== keyword) typoVariants.push(duplicated);
  }

  // Omission: remove a character
  for (let i = 0; i < keyword.length; i++) {
    const omitted = keyword.slice(0, i) + keyword.slice(i + 1);
    if (omitted !== keyword) typoVariants.push(omitted);
  }

  // Substitution: replace a character with a common Indonesian substitute
  const substitutes = {
    'a': ['a', 'e'], 'e': ['e', 'a'], 'i': ['i', 'y'], 'o': ['o', 'u'],
    'u': ['u', 'o'], 'c': ['c', 'k'], 'k': ['k', 'c'],
    's': ['s', 'z'], 'z': ['z', 's'],
  };
  for (let i = 0; i < keyword.length; i++) {
    const char = keyword[i].toLowerCase();
    if (substitutes[char]) {
      const subOptions = substitutes[char];
      for (const sub of subOptions) {
        const substituted = keyword.slice(0, i) + sub + keyword.slice(i + 1);
        if (substituted !== keyword) typoVariants.push(substituted);
      }
    }
  }

  for (const v of typoVariants) {
    variants.add(v.toUpperCase());
    variants.add(v.toLowerCase());
  }

  // --- Common ZISWAF abbreviations/synonyms ---
  const abbreviationMap = {
    'PEMBANGUNAN': ['PEMB', 'PENGHBGNAN'],
    'PEMB': ['PEMBANGUNAN'],
    'ALQURAN': ['ALQURAN', 'AL-QURAN', 'QURAN', 'KORAN', 'ALQUR'],
    'QURAN': ['ALQURAN', 'KORAN', 'AL-QURAN'],
    'WAKAF': ['WAQF', 'WAQF', 'WAKF', 'WQAF'],
    'INFAQ': ['INFQ', 'INFAK'],
    'SEDEKAH': ['SODAQOH', 'SHADAQAH', 'SODAH'],
    'ZAKAT': ['ZAKAH', 'ZKT', 'ZAK'],
    'FITRAH': ['FITROH', 'FITRI'],
    'SUBUH': ['SUBUH', 'SUBUH'],
    'PENGHAfal': ['PNGHL', 'PNGHAFAL'],
    'PNGHL': ['PENGHAfal'],
    'LQURAN': ['ALQURAN'],
  };

  const upperKeyword = keyword.toUpperCase();
  if (abbreviationMap[upperKeyword]) {
    for (const abbr of abbreviationMap[upperKeyword]) {
      variants.add(abbr);
      variants.add(abbr.toLowerCase());
    }
  }

  // --- Common synonyms in ZISWAF context ---
  const synonymMap = {
    'ZAKAT': ['INFAK', 'SEDEKAH', 'AMAL'],
    'WAKAF': ['WAQF', 'WAQF PRODUKTIF', 'SERTAFAK'],
    'INFAQ': ['ZAKAT', 'SEDEKAH', 'AMAL'],
    'SEDEKAH': ['INFAK', 'ZAKAT', 'AMAL SEDIA'],
    'AMAL': ['INFAK', 'SEDEKAH', 'ZAKAT'],
  };

  const upperSyn = keyword.toUpperCase();
  if (synonymMap[upperSyn]) {
    for (const syn of synonymMap[upperSyn]) {
      variants.add(syn);
      variants.add(syn.toLowerCase());
    }
  }

  // Filter: only keep variants with length > 0 and ≤ original length + 2
  // Then limit to 10 total (excluding the original which is already included)
  const filtered = Array.from(variants)
    .filter(v => v.length > 0 && v.length <= keyword.length + 2)
    .slice(0, 10);

  return filtered;
}

/**
 * Normalizes a keyword for collision detection:
 * - Uppercases, removes special chars, canonicalizes known variants
 */
function normalizeKeyword(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/'/g, '').replace(/’/g, '')
    .replace(/\bWAQAF\b/g, 'WAKAF')
    .replace(/\bWAQF\b/g, 'WAKAF')
    .replace(/\bWAAKAF\b/g, 'WAKAF')
    .replace(/\bWAKF\b/g, 'WAKAF')
    .replace(/\bMESJID\b/gi, 'MASJID')
    .replace(/\bMASJIT\b/gi, 'MASJID')
    .replace(/ALQURAN/g, 'AL QURAN')
    .replace(/AL-QURAN\b/g, 'AL QURAN')
    .replace(/\bQUR'?AN\b/g, 'QURAN')
    .replace(/\bAL QURAN/g, 'ALQURAN')
    .replace(/\bJUM'AT\b/g, 'JUMAT')
    .replace(/JUMAT\b/g, 'JUMAT')
    .replace(/JUM'AT/g, 'JUMAT')
    .replace(/\bSEDQOH\b/g, 'SHODAQOH')
    .replace(/\bSODAQOH\b/g, 'SHODAQOH')
    .replace(/\bSHADAQAH\b/g, 'SHODAQOH')
    .replace(/\bSADAQAH\b/g, 'SHODAQOH')
    .replace(/\bSADAQOH\b/g, 'SHODAQOH')
    .replace(/\bINFQ\b/g, 'INFAQ')
    .replace(/\bINFAK\b/g, 'INFAQ')
    .replace(/\bFIDYA\b/g, 'FIDYAH')
    .replace(/\bKURBAN\b/g, 'QURBAN')
    .replace(/\bZAKAH\b/g, 'ZAKAT')
    .replace(/\bQURBAN\b/g, 'QURBAN')
    .replace(/\bIFTAR\b/g, 'IFTOR')
    .replace(/\bIFTHAR\b/g, 'IFTOR')
    .replace(/\bFITROH\b/g, 'FITRAH')
    .replace(/\bPEMB\b/g, 'PEMBANGUNAN')
    .toLowerCase();
}

/**
 * Builds the COA hierarchy map from programs.
 * Maps parentCoaCode -> array of child program info.
 */
function buildHierarchyMap(programs) {
  const hierarchy = {};
  for (const p of programs || []) {
    const parentCode = p.parentCoaCode;
    if (parentCode) {
      if (!hierarchy[parentCode]) {
        hierarchy[parentCode] = [];
      }
      hierarchy[parentCode].push({
        id: p.id,
        coaCode: p.coaCode,
        name: p.name,
      });
    }
  }
  return hierarchy;
}

/**
 * Checks if a normalized keyword is "generic" (ZAKAT, WAKAF, INFAQ, SEDEKAH)
 * that should resolve to a parent program.
 */
function isGenericKeyword(normalizedKeyword) {
  const genericSet = new Set(['ZAKAT', 'WAKAF', 'INFAQ', 'SEDEKAH']);
  return genericSet.has(normalizedKeyword);
}

/**
 * Checks if a normalized keyword is "specific" (e.g., ZAKAT FITRAH, WAKAF PEMBANGUNAN)
 * that should resolve to a child program.
 */
function isSpecificKeyword(normalizedKeyword) {
  // Keywords that are generic base + modifier
  const patterns = [
    /^zakat\s+\w+/i,
    /^wakat\s+\w+/i,
    /^infaq\s+\w+/i,
    /^sedekah\s+\w+/i,
    /^\w+\s+fitrah/i,
    /^\w+\s+pembangunan/i,
    /^\w+\+?\s*subuh/i,
  ];
  return patterns.some(p => p.test(normalizedKeyword));
}

/**
 * Builds the keyword analysis prompt for AI.
   */
export function buildKeywordAnalysisPrompt(master) {
  const programs = master.programs.map(p => ({
    id: p.id,
    name: p.name,
    coaCode: p.coaCode,
    parentCoaCode: p.parentCoaCode,
    keywords: p.keywords || [],
    hiddenKeywords: p.hiddenKeywords || [],
    description: p.description
  }));

  // Build hierarchy map for prompt context
  const hierarchy = {};
  programs.forEach(p => {
    if (p.parentCoaCode) {
      if (!hierarchy[p.parentCoaCode]) hierarchy[p.parentCoaCode] = [];
      hierarchy[p.parentCoaCode].push({ id: p.id, coaCode: p.coaCode, name: p.name });
    }
  });

  const programsLines = programs.map(p =>
    `ID: ${p.id} | COA: ${p.coaCode} | Induk: ${p.parentCoaCode || '-'} | Keywords: [${(p.keywords || []).join(', ')}] | Deskripsi: ${p.description || '-'}`
  ).join('\n');

  return `Kamu asisten akuntansi ZISWAF. Analisis keyword program untuk kualitas & kolisi.

PROGRAM (${programs.length} total):
${programsLines}

HIERARKI COA (induk → anak):
${JSON.stringify(hierarchy, null, 2)}

TUGAS:
1. **KOLISI**: keyword yang sama (setelah normalisasi) di >1 program. Contoh: "WAKAF" di program Wakaf Umum DAN Wakaf Pembangunan — sebaiknya di induk saja.
2. **MISSING**: keyword yang seharusnya ada tapi belum ada (berdasarkan nama program, deskripsi, atau logika ZISWAF umum).
3. **VARIANTS** per keyword (maks 10 per keyword, edit distance ≤ 2):
   - Typo umum Indonesia: transposisi, duplikasi, omisi, substitusi
   - Sinonim/alternatif ZISWAF: "QURAN" → "KORAN" (atau "MUSHAF"), "WAKAF" → "WAKF", "ALQURAN" ↔ "MUSHAF"
   - Singkatan umum: "PEMBANGUNAN" → "PEMB", "PENGHAfal" → "PNGHL", "TAHFIDZ" → "TAHFIZ"
   - Multi-word typo: "ZAKAT FITRAH" → "ZKT FITRAH", "Z FITRAH", "BERAS FITRAH"
4. **HIERARKI**: keyword generik (ZAKAT, WAKAF, INFAQ, SEDEKAH) → program INDUK (parentCoaCode). Keyword spesifik (ZAKAT FITRAH, WAKAF PEMBANGUNAN) → program ANAK.
5. Tandai kasus **SEMANTIK** (butuh AI Layer 5, bukan keyword): "Infaq Tahfidz Quran" vs "Infaq Alquran", "Sedekah Penghafal" vs "Sedekah Alquran"
5. Gunakan **deskripsi program** untuk memahami konteks & memisahkan program yang mirip (mis. "Sedekah Alquran" = distribusi mushaf, "Sedekah Penghafal" = bantuan santri hafiz).

OUTPUT (JSON murni, tanpa markdown):
{
  "collisions": [{"keyword":"WAKAF","programs":["prog-wakaf-uang","prog-wakaf-kawasan"],"suggestion":"Pindahkan 'WAKAF' ke program induk (Wakaf Umum), hapus dari anak"}],
  "missing": [{"program_id":"prog-quran","suggested_keyword":"ALQURAN","reason":"Nama program mengandung Al-Qur'an"}],
  "variants": [
    {"program_id":"prog-quran","keyword":"ALQURAN","variants":["AL-QURAN","ALQRAAN","ALQUREN","LQURAN","QORAN","KORAN"],"type":"typo|synonym|abbreviation"}
  ],
  "hierarchy_fixes": [
    {"program_id":"prog-zkt-fitrah","keyword":"FITRAH","action":"keep_in_child","reason":"ZAKAT FITRAH spesifik untuk anak"}
  ]
}`;
}

/**
 * Main async function: generates keyword suggestions using AI.
 */
export async function generateKeywordSuggestions(master, settings) {
  if (!master || !master.programs) throw new Error('Master data tidak valid');
  if (!settings.aiApiKey) throw new Error('API Key AI belum diisi');

  const prompt = buildKeywordAnalysisPrompt(master);

  let rawResponse = '';
  const mode = (settings.aiMode || '').toUpperCase();

  if (mode === 'GEMINI' || mode === 'GOOGLE_GEMINI' || mode === 'CLOUD_API') {
    rawResponse = await callGemini(prompt, settings);
  } else if (mode === 'OPENAI' || mode === 'GROQ' || mode === 'OPENROUTER' || mode === 'CUSTOM_OPENAI') {
    rawResponse = await callOpenAICompatible(prompt, settings);
  } else if (mode === 'LOCAL_OLLAMA' || mode === 'OLLAMA') {
    rawResponse = await callOllama(prompt, settings);
  } else {
    throw new Error('Provider AI tidak didukung');
  }

  // Parse JSON response — try full object first, then cleanJsonResponse fallback
  let parsed = {};
  try { parsed = JSON.parse(rawResponse.trim()); } catch {
    const cleanedJson = cleanJsonResponse(rawResponse);
    try { parsed = JSON.parse(cleanedJson); } catch { parsed = {}; }
  }

  // Validate structure - ensure arrays exist
  if (!Array.isArray(parsed.collisions)) parsed.collisions = [];
  if (!Array.isArray(parsed.missing)) parsed.missing = [];
  if (!Array.isArray(parsed.variants)) parsed.variants = [];
  if (!Array.isArray(parsed.hierarchy_fixes)) parsed.hierarchy_fixes = [];

  // Cap variants at 10 per keyword
  parsed.variants = parsed.variants.map(v => ({
    ...v,
    variants: Array.isArray(v.variants) ? v.variants.slice(0, 10) : []
  }));

  // Valid variant patterns per base keyword (strict filtering for AI nonsense)
  const validVariantPatterns = {
    'QURAN': /^(AL[- ]?QURAN|QURAN|QORAN|KORAN|ALQURAN|ALQRAAN|ALQUR\'?AN|AL\s?QUR\'?AN)$/i,
    'ALQURAN': /^(AL[- ]?QURAN|QURAN|QORAN|KORAN|ALQURAN|ALQRAAN|ALQUR\'?AN|AL\s?QUR\'?AN)$/i,
    'QURBAN': /^(QURBAN|KURBAN|QURB|IDUL ADHA)$/i,
    'ZAKAT': /^(ZAKAT|ZAKAH|ZKT|ZAK|ZAKAT MAL|ZAKAT MAAL|ZAKAT HARTA|ZAKAT PENGHASILAN|ZAKAT PROFESI)$/i,
    'FITRAH': /^(FITRAH|FITRI|FITROH|FITR|ZAKAT FITRAH|ZAKAT FITRI)$/i,
    'YATIM': /^(YATIM|YTIM|YTM|YA TIM|YAATIM|ADEK YATIM|FESTIFAL YATIM)$/i,
    'WAKAF': /^(WAKAF|WAQF|WAAKAF|WAKF|WAKAF UMUM|WAKAF PEMBANGUNAN|WAKAF RENOVASI|WAKAF TUNAI)$/i,
    'INFAQ': /^(INFAQ|INFAK|INFQ)$/i,
    'SEDEKAH': /^(SEDEKAH|SADAQAH|SADAQOH|SODAQOH|SHODAQOH|SHADAQAH)$/i,
    'PALESTINA': /^(PALESTINA|PALESTIN|PLESTIN|PALESTINE|PALES TINA)$/i,
    'PEMBANGUNAN': /^(PEMBANGUNAN|PEMB|WAKAF PEMBANGUNAN|BANGUNAN|WAKAF PEMB|RENOVASI|WAKAF RENOVASI)$/i,
    'QURB': /^(QURB|QURBAN|KURBAN|IDUL ADHA)$/i,
    'FIDYAH': /^(FIDYAH|FIDIAH|FIDYA)$/i,
    'PENGHAFAL': /^(PENGHAFAL|PNGHL|PNGHAFAL|PENGAfal)$/i,
  };
  
  function isValidVariant(baseKeyword, variant) {
    const base = baseKeyword.toUpperCase();
    const v = variant.toUpperCase();
    
    // Always allow the original keyword
    if (v === base || v === base.toLowerCase()) return true;
    
    // Check against known patterns
    for (const [basePattern, pattern] of Object.entries(validVariantPatterns)) {
      if (base.includes(basePattern) || basePattern.includes(base)) {
        if (pattern.test(v)) return true;
      }
    }
    
    // For unknown base keywords, conservative checks
    if (v.length > base.length + 3) return false; // too long
    if (v.includes(' ') && !base.includes(' ')) return false; // added space
    if (/[0-9]/.test(v) && !/[0-9]/.test(base)) return false; // added numbers
    return true; // conservative fallback
  }

  // Cap variants at 10 per keyword
  parsed.variants = parsed.variants.map(v => ({
    ...v,
    variants: Array.isArray(v.variants) ? v.variants.slice(0, 10) : []
  }));

  // Post-process: supplement AI-generated variants with deterministic local generation
  // Also filter AI variants to remove nonsense
  for (const v of parsed.variants) {
    // Filter existing AI variants first
    if (v.variants) {
      v.variants = v.variants.filter(v2 => isValidVariant(v.keyword, v2)).slice(0, 10);
    }
    // Supplement with local generation if still under 10
    if (v.variants && v.variants.length < 10) {
      const baseKeyword = v.keyword;
      const localVariants = generateVariants(baseKeyword)
        .filter(v2 => !v.variants.includes(v2) && isValidVariant(baseKeyword, v2));
      v.variants.push(...localVariants);
    }
  }

  return {
    collisions: parsed.collisions,
    missing: parsed.missing,
    variants: parsed.variants,
    hierarchy_fixes: parsed.hierarchy_fixes,
    source: 'keyword_generator',
    generated_at: new Date().toISOString()
  };
}