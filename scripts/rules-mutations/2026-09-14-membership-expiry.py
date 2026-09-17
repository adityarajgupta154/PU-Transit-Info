#!/usr/bin/env python3
"""Rules mutation, 14 Sep 2026: membership expiry (IDN-01 / AUTH-02).

Applies on top of 2026-09-13-handover.py (order: ... -> assignments -> handover ->
this).  Edits both Rules copies in one pass.
Run from the repo root:  python3 scripts/rules-mutations/2026-09-14-membership-expiry.py

Changes
- memberships/{uid}.expiresAt (optional, UTC ms, positive number) joins the record.
- Every gate on the caller's own membership ("approved && active", 25 places across
  memberships, routes, routeVersions, buses, tracking, assignments, notices, audit)
  also requires `!expiresAt.exists() || expiresAt > now`.  Self-read of the own
  record stays open, so the client can show the expired state.
- Only an admin may set, extend or clear it: the self-create branch may not carry
  it, the self email-sync branch must leave it unchanged, and an admin editing their
  own record may not give themself an expiry that has already passed (the API
  refuses the same three things).

Publish order: part of the unpublished 13/14 Sep payload; one publish covers it all.
Nothing in live data changes (no record has expiresAt until an admin sets one).
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

ME = "root.child('memberships').child(auth.uid)"
GATE = f"{ME}.child('status').val() == 'approved' && {ME}.child('active').val() == true"
UNEXPIRED = f"(!{ME}.child('expiresAt').exists() || {ME}.child('expiresAt').val() > now)"


def add_expiry_to_gates(node, counter: list) -> None:
    """Append the expiry clause after every caller gate, whatever key it sits under."""
    if isinstance(node, dict):
        for key, value in node.items():
            if isinstance(value, str) and GATE in value:
                counter[0] += value.count(GATE)
                node[key] = value.replace(GATE, f"{GATE} && {UNEXPIRED}")
            else:
                add_expiry_to_gates(value, counter)


def mutate(rules: dict) -> None:
    member = rules["memberships"]["$uid"]
    assert "'tracking.handover'" in rules["audit"]["$id"][".validate"], "run 2026-09-13-handover.py first"
    assert "expiresAt" not in json.dumps(rules), "already applied"

    counter = [0]
    add_expiry_to_gates(rules, counter)
    assert counter[0] == 25, f"expected 25 caller gates, found {counter[0]}"

    write = member[".write"]
    # self-create: no expiry on a fresh record
    old = "newData.child('assignedBusId').val() == '' && newData.child('createdAt').val() >= now - 300000"
    assert write.count(old) == 1
    write = write.replace(old, "newData.child('assignedBusId').val() == '' && !newData.child('expiresAt').exists() && newData.child('createdAt').val() >= now - 300000")
    # self email-sync: expiry unchanged (null == null when absent on both sides)
    old = "newData.child('requestedRole').val() == data.child('requestedRole').val() && newData.child('createdAt').val() == data.child('createdAt').val())"
    assert write.count(old) == 1
    write = write.replace(old, old[:-1] + " && newData.child('expiresAt').val() == data.child('expiresAt').val())")
    # admin editing their own record: cannot lock themself out with a past expiry
    old = "(auth.uid != $uid || (newData.child('role').val() == 'admin' && newData.child('status').val() == 'approved' && newData.child('active').val() == true))"
    assert write.count(old) == 1
    write = write.replace(old, old[:-2] + " && (!newData.child('expiresAt').exists() || newData.child('expiresAt').val() > now)))")
    member[".write"] = write

    # the field itself, kept ahead of the catch-all
    other = member.pop("$other")
    # same domain as the API: whole milliseconds, at most JavaScript Date's maximum (below 2^53)
    member["expiresAt"] = {".validate": "newData.isNumber() && newData.val() > 0 && newData.val() % 1 == 0 && newData.val() <= 8640000000000000"}
    member["$other"] = other


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
