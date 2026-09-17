import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("firebase-admin/app", () => ({
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(),
}));
vi.mock("firebase-admin/auth", () => ({
  getAuth: vi.fn(),
}));
vi.mock("@workspace/db", () => {
  throw new Error("PostgreSQL must not be imported by the local demo");
});

import app from "../app";

const environmentKeys = [
  "PU_TRANSIT_DEMO",
  "NODE_ENV",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_DATABASE_URL",
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIREBASE_DATABASE_EMULATOR_HOST",
] as const;
const originalEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]]),
) as Record<(typeof environmentKeys)[number], string | undefined>;

describe("local demo backend isolation", () => {
  beforeEach(() => {
    process.env.PU_TRANSIT_DEMO = "1";
    process.env.NODE_ENV = "development";
    process.env.FIREBASE_PROJECT_ID = "demo-pu-transit";
    process.env.FIREBASE_DATABASE_URL = "http://127.0.0.1:9000";
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
    process.env.FIREBASE_DATABASE_EMULATOR_HOST = "127.0.0.1:9000";
  });

  afterEach(() => {
    for (const key of environmentKeys) {
      if (originalEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[key];
    }
  });

  it("disables legacy migration endpoints before auth or PostgreSQL import", async () => {
    const preview = await request(app).get("/api/migration/preview");
    const migration = await request(app).post("/api/migration/import").send({});

    for (const response of [preview, migration]) {
      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        error: "Legacy migration is disabled in the local demo",
        code: "MIGRATION_DISABLED",
      });
    }
  });
});