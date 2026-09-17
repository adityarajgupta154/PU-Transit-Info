import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listen } = vi.hoisted(() => ({ listen: vi.fn() }));

vi.mock("./app", () => ({ default: { listen } }));
vi.mock("./lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

import {
  DEMO_FIREBASE_AUTH_EMULATOR_HOST,
  DEMO_FIREBASE_DATABASE_EMULATOR_HOST,
  DEMO_FIREBASE_DATABASE_URL,
  DEMO_FIREBASE_PROJECT_ID,
} from "./lib/firebase";

const environmentKeys = [
  "PORT",
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

function setEnvironment(values: Record<string, string>): void {
  for (const key of environmentKeys) delete process.env[key];
  Object.assign(process.env, values);
}

describe("API startup binding", () => {
  beforeEach(() => {
    vi.resetModules();
    listen.mockReset();
  });

  afterEach(() => {
    for (const key of environmentKeys) {
      if (originalEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[key];
    }
  });

  it("retains the existing default host outside demo mode", async () => {
    setEnvironment({
      PORT: "4310",
      NODE_ENV: "development",
      FIREBASE_PROJECT_ID: "pu-transit-f815d",
      FIREBASE_DATABASE_URL: "https://pu-transit-f815d-default-rtdb.firebaseio.com",
    });

    await import("./index");

    expect(listen).toHaveBeenCalledWith(4310, expect.any(Function));
    expect(listen.mock.calls[0]).toHaveLength(2);
  });

  it("binds the local demo API to loopback", async () => {
    setEnvironment({
      PORT: "4310",
      PU_TRANSIT_DEMO: "1",
      NODE_ENV: "development",
      FIREBASE_PROJECT_ID: DEMO_FIREBASE_PROJECT_ID,
      FIREBASE_DATABASE_URL: DEMO_FIREBASE_DATABASE_URL,
      FIREBASE_AUTH_EMULATOR_HOST: DEMO_FIREBASE_AUTH_EMULATOR_HOST,
      FIREBASE_DATABASE_EMULATOR_HOST: DEMO_FIREBASE_DATABASE_EMULATOR_HOST,
    });

    await import("./index");

    expect(listen).toHaveBeenCalledWith(4310, "127.0.0.1", expect.any(Function));
  });

  it("rejects an incomplete demo configuration before listening", async () => {
    setEnvironment({
      PORT: "4310",
      PU_TRANSIT_DEMO: "1",
      NODE_ENV: "development",
      FIREBASE_PROJECT_ID: DEMO_FIREBASE_PROJECT_ID,
      FIREBASE_DATABASE_URL: DEMO_FIREBASE_DATABASE_URL,
      FIREBASE_AUTH_EMULATOR_HOST: DEMO_FIREBASE_AUTH_EMULATOR_HOST,
    });

    await expect(import("./index")).rejects.toThrow("Invalid Firebase demo configuration");
    expect(listen).not.toHaveBeenCalled();
  });
});