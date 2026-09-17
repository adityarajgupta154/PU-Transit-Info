import app from "./app";
import {
  DEMO_FIREBASE_AUTH_EMULATOR_HOST,
  DEMO_FIREBASE_DATABASE_EMULATOR_HOST,
  DEMO_FIREBASE_DATABASE_URL,
  DEMO_FIREBASE_PROJECT_ID,
  isFirebaseDemoMode,
} from "./lib/firebase";
import { logger } from "./lib/logger";

function validateDemoStartupConfiguration(): void {
  const demoConfigurationDetected =
    process.env.PU_TRANSIT_DEMO !== undefined ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== undefined ||
    process.env.FIREBASE_DATABASE_EMULATOR_HOST !== undefined ||
    process.env.FIREBASE_PROJECT_ID === DEMO_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_DATABASE_URL === DEMO_FIREBASE_DATABASE_URL;

  if (!demoConfigurationDetected) return;

  if (
    process.env.PU_TRANSIT_DEMO !== "1" ||
    process.env.NODE_ENV !== "development" ||
    process.env.FIREBASE_PROJECT_ID !== DEMO_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_DATABASE_URL !== DEMO_FIREBASE_DATABASE_URL ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== DEMO_FIREBASE_AUTH_EMULATOR_HOST ||
    process.env.FIREBASE_DATABASE_EMULATOR_HOST !== DEMO_FIREBASE_DATABASE_EMULATOR_HOST
  ) {
    throw new Error(
      "Invalid Firebase demo configuration: set the exact local demo values before starting the API.",
    );
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

validateDemoStartupConfiguration();

const onListen = (err?: Error): void => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
};

if (isFirebaseDemoMode()) {
  app.listen(port, "127.0.0.1", onListen);
} else {
  app.listen(port, onListen);
}
