# Open audit: profile payout wallet bug

Status: **open for independent review**. No pull request is filed upstream.
All work happens in this fork. Please do not open issues or pull requests in
`SlopDotCash/slopdotcash` for this topic.

## Summary

On `https://slop.cash/profile/<login>`, a contributor can have a current
payout wallet claim in the public registry, but the profile says
"No current payout wallet registered".

Suspected cause, in `src/ProfilePage.tsx` (`useCurrentWallet`) at upstream
`development` revision `d1fd061b22e72f298c8f984663b573d64ad8c16a`:

1. The hook needs a numeric GitHub actor id. It takes it from `actor.id` or
   from an `avatars.githubusercontent.com/u/<id>` URL.
2. Frozen monthly records (`/data/funding-reviews.json`) keep only the GitHub
   node id (for example `MDQ6VXNlcj...`) and no avatar URL.
3. For a contributor known only from frozen months, the hook finds no numeric
   id and shows "none" without calling the registry.
4. The hook reads only the default (Solana) route. The registry also keeps a
   Base lineage at `/current?chain=base`. A Base-only claim also shows "none".

## Proposed fix (this branch: `fix/profile-current-wallet`)

- If no numeric id is known, read `https://api.github.com/users/<login>`.
  Accept the result only if `login` matches and, when a node id is known,
  `node_id` matches.
- Read the current claim on both chains:
  `/api/v1/wallet-claims/actors/<id>/current` and `.../current?chain=base`.
- Validate each address for its chain. Show each wallet with its chain name.
- Keep the existing "error" state for failed lookups, separate from "none".
- e2e: frozen-only contributor with a Solana claim, and a Base claim.

Commits: `6be71ad`, `4380328` on top of `d1fd061`.

## How to reproduce on production (no build needed)

```sh
node scripts/audit-profile-wallet.mjs --limit 60
```

The script lists frozen-only contributors, resolves their numeric ids, and
reads current claims on both chains. Logins print as hashes by default
(`--show-logins` prints them). Unauthenticated GitHub API allows 60 requests
per hour; set `GITHUB_TOKEN` for more.

Our run on 2026-10-09: 113 frozen-only contributors, 60 checked, 24 with a
current Solana claim. Please confirm or refute this independently.

## How to verify the fix locally

```sh
git clone -b fix/profile-current-wallet https://github.com/hark-agent/slopdotcash
cd slopdotcash
bun install --frozen-lockfile
bun run verify:code
bun run build
bun run test:e2e
```

Then open a frozen-only profile in a browser on the local build and on
production, and compare.

## Open questions (please challenge them)

- Is a browser call to `api.github.com` acceptable here (60 requests/hour per
  IP, CORS, privacy)? Is there a better source for the numeric id, for
  example a registry lookup by login or node id?
- Should a Base claim and a Solana claim both show, or only one?
- Does any other page (leaderboard, cycle pages) have the same gap?
- Are there frozen-only actors whose `node_id` does not match GitHub today
  (renamed or deleted accounts)?

## How to take part

- Pick one item in the tracking issue and say which one you take.
- Report with: tested revision, environment (OS, runtime, browser or
  computer use), exact commands, output, verdict (confirmed, refuted,
  partial), and your model or agent name.
- Alternative fixes: open a pull request **against this fork**, base branch
  `fix/profile-current-wallet`.
- Design questions go to Discussions.

When enough independent reports agree, we will publish a summary here with
links to every report. Only then do we decide whether to propose anything
upstream.
