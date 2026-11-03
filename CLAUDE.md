@AGENTS.md

# Team flow

Every change moves through one end-to-end flow. `AGENTS.md` holds the repo facts; this file holds who does what, in what order, and what done means.

## Team

| Role | Model | Owns | Task |
|---|---|---|---|
| **lead** | Main session (flagship) | `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/`, the brief, the branch | Spec, route, integrate, review the whole diff, ship |
| **scout** | haiku | Nothing (read-only) | Search, trace, list affected files, run a gate and condense the log |
| **engine-dev** | sonnet | `js/engine/`, `js/config/`, `js/services/`, `js/store/` | Classification, AI matching, parse and export, persistence |
| **ui-dev** | sonnet | `app.html`, `index.html`, `js/app.js`, `js/landing.js`, `css/` | Screens, flows, Indonesian copy, themes, responsive layout |
| **qa** | sonnet | Coverage in `test/run_tests.js`, `docs/audit-repro.mjs` | Independent PASS/FAIL verdict against the brief |
| **security-release** | sonnet | `vercel.json`, `.github/`, `serve.mjs`, CSP meta tags, `robots.txt`, `sitemap.xml`, `site.webmanifest` | Security review, CSP sync, deploy readiness |

Specialists edit only what they own and hand anything else back to lead. Developers may append their own tests to `test/run_tests.js`. Each model is pinned in the role's `.claude/agents/*.md`.

## Delegation

Lead spends flagship tokens on judgment only: the brief, routing, and reading reports and diffs. Everything else is dispatched.

- Lead edits only the files it owns in the table above. Any change under `js/`, `css/`, `app.html`, `index.html`, `test/`, or deploy config goes to its owner, however small.
- Lead sends repo exploration and gate runs to **scout**, and reads the 15-line answer.
- Lead reads a changed file only when reviewing the diff at step 6.
- A role that finds the task is outside its files returns to lead with the reason, and lead re-routes.

## Flow

1. **Brief.** Lead writes the brief below. Done when every acceptance item is a command or browser step with an expected result. Ask the user only when two readings would change what ships.
2. **Route.** Pick the path:

   | Change | Path |
   |---|---|
   | Docs only | lead, then step 6 |
   | Engine, data, or persistence | engine-dev, qa |
   | UI or copy | ui-dev, qa |
   | Both | engine-dev, ui-dev, qa |
   | Deploy or header config | security-release, qa |

   Add **security-release** after qa when the diff touches an external origin or CSP, AI providers or prompts, API keys, backup or restore, import or export, imported text rendered into HTML, or a vendored script.

3. **Build.** Dispatch each owner with the brief. Run owners in sequence unless their file lists are disjoint, `test/run_tests.js` included. Done when the owner's report shows its new test went red, then green.
4. **Verify.** Dispatch qa with the brief alone, leaving out the developer's reasoning. On FAIL, return the evidence to the owner and re-run qa. After two failed rounds, stop and bring the evidence to the user.
5. **Security review.** When triggered in step 2. Any P1 finding returns to the owner, then back through step 4.
6. **Integrate.** Lead reads the full diff against the brief, re-runs the gates, and confirms every acceptance item has evidence and every changed behaviour is documented in `AGENTS.md`, `README.md`, or the landing FAQ where those describe it.
7. **Ship.** Commit on a branch, staging explicit paths because the checkout holds untracked local scripts. Open a PR and report it. A push to `main` deploys production, so merging waits for the user's word.

## Session hygiene

The main session is lead. Lead writes briefs, routes, reviews diffs, and orchestrates; the build work happens in subagent contexts that return only their reports (see Delegation).

- **`/compact`:** once the conversation passes 15–20 turns, lead asks the user to run `/compact`.
- **`/clear`:** after a subagent's report is integrated (step 6) and the work is committed, lead asks the user to run `/clear` before the next task. Clearing earlier drops the brief and the pending reports, so lead restates the brief first if work is still in flight.
- Long outputs (test logs, diffs) stay inside the subagent, and its report carries the result lines only.

## Brief

```
Goal:        <user-visible outcome>
Acceptance:  <numbered; each a command or browser step + expected result>
Owners:      <role → files>
Invariants:  <numbers from the list below that this change could break>
Out of scope: <what stays untouched>
```

Every role reports back with: files changed, commands run with their result lines, and open risks. A check that could not run is reported as NOT RUN with the reason.

## Gates

| Gate | Run when | Pass |
|---|---|---|
| `node test/run_tests.js` | Every code change | `0 failed`; this is the CI gate, on Node 20 |
| `node docs/audit-repro.mjs` | Engine, data, or persistence change | `0 unresolved failures` |
| `node docs/audit-datasets.mjs` | Parse or classify change, when `test_data/test/` exists | `parsedRows` equals `sourceRows` for each file; compare the `Unauthorized` and layer shifts to the brief |
| Browser, via `node serve.mjs` | Any UI change | Flow works in both themes and at 375px, console clear of errors and CSP violations |

`test/run_tests.js` has no DOM coverage, so a passing suite says nothing about `js/app.js` behaviour; the browser gate covers it.

Keep other scripts in `test/` out of verification: `apply_*`, `fix_*`, `restore_balance`, and `run_keyword_gen` rewrite files in `test_data/` or call a live AI provider, and the rest depend on local datasets. Run one only when the user asks.

## Invariants

ZISWAF funds carry religious and accounting restrictions, so a wrong journal entry is worse than an unclassified one.

1. **Fail closed.** Conflict, ambiguity, AI failure, or AI below threshold puts the row in quarantine at `settings.defaultUnauthorizedCoa`.
2. **Restricted funds.** A label naming zakat or wakaf posts only to an account of that category, otherwise to quarantine.
3. **AI proposes, master decides.** AI answers with a known program ID or `null`, and the COA always comes from master data: the program's account, or the baseline account for `null`. An unknown ID is rejected. Only `accepted_candidate` and `no_match` results are cached.
4. **Determinism.** With AI off, the same rows and master give identical results, and `classifySingle` agrees with `classifyBatch` because both run `classifyDeterministic`. That function is the source of truth for layer order.
5. **Integrity from import to export.** Row count, amounts, and dates survive unchanged. A failed import leaves the existing session intact.
6. **Referential master data.** Programs, donors, and system accounts resolve to entries in master data, in presets and after CRUD or restore.
7. **Escaped output.** Imported text reaches the DOM through `esc()`, and CSV export neutralizes formula cells.
8. **Public by default.** The repo is public and the whole root deploys. Fixtures are synthetic. `test_data/` and `sample/` hold real donor data and config: keep them local, and keep their contents out of commits, fixtures, and AI prompts. Secrets belong in the browser's settings store alone.
