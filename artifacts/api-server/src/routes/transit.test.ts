import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { verifyIdToken, fetchFirebase, getApps, initializeApp } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  fetchFirebase: vi.fn(),
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(() => ({ name: "pu-transit-api" })),
}));

vi.mock("firebase-admin/app", () => ({ getApps, initializeApp }));
vi.mock("firebase-admin/auth", () => ({
  getAuth: vi.fn(() => ({ verifyIdToken })),
}));
vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
  },
  routesTable: {},
}));

import app from "../app";
import { resetRateLimits } from "../middleware/rate-limit";

describe("Transit API Firebase boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
    process.env.FIREBASE_PROJECT_ID = "pu-transit-f815d";
    process.env.FIREBASE_DATABASE_URL =
      "https://pu-transit-f815d-default-rtdb.firebaseio.com";
    process.env.UNIVERSITY_EMAIL_DOMAINS = "paruluniversity.ac.in";
    fetchFirebase.mockReset();
    vi.stubGlobal("fetch", fetchFirebase);
  });

  it("does not expose routes without a Firebase token", async () => {
    const response = await request(app).get("/api/routes");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: "Authentication required",
      code: "AUTH_REQUIRED",
    });
    expect(fetchFirebase).not.toHaveBeenCalled();
  });

  it("does not invoke error middleware for an unmatched URL", async () => {
    const response = await request(app).get("/");
    expect(response.status).toBe(404);
  });

  it("returns a structured client error for malformed JSON", async () => {
    const response = await request(app)
      .post("/api/routes")
      .set("Content-Type", "application/json")
      .send("{");
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_REQUEST");
    expect(fetchFirebase).not.toHaveBeenCalled();
  });

  it("protects both tracking reads without a Firebase token", async () => {
    const collection = await request(app).get("/api/tracking");
    const feed = await request(app).get("/api/tracking/BUS-1");

    expect(collection.status).toBe(401);
    expect(feed.status).toBe(401);
    expect(fetchFirebase).not.toHaveBeenCalled();
  });

  it("protects audit and force-end without a Firebase token", async () => {
    const audit = await request(app).get("/api/audit");
    const forceEnd = await request(app).post("/api/tracking/BUS-1/force-end").send({});
    expect(audit.status).toBe(401);
    expect(forceEnd.status).toBe(401);
  });

  it("rejects audit access and force-end for a non-admin member", async () => {
    const identity = {
      uid: "student",
      email: "student@paruluniversity.ac.in",
      email_verified: true,
    };
    const member = {
      uid: "student",
      email: identity.email,
      role: "student",
      status: "approved",
      active: true,
      assignedBusId: "",
      createdAt: 1,
      updatedAt: 1,
    };
    verifyIdToken.mockResolvedValue(identity);
    fetchFirebase.mockImplementation(async () =>
      new Response(JSON.stringify(member), { status: 200 }));
    const audit = await request(app).get("/api/audit").set("Authorization", "Bearer token");
    const forceEnd = await request(app)
      .post("/api/tracking/BUS-1/force-end")
      .set("Authorization", "Bearer token")
      .send({});
    expect(audit.status).toBe(403);
    expect(forceEnd.status).toBe(403);
  });

  it("validates the audit list limit for an admin", async () => {
    const identity = {
      uid: "admin",
      email: "admin@paruluniversity.ac.in",
      email_verified: true,
    };
    const member = {
      uid: "admin",
      email: identity.email,
      role: "admin",
      status: "approved",
      active: true,
      assignedBusId: "",
      createdAt: 1,
      updatedAt: 1,
    };
    verifyIdToken.mockResolvedValue(identity);
    fetchFirebase.mockResolvedValue(new Response(JSON.stringify(member), { status: 200 }));
    const response = await request(app)
      .get("/api/audit?limit=201")
      .set("Authorization", "Bearer token");
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_REQUEST");
  });

  it("force-ends an active trip and appends its audit record", async () => {
    const now = Date.now();
    const identity = {
      uid: "admin",
      email: "admin@paruluniversity.ac.in",
      email_verified: true,
    };
    const member = {
      uid: "admin",
      email: identity.email,
      role: "admin",
      status: "approved",
      active: true,
      assignedBusId: "",
      createdAt: 1,
      updatedAt: 1,
    };
    const node = {
      driverUid: "driver",
      publisherId: "11111111-1111-4111-8111-111111111111",
      sequence: 1,
      feed: {
        protocolVersion: 2,
        busId: "BUS-1",
        tripId: "22222222-2222-4222-8222-222222222222",
        generation: 1,
        phase: "active",
        requestedAt: now,
        startedAt: now,
        endedAt: 0,
        heartbeatAt: now,
        gpsQuality: "acquiring",
        lastReportCapturedAt: 0,
        lastReportReceivedAt: 0,
        reportedAccuracy: 0,
        lastValidCapturedAt: 0,
        lastValidReceivedAt: 0,
      },
    };
    const ended = {
      ...node,
      feed: { ...node.feed, phase: "ended", endedAt: now, gpsQuality: "unavailable" },
    };
    verifyIdToken.mockResolvedValue(identity);
    fetchFirebase
      .mockResolvedValueOnce(new Response(JSON.stringify(member), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(node), { status: 200, headers: { etag: "v1" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(ended), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(ended), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: "-audit-id" }), { status: 200 }));
    const response = await request(app)
      .post("/api/tracking/BUS-1/force-end")
      .set("Authorization", "Bearer token")
      .send({ reason: "dispatch request" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ outcome: "ended", auditId: "-audit-id" });
    expect(fetchFirebase.mock.calls[4]?.[1]?.method).toBe("POST");
  });

  it("never authorizes the removed shared password", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({ password: "disabled-test-password" });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("LEGACY_AUTH_DISABLED");
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("returns an unverified university user without reading RTDB", async () => {
    verifyIdToken.mockResolvedValueOnce({
      uid: "firebase-user",
      email: "student@paruluniversity.ac.in",
      email_verified: false,
    });

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer firebase-token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      uid: "firebase-user",
      email: "student@paruluniversity.ac.in",
      emailVerified: false,
      universityEmail: true,
      graceEndsAt: null,
      membership: null,
      bus: null,
      assignments: [],
    });
    expect(fetchFirebase).not.toHaveBeenCalled();
  });

  it("reports the grace deadline for a personal-email student and syncs a new university email", async () => {
    verifyIdToken.mockResolvedValue({
      uid: "firebase-user",
      email: "student@gmail.com",
      email_verified: true,
    });
    const member = {
      uid: "firebase-user",
      email: "student@gmail.com",
      role: "student",
      status: "approved",
      active: true,
      assignedBusId: "",
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };
    fetchFirebase.mockResolvedValueOnce(new Response(JSON.stringify(member), { status: 200 }));
    const personal = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer firebase-token");
    expect(personal.status).toBe(200);
    expect(personal.body.universityEmail).toBe(false);
    expect(personal.body.graceEndsAt).toBe(1700000000000 + 30 * 24 * 60 * 60 * 1000);
    expect(personal.body.membership.requestedRole).toBeNull();
    expect(personal.body.membership.root).toBe(false);
    expect(fetchFirebase).toHaveBeenCalledTimes(1);

    verifyIdToken.mockResolvedValue({
      uid: "firebase-user",
      email: "student@paruluniversity.ac.in",
      email_verified: true,
    });
    const synced = { ...member, email: "student@paruluniversity.ac.in" };
    fetchFirebase
      .mockResolvedValueOnce(new Response(JSON.stringify(member), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(synced), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(synced), { status: 200 }));
    const switched = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer firebase-token");
    expect(switched.status).toBe(200);
    expect(switched.body.graceEndsAt).toBeNull();
    expect(switched.body.membership.email).toBe("student@paruluniversity.ac.in");
    const [, init] = fetchFirebase.mock.calls[2] as [string, RequestInit];
    expect(init.method).toBe("PUT");
    const written = JSON.parse(String(init.body));
    expect(written.email).toBe("student@paruluniversity.ac.in");
    expect(written.role).toBe("student");
    expect(written.createdAt).toBe(member.createdAt);
    expect(written.requestedRole).toBeUndefined();
  });

  it("blocks a personal-email student whose grace period has ended", async () => {
    verifyIdToken.mockResolvedValue({
      uid: "expired",
      email: "expired@gmail.com",
      email_verified: true,
    });
    const member = {
      uid: "expired",
      email: "expired@gmail.com",
      role: "student",
      status: "approved",
      active: true,
      assignedBusId: "",
      createdAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
      updatedAt: 1,
    };
    fetchFirebase.mockResolvedValue(new Response(JSON.stringify(member), { status: 200 }));
    const response = await request(app).get("/api/routes").set("Authorization", "Bearer token");
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("UNIVERSITY_EMAIL_REQUIRED");
  });

  it("does not let a verified personal token use a stored-university admin membership", async () => {
    verifyIdToken.mockResolvedValue({
      uid: "stored-admin",
      email: "stored-admin@gmail.com",
      email_verified: true,
    });
    fetchFirebase.mockResolvedValue(
      new Response(
        JSON.stringify({
          uid: "stored-admin",
          email: "stored-admin@paruluniversity.ac.in",
          role: "admin",
          status: "approved",
          active: true,
          assignedBusId: "",
          createdAt: 1,
          updatedAt: 1,
        }),
        { status: 200 },
      ),
    );

    const response = await request(app)
      .get("/api/migration/preview")
      .set("Authorization", "Bearer verified-personal-token");

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("MEMBERSHIP_EMAIL_MISMATCH");
  });

  // AC-32 / IDN-04: the approval is bound to the uid AND the email. A changed claim gets the old record
  // back only through /auth/me (so the UI can explain it); every protected route refuses it.
  it("denies a changed or unverified email the stored approval, and rebinds only a verified university email", async () => {
    const approvedDriver = {
      uid: "renamed-driver",
      email: "renamed@paruluniversity.ac.in",
      role: "driver",
      status: "approved",
      active: true,
      assignedBusId: "BUS1",
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };
    // the membership as stored; every other read (bus, assignments) is empty — or, for a mismatched
    // token, denied by Rules exactly as the emulator does
    const stored = (record: object, othersDenied = false) => (url: string) =>
      String(url).includes("/memberships/")
        ? new Response(JSON.stringify(record), { status: 200 })
        : othersDenied
          ? new Response(JSON.stringify({ error: "Permission denied" }), { status: 401 })
          : new Response("null", { status: 200 });

    // 1. the address became a personal one (console / another client), verified
    verifyIdToken.mockResolvedValue({ uid: "renamed-driver", email: "renamed@gmail.com", email_verified: true });
    fetchFirebase.mockImplementation(stored(approvedDriver, true));
    const me = await request(app).get("/api/auth/me").set("Authorization", "Bearer changed-token");
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("renamed@gmail.com");
    expect(me.body.membership.email).toBe("renamed@paruluniversity.ac.in"); // stored, not rebound
    expect(me.body).toMatchObject({ bus: null, assignments: [] }); // no bus/assignment reads: Rules would deny them
    expect(fetchFirebase).toHaveBeenCalledTimes(1);
    expect(fetchFirebase.mock.calls.every(([, init]) => ((init as RequestInit | undefined)?.method ?? "GET") === "GET")).toBe(true);
    for (const attempt of [
      request(app).get("/api/routes"),
      request(app).post("/api/tracking/BUS1/start").send({ tripId: "0f0b3b0e-2f5f-4f0c-9c0e-4c9e6a2d1a11", generation: 1 }),
    ]) {
      const response = await attempt.set("Authorization", "Bearer changed-token");
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("MEMBERSHIP_EMAIL_MISMATCH");
    }

    // 2. a new address that is not verified yet: nothing is read, nothing is granted
    fetchFirebase.mockReset();
    verifyIdToken.mockResolvedValue({ uid: "renamed-driver", email: "renamed2@paruluniversity.ac.in", email_verified: false });
    const unverified = await request(app).get("/api/auth/me").set("Authorization", "Bearer unverified-token");
    expect(unverified.status).toBe(200);
    expect(unverified.body).toMatchObject({ emailVerified: false, membership: null });
    const refused = await request(app).get("/api/routes").set("Authorization", "Bearer unverified-token");
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("EMAIL_UNVERIFIED");
    expect(fetchFirebase).not.toHaveBeenCalled();

    // 3. the same address once verified: the record follows the token, role and dates intact
    verifyIdToken.mockResolvedValue({ uid: "renamed-driver", email: "renamed2@paruluniversity.ac.in", email_verified: true });
    const rebound = { ...approvedDriver, email: "renamed2@paruluniversity.ac.in" };
    fetchFirebase
      .mockImplementationOnce(stored(approvedDriver))
      .mockImplementationOnce(stored(rebound)) // the PUT echoes the written record
      .mockImplementation(stored(rebound));
    const synced = await request(app).get("/api/auth/me").set("Authorization", "Bearer verified-token");
    expect(synced.status).toBe(200);
    expect(synced.body.membership).toMatchObject({ email: "renamed2@paruluniversity.ac.in", role: "driver", status: "approved" });
    const [, put] = fetchFirebase.mock.calls[1] as [string, RequestInit];
    expect(put.method).toBe("PUT");
    expect(JSON.parse(String(put.body))).toMatchObject({ email: "renamed2@paruluniversity.ac.in", role: "driver", createdAt: approvedDriver.createdAt });
  });

  it("refuses staff, driver, and admin sign-ups from a personal email", async () => {
    verifyIdToken.mockResolvedValue({
      uid: "personal",
      email: "personal@gmail.com",
      email_verified: true,
    });
    for (const role of ["staff", "driver", "admin"]) {
      const response = await request(app)
        .post("/api/auth/membership")
        .set("Authorization", "Bearer token")
        .send({ role });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("UNIVERSITY_EMAIL_REQUIRED");
    }
    expect(fetchFirebase).not.toHaveBeenCalled();
  });

  it("validates, filters, audits, and protects notices", async () => {
    const adminIdentity = {
      uid: "notice-admin",
      email: "notice-admin@paruluniversity.ac.in",
      email_verified: true,
    };
    const adminMember = {
      uid: adminIdentity.uid,
      email: adminIdentity.email,
      role: "admin",
      status: "approved",
      active: true,
      assignedBusId: "",
      createdAt: 1,
      updatedAt: 1,
    };
    const studentIdentity = {
      uid: "notice-student",
      email: "notice-student@paruluniversity.ac.in",
      email_verified: true,
    };
    const studentMember = {
      uid: studentIdentity.uid,
      email: studentIdentity.email,
      role: "student",
      status: "approved",
      active: true,
      assignedBusId: "",
      createdAt: 1,
      updatedAt: 1,
    };
    const notices: Record<string, Record<string, unknown>> = {};
    const auditActions: string[] = [];

    verifyIdToken.mockImplementation(async (token: string) =>
      token === "student-token" ? studentIdentity : adminIdentity);
    fetchFirebase.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.includes("/memberships/notice-admin")) {
        return new Response(JSON.stringify(adminMember), { status: 200 });
      }
      if (url.includes("/memberships/notice-student")) {
        return new Response(JSON.stringify(studentMember), { status: 200 });
      }
      if (url.includes("/notices/") && method === "PUT") {
        const notice = JSON.parse(String(init?.body)) as Record<string, unknown>;
        notice.createdAt = Date.now();
        notices[String(notice.id)] = notice;
        return new Response(JSON.stringify(notice), { status: 200 });
      }
      if (url.includes("/notices/") && method === "DELETE") {
        const id = url.split("/notices/")[1]?.split(".json")[0] ?? "";
        delete notices[decodeURIComponent(id)];
        return new Response("null", { status: 200 });
      }
      if (url.includes("/notices/")) {
        const id = url.split("/notices/")[1]?.split(".json")[0] ?? "";
        return new Response(JSON.stringify(notices[decodeURIComponent(id)] ?? null), { status: 200 });
      }
      if (url.includes("/notices.json")) {
        return new Response(JSON.stringify(notices), { status: 200 });
      }
      if (url.includes("/audit") && method === "POST") {
        const entry = JSON.parse(String(init?.body)) as { action?: string };
        auditActions.push(String(entry.action));
        return new Response(JSON.stringify({ name: "-notice-audit" }), { status: 200 });
      }
      return new Response("null", { status: 200 });
    });

    const until = Date.now() + 60 * 60 * 1000;
    const created = await request(app)
      .post("/api/notices")
      .set("Authorization", "Bearer admin-token")
      .send({ text: "Campus gate closes at 6.", routeId: "", until });
    expect(created.status).toBe(201);
    expect(created.body.text).toBe("Campus gate closes at 6.");
    expect(auditActions).toEqual(["notice.save"]);

    for (const body of [
      { text: "x", routeId: "", until: Date.now() - 1 },
      { text: "", routeId: "", until },
      { text: "x", routeId: "not-a-uuid", until },
    ]) {
      const response = await request(app)
        .post("/api/notices")
        .set("Authorization", "Bearer admin-token")
        .send(body);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("INVALID_REQUEST");
    }

    notices.expired = {
      id: "expired",
      text: "Expired",
      routeId: "",
      until: Date.now() - 1,
      createdBy: adminIdentity.uid,
      createdAt: 1,
    };
    const listed = await request(app)
      .get("/api/notices")
      .set("Authorization", "Bearer admin-token");
    expect(listed.status).toBe(200);
    expect(listed.body.map((notice: { id: string }) => notice.id)).not.toContain("expired");

    const deleted = await request(app)
      .delete(`/api/notices/${created.body.id}`)
      .set("Authorization", "Bearer admin-token");
    expect(deleted.status).toBe(204);
    expect(auditActions).toEqual(["notice.save", "notice.delete"]);

    const studentWrite = await request(app)
      .post("/api/notices")
      .set("Authorization", "Bearer student-token")
      .send({ text: "Nope", routeId: "", until });
    expect(studentWrite.status).toBe(403);
    expect(studentWrite.body.code).toBe("ROLE_REQUIRED");
  });

  it("stores a driver sign-up as an approved student with a role request", async () => {
    verifyIdToken.mockResolvedValueOnce({
      uid: "firebase-user",
      email: "driver@paruluniversity.ac.in",
      email_verified: true,
    });
    const member = {
      uid: "firebase-user",
      email: "driver@paruluniversity.ac.in",
      role: "student",
      status: "approved",
      active: true,
      assignedBusId: "",
      requestedRole: "driver",
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };
    fetchFirebase
      .mockResolvedValueOnce(new Response("null", { status: 200, headers: { etag: "null_etag" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(member), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(member), { status: 200 }));
    const response = await request(app)
      .post("/api/auth/membership")
      .set("Authorization", "Bearer firebase-token")
      .send({ role: "driver" });
    expect(response.status).toBe(201);
    expect(response.body.role).toBe("student");
    expect(response.body.requestedRole).toBe("driver");
    const [, init] = fetchFirebase.mock.calls[1] as [string, RequestInit];
    const written = JSON.parse(String(init.body));
    expect(written).toMatchObject({ role: "student", status: "approved", active: true, requestedRole: "driver" });
  });

  it("keeps the root administrator out of other administrators' hands", async () => {
    verifyIdToken.mockResolvedValue({
      uid: "admin",
      email: "admin@paruluniversity.ac.in",
      email_verified: true,
    });
    const admin = {
      uid: "admin",
      email: "admin@paruluniversity.ac.in",
      role: "admin",
      status: "approved",
      active: true,
      assignedBusId: "",
      createdAt: 1,
      updatedAt: 1,
    };
    const root = { ...admin, uid: "hqKU3amnTzVBT3yF3p4DMRnirDq1", email: "owner@paruluniversity.ac.in" };
    fetchFirebase
      .mockResolvedValueOnce(new Response(JSON.stringify(admin), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(root), { status: 200 }));
    const response = await request(app)
      .patch("/api/memberships/hqKU3amnTzVBT3yF3p4DMRnirDq1")
      .set("Authorization", "Bearer token")
      .send({ status: "suspended" });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("ROOT_ADMIN_PROTECTED");
    expect(fetchFirebase).toHaveBeenCalledTimes(2);
  });

  it("forwards the Firebase token to RTDB for a membership request", async () => {
    verifyIdToken.mockResolvedValueOnce({
      uid: "firebase-user",
      email: "student@paruluniversity.ac.in",
      email_verified: true,
    });
    const member = {
      uid: "firebase-user",
      email: "student@paruluniversity.ac.in",
      role: "student",
      status: "approved",
      active: true,
      assignedBusId: "",
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };
    fetchFirebase
      .mockResolvedValueOnce(new Response("null", { status: 200, headers: { etag: "null_etag" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(member), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(member), { status: 200 }));

    const response = await request(app)
      .post("/api/auth/membership")
      .set("Authorization", "Bearer firebase-token")
      .send({ role: "student" });

    expect([200, 201]).toContain(response.status);
    expect(response.body.uid).toBe(member.uid);
    expect(response.body.email).toBe(member.email);
    expect(response.body.role).toBe("student");
    expect(response.body.status).toBe("approved");
    expect(response.body.active).toBe(true);
    expect(response.body.requestedRole).toBeNull();
    expect(response.body.root).toBe(false);
    expect(response.body.createdAt).toEqual(expect.any(Number));
    expect(response.body.updatedAt).toEqual(expect.any(Number));
    expect(fetchFirebase).toHaveBeenCalledTimes(3);
    const [url, init] = fetchFirebase.mock.calls[1] as [string, RequestInit];
    expect(url).toContain("auth=firebase-token");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body)).createdAt).toEqual({ ".sv": "timestamp" });
    expect(JSON.parse(String(init.body)).updatedAt).toEqual({ ".sv": "timestamp" });
  });
});