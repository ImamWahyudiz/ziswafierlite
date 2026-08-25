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

  const regex1 = /^bifast\s*-\s*trf\s*dari\s*-\s*([^-]+?)\s*-\s*(.+)$/i;
  const match1 = workingLabel.match(regex1);
  if (match1) {
    extractedSenderName = nameFromNotes(match1[2]);
  } else {
    const regex2 = /^trf\s*dari\s*-\s*(.+)$/i;
    const match2 = workingLabel.match(regex2);
    if (match2) {
      extractedSenderName = nameFromNotes(match2[1]);
    } else {
      const regex3 = /^(\d+\.\d{2})\s+([A-Za-z .,]+)$/;
      const match3 = workingLabel.match(regex3);
      if (match3) {
        extractedSenderName = match3[2].trim();
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
