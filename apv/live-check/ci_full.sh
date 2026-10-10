#!/usr/bin/env bash
# Runs the upstream quality job of .github/workflows/deploy.yml (pull-request
# path) on one revision, step by step, in a fresh detached worktree.
# Every step runs even if an earlier step fails. Each step writes a log, and
# steps.tsv records: step, exit code, seconds.
#
# usage: ci_full.sh <rev> <out_dir>
#
# Steps (deploy.yml job "Skill, data, build, and browser checks"):
#   install      bun install --frozen-lockfile --ignore-scripts
#   audit        bun run audit:dependencies
#   contracts    bun run verify:contracts            (needs Python PyYAML 6.0.3)
#   pr_ledger    live https://slop.cash/data/leaderboard.json -> scripts/prepare-pr-ledger.ts
#   cycles       bun run cycles:check
#   typecheck    bun run typecheck                    (verify:code, part 1)
#   lint         bun run lint:check                   (verify:code, part 2)
#   build        bun run build  (PR env: staging tier, profile seed, offline points)
#   pw_install   ./node_modules/.bin/playwright install chromium
#   installer    bun run test:installer:e2e
#   e2e          SLOP_E2E_PREBUILT=1 bun run test:e2e  (preview + Pages phases)
# Extra, not in deploy.yml:
#   unit         bun test workers/slopbot
set -uo pipefail
REV=$1; OUT=$2
REPO=$(git -C "$(cd "$(dirname "$0")" && pwd)" rev-parse --show-toplevel)
WORK=${APV_WORK:-${TMPDIR:-/tmp}/apv-live-check}
WT=$WORK/ci/$REV
mkdir -p "$OUT" "$WORK/ci"
OUT=$(cd "$OUT" && pwd)
git -C "$REPO" worktree remove --force "$WT" 2>/dev/null
git -C "$REPO" worktree add --detach "$WT" "$REV" > "$OUT/worktree.txt" 2>&1 || { echo "worktree failed"; exit 10; }
cd "$WT" || exit 11
printf 'step\trc\tseconds\n' > "$OUT/steps.tsv"
echo "rev=$REV head=$(git rev-parse HEAD) started=$(date -u +%FT%TZ)" > "$OUT/meta.txt"

step() {
  local name=$1; shift
  local t0; t0=$(date +%s)
  echo "== $name: $*" | tee -a "$OUT/progress.txt"
  ( eval "$@" ) > "$OUT/$name.txt" 2>&1
  local rc=$?
  printf '%s\t%s\t%s\n' "$name" "$rc" "$(( $(date +%s) - t0 ))" >> "$OUT/steps.tsv"
  echo "   rc=$rc" | tee -a "$OUT/progress.txt"
}

export CI=true
# Base branch of both revisions is `development`, so CI builds the staging tier.
export VITE_SLOP_ENVIRONMENT=staging

step install   "bun install --frozen-lockfile --ignore-scripts"
step audit     "bun run audit:dependencies"
step contracts "python3 -c 'import yaml; print(yaml.__version__)' && bun run verify:contracts"
step pr_ledger "mkdir -p public/data && curl --fail --silent --show-error --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 60 --max-filesize 26214400 --output '$OUT/live-leaderboard.json' https://slop.cash/data/leaderboard.json && test -s '$OUT/live-leaderboard.json' && bun scripts/prepare-pr-ledger.ts '$OUT/live-leaderboard.json' public/data/leaderboard.json"
step cycles    "bun run cycles:check"
step typecheck "bun run typecheck"
step lint      "bun run lint:check"
step build     "SLOP_PROFILES_INPUT=data/profiles/seed.json SLOP_POINTS_ONLINE=0 SLOP_POINTS_BOOTSTRAP=1 bun run build"
step pw_install "./node_modules/.bin/playwright install chromium"
step installer "bun run test:installer:e2e"
step e2e       "SLOP_E2E_PREBUILT=1 bun run test:e2e"
step unit      "bun test workers/slopbot"
rm -f "$OUT/live-leaderboard.json"
# Keep the Playwright report folders, if any, for the operator.
if [ -d test-results ]; then tar -czf "$OUT/test-results.tgz" test-results 2>/dev/null; fi
echo "finished=$(date -u +%FT%TZ)" >> "$OUT/meta.txt"
cat "$OUT/steps.tsv"
