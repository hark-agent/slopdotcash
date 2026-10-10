#!/usr/bin/env python3
"""Independent oracle for the slop.cash profile payout-wallet marker.

This script does not import, read or run any application code. It reads the
same public sources that the profile page reads, and it computes from the raw
responses what the profile page SHOULD show under this invariant:

    If the current payout wallet of the profile actor is not known,
    the page must say "unavailable". It must never say "no wallet".

Standard library only (Python 3.9 or later).

Sources (all public, read only):
  {SITE}/data/leaderboard.json      rolling snapshot (views are built from it)
  {SITE}/data/cycles/index.json     reward cycles and their contributors
  {SITE}/data/funding-reviews.json  frozen monthly reviews (frozen-only actors)
  https://api.github.com/users/<login>                  login -> id, node_id
  {API}/api/v1/wallet-claims/actors/<numeric id>/current current claim or null

Outputs in --out:
  raw/                 raw response bodies, named by SHA-256
  oracle.json          metadata, all classified actors, expectations
  oracle.csv           one row per evaluated actor
  selection.json       logins for the UI check (bounded GitHub budget)
"""

import argparse
import csv
import datetime as dt
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ORACLE_VERSION = "1"
USER_AGENT = "apv-live-check-oracle/1 (read-only verification)"
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
CLAIM_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
AVATAR_ID_RE = re.compile(r"^https://avatars\.githubusercontent\.com/u/(\d+)(?:\?|$)")


def now_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds")


class Recorder:
    """Stores every raw response and keeps a request log."""

    def __init__(self, out_dir):
        self.raw_dir = os.path.join(out_dir, "raw")
        os.makedirs(self.raw_dir, exist_ok=True)
        self.log = []

    def get(self, url, headers=None, timeout=60):
        hdrs = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        hdrs.update(headers or {})
        req = urllib.request.Request(url, headers=hdrs, method="GET")
        started = now_iso()
        status, body, resp_headers, error = None, b"", {}, None
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                status = resp.status
                body = resp.read()
                resp_headers = dict(resp.headers.items())
        except urllib.error.HTTPError as exc:
            status = exc.code
            body = exc.read() or b""
            resp_headers = dict(exc.headers.items()) if exc.headers else {}
        except Exception as exc:  # network error, TLS error, timeout
            error = f"{type(exc).__name__}: {exc}"
        sha = hashlib.sha256(body).hexdigest()
        if body:
            path = os.path.join(self.raw_dir, sha + ".bin")
            if not os.path.exists(path):
                with open(path, "wb") as fh:
                    fh.write(body)
        keep = {
            k: v
            for k, v in resp_headers.items()
            if k.lower()
            in (
                "content-type",
                "date",
                "etag",
                "last-modified",
                "cf-ray",
                "cache-control",
                "age",
                "x-ratelimit-limit",
                "x-ratelimit-remaining",
                "x-ratelimit-reset",
                "x-ratelimit-used",
                "access-control-allow-origin",
            )
        }
        entry = {
            "url": url,
            "requested_at": started,
            "status": status,
            "error": error,
            "bytes": len(body),
            "sha256": sha,
            "headers": keep,
        }
        self.log.append(entry)
        return status, body, entry


def b58_decode_len(text):
    num = 0
    for ch in text:
        idx = B58.find(ch)
        if idx < 0:
            return None
        num = num * 58 + idx
    raw = num.to_bytes((num.bit_length() + 7) // 8, "big") if num else b""
    pad = len(text) - len(text.lstrip("1"))
    return pad + len(raw)


def is_solana_address(text):
    return (
        isinstance(text, str)
        and 32 <= len(text) <= 44
        and b58_decode_len(text) == 32
    )


def walk_actors(value, found):
    """Collects every {"actor": {"login": ...}} object anywhere in the JSON."""
    if isinstance(value, dict):
        actor = value.get("actor")
        if isinstance(actor, dict) and isinstance(actor.get("login"), str):
            found.append(actor)
        for child in value.values():
            walk_actors(child, found)
    elif isinstance(value, list):
        for child in value:
            walk_actors(child, found)


def parse_time(text):
    try:
        return dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--site", default=os.environ.get("APV_SITE", "https://slop.cash"))
    ap.add_argument("--api", default=os.environ.get("APV_API", "https://api.slop.cash"))
    ap.add_argument("--github-budget", type=int, default=None,
                    help="max GitHub /users calls (default 30 without token, 400 with token)")
    ap.add_argument("--ui-frozen", type=int, default=int(os.environ.get("APV_UI_FROZEN", "14")),
                    help="max frozen-only logins in the UI selection")
    ap.add_argument("--ui-cycle-only", type=int, default=int(os.environ.get("APV_UI_CYCLE_ONLY", "3")))
    ap.add_argument("--ui-controls", type=int, default=int(os.environ.get("APV_UI_CONTROLS", "4")))
    ap.add_argument("--pause", type=float, default=0.25, help="seconds between API calls")
    args = ap.parse_args()

    out = args.out
    os.makedirs(out, exist_ok=True)
    rec = Recorder(out)
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    gh_headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        gh_headers["Authorization"] = "Bearer " + token
    budget = args.github_budget if args.github_budget is not None else (400 if token else 30)
    meta = {
        "oracle_version": ORACLE_VERSION,
        "started_at": now_iso(),
        "site": args.site,
        "api": args.api,
        "github_token_used": bool(token),
        "github_budget": budget,
        "invariant": "unknown current wallet => 'unavailable'; never 'no wallet' without a confirmed lookup",
    }

    # 1. Public data files, exactly as the page requests them (without cache-busting query).
    sources = {}
    data = {}
    for key, path in (
        ("leaderboard", "/data/leaderboard.json"),
        ("cycles", "/data/cycles/index.json"),
        ("funding_reviews", "/data/funding-reviews.json"),
    ):
        status, body, entry = rec.get(args.site + path)
        sources[key] = entry
        if status != 200:
            meta["fatal"] = f"{path} returned {status} {entry['error'] or ''}".strip()
            if status in (403, 503) and b"cloudflare" in body.lower():
                meta["fatal"] += " (Cloudflare block page)"
            break
        data[key] = json.loads(body)
        # Keep a stable copy for the local builds.
        with open(os.path.join(out, key + ".json"), "wb") as fh:
            fh.write(body)
    meta["sources"] = sources

    rl_status, rl_body, _ = rec.get("https://api.github.com/rate_limit", gh_headers)
    try:
        meta["github_rate_limit_before"] = json.loads(rl_body)["resources"]["core"]
    except Exception:
        meta["github_rate_limit_before"] = {"status": rl_status}

    if "fatal" in meta:
        meta["finished_at"] = now_iso()
        meta["requests"] = rec.log
        json.dump({"meta": meta}, open(os.path.join(out, "oracle.json"), "w"), indent=2)
        print("ORACLE FATAL:", meta["fatal"], file=sys.stderr)
        return 2

    lb, cy, fr = data["leaderboard"], data["cycles"], data["funding_reviews"]

    # 2. Index the raw data.
    lb_actors = []
    walk_actors(lb, lb_actors)
    lb_logins = {a["login"].lower() for a in lb_actors}
    cycle_keys = {(c["projectId"], c["cycleId"]) for c in cy.get("cycles", [])}
    cycle_rows = {}
    for c in cy.get("cycles", []):
        for row in c.get("contributors", []):
            cycle_rows.setdefault(row["actor"]["login"].lower(), []).append(
                {"projectId": c["projectId"], "cycleId": c["cycleId"], "actor": row["actor"],
                 "wallet": row.get("wallet")})
    review_rows = {}
    for r in fr.get("reviews", []):
        prep = (r["projectId"], r["cycleId"]) not in cycle_keys
        for row in r.get("contributors", []):
            review_rows.setdefault(row["actor"]["login"].lower(), []).append(
                {"projectId": r["projectId"], "cycleId": r["cycleId"], "preparation": prep,
                 "actor": row["actor"], "wallet": row.get("wallet"),
                 "lookupUnavailable": row.get("lookupUnavailable")})

    # 3. Classify.
    frozen_only, frozen_ambiguous, cycle_only = [], [], []
    for login, rows in sorted(review_rows.items()):
        in_cycles = login in cycle_rows
        if in_cycles:
            continue
        if not any(x["preparation"] for x in rows):
            continue  # the page would not render a profile from these reviews
        (frozen_ambiguous if login in lb_logins else frozen_only).append(login)
    for login in sorted(cycle_rows):
        if login not in lb_logins:
            cycle_only.append(login)

    # Controls: rolling-window leaders with a numeric avatar id and an event in
    # the month of window.to. Their profile does not need a GitHub lookup.
    window_to = parse_time(str(lb.get("window", {}).get("to", "")))
    month_start = window_to.replace(day=1, hour=0, minute=0, second=0, microsecond=0) if window_to else None
    recent = set()
    for ev in lb.get("ledger", []):
        t = parse_time(str(ev.get("occurredAt", "")))
        if month_start and t and t >= month_start and isinstance(ev.get("actor"), dict):
            recent.add(ev["actor"]["login"].lower())
    control_pool = []
    for leader in lb.get("leaders", []):
        actor = leader.get("actor", {})
        m = AVATAR_ID_RE.match(str(actor.get("avatarUrl", "")))
        login = str(actor.get("login", "")).lower()
        if m and login in recent and login not in review_rows:
            control_pool.append((login, actor, m.group(1)))

    meta["counts"] = {
        "leaderboard_logins": len(lb_logins),
        "cycle_logins": len(cycle_rows),
        "review_logins": len(review_rows),
        "frozen_only": len(frozen_only),
        "frozen_ambiguous_in_snapshot": len(frozen_ambiguous),
        "cycle_only": len(cycle_only),
        "control_pool": len(control_pool),
    }
    meta["frozen_ambiguous_logins"] = frozen_ambiguous
    meta["window_to"] = str(lb.get("window", {}).get("to"))

    gh_calls = 0

    def github_identity(login, recorded_node_id):
        nonlocal gh_calls
        if gh_calls >= budget:
            return {"identity": "not_checked_budget", "github_status": None}
        gh_calls += 1
        status, body, entry = rec.get(
            "https://api.github.com/users/" + urllib.parse.quote(login, safe=""), gh_headers)
        time.sleep(args.pause)
        res = {"github_status": status, "github_sha256": entry["sha256"],
               "github_at": entry["requested_at"],
               "github_ratelimit_remaining": entry["headers"].get("X-RateLimit-Remaining")
               or entry["headers"].get("x-ratelimit-remaining")}
        if status == 404:
            res["identity"] = "login_not_found"
            return res
        if status != 200:
            res["identity"] = "github_error"  # 403/429 rate limit, 5xx, network
            return res
        try:
            user = json.loads(body)
        except Exception:
            res["identity"] = "github_error"
            return res
        res["github_login"] = user.get("login")
        res["github_id"] = user.get("id")
        res["github_node_id"] = user.get("node_id")
        if not (isinstance(user.get("id"), int) and user["id"] >= 1
                and isinstance(user.get("login"), str)
                and user["login"].lower() == login.lower()):
            res["identity"] = "github_invalid_body"
        elif user.get("node_id") != recorded_node_id:
            res["identity"] = "node_id_mismatch"
        else:
            res["identity"] = "match"
            res["numeric_id"] = str(user["id"])
        return res

    def wallet_claim(numeric_id):
        url = f"{args.api}/api/v1/wallet-claims/actors/{numeric_id}/current"
        status, body, entry = rec.get(url)  # no Origin header: server-side read
        time.sleep(args.pause)
        res = {"claim_status": status, "claim_sha256": entry["sha256"], "claim_at": entry["requested_at"]}
        if status != 200:
            res["claim"] = "error"
            return res
        try:
            value = json.loads(body)
        except Exception:
            res["claim"] = "error"
            return res
        if value is None:
            res["claim"] = "none"
        elif (isinstance(value, dict)
              and isinstance(value.get("claimId"), str)
              and CLAIM_ID_RE.match(value["claimId"])
              and value.get("githubActorId") == numeric_id
              and is_solana_address(value.get("address"))):
            res["claim"] = "shown"
            res["claim_address"] = value["address"]
            res["claim_chain"] = value.get("chain")
        else:
            res["claim"] = "error"
            res["claim_note"] = "body does not pass the actor-bound checks"
        return res

    def expectation(cls, login, recorded_actor, history_wallet):
        row = {"login": recorded_actor["login"], "class": cls,
               "recorded_actor_id": recorded_actor.get("id"),
               "history_wallet": history_wallet or ""}
        if cls == "control":
            row["identity"] = "avatar_numeric_id"
            row["numeric_id"] = recorded_actor["_numeric"]
        else:
            row.update(github_identity(login, recorded_actor.get("id")))
        if row.get("identity") in ("not_checked_budget", "github_error"):
            # The oracle itself could not ask GitHub. The page would show
            # "unavailable" on such an error, but the browser has its own quota,
            # so this row cannot be scored.
            row["expected"] = "indeterminate"
        elif row.get("numeric_id"):
            row.update(wallet_claim(row["numeric_id"]))
            if row["claim"] == "shown":
                row["expected"] = "shown"
                row["expected_address"] = row["claim_address"]
            elif history_wallet:
                row["expected"] = "historical"
                row["expected_address"] = history_wallet
            elif row["claim"] == "none":
                row["expected"] = "none"
            else:
                row["expected"] = "unavailable"
        else:
            # Identity is not proven (404, node_id mismatch, invalid body).
            if history_wallet:
                row["expected"] = "historical"
                row["expected_address"] = history_wallet
            else:
                row["expected"] = "unavailable"
        # What a page without frozen-only resolution (upstream bee35b8) is
        # predicted to show: no lookup, so "none" unless a historical wallet.
        if cls == "control":
            row["predicted_no_lookup_ui"] = row["expected"]
        else:
            row["predicted_no_lookup_ui"] = "historical" if history_wallet else "none"
        row["review_recorded_wallet"] = ""
        return row

    rows = []

    def eval_cycle_only(login):
        actor = cycle_rows[login][0]["actor"]
        hw = next((x["wallet"]["address"] for x in cycle_rows[login]
                   if isinstance(x.get("wallet"), dict) and x["wallet"].get("address")), None)
        rows.append(expectation("cycle_only", login, actor, hw))

    # Keep part of a small GitHub budget for cycle-only actors, so a run
    # without a token still has some of them.
    reserve = min(len(cycle_only), max(budget // 5, args.ui_cycle_only))
    for login in cycle_only[:reserve]:
        eval_cycle_only(login)
    for login in frozen_only:
        actor = review_rows[login][0]["actor"]
        r = expectation("frozen_only", login, actor, None)
        recw = [x["wallet"]["address"] for x in review_rows[login] if isinstance(x.get("wallet"), dict)]
        r["review_recorded_wallet"] = recw[0] if recw else ""
        r["review_lookup_unavailable"] = any(bool(x.get("lookupUnavailable")) for x in review_rows[login])
        rows.append(r)
    for login in cycle_only[reserve:]:
        eval_cycle_only(login)
    for login, actor, num in control_pool[: max(args.ui_controls * 2, args.ui_controls)]:
        a = dict(actor)
        a["_numeric"] = num
        hw = next((x["wallet"]["address"] for x in cycle_rows.get(login, [])
                   if isinstance(x.get("wallet"), dict) and x["wallet"].get("address")), None)
        rows.append(expectation("control", login, a, hw))

    # 4. UI selection: spread over expected categories, determinate rows only.
    def pick(cls, limit):
        pool = [r for r in rows if r["class"] == cls and r["expected"] != "indeterminate"]
        by = {}
        for r in pool:
            by.setdefault(r["expected"], []).append(r)
        order = ["unavailable", "shown", "historical", "none"]
        chosen = []
        while len(chosen) < limit and any(by.get(k) for k in order):
            for k in order:
                if by.get(k) and len(chosen) < limit:
                    chosen.append(by[k].pop(0))
        return chosen

    selected = pick("frozen_only", args.ui_frozen) + pick("cycle_only", args.ui_cycle_only) \
        + pick("control", args.ui_controls)
    for r in rows:
        r["ui_selected"] = r in selected

    rl_status, rl_body, _ = rec.get("https://api.github.com/rate_limit", gh_headers)
    try:
        meta["github_rate_limit_after"] = json.loads(rl_body)["resources"]["core"]
    except Exception:
        meta["github_rate_limit_after"] = {"status": rl_status}
    meta["github_user_calls"] = gh_calls
    meta["finished_at"] = now_iso()
    summary = {}
    for r in rows:
        summary.setdefault(r["class"], {}).setdefault(r["expected"], 0)
        summary[r["class"]][r["expected"]] += 1
    meta["expected_summary"] = summary
    meta["requests"] = rec.log

    with open(os.path.join(out, "oracle.json"), "w") as fh:
        json.dump({"meta": meta, "rows": rows, "frozen_only_logins": frozen_only,
                   "cycle_only_logins": cycle_only}, fh, indent=2, sort_keys=True)
    cols = ["login", "class", "ui_selected", "recorded_actor_id", "identity", "github_status",
            "github_login", "github_id", "github_node_id", "numeric_id", "claim_status", "claim",
            "claim_address", "history_wallet", "expected", "expected_address",
            "predicted_no_lookup_ui", "review_recorded_wallet", "github_sha256", "github_at",
            "claim_sha256", "claim_at"]
    with open(os.path.join(out, "oracle.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)
    with open(os.path.join(out, "selection.json"), "w") as fh:
        json.dump({"generated_at": meta["finished_at"],
                   "data_sha256": {k: v["sha256"] for k, v in sources.items()},
                   "logins": [{"login": r["login"], "class": r["class"], "expected": r["expected"],
                               "expected_address": r.get("expected_address", ""),
                               "predicted_no_lookup_ui": r["predicted_no_lookup_ui"]}
                              for r in selected]}, fh, indent=2)
    print(json.dumps({"counts": meta["counts"], "expected_summary": summary,
                      "github_user_calls": gh_calls, "selected": len(selected)}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
