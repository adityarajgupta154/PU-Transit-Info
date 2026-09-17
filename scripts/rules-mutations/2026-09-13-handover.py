#!/usr/bin/env python3
"""Rules mutation, 13 Sep 2026: handover audit action (ADM-10 / ADM-06).

Applies on top of 2026-09-13-assignments.py (13 Sep order: route-versions ->
route-archive -> assignments -> this).  Edits both Rules copies in one pass.
Run from the repo root:  python3 scripts/rules-mutations/2026-09-13-handover.py

Change
- audit action 'tracking.handover' joins the enum: one record per handover naming
  the previous and the next driver.  The handover itself needs no new Rules — the
  admin end branch (force-end) and the dated-assignment write already exist.

Publish order: part of the unpublished 13 Sep payload; one publish covers it all.
Nothing in live data changes.
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def mutate(rules: dict) -> None:
    audit = rules["audit"]["$id"]
    old = "newData.child('action').val() == 'tracking.force_end'"
    assert "'assignment.save'" in audit[".validate"], "run 2026-09-13-assignments.py first"
    assert old in audit[".validate"] and "'tracking.handover'" not in audit[".validate"]
    audit[".validate"] = audit[".validate"].replace(old, old + " || newData.child('action').val() == 'tracking.handover'")


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
