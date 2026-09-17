#!/usr/bin/env python3
"""Rules mutation, 13 Sep 2026: archive and protected delete (RTE-03 / ADM-04, AC-20).

Applies on top of 2026-09-13-route-versions.py (run that first; this script asserts
routeVersions exists and that it has not run before).  Edits both Rules copies in
one pass.  Run from the repo root:  python3 scripts/rules-mutations/2026-09-13-route-archive.py

Changes
- routes/$routeId: a node can be removed only while its status is 'draft'
  (never published).  Published and archived routes are kept — riders' history and
  the pinned versions refer to them; the API archives them instead.  Legacy nodes
  without a status were always visible, so they cannot be removed either.  To keep
  that guard honest, a node that exists as anything but a draft can never become a
  draft again, and publishedVersion can never be dropped (pins read it).
- audit action 'route.archive' joins the enum.

Publish order: part of the unpublished 13 Sep payload; one publish covers it all.
Nothing in live data changes.
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def mutate(rules: dict) -> None:
    assert "routeVersions" in rules, "run 2026-09-13-route-versions.py first"
    route = rules["routes"]["$routeId"]
    assert "data.child('status').val() == 'draft'" not in route[".write"], "mutation applied before"
    route[".write"] += " && (newData.exists() || data.child('status').val() == 'draft')"
    route[".validate"] += (
        " && (!data.exists() || data.child('status').val() == 'draft' || newData.child('status').val() != 'draft')"
        " && (!data.child('publishedVersion').exists() || newData.child('publishedVersion').exists())"
    )

    audit = rules["audit"]["$id"]
    old = "newData.child('action').val() == 'route.delete'"
    assert old in audit[".validate"] and "'route.archive'" not in audit[".validate"]
    audit[".validate"] = audit[".validate"].replace(old, old + " || newData.child('action').val() == 'route.archive'")


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
