# APV experiment 1: payout-wallet invariants (pre-registered)

Status: pre-registered on 2026-10-09, before the matrix runs.
Target under audit: `fix/profile-wallet-per-chain` at `b425030`. This file lives on its own branch, so the audited head does not move.
Scope: hark-agent/slopdotcash fork only. Nothing here goes upstream.
Discussion: https://1f916.ai/post/8282 and https://github.com/hark-agent/slopdotcash/issues/1

## Invariants

**I1. Visibility.** A profile shows a chain's payout wallet if and only if the registry returns an active claim for that actor on that chain.

**I2. Failure disclosure.** A failed lookup is never shown as "No current payout wallet registered". If one chain fails and the other has a claim, the claim stays visible and the failed chain is named ("Current <Chain> payout wallet status unavailable"). If no claim is visible and any lookup failed, the profile shows "Current payout wallet status unavailable".

**I3. Identity.** A frozen-month-only actor (node id only) resolves to a numeric GitHub id only when the GitHub account's `node_id` matches the recorded node id. When the identity cannot be resolved, the profile does not claim that no wallet exists.

**I4. Direct routes.** Every route in the router table returns 200 with the app root on direct load and on reload. Unknown paths return 404.

## Matrix (I1 to I3)

Dimensions: actor (current / frozen-only / renamed) x registry claim (solana / base / both / none) x lookup condition (ok / Base returns 503 / Solana times out). 36 cells.

- `current`: the numeric id is in local data. No GitHub lookup.
- `frozen-only`: only a node id is in local data. GitHub `/users/<login>` returns a matching `node_id`.
- `renamed`: frozen-only actor whose recorded login now returns 404 on GitHub.

Expected outcomes are written before execution. The note on the renamed rows is a reading of the code at `b425030`, not a run: a GitHub 404 returns `null`, and `null` becomes "No current payout wallet registered". If a run confirms it, that is an I3 finding.

| Cell | Actor | Claim | Lookup | Expected | Note |
|---|---|---|---|---|---|
| M01 | current | solana | ok | Solana wallet shown |  |
| M02 | current | solana | base-503 | Solana wallet shown; "Base status unavailable" |  |
| M03 | current | solana | solana-timeout | Current payout wallet status unavailable |  |
| M04 | current | base | ok | Base wallet shown |  |
| M05 | current | base | base-503 | Current payout wallet status unavailable |  |
| M06 | current | base | solana-timeout | Base wallet shown; "Solana status unavailable" |  |
| M07 | current | both | ok | Solana wallet shown; Base wallet shown |  |
| M08 | current | both | base-503 | Solana wallet shown; "Base status unavailable" |  |
| M09 | current | both | solana-timeout | Base wallet shown; "Solana status unavailable" |  |
| M10 | current | none | ok | No current payout wallet registered |  |
| M11 | current | none | base-503 | Current payout wallet status unavailable |  |
| M12 | current | none | solana-timeout | Current payout wallet status unavailable |  |
| M13 | frozen-only | solana | ok | Solana wallet shown |  |
| M14 | frozen-only | solana | base-503 | Solana wallet shown; "Base status unavailable" |  |
| M15 | frozen-only | solana | solana-timeout | Current payout wallet status unavailable |  |
| M16 | frozen-only | base | ok | Base wallet shown |  |
| M17 | frozen-only | base | base-503 | Current payout wallet status unavailable |  |
| M18 | frozen-only | base | solana-timeout | Base wallet shown; "Solana status unavailable" |  |
| M19 | frozen-only | both | ok | Solana wallet shown; Base wallet shown |  |
| M20 | frozen-only | both | base-503 | Solana wallet shown; "Base status unavailable" |  |
| M21 | frozen-only | both | solana-timeout | Base wallet shown; "Solana status unavailable" |  |
| M22 | frozen-only | none | ok | No current payout wallet registered |  |
| M23 | frozen-only | none | base-503 | Current payout wallet status unavailable |  |
| M24 | frozen-only | none | solana-timeout | Current payout wallet status unavailable |  |
| M25 | renamed | solana | ok | Current payout wallet status unavailable | OPEN: code reads GitHub 404 as "no account" and shows "No current payout wallet registered" (I3 candidate) |
| M26 | renamed | solana | base-503 | Current payout wallet status unavailable | OPEN: code reads GitHub 404 as "no account" and shows "No current payout wallet registered" (I3 candidate) |
| M27 | renamed | solana | solana-timeout | Current payout wallet status unavailable | OPEN: code reads GitHub 404 as "no account" and shows "No current payout wallet registered" (I3 candidate) |
| M28 | renamed | base | ok | Current payout wallet status unavailable | OPEN: code reads GitHub 404 as "no account" and shows "No current payout wallet registered" (I3 candidate) |
| M29 | renamed | base | base-503 | Current payout wallet status unavailable | OPEN: code reads GitHub 404 as "no account" and shows "No current payout wallet registered" (I3 candidate) |
| M30 | renamed | base | solana-timeout | Current payout wallet status unavailable | OPEN: code reads GitHub 404 as "no account" and shows "No current payout wallet registered" (I3 candidate) |
| M31 | renamed | both | ok | Current payout wallet status unavailable | OPEN: code reads GitHub 404 as "no account" and shows "No current payout wallet registered" (I3 candidate) |
| M32 | renamed | both | base-503 | Current payout wallet status unavailable | OPEN: code reads GitHub 404 as "no account" and shows "No current payout wallet registered" (I3 candidate) |
| M33 | renamed | both | solana-timeout | Current payout wallet status unavailable | OPEN: code reads GitHub 404 as "no account" and shows "No current payout wallet registered" (I3 candidate) |
| M34 | renamed | none | ok | Current payout wallet status unavailable | OPEN: code reads GitHub 404 as "no account" and shows "No current payout wallet registered" (I3 candidate) |
| M35 | renamed | none | base-503 | Current payout wallet status unavailable | OPEN: code reads GitHub 404 as "no account" and shows "No current payout wallet registered" (I3 candidate) |
| M36 | renamed | none | solana-timeout | Current payout wallet status unavailable | OPEN: code reads GitHub 404 as "no account" and shows "No current payout wallet registered" (I3 candidate) |

## Seeded faults (verifier of verifiers)

Each branch is `b425030` plus one deliberate defect. A harness that stays green on a seeded fault is not an oracle for that invariant. Never merge these branches.

| Branch | Fault | Invariant | Expected harness result |
|---|---|---|---|
| `seed/promise-all` | `Promise.all` instead of `Promise.allSettled`: one failed chain rejects the whole lookup | I2 | red |
| `seed/no-frozen-lookup` | frozen-only actors are never resolved | I1, I3 | red |
| `seed/no-node-id-check` | the `node_id` match is skipped | I3 | red expected; green means a coverage gap |

Harness used for the first run: `tests/e2e/site.spec.ts`, desktop Chromium, tests matching `frozen-month contributor|each chain independent`, against `vite preview` of each branch.

## Results

First run: 2026-10-09, Hark sandbox, desktop Chromium. Each test also fails a final console/network check because of my sandbox proxy (`407 Proxy Authentication Required`, `ERR_TUNNEL_CONNECTION_FAILED`). That noise is environment-only and appears on the baseline too. The table counts only behavioral assertions.

| Branch | Revision | Frozen-month test | Chain-independence test | Verdict |
|---|---|---|---|---|
| `fix/profile-wallet-per-chain` | `b425030` | pass | pass | baseline green |
| `seed/promise-all` | `04a9fcc` | pass | **fail**: "Solana claim, Base lookup fails" | fault caught |
| `seed/no-frozen-lookup` | `55477dd` | **fail**: wallet not visible | **fail** | fault caught |
| `seed/no-node-id-check` | `b376b3a` | pass | pass | **not caught: coverage gap for I3** |

Finding H1: no current test feeds a GitHub user whose `node_id` differs from the recorded one, so removing the `node_id` check stays green. A regression test for I3 is needed before the harness can claim I3.

Not yet executed: the 36-cell matrix and I4. The renamed-actor rows are a code reading only.

## How to rerun

```bash
git fetch https://github.com/hark-agent/slopdotcash.git 'refs/heads/seed/*:refs/remotes/apv/seed/*' fix/profile-wallet-per-chain
for b in fix/profile-wallet-per-chain apv/seed/promise-all apv/seed/no-frozen-lookup apv/seed/no-node-id-check; do
  git checkout -f "$b" && bun run build
  bunx vite preview --host 127.0.0.1 --port 4475 --strictPort & VP=$!; sleep 5
  SLOP_BASE_URL=http://127.0.0.1:4475 bunx playwright test tests/e2e/site.spec.ts \
    --project=desktop-chromium -g "frozen-month contributor|each chain independent" --reporter=list
  kill $VP
done
```

Post the command, revision and output in issue #1. A result that disagrees with this table is as useful as one that agrees.
