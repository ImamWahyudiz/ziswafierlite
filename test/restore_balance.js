const fs = require('fs');
const config = JSON.parse(fs.readFileSync('test_data/ziswaf-config.json', 'utf8'));

function findProg(pid) {
  return config.programs.find(p => p.id === pid);
}

// ===== RESTORE: Program 7 needs useful generic keywords (but NO Shadaqah) =====
const prog7 = config.programs.find(p => p.id === '7');
const restore7 = ['donasi', 'sedekah', 'sodaqoh', 'infaq', 'infak', 'makan', 'makan santri', 'makan pondok', 'mkan santri', 'untuk santri', 'operasional pondok', 'untuk masjid', 'untuk pesantren', 'program pondok', 'beasiswa santri', 'yayasan islam center', 'makan', 'makan pondok'];
for (const k of restore7) {
  if (!prog7.keywords.some(existing => existing.toLowerCase() === k.toLowerCase())) {
    prog7.keywords.push(k);
  }
}
console.log('Restored useful generic keywords to program 7');

// ===== Add Zakat Parent (16) generic keywords =====
const prog16 = config.programs.find(p => p.id === '16');
const zakatParentKeywords = ['ZAKAT', 'ZAKAT MAL', 'ZAKAT MAAL', 'ZAKAT HARTA', 'ZAKAT PENGHASILAN', 'ZAKAT PROFESI', 'PEMBERSIHAN HARTA'];
for (const k of zakatParentKeywords) {
  if (!prog16.keywords.some(e => e.toUpperCase() === k.toUpperCase())) {
    prog16.keywords.push(k);
  }
}
console.log('Added ZAKAT parent keywords to program 16');

// ===== Fix Zakat Maal (11) - remove generic ZAKAT =====
const prog11_a = config.programs.find(p => p.id === '11');
prog11_a.keywords = prog11_a.keywords.filter(k => !['ZAKAT', 'ZAKAT MAL', 'ZAKAT MAAL'].includes(k.toUpperCase()));
console.log('Removed generic ZAKAT from Zakat Maal');

// ===== Zakat Fitrah (9) - add QR patterns =====
const prog9_a = config.programs.find(p => p.id === '9');
const qrPatterns_a = ['QR FITRAH', 'QR FITRI', 'QR FITR', 'QR ZAKAT FITRAH'];
for (const q of qrPatterns_a) {
  if (!prog9_a.keywords.includes(q)) prog9_a.keywords.push(q);
}
console.log('Added QR FITRAH patterns to Fitrah');

// ===== Shadaqah should go to Unauthorized - remove from generic program =====
const prog7_a = config.programs.find(p => p.id === '7');
prog7_a.keywords = prog7_a.keywords.filter(k => !['SHADAQAH', 'SADAQAH', 'SHODAQOH', 'SODAQOH', 'SADAQAH'].includes(k.toUpperCase()));
console.log('Removed Shadaqah from generic program');

// ===== Remove penghafal/tahfidz from Quran program =====
const prog5 = config.programs.find(p => p.id === '5');
prog5.keywords = prog5.keywords.filter(k => !['PENGHAFAL', 'TAHFIDZ', 'UNTUK PENGHAFAL'].includes(k.toUpperCase()));
console.log('Removed penghafal/tahfidz from Quran program');

// ===== Add penghafal/tahfidz to Buka Berbahagia (6) =====
const prog6 = config.programs.find(p => p.id === '6');
const addTo6 = ['UNTUK PENGHAFAL', 'PENGHAFAL', 'TAHFIDZ', 'PENGHAFAL QURAN', 'TAHFIDZ QURAN', 'IFTHAR RAMADHAN', 'BUKA PUASA', 'UNTUK BUKA', 'BUKA BERBAHAGIA', 'IFTAR', 'BERBUKA'];
for (const k of addTo6) {
  if (!prog6.keywords.some(e => e.toUpperCase() === k.toUpperCase())) {
    prog6.keywords.push(k);
  }
}
console.log('Added penghafal/tahfidz/iftar to Buka Berbahagia');

// ===== Ensure Pembangunan beats Wakaf Umum =====
const prog12 = config.programs.find(p => p.id === '12');
const addTo12 = ['WAKAF BANGUN', 'BANGUN WAKAF', 'WAKAF PEMBANGUN', 'BANGUN RUMAH QURAN', 'WAKAF RENOVASI', 'RENOVASI MASJID', 'PEMBANGUNAN MASJID', 'PEMBANGUNAN KAWASAN', 'WAQAF PEMBANGUNAN', 'INFAQ PEMBANGUNAN', 'INFAQ PEMBANGUNAN', 'WAKAF KAWASAN', 'WAKAF PEMBANGUNAN', 'BANGUNAN', 'BANGUNAN MASJID', 'PEMBANGUNAN MASJID', 'PEMBANGUNAN KAWASAN', 'WAQAF PEMBANGUNAN', 'INFQ PEMBANGUNAN', 'UNTUK PEMBANGUNAN'];
for (const k of addTo12) {
  if (!prog12.keywords.some(e => e.toUpperCase() === k.toUpperCase())) {
    prog12.keywords.push(k);
  }
}
console.log('Added strong Pembangunan keywords to program 12');

// ===== Wakaf Umum - keep only generic WAKAF =====
const prog13 = config.programs.find(p => p.id === '13');
prog13.keywords = prog13.keywords.filter(k => ['WAKAF', 'WKF', 'WAAKAF', 'WAKF'].includes(k.toUpperCase()));
console.log('Wakaf Umum keywords:', prog13.keywords.length);

// ===== Zakat Parent hierarchy =====
const prog9b = config.programs.find(p => p.id === '9');
const prog11b = config.programs.find(p => p.id === '11');
prog9b.parentCoaCode = 40100000;
prog11b.parentCoaCode = 40100000;

// ===== Add QR FITRAH patterns =====
const qrPatterns_b = ['QR FITRAH', 'QR FITRI', 'QR FITR', 'QR ZAKAT FITRAH'];
for (const q of qrPatterns_b) {
  if (!prog9b.keywords.includes(q)) prog9b.keywords.push(q);
}

// ===== Remove Shadaqah from generic program =====
findProg('7').keywords = findProg('7').keywords.filter(k => !['SHADAQAH', 'SADAQAH', 'SHODAQOH', 'SODAQOH', 'SADAQAH'].includes(k.toUpperCase()));

// ===== Remove penghafal/tahfidz from Quran program =====
findProg('5').keywords = findProg('5').keywords.filter(k => !['PENGHAFAL', 'TAHFIDZ', 'UNTUK PENGHAFAL'].includes(k.toUpperCase()));

// ===== Add penghafal/tahfidz to Buka Berbahagia =====
const addTo6b = ['UNTUK PENGHAFAL', 'PENGHAFAL', 'TAHFIDZ', 'PENGHAFAL QURAN', 'TAHFIDZ QURAN', 'IFTHAR RAMADHAN', 'BUKA PUASA', 'UNTUK BUKA', 'BUKA BERBAHAGIA', 'IFTAR', 'BERBUKA'];
for (const k of addTo6b) {
  if (!findProg('6').keywords.some(e => e.toUpperCase() === k.toUpperCase())) {
    findProg('6').keywords.push(k);
  }
}

// ===== Ensure Pembangunan beats Wakaf Umum =====
const addTo12b = ['WAKAF BANGUN', 'BANGUN WAKAF', 'WAKAF PEMBANGUN', 'BANGUN RUMAH QURAN', 'WAKAF RENOVASI', 'RENOVASI MASJID', 'PEMBANGUNAN MASJID', 'PEMBANGUNAN KAWASAN', 'WAQAF PEMBANGUNAN', 'INFAQ PEMBANGUNAN', 'INFAQ PEMBANGUNAN', 'WAKAF KAWASAN', 'WAKAF PEMBANGUNAN', 'BANGUNAN', 'BANGUNAN MASJID', 'PEMBANGUNAN MASJID', 'PEMBANGUNAN KAWASAN', 'WAQAF PEMBANGUNAN', 'INFQ PEMBANGUNAN', 'UNTUK PEMBANGUNAN'];
for (const k of addTo12b) {
  if (!findProg('12').keywords.some(e => e.toUpperCase() === k.toUpperCase())) {
    findProg('12').keywords.push(k);
  }
}

// ===== Youva donor -> Umum =====
const youva = config.donors.find(d => d.name && d.name.toLowerCase().includes('youva'));
if (youva) { youva.defaultProgramId = ''; youva.defaultCoa = 40201001; console.log('Youva -> Umum'); }

// ===== Maria Alesha -> Sarana Fisik =====
const maria = config.donors.find(d => d.name && d.name.toLowerCase().includes('maria alesha'));
if (maria) { maria.defaultProgramId = '14'; maria.defaultCoa = 40202502; console.log('Maria Alesha -> Sarana Fisik'); }

// ===== Leon -> Palestine =====
const leon = config.donors.find(d => d.name && d.name.toLowerCase().includes('leon'));
if (leon) { leon.defaultProgramId = '3'; leon.defaultCoa = 40202101; console.log('Leon -> Palestine'); }

// ===== Zakat Parent hierarchy =====
findProg('9').parentCoaCode = 40100000;
findProg('11').parentCoaCode = 40100000;

fs.writeFileSync('test_data/ziswaf-config.json', JSON.stringify(config, null, 2));
console.log('Config fully updated with all AI suggestions');