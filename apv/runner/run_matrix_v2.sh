#!/bin/bash
# usage: run_matrix_v2.sh <rev> <name> <port> [adapter]
# Spec, adapter and CSV come from the apv/experiment-2 working tree in $SRC.
REV=$1; NAME=$2; PORT=$3; ADAPTER=${4:-per-chain}
SRC=/workspace/work/sdc2; WT=/workspace/work/apvwt/$NAME; OUT=/workspace/work/apv/results_v2
export PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-/workspace/work/apv/.pw-browsers}
mkdir -p $OUT /workspace/work/apvwt
git -C $SRC worktree remove --force $WT 2>/dev/null; git -C $SRC worktree add -q --detach $WT $REV
cd $WT && ln -s $SRC/node_modules node_modules && mkdir -p public && cp -r $SRC/public/data public/
mkdir -p apv && cp $SRC/apv/matrix_v2.csv apv/ && cp $SRC/tests/e2e/apv-matrix.spec.ts $SRC/tests/e2e/apv-adapters.ts tests/e2e/
sha256sum apv/matrix_v2.csv tests/e2e/apv-matrix.spec.ts tests/e2e/apv-adapters.ts > $OUT/$NAME.inputs.sha256
node node_modules/vite/bin/vite.js build > $OUT/$NAME.build.log 2>&1 || { echo "$NAME BUILD_FAIL" >> $OUT/summary.txt; exit 1; }
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port $PORT --strictPort > /tmp/pv_$NAME.log 2>&1 &
VP=$!; sleep 4
APV_ADAPTER=$ADAPTER NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost SLOP_BASE_URL=http://127.0.0.1:$PORT node_modules/.bin/playwright test tests/e2e/apv-matrix.spec.ts --project=desktop-chromium --workers=2 --reporter=json --output=/tmp/pwm_$NAME > $OUT/$NAME.json 2> $OUT/$NAME.err
RC=$?
echo "$NAME $(git rev-parse --short HEAD) adapter=$ADAPTER rc=$RC $(date -u +%FT%TZ)" >> $OUT/summary.txt
kill $VP
touch $OUT/$NAME.done
