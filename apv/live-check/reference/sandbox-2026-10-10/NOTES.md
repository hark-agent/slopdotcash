# Reference dry run (Hark sandbox, 2026-10-10)

This folder is the output of one dry run of phases 2 and 3 in the Hark sandbox.
It is a reference for the operator, not the verification itself. The live data
changes every few hours, so a later run will see other hashes and possibly
other rows.

## How this run differs from `run_all.sh` on a Mac

| Item | This run | `run_all.sh` default |
|---|---|---|
| Host | Linux aarch64 sandbox | macOS |
| Node / bun | Node 22.23.3, no bun | Node 24.15.0, bun 1.3.14 |
| Build | `APV_BUILD_TOOL=vite` (plain `vite build`, root `node_modules` of `550fbb5`, same lockfile as `bee35b8`) | `bun install` + `bun run build` per revision |
| Oracle GitHub reads | The sandbox network gateway answers `api.github.com` with its own credentials (rate limit 15000/h, `used` stayed 0). `GITHUB_TOKEN` was not set. `--github-budget 400`, `--pause 0.1`. | Unauthenticated (60/h) unless `GITHUB_TOKEN` is set; budget 30 without a token |
| Browser network | `APV_BROWSER_PROXY_FROM_ENV=1` (sandbox needs its proxy) and `APV_IGNORE_TLS_ERRORS=1` (the sandbox gateway re-signs TLS for `api.github.com`) | both off |
| Phases run | oracle, both builds, UI check, compare. Phases were started one by one, not through `run_all.sh`. | all phases |
| Full CI (phase 4) | not run (no bun in the sandbox) | run |
| `ui_check.mjs` | the committed file before `biome format` (whitespace only, then re-tested on 2 logins × 3 targets with the same verdicts) | committed file |
| `oracle.py` | the committed file before one change: a part of a small GitHub budget is now kept for cycle-only actors. With budget 400 every actor was checked, so only the row order differs. | committed file |

Only aggregate counts and source hashes are kept here. Per-actor rows (logins,
wallet addresses, raw API bodies, screenshots) were removed on purpose: they
identify affected people. Run `run_all.sh` to produce your own per-actor
results from live data. The operator keeps them private.

## Result of this run

Data snapshot (identical before and after the UI run):

- `/data/leaderboard.json` `fc57af5aa66ea2a11f778e9f194b9489cd6791ee09d91b81ffced270db47c809`
- `/data/cycles/index.json` `ec5d2558b2996646d4f02b31cd240e8751e545c71d7b9814877c1f2da88f4559`
- `/data/funding-reviews.json` `4181b6796f1599fc62b62a51984acdfac735b6f56c69268e01b0a16b19ff3528`

Oracle over all classified actors:

| Class | count | expected `shown` | `historical` | `unavailable` | `none` |
|---|---|---|---|---|---|
| frozen_only | 69 | 9 | 0 | 1 (GitHub 404) | 59 |
| cycle_only | 17 | 0 | 1 | 0 | 16 |
| control (8 evaluated) | 8 | 6 | 0 | 0 | 2 |

7 more review actors are in the snapshot outside cycles (`frozen_ambiguous`).
The oracle does not model the rolling window for them and does not score them.

UI check, 21 selected logins (14 frozen-only, 3 cycle-only, 4 controls):

| Target | match | mismatch | N/A |
|---|---|---|---|
| live https://slop.cash (bundle `index-DLGC7TEB.js`, no GitHub lookup in it) | 13 | 8 | 0 |
| local `bee35b8` | 13 | 8 | 0 |
| local `258c991` | 21 | 0 | 0 |

All 8 mismatches on live and on `bee35b8` are frozen-only rows. 7 have a
current wallet claim on the live API and the page says "No current payout
wallet registered". 1 has a login that GitHub does not
resolve (404) and the page says the same. Each mismatch equals the oracle's
"no lookup" prediction. Controls and cycle-only rows match on all three
targets.

`APV_NO_SHIM=1` check (one control, `bee35b8`): without the shim the local
wallet read fails with a CORS error (`api.slop.cash` sends no
Access-Control-Allow-Origin to `http://127.0.0.1:4601`, after its 403
`origin_not_allowed`) and the page shows "Current payout wallet status
unavailable". This is why the shim exists.
