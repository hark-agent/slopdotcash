/**
 * APV UI adapters (layer b).
 *
 * The scenario layer (apv-matrix.spec.ts + apv/matrix_v2.csv) states WHAT a
 * profile must show for each cell, as a set of abstract markers. An adapter
 * says HOW one UI variant renders those markers and how to reach them:
 *   - how to locate (and, if collapsed, expand) the wallet section,
 *   - which on-page text means "shown" / "unavailable" / "none" per chain,
 *   - which API reply the variant's backend uses for "no claim",
 *   - which cells the variant cannot express at all (reported N/A, never green).
 *
 * Expectations live only in the CSV. When a UI changes, fix the adapter.
 */
import type { Page } from "@playwright/test";

/** The seven profile states a cell can assert. */
export const MARKER_KEYS = [
  "solanaShown",
  "baseShown",
  "solanaUnavailable",
  "baseUnavailable",
  "unavailable",
  "none",
  "historical",
] as const;
export type Marker = (typeof MARKER_KEYS)[number];

export type Cell = {
  cell: string;
  actor: "current" | "frozen-only" | "renamed" | "mismatch";
  claim: "solana" | "base" | "both" | "none";
  lookup: "ok" | "base-503" | "solana-timeout";
  expected: string;
};

export type Applicability =
  | { applicable: true }
  | { applicable: false; reason: string };

export type UiAdapter = {
  name: string;
  description: string;
  /** Accessible name of the always-present wallet action link. */
  walletLinkName: string;
  /** Text shown while the current-wallet lookup is in flight. */
  loadingText: string;
  /** On-page pattern per marker; null = this UI cannot render that state. */
  markers: Record<Marker, RegExp | string | null>;
  /** HTTP reply the variant's wallet-claim API gives when an actor has no claim. */
  noClaimReply: { status: number; body: string };
  /** Cells this variant cannot express. Checked before any assertion. */
  applicability(cell: Cell, want: Set<Marker>): Applicability;
};

/**
 * Locate the wallet section and make it visible. Opens an enclosing collapsed
 * <details> (upstream 376fed1 used <details class="profile-wallet-details">).
 * Returns false when the section cannot be found.
 */
export async function openWalletSection(
  page: Page,
  adapter: UiAdapter,
  timeout = 20_000,
): Promise<boolean> {
  const link = page.locator("a", { hasText: adapter.walletLinkName }).first();
  try {
    await link.waitFor({ state: "attached", timeout });
  } catch {
    return false;
  }
  const collapsed = await link.evaluate((element) => {
    const details = element.closest("details");
    return details !== null && !details.open;
  });
  if (collapsed) {
    await link.evaluate((element) => {
      const summary = element.closest("details")?.querySelector("summary");
      if (summary instanceof HTMLElement) summary.click();
    });
  }
  try {
    await link.waitFor({ state: "visible", timeout: 5_000 });
  } catch {
    return false;
  }
  return true;
}

/** Fork per-chain UI: b425030, 4e4389b and the seed branches. */
const perChain: UiAdapter = {
  name: "per-chain",
  description:
    "fork fix/profile-wallet-per-chain UI: one line per chain, 404 = no claim",
  walletLinkName: "Register or update your wallet",
  loadingText: "Checking current payout wallet…",
  markers: {
    solanaShown: /Current Solana payout wallet ·/u,
    baseShown: /Current Base payout wallet ·/u,
    solanaUnavailable: "Current Solana payout wallet status unavailable",
    baseUnavailable: "Current Base payout wallet status unavailable",
    unavailable: "Current payout wallet status unavailable",
    none: "No current payout wallet registered",
    historical: /Historical payout wallet ·/u,
  },
  noClaimReply: {
    status: 404,
    body: JSON.stringify({ error: "not_found" }),
  },
  applicability: () => ({ applicable: true }),
};

/**
 * Upstream single-wallet UI (SlopDotCash development, checked at bee35b8):
 * one request to /wallet-claims/actors/<id>/current with no chain parameter,
 * the claim must be a Solana address, one text line "Current payout wallet ·".
 * Since 1744ef7 the API answers 200 `null` for "no claim"; 404 is an error.
 */
const upstreamSingle: UiAdapter = {
  name: "upstream-single",
  description:
    "upstream development single-wallet UI: Solana only, 200 null = no claim",
  walletLinkName: "Register or update your wallet",
  loadingText: "Checking current payout wallet…",
  markers: {
    // The only wallet this UI can show is a validated Solana address.
    solanaShown: /Current payout wallet ·/u,
    baseShown: null,
    solanaUnavailable: null,
    baseUnavailable: null,
    unavailable: "Current payout wallet status unavailable",
    none: "No current payout wallet registered",
    historical: /Historical payout wallet ·/u,
  },
  noClaimReply: { status: 200, body: "null" },
  applicability(cell, want) {
    const missing = [...want].filter((m) => this.markers[m] === null);
    if (missing.length > 0)
      return {
        applicable: false,
        reason: `single-wallet UI has no per-chain state for: ${missing.join(", ")}`,
      };
    // Identity cells expect "unavailable" whatever the chains do, so they stay
    // expressible. For resolvable actors the outcome depends on Base data the
    // UI never requests.
    const identityResolves =
      cell.actor === "current" || cell.actor === "frozen-only";
    if (identityResolves && (cell.claim === "base" || cell.lookup === "base-503"))
      return {
        applicable: false,
        reason:
          "outcome depends on the Base chain, which the single-wallet UI never requests",
      };
    return { applicable: true };
  },
};

export const ADAPTERS: Record<string, UiAdapter> = {
  [perChain.name]: perChain,
  [upstreamSingle.name]: upstreamSingle,
};

export function selectAdapter(name: string | undefined): UiAdapter {
  const adapter = ADAPTERS[name ?? "per-chain"];
  if (!adapter)
    throw new Error(
      `Unknown APV_ADAPTER ${name}; known: ${Object.keys(ADAPTERS).join(", ")}`,
    );
  return adapter;
}
