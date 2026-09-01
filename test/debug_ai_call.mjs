import { callGemini, cleanJsonResponse } from '../js/engine/ai_matcher.js';
import { buildKeywordAnalysisPrompt } from '../js/engine/keyword_generator.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('test_data/ziswaf-config.json', 'utf8'));
const settings = config.settings;

const prompt = buildKeywordAnalysisPrompt(config);

console.log('Prompt length:', prompt.length);
console.log('First 500 chars:', prompt.slice(0, 500));
console.log('Last 200 chars:', prompt.slice(-200));

console.log('\nCalling Gemini...');
const t0 = Date.now();
try {
  const rawResponse = await callGemini(prompt, settings);
  const elapsed = Date.now() - t0;
  console.log('Raw response (' + elapsed + 'ms):');
  console.log('--- RAW RESPONSE START ---');
  console.log(rawResponse);
  console.log('--- RAW RESPONSE END ---');

  const cleanedJson = cleanJsonResponse(rawResponse);
  console.log('\nCleaned JSON:');
  console.log(cleanedJson);

  let parsed = {};
  try { parsed = JSON.parse(cleanedJson); } catch { parsed = {}; }
  console.log('\nParsed structure:', Object.keys(parsed));
} catch (e) {
  console.error('ERROR:', e.message, e.stack);
}