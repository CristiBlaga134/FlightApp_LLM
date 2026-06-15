import React, { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db, hasFirebaseConfig } from "../lib/firebase";

export type AuthContextType = {
  user: User | null;
  authLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, firstName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  hasFirebaseConfig: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthLoading(false);
    });

    return unsubscribe;
  }, []);

  const signIn = async (email: string, password: string) => {
    if (!auth) {
      throw new Error("Firebase is not configured");
    }
    await signInWithEmailAndPassword(auth, email.trim(), password);
  };

  const signUp = async (email: string, password: string, firstName?: string) => {
    if (!auth || !db) {
      throw new Error("Firebase is not configured");
    }
    const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const trimmedFirstName = typeof firstName === 'string' ? firstName.trim() : '';

    await setDoc(
      doc(db, "users", credential.user.uid),
      {
        email: credential.user.email,
        ...(trimmedFirstName ? { firstName: trimmedFirstName } : {}),
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
  };

  const signOut = async () => {
    if (!auth) {
      return;
    }
    await firebaseSignOut(auth);
  };

  const resetPassword = async (email: string) => {
    if (!auth) {
      throw new Error("Firebase is not configured");
    }
    await sendPasswordResetEmail(auth, email.trim());
  };

  const value = useMemo(
    () => ({ user, authLoading, signIn, signUp, signOut, resetPassword, hasFirebaseConfig }),
    [user, authLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
