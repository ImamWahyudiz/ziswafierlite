import { generateKeywordSuggestions } from '../js/engine/keyword_generator.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('test_data/ziswaf-config.json', 'utf8'));
console.log('Running AI keyword generator...');
console.log('Provider:', config.settings.aiMode, 'Key:', config.settings.aiApiKey ? 'present' : 'MISSING');
const t0 = Date.now();
try {
  const suggestions = await generateKeywordSuggestions(config, config.settings);
  const elapsed = Date.now() - t0;
  console.log('\n=== AI RESULTS (completed in', elapsed, 'ms) ===');
  console.log('\nCOLLISIONS (' + suggestions.collisions.length + '):');
  for (const c of suggestions.collisions) {
    console.log('  - ' + c.keyword + ' in [' + (c.programs||[]).join(', ') + '] -> ' + (c.suggestion || ''));
  }
  console.log('\nMISSING (' + suggestions.missing.length + '):');
  for (const m of suggestions.missing) {
    console.log('  - ' + m.program_id + ': add ' + m.suggested_keyword + ' - ' + (m.reason || ''));
  }
  console.log('\nVARIANTS (' + suggestions.variants.length + ' programs):');
  for (const v of suggestions.variants) {
    console.log('  - ' + v.program_id + ': "' + v.keyword + '" -> [' + (v.variants||[]).slice(0,5).join(', ') + ']');
  }
  console.log('\nHIERARCHY FIXES (' + suggestions.hierarchy_fixes.length + '):');
  for (const h of suggestions.hierarchy_fixes) {
    console.log('  - ' + h.program_id + ': ' + h.keyword + ' -> ' + h.action + ' - ' + (h.reason || ''));
  }
  fs.writeFileSync('test_data/ai_suggestions.json', JSON.stringify(suggestions, null, 2));
  console.log('\nSuggestions saved to test_data/ai_suggestions.json');
} catch(e) {
  console.error('AI FAILED:', e.message);
}