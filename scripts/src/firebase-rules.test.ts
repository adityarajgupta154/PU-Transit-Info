import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

const PROJECT_ID = "demo-pu-transit";
const ADMIN_UID = "admin-test-user";
const ADMIN_EMAIL = "admin-test@paruluniversity.ac.in";
const ROOT_UID = "hqKU3amnTzVBT3yF3p4DMRnirDq1";
const ROOT_EMAIL = "root-test@paruluniversity.ac.in";
const STUDENT_UID = "student-test-user";
const STUDENT_EMAIL = "student-test@paruluniversity.ac.in";
const DRIVER_UID = "driver-test-user";
const DRIVER_EMAIL = "driver-test@paruluniversity.ac.in";
const SECOND_DRIVER_UID = "second-driver-test-user";
const SECOND_DRIVER_EMAIL = "second-driver-test@paruluniversity.ac.in";
const PENDING_UID = "pending-test-user";
const PENDING_EMAIL = "pending-test@paruluniversity.ac.in";
const INACTIVE_UID = "inactive-test-user";
const INACTIVE_EMAIL = "inactive-test@paruluniversity.ac.in";
const SUSPENDED_UID = "suspended-test-user";
const SUSPENDED_EMAIL = "suspended-test@paruluniversity.ac.in";
const EXPIRED_UID = "expired-test-user"; // IDN-01: approved and active, but expiresAt has passed
const EXPIRED_EMAIL = "expired-test@paruluniversity.ac.in";
const EXPIRED_DRIVER_UID = "expired-driver-test-user";
const EXPIRED_DRIVER_EMAIL = "expired-driver-test@paruluniversity.ac.in";
const BUS_ID = "BUS1"; // registered canonical key; tracking and assignments reference it
const PARKED_BUS_ID = "BUS2";
const ROUTE_ID = "11111111-1111-4111-8111-111111111111";

type Membership = {
  uid: string;
  email: string;
  role: "student" | "driver" | "admin";
  status: "pending" | "approved" | "rejected" | "suspended";
  active: boolean;
  assignedBusId: string;
  expiresAt?: number;
  createdAt: number;
  updatedAt: number;
};

type Fixture = {
  memberships: Record<string, Membership>;
  routes: Record<string, unknown>;
  buses: Record<string, unknown>;
};

const bus = (busId: string, status: "active" | "out_of_service" = "active", reason = "") => ({
  busId,
  label: busId,
  status,
  reason,
  createdAt: 1,
  updatedAt: 1,
});

const membership = (
  uid: string,
  email: string,
  role: Membership["role"],
  status: Membership["status"],
  active: boolean,
  assignedBusId = "",
): Membership => ({
  uid,
  email,
  role,
  status,
  active,
  assignedBusId,
  createdAt: 1,
  updatedAt: 1,
});

const validRoute = {
  id: ROUTE_ID,
  shift: "morning",
  busNumber: BUS_ID,
  origin: "Campus",
  destination: "Vadodara",
  stops: {
    "0": { lat: 22.3072, lng: 73.1812, name: "Campus Gate" },
  },
  status: "published",
  pathSource: "manual",
};

const fixture = (): Fixture => ({
  memberships: {
    [ADMIN_UID]: membership(ADMIN_UID, ADMIN_EMAIL, "admin", "approved", true),
    [ROOT_UID]: membership(ROOT_UID, ROOT_EMAIL, "admin", "approved", true, BUS_ID),
    [STUDENT_UID]: membership(STUDENT_UID, STUDENT_EMAIL, "student", "approved", true),
    [DRIVER_UID]: membership(DRIVER_UID, DRIVER_EMAIL, "driver", "approved", true, BUS_ID),
    [SECOND_DRIVER_UID]: membership(SECOND_DRIVER_UID, SECOND_DRIVER_EMAIL, "driver", "approved", true, BUS_ID),
    [PENDING_UID]: membership(PENDING_UID, PENDING_EMAIL, "student", "pending", false),
    [INACTIVE_UID]: membership(INACTIVE_UID, INACTIVE_EMAIL, "student", "approved", false),
    [SUSPENDED_UID]: membership(SUSPENDED_UID, SUSPENDED_EMAIL, "student", "suspended", false),
    [EXPIRED_UID]: { ...membership(EXPIRED_UID, EXPIRED_EMAIL, "student", "approved", true), expiresAt: 1 },
    [EXPIRED_DRIVER_UID]: { ...membership(EXPIRED_DRIVER_UID, EXPIRED_DRIVER_EMAIL, "driver", "approved", true, BUS_ID), expiresAt: 1 },
  },
  routes: {
    [ROUTE_ID]: validRoute,
  },
  buses: {
    [BUS_ID]: bus(BUS_ID),
    [PARKED_BUS_ID]: bus(PARKED_BUS_ID, "out_of_service", "gearbox"),
  },
});

const auth = (
  environment: RulesTestEnvironment,
  uid: string,
  email: string,
  emailVerified = true,
): RulesTestContext =>
  environment.authenticatedContext(uid, {
    email,
    email_verified: emailVerified,
  });

let environment: RulesTestEnvironment;

test.before(async () => {
  const emulatorAddress = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  if (!emulatorAddress) {
    throw new Error(
      "FIREBASE_DATABASE_EMULATOR_HOST is required; run this file through firebase emulators:exec so it cannot fall back to production.",
    );
  }
  const separator = emulatorAddress.lastIndexOf(":");
  const host = separator > 0 ? emulatorAddress.slice(0, separator) : emulatorAddress;
  const port = separator > 0 ? Number(emulatorAddress.slice(separator + 1)) : 9000;
  if (!host || !Number.isInteger(port) || port < 1) {
    throw new Error(`Invalid FIREBASE_DATABASE_EMULATOR_HOST: ${emulatorAddress}`);
  }

  const rules = await readFile(new URL("../../firebase/database.rules.json", import.meta.url), "utf8");
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    database: { rules, host, port },
  });
});

test("the checked-in Firebase Rules payload stays byte-identical to the served mirror", async () => {
  const canonical = await readFile(new URL("../../firebase/database.rules.json", import.meta.url), "utf8");
  const mirror = await readFile(new URL("../../artifacts/pu-transit/public/firebase-database.rules.json", import.meta.url), "utf8");
  assert.equal(mirror, canonical);
});

test.beforeEach(async () => {
  await environment.clearDatabase();
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.database().ref().set(fixture());
  });
});

test.after(async () => {
  await environment?.cleanup();
});

test("anonymous, unverified, wrong-domain, pending, inactive, and suspended reads fail", async () => {
  const anonymous = environment.unauthenticatedContext();
  const unverified = auth(environment, "unverified-user", "unverified@paruluniversity.ac.in", false);
  const wrongDomain = auth(environment, "wrong-domain-user", "wrong-domain@example.com");
  const pending = auth(environment, PENDING_UID, PENDING_EMAIL);
  const inactive = auth(environment, INACTIVE_UID, INACTIVE_EMAIL);
  const suspended = auth(environment, SUSPENDED_UID, SUSPENDED_EMAIL);

  await assertFails(anonymous.database().ref("routes").once("value"));
  await assertFails(unverified.database().ref("routes").once("value"));
  await assertFails(wrongDomain.database().ref("routes").once("value"));
  await assertSucceeds(pending.database().ref(`memberships/${PENDING_UID}`).once("value"));
  await assertFails(pending.database().ref("routes").once("value"));
  await assertFails(inactive.database().ref("routes").once("value"));
  await assertFails(suspended.database().ref("routes").once("value"));
  await assertFails(suspended.database().ref("driverStatus").once("value"));
});

const selfCreate = (uid: string, email: string, role: "student" | "staff" = "student") => ({
  uid,
  email,
  role,
  status: "approved",
  active: true,
  assignedBusId: "",
  createdAt: { ".sv": "timestamp" },
  updatedAt: { ".sv": "timestamp" },
});

test("verified university users self-create an approved student or staff record, optionally with a role request", async () => {
  const uid = "new-test-user";
  const email = "new-test@paruluniversity.ac.in";
  const context = auth(environment, uid, email);
  const reference = context.database().ref(`memberships/${uid}`);

  const missing = await assertSucceeds(reference.once("value"));
  assert.equal(missing.val(), null);
  await assertFails(reference.set({ ...selfCreate(uid, email), extra: "rejected" }));
  await assertFails(reference.set({ ...selfCreate(uid, email), status: "pending", active: false }));
  await assertFails(reference.set({ ...selfCreate(uid, email), role: "admin" }));
  await assertFails(reference.set({ ...selfCreate(uid, email), role: "driver" }));
  await assertFails(reference.set({ ...selfCreate(uid, email, "staff"), requestedRole: "driver" }));
  await assertFails(reference.set({ ...selfCreate(uid, email), createdAt: Date.now() - 600_000 }));
  await assertFails(reference.set({ ...selfCreate(uid, email), requestedRole: "student" }));
  await assertSucceeds(reference.set({ ...selfCreate(uid, email), requestedRole: "driver" }));
  const created = (await reference.once("value")).val();
  assert.equal(created.status, "approved");
  assert.equal(created.requestedRole, "driver");
  await assertSucceeds(context.database().ref("routes").once("value"));
  await assertFails(reference.update({ role: "staff", updatedAt: 3 }));
  await assertFails(reference.update({ role: "driver", assignedBusId: BUS_ID, updatedAt: 3 }));
  await assertFails(reference.update({ role: "admin", updatedAt: 3 }));
  await assertFails(reference.remove());

  const staffUid = "new-staff-user";
  const staff = auth(environment, staffUid, "new-staff@paruluniversity.ac.in");
  await assertSucceeds(staff.database().ref(`memberships/${staffUid}`).set(selfCreate(staffUid, "new-staff@paruluniversity.ac.in", "staff")));
  await assertSucceeds(staff.database().ref("routes").once("value"));
});

test("personal-email users may only be students and lose access after the grace period", async () => {
  const uid = "personal-test-user";
  const email = "personal-test@gmail.com";
  const context = auth(environment, uid, email);
  const reference = context.database().ref(`memberships/${uid}`);

  await assertFails(context.database().ref("routes").once("value"));
  await assertFails(reference.set(selfCreate(uid, email, "staff")));
  await assertFails(reference.set({ ...selfCreate(uid, email), requestedRole: "driver" }));
  await assertSucceeds(reference.set(selfCreate(uid, email)));
  await assertSucceeds(reference.once("value"));
  await assertSucceeds(context.database().ref("routes").once("value"));
  await assertSucceeds(context.database().ref(`tracking/${BUS_ID}/feed`).once("value"));
  await assertFails(context.database().ref("memberships").once("value"));

  const admin = auth(environment, ADMIN_UID, ADMIN_EMAIL);
  await assertFails(admin.database().ref(`memberships/${uid}`).update({ role: "staff", updatedAt: 2 }));
  await assertFails(admin.database().ref(`memberships/${uid}`).update({ role: "driver", assignedBusId: BUS_ID, updatedAt: 2 }));
  await assertSucceeds(admin.database().ref(`memberships/${uid}`).update({ status: "suspended", active: false, updatedAt: 2 }));
  await assertFails(context.database().ref("routes").once("value"));

  const expiredUid = "expired-personal-user";
  const expiredEmail = "expired-personal@gmail.com";
  await environment.withSecurityRulesDisabled(async (privileged) => {
    await privileged.database().ref(`memberships/${expiredUid}`).set({
      ...membership(expiredUid, expiredEmail, "student", "approved", true),
      createdAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
    });
  });
  const expired = auth(environment, expiredUid, expiredEmail);
  await assertSucceeds(expired.database().ref(`memberships/${expiredUid}`).once("value"));
  await assertFails(expired.database().ref("routes").once("value"));
  await assertFails(expired.database().ref(`tracking/${BUS_ID}/feed`).once("value"));
});

test("a member can sync the record email to a new verified university email and nothing else", async () => {
  const uid = "switching-user";
  const oldEmail = "switching@gmail.com";
  const newEmail = "switching@paruluniversity.ac.in";
  const record = membership(uid, oldEmail, "student", "approved", true);
  await environment.withSecurityRulesDisabled(async (privileged) => {
    await privileged.database().ref(`memberships/${uid}`).set(record);
  });
  const context = auth(environment, uid, newEmail);
  const reference = context.database().ref(`memberships/${uid}`);
  await assertSucceeds(reference.once("value"));
  await assertFails(context.database().ref("routes").once("value"));
  await assertFails(reference.set({ ...record, email: newEmail, role: "admin", updatedAt: 2 }));
  await assertFails(reference.set({ ...record, email: newEmail, requestedRole: "admin", updatedAt: 2 }));
  await assertFails(reference.set({ ...record, email: "someone-else@paruluniversity.ac.in", updatedAt: 2 }));
  await assertSucceeds(reference.set({ ...record, email: newEmail, updatedAt: 2 }));
  await assertSucceeds(context.database().ref("routes").once("value"));

  const personal = auth(environment, uid, "another@gmail.com");
  await assertFails(personal.database().ref(`memberships/${uid}`).set({ ...record, email: "another@gmail.com", updatedAt: 3 }));
});

test("a changed or unverified email cannot reuse an approved record; only a verified university email carries it over (AC-32)", async () => {
  const uid = "renamed-driver";
  const oldEmail = "renamed@paruluniversity.ac.in";
  const record = membership(uid, oldEmail, "driver", "approved", true, BUS_ID);
  await environment.withSecurityRulesDisabled(async (privileged) => {
    await privileged.database().ref(`memberships/${uid}`).set(record);
  });

  // the same address, not verified (an out-of-band change resets verification): nothing, not even the own record
  const unverified = auth(environment, uid, oldEmail, false);
  await assertFails(unverified.database().ref(`memberships/${uid}`).once("value"));
  await assertFails(unverified.database().ref("routes").once("value"));
  await assertFails(unverified.database().ref(`tracking/${BUS_ID}`).set(startRecord(Date.now(), 1, uid)));

  // a verified personal address: the record is readable (so the UI can explain), nothing else, and it cannot be rebound
  const personal = auth(environment, uid, "renamed@gmail.com");
  await assertSucceeds(personal.database().ref(`memberships/${uid}`).once("value"));
  await assertFails(personal.database().ref("routes").once("value"));
  await assertFails(personal.database().ref(`tracking/${BUS_ID}`).once("value"));
  await assertFails(personal.database().ref(`tracking/${BUS_ID}`).set(startRecord(Date.now(), 1, uid)));
  await assertFails(personal.database().ref(`memberships/${uid}`).set({ ...record, email: "renamed@gmail.com", updatedAt: 2 }));

  // a verified university address: denied until the record follows it, then the same driver again
  const renamed = auth(environment, uid, "renamed2@paruluniversity.ac.in");
  await assertFails(renamed.database().ref("routes").once("value"));
  await assertFails(renamed.database().ref(`tracking/${BUS_ID}`).set(startRecord(Date.now(), 1, uid)));
  await assertFails(renamed.database().ref(`memberships/${uid}`).set({ ...record, email: "renamed2@paruluniversity.ac.in", role: "admin", updatedAt: 2 }));
  await assertSucceeds(renamed.database().ref(`memberships/${uid}`).set({ ...record, email: "renamed2@paruluniversity.ac.in", updatedAt: 2 }));
  await assertSucceeds(renamed.database().ref("routes").once("value"));
  await assertSucceeds(renamed.database().ref(`tracking/${BUS_ID}`).once("value"));
  const old = auth(environment, uid, oldEmail); // the previous address is now the mismatched one
  await assertFails(old.database().ref("routes").once("value"));
});

test("an approved, active member past expiresAt is denied routes and tracking until an admin extends it (IDN-01)", async () => {
  const expired = auth(environment, EXPIRED_UID, EXPIRED_EMAIL);
  const expiredDriver = auth(environment, EXPIRED_DRIVER_UID, EXPIRED_DRIVER_EMAIL);
  const admin = auth(environment, ADMIN_UID, ADMIN_EMAIL);
  const own = expired.database().ref(`memberships/${EXPIRED_UID}`);
  const record = (await assertSucceeds(own.once("value"))).val() as Membership; // self-read stays open: the UI shows "expired"
  assert.equal(record.status, "approved");
  assert.equal(record.active, true);

  await assertFails(expired.database().ref("routes").once("value"));
  await assertFails(expired.database().ref(`tracking/${BUS_ID}/feed`).once("value"));
  await assertFails(expired.database().ref("buses").once("value"));
  await assertFails(expiredDriver.database().ref(`tracking/${BUS_ID}`).once("value"));
  await assertFails(expiredDriver.database().ref(`tracking/${BUS_ID}`).set(startRecord(Date.now(), 1, EXPIRED_DRIVER_UID)));

  // only an admin may set, extend or clear it; the member cannot, and a self-created record cannot carry one
  const later = Date.now() + 86_400_000;
  await assertFails(own.set({ ...record, expiresAt: later, updatedAt: 2 }));
  await assertFails(own.set({ ...membership(EXPIRED_UID, EXPIRED_EMAIL, "student", "approved", true), updatedAt: 2 }));
  const newcomer = auth(environment, "newcomer-user", "newcomer@paruluniversity.ac.in");
  await assertFails(newcomer.database().ref("memberships/newcomer-user").set({ ...selfCreate("newcomer-user", "newcomer@paruluniversity.ac.in"), expiresAt: later }));
  await assertFails(admin.database().ref(`memberships/${EXPIRED_UID}`).set({ ...record, expiresAt: "2027-01-01", updatedAt: 2 }));
  await assertFails(admin.database().ref(`memberships/${EXPIRED_UID}`).set({ ...record, expiresAt: 0, updatedAt: 2 }));
  await assertFails(admin.database().ref(`memberships/${EXPIRED_UID}`).set({ ...record, expiresAt: later + 0.5, updatedAt: 2 }));
  await assertFails(admin.database().ref(`memberships/${EXPIRED_UID}`).set({ ...record, expiresAt: 8_640_000_000_000_001, updatedAt: 2 }));
  await assertSucceeds(admin.database().ref(`memberships/${EXPIRED_UID}`).set({ ...record, expiresAt: 8_640_000_000_000_000, updatedAt: 2 }));
  await assertSucceeds(admin.database().ref(`memberships/${EXPIRED_UID}`).set({ ...record, expiresAt: later, updatedAt: 2 }));
  await assertSucceeds(expired.database().ref("routes").once("value"));
  await assertSucceeds(expired.database().ref(`tracking/${BUS_ID}/feed`).once("value"));
  const { expiresAt: _gone, ...cleared } = record;
  await assertSucceeds(admin.database().ref(`memberships/${EXPIRED_UID}`).set({ ...cleared, updatedAt: 3 }));

  // an admin cannot expire themself, and an expired admin is no admin
  const adminRecord = (await admin.database().ref(`memberships/${ADMIN_UID}`).once("value")).val() as Membership;
  await assertFails(admin.database().ref(`memberships/${ADMIN_UID}`).set({ ...adminRecord, expiresAt: 1, updatedAt: 2 }));
  await assertSucceeds(admin.database().ref(`memberships/${ADMIN_UID}`).set({ ...adminRecord, expiresAt: later, updatedAt: 2 }));
  await environment.withSecurityRulesDisabled(async (privileged) => {
    await privileged.database().ref(`memberships/${ADMIN_UID}/expiresAt`).set(1);
  });
  await assertFails(admin.database().ref("memberships").once("value"));
  await assertFails(admin.database().ref(`memberships/${EXPIRED_UID}`).set({ ...record, expiresAt: later, updatedAt: 4 }));
});

test("only the root admin can change the root admin record", async () => {
  const ROOT_UID = "hqKU3amnTzVBT3yF3p4DMRnirDq1";
  const ROOT_EMAIL = "root-test@paruluniversity.ac.in";
  await environment.withSecurityRulesDisabled(async (privileged) => {
    await privileged.database().ref(`memberships/${ROOT_UID}`).set(membership(ROOT_UID, ROOT_EMAIL, "admin", "approved", true));
  });
  const admin = auth(environment, ADMIN_UID, ADMIN_EMAIL);
  const root = auth(environment, ROOT_UID, ROOT_EMAIL);
  await assertFails(admin.database().ref(`memberships/${ROOT_UID}`).update({ status: "suspended", active: false, updatedAt: 2 }));
  await assertFails(admin.database().ref(`memberships/${ROOT_UID}`).update({ role: "student", updatedAt: 2 }));
  await assertFails(root.database().ref(`memberships/${ROOT_UID}`).update({ role: "student", updatedAt: 2 }));
  await assertFails(root.database().ref(`memberships/${ROOT_UID}`).update({ expiresAt: Date.now() + 60_000, updatedAt: 2 }));
  await assertSucceeds(root.database().ref(`memberships/${ADMIN_UID}`).update({ status: "suspended", active: false, updatedAt: 2 }));
  await assertSucceeds(root.database().ref(`memberships/${ROOT_UID}`).update({ assignedBusId: BUS_ID, updatedAt: 3 }));
  await assertSucceeds(root.database().ref(`memberships/${ROOT_UID}`).update({ updatedAt: 3 }));
});

test("notices are admin-created, member-readable, never edited, and bounded", async () => {
  const NOTICE_ID = "55555555-5555-4555-8555-555555555555";
  const admin = auth(environment, ADMIN_UID, ADMIN_EMAIL);
  const student = auth(environment, STUDENT_UID, STUDENT_EMAIL);
  const reference = admin.database().ref(`notices/${NOTICE_ID}`);
  const notice = {
    id: NOTICE_ID,
    text: "Bus BUS-1 leaves 10 minutes early today.",
    routeId: ROUTE_ID,
    until: Date.now() + 60 * 60 * 1000,
    createdBy: ADMIN_UID,
    createdAt: { ".sv": "timestamp" },
  };
  await assertFails(student.database().ref(`notices/${NOTICE_ID}`).set(notice));
  await assertFails(reference.set({ ...notice, until: Date.now() - 1000 }));
  await assertFails(reference.set({ ...notice, until: Date.now() + 31 * 24 * 60 * 60 * 1000 }));
  await assertFails(reference.set({ ...notice, text: "" }));
  await assertFails(reference.set({ ...notice, text: "x".repeat(281) }));
  await assertFails(reference.set({ ...notice, routeId: "not-a-route" }));
  await assertFails(reference.set({ ...notice, createdBy: STUDENT_UID }));
  await assertFails(reference.set({ ...notice, extra: true }));
  await assertFails(admin.database().ref("notices/not-a-uuid").set(notice));
  await assertSucceeds(reference.set({ ...notice, routeId: "" }));
  await assertFails(reference.update({ text: "edited" }));
  await assertSucceeds(student.database().ref("notices").once("value"));
  await assertFails(student.database().ref(`notices/${NOTICE_ID}`).remove());
  await assertSucceeds(reference.remove());
});

test("service calendar days are admin-written (re-writable), member-readable, keyed by a real date, and bounded", async () => {
  const admin = auth(environment, ADMIN_UID, ADMIN_EMAIL);
  const student = auth(environment, STUDENT_UID, STUDENT_EMAIL);
  const suspended = auth(environment, SUSPENDED_UID, SUSPENDED_EMAIL);
  const reference = admin.database().ref("serviceCalendar/2026-11-08");
  const day = {
    date: "2026-11-08",
    noService: true,
    note: "Diwali holiday",
    updatedBy: ADMIN_UID,
    updatedAt: { ".sv": "timestamp" },
  };
  await assertFails(student.database().ref("serviceCalendar/2026-11-08").set({ ...day, updatedBy: STUDENT_UID }));
  await assertFails(admin.database().ref("serviceCalendar/8-Nov-2026").set(day));
  await assertFails(admin.database().ref("serviceCalendar/2026-13-01").set({ ...day, date: "2026-13-01" }));
  await assertFails(reference.set({ ...day, date: "2026-11-09" }));
  await assertFails(reference.set({ ...day, noService: false }));
  await assertFails(reference.set({ ...day, note: "" }));
  await assertFails(reference.set({ ...day, note: "x".repeat(141) }));
  await assertFails(reference.set({ ...day, updatedBy: STUDENT_UID }));
  await assertFails(reference.set({ ...day, updatedAt: 1 }));
  await assertFails(reference.set({ ...day, extra: true }));
  await assertSucceeds(reference.set(day));
  await assertSucceeds(reference.set({ ...day, note: "Diwali" })); // the office may correct a note
  await assertSucceeds(admin.database().ref("serviceCalendar/2026-10-02").set({ ...day, date: "2026-10-02", note: null }));
  await assertSucceeds(student.database().ref("serviceCalendar").once("value"));
  await assertFails(suspended.database().ref("serviceCalendar").once("value"));
  await assertFails(student.database().ref("serviceCalendar/2026-11-08").remove());
  await assertSucceeds(reference.remove());
});

test("maintenance run records are admin-readable and written by no client (SEC-05: the job identity bypasses Rules)", async () => {
  const admin = auth(environment, ADMIN_UID, ADMIN_EMAIL);
  const student = auth(environment, STUDENT_UID, STUDENT_EMAIL);
  const record = { lastRunAt: 1, outcome: "ok", removed: { feedLocations: 0, auditRecords: 0 }, durationMs: 1 };
  await environment.withSecurityRulesDisabled(async (job) => {
    await job.database().ref("maintenance/retention").set(record);
  });
  await assertSucceeds(admin.database().ref("maintenance/retention").once("value"));
  await assertFails(student.database().ref("maintenance/retention").once("value"));
  await assertFails(admin.database().ref("maintenance/retention").set({ ...record, outcome: "failed" }));
  await assertFails(admin.database().ref("maintenance/retention").remove());
  await assertFails(environment.unauthenticatedContext().database().ref("maintenance").once("value"));
});

test("buses are admin-written, member-readable, never deleted, and every bus reference must be registered", async () => {
  const admin = auth(environment, ADMIN_UID, ADMIN_EMAIL);
  const student = auth(environment, STUDENT_UID, STUDENT_EMAIL);
  const created = { ...bus("GJ06BX1414"), label: "Waghodia 14", createdAt: timestamp(), updatedAt: timestamp() };
  const reference = admin.database().ref("buses/GJ06BX1414");

  await assertFails(student.database().ref("buses/GJ06BX1414").set(created));
  await assertFails(admin.database().ref("buses/gj06bx1414").set({ ...created, busId: "gj06bx1414" }));
  await assertFails(admin.database().ref("buses/GJ-06").set({ ...created, busId: "GJ-06" }));
  await assertFails(reference.set({ ...created, busId: BUS_ID }));
  await assertFails(reference.set({ ...created, status: "retired" }));
  await assertFails(reference.set({ ...created, status: "active", reason: "still stored" }));
  await assertFails(reference.set({ ...created, label: "" }));
  await assertFails(reference.set({ ...created, extra: true }));
  await assertSucceeds(reference.set(created));
  await assertSucceeds(reference.update({ status: "out_of_service", reason: "gearbox", updatedAt: timestamp() }));
  await assertFails(reference.update({ createdAt: 5 }));
  await assertFails(reference.remove());
  await assertSucceeds(student.database().ref("buses").once("value"));
  await assertFails(environment.unauthenticatedContext().database().ref("buses").once("value"));

  const driver = admin.database().ref(`memberships/${DRIVER_UID}`);
  await assertFails(driver.update({ assignedBusId: "GJ06BX9999", updatedAt: 2 }));
  await assertFails(driver.update({ assignedBusId: "gj06bx1414", updatedAt: 2 }));
  await assertFails(driver.update({ assignedBusId: "GJ06BX1414", updatedAt: 2 })); // registered but parked above
  await assertSucceeds(reference.update({ status: "active", reason: "", updatedAt: timestamp() }));
  await assertSucceeds(driver.update({ assignedBusId: "GJ06BX1414", updatedAt: 2 }));
  await assertSucceeds(reference.update({ status: "out_of_service", reason: "gearbox", updatedAt: timestamp() }));
  await assertSucceeds(driver.update({ status: "suspended", active: false, updatedAt: 3 })); // unchanged assignment on a parked bus
  await assertFails(driver.update({ assignedBusId: PARKED_BUS_ID, updatedAt: 4 })); // moving to another parked bus

  const route = admin.database().ref(`routes/${ROUTE_ID}`);
  await assertFails(route.update({ busNumber: "GJ06BX9999" }));
  await assertFails(route.update({ busNumber: "GJ 06 BX 1414" }));
  await assertSucceeds(route.update({ busNumber: "GJ06BX1414" }));

  const entry = {
    at: timestamp(),
    actorUid: ADMIN_UID,
    actorEmail: ADMIN_EMAIL,
    action: "bus.deactivate",
    target: "GJ06BX1414",
    summary: "out of service: gearbox",
  };
  await assertSucceeds(admin.database().ref("audit").push().set(entry));
  await assertSucceeds(admin.database().ref("audit").push().set({ ...entry, action: "bus.reactivate" }));
  await assertSucceeds(admin.database().ref("audit").push().set({ ...entry, action: "bus.save" }));
  await assertSucceeds(admin.database().ref("audit").push().set({ ...entry, action: "tracking.handover" })); // ADM-10
});

test("routes accept a kind of bus or shuttle only", async () => {
  const admin = auth(environment, ADMIN_UID, ADMIN_EMAIL);
  const reference = admin.database().ref(`routes/${ROUTE_ID}`);
  await assertFails(reference.update({ kind: "train" }));
  await assertSucceeds(reference.update({ kind: "shuttle" }));
  assert.equal((await reference.once("value")).val().kind, "shuttle");
});

test("routes need a status, and publishing needs a manual acknowledgement or ors geometry (RTE-01)", async () => {
  const admin = auth(environment, ADMIN_UID, ADMIN_EMAIL);
  const freshId = "44444444-4444-4444-8444-444444444444";
  const reference = admin.database().ref(`routes/${freshId}`);
  const { status: _status, pathSource: _source, ...bare } = { ...validRoute, id: freshId };
  await assertFails(reference.set(bare)); // pre-RTE-01 shape can no longer be written
  await assertFails(reference.update({ status: "live" }));
  await assertFails(reference.update({ pathSource: "guess" }));
  await assertSucceeds(reference.set({ ...bare, status: "draft" })); // drafts need no path at all
  await assertFails(reference.update({ status: "published" })); // ...but publishing does
  await assertFails(reference.update({ status: "published", pathSource: "ors" })); // ors without geometry
  await assertSucceeds(reference.update({ status: "published", pathSource: "ors", pathData: { "0": { lat: 22.3, lng: 73.18 } } }));
  await assertFails(reference.update({ pathData: null })); // dropping the geometry of a published ors route
  await assertSucceeds(reference.update({ pathSource: "manual", pathData: null }));
});

test("route versions are admin-created once, member-readable, never changed; drafts are admin-only (RTE-02)", async () => {
  const admin = auth(environment, ADMIN_UID, ADMIN_EMAIL);
  const student = auth(environment, STUDENT_UID, STUDENT_EMAIL);
  const route = admin.database().ref(`routes/${ROUTE_ID}`);
  await assertFails(route.update({ publishedVersion: 0 }));
  await assertFails(route.update({ publishedVersion: 1.5 }));
  await assertSucceeds(route.update({ publishedVersion: 2 }));
  await assertFails(route.update({ publishedVersion: 1 })); // never decreases
  await assertFails(route.update({ publishedVersion: null })); // and never disappears: trips pin it
  await assertSucceeds(route.update({ status: "archived" }));

  const { id: _id, status: _status, ...content } = validRoute;
  const version = { n: 1, ...content, createdAt: timestamp(), createdBy: ADMIN_UID };
  const versions = admin.database().ref(`routeVersions/${ROUTE_ID}`);
  await assertFails(versions.child("0").set(version));
  await assertFails(versions.child("1").set({ ...version, createdBy: STUDENT_UID }));
  await assertFails(versions.child("1").set({ ...version, createdAt: 1 }));
  await assertFails(versions.child("1").set({ ...version, publishedVersion: 1 }));
  await assertFails(student.database().ref(`routeVersions/${ROUTE_ID}/1`).set(version));
  await assertSucceeds(versions.child("1").set(version));
  await assertFails(versions.child("1").set(version)); // immutable, even to an identical write
  await assertFails(versions.child("1").update({ origin: "moved" }));
  await assertFails(versions.child("1").remove());
  await assertSucceeds(versions.child("2").set({ ...version, n: 2 }));
  assert.equal((await student.database().ref(`routeVersions/${ROUTE_ID}/1`).once("value")).val().origin, "Campus");

  const drafts = admin.database().ref(`routeDrafts/${ROUTE_ID}`);
  await assertFails(drafts.set(validRoute)); // drafts are drafts
  await assertSucceeds(drafts.set({ ...validRoute, status: "draft", origin: "New campus" }));
  await assertSucceeds(admin.database().ref("routeDrafts").once("value"));
  await assertFails(student.database().ref(`routeDrafts/${ROUTE_ID}`).once("value"));
  await assertFails(student.database().ref(`routeDrafts/${ROUTE_ID}`).update({ origin: "tampered" }));
  await assertSucceeds(drafts.remove());
});

test("approved students can read routes but cannot write them", async () => {
  const student = auth(environment, STUDENT_UID, STUDENT_EMAIL);
  await assertSucceeds(student.database().ref("routes").once("value"));
  await assertFails(student.database().ref(`routes/${ROUTE_ID}`).update({ origin: "tampered" }));
  await assertFails(student.database().ref(`memberships/${STUDENT_UID}`).update({ role: "admin" }));
});

test("legacy driverStatus is denied for every role", async () => {
  for (const context of [
    auth(environment, ADMIN_UID, ADMIN_EMAIL),
    auth(environment, STUDENT_UID, STUDENT_EMAIL),
    auth(environment, DRIVER_UID, DRIVER_EMAIL),
  ]) {
    await assertFails(context.database().ref("driverStatus").once("value"));
    await assertFails(context.database().ref(`driverStatus/${BUS_ID}`).set({ value: true }));
  }
});

test("audit is admin-readable and create-only with strict actor and shape", async () => {
  const admin = auth(environment, ADMIN_UID, ADMIN_EMAIL);
  const student = auth(environment, STUDENT_UID, STUDENT_EMAIL);
  const driver = auth(environment, DRIVER_UID, DRIVER_EMAIL);
  const reference = admin.database().ref("audit").push();
  const entry = {
    at: { ".sv": "timestamp" },
    actorUid: ADMIN_UID,
    actorEmail: ADMIN_EMAIL,
    action: "route.save",
    target: ROUTE_ID,
    summary: "Campus to Vadodara; bus BUS-1",
  };
  await assertSucceeds(reference.set(entry));
  await assertSucceeds(admin.database().ref("audit").once("value"));
  await assertFails(reference.update({ summary: "changed" }));
  await assertFails(reference.remove());
  await assertFails(admin.database().ref("audit").push().set({ ...entry, actorUid: DRIVER_UID }));
  await assertFails(admin.database().ref("audit").push().set({ ...entry, actorEmail: DRIVER_EMAIL }));
  await assertFails(admin.database().ref("audit").push().set({ ...entry, action: "unknown" }));
  await assertFails(admin.database().ref("audit").push().set({ ...entry, extra: true }));
  for (const context of [student, driver]) {
    await assertFails(context.database().ref("audit").once("value"));
    await assertFails(context.database().ref("audit").push().set(entry));
  }
});

test("an active approved admin can approve memberships and create, edit, and delete routes", async () => {
  const admin = auth(environment, ADMIN_UID, ADMIN_EMAIL);
  const target = admin.database().ref(`memberships/${PENDING_UID}`);
  await assertSucceeds(target.update({ role: "student", status: "approved", active: true, updatedAt: 2 }));
  const approved = await target.once("value");
  assert.equal(approved.val().active, true);
  assert.equal(approved.val().status, "approved");
  await assertFails(
    admin.database().ref(`memberships/${ADMIN_UID}`).update({
      role: "student",
      status: "approved",
      active: true,
      updatedAt: 2,
    }),
  );

  const newRouteId = "22222222-2222-4222-8222-222222222222";
  const routeReference = admin.database().ref(`routes/${newRouteId}`);
  const newRoute = { ...validRoute, id: newRouteId, destination: "New Destination" };
  await assertSucceeds(routeReference.set(newRoute));
  await assertSucceeds(routeReference.update({ origin: "Updated Campus" }));
  const edited = await routeReference.once("value");
  assert.equal(edited.val().origin, "Updated Campus");
  // RTE-03: published routes are archived, never removed, and never demoted to a draft to get around that.
  await assertFails(routeReference.remove());
  await assertFails(routeReference.update({ status: "draft" }));
  await assertSucceeds(routeReference.update({ status: "archived" }));
  await assertFails(routeReference.remove());
  await assertFails(routeReference.update({ status: "draft" }));
  await assertFails(routeReference.set({ ...newRoute, status: "draft" }));
  await assertFails(admin.database().ref(`routes/${ROUTE_ID}`).remove()); // pre-versioning fixture node
  await assertFails(admin.database().ref(`routes/${ROUTE_ID}`).update({ status: "draft" }));
  const draftId = "33333333-3333-4333-8333-333333333333";
  const draftReference = admin.database().ref(`routes/${draftId}`);
  await assertSucceeds(draftReference.set({ ...newRoute, id: draftId, status: "draft" }));
  await assertSucceeds(draftReference.update({ status: "draft", origin: "Still a draft" }));
  await assertSucceeds(draftReference.remove());
  const deleted = await assertSucceeds(draftReference.once("value"));
  assert.equal(deleted.val(), null);
});

const TRIP_ID = "33333333-3333-4333-8333-333333333333";
const PUBLISHER_ID = "44444444-4444-4444-8444-444444444444";

const timestamp = (): { ".sv": "timestamp" } => ({ ".sv": "timestamp" });

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const assertTrackingSucceeds = async (step: string, operation: Promise<unknown>): Promise<void> => {
  try {
    await assertSucceeds(operation);
  } catch (error) {
    throw new Error(`Tracking lifecycle failed at ${step}`, { cause: error });
  }
};

const startRecord = (
  requestedAt: number,
  generation = 1,
  driverUid = DRIVER_UID,
  tripId = TRIP_ID,
  publisherId = PUBLISHER_ID,
): Record<string, any> => ({
  driverUid,
  publisherId,
  sequence: 0,
  feed: {
    protocolVersion: 2,
    busId: BUS_ID,
    tripId,
    generation,
    phase: "active",
    requestedAt,
    startedAt: timestamp(),
    endedAt: 0,
    heartbeatAt: timestamp(),
    gpsQuality: "acquiring",
    direction: "toCampus",
    lastReportCapturedAt: 0,
    lastReportReceivedAt: 0,
    reportedAccuracy: 0,
    lastValidCapturedAt: 0,
    lastValidReceivedAt: 0,
  },
});

test("assigned driver can preflight a missing node and complete start/sample/weak/heartbeat/end", async () => {
  const driver = auth(environment, DRIVER_UID, DRIVER_EMAIL);
  const student = auth(environment, STUDENT_UID, STUDENT_EMAIL);
  const admin = auth(environment, ADMIN_UID, ADMIN_EMAIL);
  const reference = driver.database().ref(`tracking/${BUS_ID}`);

  const missing = await assertSucceeds(reference.once("value"));
  assert.equal(missing.val(), null);
  await assertSucceeds(student.database().ref(`tracking/${BUS_ID}/feed`).once("value"));
  await assertFails(student.database().ref(`tracking/${BUS_ID}`).once("value"));
  await assertFails(student.database().ref("tracking").once("value"));
  await assertSucceeds(admin.database().ref("tracking").once("value"));

  // FLT-03: Start needs a serviceable bus; a bus parked mid-trip can still report and end.
  const registry = admin.database().ref(`buses/${BUS_ID}`);
  await assertSucceeds(registry.update({ status: "out_of_service", reason: "gearbox", updatedAt: timestamp() }));
  await assertFails(reference.set(startRecord(Date.now())));
  await assertSucceeds(registry.update({ status: "active", reason: "", updatedAt: timestamp() }));
  await assertTrackingSucceeds("start", reference.set(startRecord(Date.now())));
  const started = (await reference.once("value")).val() as Record<string, any>;
  assert.equal(started.driverUid, DRIVER_UID);
  assert.equal(started.feed.phase, "active");
  assert.equal(started.feed.gpsQuality, "acquiring");
  assert.equal(started.feed.generation, 1);
  assert.equal(started.feed.location, undefined);
  // Ordinary parking now rejects a live feed.  Keep the report/end assertions
  // below as an explicit out-of-band legacy seed: Rules-disabled maintenance
  // can still leave a parked bus with a live session, and that session remains
  // reportable and endable.
  await assertFails(registry.update({ status: "out_of_service", reason: "gearbox", updatedAt: timestamp() }));
  assert.equal((await registry.once("value")).val().status, "active");
  await environment.withSecurityRulesDisabled(async (privileged) => {
    await privileged.database().ref(`buses/${BUS_ID}`).set(bus(BUS_ID, "out_of_service", "gearbox"));
    await privileged.database().ref(`tracking/${BUS_ID}`).set(started);
  });

  const good = clone(started);
  good.sequence = 1;
  good.feed.heartbeatAt = timestamp();
  good.feed.lastReportCapturedAt = Date.now();
  good.feed.lastReportReceivedAt = timestamp();
  good.feed.reportedAccuracy = 12;
  good.feed.full = true;
  good.feed.lastValidCapturedAt = good.feed.lastReportCapturedAt;
  good.feed.lastValidReceivedAt = timestamp();
  good.feed.gpsQuality = "good";
  good.feed.location = { lat: 22.3072, lng: 73.1812, accuracy: 12 };
  await assertTrackingSucceeds("good sample", reference.set(good));
  const goodSaved = (await reference.once("value")).val() as Record<string, any>;

  const weak = clone(goodSaved);
  weak.sequence = 2;
  weak.feed.heartbeatAt = timestamp();
  weak.feed.lastReportCapturedAt = Date.now();
  weak.feed.lastReportReceivedAt = timestamp();
  weak.feed.reportedAccuracy = 150;
  weak.feed.gpsQuality = "weak";
  await assertTrackingSucceeds("weak sample", reference.set(weak));
  const weakSaved = (await reference.once("value")).val() as Record<string, any>;
  assert.equal(weakSaved.feed.location.lat, 22.3072);
  assert.equal(weakSaved.feed.lastValidCapturedAt, goodSaved.feed.lastValidCapturedAt);
  assert.equal(weakSaved.feed.lastValidReceivedAt, goodSaved.feed.lastValidReceivedAt);

  const heartbeat = clone(weakSaved);
  heartbeat.sequence = 3;
  heartbeat.feed.heartbeatAt = timestamp();
  heartbeat.feed.full = true;
  await assertTrackingSucceeds("heartbeat", reference.set(heartbeat));
  const heartbeatSaved = (await reference.once("value")).val() as Record<string, any>;
  assert.equal(heartbeatSaved.feed.direction, "toCampus");
  assert.equal(heartbeatSaved.feed.full, true);
  assert.equal(heartbeatSaved.feed.lastReportCapturedAt, weakSaved.feed.lastReportCapturedAt);
  assert.equal(heartbeatSaved.feed.reportedAccuracy, 150);
  assert.deepEqual(heartbeatSaved.feed.location, weakSaved.feed.location);

  const unavailable = clone(heartbeatSaved);
  unavailable.sequence = 4;
  unavailable.feed.heartbeatAt = timestamp();
  unavailable.feed.gpsQuality = "unavailable";
  await assertTrackingSucceeds("unavailable heartbeat", reference.set(unavailable));
  const unavailableSaved = (await reference.once("value")).val() as Record<string, any>;
  assert.equal(unavailableSaved.feed.gpsQuality, "unavailable");
  assert.deepEqual(unavailableSaved.feed.location, heartbeatSaved.feed.location);

  const changedEndDirection = clone(unavailableSaved);
  changedEndDirection.feed.phase = "ended";
  changedEndDirection.feed.endedAt = timestamp();
  changedEndDirection.feed.gpsQuality = "unavailable";
  changedEndDirection.feed.direction = "fromCampus";
  delete changedEndDirection.feed.location;
  await assertFails(reference.set(changedEndDirection));
  const changedEndFull = clone(unavailableSaved);
  changedEndFull.feed.phase = "ended";
  changedEndFull.feed.endedAt = timestamp();
  changedEndFull.feed.gpsQuality = "unavailable";
  changedEndFull.feed.full = false;
  delete changedEndFull.feed.location;
  await assertFails(reference.set(changedEndFull));

  const ended = clone(unavailableSaved);
  ended.feed.phase = "ended";
  ended.feed.endedAt = timestamp();
  ended.feed.gpsQuality = "unavailable";
  delete ended.feed.location;
  await assertTrackingSucceeds("end", reference.set(ended));
  const endedSaved = (await reference.once("value")).val() as Record<string, any>;
  assert.equal(endedSaved.feed.phase, "ended");
  assert.equal(endedSaved.feed.direction, "toCampus");
  assert.equal(endedSaved.feed.full, true);
  assert.equal(endedSaved.feed.location, undefined);
  await assertSucceeds(student.database().ref(`tracking/${BUS_ID}/feed`).once("value"));

  const nextGeneration = startRecord(Date.now(), 2);
  await assertFails(reference.set(nextGeneration)); // the bus is still parked: no restart either
  await assertSucceeds(registry.update({ status: "active", reason: "", updatedAt: timestamp() }));
  await assertFails(reference.set(startRecord(Date.now() - 120_000, 2)));
  await assertTrackingSucceeds("next-generation start", reference.set(nextGeneration));
  const next = (await reference.once("value")).val() as Record<string, any>;
  assert.equal(next.feed.generation, 2);
  assert.equal(next.feed.phase, "active");
});

test("Start-first wins a stale bus-deactivation preflight and leaves the bus active and live", async () => {
  const driver = auth(environment, DRIVER_UID, DRIVER_EMAIL);
  const admin = auth(environment, ADMIN_UID, ADMIN_EMAIL);
  const tracking = driver.database().ref(`tracking/${BUS_ID}`);
  const registry = admin.database().ref(`buses/${BUS_ID}`);

  // Both callers preflight the same initial state before either commits.
  const trackingPreflight = await assertSucceeds(tracking.once("value"));
  const busPreflight = await assertSucceeds(registry.once("value"));
  assert.equal(trackingPreflight.val(), null);
  assert.equal(busPreflight.val().status, "active");

  await assertTrackingSucceeds("race Start", tracking.set(startRecord(Date.now())));
  await assertFails(registry.update({ status: "out_of_service", reason: "gearbox", updatedAt: timestamp() }));

  const busAfter = (await registry.once("value")).val() as Record<string, any>;
  const trackingAfter = (await tracking.once("value")).val() as Record<string, any>;
  assert.equal(busAfter.status, "active");
  assert.equal(busAfter.reason, "");
  assert.equal(trackingAfter.feed.phase, "active");
  assert.ok(trackingAfter.feed.heartbeatAt > 0);

  // A write unrelated to the active -> out_of_service transition is still
  // allowed while the trip is live.
  await assertSucceeds(registry.update({ label: "BUS1 live", updatedAt: timestamp() }));
  assert.equal((await registry.once("value")).val().label, "BUS1 live");
});

test("deactivation-first wins a stale Start preflight and leaves a parked bus", async () => {
  const driver = auth(environment, DRIVER_UID, DRIVER_EMAIL);
  const admin = auth(environment, ADMIN_UID, ADMIN_EMAIL);
  const tracking = driver.database().ref(`tracking/${BUS_ID}`);
  const registry = admin.database().ref(`buses/${BUS_ID}`);

  // The driver and administrator both read before the first operation.  The
  // Start below intentionally uses the driver's stale missing-node snapshot.
  const trackingPreflight = await assertSucceeds(tracking.once("value"));
  const busPreflight = await assertSucceeds(registry.once("value"));
  assert.equal(trackingPreflight.val(), null);
  assert.equal(busPreflight.val().status, "active");

  await assertSucceeds(registry.update({ status: "out_of_service", reason: "gearbox", updatedAt: timestamp() }));
  await assertFails(tracking.set(startRecord(Date.now())));

  const parked = (await registry.once("value")).val() as Record<string, any>;
  assert.equal(parked.status, "out_of_service");
  assert.equal(parked.reason, "gearbox");
  assert.equal((await tracking.once("value")).val(), null);

  // Parking does not make the registry immutable, and reactivation remains a
  // normal operation once the bus is no longer being taken out of service.
  await assertSucceeds(registry.update({ label: "BUS1 parked", updatedAt: timestamp() }));
  await assertSucceeds(registry.update({ status: "active", reason: "", updatedAt: timestamp() }));
  const activeAgain = (await registry.once("value")).val() as Record<string, any>;
  assert.equal(activeAgain.status, "active");
  assert.equal(activeAgain.reason, "");
  assert.equal(activeAgain.label, "BUS1 parked");
});

test("parking admits missing, ended, and offline feeds but rejects a feed inside the heartbeat lease", async () => {
  const admin = auth(environment, ADMIN_UID, ADMIN_EMAIL);
  const driver = auth(environment, DRIVER_UID, DRIVER_EMAIL);
  const registry = admin.database().ref(`buses/${BUS_ID}`);
  const tracking = driver.database().ref(`tracking/${BUS_ID}`);

  // Missing feed: a bus with no session can be parked.
  await assertSucceeds(registry.update({ status: "out_of_service", reason: "inspection", updatedAt: timestamp() }));
  assert.equal((await registry.once("value")).val().status, "out_of_service");
  await assertSucceeds(registry.update({ status: "active", reason: "", updatedAt: timestamp() }));

  const seed = async (record: Record<string, any>): Promise<void> => {
    await environment.withSecurityRulesDisabled(async (privileged) => {
      await privileged.database().ref(`buses/${BUS_ID}`).set(bus(BUS_ID));
      await privileged.database().ref(`tracking/${BUS_ID}`).set(record);
    });
  };

  // An ended feed is not a live owner and may remain parked.
  const ended = startRecord(Date.now() - 120_000);
  ended.feed.startedAt = Date.now() - 180_000;
  ended.feed.phase = "ended";
  ended.feed.endedAt = Date.now() - 60_000;
  ended.feed.heartbeatAt = Date.now() - 60_000;
  ended.feed.gpsQuality = "unavailable";
  delete ended.feed.direction;
  await seed(ended);
  await assertSucceeds(registry.update({ status: "out_of_service", reason: "ended trip", updatedAt: timestamp() }));
  assert.equal((await tracking.once("value")).val().feed.phase, "ended");
  await assertSucceeds(registry.update({ status: "active", reason: "", updatedAt: timestamp() }));

  // Probe just inside the 90-second lease without sleeping.  The server's
  // evaluation time is a little later than the seed, so leave a one-second
  // cushion on either side of the boundary.
  const leased = startRecord(Date.now() - 89_000);
  leased.feed.startedAt = Date.now() - 120_000;
  leased.feed.heartbeatAt = Date.now() - 89_000;
  await seed(leased);
  await assertFails(registry.update({ status: "out_of_service", reason: "inspection", updatedAt: timestamp() }));
  assert.equal((await registry.once("value")).val().status, "active");

  const stale = startRecord(Date.now() - 91_000);
  stale.feed.startedAt = Date.now() - 180_000;
  stale.feed.heartbeatAt = Date.now() - 91_000;
  await seed(stale);
  await assertSucceeds(registry.update({ status: "out_of_service", reason: "offline", updatedAt: timestamp() }));
  assert.equal((await registry.once("value")).val().status, "out_of_service");
  assert.equal((await tracking.once("value")).val().feed.phase, "active");
});

test("the standing owner cannot combine Start and bus deactivation in one multipath write", async () => {
  const root = auth(environment, ROOT_UID, ROOT_EMAIL);
  const tracking = root.database().ref(`tracking/${BUS_ID}`);
  const registry = root.database().ref(`buses/${BUS_ID}`);

  // The owner preflights both sides before attempting one atomic write.
  const trackingPreflight = await assertSucceeds(tracking.once("value"));
  const busPreflight = await assertSucceeds(registry.once("value"));
  assert.equal(trackingPreflight.val(), null);
  assert.equal(busPreflight.val().status, "active");

  const combinedWrite: Record<string, unknown> = {
    [`tracking/${BUS_ID}`]: startRecord(Date.now(), 1, ROOT_UID),
    [`buses/${BUS_ID}/status`]: "out_of_service",
    [`buses/${BUS_ID}/reason`]: "gearbox",
    [`buses/${BUS_ID}/updatedAt`]: timestamp(),
  };
  await assertFails(root.database().ref().update(combinedWrite));

  // The multipath write is atomic: neither Start nor deactivation commits.
  assert.equal((await registry.once("value")).val().status, "active");
  assert.equal((await tracking.once("value")).val(), null);
});

test("root admin uses the standing bus for the full driver lifecycle while ordinary admins and forged students remain denied", async () => {
  const root = auth(environment, ROOT_UID, ROOT_EMAIL);
  const admin = auth(environment, ADMIN_UID, ADMIN_EMAIL);
  const student = auth(environment, STUDENT_UID, STUDENT_EMAIL);
  const reference = root.database().ref(`tracking/${BUS_ID}`);

  // An owner without a standing bus cannot borrow one merely by being admin.
  await environment.withSecurityRulesDisabled(async (privileged) => {
    await privileged.database().ref(`memberships/${ROOT_UID}/assignedBusId`).set("");
  });
  await assertFails(reference.set(startRecord(Date.now(), 1, ROOT_UID)));
  await environment.withSecurityRulesDisabled(async (privileged) => {
    await privileged.database().ref(`memberships/${ROOT_UID}/assignedBusId`).set(BUS_ID);
  });

  await assertFails(admin.database().ref(`tracking/${BUS_ID}`).set(startRecord(Date.now(), 1, ADMIN_UID)));
  await assertFails(student.database().ref(`tracking/${BUS_ID}`).set(startRecord(Date.now(), 1, ROOT_UID)));
  await assertFails(root.database().ref(`tracking/${PARKED_BUS_ID}`).set(startRecord(Date.now(), 1, ROOT_UID)));

  await assertTrackingSucceeds("root start", reference.set(startRecord(Date.now(), 1, ROOT_UID)));
  const started = (await reference.once("value")).val() as Record<string, any>;
  const sample = clone(started);
  sample.sequence = 1;
  sample.feed.heartbeatAt = timestamp();
  sample.feed.lastReportCapturedAt = Date.now();
  sample.feed.lastReportReceivedAt = timestamp();
  sample.feed.reportedAccuracy = 10;
  sample.feed.lastValidCapturedAt = sample.feed.lastReportCapturedAt;
  sample.feed.lastValidReceivedAt = timestamp();
  sample.feed.gpsQuality = "good";
  sample.feed.location = { lat: 22.3, lng: 73.18, accuracy: 10 };
  await assertTrackingSucceeds("root sample", reference.set(sample));

  const heartbeat = clone((await reference.once("value")).val() as Record<string, any>);
  heartbeat.sequence = 2;
  heartbeat.feed.heartbeatAt = timestamp();
  await assertTrackingSucceeds("root heartbeat", reference.set(heartbeat));

  const ended = clone((await reference.once("value")).val() as Record<string, any>);
  ended.feed.phase = "ended";
  ended.feed.endedAt = timestamp();
  ended.feed.gpsQuality = "unavailable";
  delete ended.feed.location;
  await assertTrackingSucceeds("root end", reference.set(ended));
});

test("route versions pinned at Start cannot change, grow, or vanish for the rest of the trip (AC-19)", async () => {
  const driver = auth(environment, DRIVER_UID, DRIVER_EMAIL);
  const reference = driver.database().ref(`tracking/${BUS_ID}`);
  const OTHER_ROUTE_ID = "22222222-2222-4222-8222-222222222222";
  await environment.withSecurityRulesDisabled(async (privileged) => {
    await privileged.database().ref(`routes/${ROUTE_ID}/publishedVersion`).set(1);
    await privileged.database().ref(`routes/${OTHER_ROUTE_ID}`).set({ ...validRoute, id: OTHER_ROUTE_ID, busNumber: "BUS9", publishedVersion: 1 });
  });

  const bad = startRecord(Date.now());
  for (const pins of [
    { "not-a-uuid": 1 },
    { [ROUTE_ID]: 0 },
    { [ROUTE_ID]: 2 }, // not what the route publishes
    { [OTHER_ROUTE_ID]: 1 }, // another bus's route
    { "33333333-3333-4333-8333-333333333333": 1 }, // no such route
  ]) {
    bad.feed.routeVersions = pins;
    await assertFails(reference.set(bad));
  }

  const start = startRecord(Date.now());
  start.feed.routeVersions = { [ROUTE_ID]: 1 };
  await assertTrackingSucceeds("pinned start", reference.set(start));
  const started = (await reference.once("value")).val() as Record<string, any>;

  const next = (sequence: number, feed: Record<string, unknown>): Record<string, any> => {
    const node = clone(started);
    node.sequence = sequence;
    node.feed = { ...node.feed, heartbeatAt: timestamp(), full: false, ...feed };
    return node;
  };
  await assertFails(reference.set(next(1, { routeVersions: { [ROUTE_ID]: 2 } }))); // republished mid-trip
  await assertFails(reference.set(next(1, { routeVersions: { [ROUTE_ID]: 1, [OTHER_ROUTE_ID]: 1 } }))); // new pin
  await assertFails(reference.set(next(1, { routeVersions: null }))); // dropped whole (single-key removal is beyond Rules)
  await assertTrackingSucceeds("heartbeat keeps pin", reference.set(next(1, {})));
  const ended = clone((await reference.once("value")).val() as Record<string, any>);
  ended.feed = { ...ended.feed, phase: "ended", endedAt: timestamp(), gpsQuality: "unavailable" };
  await assertTrackingSucceeds("end keeps pin", reference.set(ended));
  assert.deepEqual((await reference.child("feed/routeVersions").once("value")).val(), { [ROUTE_ID]: 1 });

  // The next trip pins whatever is published then — and only that.
  await environment.withSecurityRulesDisabled(async (privileged) => {
    await privileged.database().ref(`routes/${ROUTE_ID}/publishedVersion`).set(2);
  });
  const stale = startRecord(Date.now(), 2);
  stale.feed.routeVersions = { [ROUTE_ID]: 1 };
  await assertFails(reference.set(stale));
  const again = startRecord(Date.now(), 2);
  again.feed.routeVersions = { [ROUTE_ID]: 2 };
  await assertTrackingSucceeds("next trip repins", reference.set(again));
});

test("tracking rejects unauthorized roles, ownership changes, malformed data, stale sequences, and old-client bypasses", async () => {
  const driver = auth(environment, DRIVER_UID, DRIVER_EMAIL);
  const secondDriver = auth(environment, SECOND_DRIVER_UID, SECOND_DRIVER_EMAIL);
  const student = auth(environment, STUDENT_UID, STUDENT_EMAIL);
  const admin = auth(environment, ADMIN_UID, ADMIN_EMAIL);
  const reference = driver.database().ref(`tracking/${BUS_ID}`);

  await assertFails(student.database().ref(`tracking/${BUS_ID}`).set(startRecord(Date.now(), 1, STUDENT_UID)));
  await assertFails(admin.database().ref(`tracking/${BUS_ID}`).set(startRecord(Date.now())));
  await assertFails(driver.database().ref("tracking/BUS-2").set(startRecord(Date.now())));
  await assertFails(reference.set(startRecord(Date.now() - 31001)));
  await assertFails(reference.set(startRecord(Date.now() + 10_000)));
  await assertFails(reference.set(startRecord(Date.now(), 2)));
  await assertFails(reference.set(startRecord(Date.now(), 1, DRIVER_UID, TRIP_ID, "not-a-uuid")));
  const sideways = startRecord(Date.now());
  sideways.feed.direction = "sideways";
  await assertFails(reference.set(sideways));
  const fullString = startRecord(Date.now());
  fullString.feed.full = "yes";
  await assertFails(reference.set(fullString));
  await assertFails(driver.database().ref(`driverStatus/${BUS_ID}`).set({
    busId: BUS_ID,
    status: "online",
    location: { lat: 22, lng: 73 },
    lastUpdated: timestamp(),
    driverUid: DRIVER_UID,
  }));

  await assertTrackingSucceeds("start before negative checks", reference.set(startRecord(Date.now())));
  const started = (await reference.once("value")).val() as Record<string, any>;
  const changedDirection = clone(started);
  changedDirection.feed.direction = "fromCampus";
  await assertFails(reference.set(changedDirection));
  await assertFails(secondDriver.database().ref(`tracking/${BUS_ID}`).set(startRecord(Date.now(), 2, SECOND_DRIVER_UID)));

  const malformedSample = clone(started);
  malformedSample.sequence = 1;
  malformedSample.feed.heartbeatAt = timestamp();
  malformedSample.feed.lastReportCapturedAt = Date.now();
  malformedSample.feed.lastReportReceivedAt = timestamp();
  malformedSample.feed.lastValidCapturedAt = malformedSample.feed.lastReportCapturedAt;
  malformedSample.feed.lastValidReceivedAt = timestamp();
  malformedSample.feed.reportedAccuracy = 20;
  malformedSample.feed.gpsQuality = "good";
  malformedSample.feed.location = { lat: 91, lng: 73, accuracy: 20 };
  await assertFails(reference.set(malformedSample));

  const good = clone(started);
  good.sequence = 1;
  good.feed.heartbeatAt = timestamp();
  good.feed.lastReportCapturedAt = Date.now();
  good.feed.lastReportReceivedAt = timestamp();
  good.feed.lastValidCapturedAt = good.feed.lastReportCapturedAt;
  good.feed.lastValidReceivedAt = timestamp();
  good.feed.reportedAccuracy = 20;
  good.feed.gpsQuality = "good";
  good.feed.location = { lat: 22, lng: 73, accuracy: 20 };
  await assertTrackingSucceeds("good sample before negative checks", reference.set(good));

  const repeated = clone((await reference.once("value")).val());
  repeated.feed.heartbeatAt = timestamp();
  await assertFails(reference.set(repeated));

  const changedFullNoOp = clone((await reference.once("value")).val());
  changedFullNoOp.feed.full = false;
  await assertFails(reference.set(changedFullNoOp));

  const changedReportHeartbeat = clone((await reference.once("value")).val());
  changedReportHeartbeat.sequence = 2;
  changedReportHeartbeat.feed.heartbeatAt = timestamp();
  changedReportHeartbeat.feed.reportedAccuracy = 99;
  await assertFails(reference.set(changedReportHeartbeat));

  const wrongGenerationEnd = clone((await reference.once("value")).val());
  wrongGenerationEnd.feed.generation = 2;
  wrongGenerationEnd.feed.phase = "ended";
  wrongGenerationEnd.feed.endedAt = timestamp();
  wrongGenerationEnd.feed.gpsQuality = "unavailable";
  delete wrongGenerationEnd.feed.location;
  await assertFails(reference.set(wrongGenerationEnd));

  const ended = clone((await reference.once("value")).val());
  ended.feed.phase = "ended";
  ended.feed.endedAt = timestamp();
  ended.feed.gpsQuality = "unavailable";
  delete ended.feed.location;
  await assertTrackingSucceeds("end before reopen check", reference.set(ended));
  const reopened = clone((await reference.once("value")).val());
  reopened.sequence = 0;
  reopened.feed.phase = "active";
  reopened.feed.startedAt = timestamp();
  reopened.feed.heartbeatAt = timestamp();
  reopened.feed.endedAt = 0;
  reopened.feed.gpsQuality = "acquiring";
  await assertFails(reference.set(reopened));
});

test("admin force-end is narrowly limited to the exact active-to-ended transition", async () => {
  const admin = auth(environment, ADMIN_UID, ADMIN_EMAIL);
  const driver = auth(environment, DRIVER_UID, DRIVER_EMAIL);
  const student = auth(environment, STUDENT_UID, STUDENT_EMAIL);
  const adminReference = admin.database().ref(`tracking/${BUS_ID}`);
  const driverReference = driver.database().ref(`tracking/${BUS_ID}`);

  const seedActive = async (): Promise<Record<string, any>> => {
    const now = Date.now();
    const active = startRecord(now);
    active.sequence = 7;
    active.feed.startedAt = now;
    active.feed.heartbeatAt = now;
    active.feed.gpsQuality = "good";
    active.feed.lastReportCapturedAt = now;
    active.feed.lastReportReceivedAt = now;
    active.feed.reportedAccuracy = 12;
    active.feed.full = true;
    active.feed.lastValidCapturedAt = now;
    active.feed.lastValidReceivedAt = now;
    active.feed.location = { lat: 22.3072, lng: 73.1812, accuracy: 12 };
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.database().ref(`tracking/${BUS_ID}`).set(active);
    });
    return clone(active);
  };

  const active = await seedActive();
  const exactEnd = clone(active);
  exactEnd.feed.phase = "ended";
  exactEnd.feed.endedAt = timestamp();
  exactEnd.feed.gpsQuality = "unavailable";
  delete exactEnd.feed.location;
  await assertTrackingSucceeds("admin force-end", adminReference.set(exactEnd));
  const saved = (await adminReference.once("value")).val() as Record<string, any>;
  assert.equal(saved.feed.phase, "ended");
  assert.equal(saved.feed.direction, active.feed.direction);
  assert.equal(saved.feed.full, active.feed.full);
  assert.equal(saved.feed.heartbeatAt, active.feed.heartbeatAt);
  assert.equal(saved.feed.location, undefined);

  const reEnd = clone(saved);
  reEnd.feed.endedAt = timestamp();
  await assertFails(adminReference.set(reEnd));

  await environment.withSecurityRulesDisabled(async (context) => {
    await context.database().ref(`tracking/${BUS_ID}`).remove();
  });
  await assertFails(adminReference.set(startRecord(Date.now())));
  await assertFails(student.database().ref(`tracking/${BUS_ID}`).set(startRecord(Date.now(), 1, STUDENT_UID)));
  await assertTrackingSucceeds("driver start remains allowed", driverReference.set(startRecord(Date.now())));

  for (const mutate of [
    (node: Record<string, any>) => {
      node.driverUid = ADMIN_UID;
      node.feed.phase = "ended";
      node.feed.endedAt = timestamp();
      node.feed.gpsQuality = "unavailable";
      delete node.feed.location;
    },
    (node: Record<string, any>) => {
      node.feed.tripId = "55555555-5555-4555-8555-555555555555";
      node.feed.phase = "ended";
      node.feed.endedAt = timestamp();
      node.feed.gpsQuality = "unavailable";
      delete node.feed.location;
    },
    (node: Record<string, any>) => {
      node.feed.phase = "ended";
      node.feed.endedAt = timestamp();
      node.feed.gpsQuality = "unavailable";
      node.feed.direction = "fromCampus";
      delete node.feed.location;
    },
    (node: Record<string, any>) => {
      node.feed.phase = "ended";
      node.feed.endedAt = timestamp();
      node.feed.gpsQuality = "unavailable";
      node.feed.full = false;
      delete node.feed.location;
    },
    (node: Record<string, any>) => {
      node.feed.phase = "ended";
      node.feed.endedAt = timestamp();
      node.feed.gpsQuality = "unavailable";
    },
    (node: Record<string, any>) => {
      node.sequence += 1;
      node.feed.heartbeatAt = timestamp();
    },
  ]) {
    const candidate = await seedActive();
    mutate(candidate);
    await assertFails(adminReference.set(candidate));
  }
  await seedActive();
  await assertFails(adminReference.remove());

  const driverActive = await seedActive();
  driverActive.feed.phase = "ended";
  driverActive.feed.endedAt = timestamp();
  driverActive.feed.gpsQuality = "unavailable";
  delete driverActive.feed.location;
  await assertTrackingSucceeds("driver own end remains allowed", driverReference.set(driverActive));
  const driverEnded = (await driverReference.once("value")).val() as Record<string, any>;
  assert.equal(driverEnded.feed.direction, "toCampus");
  assert.equal(driverEnded.feed.full, true);
});

test("a stale owner can be replaced only by a new generation, and the old generation cannot publish", async () => {
  const driver = auth(environment, DRIVER_UID, DRIVER_EMAIL);
  const secondDriver = auth(environment, SECOND_DRIVER_UID, SECOND_DRIVER_EMAIL);
  const stale = startRecord(Date.now() - 120000);
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.database().ref(`tracking/${BUS_ID}`).set({
      ...stale,
      feed: {
        ...(stale.feed as Record<string, unknown>),
        startedAt: 1,
        heartbeatAt: 1,
      },
    });
  });

  await assertFails(secondDriver.database().ref(`tracking/${BUS_ID}`).set(
    startRecord(Date.now() - 120_000, 2, SECOND_DRIVER_UID, "55555555-5555-4555-8555-555555555555"),
  ));
  await assertTrackingSucceeds(
    "expired-owner replacement",
    secondDriver.database().ref(`tracking/${BUS_ID}`).set(
      startRecord(Date.now(), 2, SECOND_DRIVER_UID, "55555555-5555-4555-8555-555555555555"),
    ),
  );
  const oldSample = clone(stale);
  oldSample.sequence = 1;
  oldSample.feed.heartbeatAt = timestamp();
  oldSample.feed.lastReportCapturedAt = Date.now();
  oldSample.feed.lastReportReceivedAt = timestamp();
  oldSample.feed.reportedAccuracy = 10;
  oldSample.feed.lastValidCapturedAt = oldSample.feed.lastReportCapturedAt;
  oldSample.feed.lastValidReceivedAt = timestamp();
  oldSample.feed.gpsQuality = "good";
  oldSample.feed.location = { lat: 22, lng: 73, accuracy: 10 };
  await assertFails(driver.database().ref(`tracking/${BUS_ID}`).set(oldSample));
});

test("an absent bus can receive an ended tombstone and cannot reopen that generation", async () => {
  const driver = auth(environment, DRIVER_UID, DRIVER_EMAIL);
  const reference = driver.database().ref(`tracking/${BUS_ID}`);
  const cancelled = startRecord(Date.now() - 120000);
  cancelled.sequence = 0;
  cancelled.feed.phase = "ended";
  cancelled.feed.startedAt = timestamp();
  cancelled.feed.endedAt = timestamp();
  cancelled.feed.heartbeatAt = timestamp();
  cancelled.feed.gpsQuality = "unavailable";
  delete cancelled.feed.direction;
  await assertTrackingSucceeds("absent-node tombstone", reference.set(cancelled));

  const tombstoneDirection = clone(cancelled);
  tombstoneDirection.feed.direction = "toCampus";
  await assertFails(reference.set(tombstoneDirection));
  const tombstoneFull = clone(cancelled);
  tombstoneFull.feed.full = true;
  await assertFails(reference.set(tombstoneFull));

  const reopened = startRecord(Date.now() - 120000, 1);
  await assertFails(reference.set(reopened));
  await assertFails(reference.set(startRecord(Date.now() - 120000, 2)));
  await assertTrackingSucceeds("fresh next-generation start after tombstone", reference.set(startRecord(Date.now(), 2)));
});
// ASG-01: dated assignments live under assignments/{driverUid}/{date_shiftKey_busId}.
const THIRD_BUS_ID = "BUS3";
const THIRD_ROUTE_ID = "55555555-5555-4555-8555-555555555555";
const IST_OFFSET_MS = 19_800_000;
const DAY_MS = 86_400_000;
const serviceDay = (offsetDays = 0): { serviceDate: string; startsAt: number; endsAt: number } => {
  const startsAt = Math.floor((Date.now() + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS + offsetDays * DAY_MS;
  return { serviceDate: new Date(startsAt + IST_OFFSET_MS).toISOString().slice(0, 10), startsAt, endsAt: startsAt + DAY_MS };
};
const assignmentRecord = (offsetDays = 0, driverUid = DRIVER_UID, driverEmail = DRIVER_EMAIL): Record<string, any> => {
  const day = serviceDay(offsetDays);
  return {
    id: `${day.serviceDate}_morning_${THIRD_BUS_ID}`,
    driverUid,
    driverEmail,
    busId: THIRD_BUS_ID,
    routeId: THIRD_ROUTE_ID,
    routeVersion: 1,
    shift: "morning",
    serviceDate: day.serviceDate,
    startsAt: day.startsAt,
    endsAt: day.endsAt,
    createdAt: timestamp(),
    createdBy: ADMIN_UID,
  };
};
const seedThirdBus = async (): Promise<void> => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await context.database().ref(`buses/${THIRD_BUS_ID}`).set(bus(THIRD_BUS_ID));
    await context.database().ref(`routes/${THIRD_ROUTE_ID}`).set({ ...validRoute, id: THIRD_ROUTE_ID, busNumber: THIRD_BUS_ID, publishedVersion: 1 });
  });
};

test("dated assignments are admin-written with a verified shape and readable by their driver or an admin (ASG-01)", async () => {
  await seedThirdBus();
  const admin = auth(environment, ADMIN_UID, ADMIN_EMAIL);
  const root = auth(environment, ROOT_UID, ROOT_EMAIL);
  const driver = auth(environment, DRIVER_UID, DRIVER_EMAIL);
  const secondDriver = auth(environment, SECOND_DRIVER_UID, SECOND_DRIVER_EMAIL);
  const student = auth(environment, STUDENT_UID, STUDENT_EMAIL);
  const record = assignmentRecord();
  const path = `assignments/${DRIVER_UID}/${record.id}`;

  await assertFails(driver.database().ref(path).set(record));
  const broken = (patch: Record<string, unknown>, id = record.id) =>
    assertFails(admin.database().ref(`assignments/${DRIVER_UID}/${id}`).set({ ...record, ...patch, id }));
  await broken({}, `${record.serviceDate}_morning_${BUS_ID}`); // key names another bus
  await broken({ serviceDate: serviceDay(1).serviceDate }); // key date differs from the record
  await broken({ startsAt: record.startsAt + 3_600_000 }); // not an IST midnight
  await broken({ endsAt: record.endsAt + 1 });
  await broken({ shift: "evening" }); // not the route's shift
  await broken({ busId: BUS_ID }, `${record.serviceDate}_morning_${BUS_ID}`); // route belongs to BUS3
  await broken({ busId: "BUS9" }, `${record.serviceDate}_morning_BUS9`); // unregistered bus
  await broken({ driverEmail: SECOND_DRIVER_EMAIL });
  await broken({ routeVersion: 0 });
  await broken({ note: "extra" });
  await broken({ createdBy: DRIVER_UID });
  await assertFails(admin.database().ref(`assignments/${STUDENT_UID}/${record.id}`).set({ ...record, driverUid: STUDENT_UID, driverEmail: STUDENT_EMAIL }));
  await assertFails(admin.database().ref(`assignments/${DRIVER_UID}/${record.id}`).set({ ...record, driverUid: SECOND_DRIVER_UID }));

  await assertSucceeds(admin.database().ref(path).set(record));
  const { routeVersion: _routeVersion, ...legacyRoute } = assignmentRecord(1);
  await assertSucceeds(admin.database().ref(`assignments/${DRIVER_UID}/${legacyRoute.id}`).set(legacyRoute));

  await assertSucceeds(driver.database().ref(`assignments/${DRIVER_UID}`).once("value"));
  await assertFails(secondDriver.database().ref(`assignments/${DRIVER_UID}`).once("value"));
  await assertFails(student.database().ref(`assignments/${STUDENT_UID}`).once("value"));
  await assertFails(driver.database().ref("assignments").once("value"));
  const all = await assertSucceeds(admin.database().ref("assignments").once("value"));
  assert.equal(Object.keys(all.val()[DRIVER_UID]).length, 2);
  await assertFails(driver.database().ref(path).remove());
  await assertSucceeds(admin.database().ref(path).remove());

  // Root keeps role=admin but is a driver-capable assignment target. Other
  // admins may not mutate the owner's dated records.
  const rootRecord: Record<string, any> = { ...assignmentRecord(0, ROOT_UID, ROOT_EMAIL), createdBy: ROOT_UID };
  const rootPath = `assignments/${ROOT_UID}/${rootRecord.id}`;
  await assertFails(admin.database().ref(rootPath).set(rootRecord));
  await assertSucceeds(root.database().ref(rootPath).set(rootRecord));
  await assertSucceeds(root.database().ref(`assignments/${ROOT_UID}`).once("value"));
});

test("a dated assignment admits Start on another bus for its day and keeps admitting the same trip (ASG-01)", async () => {
  await seedThirdBus();
  const admin = auth(environment, ADMIN_UID, ADMIN_EMAIL);
  const driver = auth(environment, DRIVER_UID, DRIVER_EMAIL);
  const secondDriver = auth(environment, SECOND_DRIVER_UID, SECOND_DRIVER_EMAIL);
  const student = auth(environment, STUDENT_UID, STUDENT_EMAIL);
  const today = assignmentRecord();
  const tomorrow = assignmentRecord(1);
  await assertSucceeds(admin.database().ref(`assignments/${DRIVER_UID}/${today.id}`).set(today));
  await assertSucceeds(admin.database().ref(`assignments/${DRIVER_UID}/${tomorrow.id}`).set(tomorrow));
  const reference = driver.database().ref(`tracking/${THIRD_BUS_ID}`);
  const start = (assignmentId?: string, driverUid = DRIVER_UID): Record<string, any> => {
    const record = startRecord(Date.now(), 1, driverUid);
    record.feed.busId = THIRD_BUS_ID;
    if (assignmentId) record.feed.assignmentId = assignmentId;
    return record;
  };

  // Any approved driver may read the node now (the API preflights the CAS with the driver's token); students still may not.
  await assertSucceeds(reference.once("value"));
  await assertSucceeds(secondDriver.database().ref(`tracking/${THIRD_BUS_ID}`).once("value"));
  await assertFails(student.database().ref(`tracking/${THIRD_BUS_ID}`).once("value"));

  await assertFails(reference.set(start())); // not the standing bus and no assignment named
  await assertFails(reference.set(start(tomorrow.id))); // window does not cover now
  await assertFails(reference.set(start("not-a-key")));
  await assertFails(secondDriver.database().ref(`tracking/${THIRD_BUS_ID}`).set(start(today.id, SECOND_DRIVER_UID))); // not their assignment
  await assertTrackingSucceeds("override start", reference.set(start(today.id)));
  const started = (await reference.once("value")).val() as Record<string, any>;
  assert.equal(started.feed.assignmentId, today.id);

  const sample = (changes: (record: Record<string, any>) => void): Record<string, any> => {
    const record = clone(started);
    record.sequence = 1;
    record.feed.heartbeatAt = timestamp();
    record.feed.lastReportCapturedAt = Date.now();
    record.feed.lastReportReceivedAt = timestamp();
    record.feed.reportedAccuracy = 12;
    record.feed.lastValidCapturedAt = record.feed.lastReportCapturedAt;
    record.feed.lastValidReceivedAt = timestamp();
    record.feed.gpsQuality = "good";
    record.feed.location = { lat: 22.3072, lng: 73.1812, accuracy: 12 };
    changes(record);
    return record;
  };
  await assertFails(reference.set(sample((record) => { record.feed.assignmentId = tomorrow.id; }))); // frozen after Start
  await assertFails(reference.set(sample((record) => { delete record.feed.assignmentId; })));
  await assertTrackingSucceeds("override sample", reference.set(sample(() => {})));

  const ended = clone((await reference.once("value")).val() as Record<string, any>);
  ended.feed.phase = "ended";
  ended.feed.endedAt = timestamp();
  ended.feed.gpsQuality = "unavailable";
  delete ended.feed.location;
  await assertTrackingSucceeds("override end", reference.set(ended));

  // A trip opened yesterday under an expired assignment can still report and end (24 h grace, as in the API), but not restart.
  const yesterday = assignmentRecord(-1);
  const seedRunning = async (assignmentId: string, heartbeatAgoMs: number, record = yesterday): Promise<void> => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.database().ref(`assignments/${DRIVER_UID}/${record.id}`).set({ ...record, createdAt: 1 });
      const running = start(assignmentId);
      running.feed.generation = 2;
      running.feed.startedAt = Date.now() - 600_000;
      running.feed.heartbeatAt = Date.now() - heartbeatAgoMs;
      await context.database().ref(`tracking/${THIRD_BUS_ID}`).set(running);
    });
  };
  await seedRunning(yesterday.id, 5_000);
  const lateSample = clone((await reference.once("value")).val() as Record<string, any>);
  lateSample.sequence = 1;
  lateSample.feed.heartbeatAt = timestamp();
  await assertTrackingSucceeds("sample after the assignment day ended", reference.set(lateSample));
  // Past the grace the pinned assignment no longer authorises anything: an abandoned node cannot be kept alive for days.
  const twoDaysAgo = assignmentRecord(-2);
  await seedRunning(twoDaysAgo.id, 5_000, twoDaysAgo);
  const staleSample = clone((await reference.once("value")).val() as Record<string, any>);
  staleSample.sequence = 1;
  staleSample.feed.heartbeatAt = timestamp();
  await assertFails(reference.set(staleSample));
  // Same stale node, same restart: only the assignment window differs.
  await seedRunning(yesterday.id, 120_000);
  const restartExpired = start(yesterday.id);
  restartExpired.feed.generation = 3;
  await assertFails(reference.set(restartExpired));
  await seedRunning(today.id, 120_000);
  const restartToday = start(today.id);
  restartToday.feed.generation = 3;
  await assertTrackingSucceeds("restart under today's assignment", reference.set(restartToday));
});
