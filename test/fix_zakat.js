const fs = require('fs');
const config = JSON.parse(fs.readFileSync('test_data/ziswaf-config.json', 'utf8'));

function findProg(pid) {
  return config.programs.find(p => p.id === pid);
}

// ===== Fix Zakat Parent (16): REMOVE 'ZAKAT' keyword - it should be fallback only =====
const p16 = config.programs.find(p => p.id === '16');
p16.keywords = p16.keywords.filter(k => k.toUpperCase() !== 'ZAKAT');
p16.priority = 2; // Low priority, fallback only
console.log('Program 16 (Zakat Parent) keywords:', p16.keywords);

// ===== Ensure Zakat Maal (11) has proper keywords =====
const p11 = config.programs.find(p => p.id === '11');
p11.priority = 10;
console.log('Program 11 (Zakat Maal) keywords:', p11.keywords);

// ===== Ensure parent hierarchy =====
findProg('9').parentCoaCode = 40100000;
findProg('11').parentCoaCode = 40100000;

// ===== Add QR FITRAH patterns to Fitrah =====
['QR FITRAH', 'QR FITRI', 'QR FITR', 'QR ZAKAT FITRAH'].forEach(q => {
  if (!findProg('9').keywords.some(e => e.toUpperCase() === q.toUpperCase())) findProg('9').keywords.push(q);
});
console.log('Added QR FITRAH patterns to Fitrah');

// ===== Ensure Zakat Parent (16) has NO ZAKAT keyword (fallback only) =====
const prog16 = findProg('16');
prog16.keywords = prog16.keywords.filter(k => k.toUpperCase() !== 'ZAKAT');
console.log('Program 16 (Zakat Parent) keywords:', prog16.keywords);

// Save
fs.writeFileSync('test_data/ziswaf-config.json', JSON.stringify(config, null, 2));
console.log('Config updated successfully');
