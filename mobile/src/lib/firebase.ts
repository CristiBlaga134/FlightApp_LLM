import { Platform } from "react-native";
import { initializeApp, getApps, getApp } from "firebase/app";
import { Auth, getAuth, getReactNativePersistence, initializeAuth } from "firebase/auth";
import {
  Firestore,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
} from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

function hasValidFirebaseConfig() {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.appId
  );
}

export const hasFirebaseConfig = hasValidFirebaseConfig();

let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

if (hasFirebaseConfig) {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

  authInstance =
    Platform.OS === "web"
      ? getAuth(app)
      : (() => {
          try {
            return initializeAuth(app, {
              persistence: getReactNativePersistence(AsyncStorage),
            });
          } catch {
            return getAuth(app);
          }
        })();

  dbInstance =
    Platform.OS === "web"
      ? (() => {
          try {
            return initializeFirestore(app, {
              localCache: persistentLocalCache({}),
            });
          } catch {
            return getFirestore(app);
          }
        })()
      : getFirestore(app);
}

export const auth = authInstance;
export const db = dbInstance;
