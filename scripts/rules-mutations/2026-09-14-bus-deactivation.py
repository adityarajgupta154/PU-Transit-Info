#!/usr/bin/env python3
"""Guard deactivation at commit time; keep both Rules mirrors identical."""

import json
from pathlib import Path


# Match liveTrip's inclusive 90-second lease, not just the active phase.
# The post-write root also sees an owner's multi-location Start + bus edit.
FEED = "newData.parent().parent().child('tracking').child($busId).child('feed')"
GUARD = (
    "(data.child('status').val() != 'active' || "
    "newData.child('status').val() != 'out_of_service' || "
    f"{FEED}.child('phase').val() != 'active' || "
    f"{FEED}.child('heartbeatAt').val() <= 0 || "
    f"{FEED}.child('heartbeatAt').val() + 90000 < now)"
)


def main() -> None:
    repo = Path(__file__).resolve().parents[2]
    paths = [
        repo / "firebase/database.rules.json",
        repo / "artifacts/pu-transit/public/firebase-database.rules.json",
    ]
    sources = [path.read_text() for path in paths]
    assert sources[0] == sources[1], "the Rules mirrors differ before mutation"
    document = json.loads(sources[0])
    bus = document["rules"]["buses"]["$busId"]
    if GUARD not in bus[".validate"]:
        bus[".validate"] += " && " + GUARD
    assert bus[".validate"].count(GUARD) == 1
    output = json.dumps(document, indent=2) + "\n"
    for path in paths:
        path.write_text(output)
    print("Bus deactivation guard applied to both Rules mirrors (not published).")


if __name__ == "__main__":
    main()