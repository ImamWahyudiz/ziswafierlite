export function cleanTransactionText(rawLabel, companyAliases) {
  let workingLabel = String(rawLabel || '');
  const BANKISH = /^(?:bank[\w\s.]*|bca|bni|bri|mandiri|bsi|btn|danamon|cimb\s*niaga|cimb|permata|mega|ocbc|nisp|panin|uob|maybank|jenius|seabank|jago|nobu|hsbc|citibank|alfa ?bank|line bank|dana|gopay|ovo|shopeepay|linkaja|sakuku|paytren)$/i;

  const nameFromNotes = (notes) => {
    const segs = notes.replace(/dana\d{8}[a-z0-9]+/gi, '').split('-').map((s) => s.trim()).filter(Boolean);
    let i = 0;
    while (i < segs.length - 1 && BANKISH.test(segs[i])) i++;
    return segs[i] || '';
  };

  let extractedSenderName = null;

  // Pattern 1: "BIFAST - Trf Dari - {bank?} - {name} - {notes}"
  const regex1 = /^bifast\s*-\s*trf\s*dari\s*-\s*([^-]+?)\s*-\s*(.+)$/i;
  const match1 = workingLabel.match(regex1);
  if (match1) {
    extractedSenderName = nameFromNotes(match1[2]);
  } else {
    // Pattern 2: starts with "Trf Dari - {rest}"
    const regex2 = /^trf\s*dari\s*-\s*(.+)$/i;
    const match2 = workingLabel.match(regex2);
    if (match2) {
      extractedSenderName = nameFromNotes(match2[1]);
    } else {
      // Pattern 3: "{prefix} - Trf Dari - {rest}"  e.g. "100426 - Trf Dari - Amelia"
      const regex3 = /^.+?\s*-\s*trf\s*dari\s*-\s*(.+)$/i;
      const match3 = workingLabel.match(regex3);
      if (match3) {
        extractedSenderName = nameFromNotes(match3[1]);
      } else {
        // Pattern 4: "{digits.cents} {Name}"
        const regex4 = /^(\d+\.\d{2})\s+([A-Za-z .,]+)$/;
        const match4 = workingLabel.match(regex4);
        if (match4) {
          extractedSenderName = match4[2].trim();
        }
      }
    }
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

