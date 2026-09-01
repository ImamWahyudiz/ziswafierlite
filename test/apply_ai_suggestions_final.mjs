const fs = require('fs');
const config = JSON.parse(fs.readFileSync('test_data/ziswaf-config.json', 'utf8'));

// Helper function to find program by id
function findProg(pid) {
  return config.programs.find(p => p.id === pid);
}

function addKeywords(pid, variants) {
  const p = config.programs.find(p => p.id === pid);
  if (!p) return;
  for (const v of variants) {
    if (!p.keywords.some(e => e.toUpperCase() === v.toUpperCase())) p.keywords.push(v);
  }
}

function removeKeywords(pid, toRemove) {
  const p = config.programs.find(p => p.id === pid);
  p.keywords = p.keywords.filter(k => !toRemove.some(r => r.toUpperCase() === k.toUpperCase()));
}

// ===== 1. COLLISION: WAKAF QURAN =====
const p12 = find('12');
p12.keywords = p12.keywords.filter(k => !['WAKAF QURAN'].some(x => x.toUpperCase() === k.toUpperCase()));
console.log('Removed WAKAF QURAN from program 12');

// ===== 2. MISSING: SANTRI, PENDIDIKAN to program 7 =====
const addTo7 = ['SANTRI', 'PENDIDIKAN', 'OPERASIONAL PONDOK'];
for (const k of addTo7) if (!config.programs.find(p => p.id === '7').keywords.some(e => e.toUpperCase() === k.toUpperCase())) config.programs.find(p => p.id === '7').keywords.push(k);
console.log('Added SANTRI, PENDIDIKAN, OPERASIONAL PONDOK to program 7');

// ===== 3. MISSING: GIZI SANTRI to program 1 =====
if (!config.programs.find(p => p.id === '1').keywords.some(e => e.toUpperCase() === 'GIZI SANTRI')) config.programs.find(p => p.id === '1').keywords.push('GIZI SANTRI');
console.log('Added GIZI SANTRI to program 1');

// ===== 4. VARIANTS: Program 5 AL QURAN =====
const variants5 = ['AL-QURAN', 'ALQURAN', 'AL QORAN', 'ALQORAN', 'MUSHAF'];
config.programs.find(p => p.id === '5').keywords.push(...variants5.filter(v => !config.programs.find(p => p.id === '5').keywords.some(e => e.toUpperCase() === v.toUpperCase())));
console.log('Added AL QURAN variants to program 5');

// ===== 5. Program 9 FITRAH variants =====
const p9 = config.programs.find(p => p.id === '9');
const fitrahVariants = ['ZKT FITRAH', 'ZAKAT FITRI', 'FITRAH', 'FITRI', 'ZIS FITRAH', 'BERAS FITRAH', 'QR FITRAH', 'QR FITRI', 'QR FITR', 'QR ZAKAT FITRAH'];
p9.keywords.push(...fitrahVariants.filter(v => !p9.keywords.some(e => e.toUpperCase() === v.toUpperCase())));
console.log('Added FITRAH variants to program 9');

// ===== QURBAN variants program 10 =====
const p10 = config.programs.find(p => p.id === '10');
['KURBAN', 'QURBN', 'KRBN', 'QURBAN', 'QURBANI', 'AQIQAH'].forEach(v => {
  if (!config.programs.find(p => p.id === '10').keywords.some(e => e.toUpperCase() === v.toUpperCase())) config.programs.find(p => p.id === '10').keywords.push(v);
});
console.log('Added QURBAN variants to program 10');

// ===== ZAKAT PENGHASILAN variants program 11 =====
config.programs.find(p => p.id === '11').keywords.push(...['ZAKAT PROFESI', 'ZKT PENGHASILAN', 'ZAKAT GAJI', 'ZAKAT PENGHASILAN', 'ZAKAT HARTA', 'ZAKAT MAL', 'ZKT MAL'].filter(v => !config.programs.find(p => p.id === '11').keywords.some(e => e.toUpperCase() === v.toUpperCase())));
console.log('Added ZAKAT PENGHASILAN variants to program 11');

// ===== Program 12 PEMBANGUNAN MASJID =====
config.programs.find(p => p.id === '12').keywords.push(...['BANGUN MASJID', 'RENOVASI MASJID', 'PEMBANGUNAN', 'RENOVASI', 'WAKAF MASJID', 'WAKAF PEMBANGUNAN', 'WAKAF BANGUN', 'BANGUN WAKAF'].filter(v => !config.programs.find(p => p.id === '12').keywords.some(e => e.toUpperCase() === v.toUpperCase())));
console.log('Added PEMBANGUNAN MASJID variants to program 12');

// ===== Program 15 FIDYAH =====
config.programs.find(p => p.id === '15').keywords.push(...['FIDIAH', 'FIDYA', 'KAFARAT'].filter(v => !config.programs.find(p => p.id === '15').keywords.some(e => e.toUpperCase() === v.toUpperCase())));
console.log('Added FIDYAH variants to program 15');

// ===== HIERARCHY FIXES =====
// Program 13 (Wakaf Umum) - keep only generic WAKAF
config.programs.find(p => p.id === '13').keywords = config.programs.find(p => p.id === '13').keywords.filter(k => ['WAKAF', 'WKF', 'WAAKAF', 'WAKF'].includes(k.toUpperCase()));
console.log('Wakaf Umum keywords:', config.programs.find(p => p.id === '13').keywords.length);

// ===== ZAKAT Parent (16) =====
config.programs.find(p => p.id === '16').keywords.push(...['ZAKAT', 'ZAKAT MAL', 'ZAKAT MAAL', 'ZAKAT HARTA', 'ZAKAT PENGHASILAN', 'ZAKAT PROFESI', 'PEMBERSIHAN HARTA'].filter(v => !config.programs.find(p => p.id === '16').keywords.some(e => e.toUpperCase() === v.toUpperCase())));
console.log('Added ZAKAT parent keywords to program 16');

// Remove generic ZAKAT from Zakat Maal
config.programs.find(p => p.id === '11').keywords = config.programs.find(p => p.id === '11').keywords.filter(k => !['ZAKAT', 'ZAKAT MAL', 'ZAKAT MAAL'].includes(k.toUpperCase()));
console.log('Removed generic ZAKAT from Zakat Maal');

// QR FITRAH patterns
config.programs.find(p => p.id === '9').keywords.push(...['QR FITRAH', 'QR FITRI', 'QR FITR', 'QR ZAKAT FITRAH'].filter(q => !config.programs.find(p => p.id === '9').keywords.includes(q)));
console.log('Added QR FITRAH patterns to Fitrah');

// Remove Shadaqah from generic program (7)
config.programs.find(p => p.id === '7').keywords = config.programs.find(p => p.id === '7').keywords.filter(k => !['SHADAQAH', 'SADAQAH', 'SHODAQOH', 'SODAQOH', 'SADAQAH'].includes(k.toUpperCase()));
console.log('Removed Shadaqah from generic program');

// Remove penghafal/tahfidz from Quran program
config.programs.find(p => p.id === '5').keywords = config.programs.find(p => p.id === '5').keywords.filter(k => !['PENGHAFAL', 'TAHFIDZ', 'UNTUK PENGHAFAL'].includes(k.toUpperCase()));
console.log('Removed penghafal/tahfidz from Quran program');

// Add penghafal/tahfidz to Buka Berbahagia
['UNTUK PENGHAFAL', 'PENGHAFAL', 'TAHFIDZ', 'PENGHAFAL QURAN', 'TAHFIDZ QURAN', 'IFTHAR RAMADHAN', 'BUKA PUASA', 'UNTUK BUKA', 'BUKA BERBAHAGIA', 'IFTAR', 'BERBUKA'].forEach(k => {
  if (!config.programs.find(p => p.id === '6').keywords.some(e => e.toUpperCase() === k.toUpperCase())) config.programs.find(p => p.id === '6').keywords.push(k);
});
console.log('Added penghafal/tahfidz/iftar to Buka Berbahagia');

// ZAKAT Parent (16) generic
config.programs.find(p => p.id === '16').keywords.push(...['ZAKAT', 'ZAKAT MAL', 'ZAKAT MAAL', 'ZAKAT HARTA', 'ZAKAT PENGHASILAN', 'ZAKAT PROFESI', 'PEMBERSIHAN HARTA'].filter(v => !config.programs.find(p => p.id === '16').keywords.some(e => e.toUpperCase() === v.toUpperCase())));
console.log('Added ZAKAT parent keywords to program 16');

// Remove generic ZAKAT from Zakat Maal
config.programs.find(p => p.id === '11').keywords = config.programs.find(p => p.id === '11').keywords.filter(k => !['ZAKAT', 'ZAKAT MAL', 'ZAKAT MAAL'].includes(k.toUpperCase()));
console.log('Removed generic ZAKAT from Zakat Maal');

// QR FITRAH patterns
config.programs.find(p => p.id === '9').keywords.push(...['QR FITRAH', 'QR FITRI', 'QR FITR', 'QR ZAKAT FITRAH'].filter(q => !config.programs.find(p => p.id === '9').keywords.includes(q)));
console.log('Added QR FITRAH patterns to Fitrah');

// Remove Shadaqah from generic program
config.programs.find(p => p.id === '7').keywords = config.programs.find(p => p.id === '7').keywords.filter(k => !['SHADAQAH', 'SADAQAH', 'SHODAQOH', 'SODAQOH', 'SADAQAH'].includes(k.toUpperCase()));
console.log('Removed Shadaqah from generic program');

// Remove penghafal/tahfidz from Quran program
config.programs.find(p => p.id === '5').keywords = config.programs.find(p => p.id === '5').keywords.filter(k => !['PENGHAFAL', 'TAHFIDZ', 'UNTUK PENGHAFAL'].includes(k.toUpperCase()));
console.log('Removed penghafal/tahfidz from Quran program');

// Add penghafal/tahfidz to Buka Berbahagia
['UNTUK PENGHAFAL', 'PENGHAFAL', 'TAHFIDZ', 'PENGHAFAL QURAN', 'TAHFIDZ QURAN', 'IFTHAR RAMADHAN', 'BUKA PUASA', 'UNTUK BUKA', 'BUKA BERBAHAGIA', 'IFTAR', 'BERBUKA'].forEach(k => {
  if (!config.programs.find(p => p.id === '6').keywords.some(e => e.toUpperCase() === k.toUpperCase())) config.programs.find(p => p.id === '6').keywords.push(k);
});
console.log('Added penghafal/tahfidz/iftar to Buka Berbahagia');

// Ensure Pembangunan beats Wakaf Umum
config.programs.find(p => p.id === '12').keywords.push(...['WAKAF BANGUN', 'BANGUN WAKAF', 'WAKAF PEMBANGUN', 'BANGUN RUMAH QURAN', 'WAKAF RENOVASI', 'RENOVASI MASJID', 'PEMBANGUNAN MASJID', 'PEMBANGUNAN KAWASAN', 'WAQAF PEMBANGUNAN', 'INFAQ PEMBANGUNAN', 'INFAQ PEMBANGUNAN', 'WAKAF KAWASAN', 'WAKAF PEMBANGUNAN', 'BANGUNAN', 'BANGUNAN MASJID', 'PEMBANGUNAN MASJID', 'PEMBANGUNAN KAWASAN', 'WAQAF PEMBANGUNAN', 'INFQ PEMBANGUNAN', 'UNTUK PEMBANGUNAN'].filter(v => !config.programs.find(p => p.id === '12').keywords.some(e => e.toUpperCase() === v.toUpperCase())));
console.log('Added strong Pembangunan keywords to program 12');

// Wakaf Umum - keep only generic WAKAF
config.programs.find(p => p.id === '13').keywords = config.programs.find(p => p.id === '13').keywords.filter(k => ['WAKAF', 'WKF', 'WAAKAF', 'WAKF'].includes(k.toUpperCase()));
console.log('Wakaf Umum keywords:', config.programs.find(p => p.id === '13').keywords.length);

// Youva donor -> Umum
const youva = config.donors.find(d => d.name && d.name.toLowerCase().includes('youva'));
if (youva) { youva.defaultProgramId = ''; youva.defaultCoa = 40201001; console.log('Youva -> Umum'); }

// Maria Alesha -> Sarana Fisik
const maria = config.donors.find(d => d.name && d.name.toLowerCase().includes('maria alesha'));
if (maria) { maria.defaultProgramId = '14'; maria.defaultCoa = 40202502; console.log('Maria Alesha -> Sarana Fisik'); }

// Leon -> Palestine
const leon = config.donors.find(d => d.name && d.name.toLowerCase().includes('leon'));
if (leon) { leon.defaultProgramId = '3'; leon.defaultCoa = 40202101; console.log('Leon -> Palestine'); }

// Zakat Parent hierarchy
config.programs.find(p => p.id === '9').parentCoaCode = 40100000;
config.programs.find(p => p.id === '11').parentCoaCode = 40100000;

fs.writeFileSync('test_data/ziswaf-config.json', JSON.stringify(config, null, 2));
console.log('Config fully updated with all AI suggestions');