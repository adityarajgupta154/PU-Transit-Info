import { getApps, initializeApp } from "firebase/app";
import { browserSessionPersistence, connectAuthEmulator, getAuth, initializeAuth } from "firebase/auth";

export const isLocalDemo = import.meta.env.VITE_PU_TRANSIT_DEMO === "1";
if (isLocalDemo && (
  import.meta.env.PROD ||
  !["localhost", "127.0.0.1"].includes(window.location.hostname)
)) {
  throw new Error("The isolated demo is only available on a local development server.");
}

export const firebaseConfig = isLocalDemo ? {
  apiKey: "demo-only-not-a-real-key",
  authDomain: "demo-pu-transit.firebaseapp.com",
  projectId: "demo-pu-transit",
  databaseURL: "http://127.0.0.1:9000?ns=demo-pu-transit-default-rtdb",
} : {
  apiKey: "AIzaSyAiVjNNHbgr6iLtM30o-qW-_4MdznuXOGs",
  authDomain: "pu-transit-f815d.firebaseapp.com",
  projectId: "pu-transit-f815d",
  storageBucket: "pu-transit-f815d.firebasestorage.app",
  messagingSenderId: "154326943099",
  appId: "1:154326943099:web:d55b3977ddd58202efe9de",
  databaseURL: "https://pu-transit-f815d-default-rtdb.firebaseio.com",
};

const appName = isLocalDemo ? "pu-transit-local-demo" : "pu-transit";
export const firebaseApp =
  getApps().find(app => app.name === appName) ??
  initializeApp(firebaseConfig, appName);

// Connect synchronously, before any listener, sign-in or token refresh can run.
// A separate app and tab-local persistence cannot reuse a live-project login.
export const auth = isLocalDemo
  ? initializeAuth(firebaseApp, { persistence: browserSessionPersistence })
  : getAuth(firebaseApp);
if (isLocalDemo && !auth.emulatorConfig) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
}
