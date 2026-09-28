/**
 * AI Semantic Matcher - Browser Engine Port of app/engine/ai_matcher.py
 * Supports: GEMINI, LOCAL_OLLAMA, OPENAI
 * Features: Independent label prompts, In-Memory Label Cache, Circuit Breaker, JSON Sanitization
 */

// Circuit breaker tracking
let consecutiveFailures = 0;
let circuitOpen = false;
let circuitOpenTime = 0;
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_TIMEOUT_MS = 60000; // 60s cooldown
const REQUEST_TIMEOUT_MS = 60000; // 60s timeout
const AI_CONTRACT_VERSION = 'program-id-only-v3';

export const CLASSIFICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['decisions'],
  properties: {
    decisions: {
      type: 'array',
      minItems: 1,
      maxItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['item_id', 'program_id', 'confidence', 'reason'],
        properties: {
          item_id: { type: 'string' },
          program_id: { type: ['string', 'null'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reason: { type: 'string', maxLength: 160 }
        }
      }
    }
  }
};

function schemaForItem(itemId, programs) {
  const schema = JSON.parse(JSON.stringify(CLASSIFICATION_SCHEMA));
  schema.properties.decisions.items.properties.item_id.enum = [String(itemId)];
  schema.properties.decisions.items.properties.program_id.enum = [null, ...(programs || []).map(program => String(program.id))];
  return schema;
}

export function resolveAiModel(settings = {}) {
  const configured = String(settings.aiModelName || '').trim();
  if (configured) return configured;
  const mode = String(settings.aiMode || '').toUpperCase();
  if (mode === 'GEMINI' || mode === 'GOOGLE_GEMINI') return 'gemini-3.5-flash-lite';
  if (mode === 'LOCAL_OLLAMA' || mode === 'OLLAMA') return 'qwen2.5:3b-instruct';
  return 'gpt-5.6-luna';
}

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
 * Format: ID|NAMA_PROGRAM|HINTS
 */
function formatCompactPrograms(programs) {
  const lines = [];
  for (const p of programs || []) {
    const hints = [];
    if (p.description) hints.push(p.description.slice(0, 80));
    if (p.keywords && p.keywords.length > 0) hints.push(p.keywords.slice(0, 6).join(', '));
    const hintStr = hints.join(' | ').replace(/\n/g, ' ').trim();
    lines.push(`${p.id}|${p.name}|${hintStr}`);
  }
  return lines.join('\n');
}

function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cacheFingerprint(programs, settings, options) {
  return hashText(JSON.stringify({
    contract: AI_CONTRACT_VERSION,
    provider: String(settings?.aiMode || '').toUpperCase(),
    model: resolveAiModel(settings),
    programs: (programs || []).map(p => ({
      id: p.id,
      coa: p.coaCode,
      name: p.name,
      keywords: p.keywords || [],
      hiddenKeywords: p.hiddenKeywords || [],
      description: p.description || ''
    })),
    baseline: options.defaultBaselineCoa || null,
    unauthorized: options.defaultUnauthorizedCoa || null,
    aliases: options.companyAliases || [],
    orgName: options.orgName || ''
  }));
}

/**
 * Builds one isolated prompt so another transaction cannot influence the label.
 */
function buildCompactPrompt(item, programs, options = {}) {
  const compactProgTable = formatCompactPrograms(programs);
  const aliases = (options.companyAliases || []).filter(Boolean);
  const itemId = String(item.id || 'transaction');
  const label = String(item.cleanedLabel || item.rawLabel || '');

  const aliasSection = aliases.length > 0
    ? `\nALIAS/NAMA LEMBAGA: ${aliases.join(', ')}\n`
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

${aliasSection}
MASTER PROGRAM (ID|NAMA_PROGRAM|DESKRIPSI/KEYWORDS):
${compactProgTable}

TRANSAKSI TUNGGAL:
- item_id: ${JSON.stringify(itemId)}
- label: ${JSON.stringify(label)}

INSTRUKSI:
1. Jika cocok program spesifik, kembalikan program_id persis dari master dan confidence 0.85-1.0.
2. Untuk donasi umum tanpa program khusus, gunakan program_id null dan confidence 0.85-1.0.
3. Untuk mutasi buta/tidak dikenal, gunakan program_id null dan confidence 0.0. DILARANG menebak.
4. Jangan mengembalikan nomor COA, nama program sebagai ID, atau ID baru.
5. item_id wajib sama persis. Output satu keputusan dalam JSON object murni tanpa markdown:
{"decisions":[{"item_id":${JSON.stringify(itemId)},"program_id":null,"confidence":0.0,"reason":"<maks_10_kata>"}]}`;
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

async function fetchWithRetry(url, options, timeout = REQUEST_TIMEOUT_MS) {
  let response;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetchWithTimeout(url, options, timeout);
      if (response.ok || (response.status !== 429 && response.status < 500)) return response;
      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
  }
  if (response) return response;
  throw lastError || new Error('Koneksi AI gagal.');
}

/**
 * Strips markdown code blocks and repairs JSON text
 */
export function cleanJsonResponse(rawText) {
  if (!rawText) return '';
  let text = String(rawText).trim();
  text = text.replace(/^```(?:json)?\s*/gi, '').replace(/\s*```$/gi, '').trim();
  const objectStart = text.indexOf('{');
  const arrayStart = text.indexOf('[');
  const start = objectStart === -1 ? arrayStart : arrayStart === -1 ? objectStart : Math.min(objectStart, arrayStart);
  if (start === -1) return text;
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{' || char === '[') stack.push(char);
    if (char === '}' || char === ']') {
      const expected = char === '}' ? '{' : '[';
      if (stack.pop() !== expected) return '';
      if (!stack.length) return text.slice(start, i + 1);
    }
  }
  return '';
}

function parseConfidence(val) {
  if (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > 1) return null;
  return val;
}

/**
 * Calls Ollama local endpoint
 */
export async function callOllama(prompt, settings, responseSchema = CLASSIFICATION_SCHEMA) {
  const endpoint = (settings.ollamaEndpoint || 'http://localhost:11434').replace(/\/api\/(?:chat|generate)$/i, '').replace(/\/+$/, '');
  const model = resolveAiModel(settings);
  const url = `${endpoint}/api/generate`;

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model,
      prompt: prompt,
      stream: false,
      format: responseSchema,
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
export async function callGemini(prompt, settings, responseSchema = CLASSIFICATION_SCHEMA) {
  const apiKey = (settings.aiApiKey || '').trim();
  if (!apiKey) throw new Error('API Key Google Gemini belum diisi. Masukkan API Key di tab Pengaturan AI.');

  const model = resolveAiModel(settings).replace(/^\/?models\//i, '').toLowerCase().replace(/\s+/g, '-');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: responseSchema,
          temperature: 0.0
        }
      };

      const response = await fetchWithRetry(url, {
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
        throw new Error(`Gemini API Error (${response.status}, model ${model}): ${errBody}`);
      }

      const json = await response.json();
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (text) return text;
  throw new Error(`Gemini model ${model} tidak mengembalikan respons.`);
}

/**
 * Calls the OpenAI Responses API.
 */
export async function callOpenAICompatible(prompt, settings, responseSchema = CLASSIFICATION_SCHEMA) {
  const apiKey = (settings.aiApiKey || '').trim();
  if (!apiKey) throw new Error('API Key AI belum diisi.');

  const mode = (settings.aiMode || '').toUpperCase();
  if (mode !== 'OPENAI') throw new Error(`Provider ${mode || '(kosong)'} tidak didukung.`);
  const endpoint = 'https://api.openai.com/v1/responses';
  const model = resolveAiModel(settings);

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };

  const payload = {
    model: model,
    instructions: 'Klasifikasikan dana ZISWAF Indonesia secara konservatif. Jangan membuat program atau COA baru.',
    input: prompt,
    reasoning: { effort: 'none' },
    text: {
      format: {
        type: 'json_schema',
        name: 'ziswaf_classification',
        strict: true,
        schema: responseSchema
      }
    }
  };

  const response = await fetchWithRetry(endpoint, {
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
  return json.output_text
    || json.output?.flatMap(item => item.content || []).find(part => part.type === 'output_text')?.text
    || json.choices?.[0]?.message?.content
    || '';
}

/**
 * Classifies a single transaction (uses cached or micro-batch client)
 */
export async function classifySemanticClient(cleanedLabel, programs, settings) {
  if (!cleanedLabel || !cleanedLabel.trim()) return null;
  const results = await classifySemanticBatchClient([{ id: 'single_1', cleanedLabel }], programs, settings);
  return results && results[0] ? results[0] : null;
}

function aiResult(status, reason, settings, fingerprint, extra = {}) {
  return {
    programId: null,
    coa: null,
    confidence: 0,
    reason,
    status,
    provider: String(settings?.aiMode || '').toUpperCase(),
    model: resolveAiModel(settings),
    fingerprint,
    ...extra
  };
}

function parseSingleDecision(rawResponseText, itemId, programs, settings, contextOptions, fingerprint) {
  const cleanedJson = cleanJsonResponse(rawResponseText);
  if (!cleanedJson) return aiResult('invalid_response', 'Respons AI tidak memuat JSON valid.', settings, fingerprint);

  let payload;
  try {
    payload = JSON.parse(cleanedJson);
  } catch {
    return aiResult('invalid_response', 'Respons AI bukan JSON valid.', settings, fingerprint);
  }

  if (!payload || Array.isArray(payload) || typeof payload !== 'object'
      || Object.keys(payload).some(key => key !== 'decisions')
      || !Array.isArray(payload.decisions) || payload.decisions.length !== 1) {
    return aiResult('invalid_response', 'Respons AI harus memuat tepat satu keputusan.', settings, fingerprint);
  }

  const decision = payload.decisions[0];
  const allowedKeys = new Set(['item_id', 'program_id', 'confidence', 'reason']);
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)
      || Object.keys(decision).some(key => !allowedKeys.has(key))
      || !Object.prototype.hasOwnProperty.call(decision, 'program_id')) {
    return aiResult('invalid_response', 'Struktur keputusan AI tidak sesuai kontrak.', settings, fingerprint);
  }
  if (String(decision.item_id) !== String(itemId)) {
    return aiResult('guardrail_rejected', 'AI mengembalikan identitas transaksi yang tidak cocok.', settings, fingerprint);
  }

  const confidence = parseConfidence(decision.confidence);
  if (confidence === null) {
    return aiResult('guardrail_rejected', 'AI mengembalikan confidence di luar rentang 0–1.', settings, fingerprint);
  }
  if (typeof decision.reason !== 'string') {
    return aiResult('invalid_response', 'AI tidak mengembalikan alasan dalam format teks.', settings, fingerprint);
  }

  const programId = decision.program_id === null ? null : String(decision.program_id);
  const matchedProgram = programId === null
    ? null
    : (programs || []).find(program => String(program.id) === programId);
  if (programId !== null && !matchedProgram) {
    return aiResult('guardrail_rejected', `AI mengembalikan program tidak dikenal '${programId}'.`, settings, fingerprint);
  }

  const coa = matchedProgram?.coaCode
    || (confidence > 0 ? contextOptions.defaultBaselineCoa : contextOptions.defaultUnauthorizedCoa);
  if (!coa) {
    return aiResult('guardrail_rejected', 'Akun sistem untuk keputusan AI tidak tersedia.', settings, fingerprint);
  }

  return aiResult(confidence > 0 ? 'accepted_candidate' : 'no_match', decision.reason.trim().slice(0, 160), settings, fingerprint, {
    programId: matchedProgram?.id || null,
    coa,
    confidence
  });
}

async function callProviderForItem(mode, item, programs, settings, contextOptions) {
  if (circuitOpen) {
    if (Date.now() - circuitOpenTime < CIRCUIT_TIMEOUT_MS) {
      throw new Error('Provider AI dinonaktifkan sementara setelah tiga kegagalan beruntun.');
    }
    circuitOpen = false;
    consecutiveFailures = 0;
  }

  const itemId = String(item.id || 'transaction');
  const prompt = buildCompactPrompt({ ...item, id: itemId }, programs, contextOptions);
  const schema = schemaForItem(itemId, programs);
  if (mode === 'LOCAL_OLLAMA' || mode === 'OLLAMA') return callOllama(prompt, settings, schema);
  if (mode === 'GEMINI' || mode === 'GOOGLE_GEMINI') return callGemini(prompt, settings, schema);
  if (mode === 'OPENAI') return callOpenAICompatible(prompt, settings, schema);
  throw new Error(`Provider AI '${mode || '(kosong)'}' tidak didukung.`);
}

/** Classifies each distinct label in an isolated provider request. */
export async function classifySemanticBatchClient(items, programs, settings, bypassCache = false, contextOptions = {}) {
  if (!items || items.length === 0) return [];
  const mode = (settings?.aiMode || '').toUpperCase();
  if (mode === 'OFF' || mode === 'DISABLED') return items.map(() => null);

  const results = new Array(items.length).fill(null);
  const fingerprint = cacheFingerprint(programs, settings, contextOptions);
  const pendingByKey = new Map();
  lastCallError = null;

  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const lbl = (it.cleanedLabel || it.rawLabel || '').trim();
    if (!lbl) continue;
    const normKey = `${fingerprint}:${lbl.toLowerCase()}`;
    if (!bypassCache && _aiLabelCache.has(normKey)) {
      results[idx] = _aiLabelCache.get(normKey);
    } else {
      const pending = pendingByKey.get(normKey) || { item: it, indices: [] };
      pending.indices.push(idx);
      pendingByKey.set(normKey, pending);
    }
  }

  for (const [normKey, pending] of pendingByKey) {
    const itemId = String(pending.item.id || `transaction-${pending.indices[0] + 1}`);
    let parsedResult;
    try {
      const rawResponseText = await callProviderForItem(mode, { ...pending.item, id: itemId }, programs, settings, contextOptions);
      consecutiveFailures = 0;
      circuitOpen = false;
      parsedResult = parseSingleDecision(rawResponseText, itemId, programs, settings, contextOptions, fingerprint);
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
        circuitOpen = true;
        circuitOpenTime = Date.now();
      }
      lastCallError = error;
      parsedResult = aiResult('provider_error', `Gagal menghubungi AI: ${error.message}`, settings, fingerprint);
    }

    for (const index of pending.indices) results[index] = parsedResult;
    if (!bypassCache && ['accepted_candidate', 'no_match'].includes(parsedResult.status)) {
      _aiLabelCache.set(normKey, parsedResult);
    }
  }

  trimCache();
  return results;
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
  const resolvedModel = resolveAiModel(settings);

  const startTime = Date.now();
  resetCircuitBreaker();
  lastCallError = null;
  
  let results;
  try {
    results = await classifySemanticBatchClient(testItem, dummyPrograms, settings, true, {
      defaultBaselineCoa: 40201001,
      defaultUnauthorizedCoa: 40201000,
      companyAliases: []
    });
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
