#!/bin/bash
# usage: run_e2e_wallet.sh <worktree-name> <port>  (worktree already built by run_matrix_v2.sh)
WT=/workspace/work/apvwt/$1; PORT=$2; OUT=/workspace/work/apv/results_v2
export PLAYWRIGHT_BROWSERS_PATH=/workspace/work/apv/.pw-browsers
cd $WT
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port $PORT --strictPort > /tmp/pve_$1.log 2>&1 &
VP=$!; sleep 4
NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost SLOP_BASE_URL=http://127.0.0.1:$PORT node_modules/.bin/playwright test tests/e2e/site.spec.ts --project=desktop-chromium --workers=2 -g "frozen-month contributor|I3:|renders contributor and cycle records" --reporter=json --output=/tmp/pwe_$1 > $OUT/e2e_$1.json 2> $OUT/e2e_$1.err
echo "e2e_$1 rc=$?" >> $OUT/summary.txt
kill $VP; touch $OUT/e2e_$1.done
