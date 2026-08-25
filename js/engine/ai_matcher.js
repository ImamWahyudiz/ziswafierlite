let consecutiveFailures = 0;
let circuitOpen = false;
let circuitOpenTime = 0;
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_TIMEOUT = 30000;
const REQUEST_TIMEOUT = 15000; // 15 seconds for robust LLM latency

export function resetCircuitBreaker() {
  consecutiveFailures = 0;
  circuitOpen = false;
  circuitOpenTime = 0;
}

function buildBatchPrompt(items, programs) {
  const programLines = programs
    .map(p => {
      const parts = [p.id, p.name, p.coaCode];
      if (p.tailCode) parts.push(`Ekor:${p.tailCode}`);
      if (p.keywords?.length) parts.push(`Keywords:${p.keywords.join(',')}`);
      if (p.description) parts.push(`Desc:${p.description}`);
      return parts.join(' | ');
    })
    .join('\n');

  const itemsJson = JSON.stringify(items.map(it => ({ id: it.id, label: it.cleanedLabel || it.rawLabel })));

  return `Anda adalah ahli akuntansi syariah Indonesia untuk klasifikasi dana ZISWAF (Zakat, Infak, Sedekah, DSKL, Wakaf).
Tugas: Klasifikasikan setiap transaksi bank berikut ke dalam SATU program dan nomor COA yang paling relevan.

Daftar program tersedia:
${programLines}

Daftar transaksi:
${itemsJson}

Instruksi:
1. Analisis deskripsi transaksi dan cocokkan dengan program & COA yang paling relevan.
2. Pertimbangkan konteks syariah, istilah zakat/infak/sedekah/wakaf/dskl/fidyah/kurban/operasional.
3. Kembalikan HANYA JSON murni berupa array objek [ {...}, {...} ] tanpa markdown backticks, tanpa penjelasan di luar JSON.

Format setiap objek dalam array WAJIB persis seperti ini:
{"id": "<id_transaksi>", "coa": <number>, "program_id": "<id_program>", "confidence": <0..1>, "reason": "<alasan singkat bahasa Indonesia>"}

Contoh:
[
  {"id": "1", "coa": 40100101, "program_id": "prog-zkt-maal", "confidence": 0.95, "reason": "Transfer zakat profesi bulanan"},
  {"id": "2", "coa": 40201001, "program_id": "prog-inf-umum", "confidence": 0.88, "reason": "Sedekah subuh harian"}
]`;
}

function parseBatchAIResponse(text, programs) {
  if (!text) return [];
  let cleaned = text.trim();
  cleaned = cleaned.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
    return [];
  }
  const jsonStr = cleaned.slice(firstBracket, lastBracket + 1);
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const results = [];
  for (const item of parsed) {
    if (!item || item.id === undefined) continue;
    const coa = Number(item.coa);
    const confidence = Number(item.confidence);
    const programId = item.program_id || null;
    if (!Number.isFinite(coa) || coa <= 0 || !Number.isInteger(coa)) continue;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) continue;
    if (!programId || !programs.some(p => p.id === programId)) continue;
    const reason = String(item.reason || 'Diprediksi oleh Model AI').trim();
    results.push({ id: item.id, coa, programId, confidence, reason });
  }
  return results;
}

function buildPrompt(cleanedLabel, programs) {
  const programLines = programs
    .map(p => {
      const parts = [p.id, p.name, p.coaCode];
      if (p.tailCode) parts.push(`Ekor:${p.tailCode}`);
      if (p.keywords?.length) parts.push(`Keywords:${p.keywords.join(',')}`);
      if (p.description) parts.push(`Desc:${p.description}`);
      return parts.join(' | ');
    })
    .join('\n');

  return `Anda adalah ahli akuntansi syariah Indonesia untuk klasifikasi dana ZISWAF (Zakat, Infak, Sedekah, DSKL, Wakaf).
Tugas: Pilih SATU program dan nomor COA terbaik berdasarkan keterangan transaksi bank berikut.

Deskripsi transaksi: "${cleanedLabel}"

Daftar program tersedia:
${programLines}

Instruksi:
1. Analisis deskripsi transaksi dan cocokkan dengan program & COA yang paling relevan.
2. Pertimbangkan konteks syariah, istilah zakat/infak/sedekah/wakaf/dskl.
3. Berikan output JSON ONLY murni, tanpa markdown backticks, tanpa penjelasan di luar JSON.

WAJIB output JSON dalam format PERSIS ini:
{"coa": <number>, "program_id": "<id>", "confidence": <0..1>, "reason": "<alasan singkat bahasa Indonesia>"}

Contoh: {"coa": 40100101, "program_id": "prog-zkt-maal", "confidence": 0.95, "reason": "Keterangan mengandung transfer zakat penghasilan bulanan"}`;
}

async function fetchWithTimeout(url, options, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Permintaan AI waktu habis (timeout ${timeout / 1000}s). Periksa koneksi internet.`);
    }
    throw error;
  }
}

function parseAIResponse(text, programs) {
  if (!text) return null;
  let cleaned = text.trim();
  cleaned = cleaned.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }
  const jsonStr = cleaned.slice(firstBrace, lastBrace + 1);
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  const coa = Number(parsed.coa);
  const confidence = Number(parsed.confidence);
  const programId = parsed.program_id || null;
  if (!Number.isFinite(coa) || coa <= 0 || !Number.isInteger(coa)) {
    return null;
  }
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return null;
  }
  if (!programId || !programs.some(p => p.id === programId)) {
    return null;
  }
  const reason = String(parsed.reason || 'Diprediksi oleh Model AI').trim();
  return { coa, programId, confidence, reason };
}

function sanitizeGeminiModel(name) {
  let m = String(name || 'gemini-2.0-flash').trim();
  m = m.replace(/^\/?models\//i, '').trim();
  m = m.replace(/\s+/g, '-');
  m = m.toLowerCase();
  return m || 'gemini-2.0-flash';
}

function sanitizeOpenAIModel(name) {
  let m = String(name || 'gpt-4o-mini').trim();
  m = m.replace(/\s+/g, '-');
  m = m.toLowerCase();
  return m || 'gpt-4o-mini';
}

function sanitizeOllamaModel(name) {
  let m = String(name || 'qwen2.5:3b-instruct').trim();
  return m || 'qwen2.5:3b-instruct';
}

async function callOllama(prompt, settings) {
  const endpoint = (settings.ollamaEndpoint || 'http://localhost:11434/api/chat').trim();
  const model = sanitizeOllamaModel(settings.aiModelName);
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      stream: false
    })
  }, REQUEST_TIMEOUT);
  if (!response.ok) throw new Error(`Ollama Error HTTP ${response.status}: ${response.statusText}`);
  const json = await response.json();
  return json.message?.content || '';
}

async function callGemini(prompt, settings) {
  const model = sanitizeGeminiModel(settings.aiModelName);
  const apiKey = (settings.aiApiKey || '').trim();
  if (!apiKey) throw new Error('API Key Gemini belum diisi. Masukkan API Key di tab Pengaturan AI.');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 }
    })
  }, REQUEST_TIMEOUT);

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

async function callOpenAI(prompt, settings) {
  const model = sanitizeOpenAIModel(settings.aiModelName);
  const apiKey = (settings.aiApiKey || '').trim();
  if (!apiKey) throw new Error('API Key OpenAI belum diisi. Masukkan API Key di tab Pengaturan AI.');

  const url = 'https://api.openai.com/v1/chat/completions';
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      response_format: { type: "json_object" }
    })
  }, REQUEST_TIMEOUT);

  if (!response.ok) {
    let errBody = '';
    try {
      const errJson = await response.json();
      errBody = errJson.error?.message || response.statusText;
    } catch {
      errBody = response.statusText;
    }
    throw new Error(`OpenAI API Error (${response.status}): ${errBody}`);
  }

  const json = await response.json();
  return json.choices?.[0]?.message?.content || '';
}

export async function testAIConnection(settings) {
  const mode = settings?.aiMode;
  if (!mode || mode === 'OFF') {
    throw new Error('Mode AI saat ini OFF. Pilih provider (GEMINI / OPENAI / LOCAL_OLLAMA) terlebih dahulu.');
  }

  const testPrompt = `Tes koneksi ZISWAF. Jawab JSON murni: {"status": "ok", "provider": "${mode}"}`;
  let rawResponse = '';
  let resolvedModel = '';

  if (mode === 'GEMINI') {
    resolvedModel = sanitizeGeminiModel(settings.aiModelName);
    rawResponse = await callGemini(testPrompt, settings);
  } else if (mode === 'OPENAI') {
    resolvedModel = sanitizeOpenAIModel(settings.aiModelName);
    rawResponse = await callOpenAI(testPrompt, settings);
  } else if (mode === 'LOCAL_OLLAMA') {
    resolvedModel = sanitizeOllamaModel(settings.aiModelName);
    rawResponse = await callOllama(testPrompt, settings);
  } else {
    throw new Error(`Provider AI tidak dikenali: ${mode}`);
  }

  return {
    ok: true,
    provider: mode,
    model: resolvedModel,
    response: rawResponse
  };
}

export async function classifySemanticClient(cleanedLabel, programs, settings) {
  if (!cleanedLabel || cleanedLabel.trim() === '') return null;
  if (settings?.aiMode === 'OFF' || !settings?.aiMode) return null;

  if (circuitOpen) {
    if (Date.now() - circuitOpenTime < CIRCUIT_TIMEOUT) {
      return null;
    }
    circuitOpen = false;
    consecutiveFailures = 0;
  }

  const prompt = buildPrompt(cleanedLabel, programs);
  let resultText;

  try {
    const mode = settings.aiMode;
    if (mode === 'LOCAL_OLLAMA') {
      resultText = await callOllama(prompt, settings);
    } else if (mode === 'GEMINI') {
      resultText = await callGemini(prompt, settings);
    } else if (mode === 'OPENAI') {
      resultText = await callOpenAI(prompt, settings);
    } else {
      return null;
    }

    const result = parseAIResponse(resultText, programs);
    if (!result) {
      consecutiveFailures++;
      if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
        circuitOpen = true;
        circuitOpenTime = Date.now();
      }
      return null;
    }

    consecutiveFailures = 0;
    circuitOpen = false;
    return result;
  } catch (err) {
    console.warn('[AI Matcher]', err.message);
    consecutiveFailures++;
    if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
      circuitOpen = true;
      circuitOpenTime = Date.now();
    }
    return null;
  }
}

export async function classifySemanticBatchClient(items, programs, settings) {
  if (!items || items.length === 0) return [];
  if (settings?.aiMode === 'OFF' || !settings?.aiMode) return [];

  if (circuitOpen) {
    if (Date.now() - circuitOpenTime < CIRCUIT_TIMEOUT) {
      return [];
    }
    circuitOpen = false;
    consecutiveFailures = 0;
  }

  const prompt = buildBatchPrompt(items, programs);
  let resultText;

  try {
    const mode = settings.aiMode;
    if (mode === 'LOCAL_OLLAMA') {
      resultText = await callOllama(prompt, settings);
    } else if (mode === 'GEMINI') {
      resultText = await callGemini(prompt, settings);
    } else if (mode === 'OPENAI') {
      resultText = await callOpenAI(prompt, settings);
    } else {
      return [];
    }

    const results = parseBatchAIResponse(resultText, programs);
    if (!results || results.length === 0) {
      consecutiveFailures++;
      if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
        circuitOpen = true;
        circuitOpenTime = Date.now();
      }
      return [];
    }

    consecutiveFailures = 0;
    circuitOpen = false;
    return results;
  } catch (err) {
    console.warn('[AI Matcher Batch]', err.message);
    consecutiveFailures++;
    if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
      circuitOpen = true;
      circuitOpenTime = Date.now();
    }
    return [];
  }
}
