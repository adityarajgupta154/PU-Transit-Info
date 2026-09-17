#!/usr/bin/env python3
"""Rules mutation, 13 Sep 2026: route drafts and verified paths (RTE-01).

Applies on top of 2026-09-13-bus-registry.py (run that first; this script asserts
the registry node exists and that it has not run before).  Edits both Rules copies
in one pass.  Run from the repo root:  python3 scripts/rules-mutations/2026-09-13-route-publish.py

Changes
- routes/$routeId/status is required: 'draft' | 'published'.  The API reads a
  record without status as published (pre-RTE-01 data), but every new write must
  say which it is - so legacy nodes are rewritten whole by the API, never patched.
- routes/$routeId/pathSource is optional: 'ors' (road geometry through every
  stop, checked by the API within 150 m of each stop) | 'manual' (admin
  acknowledged the path is not road-verified; students see "path not verified").
- publishing requires pathSource == 'manual', or pathSource == 'ors' with a
  non-empty pathData.  Drafts carry any combination.

Publish order: with the bus-registry Rules (one publish covers both mutations).
Nothing in live data changes; existing routes stay visible until re-saved.
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def nd(field: str) -> str:
    return f"newData.child('{field}').val()"


PUBLISH_GATE = (
    f" && newData.child('status').isString() && ({nd('status')} == 'draft' || {nd('status')} == 'published')"
    f" && (!newData.child('pathSource').exists() || {nd('pathSource')} == 'ors' || {nd('pathSource')} == 'manual')"
    f" && ({nd('status')} != 'published' || {nd('pathSource')} == 'manual'"
    f" || ({nd('pathSource')} == 'ors' && newData.child('pathData').hasChildren()))"
)


def mutate(rules: dict) -> None:
    assert "buses" in rules, "run 2026-09-13-bus-registry.py first"
    route = rules["routes"]["$routeId"]
    assert "status" not in route, "route status already present; mutation applied before"
    anchor = "newData.hasChildren(['id', 'shift', 'busNumber', 'origin', 'destination'])"
    assert route[".validate"].count(anchor) == 1, "route validate anchor missing"
    route[".validate"] = route[".validate"] + PUBLISH_GATE
    # Field whitelist: insert before $other so the JSON stays readable in order.
    other = route.pop("$other")
    route["status"] = {".validate": "newData.isString() && (newData.val() == 'draft' || newData.val() == 'published')"}
    route["pathSource"] = {".validate": "newData.isString() && (newData.val() == 'ors' || newData.val() == 'manual')"}
    route["$other"] = other


def main() -> None:
    repo = HERE.parents[1]
    paths = [
        repo / "firebase/database.rules.json",
        repo / "artifacts/pu-transit/public/firebase-database.rules.json",
    ]
    sources = [path.read_text() for path in paths]
    assert sources[0] == sources[1], "the two Rules copies differ before mutation"
    document = json.loads(sources[0])
    mutate(document["rules"])
    output = json.dumps(document, indent=2) + "\n"
    for path in paths:
        path.write_text(output)
    print(f"wrote {len(output)} bytes to {len(paths)} files")


if __name__ == "__main__":
    main()
