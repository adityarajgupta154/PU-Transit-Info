#!/usr/bin/env python3
"""Add the root administrator's driver capability to both Rules mirrors.

Run from the repository root:
  python3 scripts/rules-mutations/2026-09-14-owner-driver.py

The mutation has one canonical input (the pre-feature Rules payload) and one
canonical output. Once that output is present, applying the mutation is a
verified no-op.
"""

import json
from pathlib import Path


HERE = Path(__file__).resolve().parent
ROOT_UID = "hqKU3amnTzVBT3yF3p4DMRnirDq1"
MEMBER_ROLE = "root.child('memberships').child(auth.uid).child('role').val()"
DRIVER_CAPABILITY = (
    f"({MEMBER_ROLE} == 'driver' || "
    f"({MEMBER_ROLE} == 'admin' && auth.uid == '{ROOT_UID}'))"
)


def replace_once(value: str, old: str, new: str, label: str) -> str:
    count = value.count(old)
    assert count == 1, f"{label}: expected exactly one canonical match, found {count}"
    return value.replace(old, new)


def canonical_fragments() -> dict[str, str]:
    member_shape = (
        "(newData.child('role').val() != 'driver' && "
        "newData.child('assignedBusId').val() == '') || "
        "(newData.child('role').val() == 'driver' && "
        "(newData.child('active').val() == false || "
        "newData.child('assignedBusId').val().length > 0))"
    )
    root_shape = (
        "((newData.child('role').val() != 'driver' && "
        "(newData.child('assignedBusId').val() == '' || "
        f"(newData.child('role').val() == 'admin' && $uid == '{ROOT_UID}'))) || "
        "(newData.child('role').val() == 'driver' && "
        "(newData.child('active').val() == false || "
        "newData.child('assignedBusId').val().length > 0)))"
    )
    self_expiry = (
        "(auth.uid != $uid || (newData.child('role').val() == 'admin' && "
        "newData.child('status').val() == 'approved' && "
        "newData.child('active').val() == true && "
        "(!newData.child('expiresAt').exists() || "
        "newData.child('expiresAt').val() > now)))"
    )
    root_never_expires = (
        "(auth.uid != $uid || (newData.child('role').val() == 'admin' && "
        "newData.child('status').val() == 'approved' && "
        "newData.child('active').val() == true && "
        "(!newData.child('expiresAt').exists() || "
        "newData.child('expiresAt').val() > now) && "
        f"($uid != '{ROOT_UID}' || !newData.child('expiresAt').exists())))"
    )
    assignment_expiry = (
        "(!root.child('memberships').child(auth.uid).child('expiresAt').exists() || "
        "root.child('memberships').child(auth.uid).child('expiresAt').val() > now)"
    )
    assignment_root_guard = (
        f"($uid != '{ROOT_UID}' || auth.uid == '{ROOT_UID}')"
    )
    return {
        "member_shape": member_shape,
        "wrapped_member_shape": f"({member_shape})",
        "root_shape": root_shape,
        "self_expiry": self_expiry,
        "root_never_expires": root_never_expires,
        "assignment_expiry": assignment_expiry,
        "assignment_root_guard": assignment_root_guard,
        "target_role": "root.child('memberships').child($uid).child('role').val() == 'driver'",
        "target_capability": (
            " (root.child('memberships').child($uid).child('role').val() == 'driver' || "
            f"(root.child('memberships').child($uid).child('role').val() == 'admin' && "
            f"$uid == '{ROOT_UID}'))"
        ).lstrip(),
    }


def assert_current(rules: dict) -> None:
    fragments = canonical_fragments()
    memberships = rules["memberships"]["$uid"]
    tracking = rules["tracking"]["$busId"]
    assignments = rules["assignments"]
    assignment = assignments["$uid"]["$assignmentId"]

    assert tracking[".read"].count(DRIVER_CAPABILITY) == 1
    assert tracking[".write"].count(DRIVER_CAPABILITY) == 1
    assert assignments["$uid"][".read"].count(DRIVER_CAPABILITY) == 1
    assert memberships[".validate"].count(fragments["root_shape"]) == 1
    assert memberships[".write"].count(fragments["root_never_expires"]) == 1
    assert assignment[".validate"].count(fragments["target_capability"]) == 1
    assert assignment[".write"].count(
        f"{fragments['assignment_expiry']} && {fragments['assignment_root_guard']}"
    ) == 1


def mutate(rules: dict) -> None:
    fragments = canonical_fragments()
    memberships = rules["memberships"]["$uid"]
    tracking = rules["tracking"]["$busId"]
    assignments = rules["assignments"]
    assignment = assignments["$uid"]["$assignmentId"]

    if DRIVER_CAPABILITY in tracking[".read"]:
        assert_current(rules)
        return

    role_with_gate = (
        f"{MEMBER_ROLE} == 'driver' && "
        "root.child('memberships').child(auth.uid).child('status').val() == 'approved'"
    )
    capability_with_gate = (
        f"{DRIVER_CAPABILITY} && "
        "root.child('memberships').child(auth.uid).child('status').val() == 'approved'"
    )
    tracking[".read"] = replace_once(
        tracking[".read"], role_with_gate, capability_with_gate, "tracking read"
    )
    tracking[".write"] = replace_once(
        tracking[".write"], role_with_gate, capability_with_gate, "tracking write"
    )
    assignments["$uid"][".read"] = replace_once(
        assignments["$uid"][".read"],
        role_with_gate,
        capability_with_gate,
        "assignment read",
    )
    assignment[".validate"] = replace_once(
        assignment[".validate"],
        fragments["target_role"],
        fragments["target_capability"],
        "assignment target role",
    )
    assignment[".write"] = replace_once(
        assignment[".write"],
        fragments["assignment_expiry"],
        f"{fragments['assignment_expiry']} && {fragments['assignment_root_guard']}",
        "assignment root protection",
    )
    memberships[".validate"] = replace_once(
        memberships[".validate"],
        fragments["wrapped_member_shape"],
        fragments["root_shape"],
        "root membership shape",
    )
    memberships[".write"] = replace_once(
        memberships[".write"],
        fragments["self_expiry"],
        fragments["root_never_expires"],
        "root expiry protection",
    )
    assert_current(rules)


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