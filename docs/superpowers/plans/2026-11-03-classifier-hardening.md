# Classifier Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining correctness and coverage gaps in the deterministic classifier (`js/engine/classifier.js`, `js/engine/sanitizer.js`) and add a measurable accuracy gate, without adding a build system or dependency.

**Architecture:** Keep the single shared resolver `classifyDeterministic(tx, master)` and its fail-closed rule (ambiguous -> quarantine with structured `evidence`). Add guards where a weak signal can currently decide a restricted fund, add an evaluation harness so every later change is measured, then add one new explainable layer (`LEARNED`) that reuses the user's own manual corrections.

**Tech Stack:** Vanilla JS ES modules, Node 20 `node:assert` runner (`test/run_tests.js`), localStorage.

**Spec:** `docs/AUDIT-REPO-2026-09-27.md` (sections "Spesifikasi pipeline sasaran", "Kontrak AI sasaran", Stage 6). This plan covers what that audit left open plus the weaknesses in the next section.

## Global Constraints

- No `package.json`, bundler, or runtime dependency. Browser-native ES modules only.
- UI/user-facing strings and `reasoning` text are Bahasa Indonesia.
- Existing layer names are a UI contract: `EXPENSE`, `CAMPAIGN_TAIL`, `DONATUR_TETAP`, `KEYWORD`, `ORG_ALIAS`, `DONASI_UMUM`, `AI_SEMANTIC`, `UNAUTHORIZED_FALLBACK`. Only Task 7 adds one (`LEARNED`).
- Anything ambiguous or conflicting is quarantined to `master.settings.defaultUnauthorizedCoa`, never resolved by array order.
- Zakat/wakaf funds are restricted: never assigned on a weak or generic signal.
- Status checks use `matchedLayer`/`isExpense`, never literal COA numbers (`40201000`, `60100008`).
- Tests: `node test/run_tests.js` must stay green (baseline: 67 passed, 0 failed). No test may need an API key or private data.
- New localStorage keys are versioned (`_v1`). Do not rename existing ones.

## Verified weaknesses (evidence)

Probes were run against `DEFAULT_MASTER_DATA` with AI OFF on 2026-11-03. "Code" means read from source, not yet reproduced.

| ID | Weakness | Evidence |
|---|---|---|
| W1 | Weak keyword assigns a restricted fund. Program `prog-wakaf-pesantren` (COA 40203201, category WAKAF) has the generic keyword `masjid`. | Probe: label `infaqjumat masjid`, amount 100000 -> `KEYWORD`, COA 40203201 with no wakaf word. The existing guard only checks label-has-signal -> program-wrong-category, not the reverse. |
| W2 | Donor layer has no fund-signal guard. | Code (`classifier.js:173-181`): a donor with default program Infaq Subuh sending "zakat fitrah" is assigned to Infaq Subuh. |
| W3 | Tail code beats an explicit keyword. | Probe: `Zakat fitrah keluarga` with amount ending `302` -> `CAMPAIGN_TAIL` Bantuan Gizi Santri. A 3-digit tail collides with ~0.1% of amounts per program (13 programs have tails). |
| W4 | Zero-amount rows are treated as income and classified. | Probe: `infaq`, amount 0 -> `KEYWORD`. |
| W5 | Sender extraction only knows BI-FAST/`TRF DARI`/BCA shapes. | Probe: `TRANSFER DARI BUDI SANTOSO infaq jumat` -> sender `null`, so the donor layer is dead for that bank format. Audit: 2,506 of 3,999 dataset rows have no deterministic rule. |
| W6 | No typo/variant tolerance beyond a hardcoded spelling map in `normalizeForMatch`. | Probe: `sedeqah subuh` only matched via `subuh`. Misspellings of a keyword never match. |
| W7 | With AI OFF, ~65% of real rows end in quarantine (2,588 of 3,999) and nothing measures whether the other 35% are correct. | Audit Stage 3 table; the golden file is unofficial (18 comparable pairs). |
| W8 | The tool does not learn from manual corrections; the same reviewer fixes the same label repeatedly across sessions. | Code: `isOverridden` rows are protected within a session only. |
| W9 | AI path is serial (`chunkSize = 1`), so a 2,500-row quarantine tail means 2,500 sequential HTTP calls. | Code (`classifier.js:311`). Backlog, not in tasks below. |
| W10 | `AGENTS.md` and README still describe the superseded L1..L5 order. | Fixed for agents by `CLAUDE.md`; README/AGENTS edit is Task 8. |

## Review Focus

- A label that names no fund but hits a restricted program's generic keyword (`masjid`, `gedung`, `semen`) must not land in a WAKAF/ZAKAT COA. (Task 2)
- A registered donor sending a zakat/wakaf-labelled transfer must not be filed under their default non-zakat program. (Task 2)
- A coincidental tail code on a row whose text clearly says something else must be quarantined, not trusted. (Task 3)
- Zero, empty, or non-numeric amounts must never be reported as classified income. (Task 4)
- A corrected label learned once must not leak onto a *different* label that merely shares a substring. (Task 7)

## File Structure

- `test/fixtures/classifier_cases.json` (create): synthetic labelled cases, no real names.
- `test/classifier_eval.js` (create): exports `evaluate(cases, master, classify) -> report`; imported by `run_tests.js`.
- `js/engine/classifier.js` (modify): guards (Tasks 2-4), fuzzy pass (Task 6), learned hook (Task 7).
- `js/engine/sanitizer.js` (modify): table-driven sender patterns (Task 5).
- `js/store/learned_store.js` (create): normalized-label -> correction memory (Task 7).
- `js/app.js` (modify): record corrections, pass `lookupLearned`, badge for `LEARNED` (Task 7).
- `docs/audit-sender-coverage.mjs` (create): aggregate-only sender-shape histogram (Task 5).
- `AGENTS.md`, `README.md` (modify): sync pipeline description (Task 8).

---

### Task 1: Evaluation harness and baseline

**Files:**
- Create: `test/fixtures/classifier_cases.json`, `test/classifier_eval.js`
- Modify: `test/run_tests.js` (new block before the `== E2E PARITY` section)

**Interfaces:**
- Produces: `evaluate(cases: Case[], master: Master, classify: (tx, master) => Result): Report` where `Case = { label: string, amount: number, expect: { layer?: string, coa?: number, notCoa?: number[], quarantine?: boolean } }` and `Report = { total, decided, quarantined, wrong, wrongCases: string[], coverage: number, precision: number }` (`coverage = decided/total`, `precision = (decided - wrong)/decided`, 1 when `decided = 0`).

- [ ] **Step 1: Write the failing test** in `run_tests.js`: `await ok("classifier eval harness reports coverage and precision on fixtures", ...)` loading the fixture JSON, calling `evaluate(cases, structuredClone(DEFAULT_MASTER_DATA), classifyDeterministic)`, asserting `report.total === cases.length`, `report.precision === 1`, `report.coverage >= 0.5`.
- [ ] **Step 2: Run** `node test/run_tests.js`; expected FAIL: cannot import `./classifier_eval.js`.
- [ ] **Step 3: Implement `evaluate`** in `test/classifier_eval.js`. A case is *decided* when `matchedLayer` is not `UNAUTHORIZED_FALLBACK` and not empty; it is *wrong* when any `expect` field is violated (`quarantine: true` means it must be quarantined; a decided case with `expect.quarantine` is wrong).
- [ ] **Step 4: Author 30 synthetic cases** in the fixture: at least 3 per layer, plus the Task 2-4 probe labels from the table above, each with the *intended* expectation. Cases for W1-W4 fail today, so keep them in a separate `pendingCases` array that the harness does not run; each of Tasks 2-4 moves its own cases into `cases`.
- [ ] **Step 5: Run** `node test/run_tests.js`; expected PASS, 68+ passed, 0 failed. Record the printed coverage/precision in the commit message.
- [ ] **Step 6: Commit** `test: add classifier evaluation harness and synthetic cases`.

### Task 2: Restricted-fund guards (W1, W2)

**Files:**
- Modify: `js/engine/classifier.js` (keyword branch ~`:189`, donor branch ~`:173`)
- Test: `test/run_tests.js`, `test/fixtures/classifier_cases.json`

**Interfaces:**
- Consumes: `categoryForCoa(master, code)`, `ZAKAT_RE`, `WAKAF_RE` (existing), `evaluate` (Task 1).
- Produces: `const FUND_SIGNAL = { ZAKAT: RegExp, WAKAF: RegExp }` module constant; new evidence types `restricted_keyword_without_signal` and `donor_fund_conflict`.

- [ ] **Step 1: Write failing tests** (three `ok` blocks):
  - `restricted program keyword without fund signal is quarantined`: `det("sumbangan masjid kampung", 100000)` where `det = (l, a) => classifyDeterministic({id:"t", rawDate:"2026-01-01", rawLabel:l, rawAmount:a}, structuredClone(DEFAULT_MASTER_DATA))`; assert `r.assignedCoa !== 40203201` and `r.evidence?.type === "restricted_keyword_without_signal"`.
  - positive control: `det("wakaf pesantren", 100000).assignedCoa === 40203201`.
  - `donor with default non-zakat program sending zakat label is not auto-filed`: label `"Trf Dari - Donatur Contoh 01 - zakat fitrah"`, assert `r.assignedProgramId !== "prog-sdq-subuh"`.
- [ ] **Step 2: Run**; expected FAIL on the first and third.
- [ ] **Step 3: Implement.** `FUND_SIGNAL.ZAKAT` = zakat|zkt|fitrah|fidyah|maal; `FUND_SIGNAL.WAKAF` = wakaf (reuse the existing regexes, extend ZAKAT with `fitrah|maal`; `fidyah` stays out unless the preset's Fidyah COA category is ZAKAT, which the implementer must check in `default_presets.js` first). In the keyword branch: if the program's COA category is `ZAKAT` or `WAKAF` and the label lacks that category's signal, quarantine. In the donor branch: if the label has a ZAKAT or WAKAF signal and the donor program's category does not match, fall through to the keyword layer instead of returning (and quarantine if keyword also fails).
- [ ] **Step 4: Run** `node test/run_tests.js` and `node docs/audit-datasets.mjs`; expected PASS, and the dataset report must show `unknownCoa 0` and single/batch diff 0. Note how many dataset rows moved from `KEYWORD` to quarantine; that count goes in the commit message.
- [ ] **Step 5: Commit** `fix: guard restricted funds against weak keyword and donor matches`.

### Task 3: Tail code must agree with keyword evidence (W3)

**Files:** Modify `js/engine/classifier.js` (tail branch `:148-164`, needs the keyword decision computed first); Test: `test/run_tests.js`.

**Interfaces:**
- Consumes: `findKeywordDecision` (existing).
- Produces: evidence type `tail_keyword_conflict`; tail confidence `0.97` when a keyword for the *same* program also matches.

- [ ] **Step 1: Write failing tests**:
  - `tail code conflicting with explicit keyword is quarantined`: `det("Zakat fitrah keluarga", 50302)` -> `evidence.type === "tail_keyword_conflict"`.
  - `tail code agreeing with keyword is boosted`: `det("Zakat fitrah", 50007)` -> `matchedLayer === "CAMPAIGN_TAIL"`, `confidence === 0.97`.
  - `tail code alone still decides`: `det("transfer", 50302)` -> `CAMPAIGN_TAIL`, program `prog-gizi`.
- [ ] **Step 2: Run**; expected FAIL on the first two.
- [ ] **Step 3: Implement.** Compute the keyword candidate before the tail branch. Single tail match + no keyword -> unchanged. Tail and keyword name the same program -> `CAMPAIGN_TAIL` at 0.97. Different programs -> quarantine. Keep the multi-tail conflict rule.
- [ ] **Step 4: Run** the suite and `node docs/audit-datasets.mjs`; compare the Kode ekor count (107 at last audit) and list how many moved; expected PASS.
- [ ] **Step 5: Commit** `fix: quarantine tail codes that contradict keyword evidence`.

### Task 4: Invalid amounts (W4)

**Files:** Modify `js/engine/classifier.js` (after the expense branch, `:137`); Test: `test/run_tests.js`.

**Interfaces:** Produces evidence type `invalid_amount`.

- [ ] **Step 1: Write failing tests**: `det("infaq", 0)`, `det("infaq", NaN)`, and `det("infaq", "abc")` each give `matchedLayer === "UNAUTHORIZED_FALLBACK"` and `evidence.type === "invalid_amount"`; `det("infaq", 100000)` unaffected.
- [ ] **Step 2: Run**; expected FAIL.
- [ ] **Step 3: Implement.** Use `Number(tx.rawAmount)`; if not finite or `=== 0`, quarantine with reasoning "Nominal transaksi tidak valid atau nol; perlu ditinjau manual." Negative amounts still go to `EXPENSE` first.
- [ ] **Step 4: Run** the suite; expected PASS.
- [ ] **Step 5: Commit** `fix: quarantine zero and non-numeric amounts`.

### Task 5: Table-driven sender patterns (W5)

**Files:**
- Create: `docs/audit-sender-coverage.mjs`
- Modify: `js/engine/sanitizer.js` (`cleanTransactionText`, the nested if/else at `:61-94`)
- Test: `test/run_tests.js`

**Interfaces:**
- Produces: `const SENDER_PATTERNS: Array<{ name: string, re: RegExp, group: number | ((m: RegExpMatchArray) => string) }>` inside `sanitizer.js`; `cleanTransactionText` signature unchanged.

- [ ] **Step 1: Write `docs/audit-sender-coverage.mjs`**: load the four `test_data/test/Input N.xlsx` through `parseBankStatement`, run `cleanTransactionText`, and print (aggregate only, no raw labels or names) the sender-extraction rate and a histogram of the first three whitespace tokens with digit runs replaced by `#`, top 25 shapes among rows with `extractedSenderName === null`. Run it and save the output as the baseline in the commit message. If `test_data/test` is absent the script exits 0 with "no data".
- [ ] **Step 2: Write failing tests** using the top shapes from the histogram (the implementer adds one `ok` per shape with a synthetic sender name, e.g. `cleanTransactionText("<shape> BUDI SANTOSO", []).extractedSenderName === "BUDI SANTOSO"`). Do not invent bank formats that are not in the histogram or provided by the user.
- [ ] **Step 3: Refactor** the five existing patterns into `SENDER_PATTERNS` (same order, same results; existing sanitizer tests must stay green) and add one entry per histogram shape.
- [ ] **Step 4: Run** the suite and the coverage script; expected extraction rate strictly higher than baseline and existing tests PASS.
- [ ] **Step 5: Commit** `feat: table-driven sender extraction with additional bank formats`.

### Task 6: Conservative fuzzy keyword fallback (W6)

**Files:** Modify `js/engine/classifier.js` (`findKeywordDecision`); Test: `test/run_tests.js`.

**Interfaces:**
- Produces: `function editDistanceAtMostOne(a: string, b: string): boolean`; keyword evidence gains `fuzzy: true`; fuzzy confidence `0.8` (exact stays `0.9`), same layer name `KEYWORD` so UI counters need no change.

- [ ] **Step 1: Write failing tests**: first confirm `det("fidyah ramadhan", 100000)` yields `KEYWORD` (otherwise pick another exact label that does); then `det("fidiyah ramadhan", 100000)` must have the same `assignedCoa`, `evidence.fuzzy === true`, `confidence === 0.8`. Negative: tokens shorter than 6 characters never fuzzy-match (`"mal"` must not match `"mah"`), and a fuzzy hit that ties with a different program is quarantined.
- [ ] **Step 2: Run**; expected FAIL.
- [ ] **Step 3: Implement.** Only when the exact pass finds no candidate: compare each single-token keyword (length >= 6) with each label token (length >= 6) using Damerau-Levenshtein distance <= 1 (insertion, deletion, substitution, adjacent transposition). Multi-word keywords are not fuzzed. Restricted-fund guards from Task 2 apply unchanged.
- [ ] **Step 4: Run** the suite and dataset audit; report how many quarantined rows turned into fuzzy hits (hand-sample 20 labels aggregate-level via the eval harness, not by printing names).
- [ ] **Step 5: Commit** `feat: single-edit typo tolerance for long keywords`.

### Task 7: Learned corrections layer (new logic; run with Opus)

Design rationale: standard options for noisy short Indonesian transaction text are fuzzy matching (Task 6), char n-gram TF-IDF with kNN, or a supervised/LLM classifier. This repo is static and client-only with no training data checked in, so the cheapest sound approach is *memory of the user's own corrections*: exact on the normalized label first (explainable, deterministic); n-gram kNN only if Task 1's harness shows exact reuse is not enough. The kNN variant is deliberately left out of this plan (YAGNI). These references are from general knowledge, not a web lookup; if the kNN phase is ever scheduled, verify the method against current sources first.

**Files:**
- Create: `js/store/learned_store.js`
- Modify: `js/engine/classifier.js`, `js/app.js` (manual-correction handlers near the `isOverridden` writes; layer badge mapping where `DONATUR_TETAP` is rendered; grep to find both)
- Test: `test/run_tests.js`

**Interfaces:**
- Produces in `learned_store.js`: `normalizeLearnKey(label: string): string` (lowercase, `normalizeEvidence`-style cleanup, digit runs and reference tokens removed, whitespace collapsed; returns `""` when fewer than 2 informative tokens); `learnFromCorrection(label: string, programId: string | null, coa: number): void`; `lookupLearned(label: string): { programId: string | null, coa: number, count: number } | null`; `clearLearned(): void`; persists to `ziswaf_learned_v1`, in-memory fallback when storage is blocked; a key with conflicting corrections (different COA) is dropped from lookup (returns null).
- Changes: `classifyDeterministic(tx, master, options = {})` accepts `options.lookupLearned`; `classifySingle`/`classifyBatch` forward an `options` third argument. New layer `LEARNED`, confidence `0.97`, evidence `{ type: "learned", value: { key, count } }`, placed immediately after the expense branch.

- [ ] **Step 1: Write failing tests**: (a) `normalizeLearnKey("TRF DARI - Budi - infaq jumat 123456")` equals `normalizeLearnKey("Trf Dari - Budi - Infaq Jumat 987654")`; (b) after `learnFromCorrection("infaq jumat pak budi", "prog-x", 40201001)`, `classifyDeterministic(tx, master, { lookupLearned })` returns layer `LEARNED`; (c) a different label sharing one word (`"infaq"`) returns no learned hit; (d) two conflicting corrections for the same key make `lookupLearned` return null; (e) learned lookup never overrides `EXPENSE` (negative amount); (f) with no `options`, behavior is identical to today (all existing tests pass).
- [ ] **Step 2: Run**; expected FAIL: module missing.
- [ ] **Step 3: Implement** `learned_store.js` and the classifier hook. Validate that `coa` still exists in `master.coaList` and `programId` (if set) in `master.programs` at lookup time; otherwise ignore the memory entry.
- [ ] **Step 4: Wire `app.js`**: on a single or bulk manual COA correction call `learnFromCorrection(row.cleanedLabel || row.rawLabel, row.assignedProgramId ?? null, newCoa)`; pass `{ lookupLearned }` in upload and rescan calls; add `LEARNED` to the layer badge/label map with Indonesian text "Belajar dari koreksi"; add a "Hapus memori koreksi" button calling `clearLearned()` in the Backup/Restore tab. Verify in the browser (`node serve.mjs`, `/app`): correct one row, upload a file containing the same label, confirm the badge.
- [ ] **Step 5: Run** `node test/run_tests.js` and `node --check js/app.js`; expected PASS.
- [ ] **Step 6: Commit** `feat: LEARNED layer reuses user's manual corrections`.

### Task 8: Sync docs

**Files:** Modify `AGENTS.md`, `README.md` (pipeline section), `CLAUDE.md`.

- [ ] **Step 1:** Replace the L1..L5 description in `AGENTS.md` with the actual decision order from `CLAUDE.md`, remove "TRF KE -> expense", update the `app.js` line count and test count; in `CLAUDE.md` add `LEARNED` and the new guards and drop the "open classifier work" pointer once Tasks 1-7 are merged.
- [ ] **Step 2: Run** `node test/run_tests.js`; expected PASS.
- [ ] **Step 3: Commit** `docs: sync pipeline description with resolver`.

## Backlog (not scheduled)

- W9: bounded-concurrency AI calls (pool of ~4, results re-ordered by index so output stays deterministic).
- Stage 6 of the audit: an authorised golden dataset, then raise `run_tests.js` parity from "skip when absent" to a coverage-and-precision gate using Task 1's `evaluate`.
- n-gram kNN over learned corrections, only if Task 1 metrics show exact reuse leaves a large repeat-label tail.
- Concatenated words (`infaqjumat`) and Indonesian stemming; only with evidence from the sender/label histograms.

## Self-review

- Coverage: W1-W2 -> Task 2, W3 -> 3, W4 -> 4, W5 -> 5, W6 -> 6, W7 -> 1, W8 -> 7, W10 -> 8, W9 backlog.
- Types: `det(label, amount)` helper, `evaluate`, `lookupLearned`, and `options` are named identically across tasks. `evaluate` in Task 1 Step 4 states one simplification (pending cases kept outside the run) to avoid an env-var mechanism.
- Risk: Tasks 2 and 3 intentionally move dataset rows from decided to quarantine. That trades coverage for safety; each task records the delta, and the owner should accept it explicitly before merge.
