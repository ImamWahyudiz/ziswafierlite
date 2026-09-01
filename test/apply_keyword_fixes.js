const fs = require('fs');
const config = JSON.parse(fs.readFileSync('test_data/ziswaf-config.json', 'utf8'));

function findProg(pid) {
  return config.programs.find(p => p.id === pid);
}

// 1. Remove PENGHAFAL/TAHFIDZ from Quran (5)
const p5 = findProg('5');
const p5Before = p5.keywords.length;
p5.keywords = p5.keywords.filter(k => !['UNTUK PENGHAFAL QURAN', 'PENGHAFAL QURAN', 'TAHFIDZ QURAN', 'TAHFIDZ', 'PENGHAFAL'].some(x => x.toUpperCase() === k.toUpperCase()));
console.log('Removed penghafal/tahfidz from Quran program (5):', p5Before, '->', p5.keywords.length);

// 2. Ensure program 7 (Bantu Operasional Santri) doesn't steal 'INFAQ' matches
findProg('7').priority = 1;

// 3. Add BUKA PUASA keywords to program 6 (Buka Berbahagia) for proper Buka Puasa matching
const p6 = findProg('6');
['BUKA PUASA', 'BUKA BERBAHAGIA', 'PAKET BUKA'].forEach(k => {
  if (!findProg('6').keywords.some(e => e.toUpperCase() === k.toUpperCase())) findProg('6').keywords.push(k);
});
console.log('Added BUKA PUASA to Buka Berbahagia (6)');

// 4. Ensure Zakat Maal (11) has ZAKAT MAAL and ZAKAT MAL keywords
const prog11 = findProg('11');
prog11.keywords.push('ZAKAT MAAL', 'ZAKAT MAL');
console.log('Added ZAKAT MAAL and ZAKAT MAL to program 11');

// 5. Add BANGUN RUMAH to program 12
findProg('12').keywords.push('BANGUN RUMAH');
console.log('Added BANGUN RUMAH to program 12');

// 6. Add Y ATIM variants to program 2
['Y ATIM', 'YAT IM', 'ANAK YATIM', 'ANAK YAT IM'].forEach(k => {
  if (!findProg('2').keywords.some(e => e.toUpperCase() === k.toUpperCase())) findProg('2').keywords.push(k);
});
console.log('Added Y ATIM variants to program 2');

fs.writeFileSync('test_data/ziswaf-config.json', JSON.stringify(config, null, 2));
console.log('Config updated');
