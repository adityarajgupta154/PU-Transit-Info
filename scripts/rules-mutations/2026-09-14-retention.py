#!/usr/bin/env python3
"""Rules mutation, 14 Sep 2026: maintenance/{job} run records (SEC-05).

Applies on top of 2026-09-14-service-calendar.py.  Edits both Rules copies in
one pass.  Run from the repo root:  python3 scripts/rules-mutations/2026-09-14-retention.py

Change
- new top-level node `maintenance`: the retention job writes `maintenance/retention`
  ({lastRunAt, outcome, removed, durationMs, error?}) with the job's service
  account, which bypasses Rules.  Admins may read it; no client may write it
  (explicit `.write: false` — the job identity is the only writer by construction).

Publish order: part of the unpublished 14 Sep payload; one publish covers it all.
Nothing in live data changes.
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def mutate(rules: dict) -> None:
    assert "maintenance" not in rules
    assert "serviceCalendar" in rules, "run 2026-09-14-service-calendar.py first"
    rules["maintenance"] = {
        ".read": rules["audit"][".read"],  # the admin read gate, verbatim
        ".write": False,
    }


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
