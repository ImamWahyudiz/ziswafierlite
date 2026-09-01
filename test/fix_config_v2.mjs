const fs = require('fs');
const config = JSON.parse(fs.readFileSync('test_data/ziswaf-config.json', 'utf8'));

// 1. Fix generic program 7 (BANTU OPERASIONAL SANTRI) - remove overly generic keywords
const p7 = config.programs.find(p => p.id === '7');
const removeFrom7 = ['bismillah', 'semoga berkah', 'semoga bermanfaat', 'alhamdulillah', 'hamba allah', 'doa', 'donasi', 'sedekah', 'sodaqoh', 'shadaqah', 'infaq', 'infak', 'makan', 'makan santri', 'makan pondok', 'mkan santri', 'untuk santri', 'operasional pondok', 'untuk masjid', 'untuk pesantren', 'program pondok', 'beasiswa santri', 'yayasan islam center'];
p7.keywords = p7.keywords.filter(k => !removeFrom7.includes(k.toLowerCase()));
console.log('Prog 7 keywords after cleanup:', p7.keywords.length, 'remaining');

// 2. Add 'untuk penghafal' and 'penghafal' to BUKA BERBAHAGIA (prog 6) instead of Quran
const p6 = config.programs.find(p => p.id === '6');
p6.keywords.push('UNTUK PENGHAFAL', 'PENGHAFAL', 'TAHFIDZ');
console.log('Added penghafal/tahfidz to Buka Berbahagia');

// 3. Prioritize PEMBANGUNAN over WAKAF - add longer keywords to program 12
const p12 = config.programs.find(p => p.id === '12');
const p12Keywords = new Set(p12.keywords.map(k => k.toUpperCase()));
const addTo12 = ['WAKAF BANGUN', 'BANGUN WAKAF', 'WAKAF PEMBANGUN', 'BANGUN RUMAH QURAN'];
for (const k of addTo12) if (!p12Keywords.has(k.toUpperCase())) p12.keywords.push(k);
console.log('Added WAKAF BANGUN variants to Pembangunan');

// 4. Ensure ZAKAT parent (40100000) has generic ZAKAT keyword
const p16 = config.programs.find(p => p.id === '16');
if (!p16.keywords.includes('ZAKAT')) p16.keywords.push('ZAKAT');
console.log('Added ZAKAT to Zakat Parent (16)');

// 5. Fix Zakat Maal (11) - remove generic ZAKAT so it goes to parent
const p11 = config.programs.find(p => p.id === '11');
p11.keywords = p11.keywords.filter(k => !['ZAKAT', 'ZAKAT MAL', 'ZAKAT MAAL'].includes(k.toUpperCase()));
console.log('Removed generic ZAKAT from Zakat Maal');

// 6. Ensure Zakat Fitrah has QR patterns
const p9 = config.programs.find(p => p.id === '9');
const qrPatterns = ['QR FITRAH', 'QR FITRI', 'QR FITR', 'QR ZAKAT FITRAH'];
for (const q of qrPatterns) if (!p9.keywords.includes(q)) p9.keywords.push(q);
console.log('Added QR FITRAH patterns to Fitrah');

// 7. Ensure Shadaqah goes to Unauthorized - remove from generic program
p7.keywords = p7.keywords.filter(k => !['SHADAQAH', 'SADAQAH', 'SHODAQOH', 'SODAQOH', 'SADAQAH'].includes(k.toUpperCase()));
console.log('Removed Shadaqah variants from generic program');

// 8. Remove generic keywords from Quran program that match Buka Berbahagia
const p5 = config.programs.find(p => p.id === '5');
p5.keywords = p5.keywords.filter(k => !['PENGHAFAL', 'TAHFIDZ', 'UNTUK PENGHAFAL'].includes(k.toUpperCase()));
console.log('Removed penghafal/tahfidz from Quran program');

fs.writeFileSync('test_data/ziswaf-config.json', JSON.stringify(config, null, 2));
console.log('Config updated successfully');