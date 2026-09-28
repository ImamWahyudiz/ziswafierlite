let importSequence = 0;

function createImportId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    importSequence += 1;
    return `${Date.now().toString(36)}-${importSequence.toString(36)}`;
}

function formatDateParts(year, month, day, originalValue) {
    const y = Number(year), m = Number(month), d = Number(day);
    const check = new Date(Date.UTC(y, m - 1, d));
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) ||
        check.getUTCFullYear() !== y || check.getUTCMonth() + 1 !== m || check.getUTCDate() !== d) {
        throw new Error(`Tanggal tidak valid: ${String(originalValue)}`);
    }
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseAmountValue(value) {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('Nominal bukan angka valid');
        return value;
    }
    const original = String(value ?? '').trim();
    if (!original) throw new Error('Nominal kosong');

    let text = original.toLowerCase().replace(/rp\.?/g, '').replace(/\s+/g, '');
    const negative = /^-/.test(text) || /^\(.*\)$/.test(text);
    text = text.replace(/[()\-]/g, '');
    if (!/^\d+(?:[.,]\d+)*$/.test(text)) throw new Error(`Nominal tidak valid: ${original}`);

    const dot = text.lastIndexOf('.');
    const comma = text.lastIndexOf(',');
    let normalized = text;
    if (dot >= 0 && comma >= 0) {
        const decimalSeparator = dot > comma ? '.' : ',';
        const thousandsSeparator = decimalSeparator === '.' ? ',' : '.';
        normalized = text.split(thousandsSeparator).join('').replace(decimalSeparator, '.');
    } else {
        const separator = dot >= 0 ? '.' : comma >= 0 ? ',' : '';
        if (separator) {
            const parts = text.split(separator);
            const isThousands = parts.length > 2
                ? parts.slice(1).every(part => part.length === 3)
                : parts[1].length === 3 && parts[0] !== '0';
            normalized = isThousands ? parts.join('') : `${parts[0]}.${parts.slice(1).join('')}`;
        }
    }

    const amount = Number(normalized);
    if (!Number.isFinite(amount)) throw new Error(`Nominal tidak valid: ${original}`);
    return negative ? -amount : amount;
}

function safeSpreadsheetText(value) {
    const text = String(value ?? '');
    return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
}

function accountNameOf(transaction) {
    return transaction.assignedCoaName || transaction.newName || '';
}

export async function parseBankStatement(fileBuffer, sourceName = '') {
    const XLSX = globalThis.XLSX;
    if (!XLSX) throw new Error("SheetJS (XLSX) library not loaded");

    const wb = XLSX.read(fileBuffer, {type: 'array'});
    const sheetName = wb.SheetNames.find(name => wb.Sheets[name]);
    if (!sheetName) throw new Error('No sheet found');
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, {header: 1, raw: true});
    const date1904 = Boolean(wb.Workbook?.WBProps?.date1904);

    const dateAliases = ['date','tanggal','tgl'];
    const labelAliases = ['label','keterangan','deskripsi','uraian'];
    const amountAliases = ['amount','nominal','jumlah','mutasi'];
    const partnerAliases = ['partner','pengirim','nama'];

    let headerRowIndex = -1;
    let dateCol = -1, labelCol = -1, amountCol = -1, partnerCol = -1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
        const row = rows[i];
        if (!Array.isArray(row)) continue;
        const candidate = { date: -1, label: -1, amount: -1, partner: -1 };
        for (let j = 0; j < row.length; j++) {
            const cell = String(row[j] || '').trim().toLowerCase();
            if (!cell) continue;
            if (dateAliases.includes(cell)) candidate.date = j;
            if (labelAliases.includes(cell)) candidate.label = j;
            if (amountAliases.includes(cell)) candidate.amount = j;
            if (partnerAliases.includes(cell)) candidate.partner = j;
        }
        if (candidate.label >= 0 && candidate.amount >= 0) {
            headerRowIndex = i;
            dateCol = candidate.date;
            labelCol = candidate.label;
            amountCol = candidate.amount;
            partnerCol = candidate.partner;
            break;
        }
    }
    if (headerRowIndex === -1) throw new Error('Format kolom mutasi bank tidak dikenali');

    const parseCellDate = (value) => {
        if (value === undefined || value === null || String(value).trim() === '') return '';
        if (typeof value === 'number' && value > 0) {
            const parsed = XLSX.SSF.parse_date_code(value, { date1904 });
            if (!parsed) throw new Error(`Tanggal Excel tidak valid: ${value}`);
            return formatDateParts(parsed.y, parsed.m, parsed.d, value);
        }
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return formatDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate(), value);
        }
        const text = String(value).trim();
        const ymd = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s|$)/);
        if (ymd) return formatDateParts(ymd[1], ymd[2], ymd[3], value);
        const dmy = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s|$)/);
        if (dmy) return formatDateParts(dmy[3], dmy[2], dmy[1], value);
        throw new Error(`Tanggal tidak dikenali: ${text}`);
    };

    const transactions = [];
    const importId = createImportId();
    for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!Array.isArray(row)) continue;
        const labelVal = row[labelCol];
        const amountVal = row[amountCol];
        if ((labelVal === undefined || labelVal === null || String(labelVal).trim() === '') &&
            (amountVal === undefined || amountVal === null || String(amountVal).trim() === '')) continue;

        try {
            transactions.push({
                id: `TX-${importId}-${i + 1}`,
                sourceName: String(sourceName || sheetName),
                sourceSheet: sheetName,
                sourceRow: i + 1,
                rawDate: parseCellDate(dateCol >= 0 ? row[dateCol] : ''),
                rawLabel: String(labelVal || '').trim(),
                rawAmount: parseAmountValue(amountVal),
                partner: partnerCol >= 0 && row[partnerCol] != null ? String(row[partnerCol]).trim() : null
            });
        } catch (error) {
            throw new Error(`Baris ${i + 1}: ${error.message}`);
        }
    }
    return transactions;
}

export function exportOdooExcel(transactions) {
    const XLSX = globalThis.XLSX;
    if (!XLSX) throw new Error("SheetJS (XLSX) library not loaded");
    const header = ['DATE', 'ACCOUNT NUMBER', 'ACCOUNT NAME', 'NOMINAL', 'KETERANGAN'];
    const rows = transactions.map(t => [
        t.rawDate,
        t.assignedCoa || '',
        safeSpreadsheetText(accountNameOf(t)),
        Number(t.rawAmount) || 0,
        safeSpreadsheetText(t.rawLabel)
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Journal');
    return new Uint8Array(XLSX.write(wb, {bookType: 'xlsx', type: 'array'}));
}

export function exportOdooCsv(transactions) {
    const escapeField = (field) => {
        const text = String(field ?? '');
        return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const header = ['DATE', 'ACCOUNT NUMBER', 'ACCOUNT NAME', 'NOMINAL', 'KETERANGAN'];
    const lines = [header.map(escapeField).join(';')];
    for (const t of transactions) {
        const row = [
            t.rawDate,
            t.assignedCoa || '',
            safeSpreadsheetText(accountNameOf(t)),
            Number(t.rawAmount) || 0,
            safeSpreadsheetText(t.rawLabel)
        ];
        lines.push(row.map(escapeField).join(';'));
    }
    return lines.join('\r\n');
}
