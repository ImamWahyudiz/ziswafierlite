const fs = require('fs');
const config = JSON.parse(fs.readFileSync('test_data/ziswaf-config.json', 'utf8'));

function findProg(pid) {
  return config.programs.find(p => p.id === pid);
}

// ===== 1. Fix Zakat Maal (11) - add SPECIFIC Zakat Maal keywords =====
const prog11 = findProg('11');
const zakatMaalKeywords = ['ZAKAT MAAL', 'ZAKAT MAL', 'ZAKAT HARTA', 'ZAKAT PENGHASILAN', 'ZAKAT PROFESI', 'ZKT MAL', 'ZKT PENGHASILAN', 'Z MAAL', 'ZKT MAL', 'Z MAAL', 'PEMBERSIHAN HARTA'];
for (const k of zakatMaalKeywords) {
  if (!findProg('11').keywords.some(e => e.toUpperCase() === k.toUpperCase())) findProg('11').keywords.push(k);
}
console.log('Fixed Zakat Maal (11) keywords:', findProg('11').keywords.length);

// ===== Zakat Parent (16) - should be FALLBACK only, no keyword matching =====
const prog16 = config.programs.find(p => p.id === '16');
prog16.keywords = prog16.keywords.filter(k => !['ZAKAT', 'ZAKAT MAL', 'ZAKAT MAAL', 'ZAKAT HARTA', 'ZAKAT PENGHASILAN', 'ZAKAT PROFESI'].includes(k.toUpperCase()));
if (!findProg('16').keywords.includes('PEMBERSIHAN HARTA')) findProg('16').keywords.push('PEMBERSIHAN HARTA');
console.log('Fixed Zakat Parent (16) - fallback only');

// ===== Zakat Fitrah (9) - ensure QR patterns and FITRAH variants =====
const prog9 = findProg('9');
const fitrahVariants = ['FITRAH', 'FITRI', 'FITR', 'ZKT FITRAH', 'ZKT FITRI', 'Z FITRAH', 'ZAKAT F', 'ZAKAT FITRAH', 'ZAKAT FITRI', 'ZKT FITR', 'FITR', 'BERAS FITRAH', 'QR FITRAH', 'QR FITRI', 'QR FITR', 'QR ZAKAT FITRAH'];
for (const v of fitrahVariants) {
  if (!findProg('9').keywords.some(e => e.toUpperCase() === v.toUpperCase())) findProg('9').keywords.push(v);
}
console.log('Added FITRAH variants to program 9');

// ===== QR patterns for Fitrah =====
['QR FITRAH', 'QR FITRI', 'QR FITR', 'QR ZAKAT FITRAH'].forEach(q => { if (!findProg('9').keywords.includes(q)) findProg('9').keywords.push(q); });
console.log('Added QR FITRAH patterns to Fitrah');

// ===== Remove generic ZAKAT from Zakat Maal (11) =====
findProg('11').keywords = findProg('11').keywords.filter(k => !['ZAKAT', 'ZAKAT MAL', 'ZAKAT MAAL'].includes(k.toUpperCase()));
console.log('Removed generic ZAKAT from Zakat Maal');

// ===== Ensure program 7 has useful generic keywords but NO Shadaqah =====
findProg('7').keywords = findProg('7').keywords.filter(k => !['SHADAQAH', 'SADAQAH', 'SHODAQOH', 'SODAQOH', 'SADAQAH'].includes(k.toUpperCase()));
const useful7 = ['donasi', 'sedekah', 'sodaqoh', 'infaq', 'infak', 'makan', 'makan santri', 'makan pondok', 'mkan santri', 'untuk santri', 'operasional pondok', 'untuk masjid', 'untuk pesantren', 'program pondok', 'beasiswa santri', 'yayasan islam center', 'makan', 'makan pondok'];
for (const k of useful7) {
  if (!findProg('7').keywords.some(e => e.toLowerCase() === k.toLowerCase())) findProg('7').keywords.push(k);
}
console.log('Fixed program 7 keywords:', findProg('7').keywords.length);

// ===== Remove penghafal/tahfidz from Quran program (5) =====
findProg('5').keywords = findProg('5').keywords.filter(k => !['PENGHAFAL', 'TAHFIDZ', 'UNTUK PENGHAFAL'].includes(k.toUpperCase()));
console.log('Removed penghafal/tahfidz from Quran program');

// ===== Add penghafal/tahfidz to Buka Berbahagia (6) =====
findProg('6').keywords.push(...['UNTUK PENGHAFAL', 'PENGHAFAL', 'TAHFIDZ', 'PENGHAFAL QURAN', 'TAHFIDZ QURAN', 'IFTHAR RAMADHAN', 'BUKA PUASA', 'UNTUK BUKA', 'BUKA BERBAHAGIA', 'IFTAR', 'BERBUKA'].filter(k => !findProg('6').keywords.some(e => e.toUpperCase() === k.toUpperCase())));
console.log('Added penghafal/tahfidz/iftar to Buka Berbahagia');

// ===== Ensure Pembangunan (12) beats Wakaf Umum =====
findProg('12').keywords.push(...['WAKAF BANGUN', 'BANGUN WAKAF', 'WAKAF PEMBANGUN', 'BANGUN RUMAH QURAN', 'WAKAF RENOVASI', 'RENOVASI MASJID', 'PEMBANGUNAN MASJID', 'PEMBANGUNAN KAWASAN', 'WAQAF PEMBANGUNAN', 'INFAQ PEMBANGUNAN', 'INFAQ PEMBANGUNAN', 'WAKAF KAWASAN', 'WAKAF PEMBANGUNAN', 'BANGUNAN', 'BANGUNAN MASJID', 'PEMBANGUNAN MASJID', 'PEMBANGUNAN KAWASAN', 'WAQAF PEMBANGUNAN', 'INFQ PEMBANGUNAN', 'UNTUK PEMBANGUNAN'].filter(v => !findProg('12').keywords.some(e => e.toUpperCase() === v.toUpperCase())));
console.log('Added strong Pembangunan keywords to program 12');

// ===== Wakaf Umum (13) - keep only generic WAKAF =====
findProg('13').keywords = findProg('13').keywords.filter(k => ['WAKAF', 'WKF', 'WAAKAF', 'WAKF'].includes(k.toUpperCase()));
console.log('Wakaf Umum keywords:', findProg('13').keywords.length);

// ===== Zakat Parent hierarchy =====
findProg('9').parentCoaCode = 40100000;
findProg('11').parentCoaCode = 40100000;

// ===== Add QR FITRAH patterns =====
['QR FITRAH', 'QR FITRI', 'QR FITR', 'QR ZAKAT FITRAH'].forEach(q => { if (!findProg('9').keywords.includes(q)) findProg('9').keywords.push(q); });

// ===== Remove Shadaqah from generic program =====
findProg('7').keywords = findProg('7').keywords.filter(k => !['SHADAQAH', 'SADAQAH', 'SHODAQOH', 'SODAQOH', 'SADAQAH'].includes(k.toUpperCase()));

// ===== Remove penghafal/tahfidz from Quran program =====
findProg('5').keywords = findProg('5').keywords.filter(k => !['PENGHAFAL', 'TAHFIDZ', 'UNTUK PENGHAFAL'].includes(k.toUpperCase()));

// ===== Add penghafal/tahfidz to Buka Berbahagia =====
findProg('6').keywords.push(...['UNTUK PENGHAFAL', 'PENGHAFAL', 'TAHFIDZ', 'PENGHAFAL QURAN', 'TAHFIDZ QURAN', 'IFTHAR RAMADHAN', 'BUKA PUASA', 'UNTUK BUKA', 'BUKA BERBAHAGIA', 'IFTAR', 'BERBUKA'].filter(k => !findProg('6').keywords.some(e => e.toUpperCase() === k.toUpperCase())));
console.log('Added penghafal/tahfidz/iftar to Buka Berbahagia');

// ===== Ensure Pembangunan beats Wakaf Umum =====
findProg('12').keywords.push(...['WAKAF BANGUN', 'BANGUN WAKAF', 'WAKAF PEMBANGUN', 'BANGUN RUMAH QURAN', 'WAKAF RENOVASI', 'RENOVASI MASJID', 'PEMBANGUNAN MASJID', 'PEMBANGUNAN KAWASAN', 'WAQAF PEMBANGUNAN', 'INFAQ PEMBANGUNAN', 'INFAQ PEMBANGUNAN', 'WAKAF KAWASAN', 'WAKAF PEMBANGUNAN', 'BANGUNAN', 'BANGUNAN MASJID', 'PEMBANGUNAN MASJID', 'PEMBANGUNAN KAWASAN', 'WAQAF PEMBANGUNAN', 'INFQ PEMBANGUNAN', 'UNTUK PEMBANGUNAN'].filter(v => !findProg('12').keywords.some(e => e.toUpperCase() === v.toUpperCase())));
console.log('Added strong Pembangunan keywords to program 12');

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

// ===== Add QR FITRAH patterns =====
['QR FITRAH', 'QR FITRI', 'QR FITR', 'QR ZAKAT FITRAH'].forEach(q => { if (!findProg('9').keywords.includes(q)) findProg('9').keywords.push(q); });

// ===== Remove Shadaqah from generic program =====
findProg('7').keywords = findProg('7').keywords.filter(k => !['SHADAQAH', 'SADAQAH', 'SHODAQOH', 'SODAQOH', 'SADAQAH'].includes(k.toUpperCase()));

// ===== Remove penghafal/tahfidz from Quran program =====
findProg('5').keywords = findProg('5').keywords.filter(k => !['PENGHAFAL', 'TAHFIDZ', 'UNTUK PENGHAFAL'].includes(k.toUpperCase()));

// ===== Add penghafal/tahfidz to Buka Berbahagia =====
findProg('6').keywords.push(...['UNTUK PENGHAFAL', 'PENGHAFAL', 'TAHFIDZ', 'PENGHAFAL QURAN', 'TAHFIDZ QURAN', 'IFTHAR RAMADHAN', 'BUKA PUASA', 'UNTUK BUKA', 'BUKA BERBAHAGIA', 'IFTAR', 'BERBUKA'].filter(k => !findProg('6').keywords.some(e => e.toUpperCase() === k.toUpperCase())));
console.log('Added penghafal/tahfidz/iftar to Buka Berbahagia');

// ===== Ensure Pembangunan beats Wakaf Umum =====
findProg('12').keywords.push(...['WAKAF BANGUN', 'BANGUN WAKAF', 'WAKAF PEMBANGUN', 'BANGUN RUMAH QURAN', 'WAKAF RENOVASI', 'RENOVASI MASJID', 'PEMBANGUNAN MASJID', 'PEMBANGUNAN KAWASAN', 'WAQAF PEMBANGUNAN', 'INFAQ PEMBANGUNAN', 'INFAQ PEMBANGUNAN', 'WAKAF KAWASAN', 'WAKAF PEMBANGUNAN', 'BANGUNAN', 'BANGUNAN MASJID', 'PEMBANGUNAN MASJID', 'PEMBANGUNAN KAWASAN', 'WAQAF PEMBANGUNAN', 'INFQ PEMBANGUNAN', 'UNTUK PEMBANGUNAN'].filter(v => !findProg('12').keywords.some(e => e.toUpperCase() === v.toUpperCase())));
console.log('Added strong Pembangunan keywords to program 12');

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

// ===== Add QR FITRAH patterns =====
['QR FITRAH', 'QR FITRI', 'QR FITR', 'QR ZAKAT FITRAH'].forEach(q => { if (!findProg('9').keywords.includes(q)) findProg('9').keywords.push(q); });

// ===== Remove Shadaqah from generic program =====
findProg('7').keywords = findProg('7').keywords.filter(k => !['SHADAQAH', 'SADAQAH', 'SHODAQOH', 'SODAQOH', 'SADAQAH'].includes(k.toUpperCase()));

// ===== Remove penghafal/tahfidz from Quran program =====
findProg('5').keywords = findProg('5').keywords.filter(k => !['PENGHAFAL', 'TAHFIDZ', 'UNTUK PENGHAFAL'].includes(k.toUpperCase()));

// ===== Add penghafal/tahfidz to Buka Berbahagia =====
findProg('6').keywords.push(...['UNTUK PENGHAFAL', 'PENGHAFAL', 'TAHFIDZ', 'PENGHAFAL QURAN', 'TAHFIDZ QURAN', 'IFTHAR RAMADHAN', 'BUKA PUASA', 'UNTUK BUKA', 'BUKA BERBAHAGIA', 'IFTAR', 'BERBUKA'].filter(k => !findProg('6').keywords.some(e => e.toUpperCase() === k.toUpperCase())));
console.log('Added penghafal/tahfidz/iftar to Buka Berbahagia');

// ===== Ensure Pembangunan beats Wakaf Umum =====
findProg('12').keywords.push(...['WAKAF BANGUN', 'BANGUN WAKAF', 'WAKAF PEMBANGUN', 'BANGUN RUMAH QURAN', 'WAKAF RENOVASI', 'RENOVASI MASJID', 'PEMBANGUNAN MASJID', 'PEMBANGUNAN KAWASAN', 'WAQAF PEMBANGUNAN', 'INFAQ PEMBANGUNAN', 'INFAQ PEMBANGUNAN', 'WAKAF KAWASAN', 'WAKAF PEMBANGUNAN', 'BANGUNAN', 'BANGUNAN MASJID', 'PEMBANGUNAN MASJID', 'PEMBANGUNAN KAWASAN', 'WAQAF PEMBANGUNAN', 'INFQ PEMBANGUNAN', 'UNTUK PEMBANGUNAN'].filter(v => !findProg('12').keywords.some(e => e.toUpperCase() === v.toUpperCase())));
console.log('Added strong Pembangunan keywords to program 12');

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

// ===== Add QR FITRAH patterns =====
['QR FITRAH', 'QR FITRI', 'QR FITR', 'QR ZAKAT FITRAH'].forEach(q => { if (!findProg('9').keywords.includes(q)) findProg('9').keywords.push(q); });

// ===== Remove Shadaqah from generic program =====
findProg('7').keywords = findProg('7').keywords.filter(k => !['SHADAQAH', 'SADAQAH', 'SHODAQOH', 'SODAQOH', 'SADAQAH'].includes(k.toUpperCase()));

// ===== Remove penghafal/tahfidz from Quran program =====
findProg('5').keywords = findProg('5').keywords.filter(k => !['PENGHAFAL', 'TAHFIDZ', 'UNTUK PENGHAFAL'].includes(k.toUpperCase()));

// ===== Add penghafal/tahfidz to Buka Berbahagia =====
findProg('6').keywords.push(...['UNTUK PENGHAFAL', 'PENGHAFAL', 'TAHFIDZ', 'PENGHAFAL QURAN', 'TAHFIDZ QURAN', 'IFTHAR RAMADHAN', 'BUKA PUASA', 'UNTUK BUKA', 'BUKA BERBAHAGIA', 'IFTAR', 'BERBUKA'].filter(k => !findProg('6').keywords.some(e => e.toUpperCase() === k.toUpperCase())));
console.log('Added penghafal/tahfidz/iftar to Buka Berbahagia');

// ===== Ensure Pembangunan beats Wakaf Umum =====
findProg('12').keywords.push(...['WAKAF BANGUN', 'BANGUN WAKAF', 'WAKAF PEMBANGUN', 'BANGUN RUMAH QURAN', 'WAKAF RENOVASI', 'RENOVASI MASJID', 'PEMBANGUNAN MASJID', 'PEMBANGUNAN KAWASAN', 'WAQAF PEMBANGUNAN', 'INFAQ PEMBANGUNAN', 'INFAQ PEMBANGUNAN', 'WAKAF KAWASAN', 'WAKAF PEMBANGUNAN', 'BANGUNAN', 'BANGUNAN MASJID', 'PEMBANGUNAN MASJID', 'PEMBANGUNAN KAWASAN', 'WAQAF PEMBANGUNAN', 'INFQ PEMBANGUNAN', 'UNTUK PEMBANGUNAN'].filter(v => !findProg('12').keywords.some(e => e.toUpperCase() === v.toUpperCase())));
console.log('Added strong Pembangunan keywords to program 12');

fs.writeFileSync('test_data/ziswaf-config.json', JSON.stringify(config, null, 2));
console.log('Config updated successfully');