# AGENTS.md

## What this is

Pure client-side static site (HTML + vanilla JS + CSS). **No build system, no package.json, no bundler, no transpilation.** JS runs as native ES modules in the browser.

Deploys to GitHub Pages via GitHub Actions and Vercel.

## Commands

```bash
# Local dev server (zero deps, port 5174, auto-increments if busy)
node serve.mjs

# Unit tests (Node.js ESM, no framework — uses node:assert)
node test/run_tests.js
```

CI runs `node test/run_tests.js` on Node 20 before deploying to GitHub Pages. Tests must pass.

## Architecture

Two HTML entry points:
- `index.html` — landing page (marketing)
- `app.html` — main SPA application (converter)

Clean URL: `/app` serves `app.html` (via `serve.mjs` rewrite + `vercel.json`).

### Classification Pipeline (`js/engine/classifier.js`)

One shared resolver, `classifyDeterministic(tx, master, options)`, serves single, batch, upload and rescan. Actual decision order (the README's "5-Layer" naming is conceptual):

```mermaid
flowchart LR
    S["Sanitizer"] --> X["EXPENSE"]
    X --> L["LEARNED"]
    L --> T["CAMPAIGN_TAIL"]
    T --> D["DONATUR_TETAP"]
    D --> K["KEYWORD (exact, then 1-typo fuzzy)"]
    K --> O["ORG_ALIAS / DONASI_UMUM"]
    O --> A["AI_SEMANTIC (optional)"]
    A --> U["UNAUTHORIZED_FALLBACK"]
```

- Sanitizer: strip bank noise, extract sender via the `SENDER_PATTERNS` table (BI-FAST, TRF DARI, BCA, BI-FAST/SWITCHING CR), remove company aliases
- `EXPENSE`: negative amount or explicit bank-fee phrase (not the bare word "biaya", not "TRF KE"). Zero/non-numeric amounts are quarantined (`invalid_amount`)
- `LEARNED`: exact normalized label previously corrected by the user (`js/store/learned_store.js`, key `ziswaf_learned_v1`); caller passes `options.lookupLearned`
- `CAMPAIGN_TAIL`: trailing digits equal a program tail code; several matches quarantine; a contradicting keyword lowers confidence to 0.8 and is recorded in `evidence`
- `DONATUR_TETAP`: sender matches a registered donor; skipped when the label carries a zakat/wakaf signal that the donor's default program does not match
- `KEYWORD`: whole-phrase score `priority*10000 + keyword length`; ties quarantine; restricted (ZAKAT/WAKAF) programs need an explicit fund signal in the label or keyword
- AI (Ollama/Gemini/OpenAI, off by default) may return only a master `program_id`; everything else falls to `settings.defaultUnauthorizedCoa`

Ambiguity is always quarantined with structured `evidence`, never resolved by array order. See `CLAUDE.md` and `docs/superpowers/plans/2026-11-03-classifier-hardening.md`.

### Key source files

| Path | Role |
|------|------|
| `js/engine/sanitizer.js` | L0 text cleaning, input sanitizers (`sanitizeInputText`, `sanitizeSlug`, `sanitizePhone`, `sanitizeCoaCode`) |
| `js/engine/classifier.js` | `classifySingle()`, `classifyBatch()` — the 5-layer pipeline |
| `js/engine/ai_matcher.js` | Optional AI layer (Ollama, Gemini, OpenAI) |
| `js/store/learned_store.js` | Memory of manual COA corrections (`LEARNED` layer) |
| `js/services/excel_adapter.js` | XLSX/CSV parsing + SIAK export |
| `js/store/master_store.js` | Master data (COA, programs, donors, aliases) in localStorage |
| `js/store/session_store.js` | Transaction rows, filtering, pagination, sorting |
| `js/config/default_presets.js` | Default master data (`DEFAULT_MASTER_DATA`) |
| `js/vendor/xlsx.full.min.js` | Vendored SheetJS — **do not replace without checking tests** |
| `js/app.js` | Main app logic (~3,200 lines, single file) |
| `js/landing.js` | Landing page interactivity |

### CSS

| Path | Scope |
|------|-------|
| `css/style.css` | Core app styles, design tokens, dark/light theme |
| `css/components.css` | UI components (modals, tables, badges, toasts) |
| `css/landing.css` | Landing page specific |

## Testing

Tests are in `test/run_tests.js`. No test framework — just `node:assert` + manual pass/fail tracking.

**Test structure:**
1. Load vendored XLSX via `createRequire` into `globalThis.XLSX`
2. Import engine modules directly (ESM)
3. Run assertions for: sanitizer, classifier routing, input sanitizers, master store CRUD, session store operations

**Critical:** Engine modules (`classifier.js`, `sanitizer.js`) use `globalThis.XLSX` internally. Tests set this up via `createRequire` before importing. If you add XLSX-dependent code to engine modules, ensure tests still load XLSX first.

**Classifier evaluation:** `test/classifier_eval.js` + `test/fixtures/classifier_cases.json` score synthetic labelled cases (coverage/precision); add a case there when changing resolver behaviour.

**E2E parity check** (last block of `test/run_tests.js`): Compares `sample/inputt.xlsx` → classified output against `sample/output.xlsx` golden file. Files are in `.gitignore` (`sample/`), so this test is skipped when absent. Parity ≥50% required.

**Adding tests:** Add `await ok("test name", () => { ... })` blocks. The `ok` function wraps assertions in promises and tracks pass/fail counts. Tests run serially.

## Deployment

- **GitHub Pages:** Push to `main`/`master` triggers `.github/workflows/deploy.yml` → test → deploy
- **Vercel:** `vercel.json` configures clean URLs, rewrites (`/app` → `app.html`), and security headers (CSP, X-Frame-Options, etc.)
- **Deployment target:** Entire repo root (no `dist/` or `build/` step)

## Gotchas

- **localStorage keys are versioned:** `ziswaf_demo_session_rows_v1`, `ziswaf_theme`, `ziswaf_active_page`, `ziswaf_active_subtab`. Renaming breaks user data continuity.
- **Theme flash prevention:** Inline `<script>` in `<head>` of both HTML files reads `localStorage('ziswaf_theme')` before body renders. Do not remove or defer these.
- **Page state preservation:** `app.html` sets `data-active-step` attribute on `<html>` in head script to prevent layout flash on refresh.
- **CSP meta tags:** Both HTML files have inline `Content-Security-Policy` meta tags whitelisting specific origins (Ollama `localhost:11434`, Gemini, OpenAI, OpenRouter). If you add external resources, update CSP in **both** `index.html` and `app.html`.
- **No npm install needed.** All dependencies are either vendored (`xlsx.full.min.js`) or loaded from CDN (Font Awesome, Google Fonts) with CSP exceptions.
- **`serve.mjs` is zero-dependency.** Uses only `node:http`, `node:fs/promises`, `node:path`, `node:url`. Port auto-increments from 5174 (up to 10 retries).
- **`sample/` directory is gitignored** but referenced by the E2E parity test. It contains test fixtures not committed to the repo.
- **UI language is Indonesian (id).** All user-facing strings, labels, and error messages are in Bahasa Indonesia.