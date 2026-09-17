#!/usr/bin/env python3
"""Rules mutation, 13 Sep 2026: bus registry (FLT-01/FLT-02).

Edits firebase/database.rules.json and the public copy in one pass so both stay
byte-identical.  Run from the repo root:  python3 scripts/rules-mutations/2026-09-13-bus-registry.py

Changes
- buses/$busId: admin write, member read, no deletes (history and audit stay);
  key = canonical registration /^[A-Z0-9]{2,20}$/ (mirrored in the API busKey and
  the web normalizeBusNumber); label 1-64, status active|out_of_service, reason
  <= 200 and empty while active, createdAt immutable.
- memberships/$uid/assignedBusId must be '' or a registered bus key; a *changed*
  assignment must point at an active bus (an unchanged one only has to exist, so a
  driver on a parked bus can still be suspended) - same rule as the API.
- routes/$routeId/busNumber must be a registered bus key.
- audit action enum gains bus.save / bus.deactivate / bus.reactivate.
- tracking/$busId: the Start branch (new node, restart after end, takeover of a
  stale trip) additionally requires buses/$busId.status == 'active' (FLT-03);
  samples, heartbeats and End of a running trip are untouched so a bus parked
  mid-trip can still be ended.

Publish order: publish these Rules, then run `pnpm --dir scripts run buses:migrate`
(report first, then --apply) so every existing reference becomes a registered key.
"""
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("access_model", HERE / "2026-09-13-access-model.py")
access_model = importlib.util.module_from_spec(spec)
spec.loader.exec_module(access_model)
ADMIN, MEMBER, nd, od, whitelist = (
    access_model.ADMIN,
    access_model.MEMBER,
    access_model.nd,
    access_model.od,
    access_model.whitelist,
)

BUS_KEY = r"/^[A-Z0-9]{2,20}$/"
BUS_FIELDS = ["busId", "label", "status", "reason", "createdAt", "updatedAt"]
BUS_VALIDATE = (
    f"newData.hasChildren({json.dumps(BUS_FIELDS).replace(chr(34), chr(39))})"
    f" && newData.child('busId').isString() && {nd('busId')} == $busId"
    f" && newData.child('label').isString() && {nd('label')}.length > 0 && {nd('label')}.length <= 64"
    f" && newData.child('status').isString() && ({nd('status')} == 'active' || {nd('status')} == 'out_of_service')"
    f" && newData.child('reason').isString() && {nd('reason')}.length <= 200"
    f" && ({nd('status')} == 'out_of_service' || {nd('reason')} == '')"
    f" && newData.child('createdAt').isNumber() && (!data.exists() || {nd('createdAt')} == {od('createdAt')})"
    f" && newData.child('updatedAt').isNumber()"
)
REGISTERED = "root.child('buses').child(newData.val()).exists()"
ACTIVE = "root.child('buses').child(newData.val()).child('status').val() == 'active'"


def mutate(rules: dict) -> None:
    rules["buses"] = {
        ".read": MEMBER,
        "$busId": {
            ".write": f"{ADMIN} && $busId.matches({BUS_KEY}) && newData.exists()",
            ".validate": BUS_VALIDATE,
            **whitelist(BUS_FIELDS),
        },
    }

    rules["memberships"]["$uid"]["assignedBusId"] = {
        ".validate": f"newData.val() == '' || (newData.val().matches({BUS_KEY}) && {REGISTERED} && (data.val() == newData.val() || {ACTIVE}))"
    }
    rules["routes"]["$routeId"]["busNumber"] = {
        ".validate": f"newData.val().matches({BUS_KEY}) && {REGISTERED}"
    }

    tracking = rules["tracking"]["$busId"]
    start_anchor = "&& newData.child('feed').child('phase').val() == 'active' && newData.child('sequence').val() == 0 &&"
    assert tracking[".validate"].count(start_anchor) == 1, "tracking Start branch anchor has moved"
    tracking[".validate"] = tracking[".validate"].replace(
        start_anchor,
        f"{start_anchor} root.child('buses').child($busId).child('status').val() == 'active' &&",
    )

    audit = rules["audit"]["$id"]
    old_actions = "newData.child('action').val() == 'notice.delete')"
    assert old_actions in audit[".validate"], "audit action enum has moved"
    audit[".validate"] = audit[".validate"].replace(
        old_actions,
        "newData.child('action').val() == 'notice.delete'"
        " || newData.child('action').val() == 'bus.save'"
        " || newData.child('action').val() == 'bus.deactivate'"
        " || newData.child('action').val() == 'bus.reactivate')",
        1,
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
    assert "buses" not in document["rules"], "buses node already present; mutation applied before"
    mutate(document["rules"])
    output = json.dumps(document, indent=2) + "\n"
    for path in paths:
        path.write_text(output)
    print(f"wrote {len(output)} bytes to {len(paths)} files")


if __name__ == "__main__":
    main()
