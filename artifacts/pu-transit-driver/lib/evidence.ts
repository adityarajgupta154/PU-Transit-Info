import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Alert, AppState, Platform } from 'react-native';

export type EvidenceEvent = { t: number; kind: string; [key: string]: unknown };

// expo-file-system has no web implementation; the web preview only renders the screen.
const logFile = Platform.OS === 'web' ? null : new File(Paths.document, 'pu-transit-nat01-evidence.json');
let events: EvidenceEvent[] = [];
let dirty = false;
let version = 0;
let tripActive = false;
let flushTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function changed(): void {
  version++;
  listeners.forEach(listener => listener());
}

async function flush(): Promise<void> {
  if (!dirty || !logFile) return;
  logFile.write(JSON.stringify(events));
  dirty = false;
}

export async function initializeEvidence(): Promise<void> {
  if (logFile?.exists) {
    const value = JSON.parse(await logFile.text()) as unknown;
    if (!Array.isArray(value)) throw new Error('The existing evidence log is corrupt.');
    events = [...(value as EvidenceEvent[]), ...events];
    changed();
  }
  logEvent({ kind: 'lifecycle', event: 'app_launch' });
  AppState.addEventListener('change', state => logEvent({ kind: 'app_state', state }));
  logEvent({ kind: 'app_state', state: AppState.currentState });
  if (!flushTimer) {
    flushTimer = setInterval(() => void flush().catch(error => {
      console.error('Evidence flush failed', error);
    }), 10_000);
  }
}

export function logEvent(event: Omit<EvidenceEvent, 't'> & { t?: number }): void {
  if (event.kind === 'phase' && typeof event.phase === 'string') {
    tripActive = !['idle', 'conflict'].includes(event.phase);
  }
  events.push({ ...event, t: event.t ?? Date.now() } as EvidenceEvent);
  dirty = true;
  changed();
}

export function getEvents(): readonly EvidenceEvent[] {
  return events;
}

export function getEvidenceVersion(): number {
  return version;
}

export function subscribeEvidence(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function clearEvents(): Promise<void> {
  if (tripActive) throw new Error('Evidence cannot be cleared while a trip is active.');
  events = [];
  logEvent({ kind: 'lifecycle', event: 'log_cleared' });
  await flush();
}

export async function flushEvidence(): Promise<void> {
  await flush();
}

export async function exportEvidence(): Promise<void> {
  if (Platform.OS === 'web') {
    Alert.alert('Native build required', 'Evidence export needs the native build.');
    return;
  }
  logEvent({ kind: 'lifecycle', event: 'exported' });
  await flush();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-T:]/g, '');
  const file = new File(Paths.document, `pu-transit-nat01-${stamp}.json`);
  file.write(JSON.stringify({
    schema: 'pu-transit-nat01-evidence/1',
    exportedAt: Date.now(),
    events,
  }));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json' });
}

export function deviceEvidence(
  backgroundPermission: string,
  servicesEnabled: boolean,
): void {
  const constants = Platform.constants as Record<string, unknown>;
  const model = Platform.OS === 'android'
    ? `${String(constants.Brand ?? 'unknown')} ${String(constants.Model ?? 'unknown')}`
    : 'unknown';
  logEvent({
    kind: 'device',
    platform: Platform.OS,
    osVersion: Platform.Version,
    model,
    executionEnvironment: Constants.executionEnvironment,
    appVersion: Constants.expoConfig?.version,
    backgroundPermission,
    servicesEnabled,
  });
}