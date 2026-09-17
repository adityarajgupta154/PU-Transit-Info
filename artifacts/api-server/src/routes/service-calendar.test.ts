import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { verifyIdToken, fetchFirebase, getApps, initializeApp } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  fetchFirebase: vi.fn(),
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(() => ({ name: "pu-transit-api" })),
}));

vi.mock("firebase-admin/app", () => ({ getApps, initializeApp }));
vi.mock("firebase-admin/auth", () => ({ getAuth: vi.fn(() => ({ verifyIdToken })) }));
vi.mock("@workspace/db", () => ({ db: { select: vi.fn() }, routesTable: {} }));

import app from "../app";
import { resetRateLimits } from "../middleware/rate-limit";
import { fakeDatabase as fakeDb, member, type Json } from "./fake-database";

const fakeDatabase = (initial: Json) => fakeDb(fetchFirebase, initial);
const seed = (): Json => ({ memberships: { admin: member("admin", "admin"), student: member("student", "student") } });
const as = (uid: string) => `Bearer ${uid}-token`;
const put = (date: string, body: object, uid = "admin") =>
  request(app).put(`/api/service-calendar/${date}`).set("Authorization", as(uid)).send(body);
const list = (uid = "student") => request(app).get("/api/service-calendar").set("Authorization", as(uid));

describe("Service calendar (STU-04b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
    process.env.FIREBASE_PROJECT_ID = "pu-transit-f815d";
    process.env.FIREBASE_DATABASE_URL = "https://pu-transit-f815d-default-rtdb.firebaseio.com";
    process.env.UNIVERSITY_EMAIL_DOMAINS = "paruluniversity.ac.in";
    fetchFirebase.mockReset();
    vi.stubGlobal("fetch", fetchFirebase);
    verifyIdToken.mockImplementation(async (token: string) => {
      const uid = token.replace(/-token$/, "");
      if (uid === token) throw new Error("bad token");
      return { uid, email: `${uid}@paruluniversity.ac.in`, email_verified: true };
    });
  });

  it("admin marks, re-marks and clears a day; members read it earliest first; every change is audited", async () => {
    const database = fakeDatabase(seed());
    expect((await list()).body).toEqual([]); // nothing marked → nothing claimed

    const saved = await put("2026-11-08", { noService: true, note: " Diwali holiday " });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ date: "2026-11-08", noService: true, note: "Diwali holiday", updatedBy: "admin" });
    expect(database.at(["serviceCalendar", "2026-11-08", "note"])).toBe("Diwali holiday");

    expect((await put("2026-10-02", { noService: true })).body).toEqual({ date: "2026-10-02", noService: true, updatedBy: "admin", updatedAt: expect.any(Number) });
    expect((await put("2026-11-08", { noService: true, note: "Diwali" })).body.note).toBe("Diwali"); // idempotent upsert
    expect((await list()).body.map((d: { date: string }) => d.date)).toEqual(["2026-10-02", "2026-11-08"]);

    const gone = await request(app).delete("/api/service-calendar/2026-10-02").set("Authorization", as("admin"));
    expect(gone.status).toBe(204);
    expect((await request(app).delete("/api/service-calendar/2026-10-02").set("Authorization", as("admin"))).status).toBe(404);
    expect((await list()).body.map((d: { date: string }) => d.date)).toEqual(["2026-11-08"]);

    expect(database.audits.map((a) => a.action)).toEqual(["calendar.save", "calendar.save", "calendar.save", "calendar.delete"]);
    expect(database.audits[0]).toMatchObject({ target: "2026-11-08", summary: "no service on 2026-11-08: Diwali holiday" });
  });

  it("refuses bad dates, wrong flags, long notes and non-admins", async () => {
    fakeDatabase(seed());
    expect((await put("2026-02-30", { noService: true })).status).toBe(400); // regex passes, calendar does not
    expect((await request(app).delete("/api/service-calendar/2026-02-30").set("Authorization", as("admin"))).status).toBe(404); // but such a key (Rules-legal) is still removable
    expect((await put("8-Nov-2026", { noService: true })).status).toBe(400);
    expect((await put("2026-11-08", { noService: false })).status).toBe(400);
    expect((await put("2026-11-08", { noService: true, note: "x".repeat(141) })).status).toBe(400);
    expect((await put("2026-11-08", { noService: true, extra: 1 })).status).toBe(400);
    const student = await put("2026-11-08", { noService: true }, "student");
    expect(student.status).toBe(403);
    expect(student.body.code).toBe("ROLE_REQUIRED");
    expect((await request(app).get("/api/service-calendar")).status).toBe(401);
  });
});
