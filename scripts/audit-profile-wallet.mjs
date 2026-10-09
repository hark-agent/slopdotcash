#!/usr/bin/env node
// Open audit helper for the profile payout wallet bug.
// Finds contributors that the public site knows only from frozen monthly
// records (GitHub node id, no numeric id), resolves each numeric id through
// the public GitHub API, and reads current wallet claims on Solana and Base.
// A row with a claim is a profile that showed "No current payout wallet
// registered" before the fix.
//
// Usage: node scripts/audit-profile-wallet.mjs [--limit N] [--show-logins]
// Env:   SLOP_SITE (default https://slop.cash), SLOP_API (default
//        https://api.slop.cash), GITHUB_TOKEN (optional, raises rate limit).
// Logins are printed as a short sha256 prefix unless --show-logins is set.

import { createHash } from "node:crypto";

const site = process.env.SLOP_SITE ?? "https://slop.cash";
const api = process.env.SLOP_API ?? "https://api.slop.cash";
const args = process.argv.slice(2);
const showLogins = args.includes("--show-logins");
const limitIndex = args.indexOf("--limit");
const limit = limitIndex === -1 ? 50 : Number(args[limitIndex + 1]);

const json = async (url, headers = {}) => {
  const response = await fetch(url, {
    headers: { Accept: "application/json", ...headers },
  });
  return {
    status: response.status,
    body: response.ok ? await response.json() : null,
  };
};
const label = (login) =>
  showLogins
    ? login
    : `#${createHash("sha256").update(login.toLowerCase()).digest("hex").slice(0, 10)}`;

const reviews = (await json(`${site}/data/funding-reviews.json`)).body;
const cycles = (await json(`${site}/data/cycles/index.json`)).body;
const leaderboard = (await json(`${site}/data/leaderboard.json`)).body;

// Logins that also appear with a numeric id elsewhere are not affected.
const numeric = new Set();
const walk = (value) => {
  if (Array.isArray(value)) return value.forEach(walk);
  if (value && typeof value === "object") {
    if (
      typeof value.login === "string" &&
      /^\d+$/u.test(String(value.id ?? ""))
    )
      numeric.add(value.login.toLowerCase());
    Object.values(value).forEach(walk);
  }
};
walk(cycles);
walk(leaderboard);

const frozenOnly = new Map();
for (const review of reviews.reviews)
  for (const { actor } of review.contributors)
    if (!/^\d+$/u.test(actor.id) && !numeric.has(actor.login.toLowerCase()))
      frozenOnly.set(actor.login.toLowerCase(), actor);

const githubHeaders = process.env.GITHUB_TOKEN
  ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
  : {};
console.log(`site=${site} api=${api}`);
console.log(
  `frozen-only contributors: ${frozenOnly.size} (checking up to ${limit})`,
);

let checked = 0;
let affected = 0;
for (const actor of [...frozenOnly.values()].slice(0, limit)) {
  const user = await json(
    `https://api.github.com/users/${encodeURIComponent(actor.login)}`,
    githubHeaders,
  );
  if (user.status !== 200) {
    console.log(`${label(actor.login)}  github=${user.status}  skipped`);
    if (user.status === 403 || user.status === 429) break;
    continue;
  }
  checked += 1;
  const nodeMatch = user.body.node_id === actor.id;
  const claims = [];
  for (const chain of ["solana", "base"]) {
    const suffix = chain === "solana" ? "" : "?chain=base";
    const claim = await json(
      `${api}/api/v1/wallet-claims/actors/${user.body.id}/current${suffix}`,
    );
    if (claim.status === 200) claims.push(`${chain}:${claim.body.claimId}`);
  }
  if (claims.length > 0) affected += 1;
  console.log(
    `${label(actor.login)}  node_id_match=${nodeMatch}  claims=${claims.join(",") || "none"}`,
  );
}
console.log(`checked=${checked} with_current_claim=${affected}`);
console.log(
  "Each row with a claim showed no current wallet on its profile before the fix.",
);
