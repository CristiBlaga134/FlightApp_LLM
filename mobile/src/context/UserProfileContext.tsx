import React, { createContext, useEffect, useState, useContext, ReactNode } from 'react';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './AuthContext';
import type { FlightOffer } from '../api/chat';

export type UserProfile = {
  firstName: string;
  email: string;
  cabinStyle: string;
  tripPace: string;
  bookingMode: string;
  needsAccessibleSeating: boolean;
};

export type SavedSearch = {
  id?: string;
  originCity: string | null;
  originAirportCode: string | null;
  destinationCity: string | null;
  destinationAirportCode: string | null;
  departureDate: string | null;
  returnDate: string | null;
  tripType: 'one_way' | 'round_trip' | null;
  passengers: number | null;
  searchedAt?: number;
};

export type SavedBooking = {
  id?: string;
  bookingReference: string;
  paymentId: string;
  paymentSessionId?: string;
  paymentIntentId?: string;
  paymentProvider?: string;
  paymentEventType?: string | null;
  status: 'succeeded' | 'processing';
  supplier: string;
  airline: string | null;
  amount: number;
  currency: string;
  originCity: string;
  destinationCity: string;
  departureDate: string;
  returnDate: string | null;
  tripType: 'one_way' | 'round_trip';
  travelerName: string;
  travelerEmail: string;
  cardBrand: string;
  cardLast4: string;
  estimatedConfirmationAt?: string | null;
  bookedAt?: number;
};

const defaultProfile: UserProfile = {
  firstName: 'Alex',
  email: 'alex@example.com',
  cabinStyle: 'Economy first',
  tripPace: 'City breaks & weekends',
  bookingMode: 'Flexible suggestions',
  needsAccessibleSeating: false,
};

function formatProfileSyncError(error: unknown, phase: 'load' | 'save') {
  const fallback = phase === 'load'
    ? 'Could not load profile from database.'
    : 'Could not save profile to database.';

  const message = error instanceof Error ? error.message : String(error || '').trim();
  if (!message) return fallback;

  if (/client is offline|offline/i.test(message)) {
    return phase === 'load'
      ? 'Profile sync is offline right now. Reconnect and reload to fetch your cloud profile.'
      : 'Changes are saved locally for now. Reconnect to sync your profile to the cloud.';
  }

  if (/unavailable|network/i.test(message)) {
    return phase === 'load'
      ? 'Profile sync is temporarily unavailable. Please try again in a moment.'
      : 'Profile sync could not reach the cloud just now. Please try saving again shortly.';
  }

  return message;
}

function deriveFirstNameFromEmail(email?: string | null) {
  const local = String(email || '').split('@')[0]?.trim();
  if (!local) return defaultProfile.firstName;

  const cleaned = local
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return defaultProfile.firstName;

  return cleaned
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

type UserProfileContextType = {
  profile: UserProfile;
  updateProfile: (updates: Partial<UserProfile>) => void;
  profileLoading: boolean;
  profileSyncError: string | null;
  savedSearches: SavedSearch[];
  bookings: SavedBooking[];
  saveSearch: (search: Omit<SavedSearch, 'id' | 'searchedAt'>) => void;
  saveBooking: (booking: Omit<SavedBooking, 'id' | 'bookedAt'>) => void;
  pendingChatPrefill: string | null;
  setPendingChatPrefill: (text: string | null) => void;
  pendingCheckoutOffer: FlightOffer | null;
  setPendingCheckoutOffer: (offer: FlightOffer | null) => void;
};

const UserProfileContext = createContext<UserProfileContextType | undefined>(undefined);

export function UserProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile>(defaultProfile);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSyncError, setProfileSyncError] = useState<string | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [bookings, setBookings] = useState<SavedBooking[]>([]);
  const [pendingChatPrefill, setPendingChatPrefill] = useState<string | null>(null);
  const [pendingCheckoutOffer, setPendingCheckoutOffer] = useState<FlightOffer | null>(null);

  useEffect(() => {
    let cancelled = false;

    const hydrateProfile = async () => {
      if (!user || !db) {
        setProfile(defaultProfile);
        setSavedSearches([]);
        setBookings([]);
        setProfileSyncError(null);
        return;
      }

      setProfileLoading(true);
      setProfileSyncError(null);

      try {
        const ref = doc(db, 'users', user.uid);
        const snapshot = await getDoc(ref);
        const remote = snapshot.exists() ? snapshot.data() : {};

        if (cancelled) return;

        setProfile({
          firstName: typeof remote.firstName === 'string' && remote.firstName.trim().length > 0
            ? remote.firstName
            : deriveFirstNameFromEmail(user.email),
          email: typeof remote.email === 'string' && remote.email.trim().length > 0
            ? remote.email
            : (user.email || defaultProfile.email),
          cabinStyle: typeof remote.cabinStyle === 'string' && remote.cabinStyle.trim().length > 0
            ? remote.cabinStyle
            : defaultProfile.cabinStyle,
          tripPace: typeof remote.tripPace === 'string' && remote.tripPace.trim().length > 0
            ? remote.tripPace
            : defaultProfile.tripPace,
          bookingMode: typeof remote.bookingMode === 'string' && remote.bookingMode.trim().length > 0
            ? remote.bookingMode
            : defaultProfile.bookingMode,
          needsAccessibleSeating: Boolean(remote.needsAccessibleSeating),
        });

        // Load recent searches from subcollection
        if (db) {
          const searchesRef = collection(db, 'users', user.uid, 'searches');
          const q = query(searchesRef, orderBy('searchedAt', 'desc'), limit(10));
          const searchSnap = await getDocs(q);
          if (!cancelled) {
            const loaded: SavedSearch[] = searchSnap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<SavedSearch, 'id'>),
            }));
            setSavedSearches(loaded);
          }

          const bookingsRef = collection(db, 'users', user.uid, 'bookings');
          const bookingsQuery = query(bookingsRef, orderBy('bookedAt', 'desc'), limit(8));
          const bookingsSnap = await getDocs(bookingsQuery);
          if (!cancelled) {
            const loadedBookings: SavedBooking[] = bookingsSnap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<SavedBooking, 'id'>),
            }));
            setBookings(loadedBookings);
          }
        }
      } catch (error: any) {
        if (cancelled) return;
        setProfileSyncError(formatProfileSyncError(error, 'load'));
      } finally {
        if (!cancelled) {
          setProfileLoading(false);
        }
      }
    };

    hydrateProfile();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const updateProfile = (updates: Partial<UserProfile>) => {
    let nextProfile = profile;
    setProfile((prev) => {
      nextProfile = { ...prev, ...updates };
      return nextProfile;
    });
    setProfileSyncError(null);

    if (!user || !db) return;

    setDoc(
      doc(db, 'users', user.uid),
      {
        ...updates,
        email: updates.email ?? nextProfile.email,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ).catch((error: any) => {
      setProfileSyncError(formatProfileSyncError(error, 'save'));
    });
  };

  const saveSearch = (search: Omit<SavedSearch, 'id' | 'searchedAt'>) => {
    if (!user || !db) return;

    const timestamp = Date.now();
    const newEntry: SavedSearch = { ...search, searchedAt: timestamp };

    setSavedSearches((prev) => [newEntry, ...prev].slice(0, 10));

    addDoc(collection(db, 'users', user.uid, 'searches'), {
      ...search,
      searchedAt: timestamp,
    }).catch(() => {
      // best-effort, no UI error for search saves
    });
  };

  const saveBooking = (booking: Omit<SavedBooking, 'id' | 'bookedAt'>) => {
    if (!user || !db) return;

    const timestamp = Date.now();
    const newEntry: SavedBooking = { ...booking, bookedAt: timestamp };

    setBookings((prev) => [newEntry, ...prev].slice(0, 8));

    addDoc(collection(db, 'users', user.uid, 'bookings'), {
      ...booking,
      bookedAt: timestamp,
    }).catch(() => {
      // best-effort, no UI error for booking saves
    });
  };

  return (
    <UserProfileContext.Provider
      value={{
        profile,
        updateProfile,
        profileLoading,
        profileSyncError,
        savedSearches,
        bookings,
        saveSearch,
        saveBooking,
        pendingChatPrefill,
        setPendingChatPrefill,
        pendingCheckoutOffer,
        setPendingCheckoutOffer,
      }}
    >
      {children}
    </UserProfileContext.Provider>
  );
}

export function useUserProfile() {
  const context = useContext(UserProfileContext);
  if (!context) {
    throw new Error('useUserProfile must be used within UserProfileProvider');
  }
  return context;
}
