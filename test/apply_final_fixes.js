const fs = require('fs');
const config = JSON.parse(fs.readFileSync('test_data/ziswaf-config.json', 'utf8'));

function findProg(pid) {
  return config.programs.find(p => p.id === pid);
}

// 1. Fitrah - add QR patterns
['QR FITRAH', 'QR FITRI', 'QR FITR', 'QR ZAKAT FITRAH'].forEach(q => {
  if (!findProg('9').keywords.includes(q)) findProg('9').keywords.push(q);
});
console.log('Added QR patterns to Fitrah');

// 2. Quran - remove penghafal/tahfidz
const p5 = findProg('5');
p5.keywords = p5.keywords.filter(k => !['UNTUK PENGHAFAL QURAN', 'PENGHAFAL QURAN', 'TAHFIDZ QURAN', 'TAHFIDZ', 'PENGHAFAL'].some(x => x.toUpperCase() === k.toUpperCase()));
console.log('Removed penghafal/tahfidz from Quran program');

// 3. Add BANGUN RUMAH to Pembangunan
findProg('12').keywords.push('BANGUN RUMAH');
console.log('Added BANGUN RUMAH to Pembangunan');

// 5. Youva -> Umum
const youva = config.donors.find(d => d.name && d.name.toLowerCase().includes('youva'));
if (youva) { youva.defaultProgramId = ''; youva.defaultCoa = 40201001; console.log('Youva -> Umum'); }

// 6. Maria Alesha -> Sarana Fisik
const maria = config.donors.find(d => d.name && d.name.toLowerCase().includes('maria alesha'));
if (maria) { maria.defaultProgramId = '14'; maria.defaultCoa = 40202502; console.log('Maria Alesha -> Sarana Fisik'); }

// 7. Leon -> Palestine
const leon = config.donors.find(d => d.name && d.name.toLowerCase().includes('leon'));
if (leon) { leon.defaultProgramId = '3'; leon.defaultCoa = 40202101; console.log('Leon -> Palestine'); }

// 5. Yatim (2) - add Y ATIM variants
['Y ATIM', 'YAT IM', 'ANAK YATIM', 'ANAK YAT IM'].forEach(k => {
  if (!config.programs.find(p => p.id === '2').keywords.some(e => e.toUpperCase() === k.toUpperCase())) config.programs.find(p => p.id === '2').keywords.push(k);
});
console.log('Added Y ATIM variants to Yatim');

// 6. Ensure Zakat Maal has ZAKAT MAAL and ZAKAT MAL
['ZAKAT MAAL', 'ZAKAT MAL'].forEach(k => {
  if (!config.programs.find(p => p.id === '11').keywords.some(e => e.toUpperCase() === k.toUpperCase())) config.programs.find(p => p.id === '11').keywords.push(k);
});
console.log('Added ZAKAT MAAL/MAL to Zakat Maal');

// 7. Ensure Zakat Parent has ZAKAT
config.programs.find(p => p.id === '16').keywords.push('ZAKAT');
console.log('Added ZAKAT to Zakat Parent');

// 8. Add BANGUN RUMAH to Pembangunan
config.programs.find(p => p.id === '12').keywords.push('BANGUN RUMAH');
console.log('Added BANGUN RUMAH to Pembangunan');

// Save
fs.writeFileSync('test_data/ziswaf-config.json', JSON.stringify(config, null, 2));
console.log('Config updated successfully');