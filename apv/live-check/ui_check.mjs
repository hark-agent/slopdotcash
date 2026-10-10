// Live UI check. Opens each selected profile on each target and records the
// payout-wallet marker text, a screenshot and the wallet/GitHub network calls.
//
// No route mocks. Nothing on the page is replaced by test data.
//
// One exception, for local targets only, and it is a transport shim, not a mock:
// https://api.slop.cash answers 403 {"error":"origin_not_allowed"} to any
// Origin that is not a slop.cash origin (backend/trace/handler.ts). A local
// `vite preview` runs on http://127.0.0.1:<port>, so without help every local
// wallet read fails and the page shows "unavailable" for a transport reason.
// The shim forwards the same GET to the live API from Node without the Origin
// header, returns the live status and body unchanged, and adds
// Access-Control-Allow-Origin for the local origin. Each forwarded call is
// logged with its status and body SHA-256. Set APV_NO_SHIM=1 to switch it off.
// The live target (https://slop.cash) never gets any route.
//
// usage: node ui_check.mjs <selection.json> <out_dir> name=url [name=url ...]
// example: node ui_check.mjs sel.json out live=https://slop.cash base=http://127.0.0.1:4601

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [selectionPath, outDir, ...targetArgs] = process.argv.slice(2);
if (!selectionPath || !outDir || targetArgs.length === 0) {
  console.error(
    "usage: node ui_check.mjs <selection.json> <out_dir> name=url ...",
  );
  process.exit(2);
}
const selection = JSON.parse(readFileSync(selectionPath, "utf8"));
const targets = targetArgs.map((arg) => {
  const at = arg.indexOf("=");
  return { name: arg.slice(0, at), url: arg.slice(at + 1).replace(/\/$/, "") };
});
const noShim = process.env.APV_NO_SHIM === "1";
const settleMs = Number(process.env.APV_SETTLE_MS ?? 30000);
mkdirSync(outDir, { recursive: true });

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const markers = [
  {
    kind: "shown",
    re: /Current payout wallet · ([1-9A-HJ-NP-Za-km-z]{32,44})/u,
  },
  { kind: "historical", re: /Historical payout wallet · ([^\s]+)/u },
  { kind: "unavailable", re: /Current payout wallet status unavailable/u },
  { kind: "none", re: /No current payout wallet registered/u },
];
const loadingRe = /Checking current payout wallet…|Checking frozen months…/u;

function readMarker(text) {
  for (const m of markers) {
    const hit = m.re.exec(text);
    if (hit) return { kind: m.kind, address: hit[1] ?? "", text: hit[0] };
  }
  if (loadingRe.test(text)) return { kind: "loading", address: "", text: "" };
  return { kind: "no_marker", address: "", text: "" };
}

async function liveDataHashes(site) {
  const out = {};
  for (const p of [
    "/data/leaderboard.json",
    "/data/cycles/index.json",
    "/data/funding-reviews.json",
  ]) {
    try {
      const r = await fetch(site + p, { cache: "no-store" });
      out[p] = {
        status: r.status,
        sha256: sha256(Buffer.from(await r.arrayBuffer())),
      };
    } catch (e) {
      out[p] = { error: String(e) };
    }
  }
  return out;
}

// Optional: route the browser through HTTPS_PROXY (for networks that need a
// proxy; the sandbox dry run used it). Off by default.
function proxyFromEnv() {
  if (process.env.APV_BROWSER_PROXY_FROM_ENV !== "1") return undefined;
  const raw = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!raw) return undefined;
  const u = new URL(raw);
  return {
    server: `${u.protocol}//${u.host}`,
    username: decodeURIComponent(u.username) || undefined,
    password: decodeURIComponent(u.password) || undefined,
    bypass: "127.0.0.1,localhost",
  };
}
const launchOptions = { proxy: proxyFromEnv() };
let browser = await chromium.launch(launchOptions);
const observations = [];
const meta = {
  started_at: new Date().toISOString(),
  playwright_version: browser.version(),
  shim: !noShim,
  browser_proxy_from_env: Boolean(launchOptions.proxy),
  ignore_tls_errors: process.env.APV_IGNORE_TLS_ERRORS === "1",
  settle_ms: settleMs,
  targets,
  selection_data_sha256: selection.data_sha256,
};
const liveTarget = targets.find((t) => /^https:/u.test(t.url));
if (liveTarget) meta.live_data_before = await liveDataHashes(liveTarget.url);

for (const target of targets) {
  const local = /^http:\/\/(127\.0\.0\.1|localhost)/u.test(target.url);
  mkdirSync(join(outDir, "screenshots", target.name), { recursive: true });
  // Live bundle fingerprint: does the deployed code contain the GitHub lookup?
  if (!local) {
    try {
      const html = await (await fetch(`${target.url}/`)).text();
      const src = /src="(\/assets\/index-[^"]+\.js)"/u.exec(html)?.[1];
      const js = src ? await (await fetch(target.url + src)).text() : "";
      meta[`bundle_${target.name}`] = {
        entry: src ?? null,
        sha256: js ? sha256(Buffer.from(js)) : null,
        contains_github_users_lookup: js.includes("api.github.com/users"),
      };
    } catch (e) {
      meta[`bundle_${target.name}`] = { error: String(e) };
    }
  }
  for (const item of selection.logins) {
    if (!browser.isConnected()) browser = await chromium.launch(launchOptions);
    // APV_IGNORE_TLS_ERRORS=1 only for a network that re-signs TLS (the Hark
    // sandbox does this for api.github.com). Do not set it on a normal machine.
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      ignoreHTTPSErrors: process.env.APV_IGNORE_TLS_ERRORS === "1",
    });
    const page = await context.newPage();
    const calls = [];
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
    });
    page.on("response", (resp) => {
      const u = resp.url();
      if (
        u.startsWith("https://api.github.com/") ||
        u.startsWith("https://api.slop.cash/")
      )
        calls.push({ url: u, status: resp.status() });
    });
    page.on("requestfailed", (req) => {
      const u = req.url();
      if (
        u.startsWith("https://api.github.com/") ||
        u.startsWith("https://api.slop.cash/")
      )
        calls.push({
          url: u,
          status: null,
          failure: req.failure()?.errorText ?? "",
        });
    });
    const shimLog = [];
    if (local && !noShim) {
      await context.route("https://api.slop.cash/**", async (route) => {
        const req = route.request();
        const headers = { ...req.headers() };
        delete headers.origin;
        delete headers.referer;
        try {
          const resp = await route.fetch({ headers });
          const body = await resp.body();
          shimLog.push({
            url: req.url(),
            status: resp.status(),
            sha256: sha256(body),
            at: new Date().toISOString(),
          });
          await route.fulfill({
            status: resp.status(),
            headers: {
              ...resp.headers(),
              "access-control-allow-origin": new URL(target.url).origin,
            },
            body,
          });
        } catch (e) {
          shimLog.push({ url: req.url(), error: String(e) });
          await route.abort();
        }
      });
    }
    const url = `${target.url}/contributors/${encodeURIComponent(item.login)}`;
    let marker = { kind: "no_marker", address: "", text: "" };
    let navError = "";
    const t0 = Date.now();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      // Open any collapsed <details> that may hold the wallet line.
      while (Date.now() - t0 < settleMs) {
        await page.evaluate(() => {
          for (const d of document.querySelectorAll("details")) d.open = true;
        });
        marker = readMarker(await page.locator("body").innerText());
        if (marker.kind !== "loading" && marker.kind !== "no_marker") break;
        await page.waitForTimeout(500);
      }
      // A final marker can still be replaced if a late request finishes.
      await page.waitForTimeout(1500);
      marker = readMarker(await page.locator("body").innerText());
    } catch (e) {
      navError = String(e).slice(0, 300);
    }
    const shot = join("screenshots", target.name, `${item.login}.png`);
    try {
      await page.screenshot({ path: join(outDir, shot), fullPage: false });
    } catch {}
    observations.push({
      target: target.name,
      target_url: target.url,
      login: item.login,
      class: item.class,
      url,
      observed: marker.kind,
      observed_address: marker.address,
      marker_text: marker.text,
      elapsed_ms: Date.now() - t0,
      nav_error: navError,
      screenshot: shot,
      calls,
      shim: shimLog,
      console_errors: consoleErrors.slice(0, 10),
      at: new Date().toISOString(),
    });
    console.log(
      `${target.name}\t${item.login}\t${marker.kind}\t${marker.address}`,
    );
    await context.close().catch(() => {});
  }
}
if (liveTarget) meta.live_data_after = await liveDataHashes(liveTarget.url);
meta.finished_at = new Date().toISOString();
await browser.close().catch(() => {});
writeFileSync(
  join(outDir, "ui_observations.json"),
  JSON.stringify({ meta, observations }, null, 2),
);
const head =
  "target,login,class,observed,observed_address,elapsed_ms,nav_error,screenshot";
const lines = observations.map((o) =>
  [
    o.target,
    o.login,
    o.class,
    o.observed,
    o.observed_address,
    o.elapsed_ms,
    JSON.stringify(o.nav_error),
    o.screenshot,
  ].join(","),
);
writeFileSync(
  join(outDir, "ui_observations.csv"),
  `${[head, ...lines].join("\n")}\n`,
);
