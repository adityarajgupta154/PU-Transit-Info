import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Pass the pre-removal Git revision. Never put credential values in command
// arguments, output, or a checked-in grep pattern file.
const root = fileURLToPath(new URL("../../", import.meta.url));
const legacyRef = process.argv[2] ?? "HEAD";
const bundle = resolve(root, "artifacts/pu-transit/dist/public");

function checkBundle() {
  if (!/^(HEAD|[a-f0-9]{7,40})$/i.test(legacyRef)) {
    throw new Error("Pass HEAD or the pre-removal commit hash, not a credential.");
  }
  if (!existsSync(resolve(bundle, "index.html"))) {
    throw new Error("Build the web app before scanning its output.");
  }
  const legacyKeys = new Set<string>();
  for (const path of [
    "artifacts/pu-transit/src/lib/map-config.ts",
    ".migration-backup/js/map-config.js",
  ]) {
    let source: string;
    try {
      source = execFileSync("git", ["show", `${legacyRef}:${path}`], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      throw new Error("Cannot read the requested pre-removal source revision.");
    }
    for (const match of source.matchAll(/\borsApiKey:\s*(['"])(.*?)\1/g)) {
      if (match[2]) legacyKeys.add(match[2]);
    }
  }
  if (!legacyKeys.size) {
    throw new Error("No legacy key found; supply the pre-removal commit hash.");
  }
  const currentKey = process.env.ORS_API_KEY?.trim();
  if (currentKey && legacyKeys.has(currentKey)) {
    throw new Error("ORS_API_KEY still equals an exposed key. Rotation is required.");
  }

  const keys = new Set(legacyKeys);
  if (currentKey) keys.add(currentKey);
  // Exact-key grep reads patterns privately over stdin; -l prints filenames only.
  const exact = spawnSync("grep", ["-rlF", "-f", "-", bundle], {
    input: [...keys].join("\n") + "\n",
    encoding: "utf8",
  });
  if (exact.status === 0) throw new Error("An ORS credential was found in the web build.");
  if (exact.status !== 1) throw new Error("Exact-key grep failed; no clean result can be claimed.");
  console.log("Exact ORS-key grep: exit 1 — 0 matching build files.");
  console.log(`Keys checked: ${legacyKeys.size} legacy; server key ${currentKey ? "included and distinct" : "not configured (rotation pending)"}.`);

  const direct = spawnSync("grep", [
    "-rlE", "api\\.openrouteservice\\.org|orsApiKey|VITE_[A-Z_]*ORS", bundle,
  ], { encoding: "utf8" });
  if (direct.status === 0) throw new Error("A direct ORS client reference remains in the build.");
  if (direct.status !== 1) throw new Error("Direct-provider grep failed; no clean result can be claimed.");
  console.log("Direct ORS URL/client-key grep: exit 1 — 0 matching build files.");
}

try {
  checkBundle();
} catch (error) {
  // All thrown messages above are controlled. Never serialize child processes,
  // environment values, or provider responses.
  console.error(error instanceof Error ? error.message : "ORS bundle verification failed.");
  process.exitCode = 1;
}