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
const REQUEST_TIMEOUT_MS = 15000; // 15s timeout

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
 * Compresses master program list into an ultra-compact flat text index (~150-200 tokens)
 * Format: ID|COA|NAMA_PROGRAM|HINTS
 */
function formatCompactPrograms(programs) {
  const lines = [];
  for (const p of programs || []) {
    const hints = [];
    if (p.description) {
      hints.push(p.description.slice(0, 80));
    }
    if (p.keywords && p.keywords.length > 0) {
      hints.push(p.keywords.slice(0, 6).join(', '));
    }
    const hintStr = hints.join(' | ').replace(/\n/g, ' ').trim();
    lines.push(`${p.id}|${p.coaCode}|${p.name}|${hintStr}`);
  }
  return lines.join('\n');
}

/**
 * Builds the authentic syariah compact batch prompt from app/engine/ai_matcher.py
 */
function buildCompactPrompt(items, programs) {
  const compactProgTable = formatCompactPrograms(programs);
  const txLines = items.map((it, idx) => `${idx + 1}: "${it.cleanedLabel || it.rawLabel}"`);
  const txBlock = txLines.join('\n');

  return `Kamu adalah asisten akuntansi syariah ZISWAF. Analisis teks mutasi donatur dan tentukan program yang paling cocok.

DAFTAR MASTER PROGRAM (ID|COA|NAMA_PROGRAM|HINTS):
${compactProgTable}

TRANSAKSI UNTUK DIANALISIS:
${txBlock}

INSTRUKSI:
1. Pahami maksud/sinonim konteks donasi (contoh: air/sumur/pipanisasi -> Sarana Air; lauk/nutrisi/konsumsi santri -> Gizi Santri; kewajiban harta 2.5%/nishab -> Zakat Maal; SPP/pendidikan -> Beasiswa; bencana alam/musibah -> Tanggap Bencana; obat/darurat medis -> Layanan Kesehatan; semen/bata/gedung -> Wakaf Fisik; domba/hewan ternak -> Qurban; tebusan puasa -> Fidyah).
2. Jika tidak ada kecocokan atau keterangan terlalu samar/buta/acak, beri id_program: null, no_akun: 40201000, confidence: 0.0.
3. Alasan/reason dibuat sangat singkat (maksimal 10 kata).
4. Output HANYA JSON array murni tanpa markdown, format:
[
  {"idx": 1, "id_program": "<id_program_atau_null>", "no_akun": <number>, "confidence": <float_0_sampai_1>, "reason": "<string ringkas>"}
]`;
}

async function fetchWithTimeout(url, options, timeout = REQUEST_TIMEOUT_MS) {
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
function cleanJsonResponse(rawText) {
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
async function callOllama(prompt, settings) {
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
      options: { temperature: 0.1, top_p: 0.9 }
    })
  }, REQUEST_TIMEOUT_MS);

  if (!response.ok) throw new Error(`Ollama Error HTTP ${response.status}: ${response.statusText}`);
  const json = await response.json();
  return json.response || '';
}

/**
 * Calls Google Gemini Cloud API
 */
async function callGemini(prompt, settings) {
  const apiKey = (settings.aiApiKey || '').trim();
  if (!apiKey) throw new Error('API Key Google Gemini belum diisi.');

  let model = (settings.aiModelName || 'gemini-2.0-flash').trim().replace(/^\/?models\//i, '');
  if (!model) model = 'gemini-2.0-flash';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1
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
  return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Calls OpenAI / Groq / OpenRouter API
 */
async function callOpenAICompatible(prompt, settings) {
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
    temperature: 0.1
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
export async function classifySemanticBatchClient(items, programs, settings, bypassCache = false) {
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
  const prompt = buildCompactPrompt(uncachedItems, programs);

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
    console.warn('AI Classifier Warning:', err.message);
    return results;
  }
}

/**
 * Diagnostic tool for testing connection to AI providers
 */
export async function testAIConnection(settings) {
  const dummyPrograms = [
    { id: 'prog-zkt-maal', coaCode: 40100101, name: 'Zakat Maal', keywords: ['zakat', 'maal', 'gaji'], description: 'Zakat harta/penghasilan' },
    { id: 'prog-inf-umum', coaCode: 40201001, name: 'Infak Umum', keywords: ['infak', 'sedekah'], description: 'Infak dan sedekah umum' }
  ];
  const testItem = [{ id: 'test_1', cleanedLabel: 'Zakat penghasilan bulanan' }];

  const startTime = Date.now();
  try {
    resetCircuitBreaker();
    const results = await classifySemanticBatchClient(testItem, dummyPrograms, settings, true);
    const latency = Date.now() - startTime;
    const res = results && results[0];

    if (res && res.confidence > 0) {
      return {
        ok: true,
        message: `Koneksi berhasil (${latency}ms). Prediksi: ${res.programId || 'Program Terdeteksi'} (COA: ${res.coa}, Keyakinan: ${Math.round(res.confidence * 100)}%)`,
        latency
      };
    } else {
      return {
        ok: false,
        message: `Koneksi tersambung (${latency}ms) tetapi model mengembalikan respons kosong atau confidence 0.`,
        latency
      };
    }
  } catch (err) {
    return {
      ok: false,
      message: `Gagal terkoneksi: ${err.message}`,
      latency: Date.now() - startTime
    };
  }
}
