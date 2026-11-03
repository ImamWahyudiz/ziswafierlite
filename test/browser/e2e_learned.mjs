// Manual browser E2E (not part of CI). Drives the real app over the Chrome DevTools protocol:
// correct a row via the COA picker, upload a CSV with the same label, expect the LEARNED layer.
// Needs: `node serve.mjs` running, and Chromium/Chrome started with --remote-debugging-port=9333 (headless is fine).
// Run:   node test/browser/e2e_learned.mjs   (env: APP_BASE, CDP_PORT). Wipes that browser profile's localStorage for the app origin.
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const BASE = process.env.APP_BASE || 'http://localhost:5174';
const CSV_PATH = join(tmpdir(), 'ziswaf_learned_upload.csv');
const list = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9333}/json/list`)).json();
const target = list.find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description).join(' '));
});
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
  return r.result.result.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const check = (name, cond, detail = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : '')); if (!cond) process.exitCode = 1; };

await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
await send('Page.navigate', { url: BASE + '/app.html' }); await sleep(1500);
await ev(`localStorage.clear(); 0`);
await send('Page.navigate', { url: BASE + '/app.html' }); await sleep(1500);

// Seed two quarantined rows through the app's own modules, then land on the dashboard.
await ev(`(async () => {
  const { classifyBatch } = await import('/js/engine/classifier.js');
  const { getMaster } = await import('/js/store/master_store.js');
  const { setRows } = await import('/js/store/session_store.js');
  const rows = [
    { id: 'TX-a', rawDate: '2026-01-05', rawLabel: 'Pembayaran XYZ Bapak Budi 111', rawAmount: 100000, partner: '' },
    { id: 'TX-b', rawDate: '2026-01-06', rawLabel: 'Pembayaran XYZ Bapak Budi 222', rawAmount: 100000, partner: '' }
  ];
  setRows(await classifyBatch(rows, getMaster()));
  localStorage.setItem('ziswaf_active_page', 'dashboard');
  return 1;
})()`);
await send('Page.navigate', { url: BASE + '/app.html' }); await sleep(2000);

const layerOf = (rid) => ev(`JSON.parse(localStorage.getItem('ziswaf_demo_session_rows_v1')).find(r => r.id === '${rid}')?.matchedLayer`);
check('seed rows are quarantined', (await layerOf('TX-a')) === 'UNAUTHORIZED_FALLBACK' && (await layerOf('TX-b')) === 'UNAUTHORIZED_FALLBACK');

// Real UI: open the COA picker on TX-a and choose Beasiswa COA 40202201.
const hasBtn = await ev(`!!document.querySelector('.coa-table-btn[data-id="TX-a"]')`);
check('dashboard shows COA button for TX-a', hasBtn);
await ev(`document.querySelector('.coa-table-btn[data-id="TX-a"]').click(); 0`); await sleep(400);
const picked = await ev(`(() => { const it = document.querySelector('#global-coa-picker .coa-dropdown-item[data-code="40202201"]'); if (!it) return false; it.click(); return true; })()`);
check('picker item 40202201 clicked', picked); await sleep(500);
check('TX-a is MANUAL_OVERRIDE', (await layerOf('TX-a')) === 'MANUAL_OVERRIDE');
const learned = await ev(`localStorage.getItem('ziswaf_learned_v1')`);
check('learned memory persisted', !!learned && learned.includes('40202201'), learned);

// Real upload: CSV with the same label (different digits) plus an unrelated one.
const csv = 'Date,Label,Amount\n2026-02-01,Pembayaran XYZ Bapak Budi 333,150000\n2026-02-02,Pembayaran lain tanpa pola,150000\n';
writeFileSync(CSV_PATH, csv);
const doc = await send('DOM.getDocument', { depth: 1 });
const inp = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#file-input' });
check('file input found', !!inp.result.nodeId, JSON.stringify(inp.result));
await send('DOM.setFileInputFiles', { nodeId: inp.result.nodeId, files: [CSV_PATH] });
await ev(`document.querySelector('#file-input').dispatchEvent(new Event('change', { bubbles: true })); 0`);
await sleep(2500);
await ev(`document.getElementById('btn-merge-file').click(); 0`);
await sleep(3500);
const rowsNow = JSON.parse(await ev(`localStorage.getItem('ziswaf_demo_session_rows_v1') || '[]'`));
const byLabel = l => rowsNow.find(r => r.rawLabel === l);
const up = byLabel('Pembayaran XYZ Bapak Budi 333');
check('uploaded same-label row classified LEARNED', up?.matchedLayer === 'LEARNED' && up?.assignedCoa === 40202201, JSON.stringify([up?.matchedLayer, up?.assignedCoa, up?.reasoning]));
check('unrelated uploaded row not learned', byLabel('Pembayaran lain tanpa pola')?.matchedLayer === 'UNAUTHORIZED_FALLBACK');
check('earlier session rows intact after merge', rowsNow.length === 4, String(rowsNow.length));
const badgeInfo = await ev(`(() => { const b = document.querySelector('.badge-learned'); return b ? [b.textContent.trim(), getComputedStyle(b).borderTopColor, !!b.offsetParent] : null; })()`);
check('LEARNED badge rendered, styled, visible', !!badgeInfo && badgeInfo[0] === 'Dipelajari' && badgeInfo[2] === true && badgeInfo[1] !== 'rgba(0, 0, 0, 0)', JSON.stringify(badgeInfo));

// Clear-memory button (confirm auto-accepted).
await ev(`window.confirm = () => true; document.getElementById('btn-clear-learned').click(); 0`); await sleep(500);
const after = await ev(`localStorage.getItem('ziswaf_learned_v1')`);
check('clear button empties learned memory', after === null, String(after));
console.log('page errors:', JSON.stringify(errors));
ws.close();
