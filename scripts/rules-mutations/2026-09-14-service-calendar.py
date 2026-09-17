#!/usr/bin/env python3
"""Rules mutation, 14 Sep 2026: admin-managed service calendar (STU-04b / STU-04).

Applies on top of 2026-09-14-membership-expiry.py (order: ... -> handover ->
membership-expiry -> this).  Edits both Rules copies in one pass.
Run from the repo root:  python3 scripts/rules-mutations/2026-09-14-service-calendar.py

Changes
- New node serviceCalendar/{yyyy-mm-dd}: `date` (== key), `noService: true`, optional
  `note` (1-140 chars), `updatedBy` (== caller), `updatedAt` (== now).  Read: any
  approved, active, unexpired member (same gate as notices).  Write: admin only;
  re-writes are allowed (the office corrects a note or removes a day).
- audit action enum gains calendar.save / calendar.delete.

A day is "no service" only when an entry exists; without one the clients keep the
plain states and never infer a holiday.  Nothing in live data changes.
Publish order: part of the unpublished 13/14 Sep payload; one publish covers it all.
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

DATE_KEY = "/^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/"  # mirrored in the API (SERVICE_DATE)
NOTE_MAX = 140  # mirrored in the API (SERVICE_NOTE_MAX)


def mutate(rules: dict) -> None:
    notices = rules["notices"]
    notice = notices["$noticeId"]
    # the notices write gate minus its uuid key check and its never-edit clause
    tail = " && $noticeId.matches("
    assert notice[".write"].count(tail) == 1
    admin_gate = notice[".write"].split(tail)[0]

    assert "serviceCalendar" not in rules
    rules["serviceCalendar"] = {
        ".read": notices[".read"],
        "$date": {
            ".write": f"{admin_gate} && $date.matches({DATE_KEY})",
            ".validate": (
                "newData.hasChildren(['date', 'noService', 'updatedBy', 'updatedAt'])"
                " && newData.child('date').isString() && newData.child('date').val() == $date"
                " && newData.child('noService').isBoolean() && newData.child('noService').val() == true"
                " && (!newData.child('note').exists() || (newData.child('note').isString()"
                f" && newData.child('note').val().length > 0 && newData.child('note').val().length <= {NOTE_MAX}))"
                " && newData.child('updatedBy').isString() && newData.child('updatedBy').val() == auth.uid"
                " && newData.child('updatedAt').isNumber() && newData.child('updatedAt').val() == now"
            ),
            "date": {".validate": True},
            "noService": {".validate": True},
            "note": {".validate": True},
            "updatedBy": {".validate": True},
            "updatedAt": {".validate": True},
            "$other": {".validate": False},
        },
    }

    validate = rules["audit"]["$id"][".validate"]
    old = "newData.child('action').val() == 'assignment.delete')"
    assert validate.count(old) == 1
    rules["audit"]["$id"][".validate"] = validate.replace(
        old,
        "newData.child('action').val() == 'assignment.delete' || newData.child('action').val() == 'calendar.save' || newData.child('action').val() == 'calendar.delete')",
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
