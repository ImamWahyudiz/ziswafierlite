export async function parseBankStatement(fileBuffer) {
    const XLSX = globalThis.XLSX;
    if (!XLSX) throw new Error("SheetJS (XLSX) library not loaded");

    const wb = XLSX.read(fileBuffer, {type: 'array'});
    const sheetName = wb.SheetNames.find(name => wb.Sheets[name]);
    if (!sheetName) throw new Error('No sheet found');
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, {header: 1, raw: true});

    const dateAliases = ['date','tanggal','tgl'];
    const labelAliases = ['label','keterangan','deskripsi','uraian'];
    const amountAliases = ['amount','nominal','jumlah','mutasi'];
    const partnerAliases = ['partner','pengirim','nama'];

    let headerRowIndex = -1;
    let dateCol = -1, labelCol = -1, amountCol = -1, partnerCol = -1;

    for (let i = 0; i < Math.min(rows.length, 15); i++) {
        const row = rows[i];
        if (!Array.isArray(row)) continue;
        let matches = 0;
        for (let j = 0; j < row.length; j++) {
            const cell = String(row[j] || '').trim().toLowerCase();
            if (cell.length === 0) continue;
            if (dateAliases.includes(cell) && dateCol === -1) { dateCol = j; matches++; }
            if (labelAliases.includes(cell) && labelCol === -1) { labelCol = j; matches++; }
            if (amountAliases.includes(cell) && amountCol === -1) { amountCol = j; matches++; }
            if (partnerAliases.includes(cell) && partnerCol === -1) { partnerCol = j; matches++; }
        }
        if (matches >= 2) {
            headerRowIndex = i;
            break;
        }
    }

    if (headerRowIndex === -1 || labelCol === -1 || amountCol === -1) {
        throw new Error('Format kolom mutasi bank tidak dikenali');
    }

    const parseCellDate = (v) => {
        if (typeof v === 'number' && v > 0) {
            const epoch = new Date(Date.UTC(1899, 11, 30));
            const ms = epoch.getTime() + (v - 1) * 86400000;
            const d = new Date(ms);
            return d.toISOString().slice(0, 10);
        }
        if (v instanceof Date) {
            return v.toISOString().slice(0, 10);
        }
        if (typeof v === 'string') {
            const s = v.trim();
            const ymd = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
            if (ymd) {
                const [, y, m, d] = ymd;
                return `${y.padStart(4,'0')}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
            }
            const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
            if (dmy) {
                const [, d, m, y] = dmy;
                return `${y.padStart(4,'0')}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
            }
            const parts = s.split(/[-/]/);
            if (parts.length === 3) {
                let p1 = parseInt(parts[0], 10), p2 = parseInt(parts[1], 10);
                if (p1 > 12) {
                    const d = p1.toString().padStart(2,'0');
                    const m = p2.toString().padStart(2,'0');
                    const y = parts[2].padStart(4,'0');
                    return `${y}-${m}-${d}`;
                }
            }
        }
        return String(v).trim();
    };

    const parseAmount = (v) => {
        if (typeof v === 'number') return v;
        let s = String(v).trim().toLowerCase().replace(/rp/g, '');
        s = s.replace(/[^\d.,()\-]/g, '');
        const neg = s.includes('(') && s.includes(')');
        s = s.replace(/[()]/g, '');
        const hasDot = s.includes('.');
        const hasComma = s.includes(',');
        if (hasDot && hasComma) {
            s = s.replace(/\./g, '');
            s = s.replace(/,/g, '.');
        } else if (hasComma) {
            s = s.replace(/,/g, '.');
        }
        const n = parseFloat(s);
        const result = isNaN(n) ? 0 : n;
        return neg ? -result : result;
    };

    const transactions = [];
    let txIndex = 1;

    for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!Array.isArray(row)) continue;
        const dateVal = row[dateCol];
        const labelVal = row[labelCol];
        const amountVal = row[amountCol];
        const partnerVal = partnerCol >= 0 ? row[partnerCol] : null;
        if ((labelVal === undefined || labelVal === null || String(labelVal).trim() === '') &&
            (amountVal === undefined || amountVal === null || (typeof amountVal === 'string' && amountVal.trim() === ''))) {
            continue;
        }
        transactions.push({
            id: 'TX-' + txIndex++,
            rawDate: parseCellDate(dateVal),
            rawLabel: String(labelVal || '').trim(),
            rawAmount: parseAmount(amountVal),
            partner: partnerVal !== undefined && partnerVal !== null ? String(partnerVal).trim() : null
        });
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
        t.assignedCoaName || '',
        Number(t.rawAmount) || 0,
        (t.reasoning || t.cleanedLabel || '').toString().trim()
    ]);
    const aoa = [header, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Journal');
    const bytes = XLSX.write(wb, {bookType: 'xlsx', type: 'array'});
    return new Uint8Array(bytes);
}

export function exportOdooCsv(transactions) {
    const escapeField = (field) => {
        const s = String(field);
        if (/[;"\r\n]/.test(s)) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    };

    const header = ['DATE', 'ACCOUNT NUMBER', 'ACCOUNT NAME', 'NOMINAL', 'KETERANGAN'];
    const lines = [header.map(escapeField).join(';')];
    for (const t of transactions) {
        const row = [
            t.rawDate,
            t.assignedCoa || '',
            t.assignedCoaName || '',
            Number(t.rawAmount) || 0,
            (t.reasoning || t.cleanedLabel || '').toString().trim()
        ];
        lines.push(row.map(escapeField).join(';'));
    }
    return lines.join('\r\n');
}
