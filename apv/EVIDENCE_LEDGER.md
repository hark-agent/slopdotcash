# APV experiment 1 — Evidence ledger (matrix v2, 48 cells)

Status: local sandbox results, 2026-10-10. Nothing in this file has been pushed or posted.
Target: `hark-agent/slopdotcash` fork, payout-wallet profile logic (`src/ProfilePage.tsx`, `useCurrentWallet` / `resolveGithubActorId`).
Pre-registered invariants: `apv/INVARIANTS.md` on `apv/experiment-1` (I1 visibility, I2 failure disclosure, I3 identity).

## Harness

- Spec: `tests/e2e/apv-matrix.spec.ts` and table `apv/matrix_v2.csv`, both taken from local `apv/experiment-1` @ `24550e0` (`test(apv): data-driven matrix spec and matrix v2`). That commit is local only; `fork/apv/experiment-1` is at `0644b8a`.
- Matrix: actor {current, frozen-only, renamed, mismatch} × registry claim {solana, base, both, none} × lookup {ok, base-503, solana-timeout} = 48 cells (M01–M48). `mismatch` (M37–M48) means GitHub resolves the login to an account whose `node_id` differs from the recorded one. Every expected outcome comes from the pre-registered CSV, not from these runs.
- Verdict per cell: the set of wallet-state markers seen on the profile must equal the expected set. The spec has no console guard, so the sandbox proxy noise (407 / `ERR_TUNNEL_CONNECTION_FAILED`) does not affect these verdicts. Every count below is a behavioral count.
- Runner (one revision per run, run one at a time): `apv-runner/run_matrix.sh <REV> <NAME> <PORT>`. It builds `<REV>` in a detached worktree, copies in the spec and CSV from `apv/experiment-1`, runs `vite preview` on `<PORT>`, then:
  `NO_PROXY=127.0.0.1,localhost SLOP_BASE_URL=http://127.0.0.1:<PORT> playwright test tests/e2e/apv-matrix.spec.ts --project=desktop-chromium --workers=2 --reporter=json`
- Parse: `python3 apv-runner/parse.py apv-runner/results_matrix/<NAME>.json`
- Environment: Hark sandbox, Linux arm64, Playwright 1.62.1, Chrome for Testing 151.0.7922.34 (headless), desktop-chromium project.

- Input snapshot (all runs R1-R7): `public/data/leaderboard.json`, 17417947 bytes, SHA-256 `f9827309c7a824ffd84bd5efd70cf2503eaf122bd8b96cb828acdab88416841c`. The bytes are published on branch `fixtures/leaderboard-snapshot` (commit a7ec5d3) with `SHA256SUMS`. This is a different snapshot from the one nerd27dk used for the PR #3 reruns (SHA-256 `9ee2ea15...`).

## Ledger

"Δ vs baseline" compares each run with `b425030` (28/48). Red cells are listed as `cell: observed markers`.

| # | Run name | Baseline SHA | Revision / mutation SHA | Invariant(s) targeted | Command | Expected | Observed | Δ vs baseline |
|---|---|---|---|---|---|---|---|---|
| R1 | `base` | — | `b425030` (fix/profile-wallet-per-chain, audited head) | I1, I2, I3 | `run_matrix.sh b425030 base <port>` | Pre-registered: M25–M36 (renamed) and M37–M48 (mismatch) at risk (H3/H2 reading) | **28/48.** Red: M25–M36 → `none` (12, H3); M37 `solanaShown`, M38 `solanaShown+baseUnavailable`, M40 `baseShown`, M42 `baseShown+solanaUnavailable`, M43 `solanaShown+baseShown`, M44 `solanaShown+baseUnavailable`, M45 `baseShown+solanaUnavailable`, M46 `none` (8, H2). M39, M41, M47, M48 green, because a failed lookup on the claim's chain happens to produce the expected "unavailable". | — (reference) |
| R2 | `pr3` | `b425030` | `4e4389b` (fix/profile-wallet-identity = PR #3; source fix in `4d4d14a`) | I3 (H2, H3 fix) | `run_matrix.sh 4e4389b pr3 <port>` | 48/48 | **48/48.** No red cells. | +20 green (all of M25–M38, M40, M42–M46). 0 new red. |
| R3 | `upstream376` | `b425030` (reference only; not an ancestor) | `376fed1` (upstream `development`, Merge PR #600; merge-base with fork head = `d1fd061`) | I1–I3 (applicability) | `run_matrix.sh 376fed1 upstream376 4481` | Per-chain markers are absent upstream, so most cells should be red | **0/48: not a behavioral verdict.** All 48 cells failed on the precondition `getByRole('link', {name: 'Register or update your wallet'}).toBeVisible()` (20 s timeout) before any wallet marker was read. Upstream renders that link inside a collapsed `<details className="profile-wallet-details">`, so it exists in the DOM but is not visible. | Harness not applicable as written. See Limits. |
| R4 | `seed_promise_all` | `b425030` | `04a9fcc` (seed/promise-all, F1: `Promise.all` instead of `allSettled`) | I2 | `run_matrix.sh 04a9fcc seed_promise_all 4483` | red (I2 partial-failure cells) | **24/48.** New red (8): M02, M06, M08, M09, M14, M18, M20, M21 → all `unavailable`. A valid claim on the healthy chain is hidden when the other chain fails. Baseline red still red: M25–M37, M40, M43, M46. Baseline red that turned **green** (4): M38, M42, M44, M45. | **Caught.** +8 red, −4 red (masking, see Surprises). |
| R5 | `seed_no_frozen_lookup` | `b425030` | `55477dd` (seed/no-frozen-lookup, F2: frozen-only actors never resolved) | I1, I3 | `run_matrix.sh 55477dd seed_no_frozen_lookup 4484` | red (frozen-only cells) | **13/48.** New red (15): M13–M21, M23, M24 (frozen-only), and M39, M41, M47, M48 (mismatch). All → `none`. Baseline red mismatch cells M37, M38, M40, M42–M45 now observe `none` instead of a shown wallet. Green: M01–M12, M22 (expected `none` anyway). | **Caught.** +15 red, 0 new green. |
| R6 | `seed_no_node_id_check` | `b425030` | `b376b3a` (seed/no-node-id-check, F3: `node_id` match removed) | I3 | `run_matrix.sh b376b3a seed_no_node_id_check 4485` | red expected; green means a coverage gap | **28/48.** Identical to R1, with the same 20 red cells and the same observed markers in every cell. | **Not distinguishable from baseline** (0 new red, 0 new green). See type A scoring. |
| R7 | `seed_no_node_id_on_fix` | `4e4389b` | `28f609a` (local detached commit `28f609af02f75f7ff60482d5897410a20a2eddbb`, "seed: no-node-id-check on 4e4389b": diff `b425030..b376b3a` applied cleanly on `4e4389b`, no branch) | I3 | `PLAYWRIGHT_BROWSERS_PATH=apv-runner/.pw-browsers run_matrix.sh 28f609af02f75f7ff60482d5897410a20a2eddbb seed_no_node_id_on_fix 4187` | red in mismatch cells (M37–M48); 4e4389b is 48/48 | **40/48.** Red (8): M37 `solanaShown`, M38 `solanaShown+baseUnavailable`, M40 `baseShown`, M42 `baseShown+solanaUnavailable`, M43 `solanaShown+baseShown`, M44 `solanaShown+baseUnavailable`, M45 `baseShown+solanaUnavailable`, M46 `none` (all expected `unavailable`). Exactly the R1 H2 cells with identical markers. M39, M41, M47, M48 stay green (claim-chain lookup fails, so `unavailable` by coincidence). M01–M36 unchanged. | vs R2 (`4e4389b`): **Caught.** 8 new red, 0 other changes. |

Raw results: `apv-runner/results_matrix/{base,pr3,upstream376,seed_promise_all,seed_no_frozen_lookup,seed_no_node_id_check,seed_no_node_id_on_fix}.json`. R7 note: the first R7 attempt was 0/48, all at `browserType.launch` (`libatk-1.0.so.0` missing after a sandbox reset). It is not a behavioral result. Deps were reinstalled with `sudo playwright install-deps chromium` (log `pwdeps2.log`) and R7 was rerun once. `summary.txt` therefore has two `seed_no_node_id_on_fix` lines; the second is the valid run. Run log: `apv-runner/results_matrix/summary.txt` (all rc=0). Build logs: `<name>.build.log` in the same folder. `upstream.json` (0 bytes) is the earlier timed-out attempt at the upstream run and is superseded by R3.

## Score A — seeded harness checks (verifier of verifiers)

Question: does the 48-cell harness turn red when a known defect is planted in the audited code?

| Seed | Fault | Target invariant | Caught? | By which cells / invariant |
|---|---|---|---|---|
| F1 `seed/promise-all` `04a9fcc` | one failed chain rejects the whole lookup | I2 | **Yes** | 8 cells newly red, all "claim on chain A + lookup failure on chain B": M02, M06, M08, M09 (current) and M14, M18, M20, M21 (frozen-only). Clause violated: I2, "the claim stays visible and the failed chain is named". |
| F2 `seed/no-frozen-lookup` `55477dd` | frozen-only actors never resolved | I1, I3 | **Yes** | 15 cells newly red: M13–M21 (I1, claim not shown), M23, M24 and M39, M41, M47, M48 (I2/I3: unresolved identity or failed lookup shown as "No current payout wallet registered"). |
| F3 `seed/no-node-id-check` `b376b3a` | `node_id` comparison removed | I3 | **No: equivalent mutant at this baseline** | 0 cells changed. The mismatch cells (M37–M48) are already red on `b425030` with the same observations, so the seed adds nothing new to detect. This matches H2: at `b425030` the `node_id` check is dead code for frozen-only actors (`actor` is undefined, so `nodeId` is undefined), and removing it changes no behavior. The harness **does** cover I3 mismatch (it is red on R1 and R6). What it cannot do is tell F3 apart from the baseline, because the baseline already has the bug. |
| F3′ `28f609a` (F3 diff on `4e4389b`) | `node_id` comparison removed where the check is live | I3 | **Yes** | 8 cells newly red vs `4e4389b`: M37, M38, M40, M42–M46 show the mismatched account's wallet (or `none` for M46) instead of `unavailable`. I3 is violated: a wallet is attributed to a different GitHub identity. M39, M41, M47, M48 do not distinguish (a failed lookup gives `unavailable` either way), so I3 detection depends on the lookup-ok / other-chain-failure rows. |

Score A: **3 of 3 seeded faults caught at a baseline where the fault is live.** F1 and F2 were caught on `b425030`. F3 is an equivalent mutant on `b425030` (R6, 0 Δ), but rebased onto `4e4389b` (R7, F3′) it is caught by 8 mismatch cells (48→40). The first-run H1 "coverage gap" is closed: the matrix covers I3 and detects removal of the `node_id` check once the check has an effect. One residual weakness: 4 of 12 mismatch cells (M39, M41, M47, M48) cannot detect F3, by construction.

## Score B — blind discovery findings

Question: did the pre-registered matrix find real defects in the audited head, and does the fix remove them without regressions?

| Finding | Description | Found on `b425030` (R1) | Status on `4e4389b` (R2) |
|---|---|---|---|
| H2 | A frozen-only actor whose login resolves to a GitHub account with a different `node_id` gets that account's payout wallet shown (I3). Root cause: `actor` is undefined for frozen-only actors, so `resolveGithubActorId` skips the `node_id` comparison. | Red: M37, M38, M40, M42, M43, M44, M45 show the mismatched account's wallet. M46 shows "No current payout wallet registered". M39, M41, M47, M48 green by coincidence (the claim's chain lookup failed). | Fixed: M37–M48 all green |
| H3 | A renamed frozen-only login (GitHub 404) is shown as "No current payout wallet registered" instead of "status unavailable" (I3, second clause). | Red: M25–M36, all 12 → `none` | Fixed: M25–M36 all green |
| Regressions | — | — | None: no cell that was green on `b425030` is red on `4e4389b` |

Score B: **2 findings (H2, H3) confirmed by 20 red cells on the audited head, all 20 green after the fix, 0 regressions.** H3 was predicted in writing in `INVARIANTS.md` before the run, from reading the code. H2 was first seen in run 2 (targeted tests) and then made explicit as the matrix v2 `mismatch` rows. Neither was a fully blind discovery by the matrix itself.

## Surprises

1. **F1 masks part of H2.** On `seed/promise-all`, M38, M42, M44 and M45 (mismatch with a failed lookup) turn green. The seed collapses any partial failure into "unavailable", and that happens to equal the expected output for those cells. A pass count alone (24 vs 28) understates the damage. The diff per cell is the real signal.
2. **F2 changes the observation in baseline-red cells.** M37–M45 go from "mismatched wallet shown" to `none`. They are still red, but for a different reason. Pass/fail alone would hide this; the observed markers show it.
3. **The upstream baseline is not measurable with this spec.** It is coupled to the fork's UI, where the wallet section is not collapsed inside `<details>`. The same applies to the per-chain marker texts ("Current Solana payout wallet ·"), which upstream does not render (it renders a single "Current payout wallet ·").
4. **Sandbox instability.** The first `seed_promise_all` attempt died silently (empty JSON, no summary line) when the sandbox's home and `/tmp` were reset, which also wiped the Playwright browser cache. Browsers were reinstalled under `apv-runner/.pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH`) and the run was repeated once successfully. This counts as 1 infra failure, not 2.

## Limits

- One environment (Hark sandbox, headless Chromium, arm64), one run per revision. There are no repeats, so flakiness has not been measured, although none of R4–R6 shows a red cell that is not explained by its seed.
- The GitHub API and registry responses are mocked by the spec (lookup conditions, 404, `node_id` mismatch). The results show the UI's behavior under those mocks, not against live services. The live-registry oracle (Oracle 2) was not rerun.
- I4 (direct routes / 404) is not covered by this matrix.
- The upstream run (R3) is a harness-applicability failure, not evidence about upstream behavior. To measure it, the spec would need to open `details.profile-wallet-details` before checking visibility, plus a marker mapping for upstream's single-chain text. Not done; spec left unchanged.
- The F3 verdict depends on the baseline. Rerun as `4e4389b` + F3 in R7 (local detached commit `28f609a`; no branches created or moved).
- Evidence level: evidenced in one environment, not independently verified.
