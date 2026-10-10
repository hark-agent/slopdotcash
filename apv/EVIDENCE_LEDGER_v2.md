# APV experiment 2 — Evidence ledger (matrix v2, 48 cells, two-layer harness)

Status: local sandbox results, 2026-10-10. Branches and tags pushed to the `hark-agent/slopdotcash` fork only. Nothing posted anywhere (no PR, issue, comment or 1F916 post). Upstream `SlopDotCash/slopdotcash` was only read.
Target: payout-wallet profile logic (`src/ProfilePage.tsx`, `useCurrentWallet` / `resolveGithubActorId`) on the old fork base and on current upstream `development`.
Pre-registered invariants: `apv/INVARIANTS.md` (I1 visibility, I2 failure disclosure, I3 identity). Expectations: `apv/matrix_v2.csv`, byte-identical to `apv/experiment-1` (SHA-256 `89cfe38e54d14a692baed4bdb989c08a0c87037b3dc668e2f2b80d4330adeca0`). No expectation was edited in experiment 2.

## Preserved prior work

| Tag (annotated, on fork) | Points to | What |
|---|---|---|
| `apv-exp1-final` | `6e08d9b` | final state of `apv/experiment-1` (docs, matrix, spec, ledger v1) |
| `fix-identity-on-b425030` | `4e4389b` | identity fix on the old base (PR #3 head; source commit `4d4d14a`) |

No branch was moved or deleted.

## Harness (experiment 2)

- Branch `apv/experiment-2`, based on upstream `development` @ `bee35b8`.
- Layer (a), scenarios: `tests/e2e/apv-matrix.spec.ts`. Reads the CSV, builds the GitHub and wallet-claim mocks per cell (actor × claim × lookup), maps each expectation string to an abstract marker set (`expectedMarkers`, unchanged from experiment 1) and compares it with what the page shows.
- Layer (b), UI adapters: `tests/e2e/apv-adapters.ts`, chosen with `APV_ADAPTER`. An adapter supplies: the wallet link used to locate the section, expansion of an enclosing collapsed `<details>`, the loading text, an on-page pattern per marker (or `null` when that UI cannot render the state), the API reply meaning "no claim", and an applicability rule.
  - `per-chain` (default): fork UI at `b425030` / `4e4389b`. Markers `Current Solana payout wallet ·`, `Current Base payout wallet ·`, `Current <Chain> payout wallet status unavailable`, `Current payout wallet status unavailable`, `No current payout wallet registered`, `Historical payout wallet ·`. No claim = HTTP 404 `{"error":"not_found"}`.
  - `upstream-single`: upstream single-wallet UI. `Current payout wallet ·` maps to `solanaShown` (the UI validates the address as Solana and the backend defaults `chain` to `solana`). `baseShown`, `solanaUnavailable`, `baseUnavailable` are `null`. No claim = HTTP 200 `null` (upstream contract since `1744ef7`; 404 is now an error).
- Applicability precheck: before any cell, each worker opens a sanity profile (current × solana × ok). If the adapter cannot find a visible wallet section, or finds it but sees no known marker, every cell is reported **N/A (adapter stale)** (Playwright `skipped` + `na` annotation) instead of 48 failures.
- Per-cell N/A: a cell is N/A, never green, when the adapter cannot express its expectation. For `upstream-single`: any expectation that needs a per-chain marker, and any cell with a resolvable identity (current / frozen-only) whose outcome depends on Base (`claim=base` or `lookup=base-503`). Identity cells (renamed / mismatch) expect "unavailable" whatever the chains do, so they stay applicable. Observed markers are recorded for N/A cells as well.
- Runner: `apv/runner/run_matrix_v2.sh <REV> <NAME> <PORT> [adapter]` (copy at `/workspace/work/apv/run_matrix_v2.sh`). Builds `<REV>` in a detached worktree, copies in the CSV, spec and adapter from the `apv/experiment-2` working tree, records their SHA-256, runs `vite preview`, then
  `APV_ADAPTER=<adapter> NO_PROXY=127.0.0.1,localhost SLOP_BASE_URL=http://127.0.0.1:<PORT> playwright test tests/e2e/apv-matrix.spec.ts --project=desktop-chromium --workers=2 --reporter=json`
- Parse: `python3 apv/runner/parse_v2.py results_v2/<NAME>.json [full]` → pass / fail / N/A per cell with observed markers.
- Harness inputs, identical in every run below: CSV `89cfe38e…`, spec `e6041c91ebba4bf17e4de6c60ca37a9703b796e8230fc141b77fcdbe541152c5`, adapter `7466d7ce4efc610f0f7bc6c570001432ef3665220d216b6e8f18722f6aff9143` (files in `results_v2/<NAME>.inputs.sha256`). The committed spec and adapter are those exact bytes (not run through biome format, so the hashes stay valid).
- Input snapshot (all runs): `public/data/leaderboard.json`, SHA-256 `f9827309c7a824ffd84bd5efd70cf2503eaf122bd8b96cb828acdab88416841c`, the same snapshot as R1–R7 (branch `fixtures/leaderboard-snapshot`). Upstream runs use this snapshot too, not upstream's current live data.
- Environment: Hark sandbox, Linux aarch64, Playwright 1.62.1, chromium_headless_shell-1234, desktop-chromium project. The spec has no console guard, so proxy noise (407 / `ERR_TUNNEL_CONNECTION_FAILED`) does not affect matrix verdicts.

## Ledger

| # | Run name | Baseline SHA | Revision / mutation / fix SHA | Invariant(s) targeted | Command | Expected | Observed | Δ |
|---|---|---|---|---|---|---|---|---|
| V1 | `v2_base` | — | `b425030` (old fork base) | refactor check, I1–I3 | `run_matrix_v2.sh b425030 v2_base 4511 per-chain` | Same as R1: 28/48, red M25–M38, M40, M42–M46 | **28/48.** Red: M25–M36 `none`; M37 `solanaShown`, M38 `solanaShown+baseUnavailable`, M40 `baseShown`, M42 `baseShown+solanaUnavailable`, M43 `solanaShown+baseShown`, M44 `solanaShown+baseUnavailable`, M45 `baseShown+solanaUnavailable`, M46 `none`. | vs R1: **0 cells differ** in verdict or observed markers (scripted comparison over all 48). Refactor preserves behavior. |
| V2 | `v2_pr3` | `b425030` | `4e4389b` (identity fix, old base) | refactor check, I3 | `run_matrix_v2.sh 4e4389b v2_pr3 4512 per-chain` | Same as R2: 48/48 | **48/48.** | vs R2: **0 cells differ** in verdict or observed markers. |
| V3 | `v2_up_bee35b8` | — | `bee35b8` (upstream `development` head) | I1–I3 on upstream | `run_matrix_v2.sh bee35b8 v2_up_bee35b8 4513 upstream-single` | Applicable cells: identity cells at risk (upstream has no frozen-only lookup) | **5/32 applicable, 16 N/A, 27 red.** Green: M01 `solanaShown`, M03 `unavailable`, M10 `none`, M12 `unavailable`, M22 `none`. Red: M13, M15, M24 (frozen-only) → `none`; M25–M36 (renamed) → `none`; M37–M48 (mismatch) → `none`. | Precheck passed (adapter fits). |
| V4 | `v2_up_376fed1` | — | `376fed1` (upstream, Merge PR #600, collapsed `<details>` UI) | adapter re-check of invalid R3 | `run_matrix_v2.sh 376fed1 v2_up_376fed1 4515 upstream-single` | A behavioral verdict now that the adapter opens `<details>` | **5/32 applicable, 16 N/A, 27 red.** Same cells and markers as V3. | R3 (0/48, precondition timeout) is replaced by a real verdict. |
| V5 | `v2_fixv2` | `bee35b8` | `55274db` (`fix/profile-wallet-identity-v2`: port of `4d4d14a` onto `development`) | I1, I3 (H2, H3) | `run_matrix_v2.sh 55274db v2_fixv2 4514 upstream-single` | All applicable cells green | **32/32 applicable, 16 N/A, 0 red.** M13 `solanaShown`; M15, M24 `unavailable`; M25–M48 all `unavailable`. | vs V3: **+27 green, 0 new red.** |
| V6 | `v2_stale_demo` | — | `bee35b8` | precheck check | `run_matrix_v2.sh bee35b8 v2_stale_demo 4516 per-chain` (wrong adapter on purpose) | 48 × N/A (adapter stale), 0 fail | see "Precheck demo" below | — |

Run notes: the first V1 attempt (`summary.txt` line 1, 2:01 PM EEST) was 48/48 failed at `browserType.launch`. After a sandbox reset `libatk-1.0.so.0`, `libXcomposite`, `libXdamage` and `libatspi` were missing. This is infra, not a behavioral result. Deps were reinstalled with `sudo playwright install-deps chromium` (`pwdeps3.log`) and V1 was rerun once. `rc=1` in `summary.txt` is Playwright's exit code when any cell is red. Raw JSON: `/workspace/work/apv/results_v2/<name>.json` (sandbox only, not committed). Parsed per-cell output: `apv/results_v2/SUMMARY_parsed.txt` on the branch.

### N/A cells on upstream (V3 and V5), with what the page showed

| Cell | Reason | Observed `bee35b8` | Observed fix `55274db` |
|---|---|---|---|
| M02 | needs `baseUnavailable` | solanaShown | solanaShown |
| M04 | needs `baseShown` | **none** | **none** |
| M05 | outcome depends on Base | none | none |
| M06 | needs `baseShown`, `solanaUnavailable` | unavailable | unavailable |
| M07 | needs `baseShown` | solanaShown | solanaShown |
| M08 | needs `baseUnavailable` | solanaShown | solanaShown |
| M09 | needs `baseShown`, `solanaUnavailable` | unavailable | unavailable |
| M11 | outcome depends on Base | none | none |
| M14 | needs `baseUnavailable` | none | solanaShown |
| M16 | needs `baseShown` | **none** | **none** |
| M17 | outcome depends on Base | none | none |
| M18 | needs `baseShown`, `solanaUnavailable` | none | unavailable |
| M19 | needs `baseShown` | none | solanaShown |
| M20 | needs `baseUnavailable` | none | solanaShown |
| M21 | needs `baseShown`, `solanaUnavailable` | none | unavailable |
| M23 | outcome depends on Base | none | none |

Side observation (not scored, outside this fix): with a Base-only claim (M04, M16) upstream says "No current payout wallet registered". The profile requests `/current` without `chain`, and the backend defaults to `solana` (`requestedWalletChain` in `backend/trace/handler.ts`). This is the per-chain question that `fix/profile-wallet-per-chain` addressed on the old base. The identity fix does not touch it.

## H2 / H3 on upstream `bee35b8`

| Finding | Old base `b425030` | Upstream `bee35b8` | Fix `55274db` |
|---|---|---|---|
| H2, wallet of a mismatched `node_id` account shown | live: M37, M38, M40, M42–M45 show the other account's wallet | **Hazard absent, cells red.** No mismatch cell shows any wallet: upstream never resolves a frozen-only actor and never calls GitHub, so it shows `none` for M37–M48. "No current payout wallet registered" is still a claim the page cannot back (I3, second clause). | M37–M48 `unavailable` (green) |
| H3, GitHub 404 shown as "no wallet" | live: M25–M36 `none` | **Live symptom, different mechanism.** M25–M36 show "No current payout wallet registered", but not because of a 404: upstream makes no GitHub request at all. Every frozen-only actor gets `none` without a lookup, which also hides real claims (M13 red, I1) and hides failures (M15, M24 red, I2). Upstream behaves like seed F2 (`seed/no-frozen-lookup`) on a single chain. | M25–M36 `unavailable` (green) |

No upstream commit fixed H2 or H3. Upstream never had the GitHub-resolution path the old fork base added (no `resolveGithubActorId`, no `api.github.com` fetch in `src/ProfilePage.tsx` at `bee35b8`). Relevant upstream commits: `1744ef7` changed the no-claim reply to 200 `null`, which the adapter models. `16b1730` reverted PR #600, which removed the collapsed `<details>` again.

## Fix `fix/profile-wallet-identity-v2` (head `258c991`; source commit `55274db`, parent `bee35b8`)

- `src/ProfilePage.tsx` (+89/−15 before format): `useCurrentWallet` takes `fundingReviews`. An actor missing from the views and cycles is looked up in funding reviews. It waits while reviews load and shows "unavailable" if reviews fail. With no local numeric id, it resolves through `GET https://api.github.com/users/<login>`, which must return a matching `login` and the recorded `node_id`. A 404, a mismatch or an invalid body is a failed lookup ("Current payout wallet status unavailable"). Single-wallet UI, no chain handling added. CSP `connect-src` on `development` already allows `https://api.github.com`.
- `tests/e2e/site.spec.ts`: two I3 regression tests ported from `4d4d14a` (marker changed to `Current payout wallet ·`), and a GitHub route in the existing frozen-month test so the fix makes no live request there.
- `tsc -b`: only error is `workers/slopbot/models.ts`, which cannot find `@anthropic-ai/sdk` (the dependency is not installed in this sandbox; it was already like this, unrelated). `biome check` clean on both changed files.
- Existing e2e tests that touch the wallet: see "Existing e2e on the fix" below.

## Precheck demo (V6)

`run_matrix_v2.sh bee35b8 v2_stale_demo 4516 per-chain`: the per-chain adapter run against upstream on purpose. Result: **48 cells, 0 pass, 0 fail, 48 N/A**, each with the reason "N/A (adapter stale): adapter per-chain: wallet section found but no known marker text on sanity profile lalalune". The wallet link is there, but upstream renders `Current payout wallet · 1111…`, which no per-chain marker matches. Under experiment 1 this situation produced 0/48 "red" (R3). It is now reported as not applicable.

## Existing e2e on the fix

Existing `tests/e2e/site.spec.ts` tests that touch the wallet, plus the two ported I3 tests: `-g "frozen-month contributor|I3:|renders contributor and cycle records"`, desktop-chromium, `vite preview` of the matrix worktree (runner `apv/runner/run_e2e_wallet.sh`, parser `apv/runner/e2e_parse.py`). That file has a console/network guard (`browserDiagnostics`), so every test also fails on the sandbox proxy noise (407 / `ERR_TUNNEL_CONNECTION_FAILED`). The counts below are behavioral assertions only, read from the per-test error list.

| Test | `bee35b8` (with the fix's test file copied in) | fix `55274db` | fix `258c991` (head) |
|---|---|---|---|
| renders contributor and cycle records from validated public data | pass (guard noise only) | pass (guard noise only) | pass (guard noise only) |
| keeps a frozen-month contributor reachable after the rolling window moves on | pass (guard noise only) | pass (guard noise only) | pass (guard noise only) |
| I3: rejects a GitHub account whose node_id differs from the record | **fail**: "Current payout wallet status unavailable" not found | pass (guard noise only) | pass (guard noise only) |
| I3: does not report a confirmed absence when the GitHub login no longer resolves | **fail**: "No current payout wallet registered" count 1, expected 0 | pass, but the guard would also flag the mocked GitHub 404 (`Failed to load resource … 404`), which would make it fail in upstream CI too | pass. The only remaining failure lines are proxy noise (the 404 is filtered by origin) |

`258c991` exists because of the 55274db finding. The 404 test now runs under the unguarded `base` runner and asserts by itself that no console error occurs except one from `https://api.github.com/`. `src/` is identical between `55274db` and `258c991`, so V5 applies to the branch head.

## Overlap with other upstream work (read-only, 2026-10-10)

- Open upstream PRs: only **#633** `drew/payouts-not-earnings` (head `86097d6`). It changes copy only: the nav label `["earnings", "Your earnings"]` → `"Your payouts"`, plus headings and messages in `src/Earnings.tsx`, `Points.tsx`, `EscrowFunding.tsx`, docs and a script. The route key stays `earnings`, so `/earnings` keeps working. It does not touch `ProfilePage.tsx`, the wallet-claim API or anything this matrix reads. No route impact. Not acted on.
- Upstream branches ahead of `development` that touch `src/ProfilePage.tsx` / `Presentation.tsx` / `backend/trace/handler.ts`: only `codex/ux-06-07-08-account-wallet-verification` (4 commits, last 2026-10-08). Its only `ProfilePage.tsx` change is the wallet link `/wallet` → `/account#wallets`, which `development` already has. It also edits `WalletRegistration.tsx`, `App.tsx`, `Points.tsx`, `SettlementVerification.tsx` and e2e specs. No overlap with `useCurrentWallet` identity resolution.
- No open upstream PR or branch adds frozen-only resolution, a `node_id` check, or 404-as-unavailable.

## Limits

- One environment (Hark sandbox), one snapshot. Results are evidenced here, not independently verified.
- 16 of 48 cells cannot be scored on upstream's single-wallet UI (N/A). Upstream coverage is 32 cells, not 48.
- Mocks stand in for GitHub and the wallet-claim API. The upstream adapter's "no claim = 200 null" follows `1744ef7`. The live backend was not called.
- The precheck validates the adapter against the sanity scenario only. An adapter that recognises some markers but maps one wrongly would pass the precheck. V1/V2 bound this for `per-chain` (0 diffs vs R1/R2), and V4 = V3 bounds it for `upstream-single` across two upstream markups.
- The spec and adapter are committed unformatted, so the input hashes stay true to the runs. `biome check` flags formatting only in those two files.
