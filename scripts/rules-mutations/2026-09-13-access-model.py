#!/usr/bin/env python3
"""Rules mutation, 13 Sep 2026: new access model + add-ons.

Edits firebase/database.rules.json and the public copy in one pass so both stay
byte-identical.  Run from the repo root:  python3 scripts/rules-mutations/2026-09-13-access-model.py

Changes
- memberships: self-create is an approved active student/staff record (no more
  pending); personal (non-university) emails may only be students; `requestedRole`
  (driver|admin) queues a role request for the admin panel; a member may sync the
  record email to a new verified university email; the root admin record can only
  be edited by the root admin.
- member read predicate (routes, feeds, notices): university email OR a student
  created less than GRACE_MS ago (personal-email grace period); staff role added.
- notices node (admin write, member read, per-route or global, expiry).
- routes/$routeId/kind (bus|shuttle), tracking feed direction + full.
- audit action enum gains notice.save / notice.delete.
"""
import json
from pathlib import Path

ROOT_ADMIN_UID = "hqKU3amnTzVBT3yF3p4DMRnirDq1"
GRACE_MS = 30 * 24 * 60 * 60 * 1000  # personal-email grace; mirrored in the API (PERSONAL_EMAIL_GRACE_MS)
CREATE_SKEW_MS = 5 * 60 * 1000  # createdAt must be the server timestamp (grace depends on it)
NOTICE_MAX_MS = 30 * 24 * 60 * 60 * 1000  # a notice may not run longer than 30 days
UUID = r"/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/"
DOMAIN_RE = r"/^[^@]+@paruluniversity\.ac\.in$/"

D = f"auth.token.email.matches({DOMAIN_RE})"
V = "auth != null && auth.token.email_verified == true"


def M(field: str) -> str:
    return f"root.child('memberships').child(auth.uid).child('{field}').val()"


SELF = f"{M('uid')} == auth.uid && {M('email')} == auth.token.email"
APPROVED = f"{M('status')} == 'approved' && {M('active')} == true"
ADMIN = f"{V} && {D} && {SELF} && {M('role')} == 'admin' && {APPROVED}"
GRACE = f"({D} || ({M('role')} == 'student' && {M('createdAt')} + {GRACE_MS} > now))"
OLD_ROLES = f"({M('role')} == 'student' || {M('role')} == 'driver' || {M('role')} == 'admin')"
NEW_ROLES = f"({M('role')} == 'student' || {M('role')} == 'staff' || {M('role')} == 'driver' || {M('role')} == 'admin')"
MEMBER = f"{V} && {GRACE} && {SELF} && {NEW_ROLES} && {APPROVED}"


def nd(field: str) -> str:
    return f"newData.child('{field}').val()"


def od(field: str) -> str:
    return f"data.child('{field}').val()"


CREATE = (
    "(!data.exists() && auth.uid == $uid"
    f" && {nd('uid')} == auth.uid && {nd('email')} == auth.token.email"
    f" && ({nd('role')} == 'student' || {nd('role')} == 'staff')"
    f" && {nd('status')} == 'approved' && {nd('active')} == true && {nd('assignedBusId')} == ''"
    f" && {nd('createdAt')} >= now - {CREATE_SKEW_MS} && {nd('createdAt')} <= now + {CREATE_SKEW_MS})"
)
EMAIL_SYNC = (
    f"(data.exists() && auth.uid == $uid && {od('uid')} == $uid && {D}"
    f" && {nd('email')} == auth.token.email"
    + "".join(
        f" && {nd(f)} == {od(f)}"
        for f in ("uid", "role", "status", "active", "assignedBusId", "requestedRole", "createdAt")
    )
    + ")"
)
ADMIN_UPDATE = (
    f"(data.exists() && {ADMIN}"
    f" && {nd('uid')} == {od('uid')} && {nd('email')} == {od('email')} && {nd('createdAt')} == {od('createdAt')}"
    f" && (auth.uid != $uid || ({nd('role')} == 'admin' && {nd('status')} == 'approved' && {nd('active')} == true))"
    f" && ($uid != '{ROOT_ADMIN_UID}' || auth.uid == '{ROOT_ADMIN_UID}'))"
)
MEMBER_FIELDS = ["uid", "email", "role", "status", "active", "assignedBusId", "createdAt", "updatedAt"]
MEMBER_VALIDATE = (
    f"newData.exists() && newData.hasChildren({json.dumps(MEMBER_FIELDS).replace(chr(34), chr(39))})"
    f" && newData.child('uid').isString() && {nd('uid')} == $uid"
    f" && newData.child('email').isString()"
    f" && newData.child('role').isString() && ({nd('role')} == 'student' || {nd('role')} == 'staff' || {nd('role')} == 'driver' || {nd('role')} == 'admin')"
    f" && newData.child('status').isString() && ({nd('status')} == 'pending' || {nd('status')} == 'approved' || {nd('status')} == 'rejected' || {nd('status')} == 'suspended')"
    f" && newData.child('active').isBoolean() && ({nd('status')} == 'approved' || {nd('active')} == false)"
    f" && newData.child('assignedBusId').isString()"
    f" && (({nd('role')} != 'driver' && {nd('assignedBusId')} == '') || ({nd('role')} == 'driver' && ({nd('active')} == false || {nd('assignedBusId')}.length > 0)))"
    f" && newData.child('createdAt').isNumber() && newData.child('updatedAt').isNumber()"
    f" && (!newData.child('requestedRole').exists() || (newData.child('requestedRole').isString() && ({nd('requestedRole')} == 'driver' || {nd('requestedRole')} == 'admin')))"
    f" && ({nd('email')}.matches({DOMAIN_RE}) || ({nd('role')} == 'student' && !newData.child('requestedRole').exists()))"
)

NEW_SEQUENCE = "newData.parent().child('sequence').val()"
OLD_SEQUENCE = "data.parent().child('sequence').val()"
NEW_START = (
    f"newData.child('phase').val() == 'active' && {NEW_SEQUENCE} == 0 && "
    "(!data.exists() || newData.child('generation').val() > data.child('generation').val())"
)
NEW_TOMBSTONE = (
    f"newData.child('phase').val() == 'ended' && {NEW_SEQUENCE} == 0 && "
    "(!data.exists() || newData.child('generation').val() > data.child('generation').val())"
)
STATE_INTEGRITY = (
    f"(({NEW_TOMBSTONE} && !newData.child('direction').exists()) || "
    f"(!({NEW_TOMBSTONE}) && (({NEW_START}) || "
    "(!data.child('direction').exists()) || "
    "(data.child('direction').exists() && newData.child('direction').exists() && "
    "newData.child('direction').val() == data.child('direction').val()))))"
    " && "
    f"(({NEW_TOMBSTONE} && !newData.child('full').exists()) || "
    f"({NEW_START} && !newData.child('full').exists()) || "
    f"(!({NEW_TOMBSTONE}) && !({NEW_START}) && ("
    "(!data.child('full').exists() && !newData.child('full').exists()) || "
    "(!data.child('full').exists() && newData.child('phase').val() == 'active' && "
    f"{NEW_SEQUENCE} > {OLD_SEQUENCE} && "
    "newData.child('full').exists()) || "
    "(data.child('full').exists() && newData.child('full').exists() && "
    "((newData.child('phase').val() == 'active' && "
    f"{NEW_SEQUENCE} > {OLD_SEQUENCE}) || "
    "(newData.child('phase').val() == 'active' && "
    f"{NEW_SEQUENCE} == {OLD_SEQUENCE} && "
    "newData.child('full').val() == data.child('full').val()) || "
    "(newData.child('phase').val() == 'ended' && "
    f"{NEW_SEQUENCE} == {OLD_SEQUENCE} && "
    "newData.child('full').val() == data.child('full').val()))))))"
)

NOTICE_FIELDS = ["id", "text", "routeId", "until", "createdBy", "createdAt"]
NOTICE_VALIDATE = (
    f"newData.hasChildren({json.dumps(NOTICE_FIELDS).replace(chr(34), chr(39))})"
    f" && newData.child('id').isString() && {nd('id')} == $noticeId"
    f" && newData.child('text').isString() && {nd('text')}.length > 0 && {nd('text')}.length <= 280"
    f" && newData.child('routeId').isString() && ({nd('routeId')} == '' || {nd('routeId')}.matches({UUID}))"
    f" && newData.child('until').isNumber() && {nd('until')} > now && {nd('until')} <= now + {NOTICE_MAX_MS}"
    f" && newData.child('createdBy').isString() && {nd('createdBy')} == auth.uid"
    f" && newData.child('createdAt').isNumber() && {nd('createdAt')} == now"
)


def whitelist(fields: list[str]) -> dict:
    node = {field: {".validate": True} for field in fields}
    node["$other"] = {".validate": False}
    return node


def to_member_predicate(rule: str) -> str:
    if D in rule and GRACE not in rule:
        rule = rule.replace(D, GRACE, 1)
    if OLD_ROLES in rule and NEW_ROLES not in rule:
        rule = rule.replace(OLD_ROLES, NEW_ROLES, 1)
    return rule


def mutate(rules: dict) -> None:
    member_children = whitelist(MEMBER_FIELDS + ["requestedRole"])
    member_children["role"] = {
        ".validate": "!newData.parent().child('requestedRole').exists() || newData.val() == 'student'"
    }
    member_children["requestedRole"] = {
        ".validate": "!newData.exists() || newData.parent().child('role').val() == 'student'"
    }
    rules["memberships"] = {
        ".read": ADMIN,
        "$uid": {
            ".read": f"{V} && auth.uid == $uid && (!data.exists() || {od('uid')} == $uid)",
            ".write": f"{V} && newData.exists() && ({CREATE} || {EMAIL_SYNC} || {ADMIN_UPDATE})",
            ".validate": MEMBER_VALIDATE,
            **member_children,
        },
    }

    routes = rules["routes"]
    routes[".read"] = to_member_predicate(routes[".read"])
    route = routes["$routeId"]
    route[".read"] = to_member_predicate(route[".read"])
    kind = {".validate": "newData.isString() && (newData.val() == 'bus' || newData.val() == 'shuttle')"}
    other = route.pop("$other", {".validate": False})
    route["kind"] = kind
    route["$other"] = other

    feed = rules["tracking"]["$busId"]["feed"]
    feed[".read"] = to_member_predicate(feed[".read"])
    feed[".validate"] = STATE_INTEGRITY
    other = feed.pop("$other", {".validate": False})
    feed["direction"] = {
        ".validate": (
            "newData.isString() && (newData.val() == 'toCampus' || newData.val() == 'fromCampus')"
            " && (!data.parent().exists() || "
            "(newData.parent().child('phase').val() == 'active' && "
            "newData.parent().parent().child('sequence').val() == 0 && "
            "newData.parent().child('generation').val() > data.parent().child('generation').val()) || "
            "(newData.parent().child('phase').val() == 'active' && "
            "newData.parent().parent().child('sequence').val() > data.parent().parent().child('sequence').val() && "
            "!data.exists()) || (data.exists() && newData.val() == data.val()))"
        )
    }
    feed["full"] = {".validate": "newData.isBoolean()"}
    feed["$other"] = other

    audit = rules["audit"]["$id"]
    old_actions = "newData.child('action').val() == 'route.delete')"
    if old_actions in audit[".validate"]:
        audit[".validate"] = audit[".validate"].replace(
            old_actions,
            "newData.child('action').val() == 'route.delete' || newData.child('action').val() == 'notice.save' || newData.child('action').val() == 'notice.delete')",
            1,
        )

    rules["notices"] = {
        ".read": MEMBER,
        "$noticeId": {
            ".write": f"{ADMIN} && $noticeId.matches({UUID}) && (!newData.exists() || !data.exists())",
            ".validate": NOTICE_VALIDATE,
            **whitelist(NOTICE_FIELDS),
        },
    }


def main() -> None:
    repo = Path(__file__).resolve().parents[2]
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
