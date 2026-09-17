#!/usr/bin/env python3
"""Rules mutation, 13 Sep 2026: dated assignments (ASG-01 / ADM-05).

Applies on top of 2026-09-13-route-archive.py (run the 13 Sep scripts in order:
route-versions -> route-archive -> this).  Edits both Rules copies in one pass.
Run from the repo root:  python3 scripts/rules-mutations/2026-09-13-assignments.py

Changes
- assignments/$uid/$assignmentId (new): admin-written, read by that driver or an
  admin.  Key = serviceDate_shiftKey_busId.  The record must name an approved
  driver's own uid and email, a registered bus, a non-draft, non-archived route of
  that bus whose shift matches, and one IST calendar day (startsAt is an IST midnight,
  endsAt = startsAt + 24h).  The cross-driver conflict check stays in the API: Rules
  cannot scan other drivers' subtrees.
- tracking/$busId .read: any approved, active driver (was: the standing driver only).
  The API reads the node with the driver's token before a Start on an override bus;
  the feed was member-readable already and the extra fields (driverUid, publisherId,
  sequence) grant nothing because driver writes still require driverUid == auth.uid.
- tracking/$busId .write driver branch: the standing bus OR a dated assignment named
  in feed.assignmentId that belongs to the caller and to this bus.  A Start (new node,
  or generation bump with sequence 0) needs the assignment's day to cover now; every
  later write must carry the same assignmentId, so a trip that crosses midnight can
  keep reporting and end.  A tombstone end without a node carries no assignmentId,
  so an override driver cannot write one (documented edge; the API's end returns the
  same 403 it always did for an unassigned bus).
- tracking/$busId/feed/assignmentId (new): a key-shaped string, frozen after Start
  like routeVersions.
- audit actions 'assignment.save' and 'assignment.delete' join the enum.

Publish order: part of the unpublished 13 Sep payload; one publish covers it all.
Nothing in live data changes.
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

KEY = r"/^\d{4}-\d{2}-\d{2}_[a-z0-9]{1,40}_[A-Z0-9]{2,20}$/"
DATE = r"/^\d{4}-\d{2}-\d{2}$/"
UUID = r"/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/"
DAY_MS = 86400000
IST_MIDNIGHT_MOD = 66600000  # (24h - 5h30m) in ms: an IST midnight expressed as UTC epoch mod one day

# "This write opens a trip": a fresh node, or a generation bump with the sequence reset.
START = (
    "(!data.exists() || (newData.child('feed').child('phase').val() == 'active'"
    " && newData.child('sequence').val() == 0"
    " && newData.child('feed').child('generation').val() > data.child('feed').child('generation').val()))"
)
FEED_START = (
    "(!data.parent().parent().exists() || (newData.parent().child('phase').val() == 'active'"
    " && newData.parent().parent().child('sequence').val() == 0"
    " && newData.parent().child('generation').val() > data.parent().child('generation').val()))"
)


def mutate(rules: dict) -> None:
    assert "assignments" not in rules, "mutation applied before"
    assert "'route.archive'" in rules["audit"]["$id"][".validate"], "run 2026-09-13-route-archive.py first"

    admin = rules["routeDrafts"][".read"]  # approved, active admin with a matching membership record
    assert "== 'admin'" in admin and "$routeId" not in admin and "$uid" not in admin
    driver_self = admin.replace("== 'admin'", "== 'driver'") + " && auth.uid == $uid"

    assignment = "root.child('assignments').child(auth.uid).child(newData.child('feed').child('assignmentId').val())"
    route = "root.child('routes').child(newData.child('routeId').val())"
    member = "root.child('memberships').child($uid)"
    rules["assignments"] = {
        ".read": admin,
        "$uid": {
            ".read": f"({driver_self}) || ({admin})",
            "$assignmentId": {
                ".write": admin,
                ".validate": (
                    f"$assignmentId.matches({KEY})"
                    " && newData.hasChildren(['id', 'driverUid', 'driverEmail', 'busId', 'routeId', 'shift', 'serviceDate', 'startsAt', 'endsAt', 'createdAt', 'createdBy'])"
                    " && newData.child('id').val() == $assignmentId"
                    " && newData.child('driverUid').val() == $uid"
                    f" && {member}.child('role').val() == 'driver'"
                    f" && newData.child('driverEmail').val() == {member}.child('email').val()"
                    " && newData.child('busId').isString() && newData.child('busId').val().matches(/^[A-Z0-9]{2,20}$/)"
                    " && root.child('buses').child(newData.child('busId').val()).exists()"
                    " && $assignmentId.endsWith('_' + newData.child('busId').val())"
                    f" && newData.child('routeId').isString() && newData.child('routeId').val().matches({UUID})"
                    f" && {route}.child('busNumber').val() == newData.child('busId').val()"
                    f" && {route}.child('status').val() != 'draft' && {route}.child('status').val() != 'archived'"
                    f" && newData.child('shift').isString() && newData.child('shift').val() == {route}.child('shift').val()"
                    f" && newData.child('serviceDate').isString() && newData.child('serviceDate').val().matches({DATE})"
                    " && $assignmentId.beginsWith(newData.child('serviceDate').val() + '_')"
                    f" && newData.child('startsAt').isNumber() && newData.child('startsAt').val() % {DAY_MS} == {IST_MIDNIGHT_MOD}"
                    f" && newData.child('endsAt').val() == newData.child('startsAt').val() + {DAY_MS}"
                    " && (!newData.child('routeVersion').exists() || (newData.child('routeVersion').isNumber() && newData.child('routeVersion').val() >= 1 && newData.child('routeVersion').val() % 1 == 0))"
                    " && newData.child('createdAt').isNumber() && newData.child('createdBy').val() == auth.uid"
                ),
                **{
                    field: {".validate": True}
                    for field in (
                        "id", "driverUid", "driverEmail", "busId", "routeId", "routeVersion",
                        "shift", "serviceDate", "startsAt", "endsAt", "createdAt", "createdBy",
                    )
                },
                "$other": {".validate": False},
            },
        },
    }

    node = rules["tracking"]["$busId"]
    standing = "root.child('memberships').child(auth.uid).child('assignedBusId').val() == $busId"
    assert node[".read"].endswith(" && " + standing)
    node[".read"] = node[".read"][: -len(" && " + standing)]

    old_branch = f"{standing} && newData.child('driverUid').val() == auth.uid"
    assert node[".write"].count(old_branch) == 1
    override = (
        f"({standing} || (newData.child('feed').child('assignmentId').isString()"
        f" && {assignment}.child('busId').val() == $busId"
        f" && (({START} && {assignment}.child('startsAt').val() <= now && now < {assignment}.child('endsAt').val())"
        f" || (!{START} && data.child('feed').child('assignmentId').val() == newData.child('feed').child('assignmentId').val()"
        f" && now < {assignment}.child('endsAt').val() + 86400000))))"
    )
    node[".write"] = node[".write"].replace(old_branch, f"{override} && newData.child('driverUid').val() == auth.uid")

    feed = node["feed"]
    assert "assignmentId" not in feed and "$other" in feed
    other = feed.pop("$other")
    feed["assignmentId"] = {
        ".validate": f"newData.isString() && newData.val().matches({KEY}) && ({FEED_START} || newData.val() == data.val())",
    }
    feed["$other"] = other

    audit = rules["audit"]["$id"]
    old = "newData.child('action').val() == 'bus.reactivate'"
    assert old in audit[".validate"] and "'assignment.save'" not in audit[".validate"]
    audit[".validate"] = audit[".validate"].replace(
        old,
        old + " || newData.child('action').val() == 'assignment.save' || newData.child('action').val() == 'assignment.delete'",
    )


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
