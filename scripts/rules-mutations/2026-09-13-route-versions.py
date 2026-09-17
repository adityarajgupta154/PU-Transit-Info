#!/usr/bin/env python3
"""Rules mutation, 13 Sep 2026: route versions and publishing (RTE-02 / ADM-03, AC-19).

Applies on top of 2026-09-13-route-publish.py (run that first; this script asserts
the status field exists and that it has not run before).  Edits both Rules copies
in one pass.  Run from the repo root:  python3 scripts/rules-mutations/2026-09-13-route-versions.py

Changes
- routes/$routeId gains publishedVersion (positive integer, never decreases) and
  status may also be 'archived' (hidden from riders; RTE-03 adds the action).
- routeVersions/$routeId/$n: immutable snapshot of the rider-visible content,
  written once at publish (admin, create-only, createdAt == now, createdBy ==
  auth.uid), readable by every active member.  Trips pin these numbers.
- routeDrafts/$routeId: pending edits of a published route.  Admin read/write,
  same content validation as routes, status must be 'draft'.  Riders never read it.
- tracking/$busId/feed/routeVersions/$routeId: version pinned at Start (must equal the route's current publishedVersion for this bus).  Settable
  only by the Start write (sequence 0, active, new generation); afterwards every
  write must keep it, so a republish mid-trip cannot change what riders follow.

Publish order: with the 13 Sep payload (access model, bus registry, route publish);
one publish covers all four.  Nothing in live data changes: existing published
routes have no version until the next publish, and the API keeps the edit lock
for exactly those.
"""

import copy
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent

VERSION_KEYS = ["n", "shift", "busNumber", "origin", "destination", "createdAt", "createdBy"]
CONTENT_FIELDS = ["shift", "busNumber", "origin", "destination", "stops", "pathData", "kind", "pathSource"]


def mutate(rules: dict) -> None:
    route = rules["routes"]["$routeId"]
    assert "status" in route, "run 2026-09-13-route-publish.py first"
    assert "routeVersions" not in rules and "publishedVersion" not in route, "mutation applied before"
    uuid_match = re.search(r"\$routeId\.matches\((/[^)]*/)\)", route[".write"])
    assert uuid_match, "route id regex missing"
    uuid = uuid_match.group(1)

    # Content checks shared with versions and drafts: shift .. pathData, then pathSource.
    validate = route[".validate"]
    start = validate.index("newData.child('shift').isString()")
    end = validate.index(" && newData.child('status').isString()")
    content_validate = (
        validate[start:end]
        + " && (!newData.child('pathSource').exists() || newData.child('pathSource').val() == 'ors'"
        + " || newData.child('pathSource').val() == 'manual')"
    )
    content_children = {field: copy.deepcopy(route[field]) for field in CONTENT_FIELDS}

    # routeDrafts: the node as it validates today, restricted to drafts, admin-only.
    draft = copy.deepcopy(route)
    draft[".read"] = route[".write"]
    draft[".validate"] = validate + " && newData.child('status').val() == 'draft'"
    rules["routeDrafts"] = {".read": rules["audit"][".read"], "$routeId": draft}

    # routes: archived status + publishedVersion.
    statuses = "(newData.child('status').val() == 'draft' || newData.child('status').val() == 'published')"
    assert validate.count(statuses) == 1, "route status clause missing"
    route[".validate"] = validate.replace(statuses, statuses[:-1] + " || newData.child('status').val() == 'archived')")
    route["status"] = {
        ".validate": "newData.isString() && (newData.val() == 'draft' || newData.val() == 'published' || newData.val() == 'archived')"
    }
    other = route.pop("$other")
    route["publishedVersion"] = {
        ".validate": "newData.isNumber() && newData.val() >= 1 && newData.val() % 1 == 0 && (!data.exists() || newData.val() >= data.val())"
    }
    route["$other"] = other

    # routeVersions: create-only snapshots, member-readable.
    rules["routeVersions"] = {
        "$routeId": {
            ".read": route[".read"],
            "$n": {
                ".write": route[".write"] + " && !data.exists()",
                ".validate": (
                    "$n.matches(/^[1-9][0-9]*$/) && newData.hasChildren(" + json.dumps(VERSION_KEYS).replace('"', "'") + ")"
                    " && newData.child('n').isNumber() && newData.child('n').val() >= 1 && newData.child('n').val() % 1 == 0"
                    " && newData.child('createdAt').isNumber() && newData.child('createdAt').val() == now"
                    " && newData.child('createdBy').isString() && newData.child('createdBy').val() == auth.uid && "
                    + content_validate
                ),
                "n": {".validate": True},
                **content_children,
                "createdAt": {".validate": True},
                "createdBy": {".validate": True},
                "$other": {".validate": False},
            },
        }
    }

    # tracking feed: pinned versions, Start-only.
    feed = rules["tracking"]["$busId"]["feed"]
    feed_validate = feed.pop(".validate")
    feed_other = feed.pop("$other")
    # A pin is either unchanged, or written by Start (first node, or a new generation at
    # sequence 0) and equal to what the route publishes right now for this very bus.
    route = "root.child('routes/' + $routeId)"
    start = (
        "(!data.parent().parent().exists()"
        " || (newData.parent().parent().child('phase').val() == 'active'"
        " && newData.parent().parent().parent().child('sequence').val() == 0"
        " && newData.parent().parent().child('generation').val() > data.parent().parent().child('generation').val()))"
    )
    feed["routeVersions"] = {
        "$routeId": {
            ".validate": (
                f"$routeId.matches({uuid}) && newData.isNumber() && newData.val() >= 1 && newData.val() % 1 == 0"
                f" && (({start} && {route}.child('busNumber').val() == $busId"
                f" && {route}.child('status').val() == 'published'"
                f" && {route}.child('publishedVersion').val() == newData.val())"
                f" || (!{start} && data.exists() && newData.val() == data.val()))"
            )
        }
    }
    # After Start the map cannot change (above), grow (above), or be dropped whole (here).
    # Rules cannot count children, so removing a single key is left to the API, which never does it.
    feed[".validate"] = (
        feed_validate
        + " && (newData.parent().child('sequence').val() == 0"
        " || !data.child('routeVersions').exists() || newData.child('routeVersions').exists())"
    )
    feed["$other"] = feed_other


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
