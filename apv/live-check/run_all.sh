#!/usr/bin/env bash
# Entry point. Runs: preflight -> oracle -> live UI check -> full CI.
# Writes apv/live-check/results/<UTC timestamp>/ and SHA256SUMS in it,
# then packs the folder as results-<timestamp>.tar.gz.
#
# Env (all optional):
#   GITHUB_TOKEN      token for the oracle's GitHub reads (raises 60/h to 5000/h).
#                     The browser never uses it.
#   SKIP_CI=1         skip phase 4 (full CI); phases 2 and 3 take about 20 minutes.
#   APV_BUILD_TOOL    bun (default) or vite; see build_target.sh
#   APV_PORT_BASE     first local port (default 4601; uses this and the next one)
#   APV_NO_SHIM=1     run local targets without the CORS shim (see ui_check.mjs)
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(git -C "$HERE" rev-parse --show-toplevel)
REV_BASE=bee35b8   # upstream development head that the fix is based on
REV_FIX=258c991    # fix/profile-wallet-identity-v2 head (code commit 55274db)
TS=$(date -u +%Y%m%dT%H%M%SZ)
R=$HERE/results/$TS
P=${APV_PORT_BASE:-4601}
mkdir -p "$R"
exec > >(tee -a "$R/run_all.txt") 2>&1
echo "run_all started $TS"

sum256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

# ---------- 1. Preflight ----------
{
  echo "date_utc=$TS"
  echo "uname=$(uname -a)"
  command -v sw_vers >/dev/null && sw_vers
  echo "node=$(node -v 2>&1)"
  echo "bun=$(bun -v 2>&1)"
  echo "python3=$(python3 -V 2>&1)"
  echo "git=$(git --version)"
  echo "pack_head=$(git -C "$REPO" rev-parse HEAD)"
  echo "rev_base=$(git -C "$REPO" rev-parse "$REV_BASE^{commit}" 2>&1)"
  echo "rev_fix=$(git -C "$REPO" rev-parse "$REV_FIX^{commit}" 2>&1)"
  echo "github_token_set=$([ -n "${GITHUB_TOKEN:-}" ] && echo yes || echo no)"
} > "$R/env.txt"
cat "$R/env.txt"
fail=0
node -e 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:1)' || { echo "PREFLIGHT: need Node >= 24 (CI uses 24.15.0)"; fail=1; }
command -v bun >/dev/null || { [ "${APV_BUILD_TOOL:-bun}" = vite ] || { echo "PREFLIGHT: bun not found (CI uses 1.3.14)"; fail=1; }; }
git -C "$REPO" cat-file -e "$REV_BASE^{commit}" 2>/dev/null || { echo "PREFLIGHT: $REV_BASE missing; run: git fetch origin"; fail=1; }
git -C "$REPO" cat-file -e "$REV_FIX^{commit}" 2>/dev/null || { echo "PREFLIGHT: $REV_FIX missing; run: git fetch origin"; fail=1; }
[ $fail -eq 0 ] || { echo "Preflight failed. Nothing else ran."; exit 1; }

# Root dependencies give the UI script its Playwright library.
if [ ! -d "$REPO/node_modules/playwright" ]; then
  (cd "$REPO" && bun install --frozen-lockfile --ignore-scripts) || { echo "root install failed"; exit 1; }
fi
(cd "$REPO" && ./node_modules/.bin/playwright install chromium) > "$R/playwright_install.txt" 2>&1 \
  || echo "WARN: playwright install chromium failed, see playwright_install.txt"
(cd "$REPO" && ./node_modules/.bin/playwright --version) >> "$R/env.txt" 2>&1

# ---------- 2. Independent oracle ----------
echo "== phase 2: oracle"
python3 "$HERE/oracle.py" --out "$R/oracle"
ORC=$?
echo "oracle rc=$ORC"

# ---------- 3. Live UI check ----------
if [ $ORC -eq 0 ]; then
  echo "== phase 3: build $REV_BASE and $REV_FIX, then UI check"
  bash "$HERE/build_target.sh" "$REV_BASE" base "$P" "$R/oracle" "$R/ui"; B1=$?
  bash "$HERE/build_target.sh" "$REV_FIX" fix "$((P + 1))" "$R/oracle" "$R/ui"; B2=$?
  T=("live=https://slop.cash")
  [ $B1 -eq 0 ] && T+=("base_${REV_BASE}=http://127.0.0.1:$P")
  [ $B2 -eq 0 ] && T+=("fix_${REV_FIX}=http://127.0.0.1:$((P + 1))")
  (cd "$REPO" && NO_PROXY=127.0.0.1,localhost node "$HERE/ui_check.mjs" "$R/oracle/selection.json" "$R/ui" "${T[@]}")
  echo "ui_check rc=$?"
  python3 "$HERE/compare.py" "$R/oracle" "$R/ui" "$R"
  for f in "$R"/ui/preview_*.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; rm -f "$f"; done
else
  echo "phase 3 skipped: the oracle failed (see oracle/oracle.json meta.fatal)"
fi

# ---------- 4. Full CI ----------
if [ "${SKIP_CI:-0}" != 1 ]; then
  echo "== phase 4: full CI on $REV_FIX, then $REV_BASE"
  bash "$HERE/ci_full.sh" "$REV_FIX" "$R/ci/$REV_FIX"
  bash "$HERE/ci_full.sh" "$REV_BASE" "$R/ci/$REV_BASE"
  {
    echo "| step | $REV_BASE rc | $REV_FIX rc |"; echo "|---|---|---|"
    paste "$R/ci/$REV_BASE/steps.tsv" "$R/ci/$REV_FIX/steps.tsv" | tail -n +2 \
      | awk -F'\t' '{print "| "$1" | "$2" | "$5" |"}'
  } > "$R/ci_summary.md"
  cat "$R/ci_summary.md"
else
  echo "phase 4 skipped (SKIP_CI=1)"
fi

# ---------- 5. Checksums and archive ----------
echo "run_all finished $(date -u +%FT%TZ)"
(cd "$R" && find . -type f ! -name SHA256SUMS ! -name run_all.txt | LC_ALL=C sort | while read -r f; do sum256 "$f"; done > SHA256SUMS)
tar -czf "$HERE/results/results-$TS.tar.gz" -C "$HERE/results" "$TS"
echo "archive: $HERE/results/results-$TS.tar.gz"
sum256 "$HERE/results/results-$TS.tar.gz"
