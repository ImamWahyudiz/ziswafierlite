const fs = require('fs');
const XLSX = require('../js/vendor/xlsx.full.min.js');

const datasets = [
  { input: 'test_data/train/Input/Input 1.xlsx', golden: 'test_data/train/output/Output 1.xlsx', name: 'Train 1' },
  { input: 'test_data/train/Input/Input 2.xlsx', golden: 'test_data/train/output/Output 2.xlsx', name: 'Train 2' },
  { input: 'test_data/train/Input/Input 3.xlsx', golden: 'test_data/train/output/Output 3.xlsx', name: 'Train 3' },
  { input: 'test_data/train/Input/Input 4.xlsx', golden: 'test_data/train/output/Output 4.xlsx', name: 'Train 4' },
];

for (const ds of datasets) {
  const input = XLSX.read(new Uint8Array(fs.readFileSync(ds.input)), { type: 'array' });
  const golden = XLSX.read(new Uint8Array(fs.readFileSync(ds.golden)), { type: 'array' });
  const inputSheet = XLSX.utils.sheet_to_json(input.Sheets[input.SheetNames[0]], { raw: true });
  const goldenSheet = XLSX.utils.sheet_to_json(golden.Sheets[golden.SheetNames[0]], { raw: true });
  const seen = new Map();
  for (const r of goldenSheet) {
    const k = String(r.KETERANGAN ?? '').trim();
    const coa = Number(r['ACCOUNT NUMBER']) || 0;
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k).add(coa);
  }
  const conflicts = [...seen.entries()].filter(([, coas]) => coas.size > 1);
  if (conflicts.length > 0) {
    console.log(`\n${ds.name}: ${conflicts.length} conflicting labels`);
    for (const [k, coas] of conflicts.slice(0, 10)) {
      console.log(`  "${k.slice(0, 80)}" → [${[...coas].join(', ')}]`);
    }
  }
}