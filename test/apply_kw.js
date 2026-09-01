const fs = require('fs');
const config = JSON.parse(fs.readFileSync('test_data/ziswaf-config.json', 'utf8'));

function findProg(pid) {
  return config.programs.find(p => p.id === pid);
}

// 1. Zakat Maal (11) - show current keywords
console.log('Program 11 (Zakat Maal) keywords:', findProg('11').keywords);

// 2. Fitrah (9) - add QR patterns
const qrPatterns = ['QR FITRAH', 'QR FITRI', 'QR FITR', 'QR ZAKAT FITRAH'];
for (const q of qrPatterns) {
  if (!findProg('9').keywords.some(e => e.toUpperCase() === q.toUpperCase())) findProg('9').keywords.push(q);
}
console.log('Added QR FITRAH patterns to program 9');

// 3. Quran (5) - remove penghafal/tahfidz
const p5 = findProg('5');
p5.keywords = p5.keywords.filter(k => !['UNTUK PENGHAFAL QURAN', 'PENGHAFAL QURAN', 'TAHFIDZ QURAN'].some(x => x.toUpperCase() === k.toUpperCase()));
console.log('Removed penghafal/tahfidz from Quran program');

// 4. Wakaf Pembangunan (12) - add variants
['WAKAF RENOVASI', 'RENOVASI', 'WAKAF BANGUN', 'WAKAF PEMBANGUN'].forEach(k => {
  if (!findProg('12').keywords.some(e => e.toUpperCase() === k.toUpperCase())) findProg('12').keywords.push(k);
});
console.log('Added Wakaf variants to program 12');

// 5. Yatim (2) - add Y ATIM variants
['Y ATIM', 'YAT IM', 'ANAK YATIM', 'ANAK YAT IM'].forEach(k => {
  if (!findProg('2').keywords.some(e => e.toUpperCase() === k.toUpperCase())) findProg('2').keywords.push(k);
});
console.log('Added Y ATIM variants to program 2');

fs.writeFileSync('test_data/ziswaf-config.json', JSON.stringify(config, null, 2));
console.log('Config updated');