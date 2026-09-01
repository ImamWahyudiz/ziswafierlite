/**
 * AI Semantic Matcher - Browser Engine Port of app/engine/ai_matcher.py
 * Supports: GOOGLE_GEMINI, LOCAL_OLLAMA, OPENAI, GROQ, OPENROUTER
 * Features: Compact Flat-Table Prompt, Micro-Batching, In-Memory Label Cache, Circuit Breaker, JSON Sanitization
 */

// Circuit breaker tracking
let consecutiveFailures = 0;
let circuitOpen = false;
let circuitOpenTime = 0;
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_TIMEOUT_MS = 60000; // 60s cooldown
const REQUEST_TIMEOUT_MS = 60000; // 60s timeout

export function resetCircuitBreaker() {
  consecutiveFailures = 0;
  circuitOpen = false;
  circuitOpenTime = 0;
}

// In-memory exact match cache for duplicate transaction texts within session
const _aiLabelCache = new Map();
const MAX_CACHE_SIZE = 2000;

function trimCache() {
  if (_aiLabelCache.size > MAX_CACHE_SIZE) {
    const keys = Array.from(_aiLabelCache.keys()).slice(0, 300);
    for (const k of keys) _aiLabelCache.delete(k);
  }
}

export function clearAiCache() {
  _aiLabelCache.clear();
}

/**
 * Compresses master program list into an ultra-compact flat text index
 * Format: ID|COA|NAMA_PROGRAM|HINTS
 */
function formatCompactPrograms(programs) {
  const lines = [];
  for (const p of programs || []) {
    const hints = [];
    if (p.description) hints.push(p.description.slice(0, 80));
    if (p.keywords && p.keywords.length > 0) hints.push(p.keywords.slice(0, 6).join(', '));
    const hintStr = hints.join(' | ').replace(/\n/g, ' ').trim();
    lines.push(`${p.id}|${p.coaCode}|${p.name}|${hintStr}`);
  }
  return lines.join('\n');
}

/**
 * Compresses donor list into compact index — used as AI safety net
 * Format: NAMA|PROGRAM_DEFAULT  (capped at 80 entries to avoid prompt bloat)
 */
function formatCompactDonors(donors) {
  if (!donors || donors.length === 0) return '';
  return donors
    .slice(0, 80)
    .map(d => {
      const prog = d.defaultProgramId ? `→${d.defaultProgramId}` : '';
      return `${d.name}${prog}`;
    })
    .join('\n');
}

/**
 * Builds the compact batch prompt with full master data context
 */
function buildCompactPrompt(items, programs, options = {}) {
  const compactProgTable = formatCompactPrograms(programs);
  const txLines = items.map((it, idx) => `${idx + 1}: "${it.cleanedLabel || it.rawLabel}"`);
  const txBlock = txLines.join('\n');

  const aliases = (options.companyAliases || []).filter(Boolean);
  const baselineCoa = options.defaultBaselineCoa || 40201001;
  const unauthCoa = options.defaultUnauthorizedCoa || 40201000;

  const aliasSection = aliases.length > 0
    ? `\nALIAS/NAMA LEMBAGA: ${aliases.join(', ')}\n`
    : '';

  const donorSection = options.donors && options.donors.length > 0
    ? `\nDONATUR TETAP (NAMA→PROGRAM_DEFAULT):\n${formatCompactDonors(options.donors)}\n`
    : '';

  return `Kamu asisten akuntansi syariah ZISWAF untuk lembaga amil zakat Indonesia. Analisis konteks & maksud mutasi donatur dalam BAHASA INDONESIA, lalu tentukan program/COA yang cocok.

ATURAN BAHASA INDONESIA:
- "Renovasi" = pembangunan/pemugaran → gunakan program Pembangunan (bukan Umum)
- "Penghafal Quran" / "Tahfidz Quran" / "Santri Penghafal" = kegiatan menghafal, BUKAN program Quran → Infak Umum
- "Alquran" / "Al Quran" / "Mushaf Quran" = objek Quran itu sendiri → program Quran
- "Zakat" tanpa "Fitrah" = Zakat Maal (khusus); "Zakat Fitrah" = Zakat Fitrah
- "Zakat Untuk Anak Yatim" → Zakat Maal (kata "Zakat" lebih spesifik dari "Yatim")
- "Wakaf" tanpa keterangan spesifik → Wakaf Umum; "Wakaf Pembangunan" / "Wakaf Renovasi" → Wakaf Pembangunan
- "Shadaqah" / "Sedekah" tanpa program → Infak Umum
- "Infaq" / "Infak" + nama program → program itu; "Infaq" tanpa nama → Infak Umum

${aliasSection}${donorSection}
MASTER PROGRAM (ID|COA|NAMA_PROGRAM|DESKRIPSI|KEYWORDS):
${compactProgTable}

TRANSAKSI:
${txBlock}

INSTRUKSI:
1. Cocok program spesifik: Beri id_program, no_akun program, confidence 0.85-1.0.
2. Nama pengirim cocok Donatur Tetap di atas: Gunakan program default donatur (atau Infak Umum jika kosong), confidence 0.90.
3. Donasi umum / sebut alias lembaga (ada kata donasi/sedekah/infaq/sumbangan tanpa program khusus): Alokasikan ke Infak Umum (id_program: null, no_akun: ${baselineCoa}, confidence: 0.90).
4. Mutasi buta / tanpa kata donasi dan tidak dikenal (misal hanya nama pengirim, nomor rekening, atau kode transfer bank): DILARANG MENEBAK program! WAJIB Karantina ke Unauthorized (id_program: null, no_akun: ${unauthCoa}, confidence: 0.0).
5. Output HANYA JSON array murni tanpa markdown, format:
[
  {"idx": 1, "id_program": "<id_atau_null>", "no_akun": <number>, "confidence": <float_0_1>, "reason": "<maks_10_kata>"}
]`;
}


export async function fetchWithTimeout(url, options, timeout = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return response;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`Koneksi AI timeout (${timeout / 1000}s).`);
    }
    throw err;
  }
}

/**
 * Strips markdown code blocks and repairs JSON text
 */
export function cleanJsonResponse(rawText) {
  if (!rawText) return '';
  let text = String(rawText).trim();
  text = text.replace(/^```(?:json)?\s*/gi, '').replace(/\s*```$/gi, '').trim();

  // Find array [ ... ]
  const startArr = text.indexOf('[');
  if (startArr !== -1) {
    const endArr = text.lastIndexOf(']');
    if (endArr !== -1 && endArr > startArr) {
      return text.slice(startArr, endArr + 1);
    }
    const lastBrace = text.lastIndexOf('}');
    if (lastBrace !== -1 && lastBrace > startArr) {
      return text.slice(startArr, lastBrace + 1) + '\n]';
    }
  }

  // Find object { ... }
  const startObj = text.indexOf('{');
  if (startObj !== -1) {
    const endObj = text.lastIndexOf('}');
    if (endObj !== -1 && endObj > startObj) {
      return `[${text.slice(startObj, endObj + 1)}]`;
    }
  }
  return text;
}

function parseConfidence(val) {
  try {
    let num = typeof val === 'string' ? parseFloat(val.replace('%', '').trim()) : Number(val);
    if (isNaN(num)) return 0.0;
    if (num > 1.0) num = num / 100.0;
    return Math.max(0.0, Math.min(1.0, num));
  } catch {
    return 0.0;
  }
}

/**
 * Calls Ollama local endpoint
 */
export async function callOllama(prompt, settings) {
  const endpoint = (settings.ollamaEndpoint || 'http://localhost:11434').replace(/\/api\/(?:chat|generate)$/i, '').replace(/\/+$/, '');
  const model = settings.aiModelName || 'qwen2.5:3b-instruct';
  const url = `${endpoint}/api/generate`;

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model,
      prompt: prompt,
      stream: false,
      format: 'json',
      options: { temperature: 0.0, top_p: 0.9 }
    })
  }, REQUEST_TIMEOUT_MS);

  if (!response.ok) throw new Error(`Ollama Error HTTP ${response.status}: ${response.statusText}`);
  const json = await response.json();
  return json.response || '';
}

/**
 * Calls Google Gemini Cloud API
 */
export async function callGemini(prompt, settings) {
  const apiKey = (settings.aiApiKey || '').trim();
  if (!apiKey) throw new Error('API Key Google Gemini belum diisi. Masukkan API Key di tab Pengaturan AI.');

  let rawModel = (settings.aiModelName || 'gemini-3.5-flash').trim().replace(/^\/?models\//i, '');
  let model = rawModel.toLowerCase().replace(/\s+/g, '-');

  // Automatic routing for legacy/deprecated model names to active Gemini models
  if (!model || model === 'gemini-2.0-flash' || model === 'gemini-1.5-flash' || model === 'gemini-2.5-flash' || model.includes('3.1-flash-lite')) {
    model = 'gemini-3.5-flash';
  }

  const modelsToTry = [model];
  if (!modelsToTry.includes('gemini-3.5-flash')) modelsToTry.push('gemini-3.5-flash');
  if (!modelsToTry.includes('gemini-3.6-flash')) modelsToTry.push('gemini-3.6-flash');

  let lastError = null;
  for (const currentModel of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(currentModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.0
        }
      };

      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }, REQUEST_TIMEOUT_MS);

      if (!response.ok) {
        let errBody = '';
        try {
          const errJson = await response.json();
          errBody = errJson.error?.message || response.statusText;
        } catch {
          errBody = response.statusText;
        }
        throw new Error(`Gemini API Error (${response.status}): ${errBody}`);
      }

      const json = await response.json();
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (text) return text;
    } catch (err) {
      lastError = err;
      if (err.message.includes('401') || err.message.includes('403') || err.message.includes('API key not valid') || err.message.includes('API_KEY_INVALID')) {
        throw err;
      }
    }
  }

  throw lastError || new Error('Gagal mendapatkan respon dari Google Gemini API.');
}

/**
 * Calls OpenAI / Groq / OpenRouter API
 */
export async function callOpenAICompatible(prompt, settings) {
  const apiKey = (settings.aiApiKey || '').trim();
  if (!apiKey) throw new Error('API Key AI belum diisi.');

  let endpoint = (settings.ollamaEndpoint || '').trim();
  const mode = (settings.aiMode || '').toUpperCase();

  if (mode === 'GROQ') {
    endpoint = 'https://api.groq.com/openai/v1/chat/completions';
  } else if (mode === 'OPENROUTER') {
    endpoint = 'https://openrouter.ai/api/v1/chat/completions';
  } else if (!endpoint || mode === 'OPENAI') {
    endpoint = 'https://api.openai.com/v1/chat/completions';
  }

  const model = settings.aiModelName || (mode === 'GROQ' ? 'llama-3.3-70b-versatile' : mode === 'OPENROUTER' ? 'qwen/qwen-2.5-72b-instruct' : 'gpt-4o-mini');

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };

  if (endpoint.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = window.location.origin || 'http://localhost';
    headers['X-Title'] = 'ZISWAF Classifier Lite';
  }

  const payload = {
    model: model,
    messages: [
      { role: 'system', content: 'You are a financial classification assistant for Indonesian ZISWAF funds. Always respond with pure JSON array.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.0
  };

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(payload)
  }, REQUEST_TIMEOUT_MS);

  if (!response.ok) {
    let errBody = '';
    try {
      const errJson = await response.json();
      errBody = errJson.error?.message || response.statusText;
    } catch {
      errBody = response.statusText;
    }
    throw new Error(`AI Gateway Error (${response.status}): ${errBody}`);
  }

  const json = await response.json();
  return json.choices?.[0]?.message?.content || '';
}

/**
 * Classifies a single transaction (uses cached or micro-batch client)
 */
export async function classifySemanticClient(cleanedLabel, programs, settings) {
  if (!cleanedLabel || !cleanedLabel.trim()) return null;
  const results = await classifySemanticBatchClient([{ id: 'single_1', cleanedLabel }], programs, settings);
  return results && results[0] ? results[0] : null;
}

/**
 * High-Efficiency Micro-Batch Semantic Classification
 * Port of classify_semantic_batch from app/engine/ai_matcher.py
 */
export async function classifySemanticBatchClient(items, programs, settings, bypassCache = false, contextOptions = {}) {
  if (!items || items.length === 0) return [];
  const mode = (settings?.aiMode || '').toUpperCase();
  if (mode === 'OFF' || mode === 'DISABLED') return items.map(() => null);

  const results = new Array(items.length).fill(null);
  const uncachedIndices = [];

  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const lbl = (it.cleanedLabel || it.rawLabel || '').trim();
    if (!lbl) continue;
    const normKey = lbl.toLowerCase();

    if (!bypassCache && _aiLabelCache.has(normKey)) {
      results[idx] = _aiLabelCache.get(normKey);
    } else {
      uncachedIndices.push(idx);
    }
  }

  if (uncachedIndices.length === 0) {
    return results;
  }

  // Check Circuit Breaker
  if (circuitOpen) {
    if (Date.now() - circuitOpenTime < CIRCUIT_TIMEOUT_MS) {
      return results;
    }
    circuitOpen = false;
    consecutiveFailures = 0;
  }

  const uncachedItems = uncachedIndices.map(i => items[i]);
  const prompt = buildCompactPrompt(uncachedItems, programs, contextOptions);

  let rawResponseText = '';
  try {
    if (mode === 'LOCAL_OLLAMA' || mode === 'OLLAMA') {
      rawResponseText = await callOllama(prompt, settings);
    } else if (mode === 'GEMINI' || mode === 'GOOGLE_GEMINI' || mode === 'CLOUD_API') {
      rawResponseText = await callGemini(prompt, settings);
    } else if (mode === 'OPENAI' || mode === 'GROQ' || mode === 'OPENROUTER' || mode === 'CUSTOM_OPENAI') {
      rawResponseText = await callOpenAICompatible(prompt, settings);
    } else {
      return results;
    }

    const cleanedJson = cleanJsonResponse(rawResponseText);
    let parsedData = [];
    try {
      parsedData = JSON.parse(cleanedJson);
      if (!Array.isArray(parsedData) && typeof parsedData === 'object' && parsedData !== null) {
        parsedData = [parsedData];
      }
    } catch {
      parsedData = [];
    }

    // Reset circuit breaker on success
    consecutiveFailures = 0;
    circuitOpen = false;

    // Build lookup sets for whitelist sanitization
    const validProgMap = new Map();
    for (const p of programs || []) {
      validProgMap.set(String(p.id), p);
    }

    for (let pos = 0; pos < parsedData.length; pos++) {
      const dataItem = parsedData[pos];
      if (!dataItem) continue;

      let targetOrigIdx = -1;
      const itemIdxNum = parseInt(dataItem.idx, 10);
      if (!isNaN(itemIdxNum) && itemIdxNum >= 1 && itemIdxNum <= uncachedIndices.length) {
        targetOrigIdx = uncachedIndices[itemIdxNum - 1];
      } else if (pos < uncachedIndices.length) {
        targetOrigIdx = uncachedIndices[pos];
      }

      if (targetOrigIdx === -1) continue;

      let progId = dataItem.id_program !== undefined ? dataItem.id_program : dataItem.program_id;
      progId = progId ? String(progId).trim() : null;

      let matchedProgram = null;
      if (progId && validProgMap.has(progId)) {
        matchedProgram = validProgMap.get(progId);
      } else if (progId) {
        // Search by name or code if LLM returned name/code instead of id
        for (const p of programs) {
          if (String(p.id).toLowerCase() === progId.toLowerCase() ||
              String(p.coaCode) === progId ||
              p.name.toLowerCase() === progId.toLowerCase()) {
            matchedProgram = p;
            progId = p.id;
            break;
          }
        }
      }

      let coa = Number(dataItem.no_akun || dataItem.coa);
      if (matchedProgram) {
        coa = matchedProgram.coaCode;
      }

      const confidence = parseConfidence(dataItem.confidence);
      const reason = String(dataItem.reason || 'Rekomendasi AI Semantik').trim();

      const parsedRes = {
        programId: matchedProgram ? matchedProgram.id : null,
        coa: coa || (matchedProgram ? matchedProgram.coaCode : null),
        confidence: confidence,
        reason: reason
      };

      results[targetOrigIdx] = parsedRes;

      const normKey = (items[targetOrigIdx].cleanedLabel || items[targetOrigIdx].rawLabel || '').trim().toLowerCase();
      if (normKey) {
        _aiLabelCache.set(normKey, parsedRes);
      }
    }

    trimCache();
    return results;
  } catch (err) {
    consecutiveFailures++;
    if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
      circuitOpen = true;
      circuitOpenTime = Date.now();
    }
    lastCallError = err;
    console.warn('AI Classifier Warning:', err.message);
    if (bypassCache) {
      // If called explicitly (e.g. Test Connection or Rescan), throw the underlying error!
      throw err;
    }
    return results;
  }
}

let lastCallError = null;

/**
 * Diagnostic tool for testing connection to AI providers
 */
export async function testAIConnection(settings) {
  const dummyPrograms = [
    { id: 'prog-zkt-maal', coaCode: 40100101, name: 'Zakat Maal', keywords: ['zakat', 'maal', 'gaji'], description: 'Zakat harta/penghasilan' },
    { id: 'prog-inf-umum', coaCode: 40201001, name: 'Infak Umum', keywords: ['infak', 'sedekah'], description: 'Infak dan sedekah umum' }
  ];
  const testItem = [{ id: 'test_1', cleanedLabel: 'Zakat penghasilan bulanan' }];

  const provider = (settings.aiMode || 'OFF').toUpperCase();
  let resolvedModel = (settings.aiModelName || '').trim();
  if (!resolvedModel) {
    if (provider === 'GEMINI' || provider === 'GOOGLE_GEMINI') resolvedModel = 'gemini-3.5-flash';
    else if (provider === 'LOCAL_OLLAMA' || provider === 'OLLAMA') resolvedModel = 'qwen2.5:3b-instruct';
    else if (provider === 'GROQ') resolvedModel = 'llama-3.3-70b-versatile';
    else if (provider === 'OPENROUTER') resolvedModel = 'qwen/qwen-2.5-72b-instruct';
    else resolvedModel = 'gpt-4o-mini';
  }

  const startTime = Date.now();
  resetCircuitBreaker();
  lastCallError = null;
  
  let results;
  try {
    results = await classifySemanticBatchClient(testItem, dummyPrograms, settings, true);
  } catch (err) {
    throw new Error(`Provider ${provider} (${resolvedModel}): ${err.message}`);
  }

  const latency = Date.now() - startTime;
  const res = results && results[0];

  if (res && res.confidence > 0) {
    return {
      ok: true,
      provider,
      model: resolvedModel,
      latency,
      programId: res.programId,
      coa: res.coa,
      confidence: res.confidence,
      reason: res.reason,
      message: `Koneksi berhasil (${latency}ms). Hasil: ${res.programId || 'Program'} (COA: ${res.coa}, Keyakinan: ${Math.round(res.confidence * 100)}%)`
    };
  } else {
    if (lastCallError) {
      throw new Error(`Provider ${provider} (${resolvedModel}): ${lastCallError.message}`);
    }
    throw new Error(`Provider ${provider} (${resolvedModel}) terhubung (${latency}ms) tetapi tidak mengembalikan klasifikasi valid (confidence 0 / kosong). Pastikan API Key dan nama model sudah benar.`);
  }
}
