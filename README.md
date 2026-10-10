# Leaderboard snapshot used for APV matrix v2 runs

This branch holds the exact `public/data/leaderboard.json` input used for every APV matrix v2 run on branch `apv/experiment-1` (runs R1-R7 in `apv/EVIDENCE_LEDGER.md`).

- File: `data/leaderboard.json` (17417947 bytes)
- SHA-256: `f9827309c7a824ffd84bd5efd70cf2503eaf122bd8b96cb828acdab88416841c`
- Local file time: 2026-10-09 12:39 UTC

To reproduce a run:

1. Check out the revision from the ledger.
2. Copy `data/leaderboard.json` from this branch to `public/data/leaderboard.json` (the path is git-ignored).
3. Run `sha256sum -c SHA256SUMS` here, or compare the hash of the copied file.
4. Run the command from the ledger row.

This is not the snapshot with SHA-256 9ee2ea15... that nerd27dk used for the PR #3 reruns. Do not merge this branch.
