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

1. Sanitize (`sanitizer.js` `cleanTransactionText`: strips bank noise, extracts sender via the `SENDER_PATTERNS` table, removes company aliases)
2. Zero/non-numeric amount -> quarantine (`invalid_amount`); then `EXPENSE`: negative amount or explicit bank-fee phrase (NOT the bare word "biaya")
3. `LEARNED`: exact normalized label the user already corrected (`store/learned_store.js`; caller passes `options.lookupLearned`, so the engine stays storage-free)
4. `CAMPAIGN_TAIL`: amount's trailing digits equal a program `tailCode`; several matches -> quarantine; a keyword pointing at a different program lowers confidence to 0.8 (`evidence.contradictedByKeywordProgramId`) but the tail still wins (approved order)
5. `DONATUR_TETAP`: sender matches a registered donor (exact, then token-subset; ties -> quarantine); skipped if the label has a zakat/wakaf signal the donor's default program category does not match
6. `KEYWORD`: whole-phrase match, score = `priority*10000 + keyword length`; equal top scores -> quarantine; if nothing matches exactly, single-word keywords of 6+ chars tolerate one typo (confidence 0.8, `evidence.fuzzy`); ZAKAT/WAKAF programs need an explicit fund signal in label or keyword, and a signal/category mismatch -> quarantine
7. `ORG_ALIAS`, restricted-fund-without-program (quarantine), `DONASI_UMUM`
8. Optional AI (`ai_matcher.js`), then quarantine to `settings.defaultUnauthorizedCoa` (layer `UNAUTHORIZED_FALLBACK`)

An empty `matchedLayer` from `classifyDeterministic` means "no rule" (AI-eligible); `classifySingle/Batch` turn it into quarantine. `test/classifier_eval.js` + `test/fixtures/classifier_cases.json` hold labelled cases: add one when you change resolver behaviour. `docs/audit-sender-coverage.mjs` reports sender-extraction rate on the local datasets.

Every result carries structured `evidence` (`tail_code`, `donor`, `keyword`, `*_conflict`, `ai`, ...). Keep fail-closed behaviour: anything ambiguous goes to quarantine, never to an array-order pick.

AI contract (`ai_matcher.js`): providers are only Gemini, OpenAI, Ollama; one label per request; model returns `program_id` (enum of master programs) or null, never a COA — the app derives the COA from the master. Responses are strictly validated; cache key is a fingerprint of provider/model/programs/system accounts/aliases; only `accepted_candidate`/`no_match` are cached. Donor names are never sent to the provider.

Data flow: `excel_adapter.parseBankStatement` -> `classifyBatch(rows, master)` -> `session_store` (rows, filters, merge/dedupe by date+amount+normalized-label fingerprint, 10,000-row cap) -> `app.js` UI -> `excel_adapter` SIAK export. `master_store.js` owns COA/programs/donors/aliases/settings, validates relations (orphan COA, duplicate ids/tail codes), and commits candidate state to localStorage before swapping in-memory state. Status of a row (unauthorized/expense) must come from `matchedLayer`/`isExpense`, not hardcoded COA numbers. COA names have one canonical field (`assignedCoaName`).

`js/app.js` (~3,200 lines) is the single UI controller; there is no component split.

## Docs

- `README.md` still uses the conceptual "5-Layer" naming; the order above is what runs.
- `docs/AUDIT-REPO-2026-09-27.md` is the audit + stage log (Stages 1-5 done; Stage 6 = golden accuracy/live-AI verification still open).
- `docs/superpowers/plans/2026-11-03-classifier-hardening.md` is the classifier hardening plan with its execution log (Tasks 1-8 done; backlog remains).
