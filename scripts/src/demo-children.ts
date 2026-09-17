import { spawn, type ChildProcess } from "node:child_process";
import { demoEnvironment, seedDemo } from "./demo-seed.js";

const root = new URL("../../", import.meta.url);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const environment = demoEnvironment();

await seedDemo();

const children: ChildProcess[] = [
  spawn(pnpm, ["--filter", "@workspace/api-server", "run", "dev"], {
    cwd: root,
    detached: process.platform !== "win32",
    env: { ...environment, PORT: "3001", BASE_PATH: "/", HOST: "127.0.0.1" },
    stdio: "inherit",
  }),
  spawn(pnpm, ["--filter", "@workspace/pu-transit", "exec", "vite", "--config", "vite.config.ts"], {
    cwd: root,
    detached: process.platform !== "win32",
    env: { ...environment, PORT: "5173", BASE_PATH: "/" },
    stdio: "inherit",
  }),
];

let shuttingDown = false;
let exitCode = 1;

function stopChildren(signal: NodeJS.Signals = "SIGTERM"): void {
  for (const child of children) {
    if (typeof child.pid !== "number") continue;
    if (process.platform === "win32") {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
      continue;
    }
    try {
      // detached=true gives pnpm and its dev-server descendants their own group.
      process.kill(-child.pid, signal);
    } catch {
      // The group may already have exited between the close event and cleanup.
    }
  }
}

function fail(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code > 0 ? code : 1;
  stopChildren();
  const forceKill = setTimeout(() => stopChildren("SIGKILL"), 1_500);
  forceKill.unref();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (!shuttingDown) {
      shuttingDown = true;
      exitCode = 130;
      stopChildren(signal);
      const forceKill = setTimeout(() => stopChildren("SIGKILL"), 1_500);
      forceKill.unref();
    }
  });
}

await new Promise<void>((resolve) => {
  let remaining = children.length;
  for (const child of children) {
    child.once("error", () => fail(1));
    child.once("close", (code) => {
      if (!shuttingDown) fail(typeof code === "number" ? code : 1);
      remaining -= 1;
      if (remaining === 0) resolve();
    });
  }
});

process.exitCode = exitCode;