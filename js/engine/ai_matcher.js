let consecutiveFailures = 0;
let circuitOpen = false;
let circuitOpenTime = 0;
const CIRCUIT_THRESHOLD = 2;
const CIRCUIT_TIMEOUT = 60000;
const REQUEST_TIMEOUT = 2000;

export function resetCircuitBreaker() {
  consecutiveFailures = 0;
  circuitOpen = false;
  circuitOpenTime = 0;
}

function buildPrompt(cleanedLabel, programs) {
  const programLines = programs
    .map(p => {
      const parts = [p.id, p.name, p.coaCode];
      if (p.tailCode) parts.push(p.tailCode);
      if (p.description) parts.push(p.description);
      return parts.join(' | ');
    })
    .join('\n');

  return `Anda adalah ahli akuntansi syariah Indonesia untuk dana ZISWAF (Zakat/Infak/Sedekah/Wakaf).
Tugas: Pilih SATU program terbaik untuk transaksi donor berikut.

Deskripsi transaksi: "${cleanedLabel}"

Daftar program tersedia:
${programLines}

Instruksi:
1. Analisis deskripsi transaksi dan cocokkan dengan program yang paling relevan
2. Pertimbangkan konteks syariah dan tujuan ZISWAF
3. Berikan output JSON ONLY, tanpa markdown, tanpa penjelasan tambahan

WAJIB output JSON dalam format PERSIS ini:
{"coa": <number>, "program_id": "<id>", "confidence": <0..1>, "reason": "<alasan singkat bahasa Indonesia>"}

Contoh: {"coa": 11001, "program_id": "PROG-001", "confidence": 0.95, "reason": "Transaksi jelas untuk zakat fitrah"}`;
}

async function fetchWithTimeout(url, options, timeout) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

function parseAIResponse(text, programs) {
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
  const reason = String(parsed.reason || '');
  return { coa, programId, confidence, reason };
}

async function callOllama(prompt, settings) {
  const endpoint = settings.ollamaEndpoint || 'http://localhost:11434/api/chat';
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen2.5:3b-instruct',
      messages: [{ role: 'user', content: prompt }],
      stream: false
    })
  }, REQUEST_TIMEOUT);
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const json = await response.json();
  return json.message?.content || '';
}

async function callGemini(prompt, settings) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': settings.aiApiKey || ''
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 }
    })
  }, REQUEST_TIMEOUT);
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
  const json = await response.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callOpenAI(prompt, settings) {
  const url = 'https://api.openai.com/v1/chat/completions';
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.aiApiKey || ''}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2
    })
  }, REQUEST_TIMEOUT);
  if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
  const json = await response.json();
  return json.choices?.[0]?.message?.content || '';
}

export async function classifySemanticClient(cleanedLabel, programs, settings) {
  if (!cleanedLabel || cleanedLabel.trim() === '') return null;
  if (settings?.aiMode === 'OFF') return null;
  if (!settings?.aiMode) return null;

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
  } catch {
    consecutiveFailures++;
    if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
      circuitOpen = true;
      circuitOpenTime = Date.now();
    }
    return null;
  }
}
