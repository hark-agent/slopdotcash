#!/usr/bin/env python3
"""Joins oracle expectations with UI observations. Standard library only.

usage: compare.py <oracle_dir> <ui_dir> <out_dir>

Verdict per (login, target):
  match     observed marker kind (and address, when one is shown) equals the
            oracle expectation under the invariant
  mismatch  anything else, including no marker and a page still loading
  N/A       the oracle could not decide (expected = indeterminate)

A second column says whether the observation equals the oracle's prediction
for a page without frozen-only resolution ("predicted_no_lookup_ui"). That
column explains upstream mismatches; it is not the verdict.
"""

import csv
import json
import os
import sys


def main():
    oracle_dir, ui_dir, out = sys.argv[1:4]
    os.makedirs(out, exist_ok=True)
    sel = json.load(open(os.path.join(oracle_dir, "selection.json")))
    exp = {x["login"]: x for x in sel["logins"]}
    ui = json.load(open(os.path.join(ui_dir, "ui_observations.json")))
    rows = []
    for o in ui["observations"]:
        e = exp.get(o["login"])
        if e is None:
            continue
        if e["expected"] == "indeterminate":
            verdict = "N/A"
        else:
            same_kind = o["observed"] == e["expected"]
            same_addr = e["expected"] not in ("shown", "historical") or \
                o["observed_address"] == e.get("expected_address", "")
            verdict = "match" if same_kind and same_addr else "mismatch"
        pred = e["predicted_no_lookup_ui"]
        rows.append({
            "target": o["target"], "login": o["login"], "class": e["class"],
            "expected": e["expected"], "expected_address": e.get("expected_address", ""),
            "observed": o["observed"], "observed_address": o["observed_address"],
            "verdict": verdict,
            "equals_no_lookup_prediction": "yes" if o["observed"] == pred else "no",
            "github_calls": sum(1 for c in o["calls"] if c["url"].startswith("https://api.github.com/")),
            "screenshot": o["screenshot"],
        })
    cols = list(rows[0].keys()) if rows else ["target"]
    with open(os.path.join(out, "results.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    summary = {}
    for r in rows:
        s = summary.setdefault(r["target"], {"match": 0, "mismatch": 0, "N/A": 0})
        s[r["verdict"]] += 1
    lines = ["# Live UI check results", "",
             f"UI meta: started {ui['meta'].get('started_at')}, shim={ui['meta'].get('shim')}",
             "", "| target | match | mismatch | N/A |", "|---|---|---|---|"]
    for t, s in summary.items():
        lines.append(f"| {t} | {s['match']} | {s['mismatch']} | {s['N/A']} |")
    lines += ["", "| target | login | class | expected | observed | verdict | = no-lookup prediction |",
              "|---|---|---|---|---|---|---|"]
    for r in rows:
        ea = f" {r['expected_address'][:6]}…" if r["expected_address"] else ""
        oa = f" {r['observed_address'][:6]}…" if r["observed_address"] else ""
        lines.append(f"| {r['target']} | {r['login']} | {r['class']} | {r['expected']}{ea} | "
                     f"{r['observed']}{oa} | **{r['verdict']}** | {r['equals_no_lookup_prediction']} |")
    for key in ("live_data_before", "live_data_after"):
        if key in ui["meta"]:
            lines += ["", f"{key}: `{json.dumps(ui['meta'][key])}`"]
    lines += ["", f"oracle data sha256: `{json.dumps(sel.get('data_sha256'))}`"]
    for k, v in ui["meta"].items():
        if k.startswith("bundle_"):
            lines += [f"{k}: `{json.dumps(v)}`"]
    open(os.path.join(out, "results.md"), "w").write("\n".join(lines) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
