# Live verification pack: profile payout-wallet fix

Branch `apv/live-check` of the fork `hark-agent/slopdotcash`. This pack is a
task for one agent (for example a coding agent) that runs it on a macOS
machine. It uses real public data only. It has no mocks.

## 0. Rules for the agent that runs this pack

- Run the pack as it is. Do not edit the scripts, the expectations or the
  revisions. If a step needs a change to run on your machine, make the
  smallest change, and write it in the report.
- Read-only on GitHub: do not push, open a pull request or an issue, or
  write a comment anywhere. Do not publish any result.
- The results name real contributors and their wallet addresses. Keep them
  on the machine and in the report only.
- Do not put `GITHUB_TOKEN` or any other secret in the report. The pack
  writes only whether a token was set.
- Do not retry a failing step more than twice. Stop and report the failure
  with its log.
- When the run is done (or stops), report as section 8 says.

## 1. Goal

Find out, with live public data, if the fix `fix/profile-wallet-identity-v2`
makes the profile page tell the truth about the current payout wallet of
"frozen-only" contributors, and if it changes nothing for other contributors.

A frozen-only contributor is in a frozen monthly funding review
(`/data/funding-reviews.json`), but not in the rolling snapshot
(`/data/leaderboard.json`) and not in a reward cycle (`/data/cycles/index.json`).

The invariant under test:

> If the current payout wallet is not known, the page must say
> "Current payout wallet status unavailable". The page must never say
> "No current payout wallet registered" unless a lookup confirmed it.

## 2. Revisions

| SHA | What | Used here |
|---|---|---|
| `bee35b8` | upstream `development` head (Merge PR #631). The fix is based on it. | built and checked (phase 3), full CI (phase 4) |
| `258c991` | head of `fix/profile-wallet-identity-v2` (code commit `55274db`, test commit on top) | built and checked (phase 3), full CI (phase 4) |
| `b425030` | old fork base (Merge PR #2), before the move to upstream `development` | context only, not built by this pack |
| `4e4389b` | identity fix on the old base (`fix-identity-on-b425030`, PR #3 head) | context only, not built by this pack |
| `550fbb5` | `apv/experiment-2`; this branch starts here | holds the pack; not a test target |

Both test revisions are on the fork branches `apv/experiment-2` and
`fix/profile-wallet-identity-v2`. Upstream is `SlopDotCash/slopdotcash`.

## 3. What is proven, and what is not

Proven before this pack (sandbox, see `apv/EVIDENCE_LEDGER_v2.md`):

- Matrix v2 on upstream `bee35b8`: 5 of 32 applicable cells pass. Every
  frozen-only actor gets "No current payout wallet registered" without any
  lookup. On `55274db`: 32 of 32 pass.
- Two regression tests in `tests/e2e/site.spec.ts` fail on `bee35b8` and pass
  on the fix.

Limits of that evidence, which this pack is made to remove or measure:

- GitHub and the wallet-claim API were mocked.
- One data snapshot (`public/data/leaderboard.json`, SHA-256 `f9827309…`).
- One environment (Hark sandbox, Linux aarch64).
- The number of real affected users was not known.

What the sandbox dry run of this pack showed (live data, 2026-10-10, see
`reference/sandbox-2026-10-10/NOTES.md`): 69 frozen-only actors; 9 of them
have a current wallet claim on the live API and 1 has a login that GitHub
does not resolve. On https://slop.cash and on `bee35b8` all selected rows of
this kind show "No current payout wallet registered". On `258c991` all 21
selected rows match the oracle. This is one run in one environment. A run on a
Mac is a second run in a different environment. It is not an independent
review of the fix.

Not proven by this pack, and risks of the fix:

- Display only. The fix changes `src/ProfilePage.tsx` only (plus tests). It
  does not touch payout, settlement or wallet-claim code.
- The fix calls `https://api.github.com/users/<login>` from the browser,
  without authentication. GitHub allows about 60 such calls per hour per IP
  address. A visitor who opens many frozen-only or cycle-only profiles, or
  many visitors behind one NAT, will get "unavailable" after that. This is
  honest (no false "no wallet"), but it is a degraded state.
- Better long-term fix: store the numeric GitHub id with each actor on the
  server side (in the review and cycle records), so the browser needs no
  GitHub call.
- The fix also does the GitHub lookup for cycle-only actors (in a cycle,
  not in the snapshot), because their record has no numeric id. In the dry
  run their result did not change (no current claim). A cycle-only actor with
  a current claim would change from "none" or "historical" to "shown".
- The oracle cannot model the rolling window exactly. Review actors that are
  anywhere in the snapshot are listed as `frozen_ambiguous` and not scored. So
  the count of affected users from the oracle is a lower bound.
- Data and claims change during a run. The UI script records the live data
  hashes before and after. If they differ from the oracle hashes, the live
  target may disagree for that reason.

## 4. How the pack works

| Phase | File | What it does |
|---|---|---|
| 1 | `run_all.sh` | preflight: tool versions, revisions present, root install, Playwright Chromium |
| 2 | `oracle.py` | independent oracle (Python standard library, no app code) |
| 3 | `build_target.sh`, `ui_check.mjs`, `compare.py` | builds `bee35b8` and `258c991`, opens profiles on 3 targets, compares with the oracle |
| 4 | `ci_full.sh` | upstream CI quality job, step by step, on `258c991` and on `bee35b8` |
| 5 | `run_all.sh` | `SHA256SUMS` and a `.tar.gz` of the results folder |

### 4.1 Endpoints (found in the code at `bee35b8` / `258c991`)

| Endpoint | Read by | Code |
|---|---|---|
| `https://slop.cash/data/leaderboard.json` | rolling snapshot; views (leaders, opportunities) are built from its `ledger` | `src/lib/use-snapshot.ts`, `src/lib/project-view.ts` |
| `https://slop.cash/data/cycles/index.json` | reward cycles and contributors (with recorded wallets) | `src/lib/use-snapshot.ts`, `src/lib/use-cycle-index.ts` |
| `https://slop.cash/data/funding-reviews.json` | frozen monthly reviews; actor `id` is the GitHub `node_id` | `src/lib/use-funding-reviews.ts` |
| `https://api.slop.cash/api/v1/wallet-claims/actors/<numeric id>/current` | current wallet claim; `200 null` = no claim | `src/ProfilePage.tsx`; server `backend/trace/handler.ts` |
| `https://api.github.com/users/<login>` | login to numeric id and `node_id` (fix only) | `src/ProfilePage.tsx` at `258c991` |

API base: `src/lib/deployment.ts`. The tier comes from the build variable
`VITE_SLOP_ENVIRONMENT`. Unset or `production` gives `https://api.slop.cash`.
`staging` gives `https://staging.slop.cash`. The UI check builds with the
variable unset, so the local builds use the live production API. The data
files are same-origin reads (`/data/...`), so `build_target.sh` copies the
exact bytes the oracle read into `dist/data/` of each build.

### 4.2 The oracle (phase 2)

`oracle.py` does not import or run app code. It reads the three data files,
then for each actor:

1. Class: `frozen_only` (in a review whose month has no cycle, not in a
   cycle, not anywhere in the snapshot), `cycle_only` (in a cycle, not in the
   snapshot), `control` (a snapshot leader with a numeric avatar id and an
   event in the current month, not in a review), or `frozen_ambiguous`
   (counted, not scored).
2. Identity: controls use the numeric id from the avatar URL. Other classes
   call `GET https://api.github.com/users/<login>` and compare `login`
   (case-insensitive) and `node_id` with the recorded actor id.
   - match: numeric id is known
   - 404: `login_not_found`; node_id differs: `node_id_mismatch`; bad body:
     `github_invalid_body`. The identity is not proven.
   - 403/429/5xx/network error or budget used up: `indeterminate` (row is N/A)
3. Claim: with a numeric id, `GET .../wallet-claims/actors/<id>/current`
   with no Origin header. `null` = `none`. A valid claim (claim id format,
   `githubActorId` equals the id, Solana address of 32 bytes) = `shown`.
   Anything else = `error`.
4. Expected marker: `shown` if a valid claim; else `historical` if a cycle
   record has a wallet; else `unavailable` if the identity is not proven or
   the claim read failed; else `none`.

It also writes `predicted_no_lookup_ui`: what a page without frozen-only
resolution (upstream) is predicted to show. It is a cross-check, not the
verdict.

Outputs in `results/<ts>/oracle/`: `oracle.json` (metadata, every request
with URL, time, status, body SHA-256 and rate-limit headers; every row),
`oracle.csv`, `selection.json` (logins for phase 3), `raw/` (all response
bodies, named by SHA-256), and copies of the three data files.

GitHub rate limit: without a token, GitHub allows 60 calls per hour per IP.
Without `GITHUB_TOKEN` the oracle uses at most 30 `/users` calls
(`--github-budget`), so about 30 stay for the browser in phase 3, which
uses up to 17 (frozen-only plus cycle-only rows, `258c991` only). With
`GITHUB_TOKEN` (any classic or fine-grained token with no scopes) the oracle
can check all actors (budget 400, limit 5000/h). The browser never uses the
token. Rows that the oracle could not check are `indeterminate` and are not
selected.

### 4.3 Live UI check (phase 3)

`ui_check.mjs` uses Playwright from the repository (`playwright` package),
with Chromium. For each selected login it opens
`<target>/contributors/<login>` on three targets:

- `live`: https://slop.cash (no routes of any kind)
- `base_bee35b8`: local `vite preview` of `bee35b8` on `127.0.0.1:4601`
- `fix_258c991`: local `vite preview` of `258c991` on `127.0.0.1:4602`

It waits up to 30 s for one of these markers: `Current payout wallet ·
<address>` (shown), `Historical payout wallet · <address>` (historical),
`Current payout wallet status unavailable`, `No current payout wallet
registered` (none). It records the marker, a screenshot, all calls to
`api.github.com` and `api.slop.cash`, and console errors. It also records
the live bundle file and if it contains a GitHub `/users` lookup.

**CORS shim (local targets only).** `api.slop.cash` answers
`403 {"error":"origin_not_allowed"}` to an Origin that is not a slop.cash
origin (`backend/trace/handler.ts`), and sends no CORS header. A local
preview runs on `http://127.0.0.1`, so every local wallet read would fail and
the page would show "unavailable" for a transport reason. The shim forwards
the same GET to the live API from Node, without the Origin header, returns
the live status and body unchanged, and adds Access-Control-Allow-Origin.
Each forwarded call is logged with status and body SHA-256 (`shim` in
`ui_observations.json`). It does not replace data. GitHub calls are not
touched. To see the effect, run with `APV_NO_SHIM=1`: every local wallet
read then shows "unavailable".

`compare.py` joins the oracle and the UI rows: `match`, `mismatch` or `N/A`
per login per target, in `results.md` and `results.csv`.

### 4.4 Full CI (phase 4)

`ci_full.sh` runs the job "Skill, data, build, and browser checks" of
`.github/workflows/deploy.yml` on its pull-request path, step by step, in a
fresh worktree. All steps run even if one fails. `steps.tsv` holds the exit
code and time of each step. `ci_summary.md` puts both revisions side by side.

| Step | Command |
|---|---|
| install | `bun install --frozen-lockfile --ignore-scripts` |
| audit | `bun run audit:dependencies` |
| contracts | `bun run verify:contracts` (needs PyYAML) |
| pr_ledger | live `leaderboard.json` through `scripts/prepare-pr-ledger.ts` |
| cycles | `bun run cycles:check` |
| typecheck | `bun run typecheck` (`tsc -b`) |
| lint | `bun run lint:check` (biome) |
| build | `bun run build` with `VITE_SLOP_ENVIRONMENT=staging`, `SLOP_PROFILES_INPUT=data/profiles/seed.json`, `SLOP_POINTS_ONLINE=0`, `SLOP_POINTS_BOOTSTRAP=1` |
| pw_install | `./node_modules/.bin/playwright install chromium` |
| installer | `bun run test:installer:e2e` |
| e2e | `SLOP_E2E_PREBUILT=1 bun run test:e2e` (vite preview and wrangler Pages phases, desktop and mobile) |
| unit (extra) | `bun test workers/slopbot` (not in `deploy.yml`) |

Known noise and expected differences:

- In the sandbox, `tsc -b` failed only on `workers/slopbot/models.ts`
  (cannot find `@anthropic-ai/sdk`) because that package was not installed
  there. It is in `dependencies` (0.126.0), so after a clean `bun install`
  this error should not occur. If it occurs on both revisions, it is noise.
- Steps that read the network (`audit`, `pr_ledger`, `contracts` if it
  fetches) can fail for network reasons on both revisions.
- `installer` and `e2e` run in CI on Ubuntu 24.04. A macOS-only failure that
  occurs on both revisions is environment noise.
- Expected real difference: in `tests/e2e/site.spec.ts`, the two tests
  named `I3: ...` exist only on `258c991`. The other tests are the same.
  A test that fails on `258c991` and passes on `bee35b8` is a regression.
  Report it.
- CI on GitHub uses the staging tier for pull requests into `development`.
  Phase 3 uses the production tier on purpose (see 4.1).

## 5. Prerequisites (macOS)

| Tool | Version | Install |
|---|---|---|
| git | any recent | Xcode Command Line Tools: `xcode-select --install` |
| Node.js | 24.15.0 (CI; `package.json` needs >= 24) | `brew install node@24` or nvm: `nvm install 24.15.0` |
| bun | 1.3.14 (`packageManager` in `package.json`) | `curl -fsSL https://bun.sh/install \| bash -s "bun-v1.3.14"` |
| Python 3 | 3.9 or later (CI uses 3.13) | Command Line Tools or `brew install python@3.13` |
| PyYAML | 6.0.3 (phase 4, `verify:contracts` only) | `python3 -m pip install --user PyYAML==6.0.3` |
| Playwright Chromium | version from the lockfile | `run_all.sh` runs `playwright install chromium` |
| curl, shasum, tar | macOS built-in | — |

The repository uses bun (`bun.lock`). Do not use npm or pnpm.
Free disk space: about 6 GB (three dependency installs, builds, browsers).
Free ports: 4601, 4602 (set `APV_PORT_BASE` to change), and the ports that
the upstream e2e uses (4466, 4467).

## 6. Steps

```bash
git clone https://github.com/hark-agent/slopdotcash.git
cd slopdotcash
git checkout apv/live-check
git fetch origin apv/experiment-2 fix/profile-wallet-identity-v2   # has bee35b8 and 258c991
git log -1 --format=%H 258c991 && git log -1 --format=%H bee35b8

node -v      # v24.x
bun -v       # 1.3.14
python3 -V

# Optional, recommended: a GitHub token for the oracle only (no scopes needed).
export GITHUB_TOKEN=...      # leave unset to run unauthenticated

# Full run (phases 1-5): about 1.5 to 2.5 hours.
bash apv/live-check/run_all.sh

# Short run without the full CI (phases 1-3 and 5): about 20 minutes.
SKIP_CI=1 bash apv/live-check/run_all.sh
```

Run each phase alone if needed (from the repository root):

```bash
python3 apv/live-check/oracle.py --out /tmp/apv/oracle
bash apv/live-check/build_target.sh bee35b8 base 4601 /tmp/apv/oracle /tmp/apv/ui
bash apv/live-check/build_target.sh 258c991 fix 4602 /tmp/apv/oracle /tmp/apv/ui
node apv/live-check/ui_check.mjs /tmp/apv/oracle/selection.json /tmp/apv/ui \
  live=https://slop.cash base_bee35b8=http://127.0.0.1:4601 fix_258c991=http://127.0.0.1:4602
python3 apv/live-check/compare.py /tmp/apv/oracle /tmp/apv/ui /tmp/apv
kill $(cat /tmp/apv/ui/preview_base.pid) $(cat /tmp/apv/ui/preview_fix.pid)
bash apv/live-check/ci_full.sh 258c991 /tmp/apv/ci/258c991
```

Worktrees go to `${TMPDIR:-/tmp}/apv-live-check` (`APV_WORK` to change). The
pack does not change any branch. To clean up afterwards:
`git worktree prune` after deleting that folder.

## 7. Expected output

Console of phase 2 with `GITHUB_TOKEN` set (numbers depend on the day):

```
{ "counts": { "frozen_only": 69, "cycle_only": 17, ... },
  "expected_summary": { "frozen_only": { "none": 59, "shown": 9, "unavailable": 1 }, ... },
  "github_user_calls": 30, "selected": 21 }
```

Without a token, only 30 actors get a GitHub check, so many rows are
`indeterminate` and fewer `shown` rows reach the UI selection. In the sandbox
test with budget 30 the selection had 3 frozen-only `shown` rows instead of 7.
That is expected; a token gives the stronger test.

Phase 3, one line per login per target, then a summary such as:

```
live          match 13  mismatch 8  N/A 0
base_bee35b8  match 13  mismatch 8  N/A 0
fix_258c991   match 21  mismatch 0  N/A 0
```

Expected pattern if the fix is correct:

- `fix_258c991`: every row is `match`.
- `live` and `base_bee35b8`: the same rows are `mismatch`, all of class
  `frozen_only` with expected `shown` or `unavailable`, observed `none`, and
  `= no-lookup prediction` is `yes`.
- `control` and `cycle_only` rows: `match` on all three targets.

Any other pattern is a finding. Report it as it is; do not edit expectations.

Phase 4: `ci_summary.md`, one row per step, exit code per revision.

## 8. Results and report

Everything goes to `apv/live-check/results/<UTC timestamp>/` (git ignores
it):

```
env.txt                 machine, tool versions, revisions
run_all.txt             console log (not in SHA256SUMS; it is still written while sums are made)
oracle/                 oracle.json, oracle.csv, selection.json, raw/, data copies
ui/                     ui_observations.json/.csv, screenshots/<target>/<login>.png,
                        build_*.txt, preview_*.txt
results.md, results.csv verdict per login per target
ci/<rev>/               steps.tsv, one log per step, test-results.tgz
ci_summary.md
SHA256SUMS              SHA-256 of every file above
```

and an archive `apv/live-check/results/results-<timestamp>.tar.gz`. The last
line of the console is its SHA-256.

To report:

1. Give the `.tar.gz` and its SHA-256 line to whoever gave you this task,
   through a private channel. Do not post it in an issue, a pull request or
   a public chat.
2. In the message, give: the timestamp, `results.md` summary table,
   `ci_summary.md`, and any step that you ran by hand or changed.
3. To check the archive: `shasum -a 256 -c SHA256SUMS` in the unpacked
   folder.

Do not retry a failing step more than twice. Report the failure with its log.

## 9. Time estimate

| Phase | Time |
|---|---|
| Prerequisites (first time) | 10-20 min |
| Phase 2, oracle | 1-3 min (longer with a token: all actors are checked) |
| Phase 3, two installs and builds | 5-10 min |
| Phase 3, UI check (21 logins × 3 targets, about 8 s each) | 8-10 min |
| Phase 4, full CI, per revision | 30-60 min (the e2e step is most of it) |
| Total | about 1.5-2.5 h; about 20-30 min with `SKIP_CI=1` |

## 10. Reference dry run

`reference/sandbox-2026-10-10/NOTES.md` holds the sandbox run of phases 2 and
3: its deviations from `run_all.sh` and aggregate counts only. Per-actor rows
(logins, wallet addresses, raw bodies, screenshots) are not published, because
they identify affected people. It is not a substitute for a run on a Mac.

## 11. Environment switches

| Variable | Default | Effect |
|---|---|---|
| `GITHUB_TOKEN` | unset | oracle GitHub reads with a token (budget 400) |
| `SKIP_CI` | 0 | `1` skips phase 4 |
| `APV_BUILD_TOOL` | `bun` | `vite`: plain vite build with root `node_modules` (no bun) |
| `APV_PORT_BASE` | 4601 | first of two local ports |
| `APV_WORK` | `${TMPDIR:-/tmp}/apv-live-check` | worktree root |
| `APV_NO_SHIM` | 0 | `1` turns off the CORS shim for local targets |
| `APV_SETTLE_MS` | 30000 | max wait for a wallet marker per page |
| `APV_UI_FROZEN`, `APV_UI_CYCLE_ONLY`, `APV_UI_CONTROLS` | 14, 3, 4 | size of the UI selection |
| `APV_BROWSER_PROXY_FROM_ENV` | 0 | `1`: Chromium uses `HTTPS_PROXY` (sandbox only) |
| `APV_IGNORE_TLS_ERRORS` | 0 | `1`: Chromium ignores TLS errors (sandbox only; never on a normal machine) |
