/**
 * APV experiment 1: pre-registered actor x claim x lookup matrix.
 * Reads apv/matrix_v2.csv and checks each cell's expected profile state.
 * Uses plain Playwright (no console guard), so a result here is the
 * behavioral verdict only.
 */
import { readFileSync } from "node:fs";
import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { deploymentOrigins, deploymentTier } from "../../src/lib/deployment";

const deployment = deploymentOrigins(
  deploymentTier(process.env.VITE_SLOP_ENVIRONMENT),
);
const MATRIX = process.env.APV_MATRIX ?? "apv/matrix_v2.csv";

type Cell = {
  cell: string;
  actor: "current" | "frozen-only" | "renamed" | "mismatch";
  claim: "solana" | "base" | "both" | "none";
  lookup: "ok" | "base-503" | "solana-timeout";
  expected: string;
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const [header, ...body] = parseCsv(readFileSync(MATRIX, "utf8"));
const cells: Cell[] = body.map((values) => {
  const record = Object.fromEntries(
    (header ?? []).map((key, index) => [key, values[index] ?? ""]),
  );
  return record as unknown as Cell;
});

/** The seven profile states a cell can assert. */
const MARKERS = {
  solanaShown: /Current Solana payout wallet ·/u,
  baseShown: /Current Base payout wallet ·/u,
  solanaUnavailable: "Current Solana payout wallet status unavailable",
  baseUnavailable: "Current Base payout wallet status unavailable",
  unavailable: "Current payout wallet status unavailable",
  none: "No current payout wallet registered",
  historical: /Historical payout wallet ·/u,
} as const;
type Marker = keyof typeof MARKERS;

function expectedMarkers(expected: string): Set<Marker> {
  const set = new Set<Marker>();
  if (/Solana wallet shown/u.test(expected)) set.add("solanaShown");
  if (/Base wallet shown/u.test(expected)) set.add("baseShown");
  if (/Solana status unavailable/u.test(expected)) set.add("solanaUnavailable");
  if (/Base status unavailable/u.test(expected)) set.add("baseUnavailable");
  if (/^Current payout wallet status unavailable/u.test(expected))
    set.add("unavailable");
  if (/^No current payout wallet registered/u.test(expected)) set.add("none");
  if (set.size === 0) throw new Error(`Unmapped expectation: ${expected}`);
  return set;
}

type Actors = {
  current: { id: string; login: string; numericId: string };
  frozen: { id: string; login: string };
};

async function json(request: APIRequestContext, path: string) {
  const response = await request.get(path);
  expect(response.status(), path).toBe(200);
  return response.json();
}

async function pickActors(request: APIRequestContext): Promise<Actors> {
  const snapshot = await json(request, "/data/leaderboard.json");
  const cycles = await json(request, "/data/cycles/index.json");
  const reviews = await json(request, "/data/funding-reviews.json");
  type Actor = { id: string; login: string; avatarUrl?: string };
  const cycleContributors: Array<{ actor: Actor; wallet?: unknown }> =
    cycles.cycles.flatMap(
      (cycle: { contributors: unknown[] }) => cycle.contributors,
    );
  const walletLogins = new Set(
    cycleContributors
      .filter((entry) => entry.wallet)
      .map((entry) => entry.actor.login.toLowerCase()),
  );
  const leader = (snapshot.leaders as Array<{ actor: Actor }>)
    .map((entry) => entry.actor)
    .find(
      (actor) =>
        /\/u\/\d+/u.test(actor.avatarUrl ?? "") &&
        !walletLogins.has(actor.login.toLowerCase()),
    );
  const known = new Set(
    [
      ...(snapshot.leaders as Array<{ actor: Actor }>).map(
        (e) => e.actor.login,
      ),
      ...(snapshot.opportunities as Array<{ actor: Actor }>).map(
        (e) => e.actor.login,
      ),
      ...cycleContributors.map((e) => e.actor.login),
    ].map((login) => login.toLowerCase()),
  );
  const frozen = (
    reviews.reviews as Array<{
      projectId: string;
      cycleId: string;
      contributors: Array<{ actor: Actor }>;
    }>
  )
    .filter(
      (review) =>
        !cycles.cycles.some(
          (cycle: { projectId: string; cycleId: string }) =>
            cycle.projectId === review.projectId &&
            cycle.cycleId === review.cycleId,
        ),
    )
    .flatMap((review) => review.contributors)
    .map((entry) => entry.actor)
    .find((actor) => !known.has(actor.login.toLowerCase()));
  if (!leader || !frozen) throw new Error("fixture actors not found");
  const numericId = /\/u\/(\d+)/u.exec(leader.avatarUrl ?? "")?.[1] ?? "";
  return {
    current: { id: leader.id, login: leader.login, numericId },
    frozen: { id: frozen.id, login: frozen.login },
  };
}

async function routeCell(page: Page, cell: Cell, actors: Actors) {
  const actor = cell.actor === "current" ? actors.current : actors.frozen;
  const numericId =
    cell.actor === "current" ? actors.current.numericId : "424242";
  const githubCalls: string[] = [];
  await page.route("https://api.github.com/users/**", (route) => {
    githubCalls.push(route.request().url());
    if (cell.actor === "renamed")
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ message: "Not Found" }),
      });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: Number(numericId),
        login: actor.login,
        node_id:
          cell.actor === "mismatch" ? `${actor.id}-other-account` : actor.id,
      }),
    });
  });
  await page.route(
    `${deployment.api}/api/v1/wallet-claims/actors/*/current*`,
    (route) => {
      const url = new URL(route.request().url());
      const id = url.pathname.split("/").at(-2) ?? "";
      const chain =
        url.searchParams.get("chain") === "base" ? "base" : "solana";
      if (chain === "base" && cell.lookup === "base-503")
        return route.fulfill({ status: 503, body: "unavailable" });
      if (chain === "solana" && cell.lookup === "solana-timeout")
        return route.abort("timedout");
      const has = cell.claim === "both" || cell.claim === chain;
      if (!has)
        return route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "not_found" }),
        });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          claimId: `apv-${chain}-claim`,
          githubActorId: id,
          address:
            chain === "base"
              ? `0x${"ab".repeat(20)}`
              : "11111111111111111111111111111111",
          chain,
        }),
      });
    },
  );
  return { actor, githubCalls };
}

for (const cell of cells) {
  test(`${cell.cell} ${cell.actor} x ${cell.claim} x ${cell.lookup}`, async ({
    page,
    request,
  }) => {
    const actors = await pickActors(request);
    const { actor } = await routeCell(page, cell, actors);
    await page.goto(`/contributors/${encodeURIComponent(actor.login)}`);
    await expect(
      page.getByRole("heading", { name: actor.login }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Register or update your wallet" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Checking current payout wallet…")).toHaveCount(
      0,
      { timeout: 20_000 },
    );
    const want = expectedMarkers(cell.expected);
    const observed: Marker[] = [];
    for (const marker of Object.keys(MARKERS) as Marker[]) {
      const pattern = MARKERS[marker];
      const count = await page
        .getByText(pattern, { exact: typeof pattern === "string" })
        .count();
      if (count > 0) observed.push(marker);
    }
    test.info().annotations.push({
      type: "observed",
      description: observed.join("+") || "nothing",
    });
    expect(observed.sort()).toEqual([...want].sort());
  });
}
