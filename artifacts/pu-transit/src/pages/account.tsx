import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Copy } from 'lucide-react';
import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  verifyBeforeUpdateEmail,
} from 'firebase/auth';
import type { MembershipInputRole } from '@workspace/api-client-react';
import { accessThroughLabel, membershipExpired } from '@workspace/driver-tracking';
import { useAuth } from '@/contexts/auth-context';
import { auth } from '@/lib/firebase';
import { storage } from '@/lib/storage';
import { Field, SelectField } from '@/components/metro/field';
import { Headline, Tile, TileButton } from '@/components/metro/tile';
import { useToast } from '@/hooks/use-toast';
import {
  MEMBERSHIP_ROLES,
  clearMembershipRole,
  readMembershipRole,
  saveMembershipRole,
} from '@/lib/account-membership-role';

const UNIVERSITY_DOMAIN = '@paruluniversity.ac.in';
const DAY_MS = 24 * 60 * 60 * 1000;

type FormField = 'email' | 'password' | 'targetEmail' | 'role';

function isUniversityEmail(value: string): boolean {
  const email = value.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  return at > 0 && email.indexOf('@') === at && email.slice(at) === UNIVERSITY_DOMAIN;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function firebaseErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function errorMessage(error: unknown): string {
  switch (firebaseErrorCode(error)) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
      return 'the email or password is not correct.';
    case 'auth/email-already-in-use':
      return 'that email already has an account. sign in instead.';
    case 'auth/too-many-requests':
      return 'too many attempts. wait a little, then try again.';
    case 'auth/network-request-failed':
      return 'the network is unavailable. check your connection and try again.';
    default:
      return error instanceof Error ? error.message : 'something went wrong.';
  }
}

function needsRecentLogin(error: unknown): boolean {
  const code = firebaseErrorCode(error);
  return code === 'auth/requires-recent-login' || code === 'auth/user-token-expired';
}

export default function Account() {
  const {
    user,
    membership,
    isLoading,
    error: authError,
    isEmailVerified,
    universityEmail,
    graceEndsAt,
    emailMismatch,
    refreshMembership,
  } = useAuth();
  const { toast } = useToast();
  const [mode, setMode] = useState<'signin' | 'create'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signupRole, setSignupRole] = useState<MembershipInputRole>('student');
  const [accountRole, setAccountRole] = useState<MembershipInputRole | ''>('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<{ field?: FormField; message: string } | null>(null);
  const [editingEmail, setEditingEmail] = useState(false);
  const [targetEmail, setTargetEmail] = useState('');
  const [reauthPassword, setReauthPassword] = useState('');
  const [reauthRequired, setReauthRequired] = useState(false);
  const [emailUpdateNotice, setEmailUpdateNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const autoRequest = useRef<string | null>(null);

  const run = async (work: () => Promise<void>, done?: string) => {
    setBusy(true);
    setFormError(null);
    try {
      await work();
      if (done) toast({ title: done });
    } catch (err) {
      setFormError({ message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!user) {
      setAccountRole('');
      setTargetEmail('');
      autoRequest.current = null;
      return;
    }
    setTargetEmail(user.email ?? '');
    const storedRole = readMembershipRole(user.uid);
    setAccountRole(storedRole && (universityEmail || storedRole === 'student') ? storedRole : '');
    autoRequest.current = null;
  }, [user?.email, user?.uid]);

  useEffect(() => {
    if (membership && user) {
      clearMembershipRole(user.uid);
      setAccountRole('');
    }
  }, [membership?.uid, user?.uid]);

  useEffect(() => {
    if (graceEndsAt === null) return;
    const delay = Math.max(1000, Math.min(DAY_MS, graceEndsAt - Date.now() + 1));
    const timer = window.setTimeout(() => setNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [graceEndsAt, now]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!isEmail(normalizedEmail)) {
      setFormError({ field: 'email', message: 'enter a valid email address.' });
      return;
    }
    if (password.length < 8) {
      setFormError({ field: 'password', message: 'the password needs at least 8 characters.' });
      return;
    }
    if (mode === 'create' && !isUniversityEmail(normalizedEmail) && signupRole !== 'student') {
      setFormError({
        field: 'role',
        message: 'personal email accounts can request student access only. use a university email for staff, driver, or admin access.',
      });
      return;
    }
    void run(async () => {
      if (mode === 'signin') {
        await signInWithEmailAndPassword(auth, normalizedEmail, password);
      } else {
        const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
        saveMembershipRole(cred.user.uid, signupRole);
        await sendEmailVerification(cred.user);
      }
    }, mode === 'create' ? 'account created — check your inbox for the verification link' : undefined);
  };

  const resetPassword = () => {
    if (!isEmail(email)) {
      setFormError({ field: 'email', message: 'enter your email first, then press reset.' });
      return;
    }
    void run(() => sendPasswordResetEmail(auth, email.trim()), 'reset email sent');
  };

  const requestAccess = useCallback(async (role: MembershipInputRole) => {
    setBusy(true);
    setFormError(null);
    try {
      if (!user || !auth.currentUser || auth.currentUser.uid !== user.uid) {
        throw new Error('your sign-in is stale. sign in again before requesting access.');
      }
      await storage.requestMembership(role);
      if (user) clearMembershipRole(user.uid);
      setAccountRole('');
      await refreshMembership();
      toast({ title: 'access created — the account page has the latest status' });
    } catch (err) {
      setFormError({ field: 'role', message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }, [refreshMembership, toast, user?.uid]);

  useEffect(() => {
    if (!user || isLoading || !isEmailVerified || membership) return;
    const storedRole = readMembershipRole(user.uid);
    if (!storedRole || (!universityEmail && storedRole !== 'student')) return;
    const requestKey = `${user.uid}:${storedRole}`;
    if (autoRequest.current === requestKey) return;
    autoRequest.current = requestKey;
    setAccountRole(storedRole);
    void requestAccess(storedRole);
  }, [isEmailVerified, isLoading, membership, requestAccess, universityEmail, user?.uid]);

  const submitEmailUpdate = (event: FormEvent) => {
    event.preventDefault();
    if (!isEmailVerified) {
      setFormError({ message: 'verify your current email before changing it.' });
      return;
    }
    const nextEmail = targetEmail.trim().toLowerCase();
    if (!isEmail(nextEmail) || !isUniversityEmail(nextEmail)) {
      setFormError({ field: 'targetEmail', message: `use a valid ${UNIVERSITY_DOMAIN} address.` });
      return;
    }
    if (nextEmail === user?.email?.trim().toLowerCase()) {
      setFormError({ field: 'targetEmail', message: 'enter a different university email address.' });
      return;
    }
    const currentUser = auth.currentUser;
    if (!currentUser || !user || currentUser.uid !== user.uid) {
      setFormError({ message: 'your sign-in is stale. sign in again before changing email.' });
      return;
    }
    void (async () => {
      setBusy(true);
      setFormError(null);
      try {
        if (reauthRequired) {
          if (!reauthPassword) {
            setFormError({ field: 'password', message: 'enter your current password to continue.' });
            return;
          }
          if (!currentUser.email) throw new Error('the current account has no email credential.');
          await reauthenticateWithCredential(
            currentUser,
            EmailAuthProvider.credential(currentUser.email, reauthPassword),
          );
          if (auth.currentUser !== currentUser) throw new Error('your sign-in changed. sign in again and retry.');
        }
        await verifyBeforeUpdateEmail(currentUser, nextEmail);
        setEmailUpdateNotice(`verification link sent to ${nextEmail}. open it, then sign in again with ${nextEmail}: your access moves to the new address once it is verified — a personal address cannot take it over.`);
        setEditingEmail(false);
        setReauthPassword('');
        setReauthRequired(false);
      } catch (err) {
        if (needsRecentLogin(err)) {
          setReauthRequired(true);
          setFormError({ field: 'password', message: 'confirm your current password, then send the verification link again.' });
        } else if (
          reauthRequired &&
          (firebaseErrorCode(err) === 'auth/invalid-credential' || firebaseErrorCode(err) === 'auth/wrong-password')
        ) {
          setFormError({ field: 'password', message: 'the current password is not correct.' });
        } else {
          setFormError({ message: errorMessage(err) });
        }
      } finally {
        setBusy(false);
      }
    })();
  };

  const cancelEmailEdit = () => {
    setEditingEmail(false);
    setTargetEmail(user?.email ?? '');
    setReauthPassword('');
    setReauthRequired(false);
    setFormError(null);
  };

  const graceDaysLeft =
    graceEndsAt === null ? null : Math.max(0, Math.ceil((graceEndsAt - now) / DAY_MS));
  const signupIsPersonal = email.length > 0 && !isUniversityEmail(email);
  const signupRoleError =
    mode === 'create' && signupIsPersonal && signupRole !== 'student'
      ? 'personal email accounts can request student access only.'
      : formError?.field === 'role'
        ? formError.message
        : undefined;

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center px-5 py-6 md:px-8 lg:px-12">
        <Headline className="text-foreground/55">signing you in</Headline>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="metro-turnstile flex flex-1 flex-col gap-8 px-5 py-6 md:px-8 md:py-12 lg:flex-row lg:gap-16 lg:px-12">
        <div className="flex flex-col gap-4 lg:w-[40%] lg:shrink-0">
          <Headline>{mode === 'signin' ? 'sign in' : 'create account'}</Headline>
          <p className="text-muted-foreground">
            university email works for every role. personal email can create a student account with 30 days of access, then you must switch to a verified university email.
          </p>
        </div>
        <form onSubmit={submit} noValidate className="flex w-full max-w-xl flex-col gap-5">
          <Field
            label="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={`you${UNIVERSITY_DOMAIN}`}
            data-testid="input-account-email"
            required
            autoComplete="username"
            error={formError?.field === 'email' ? formError.message : undefined}
          />
          <Field
            label="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            data-testid="input-account-password"
            required
            minLength={8}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            hint={mode === 'create' ? 'at least 8 characters' : undefined}
            error={formError?.field === 'password' ? formError.message : undefined}
          />
          {mode === 'create' && (
            <SelectField
              label="access role"
              value={signupRole}
              data-testid="select-signup-role"
              onChange={(event) => setSignupRole(event.target.value as MembershipInputRole)}
              error={signupRoleError}
              hint={
                signupIsPersonal
                  ? 'personal email is limited to student access for the 30-day grace period.'
                  : 'driver and admin choices are sent to the transport office as role requests.'
              }
            >
              {MEMBERSHIP_ROLES.map((role) => (
                <option key={role} value={role} disabled={signupIsPersonal && role !== 'student'}>
                  {role}
                </option>
              ))}
            </SelectField>
          )}
          {formError && !formError.field && (
            <p role="alert" className="text-destructive">
              {formError.message}
            </p>
          )}
          <TileButton tone="blue" disabled={busy} data-testid="button-account-submit" className="min-h-20 text-2xl" type="submit">
            {busy ? 'one moment' : mode === 'signin' ? 'sign in' : 'create account'}
          </TileButton>
          <div className="grid grid-cols-2 gap-2">
            <TileButton
              tone="outline"
              data-testid="button-account-toggle-mode"
              onClick={() => { setMode(mode === 'signin' ? 'create' : 'signin'); setSignupRole('student'); setFormError(null); }}
              className="text-base"
            >
              {mode === 'signin' ? 'new here? create account' : 'have an account? sign in'}
            </TileButton>
            {mode === 'signin' && (
              <TileButton tone="outline" data-testid="button-account-reset-password" onClick={resetPassword} disabled={busy} className="text-base">
                forgot password
              </TileButton>
            )}
          </div>
        </form>
      </div>
    );
  }

  const statusLine = !membership
    ? 'no access requested yet'
    : membership.status === 'pending'
      ? `waiting for the transport office to approve you${membership.requestedRole ? ` · requested ${membership.requestedRole}` : ''}`
      : membershipExpired(membership)
        ? `your access expired on ${accessThroughLabel(membership.expiresAt as number)} — ask the transport office to extend it`
        : membership.status === 'approved' && membership.active && emailMismatch // AC-32: after status and expiry, as the API judges it
          ? `approved for ${membership.email}, not for ${user.email} — only a verified university email carries your access. switch back below or ask the transport office`
        : membership.status === 'approved' && membership.active
          ? `approved as ${membership.requestedRole ? `student · requested ${membership.requestedRole}` : membership.role === 'admin' && membership.root ? 'owner admin' : membership.role}${(membership.role === 'driver' || (membership.role === 'admin' && membership.root)) && membership.assignedBusId ? ` · bus ${membership.assignedBusId}` : ''}${membership.expiresAt !== null ? ` · until ${accessThroughLabel(membership.expiresAt)}` : ''}`
          : membership.status === 'approved'
            ? 'your access is inactive — ask the transport office'
            : `your request was ${membership.status}`;

  return (
    <div className="metro-turnstile flex flex-1 flex-col gap-8 px-5 py-6 md:px-8 md:py-12 lg:px-12">
      <div className="flex flex-col gap-2">
        <Headline>{user.email?.split('@')[0] ?? 'account'}</Headline>
        <p className="break-all text-muted-foreground" data-testid="text-account-email">{user.email}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {!isEmailVerified ? (
          <Tile tone="red" className="flex flex-col gap-4 p-5">
            <p className="text-2xl font-light">email not verified</p>
            <p>open the link we emailed to {user.email}, then come back and press refresh. nothing works before that — if the address is new or the link is missing, press send again.</p>
            <div className="grid grid-cols-2 gap-2">
              <TileButton
                tone="white"
                data-testid="button-send-verification"
                disabled={busy}
                onClick={() => void run(async () => {
                  if (auth.currentUser && auth.currentUser.uid === user.uid) await sendEmailVerification(auth.currentUser);
                  else throw new Error('your sign-in expired. sign in again.');
                }, 'verification email sent')}
                className="text-base"
              >
                send again
              </TileButton>
              <TileButton tone="white" data-testid="button-refresh-account" disabled={busy} onClick={() => void run(() => refreshMembership())} className="text-base">
                refresh
              </TileButton>
            </div>
          </Tile>
        ) : (
          <Tile tone={membership?.status === 'approved' && membership.active ? (emailMismatch ? 'red' : 'blue') : 'outline'} className="flex flex-col gap-4 p-5">
            <p className="text-2xl font-light">access</p>
            <p data-testid="status-account-access">{statusLine}</p>
            {authError && <p role="alert" className="text-destructive">{authError}</p>}
            {graceDaysLeft !== null && !emailMismatch && membership?.status === 'approved' && membership.role === 'student' && (
              <p className="text-base">
                {graceDaysLeft > 0 ? `${graceDaysLeft} ${graceDaysLeft === 1 ? 'day' : 'days'} left on personal-email access.` : 'personal-email access has ended.'}
                {' '}switch to a university email from this page.
              </p>
            )}
            {!membership ? (
              <>
                <SelectField
                  label="requested role"
                  value={accountRole}
                  data-testid="select-account-role"
                  onChange={(event) => {
                    setAccountRole(event.target.value as MembershipInputRole);
                    setFormError(null);
                  }}
                  error={formError?.field === 'role' ? formError.message : undefined}
                  hint={universityEmail ? 'choose the role you need. driver and admin choices remain role requests until the office grants them.' : 'personal email can request student access only during the 30-day grace period.'}
                >
                  <option value="" disabled>choose a role</option>
                  {MEMBERSHIP_ROLES.map((role) => (
                    <option key={role} value={role} disabled={!universityEmail && role !== 'student'}>
                      {role}
                    </option>
                  ))}
                </SelectField>
                <TileButton
                  tone="white"
                  data-testid="button-request-access"
                  disabled={busy || !accountRole}
                  onClick={() => accountRole && void requestAccess(accountRole)}
                  className="text-base"
                >
                  {busy ? 'one moment' : 'request access'}
                </TileButton>
              </>
            ) : (
              <TileButton
                tone={membership.status === 'approved' && membership.active ? 'white' : 'outline'}
                data-testid="button-refresh-membership"
                disabled={busy}
                onClick={() => void run(() => refreshMembership())}
                className="text-base"
              >
                refresh
              </TileButton>
            )}
          </Tile>
        )}

        <Tile tone="outline" className="flex flex-col gap-4 p-5">
          <p className="text-2xl font-light">email</p>
          {emailUpdateNotice && <p role="status" data-testid="status-email-update">{emailUpdateNotice}</p>}
          {!editingEmail ? (
            <TileButton
              tone="white"
              data-testid="button-edit-email"
              onClick={() => { setEditingEmail(true); setFormError(null); setEmailUpdateNotice(null); }}
              className="text-base"
            >
              edit email
            </TileButton>
          ) : (
            <form onSubmit={submitEmailUpdate} noValidate className="flex flex-col gap-4">
              <Field
                label="new university email"
                type="email"
                value={targetEmail}
                data-testid="input-target-email"
                onChange={(event) => setTargetEmail(event.target.value)}
                autoComplete="email"
                error={formError?.field === 'targetEmail' ? formError.message : undefined}
              />
              {reauthRequired && (
                <Field
                  label="current password"
                  type="password"
                  value={reauthPassword}
                  data-testid="input-reauth-password"
                  onChange={(event) => setReauthPassword(event.target.value)}
                  autoComplete="current-password"
                  error={formError?.field === 'password' ? formError.message : undefined}
                  hint="Firebase needs a recent sign-in before this email can change."
                />
              )}
              <div className="grid grid-cols-2 gap-2">
                <TileButton tone="white" data-testid="button-submit-email-update" disabled={busy} type="submit" className="text-base">
                  {busy ? 'one moment' : 'send verification link'}
                </TileButton>
                <TileButton tone="outline" data-testid="button-cancel-email-edit" disabled={busy} onClick={cancelEmailEdit} className="text-base">
                  cancel
                </TileButton>
              </div>
            </form>
          )}
          {emailUpdateNotice && (
            <TileButton tone="outline" data-testid="button-refresh-after-email-update" disabled={busy} onClick={() => void run(() => refreshMembership())} className="text-base">
              refresh account
            </TileButton>
          )}
        </Tile>

        <Tile tone="outline" className="flex flex-col gap-4 p-5">
          <p className="text-2xl font-light">account id</p>
          <p className="break-all font-mono text-sm text-muted-foreground" data-testid="text-account-id">{user.uid}</p>
          <TileButton
            tone="outline"
            data-testid="button-copy-account-id"
            onClick={() => void navigator.clipboard.writeText(user.uid).then(() => toast({ title: 'account id copied' }))}
            className="text-base"
          >
            <span>copy</span>
            <Copy className="h-5 w-5" strokeWidth={1.5} aria-hidden />
          </TileButton>
        </Tile>

        <Tile tone="outline" className="flex flex-col gap-4 p-5">
          <p className="text-2xl font-light">sign out</p>
          <p className="text-muted-foreground">on a shared phone, sign out when you are done.</p>
          <TileButton tone="outline" data-testid="button-sign-out" onClick={() => void signOut(auth)} className="text-base">
            sign out
          </TileButton>
        </Tile>
      </div>
      {formError && !formError.field && (
        <p role="alert" className="text-destructive">
          {formError.message}
        </p>
      )}
    </div>
  );
}