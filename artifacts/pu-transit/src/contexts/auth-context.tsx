import { createContext, useContext, useEffect, useState, useRef, ReactNode, useCallback } from 'react';
import { onIdTokenChanged, User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { storage, type Bus, type DriverAssignment, type Member } from '@/lib/storage';

interface AuthContextType {
  user: User | null;
  membership: Member | null;
  /** FLT-03: the driver's assigned bus record (any status) so preflight can explain a parked bus; null otherwise. */
  bus: Bus | null;
  /** ASG-01: today's dated assignments (IST) for an approved driver, each with its bus record; [] otherwise. */
  assignments: DriverAssignment[];
  isLoading: boolean;
  error: string | null;
  refreshMembership: () => Promise<void>;
  isEmailVerified: boolean;
  universityEmail: boolean;
  graceEndsAt: number | null;
  /** AC-32: the stored membership was approved for another email than the one in the token; Rules and the API deny access until they match. */
  emailMismatch: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [membership, setMembership] = useState<Member | null>(null);
  const [bus, setBus] = useState<Bus | null>(null);
  const [assignments, setAssignments] = useState<DriverAssignment[]>([]);
  const [, setUserRevision] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [universityEmail, setUniversityEmail] = useState(false);
  const [graceEndsAt, setGraceEndsAt] = useState<number | null>(null);
  const [emailMismatch, setEmailMismatch] = useState(false);
  const sequence = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const forbiddenWhileLoading = useRef(false); // IDN-02: a 403 arrived during a refresh → one trailing refresh
  const mounted = useRef(false);

  const loadMembership = useCallback(async () => {
    const firebaseUser = auth.currentUser;
    const version = ++sequence.current;
    forbiddenWhileLoading.current = false;
    pending.current?.abort();
    if (!firebaseUser) {
      setMembership(null);
      setEmailMismatch(false);
      setBus(null);
      setAssignments([]);
      setUniversityEmail(false);
      setGraceEndsAt(null);
      setIsLoading(false);
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    const current = () => mounted.current && sequence.current === version && auth.currentUser === firebaseUser;
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const data = await storage.getMe(controller.signal);
      if (!current()) return;
      if (data.uid !== firebaseUser.uid) throw new Error('Account response did not match the signed-in user.');
      setIsEmailVerified(data.emailVerified);
      setUniversityEmail(data.universityEmail);
      setGraceEndsAt(data.graceEndsAt);
      setEmailMismatch(data.membership !== null && data.membership.email !== data.email);
      setMembership(data.membership);
      setBus(data.bus);
      setAssignments(data.assignments ?? []);
      setUserRevision((revision) => revision + 1);
      setError(null);
    } catch (err) {
      if (!current()) return;
      setError(controller.signal.aborted ? 'Membership check timed out. Please retry.' : err instanceof Error ? err.message : 'Membership could not be checked.');
      setMembership(null);
      setEmailMismatch(false);
      setBus(null);
      setAssignments([]);
    } finally {
      clearTimeout(timeout);
      if (current()) setIsLoading(false);
      if (pending.current === controller) {
        pending.current = null;
        if (forbiddenWhileLoading.current && mounted.current) void loadMembership();
      }
    }
  }, []);

  const refreshMembership = useCallback(async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return;
    try {
      await firebaseUser.reload();
      if (!mounted.current || auth.currentUser !== firebaseUser) return;
      setUser(firebaseUser);
      setUserRevision((revision) => revision + 1);
      setIsEmailVerified(firebaseUser.emailVerified);
      await firebaseUser.getIdToken(true);
      if (!mounted.current || auth.currentUser !== firebaseUser) return;
      await loadMembership();
    } catch (err) {
      if (!mounted.current || auth.currentUser !== firebaseUser) return;
      setError(err instanceof Error ? err.message : 'Account could not be refreshed.');
    }
  }, [loadMembership]);

  useEffect(() => {
    mounted.current = true;
    let previousUser: User | null = null;
    const unsubscribe = onIdTokenChanged(auth, (firebaseUser) => {
      if (!mounted.current || auth.currentUser !== firebaseUser) return;
      pending.current?.abort();
      sequence.current++;
      setUser(firebaseUser);
      setIsEmailVerified(firebaseUser?.emailVerified ?? false);
      if (!firebaseUser) {
        setUniversityEmail(false);
        setGraceEndsAt(null);
      }
      if (!firebaseUser || previousUser !== firebaseUser) {
        setMembership(null);
        setError(null);
        setIsLoading(Boolean(firebaseUser));
      }
      previousUser = firebaseUser;
      if (firebaseUser) void loadMembership();
    });
    return () => {
      mounted.current = false;
      sequence.current++;
      pending.current?.abort();
      unsubscribe();
    };
  }, [loadMembership]);

  useEffect(() => {
    if (!user) return;
    
    const interval = setInterval(loadMembership, 20000);
    
    const handleFocus = () => {
      void loadMembership();
    };
    // IDN-02: any 403 from the API. Coalesced: a refresh already in flight is left to finish (aborting
    // it on every 403 could starve it), and one more runs after it if a 403 came in meanwhile.
    const handleForbidden = () => {
      if (pending.current) forbiddenWhileLoading.current = true;
      else void loadMembership();
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('pu-transit:forbidden', handleForbidden);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pu-transit:forbidden', handleForbidden);
    };
  }, [user, loadMembership]);

  return (
    <AuthContext.Provider
      value={{
        user,
        membership,
        bus,
        assignments,
        isLoading,
        error,
        refreshMembership,
        isEmailVerified,
        universityEmail,
        graceEndsAt,
        emailMismatch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
