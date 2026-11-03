# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Pure client-side static site (HTML + vanilla JS + CSS, native ES modules). No package.json, bundler, or transpiler. UI strings are Bahasa Indonesia. Read `AGENTS.md` for deployment, CSP, and localStorage-key gotchas (but see "Stale docs" below).

## Commands

```bash
node serve.mjs                 # dev server, port 5174 (auto-increments); /app serves app.html
node test/run_tests.js         # the only CI gate (Node 20); custom ok(name, fn) runner, node:assert, serial
node docs/audit-repro.mjs      # 22 defect repros from the audit; exits 1 if any regress
node docs/audit-datasets.mjs   # aggregate stats over test_data/test/Input 1-4.xlsx, AI OFF, no raw labels printed
node --check js/app.js         # quick syntax check (no linter exists)
```

There is no single-test flag: add an `await ok("name", () => {...})` block to `test/run_tests.js` and temporarily comment out others, or probe with a throwaway `.mjs` that imports `js/engine/classifier.js` and `js/config/default_presets.js` directly.

Engine modules rely on `globalThis.XLSX`; `test/run_tests.js` loads the vendored SheetJS via `createRequire` before importing anything. Keep that order.

`test/` also holds many one-off scripts (`apply_*`, `fix_*`, `restore_balance.js`, `test_*.mjs`). Most are not regression tests: several **mutate `test_data/ziswaf-config.json`**, some need live AI keys, and some use hardcoded `C:/Users/Wahyu/...` paths. Only `run_tests.js` is trustworthy. `sample/` and `test_data/ziswaf-config.json` are gitignored/local.

## Architecture: classification is one shared resolver

`js/engine/classifier.js` exports `classifyDeterministic(tx, master)`, used by both `classifySingle` and `classifyBatch` (and by upload and 5-layer rescan in `app.js`). It returns a result with `matchedLayer`; an empty `matchedLayer` means "eligible for AI". Actual decision order (this is **not** the L1..L5 numbering in the README/AGENTS):

1. Sanitize (`sanitizer.js` `cleanTransactionText`: strips bank noise, extracts sender name, removes company aliases)
2. `EXPENSE`: negative amount or explicit bank-fee phrase (NOT the bare word "biaya")
3. `CAMPAIGN_TAIL`: amount's trailing digits equal a program `tailCode`; several matches -> quarantine
4. `DONATUR_TETAP`: sender matches a registered donor (exact, then token-subset; ties -> quarantine)
5. `KEYWORD`: whole-phrase match, score = `priority*10000 + keyword length`; equal top scores -> quarantine; zakat/wakaf signal vs program COA `category` mismatch -> quarantine
6. `ORG_ALIAS`, restricted-fund-without-program (quarantine), `DONASI_UMUM`
7. Optional AI (`ai_matcher.js`), then quarantine to `settings.defaultUnauthorizedCoa` (layer `UNAUTHORIZED_FALLBACK`)

Every result carries structured `evidence` (`tail_code`, `donor`, `keyword`, `*_conflict`, `ai`, ...). Keep fail-closed behaviour: anything ambiguous goes to quarantine, never to an array-order pick.

AI contract (`ai_matcher.js`): providers are only Gemini, OpenAI, Ollama; one label per request; model returns `program_id` (enum of master programs) or null, never a COA — the app derives the COA from the master. Responses are strictly validated; cache key is a fingerprint of provider/model/programs/system accounts/aliases; only `accepted_candidate`/`no_match` are cached. Donor names are never sent to the provider.

Data flow: `excel_adapter.parseBankStatement` -> `classifyBatch(rows, master)` -> `session_store` (rows, filters, merge/dedupe by date+amount+normalized-label fingerprint, 10,000-row cap) -> `app.js` UI -> `excel_adapter` SIAK export. `master_store.js` owns COA/programs/donors/aliases/settings, validates relations (orphan COA, duplicate ids/tail codes), and commits candidate state to localStorage before swapping in-memory state. Status of a row (unauthorized/expense) must come from `matchedLayer`/`isExpense`, not hardcoded COA numbers. COA names have one canonical field (`assignedCoaName`).

`js/app.js` (~3,200 lines) is the single UI controller; there is no component split.

## Stale docs

- `AGENTS.md` still describes the old 5-layer L1..L5 order, "TRF KE -> expense", and ~2,200-line `app.js`; the code differs (see above).
- `docs/AUDIT-REPO-2026-09-27.md` is the authoritative audit + stage log (Stages 1-5 done; Stage 6 = golden accuracy/live-AI verification still open).
- Open classifier work lives in `docs/superpowers/plans/2026-11-03-classifier-hardening.md`.
