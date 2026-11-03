/**
 * Engine-level Indonesian Islamic spelling normalization (institution-agnostic).
 * Canonicalizes common orthographic variants so keyword matching is robust
 * across different institutions and mutation formats.
 * Safe: these are 1:1 linguistic mappings, not dataset-specific terms.
 */
export function normalizeForMatch(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/'/g, '').replace(/’/g, '')
    .replace(/\bWAQAF\b/g, 'WAKAF')
    .replace(/\bWAQF\b/g, 'WAKAF')
    .replace(/\bWAAKAF\b/g, 'WAKAF')
    .replace(/\bWAKF\b/g, 'WAKAF')
    .replace(/\bMESJID\b/gi, 'MASJID')
    .replace(/\bMASJIT\b/gi, 'MASJID')
    .replace(/ALQURAN/g, 'AL QURAN')
    .replace(/AL-QURAN\b/g, 'AL QURAN')
    .replace(/\bQUR'?AN\b/g, 'QURAN')
    // Ensure "AL QURAN" matches "ALQURAN" keywords (remove space)
    // Use \b to avoid matching "AL" inside words like "PENGHAFAL"
    .replace(/\bAL QURAN/g, 'ALQURAN')
    // Jumat variants → JUMAT
    .replace(/JUM'AT\b/g, 'JUMAT')
    .replace(/JUMAT\b/g, 'JUMAT')
    .replace(/JUM'AT/g, 'JUMAT')
    // Donation word variants → canonical
    .replace(/\bSEDQOH\b/g, 'SHODAQOH')
    .replace(/\bSODAQOH\b/g, 'SHODAQOH')
    .replace(/\bSHADAQAH\b/g, 'SHODAQOH')
    .replace(/\bSADAQAH\b/g, 'SHODAQOH')
    .replace(/\bSADAQOH\b/g, 'SHODAQOH')
    .replace(/\bINFQ\b/g, 'INFAQ')
    .replace(/\bINFAK\b/g, 'INFAQ')
    .replace(/\bFIDYA\b/g, 'FIDYAH')
    .replace(/\bKURBAN\b/g, 'QURBAN')
    .replace(/\bZAKAH\b/g, 'ZAKAT')
    .replace(/\bQURBAN\b/g, 'QURBAN')
    .replace(/\bIFTAR\b/g, 'IFTOR')
    .replace(/\bIFTHAR\b/g, 'IFTOR')
    .replace(/\bFITROH\b/g, 'FITRAH')
    // PEMB abbreviation → PEMBANGUNAN
    .replace(/\bPEMB\b/g, 'PEMBANGUNAN')
    .toLowerCase();  // return lowercase for consistent substring matching
}

// Words that start the donor's free-text note, not their name. "amal"/"bantuan" are left out on
// purpose: "Amal" is also a person's name.
const NOTE_START_RE = /^(?:infaq|infak|infq|sedekah|sedeqah|shodaqoh|sodaqoh|shadaqah|zakat|zkt|wakaf|wkf|donasi|qurban|kurban|fidyah|fitrah|sumbangan|transfer|trf|untuk|buat)$/i;

/** Keeps only the leading name tokens; null when the text starts with a note word. */
function cutDonationNote(name) {
  const tokens = String(name || '').trim().split(/\s+/).filter(Boolean);
  const cut = tokens.findIndex((token) => NOTE_START_RE.test(token.replace(/[^a-z]/gi, '')));
  if (cut === -1) return tokens.join(' ');
  return cut === 0 ? null : tokens.slice(0, cut).join(' ');
}

export function cleanTransactionText(rawLabel, companyAliases) {
  let workingLabel = String(rawLabel || '');
  
  const BANKISH = /^(?:bank[\w\s.]*|bca|bni|bri|mandiri|bsi|btn|danamon|cimb\s*niaga|cimb|permata|mega|ocbc|nisp|panin|uob|maybank|jenius|seabank|jago|nobu|hsbc|citibank|alfa ?bank|line bank|dana|gopay|ovo|shopeepay|linkaja|sakuku|paytren)$/i;

  const nameFromNotes = (notes) => {
    const segs = notes.replace(/dana\d{8}[a-z0-9]+/gi, '').split('-').map((s) => s.trim()).filter(Boolean);
    let i = 0;
    // Skip bank/e-wallet names and pure reference numbers ("Trf Dari - 123456 - NAME").
    while (i < segs.length - 1 && (BANKISH.test(segs[i]) || /^\d+$/.test(segs[i]))) i++;
    return segs[i] || '';
  };

  // First matching pattern wins. Order matters. Add new bank formats here, one entry each.
  const NAME = "([A-Za-z][\\w\\s.,'-]{1,60})";
  const SENDER_PATTERNS = [
    // "BIFAST - Trf Dari - {bank?} - {name} - {notes}"
    { re: /^bifast\s*-\s*trf\s*dari\s*-\s*([^-]+?)\s*-\s*(.+)$/i, extract: (m) => nameFromNotes(m[2]) },
    // "Trf Dari - {rest}"
    { re: /^trf\s*dari\s*-\s*(.+)$/i, extract: (m) => nameFromNotes(m[1]) },
    // "{prefix} - Trf Dari - {rest}"  e.g. "100426 - Trf Dari - Amelia"
    { re: /^.+?\s*-\s*trf\s*dari\s*-\s*(.+)$/i, extract: (m) => nameFromNotes(m[1]) },
    // "{prefix} {amount} {Name}" e.g. "0102/Ftscy/Ws95271 50000.00 Rio Kurnia Setyawa"
    { re: new RegExp('\\d+\\.\\d{2}\\s+' + NAME + '$'), extract: (m) => m[1].trim() },
    // "{MM/DD} {TRX-CODE} {Name}"  e.g. "02/07 Zn2W1 Abdul Ridwan" (BCA format)
    { re: new RegExp('^\\d{2}\\/\\d{2}\\s+\\S+\\s+' + NAME + '$'), extract: (m) => m[1].trim() },
    // "BI-FAST CR TRANSFER DR {ref} {Name}" and "SWITCHING CR TRF|TRANSFER DR {ref} {Name}"
    { re: new RegExp('^(?:bi-?fast|switching)\\s+cr\\s+(?:transfer|trf)\\s+(?:dr\\s+)?\\d+\\s+' + NAME + '$', 'i'), extract: (m) => m[1].trim() }
  ];

  let extractedSenderName = null;
  for (const pattern of SENDER_PATTERNS) {
    const match = workingLabel.match(pattern.re);
    if (match) { extractedSenderName = pattern.extract(match); break; }
  }

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let companyAliasMatched = false;
  for (const alias of companyAliases || []) {
    if (!alias || !String(alias).trim()) continue;
    if (new RegExp(escapeRe(String(alias).trim()), 'gi').test(workingLabel)) companyAliasMatched = true;
    workingLabel = workingLabel.replace(new RegExp(escapeRe(String(alias).trim()), 'gi'), ' ');
  }
  
  workingLabel = workingLabel.replace(
    /^bifast\s*-\s*trf\s*dari\s*-\s*(?:bank\s+[a-z0-9\s]+?|dana|gopay|ovo|shopeepay|linkaja)\s*-/i,
    ''
  );
  workingLabel = workingLabel.replace(
    /^trf\s*dari\s*-\s*(?:bank\s+[a-z0-9\s]+?|dana|gopay|ovo|shopeepay|linkaja)\s*-/i,
    ''
  );
  workingLabel = workingLabel.replace(
    /^bifast\s*-\s*trf\s*dari\s*-\s*/i,
    ''
  );
  workingLabel = workingLabel.replace(
    /^trf\s*dari\s*-\s*/i,
    ''
  );
  workingLabel = workingLabel.replace(
    /^trf\s*ke\s*-\s*/i,
    ''
  );
  workingLabel = workingLabel.replace(
    /^\d+\.\d{2}\s+/,
    ''
  );
  workingLabel = workingLabel.replace(
    /^qr\s+\d+\s+[a-z0-9]+\s+/i,
    ''
  );
  workingLabel = workingLabel.replace(
    /^qr\s+\d+\s+/i,
    ''
  );
  workingLabel = workingLabel.replace(
    /^qr\s+/i,
    ''
  );
  
  workingLabel = workingLabel.replace(/dana\d{8}[a-z0-9]+/gi, '');
  workingLabel = workingLabel.replace(/qris\d+/gi, '');
  workingLabel = workingLabel.replace(/ref\s*:\s*[a-z0-9]+/gi, '');
  
  workingLabel = workingLabel.replace(/\s+/g, ' ').trim();
  
  if (extractedSenderName) {
    extractedSenderName = extractedSenderName.replace(/dana\d{8}[a-z0-9]+/gi, '');
    extractedSenderName = cutDonationNote(extractedSenderName);
  }
  
  if (extractedSenderName) {
    if (extractedSenderName.length < 3 || /^\d+$/.test(extractedSenderName)) {
      extractedSenderName = null;
    }
  }
  
  return { cleanedLabel: workingLabel, extractedSenderName, companyAliasMatched };
}

/**
 * Sanitizes generic user input text:
 * - Strips HTML tags, script blocks, and dangerous control characters
 * - Collapses consecutive spaces
 * - Trims and enforces maximum length
 */
export function sanitizeInputText(text, maxLen = 120) {
  if (text === null || text === undefined) return '';
  let str = String(text);
  // Remove script/style tags and contents
  str = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  str = str.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  // Remove all HTML tags
  str = str.replace(/<[^>]+>/g, '');
  // Remove control characters (except common spacing)
  str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Collapse whitespace
  str = str.replace(/\s+/g, ' ').trim();
  if (maxLen && str.length > maxLen) {
    str = str.slice(0, maxLen).trim();
  }
  return str;
}

/**
 * Sanitizes identifier/slug string (e.g. program ID):
 * - Keeps alphanumeric, dashes, and underscores
 */
export function sanitizeSlug(text, maxLen = 50) {
  if (!text) return '';
  let str = String(text).trim().toLowerCase();
  str = str.replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '');
  if (maxLen && str.length > maxLen) {
    str = str.slice(0, maxLen).replace(/^[-_]+|[-_]+$/g, '');
  }
  return str;
}

/**
 * Sanitizes phone numbers:
 * - Keeps digits and optional leading '+'
 */
export function sanitizePhone(phone, maxLen = 25) {
  if (!phone) return '';
  let str = String(phone).trim();
  const hasPlus = str.startsWith('+');
  str = str.replace(/\D/g, '');
  if (!str) return '';
  if (hasPlus) str = '+' + str;
  if (maxLen && str.length > maxLen) {
    str = str.slice(0, maxLen);
  }
  return str;
}

/**
 * Sanitizes account/COA code:
 * - Returns positive integer or null if invalid
 */
export function sanitizeCoaCode(code) {
  if (code === null || code === undefined || code === '') return null;
  const num = parseInt(String(code).replace(/\D/g, ''), 10);
  if (isNaN(num) || num <= 0 || num > 999999999999) return null;
  return num;
}

