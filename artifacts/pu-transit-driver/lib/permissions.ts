import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, PermissionsAndroid, Platform } from 'react-native';
import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import { logEvent } from '@/lib/evidence';

// Platform-required permission flow (NAT-02) plus the device half of the native
// preflight (NAT-04). Tracking never starts unless every step is `ok`, so the OS
// indicator (Android foreground-service notification, iOS blue location
// indicator) is guaranteed to exist whenever a trip is live.

export type StepId = 'services' | 'foreground' | 'background' | 'battery' | 'notifications';

export type Step = {
  ok: boolean;
  value: string;
  /** One actionable line for a red step; null when green. */
  fix: string | null;
  /** What the row button does: ask the OS (after the purpose statement), open Settings, or nothing yet. */
  action: 'request' | 'settings' | 'none';
};

export type Permissions = Record<StepId, Step>;

export const APP_NAME = 'PU Transit Driver';
const ANDROID_API = Platform.OS === 'android' ? Number(Platform.Version) : 0;
const NEEDS_NOTIFICATION_PERMISSION = ANDROID_API >= 33;
const IOS = Platform.OS === 'ios';

const ALWAYS_LABEL = IOS ? 'Always' : 'Allow all the time';
const SETTINGS_PATH = IOS
  ? `Settings → ${APP_NAME} → Location`
  : `Settings → Apps → ${APP_NAME} → Permissions → Location`;

const NA: Step = { ok: true, value: 'n/a', fix: null, action: 'none' };

// The OS does not tell us two things across relaunches: iOS reports the Always
// upgrade as "undetermined" again after a refusal, and PermissionsAndroid.check
// cannot distinguish "never asked" from "denied twice". Remember both on device.
const ATTEMPTS_KEY = 'pu-transit:permission-attempts';
type Attempts = { alwaysAsked?: boolean; notificationsBlocked?: boolean };
let attempts: Attempts | null = null;

async function loadAttempts(): Promise<Attempts> {
  if (attempts) return attempts;
  const raw = await AsyncStorage.getItem(ATTEMPTS_KEY).catch(() => null);
  attempts = raw ? (JSON.parse(raw) as Attempts) : {};
  return attempts;
}

async function remember(patch: Attempts): Promise<void> {
  attempts = { ...(await loadAttempts()), ...patch };
  await AsyncStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts)).catch(() => undefined);
}

export async function readPermissions(): Promise<Permissions> {
  if (Platform.OS === 'web') {
    const web: Step = { ok: false, value: 'n/a', fix: null, action: 'none' }; // the screen already says "needs the native build"
    return { services: web, foreground: web, background: web, battery: web, notifications: web };
  }
  const [services, fg, bg, optimised, known] = await Promise.all([
    Location.hasServicesEnabledAsync(),
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
    // PowerManager.isIgnoringBatteryOptimizations, inverted; always false on iOS.
    IOS ? Promise.resolve(false) : Battery.isBatteryOptimizationEnabledAsync(),
    loadAttempts(),
  ]);
  const precise = IOS ? fg.ios?.accuracy !== 'reduced' : fg.android?.accuracy !== 'coarse';
  const foreground: Step = !fg.granted
    ? {
        ok: false,
        value: fg.status === 'undetermined' ? 'not asked yet' : 'denied',
        fix: fg.canAskAgain
          ? 'Allow location while using the app.'
          : `${SETTINGS_PATH} → choose "While using the app".`,
        action: fg.canAskAgain ? 'request' : 'settings',
      }
    : !precise
      ? {
          ok: false,
          value: 'approximate only',
          fix: `${SETTINGS_PATH} → turn on "${IOS ? 'Precise Location' : 'Use precise location'}".`,
          action: 'settings',
        }
      : { ok: true, value: 'while using, precise', fix: null, action: 'none' };

  const alwaysGranted = bg.granted && (!IOS || fg.ios?.scope === 'always');
  // iOS shows the "Change to Always Allow" alert once; after a refusal only Settings can change it.
  const canPrompt = bg.canAskAgain && !(IOS && known.alwaysAsked);
  const background: Step = alwaysGranted
    ? { ok: true, value: ALWAYS_LABEL, fix: null, action: 'none' }
    : !fg.granted
      ? { ok: false, value: 'waiting', fix: 'Finish the step above first.', action: 'none' }
      : {
          ok: false,
          value: IOS && fg.ios?.scope === 'whenInUse' ? 'While Using only' : bg.status === 'undetermined' ? 'not asked yet' : 'denied',
          fix: canPrompt
            ? `Choose "${ALWAYS_LABEL}" on the next screen.`
            : `${SETTINGS_PATH} → choose "${ALWAYS_LABEL}".`,
          action: canPrompt ? 'request' : 'settings',
        };

  const notifications: Step = !NEEDS_NOTIFICATION_PERMISSION
    ? NA
    : (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS))
      ? { ok: true, value: 'allowed', fix: null, action: 'none' }
      : {
          ok: false,
          value: 'not allowed',
          fix: known.notificationsBlocked
            ? `Settings → Apps → ${APP_NAME} → Notifications → Allow.`
            : 'Tap Allow so Android can show the "sharing your bus location" notification during a trip.',
          action: known.notificationsBlocked ? 'settings' : 'request',
        };

  return {
    services: services
      ? { ok: true, value: 'on', fix: null, action: 'none' }
      : {
          ok: false,
          value: 'off',
          fix: IOS ? 'Settings → Privacy & Security → Location Services → On.' : 'Turn on Location.',
          action: IOS ? 'settings' : 'request',
        },
    foreground,
    background,
    // Doze/App Standby throttle the foreground service's network on an "optimised" app;
    // the fleet's vendor skins go further and kill it. Only the exemption is accepted.
    battery: IOS
      ? NA
      : optimised
        ? {
            ok: false,
            value: 'optimised',
            fix: `Settings → Apps → ${APP_NAME} → Battery → "Unrestricted" (Xiaomi/Vivo: Battery saver → "No restrictions").`,
            action: 'settings',
          }
        : { ok: true, value: 'unrestricted', fix: null, action: 'none' },
    notifications,
  };
}

/** Ask the OS for one step. Callers show the purpose statement first where one exists. */
export async function requestStep(step: StepId): Promise<void> {
  if (Platform.OS === 'web') return;
  if (step === 'services') {
    if (IOS) await Linking.openSettings();
    else await Location.enableNetworkProviderAsync().catch(() => undefined); // user declined the system dialog
  } else if (step === 'foreground') {
    const r = await Location.requestForegroundPermissionsAsync();
    logEvent({ kind: 'permission', step, status: r.status, canAskAgain: r.canAskAgain, scope: r.ios?.scope, accuracy: r.ios?.accuracy ?? r.android?.accuracy });
  } else if (step === 'background') {
    // Android 11+ and iOS both leave the app for a Settings page here; the promise
    // resolves when the user returns, and the AppState refresh covers manual changes.
    const r = await Location.requestBackgroundPermissionsAsync();
    if (IOS) await remember({ alwaysAsked: true });
    logEvent({ kind: 'permission', step, status: r.status, canAskAgain: r.canAskAgain });
  } else if (NEEDS_NOTIFICATION_PERMISSION) {
    const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    await remember({ notificationsBlocked: r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN });
    logEvent({ kind: 'permission', step, status: r });
  }
}

/**
 * Cheap mid-trip check of the permissions the visible indicator depends on.
 * Returns the reason when one is gone, null while everything is still held.
 */
export async function indicatorPermissionLoss(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  if (NEEDS_NOTIFICATION_PERMISSION &&
      !(await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS))) {
    return 'notification permission was turned off';
  }
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) return 'location permission was turned off';
  if (IOS ? fg.ios?.scope !== 'always' : !(await Location.getBackgroundPermissionsAsync()).granted) {
    return `location is no longer "${ALWAYS_LABEL}"`;
  }
  return null;
}

export function openSettings(): Promise<void> {
  return Linking.openSettings();
}

export type Purpose = { title: string; body: string[]; confirm: string };

/**
 * Purpose statement shown before the OS prompt (Play "prominent disclosure" wording;
 * Apple asks for the same clarity in the purpose strings). Copy is a draft pending
 * university approval (PRIV-01).
 */
export function purposeFor(step: StepId): Purpose | null {
  if (step === 'foreground') {
    return {
      title: 'Why this app needs your location',
      body: [
        `${APP_NAME} uses your phone's precise location to show this bus's position to Parul University students and staff.`,
        'Location is used only during a trip you start in this app, and stops when you end the trip.',
        IOS
          ? 'Next, iOS will ask for location access. Choose "Allow While Using App" and keep Precise on.'
          : 'Next, Android will ask for location access. Choose "While using the app" and keep "Precise" selected.',
      ],
      confirm: 'Continue',
    };
  }
  if (step === 'background') {
    return {
      title: 'Location in the background',
      body: [
        `${APP_NAME} collects location data to share this bus's live position with Parul University students and staff even when the app is closed or not in use, so tracking continues with the screen off during a trip you start.`,
        IOS
          ? 'While a trip runs, iOS shows the blue location indicator in the status bar. Ending the trip stops sharing.'
          : 'While a trip runs, the notification "PU Transit is sharing your bus location" stays in your notification shade and the app is listed under active apps. Ending the trip stops sharing.',
        IOS
          ? 'When asked, choose "Change to Always Allow". If iOS does not ask, set Location to "Always" in Settings.'
          : 'On the next screen choose "Allow all the time".',
      ],
      confirm: 'Continue',
    };
  }
  return null;
}
