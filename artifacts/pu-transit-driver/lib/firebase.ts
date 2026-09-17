import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  type Persistence,
} from 'firebase/auth';
import { Platform } from 'react-native';

export const firebaseConfig = {
  apiKey: "AIzaSyAiVjNNHbgr6iLtM30o-qW-_4MdznuXOGs",
  authDomain: "pu-transit-f815d.firebaseapp.com",
  projectId: "pu-transit-f815d",
  storageBucket: "pu-transit-f815d.firebasestorage.app",
  messagingSenderId: "154326943099",
  appId: "1:154326943099:web:d55b3977ddd58202efe9de",
  databaseURL: "https://pu-transit-f815d-default-rtdb.firebaseio.com",
};

export const firebaseApp =
  getApps().find(app => app.name === 'pu-transit') ??
  initializeApp(firebaseConfig, 'pu-transit');

// Firebase's React Native export is selected by Metro at runtime, but Expo's
// TypeScript resolution sees the browser declaration file.
declare const require: (module: string) => {
  getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
};
const { getReactNativePersistence } = require('firebase/auth');

function createAuth() {
  if (Platform.OS === 'web') return getAuth(firebaseApp);
  try {
    return initializeAuth(firebaseApp, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (error) {
    if ((error as { code?: unknown }).code === 'auth/already-initialized') {
      return getAuth(firebaseApp);
    }
    throw error;
  }
}

export const auth = createAuth();