// Read-only: how often does cleanTransactionText find a sender, and which label shapes miss?
// Aggregate output only (shapes have digits masked); no raw labels or names are printed.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.XLSX = require('../js/vendor/xlsx.full.min.js');
const { parseBankStatement } = await import('../js/services/excel_adapter.js');
const { cleanTransactionText } = await import('../js/engine/sanitizer.js');
const root = new URL('../test_data/test/', import.meta.url);
if (!existsSync(root)) { console.log('no data (test_data/test missing)'); process.exit(0); }

const shapes = new Map();
let total = 0, withSender = 0, missing = 0, missingWithPartner = 0;
for (const name of readdirSync(root).filter(n => /\.xlsx$/i.test(n)).sort()) {
  const rows = await parseBankStatement(new Uint8Array(readFileSync(new URL(name, root))));
  for (const row of rows) {
    total++;
    const { extractedSenderName } = cleanTransactionText(row.rawLabel, []);
    if (extractedSenderName) { withSender++; continue; }
    missing++;
    if (String(row.partner || '').trim()) missingWithPartner++;
    const shape = String(row.rawLabel || '').trim().split(/\s+/).slice(0, 3).join(' ').replace(/\d+/g, '#').toUpperCase();
    shapes.set(shape, (shapes.get(shape) || 0) + 1);
  }
}
const top = [...shapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
console.log(JSON.stringify({ total, withSender, senderRate: +(withSender / total).toFixed(3), missing, missingWithPartner }));
for (const [shape, n] of top) console.log(String(n).padStart(5), shape);
