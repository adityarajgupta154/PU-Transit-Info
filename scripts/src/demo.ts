import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { assertDemoEnvironment, demoEnvironment, DEMO_PROJECT_ID } from "./demo-seed.js";

assertDemoEnvironment();

const root = fileURLToPath(new URL("../../", import.meta.url));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const emulator = spawn(
  pnpm,
  [
    "--filter",
    "@workspace/scripts",
    "exec",
    "firebase",
    "emulators:exec",
    "--config",
    resolve(root, "firebase/firebase.json"),
    "--only",
    "auth,database",
    "--project",
    DEMO_PROJECT_ID,
    "pnpm --filter @workspace/scripts run demo:children",
  ],
  {
    cwd: root,
    env: demoEnvironment(),
    stdio: "inherit",
  },
);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (!stopping) {
      stopping = true;
      emulator.kill(signal);
    }
  });
}

emulator.once("error", (error) => {
  console.error(`Firebase emulator launcher failed: ${error.message}`);
  process.exitCode = 1;
});
emulator.once("close", (code) => {
  process.exitCode = typeof code === "number" && code > 0 ? code : stopping ? 0 : 1;
});