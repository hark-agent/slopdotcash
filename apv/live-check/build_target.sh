#!/usr/bin/env bash
# Builds one revision in a detached worktree, puts the oracle's live data files
# into the build output, and starts `vite preview` on 127.0.0.1:<port>.
#
# usage: build_target.sh <rev> <name> <port> <oracle_dir> <out_dir>
#
# The build is a production-tier build (VITE_SLOP_ENVIRONMENT is unset), so the
# page calls https://api.slop.cash for the wallet claim, as on https://slop.cash.
# The data files (/data/leaderboard.json, /data/cycles/index.json,
# /data/funding-reviews.json) are same-origin reads. They are replaced with
# the exact bytes the oracle read, so the oracle and both local builds judge
# the same snapshot.
#
# Env:
#   APV_WORK          worktree root (default: ${TMPDIR:-/tmp}/apv-live-check)
#   APV_BUILD_TOOL    "bun" (default: bun install + bun run build, as CI) or
#                     "vite" (reuse the repo root node_modules, plain vite build;
#                     only for machines without bun, for example a sandbox)
set -uo pipefail
REV=$1; NAME=$2; PORT=$3; ORACLE=$4; OUT=$5
REPO=$(git -C "$(cd "$(dirname "$0")" && pwd)" rev-parse --show-toplevel)
WORK=${APV_WORK:-${TMPDIR:-/tmp}/apv-live-check}
WT=$WORK/wt/$NAME
TOOL=${APV_BUILD_TOOL:-bun}
mkdir -p "$OUT" "$WORK/wt"
LOG=$OUT/build_$NAME.txt
exec 3>&1
(
  echo "rev=$REV name=$NAME port=$PORT tool=$TOOL started=$(date -u +%FT%TZ)"
  git -C "$REPO" worktree remove --force "$WT" 2>/dev/null
  git -C "$REPO" worktree add --detach "$WT" "$REV" || exit 10
  cd "$WT" || exit 11
  echo "head=$(git rev-parse HEAD)"
  for f in leaderboard.json cycles.json funding_reviews.json; do
    test -s "$ORACLE/$f" || { echo "missing $ORACLE/$f (run the oracle first)"; exit 12; }
  done
  mkdir -p public/data
  cp "$ORACLE/leaderboard.json" public/data/leaderboard.json
  unset VITE_SLOP_ENVIRONMENT
  if [ "$TOOL" = "bun" ]; then
    bun install --frozen-lockfile --ignore-scripts || exit 13
    # Same inputs as the CI pull-request build: reviewed profile seed, offline points.
    SLOP_PROFILES_INPUT=data/profiles/seed.json SLOP_POINTS_ONLINE=0 SLOP_POINTS_BOOTSTRAP=1 \
      bun run build
    rc=$?
    if [ $rc -ne 0 ]; then
      echo "bun run build failed rc=$rc; one fallback: plain vite build"
      node node_modules/vite/bin/vite.js build || exit 14
    fi
  else
    ln -sfn "$REPO/node_modules" node_modules
    node node_modules/vite/bin/vite.js build || exit 14
  fi
  mkdir -p dist/data/cycles
  cp "$ORACLE/leaderboard.json" dist/data/leaderboard.json
  cp "$ORACLE/cycles.json" dist/data/cycles/index.json
  cp "$ORACLE/funding_reviews.json" dist/data/funding-reviews.json
  echo "dist data sha256:"
  for f in dist/data/leaderboard.json dist/data/cycles/index.json dist/data/funding-reviews.json; do
    if command -v sha256sum >/dev/null; then sha256sum "$f"; else shasum -a 256 "$f"; fi
  done
  echo "bundle markers (count of 'api.github.com/users' in dist/assets):"
  grep -l "api.github.com/users" dist/assets/*.js 2>/dev/null | wc -l
  node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port "$PORT" --strictPort \
    > "$OUT/preview_$NAME.txt" 2>&1 &
  echo $! > "$OUT/preview_$NAME.pid"
  for _ in $(seq 1 30); do
    if curl -s -o /dev/null --noproxy 127.0.0.1 "http://127.0.0.1:$PORT/"; then
      echo "preview up on $PORT"; exit 0
    fi
    sleep 1
  done
  echo "preview did not start"; exit 15
) > "$LOG" 2>&1
rc=$?
echo "build_target $NAME rc=$rc (log: $LOG)" >&3
exit $rc
