import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { useGetAuthMe } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { driverBusOptions, membershipExpired, type TrackingState } from '@workspace/driver-tracking';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { auth } from '@/lib/firebase';
import {
  clearEvents,
  deviceEvidence,
  exportEvidence,
  getEvents,
  getEvidenceVersion,
  logEvent,
  subscribeEvidence,
} from '@/lib/evidence';
import {
  armStartTimeout,
  clearTrackingState,
  createTrackerForBus,
  endTripForIndicatorLoss,
  hydrateStores,
  setForcedEndListener,
  type TrackingController,
} from '@/lib/tracking';
import {
  openSettings,
  purposeFor,
  readPermissions,
  requestStep,
  type Permissions,
  type Purpose,
  type Step,
  type StepId,
} from '@/lib/permissions';
import { buildRows, buildStep, LABELS, probeNetwork, selectedBusOption, tripStatus, type MeLike } from '@/lib/preflight';
import { PurposeSheet } from '@/components/PurposeSheet';
import { useColors } from '@/hooks/useColors';

const INITIAL_STATE: TrackingState = {
  phase: 'idle',
  error: null,
  feed: null,
  lastSyncAt: null,
};

export default function DriverScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [tracker, setTracker] = useState<TrackingController | null>(null);
  const [tracking, setTracking] = useState<TrackingState>(INITIAL_STATE);
  const [storeReady, setStoreReady] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [network, setNetwork] = useState<Step | null>(null);
  const [pending, setPending] = useState<{ step: StepId; purpose: Purpose } | null>(null);
  const [startBlocked, setStartBlocked] = useState<string | null>(null);
  const [faultArmed, setFaultArmed] = useState(false);
  const evidenceVersion = useSyncExternalStore(subscribeEvidence, getEvidenceVersion, getEvidenceVersion);

  const queryClient = useQueryClient();
  // Keyed by uid so one account's record is never shown for another on a shared phone.
  const me = useGetAuthMe({
    query: { queryKey: ['/api/auth/me', user?.uid], enabled: Boolean(user), retry: false },
  });
  const member = me.data?.membership;
  // ASG-01: today's dated assignments come before the standing bus; a picker appears only with two or more.
  const [chosenBusId, setChosenBusId] = useState<string | null>(null);
  // A trip in flight keeps its bus even when the options change underneath (an office edit, the IST day
  // rolling over): the tracker effect below is keyed on busId and disposing it would end the trip.
  const [lockedBusId, setLockedBusId] = useState<string | null>(null);
  const busOptions = driverBusOptions(me.data);
  const busId = lockedBusId ?? selectedBusOption(me, chosenBusId)?.busId ?? '';
  const active = !['idle', 'conflict'].includes(tracking.phase);
  useEffect(() => {
    setLockedBusId(active ? current => current ?? busId : null);
  }, [active, busId]);
  const executionEnvironment = String(Constants.executionEnvironment);
  // Expo Go / the browser cannot run the background service: the build row keeps Start locked
  // and the Trip line explains it (a grey button under "Ready" is what drivers report as broken).
  const build = buildStep(executionEnvironment, Platform.OS);
  const rows = buildRows(user, me, network, permissions, busId || chosenBusId, build);
  const canStart = Boolean(user && tracker && storeReady && rows.every(row => row.ok) && !active);

  const counters = useMemo(() => {
    const events = getEvents();
    const samples = events.filter(event =>
      event.kind === 'request' && event.op === 'sample' && event.ok === true);
    const lastSample = samples.at(-1);
    const lastLocation = [...events].reverse().find(event => event.kind === 'location');
    return {
      eventCount: events.length,
      samplesAcked: samples.length,
      lastSequence: typeof lastSample?.sequence === 'number' ? lastSample.sequence : null,
      lastAckAt: typeof lastSample?.doneAt === 'number' ? lastSample.doneAt : null,
      accuracy: typeof lastLocation?.accuracy === 'number' ? lastLocation.accuracy : null,
    };
  }, [evidenceVersion]);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    void hydrateStores().then(() => setStoreReady(true)).catch(error => {
      setAuthError(`Tracking storage failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, []);

  async function refreshPermissions(): Promise<Permissions | null> {
    try {
      const next = await readPermissions();
      setPermissions(next);
      return next;
    } catch (error) {
      setAuthError(`Permission check failed: ${String(error)}`);
      return null;
    }
  }

  // Re-runs every row: device permissions, server reachability and the account record.
  async function refreshPreflight(): Promise<{ permissions: Permissions | null; network: Step; me: MeLike }> {
    const [perms, net, fresh] = await Promise.all([
      refreshPermissions(),
      probeNetwork(),
      auth.currentUser ? me.refetch() : Promise.resolve(null),
    ]);
    setNetwork(net);
    return {
      permissions: perms,
      network: net,
      me: fresh ? { isLoading: false, error: fresh.error, data: fresh.data } : { isLoading: false, error: null, data: undefined },
    };
  }

  useEffect(() => {
    void refreshPreflight().then(r => deviceEvidence(r.permissions?.background.value ?? 'unknown', r.permissions?.services.ok ?? false));
    // Settings pages (Android 11+ background, iOS Always/Precise, Battery) hand the user back without a callback.
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void refreshPreflight();
    });
    return () => sub.remove();
  }, []);

  // Mid-trip loss of a permission the indicator depends on ends the trip (durable End path).
  useEffect(() => {
    setForcedEndListener(setStartBlocked);
    return () => setForcedEndListener(null);
  }, []);
  useEffect(() => {
    if (!active || !permissions) return;
    const lost = (['foreground', 'background', 'notifications'] as const).find(id => !permissions[id].ok);
    if (lost) void endTripForIndicatorLoss(`${LABELS[lost]} is ${permissions[lost].value}`);
  }, [active, permissions]);

  useEffect(() => {
    if (!user || !busId || !storeReady) {
      setTracker(null);
      setTracking(INITIAL_STATE);
      return;
    }
    const controller = createTrackerForBus(user.uid, busId, setTracking);
    setTracker(controller);
    const restored = controller.getState();
    setTracking(restored);
    if (restored.phase === 'recovery' || restored.phase === 'pending_end') {
      logEvent({
        kind: 'lifecycle',
        event: 'session_restored',
        busId,
        tripId: restored.feed?.tripId,
      });
    }
    return () => {
      void controller.dispose();
    };
  }, [busId, storeReady, user]);

  useEffect(() => {
    if (!active) return;
    setFaultArmed(false); // the armed fault is consumed by the Start that just ran
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);

  async function login(): Promise<void> {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setPassword('');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Sign in failed.');
    } finally {
      setAuthBusy(false);
    }
  }

  // Sign-out clears everything this account left on the device: the Firebase
  // session (signOut), the cached /api/auth/me record and any saved trip
  // session or pending End. The button is disabled while a trip is active, so
  // the tracker is idle here and dispose() sends nothing.
  async function logout(): Promise<void> {
    const uid = user?.uid;
    await tracker?.dispose();
    await signOut(auth);
    await queryClient.cancelQueries();
    queryClient.clear();
    if (uid) await clearTrackingState(uid);
  }

  function onStepPress(step: StepId): void {
    const current = permissions?.[step];
    if (!current || current.action === 'none') return;
    if (current.action === 'settings') {
      void openSettings();
      return;
    }
    const purpose = purposeFor(step);
    if (purpose) {
      setPending({ step, purpose }); // OS prompt only after the purpose statement is confirmed
      return;
    }
    void requestStep(step).then(refreshPermissions);
  }

  function confirmPurpose(): void {
    const step = pending?.step;
    setPending(null);
    if (step) void requestStep(step).then(refreshPermissions);
  }

  async function start(): Promise<void> {
    // Re-run the whole list at the moment of Start: permissions, assignment or the
    // network may have changed since the rows were last drawn.
    const fresh = await refreshPreflight();
    const red = buildRows(auth.currentUser, fresh.me, fresh.network, fresh.permissions, chosenBusId, build).find(row => !row.ok);
    logEvent({ kind: 'preflight', ok: !red, red: red?.id, value: red?.value });
    if (red) {
      setStartBlocked(`Tracking not started — ${red.label}: ${red.fix ?? red.value}`);
      return;
    }
    const freshBus = selectedBusOption(fresh.me, chosenBusId)?.busId;
    if (freshBus !== busId) {
      // The controller in this closure belongs to the old bus; the effect rebuilds it for the new one.
      setStartBlocked(`Your bus changed to ${freshBus ?? 'none'} — tap Start again.`);
      return;
    }
    setStartBlocked(null);
    // If the OS refuses to start collection (foreground service / background updates) the
    // shared tracker aborts before any server call and shows the reason as tracking.error.
    await tracker?.start();
  }

  const top = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;
  const bottom = Platform.OS === 'web' ? Math.max(insets.bottom, 34) : insets.bottom;
  const styles = makeStyles(colors);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: top + 12, paddingBottom: bottom + 12 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>PU Transit Driver</Text>
      <PurposeSheet purpose={pending?.purpose ?? null} onConfirm={confirmPurpose} onDismiss={() => setPending(null)} />

      <Section title="Identity" styles={styles}>
        {!user ? (
          <>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="Email"
              placeholderTextColor={colors.mutedForeground}
            />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="Password"
              placeholderTextColor={colors.mutedForeground}
            />
            <Button testID="sign-in" label={authBusy ? 'Signing in…' : 'Sign in'} disabled={authBusy || !email || !password} onPress={() => void login()} styles={styles} />
          </>
        ) : (
          <>
            <Row label="Email" value={user.email ?? 'unknown'} styles={styles} />
            <Row label="UID" value={`${user.uid.slice(0, 10)}…`} styles={styles} />
            <Row label="Role" value={member?.root && member.role === 'admin' ? 'owner admin' : member?.role ?? 'none'} styles={styles} />
            <Row
              label="Membership"
              value={
                me.data?.emailVerified === false
                  ? 'email not verified — open the verification link, then sign in again'
                  : member && member.status === 'approved' && member.active && !membershipExpired(member) && member.email !== me.data?.email
                    ? `approved for ${member.email}, not this email — verify a university address` // AC-32, judged after status and expiry like the API
                    : member ? `${member.status}${membershipExpired(member) ? ' / expired' : member.active ? ' / active' : ' / inactive'}` : 'none'
              }
              styles={styles}
            />
            <Row label="Assigned bus" value={busId || 'none'} styles={styles} />
            {busOptions.length > 1 && busOptions.filter(option => option.busId !== busId).map(option => (
              <Button
                key={option.busId}
                testID={`pick-bus-${option.busId}`}
                label={`Drive ${option.busId} instead${option.assignment ? ` (${option.assignment.shift} today)` : ' (usual bus)'}`}
                disabled={active}
                onPress={() => setChosenBusId(option.busId)}
                styles={styles}
              />
            ))}
            <Button label="Sign out" disabled={active} onPress={() => void logout()} styles={styles} />
          </>
        )}
        {me.isLoading && <ActivityIndicator color={colors.primary} />}
        {(authError || me.error) && <Text style={styles.error}>{authError ?? me.error?.message}</Text>}
      </Section>

      <Section title="Build check" styles={styles}>
        <Row label="Environment" value={executionEnvironment === 'storeClient' ? 'Expo Go (storeClient)' : executionEnvironment} good={build.ok} styles={styles} />
        <Row label="Platform" value={`${Platform.OS} ${String(Platform.Version)}`} styles={styles} />
        <Row label="App version" value={Constants.expoConfig?.version ?? 'unknown'} styles={styles} />
      </Section>

      <Section title="Preflight" styles={styles}>
        {rows.map(row => (
          <PreflightRow
            key={row.id}
            testID={`step-${row.id}`}
            label={row.label}
            value={row.value}
            fix={row.fix}
            good={row.ok}
            button={row.action === 'none' ? null : row.action === 'settings' ? 'Open settings' : row.id === 'services' ? 'Turn on' : 'Allow'}
            onPress={() => onStepPress(row.id as StepId)}
            styles={styles}
          />
        ))}
        <Button label="Re-check" onPress={() => void refreshPreflight()} styles={styles} />
      </Section>

      <Section title="Trip" styles={styles}>
        <Text testID="trip-status" style={active && rows.every(row => row.ok) ? styles.good : styles.error}>{tripStatus(tracking, rows)}</Text>
        <Row label="Bus" value={busId || 'none'} styles={styles} />
        <Row label="Phase" value={tracking.phase === 'pending_end' ? 'pending end' : tracking.phase} styles={styles} />
        <Row label="Feed" value={tracking.feed?.status ?? 'none'} styles={styles} />
        <Row label="Last sample sequence" value={counters.lastSequence?.toString() ?? 'none'} styles={styles} />
        <Row label="Last ack age" value={counters.lastAckAt ? `${Math.max(0, Math.floor((now - counters.lastAckAt) / 1000))} s` : 'none'} styles={styles} />
        <Row label="Samples acked" value={counters.samplesAcked.toString()} styles={styles} />
        <Row label="Last accuracy" value={counters.accuracy === null ? 'none' : `${Math.round(counters.accuracy)} m`} styles={styles} />
        {tracking.error && <Text style={styles.error}>{tracking.error}</Text>}
        {startBlocked && <Text style={styles.error}>{startBlocked}</Text>}
        <View style={styles.actions}>
          <Button testID="start" label="Start" disabled={!canStart} onPress={() => void start()} styles={styles} />
          <Button testID="end" label="End" destructive disabled={!tracker || !active} onPress={() => void tracker?.stop()} styles={styles} />
        </View>
      </Section>

      <Section title="Evidence" styles={styles}>
        <Row label="Events" value={counters.eventCount.toString()} styles={styles} />
        <View style={styles.actions}>
          <Button testID="export" label="Export" onPress={() => void exportEvidence()} styles={styles} />
          <Button label="Clear" disabled={active} onPress={() => void clearEvents()} styles={styles} />
        </View>
        <Button
          label={faultArmed ? 'Start timeout armed — tap Start (AC-08)' : 'Arm Start timeout (AC-08)'}
          disabled={active || faultArmed}
          onPress={() => { armStartTimeout(); setFaultArmed(true); }}
          styles={styles}
        />
        <View style={styles.actions}>
          <Button
            label="Mark outage start"
            disabled={!active}
            onPress={() => logEvent({
              kind: 'lifecycle',
              event: 'marker_outage_start',
              busId: busId || undefined,
              tripId: tracking.feed?.tripId ?? undefined,
            })}
            styles={styles}
          />
          <Button
            label="Mark outage end"
            disabled={!active}
            onPress={() => logEvent({
              kind: 'lifecycle',
              event: 'marker_outage_end',
              busId: busId || undefined,
              tripId: tracking.feed?.tripId ?? undefined,
            })}
            styles={styles}
          />
        </View>
      </Section>
    </ScrollView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function Section({ title, children, styles }: React.PropsWithChildren<{ title: string; styles: Styles }>) {
  return <View style={styles.section}><Text style={styles.heading}>{title}</Text>{children}</View>;
}

function Row({ label, value, good, styles }: { label: string; value: string; good?: boolean; styles: Styles }) {
  return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={[styles.value, good === true && styles.good]}>{value}</Text></View>;
}

function PreflightRow({ label, value, fix, good, button, onPress, testID, styles }: {
  label: string; value: string; fix: string | null; good: boolean; button: string | null; onPress: () => void; testID?: string; styles: Styles;
}) {
  return (
    <View style={styles.preflight} testID={testID}>
      <View style={styles.preflightText}>
        <Text style={styles.label}>{label}</Text>
        <Text style={good ? styles.good : value === 'checking' ? styles.fix : styles.error}>{value}</Text>
        {fix && !good && <Text style={styles.fix}>{fix}</Text>}
      </View>
      {button && <Pressable style={styles.smallButton} onPress={onPress}><Text style={styles.buttonText}>{button}</Text></Pressable>}
    </View>
  );
}

function Button({ label, onPress, disabled, destructive, testID, styles }: {
  label: string; onPress: () => void; disabled?: boolean; destructive?: boolean; testID?: string; styles: Styles;
}) {
  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, destructive && styles.destructive, disabled && styles.disabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: 16, gap: 12 },
    title: { color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 22 },
    section: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, padding: 12, gap: 9 },
    heading: { color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 18 },
    row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    label: { color: colors.foreground, fontFamily: 'Inter_500Medium', flexShrink: 1 },
    value: { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'right', flexShrink: 1 },
    good: { color: colors.success, fontFamily: 'Inter_600SemiBold' },
    error: { color: colors.destructive, fontFamily: 'Inter_500Medium' },
    fix: { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 13 },
    input: { borderWidth: 1, borderColor: colors.input, color: colors.foreground, padding: 10, fontFamily: 'Inter_400Regular' },
    actions: { flexDirection: 'row', gap: 8 },
    button: { backgroundColor: colors.primary, minHeight: 44, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
    smallButton: { backgroundColor: colors.primary, minHeight: 38, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
    destructive: { backgroundColor: colors.destructive },
    disabled: { opacity: 0.35 },
    buttonText: { color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' },
    preflight: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    preflightText: { flex: 1 },
  });
}