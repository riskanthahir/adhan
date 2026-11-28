import type { AdvanceMinutesOption, PrayerName } from '../shared/types';

const DEVICE_ID_KEY = 'my_adhan_device_id_v1';
const DEVICE_TOKEN_KEY = 'my_adhan_device_token_v1';
const PUSH_EVENT_LOG_KEY = 'my_adhan_push_events_v1';
const SW_META_DB = 'my_adhan_sw_meta';
const SW_META_STORE = 'kv';
export const PUSH_CHANNEL_NAME = 'my-adhan-push';

const DEFAULT_FETCH_TIMEOUT_MS = 12_000;

export const DEFAULT_SUPABASE_URL = 'https://hrpkmykhfktyjgnxsoir.supabase.co';

export function resolveSupabaseUrl(): string {
  const envUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  if (envUrl) return envUrl;

  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname || '';
    const origin = window.location.origin || '';
    // If running in local node dev environment, prefer Express backend
    if (host === 'localhost' || host === '127.0.0.1' || host.includes('localhost')) {
      return '';
    }
    // Deployed environments (e.g. Vercel adhan-khaki.vercel.app) default to the live Supabase project
    if (host.includes('vercel.app') || origin.includes('vercel.app') || host.length > 0) {
      return DEFAULT_SUPABASE_URL;
    }
  }

  // Production build / SSR default
  return import.meta.env.PROD ? DEFAULT_SUPABASE_URL : '';
}

const SUPABASE_URL = resolveSupabaseUrl();
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
export const IS_SUPABASE_BACKEND = Boolean(SUPABASE_URL);

export function getBackendTransportMode(): 'supabase' | 'express' {
  return IS_SUPABASE_BACKEND ? 'supabase' : 'express';
}

export interface PushClientLogEntry {
  id: string;
  at: string;
  level: 'info' | 'warn' | 'error';
  stage: string;
  message: string;
  httpStatus?: number | null;
}

const memoryPushLogs: PushClientLogEntry[] = [];

function scrubSensitiveText(input: string): string {
  return input
    // Redact full push endpoints down to scheme+hostname
    .replace(/https?:\/\/([a-zA-Z0-9.-]+)\/[^\s"'`<>]+/g, 'https://$1/[redacted-path]')
    // Redact long hex/base64 tokens (>= 28 chars)
    .replace(/\b[A-Za-z0-9_-]{28,}\b/g, (match) => `${match.slice(0, 6)}…[redacted]`);
}

export function appendPushClientEvent(entry: {
  level: 'info' | 'warn' | 'error';
  stage: string;
  message: string;
  httpStatus?: number | null;
}): PushClientLogEntry {
  const item: PushClientLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    level: entry.level,
    stage: entry.stage,
    message: scrubSensitiveText(entry.message).slice(0, 320),
    httpStatus: entry.httpStatus ?? null,
  };

  memoryPushLogs.unshift(item);
  if (memoryPushLogs.length > 50) {
    memoryPushLogs.length = 50;
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const existingRaw = localStorage.getItem(PUSH_EVENT_LOG_KEY);
      const parsed = existingRaw ? (JSON.parse(existingRaw) as PushClientLogEntry[]) : [];
      const next = [item, ...(Array.isArray(parsed) ? parsed : [])].slice(0, 50);
      localStorage.setItem(PUSH_EVENT_LOG_KEY, JSON.stringify(next));
    }
  } catch {
    // Ignore storage quota errors
  }

  return item;
}

export function getPushClientEvents(): PushClientLogEntry[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(PUSH_EVENT_LOG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.slice(0, 50) as PushClientLogEntry[];
        }
      }
    }
  } catch {
    // Fall back to in-memory log buffer
  }
  return [...memoryPushLogs];
}

export function clearPushClientEvents(): void {
  memoryPushLogs.length = 0;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(PUSH_EVENT_LOG_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

function buildBackendHeaders(deviceToken?: string, includeJson = true): Record<string, string> {
  const headers: Record<string, string> = {};
  if (includeJson) headers['Content-Type'] = 'application/json';
  if (deviceToken) headers['X-Device-Token'] = deviceToken;
  if (IS_SUPABASE_BACKEND && SUPABASE_ANON_KEY) {
    headers.apikey = SUPABASE_ANON_KEY;
    headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  }
  return headers;
}

function backendEndpoint(
  route:
    | 'vapid-public-key'
    | 'subscribe'
    | 'unsubscribe'
    | 'preferences'
    | 'status'
    | 'test'
    | 'verify-click'
    | 'test-expired-cleanup'
    | 'diagnostics'
    | 'schedule-test-push',
  deviceId?: string
): string {
  if (!IS_SUPABASE_BACKEND) {
    const q = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '';
    return `/api/push/${route}${q}`;
  }

  switch (route) {
    case 'vapid-public-key':
      return `${SUPABASE_URL}/functions/v1/register-device?action=vapid-public-key`;
    case 'subscribe':
    case 'unsubscribe':
    case 'verify-click':
      return `${SUPABASE_URL}/functions/v1/register-device`;
    case 'status':
      return `${SUPABASE_URL}/functions/v1/register-device?action=status&deviceId=${encodeURIComponent(
        deviceId ?? ''
      )}`;
    case 'diagnostics':
      return `${SUPABASE_URL}/functions/v1/register-device?action=diagnostics&deviceId=${encodeURIComponent(
        deviceId ?? ''
      )}`;
    case 'preferences':
      return `${SUPABASE_URL}/functions/v1/update-preferences`;
    case 'test':
      return `${SUPABASE_URL}/functions/v1/send-test-push`;
    case 'schedule-test-push':
      return `${SUPABASE_URL}/functions/v1/schedule-test-push${
        deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : ''
      }`;
    case 'test-expired-cleanup':
      return `${SUPABASE_URL}/functions/v1/cleanup-subscriptions`;
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    return await fetch(url, {
      ...init,
      signal: controller ? controller.signal : init.signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s contacting push backend.`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Network or CORS error contacting push backend: ${msg}`);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function parseJsonSafe<T = Record<string, unknown>>(
  res: Response
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  let rawText = '';
  try {
    rawText = await res.text();
  } catch (err) {
    return {
      ok: false,
      error: `Failed to read HTTP ${res.status} response body: ${(err as Error).message}`,
    };
  }

  if (!rawText.trim()) {
    return { ok: false, error: `Empty response body (HTTP ${res.status}).` };
  }

  try {
    const parsed = JSON.parse(rawText) as T;
    return { ok: true, data: parsed };
  } catch {
    const trimmedPreview = rawText.trim().replace(/\s+/g, ' ').slice(0, 120);
    return {
      ok: false,
      error: `Non-JSON response (HTTP ${res.status}): ${trimmedPreview}`,
    };
  }
}

export type PushSubscriptionStatusType =
  | 'active'
  | 'disabled'
  | 'expired'
  | 'invalid'
  | 'unsubscribed'
  | 'unsupported';

export interface BackendDeliveryAttempt {
  id: string;
  eventKey: string;
  prayer: string;
  prayerTimeHHMM: string;
  advanceMinutes: number;
  dateISO: string;
  status: 'sent' | 'failed' | 'retrying' | 'expired';
  attemptCount: number;
  httpStatus: number | null;
  errorMessage: string | null;
  updatedAt: string;
}

export interface BackgroundTestJobSummary {
  id: string;
  deviceUuid: string;
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';
  scheduledAt: string;
  sentAt?: string | null;
  errorMessage?: string | null;
  attempts?: number;
  createdAt: string;
}

export interface BackendSubscriptionSummary {
  subscriptionId: string;
  deviceId: string;
  status: 'active' | 'disabled' | 'expired' | 'invalid';
  districtId: string;
  zoneId: number;
  zoneName: string;
  timezone: string;
  perPrayerEnabled: Record<PrayerName, boolean>;
  advanceMinutes: Record<PrayerName, AdvanceMinutesOption>;
  endpointPreview: string;
  lastRegisteredAt: string;
  lastVerifiedAt: string | null;
  lastDeliveryAttemptAt: string | null;
  lastDeliverySuccessAt: string | null;
  lastDeliveryError: string | null;
  lastClickVerifiedAt: string | null;
  failureCount: number;
  latestTestJob?: BackgroundTestJobSummary | null;
  nextScheduledPrayer: {
    prayer: PrayerName;
    label: string;
    timeHHMM: string;
    isTomorrow: boolean;
    secondsRemaining: number;
    countdownFormatted: string;
  } | null;
}

export interface PushDiagnosticsResponse {
  ok: boolean;
  backendMode?: 'supabase' | 'express';
  colomboDate: string;
  colomboTime: string;
  databasePath: string;
  migrations: Array<{ version: string; appliedAt: string }>;
  stats: {
    activeSubscriptions: number;
    totalSubscriptions: number;
    totalDeliveries: number;
    sentDeliveries: number;
    expiredSubscriptions: number;
  };
  scheduler: {
    running: boolean;
    intervalMs: number;
    graceWindowMs: number;
    ttlSeconds: number;
    lastTickAt: string | null;
    lastTickSummary: {
      checkedSubscriptions: number;
      attempted: number;
      sent: number;
      retried: number;
      expired: number;
    } | null;
  };
  vapid: {
    configured: boolean;
    status: string;
    publicKeyPreview: string | null;
    configuredViaEnv: boolean;
    subject: string | null;
    errorMessage: string | null;
    setupInstructions: string[];
  };
  subscription: BackendSubscriptionSummary | null;
  latestTestJob?: BackgroundTestJobSummary | null;
  recentDeliveries: BackendDeliveryAttempt[];
  recentLogs: Array<{
    id: number;
    level: 'info' | 'warn' | 'error';
    category: string;
    deviceId: string | null;
    message: string;
    meta: Record<string, unknown> | null;
    createdAt: string;
  }>;
}

export interface PushClientEnvironment {
  serviceWorkerSupported: boolean;
  pushManagerSupported: boolean;
  notificationSupported: boolean;
  isSecureContext: boolean;
  isIOS: boolean;
  isStandalonePwa: boolean;
  permission: NotificationPermission | 'unsupported';
}

function generateRandomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getOrCreateDeviceCredentials(): { deviceId: string; deviceToken: string } {
  let deviceId = '';
  let deviceToken = '';
  try {
    deviceId = localStorage.getItem(DEVICE_ID_KEY) || '';
    deviceToken = localStorage.getItem(DEVICE_TOKEN_KEY) || '';
    if (!deviceId || deviceId.length < 8) {
      deviceId =
        typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `dev-${generateRandomHex(12)}`;
      localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
    if (!deviceToken || deviceToken.length < 16) {
      deviceToken = generateRandomHex(24);
      localStorage.setItem(DEVICE_TOKEN_KEY, deviceToken);
    }
  } catch {
    deviceId = deviceId || `dev-${generateRandomHex(12)}`;
    deviceToken = deviceToken || generateRandomHex(24);
  }
  return { deviceId, deviceToken };
}

async function readSwMeta(key: string): Promise<Record<string, unknown> | null> {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(SW_META_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SW_META_STORE)) {
          db.createObjectStore(SW_META_STORE);
        }
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          const tx = db.transaction(SW_META_STORE, 'readonly');
          const getReq = tx.objectStore(SW_META_STORE).get(key);
          getReq.onsuccess = () =>
            resolve((getReq.result as Record<string, unknown> | undefined) ?? null);
          getReq.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writeSwMeta(key: string, value: unknown): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.open(SW_META_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SW_META_STORE)) {
          db.createObjectStore(SW_META_STORE);
        }
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          const tx = db.transaction(SW_META_STORE, 'readwrite');
          tx.objectStore(SW_META_STORE).put(value, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Decodes a VAPID public key from URL-safe Base64 to a 65-byte uncompressed
 * EC P-256 point (leading 0x04 byte) required by PushManager.subscribe().
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const trimmed = base64String.trim().replace(/^["']|["']$/g, '');
  if (!trimmed || !/^[A-Za-z0-9_-]+=*$/.test(trimmed)) {
    throw new Error('VAPID public key is not valid URL-safe Base64.');
  }
  const clean = trimmed.replace(/=+$/, '');
  const padding = '='.repeat((4 - (clean.length % 4)) % 4);
  const base64 = (clean + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  if (outputArray.length !== 65 || outputArray[0] !== 0x04) {
    throw new Error(
      `Invalid VAPID public key format (expected 65-byte P-256 key starting with 0x04, got ${outputArray.length} bytes).`
    );
  }
  return outputArray;
}

function uint8ArrayToBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function inspectPushEnvironment(): PushClientEnvironment {
  const serviceWorkerSupported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  const pushManagerSupported = typeof window !== 'undefined' && 'PushManager' in window;
  const notificationSupported = typeof window !== 'undefined' && 'Notification' in window;
  const isSecureContext = typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false;
  const isIOS =
    typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  const isStandalonePwa =
    typeof window !== 'undefined' &&
    (Boolean(window.matchMedia?.('(display-mode: standalone)').matches) ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone));

  return {
    serviceWorkerSupported,
    pushManagerSupported,
    notificationSupported,
    isSecureContext,
    isIOS,
    isStandalonePwa,
    permission: notificationSupported ? Notification.permission : 'unsupported',
  };
}

function requestNotificationPermissionSync(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return Promise.resolve('unsupported');
  }
  if (Notification.permission === 'granted') return Promise.resolve('granted');
  if (Notification.permission === 'denied') return Promise.resolve('denied');

  return new Promise((resolve) => {
    let settled = false;
    const finish = (perm: NotificationPermission) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(perm);
    };
    const timer = window.setTimeout(() => finish(Notification.permission), 15_000);
    try {
      const p = Notification.requestPermission();
      if (p && typeof p.then === 'function') {
        p.then(finish, () => finish(Notification.permission));
      } else {
        finish(Notification.permission);
      }
    } catch {
      try {
        Notification.requestPermission(finish);
      } catch {
        finish(Notification.permission);
      }
    }
  });
}

export async function ensureServiceWorkerReady(timeoutMs = 10_000): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service Workers are not supported in this browser.');
  }

  const swUrl = import.meta.env.DEV ? '/dev-sw.js?dev-sw' : '/sw.js';
  const swOptions: RegistrationOptions = import.meta.env.DEV
    ? { type: 'module', scope: '/' }
    : { scope: '/' };

  let reg =
    (await navigator.serviceWorker.getRegistration('/')) ??
    (await navigator.serviceWorker.getRegistration());

  // Re-register explicitly if missing OR if a previous broken install left zero workers attached
  if (!reg || (!reg.active && !reg.installing && !reg.waiting)) {
    reg = await navigator.serviceWorker.register(swUrl, swOptions);
  }

  if (reg.active) {
    return reg;
  }

  const candidate = reg.installing ?? reg.waiting;
  if (candidate) {
    const failedEarly = await Promise.race<ServiceWorkerRegistration | 'redundant'>([
      navigator.serviceWorker.ready,
      new Promise<'redundant'>((resolve) => {
        const onChange = () => {
          if (candidate.state === 'redundant') {
            candidate.removeEventListener('statechange', onChange);
            resolve('redundant');
          }
        };
        candidate.addEventListener('statechange', onChange);
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for Service Worker activation (current state: ${candidate.state}).`
              )
            ),
          timeoutMs
        )
      ),
    ]);

    if (failedEarly === 'redundant') {
      throw new Error(
        'Service Worker became redundant during installation (script evaluation or precache failed).'
      );
    }
    return failedEarly;
  }

  const readyReg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for navigator.serviceWorker.ready.`
            )
          ),
        timeoutMs
      )
    ),
  ]);

  return readyReg || reg;
}

export interface EnablePushStepLog {
  step: string;
  ok: boolean;
  detail: string;
}

export interface EnablePushResult {
  ok: boolean;
  permission: NotificationPermission | 'unsupported';
  subscription: BackendSubscriptionSummary | null;
  error?: string;
  failedStage?: string;
  technicalDetail?: string;
  steps: EnablePushStepLog[];
}

let inFlightEnablePromise: Promise<EnablePushResult> | null = null;

async function runEnableBackgroundPushNotifications(params: {
  districtId: string;
  perPrayerEnabled: Record<PrayerName, boolean>;
  advanceMinutes: Record<PrayerName, AdvanceMinutesOption>;
}): Promise<EnablePushResult> {
  const steps: EnablePushStepLog[] = [];
  const env = inspectPushEnvironment();

  appendPushClientEvent({
    level: 'info',
    stage: 'enable_start',
    message: `Starting push setup (${getBackendTransportMode()}, ios=${env.isIOS}, standalone=${env.isStandalonePwa}, perm=${env.permission})`,
  });

  // CRITICAL FOR iOS 16.4+: Call Notification.requestPermission() synchronously FIRST
  // inside the user tap gesture before awaiting anything asynchronous!
  const permissionPromise =
    env.notificationSupported && env.permission === 'default'
      ? requestNotificationPermissionSync()
      : Promise.resolve(env.permission);

  if (!env.isSecureContext) {
    const perm = await permissionPromise;
    const msg = 'Web Push requires an HTTPS secure context.';
    steps.push({ step: 'HTTPS Secure Context', ok: false, detail: msg });
    appendPushClientEvent({ level: 'error', stage: 'https_check', message: msg });
    return {
      ok: false,
      permission: perm,
      subscription: null,
      error: msg,
      failedStage: 'HTTPS Secure Context',
      technicalDetail: msg,
      steps,
    };
  }
  steps.push({ step: 'HTTPS Secure Context', ok: true, detail: 'HTTPS verified' });

  if (!env.serviceWorkerSupported) {
    const msg = 'Service Workers are not supported in this browser.';
    steps.push({ step: 'Service Worker Support', ok: false, detail: 'navigator.serviceWorker unavailable' });
    appendPushClientEvent({ level: 'error', stage: 'sw_support', message: msg });
    return {
      ok: false,
      permission: await permissionPromise,
      subscription: null,
      error: msg,
      failedStage: 'Service Worker Support',
      technicalDetail: msg,
      steps,
    };
  }
  steps.push({ step: 'Service Worker Support', ok: true, detail: 'Supported' });

  if (!env.pushManagerSupported) {
    const perm = await permissionPromise;
    const iosHint =
      env.isIOS && !env.isStandalonePwa
        ? 'On iPhone, tap Share → Add to Home Screen and open the installed app icon to enable Web Push.'
        : 'PushManager API is not available in this browser context.';
    steps.push({ step: 'PushManager Support', ok: false, detail: iosHint });
    appendPushClientEvent({ level: 'error', stage: 'pushmanager_support', message: iosHint });
    return {
      ok: false,
      permission: perm,
      subscription: null,
      error: iosHint,
      failedStage: 'PushManager Support',
      technicalDetail: iosHint,
      steps,
    };
  }
  steps.push({ step: 'PushManager Support', ok: true, detail: 'Available' });

  const permission = await permissionPromise;
  steps.push({
    step: 'Notification Permission',
    ok: permission === 'granted',
    detail: `Permission is "${permission}"`,
  });

  if (permission !== 'granted') {
    const msg =
      permission === 'denied'
        ? 'Notification permission is denied. Enable Notifications for My Adhan in iPhone/browser settings.'
        : 'Notification permission was not granted.';
    appendPushClientEvent({ level: 'warn', stage: 'notification_permission', message: msg });
    return {
      ok: false,
      permission,
      subscription: null,
      error: msg,
      failedStage: 'Notification Permission',
      technicalDetail: `Notification.permission=${permission}`,
      steps,
    };
  }

  let reg: ServiceWorkerRegistration;
  try {
    reg = await ensureServiceWorkerReady();
    steps.push({
      step: 'Service Worker Ready',
      ok: true,
      detail: `Active script: ${reg.active?.scriptURL ?? 'registered'}`,
    });
    appendPushClientEvent({
      level: 'info',
      stage: 'sw_ready',
      message: `Service Worker active (scope=${reg.scope})`,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    steps.push({ step: 'Service Worker Ready', ok: false, detail });
    appendPushClientEvent({ level: 'error', stage: 'sw_ready', message: detail });
    return {
      ok: false,
      permission,
      subscription: null,
      error: `Service Worker could not activate: ${detail}`,
      failedStage: 'Service Worker Activation',
      technicalDetail: detail,
      steps,
    };
  }

  if (!reg.pushManager) {
    const msg =
      env.isIOS && !env.isStandalonePwa
        ? 'PushManager is unavailable in Safari tab mode. Open My Adhan from your iPhone Home Screen icon.'
        : 'PushManager is not available on the active Service Worker registration.';
    steps.push({ step: 'Service Worker PushManager', ok: false, detail: msg });
    appendPushClientEvent({ level: 'error', stage: 'sw_pushmanager', message: msg });
    return {
      ok: false,
      permission,
      subscription: null,
      error: msg,
      failedStage: 'PushManager Support',
      technicalDetail: msg,
      steps,
    };
  }

  let vapidPublicKey = '';
  try {
    const keyRes = await fetchWithTimeout(backendEndpoint('vapid-public-key'), {
      headers: buildBackendHeaders(undefined, false),
    });
    const parsedKey = await parseJsonSafe<{
      configured?: boolean;
      publicKey?: string | null;
      error?: string;
      status?: string;
    }>(keyRes);

    if (!parsedKey.ok) {
      throw new Error(parsedKey.error);
    }
    if (!keyRes.ok || !parsedKey.data.publicKey) {
      throw new Error(
        parsedKey.data.error ||
          `HTTP ${keyRes.status} from VAPID endpoint — VAPID keys must be configured on the backend.`
      );
    }
    vapidPublicKey = parsedKey.data.publicKey.trim();
    steps.push({
      step: 'VAPID Public Key',
      ok: true,
      detail: `Fetched (${vapidPublicKey.slice(0, 14)}…)`,
    });
    appendPushClientEvent({
      level: 'info',
      stage: 'vapid_fetch',
      message: `Fetched backend VAPID public key (${vapidPublicKey.slice(0, 12)}…)`,
      httpStatus: keyRes.status,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    steps.push({ step: 'VAPID Public Key', ok: false, detail });
    appendPushClientEvent({ level: 'error', stage: 'vapid_fetch', message: detail });
    return {
      ok: false,
      permission,
      subscription: null,
      error: `Failed to retrieve server VAPID public key: ${detail}`,
      failedStage: 'VAPID Public Key Retrieval',
      technicalDetail: detail,
      steps,
    };
  }

  let expectedAppServerKey: Uint8Array<ArrayBuffer>;
  try {
    expectedAppServerKey = urlBase64ToUint8Array(vapidPublicKey);
    steps.push({ step: 'VAPID Key Conversion', ok: true, detail: '65-byte P-256 key validated' });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    steps.push({ step: 'VAPID Key Conversion', ok: false, detail });
    appendPushClientEvent({ level: 'error', stage: 'vapid_convert', message: detail });
    return {
      ok: false,
      permission,
      subscription: null,
      error: `Invalid VAPID public key received from server: ${detail}`,
      failedStage: 'VAPID Key Conversion',
      technicalDetail: detail,
      steps,
    };
  }

  let browserSub: PushSubscription;
  try {
    const normalizedVapid = vapidPublicKey.replace(/=+$/, '');
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      const existingKey = uint8ArrayToBase64Url(existing.options?.applicationServerKey ?? null);
      if (existingKey && existingKey !== normalizedVapid) {
        appendPushClientEvent({
          level: 'warn',
          stage: 'pushmanager_rotate',
          message: 'Existing PushSubscription used an outdated VAPID key; unsubscribing before re-subscribing.',
        });
        await existing.unsubscribe();
      }
    }

    const current = await reg.pushManager.getSubscription();
    if (current) {
      browserSub = current;
      steps.push({
        step: 'PushManager Subscription',
        ok: true,
        detail: `Reused active subscription (${new URL(browserSub.endpoint).hostname})`,
      });
    } else {
      browserSub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: expectedAppServerKey,
      });
      steps.push({
        step: 'PushManager Subscription',
        ok: true,
        detail: `Created new subscription (${new URL(browserSub.endpoint).hostname})`,
      });
    }

    appendPushClientEvent({
      level: 'info',
      stage: 'pushmanager_subscribe',
      message: `Browser PushSubscription active on ${new URL(browserSub.endpoint).hostname}`,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    steps.push({ step: 'PushManager Subscription', ok: false, detail });
    appendPushClientEvent({ level: 'error', stage: 'pushmanager_subscribe', message: detail });
    return {
      ok: false,
      permission,
      subscription: null,
      error: `Browser push subscription failed: ${detail}`,
      failedStage: 'PushSubscription Creation',
      technicalDetail: detail,
      steps,
    };
  }

  const { deviceId, deviceToken } = getOrCreateDeviceCredentials();
  const subJson = browserSub.toJSON();
  if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
    const detail = 'Browser PushSubscription.toJSON() omitted endpoint or encryption keys.';
    steps.push({ step: 'PushSubscription Keys', ok: false, detail });
    appendPushClientEvent({ level: 'error', stage: 'pushmanager_keys', message: detail });
    return {
      ok: false,
      permission,
      subscription: null,
      error: detail,
      failedStage: 'PushSubscription Keys',
      technicalDetail: detail,
      steps,
    };
  }

  try {
    const saveRes = await fetchWithTimeout(backendEndpoint('subscribe'), {
      method: 'POST',
      headers: buildBackendHeaders(deviceToken),
      body: JSON.stringify({
        deviceId,
        deviceToken,
        subscription: subJson,
        districtId: params.districtId,
        perPrayerEnabled: params.perPrayerEnabled,
        advanceMinutes: params.advanceMinutes,
      }),
    });

    const parsedSave = await parseJsonSafe<{
      ok?: boolean;
      error?: string;
      subscription?: BackendSubscriptionSummary;
    }>(saveRes);

    if (!parsedSave.ok) {
      throw new Error(parsedSave.error);
    }
    if (!saveRes.ok || !parsedSave.data.ok || !parsedSave.data.subscription) {
      throw new Error(parsedSave.data.error || `Backend returned HTTP ${saveRes.status}`);
    }

    appendPushClientEvent({
      level: 'info',
      stage: 'backend_register',
      message: `Device & subscription persisted for ${parsedSave.data.subscription.zoneName}`,
      httpStatus: saveRes.status,
    });

    await writeSwMeta('device_registration', {
      deviceId,
      deviceToken,
      districtId: params.districtId,
      perPrayerEnabled: params.perPrayerEnabled,
      advanceMinutes: params.advanceMinutes,
      vapidPublicKey,
      supabaseUrl: IS_SUPABASE_BACKEND ? SUPABASE_URL : null,
      supabaseAnonKey: IS_SUPABASE_BACKEND ? SUPABASE_ANON_KEY : null,
    });

    steps.push({
      step: 'Backend Storage',
      ok: true,
      detail: `Saved for ${parsedSave.data.subscription.zoneName}`,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    steps.push({ step: 'Backend Registration', ok: false, detail });
    appendPushClientEvent({ level: 'error', stage: 'backend_register', message: detail });
    return {
      ok: false,
      permission,
      subscription: null,
      error: `Could not register device with backend: ${detail}`,
      failedStage: 'Backend Registration Request',
      technicalDetail: detail,
      steps,
    };
  }

  try {
    const verifyStatus = await fetchBackendPushStatus();
    if (!verifyStatus.exists || verifyStatus.subscription?.status !== 'active') {
      const reason =
        verifyStatus.error ||
        (verifyStatus.subscription
          ? `Backend status is "${verifyStatus.subscription.status}" instead of "active".`
          : 'Device subscription could not be verified on backend.');
      throw new Error(reason);
    }

    steps.push({
      step: 'Registration Verification',
      ok: true,
      detail: `Verified active subscription ID ${verifyStatus.subscription.subscriptionId.slice(0, 8)}`,
    });
    appendPushClientEvent({
      level: 'info',
      stage: 'backend_verify',
      message: `Verified active subscription (${verifyStatus.subscription.subscriptionId.slice(0, 8)})`,
      httpStatus: verifyStatus.httpStatus ?? 200,
    });

    return {
      ok: true,
      permission,
      subscription: verifyStatus.subscription,
      steps,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    steps.push({ step: 'Registration Verification', ok: false, detail });
    appendPushClientEvent({ level: 'error', stage: 'backend_verify', message: detail });
    return {
      ok: false,
      permission,
      subscription: null,
      error: `Registration saved but verification failed: ${detail}`,
      failedStage: 'Backend Registration Verification',
      technicalDetail: detail,
      steps,
    };
  }
}

export function enableBackgroundPushNotifications(params: {
  districtId: string;
  perPrayerEnabled: Record<PrayerName, boolean>;
  advanceMinutes: Record<PrayerName, AdvanceMinutesOption>;
}): Promise<EnablePushResult> {
  if (inFlightEnablePromise) {
    appendPushClientEvent({
      level: 'warn',
      stage: 'enable_deduped',
      message: 'Deduplicated concurrent Enable Prayer Notifications request.',
    });
    return inFlightEnablePromise;
  }

  inFlightEnablePromise = runEnableBackgroundPushNotifications(params)
    .catch((err): EnablePushResult => {
      const detail = err instanceof Error ? err.message : String(err);
      appendPushClientEvent({ level: 'error', stage: 'enable_unexpected', message: detail });
      return {
        ok: false,
        permission: inspectPushEnvironment().permission,
        subscription: null,
        error: `Unexpected error during push setup: ${detail}`,
        failedStage: 'Unexpected Error',
        technicalDetail: detail,
        steps: [{ step: 'Unexpected Exception', ok: false, detail }],
      };
    })
    .finally(() => {
      inFlightEnablePromise = null;
    });

  return inFlightEnablePromise;
}

export async function disableBackgroundPushNotifications(): Promise<{
  ok: boolean;
  subscription: BackendSubscriptionSummary | null;
  error?: string;
}> {
  const { deviceId, deviceToken } = getOrCreateDeviceCredentials();

  try {
    if ('serviceWorker' in navigator) {
      const reg =
        (await navigator.serviceWorker.getRegistration('/')) ??
        (await navigator.serviceWorker.getRegistration());
      const existing = await reg?.pushManager?.getSubscription();
      if (existing) {
        await existing.unsubscribe();
      }
    }
  } catch {
    // Proceed to mark backend disabled even if browser unsubscribe fails
  }

  try {
    const res = await fetchWithTimeout(backendEndpoint('unsubscribe'), {
      method: 'POST',
      headers: buildBackendHeaders(deviceToken),
      body: JSON.stringify({ action: 'unsubscribe', deviceId, deviceToken }),
    });

    const parsed = await parseJsonSafe<{
      ok?: boolean;
      error?: string;
      subscription?: BackendSubscriptionSummary | null;
    }>(res);

    if (!parsed.ok) {
      appendPushClientEvent({ level: 'error', stage: 'disable_push', message: parsed.error, httpStatus: res.status });
      return { ok: false, subscription: null, error: parsed.error };
    }
    if (!res.ok) {
      const errMsg = parsed.data.error || `HTTP ${res.status}`;
      appendPushClientEvent({ level: 'error', stage: 'disable_push', message: errMsg, httpStatus: res.status });
      return { ok: false, subscription: parsed.data.subscription ?? null, error: errMsg };
    }

    appendPushClientEvent({
      level: 'info',
      stage: 'disable_push',
      message: 'Disabled push subscription cleanly.',
      httpStatus: res.status,
    });
    return { ok: true, subscription: parsed.data.subscription ?? null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendPushClientEvent({ level: 'error', stage: 'disable_push', message: msg });
    return { ok: false, subscription: null, error: msg };
  }
}

export async function fetchBackendPushStatus(): Promise<{
  exists: boolean;
  subscription: BackendSubscriptionSummary | null;
  recentDeliveries: BackendDeliveryAttempt[];
  browserHasSubscription: boolean;
  httpStatus?: number;
  error?: string;
}> {
  const { deviceId, deviceToken } = getOrCreateDeviceCredentials();

  let browserHasSubscription = false;
  try {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const reg =
        (await navigator.serviceWorker.getRegistration('/')) ??
        (await navigator.serviceWorker.getRegistration());
      const sub = await reg?.pushManager?.getSubscription();
      browserHasSubscription = Boolean(sub);
    }
  } catch {
    browserHasSubscription = false;
  }

  try {
    const res = await fetchWithTimeout(backendEndpoint('status', deviceId), {
      headers: buildBackendHeaders(deviceToken, false),
    });

    const parsed = await parseJsonSafe<{
      exists?: boolean;
      error?: string;
      subscription?: BackendSubscriptionSummary | null;
      recentDeliveries?: BackendDeliveryAttempt[];
    }>(res);

    if (!parsed.ok) {
      return {
        exists: false,
        subscription: null,
        recentDeliveries: [],
        browserHasSubscription,
        httpStatus: res.status,
        error: parsed.error,
      };
    }

    if (!res.ok) {
      return {
        exists: false,
        subscription: null,
        recentDeliveries: [],
        browserHasSubscription,
        httpStatus: res.status,
        error: parsed.data.error || `HTTP ${res.status}`,
      };
    }

    return {
      exists: Boolean(parsed.data.exists),
      subscription: parsed.data.subscription ?? null,
      recentDeliveries: parsed.data.recentDeliveries ?? [],
      browserHasSubscription,
      httpStatus: res.status,
    };
  } catch (err) {
    return {
      exists: false,
      subscription: null,
      recentDeliveries: [],
      browserHasSubscription,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function syncPushPreferencesToBackend(params: {
  districtId: string;
  perPrayerEnabled: Record<PrayerName, boolean>;
  advanceMinutes: Record<PrayerName, AdvanceMinutesOption>;
}): Promise<BackendSubscriptionSummary | null> {
  const { deviceId, deviceToken } = getOrCreateDeviceCredentials();

  try {
    if ('serviceWorker' in navigator && 'PushManager' in window && Notification.permission === 'granted') {
      const reg =
        (await navigator.serviceWorker.getRegistration('/')) ??
        (await navigator.serviceWorker.getRegistration());
      const browserSub = await reg?.pushManager?.getSubscription();
      if (browserSub) {
        const prevMeta = await readSwMeta('device_registration');
        await writeSwMeta('device_registration', {
          ...(prevMeta ?? {}),
          deviceId,
          deviceToken,
          districtId: params.districtId,
          perPrayerEnabled: params.perPrayerEnabled,
          advanceMinutes: params.advanceMinutes,
          supabaseUrl: IS_SUPABASE_BACKEND ? SUPABASE_URL : null,
          supabaseAnonKey: IS_SUPABASE_BACKEND ? SUPABASE_ANON_KEY : null,
        });
      }
    }
  } catch {
    // Ignore SW inspection failure during background sync
  }

  try {
    const res = await fetchWithTimeout(backendEndpoint('preferences'), {
      method: 'PATCH',
      headers: buildBackendHeaders(deviceToken),
      body: JSON.stringify({
        deviceId,
        deviceToken,
        districtId: params.districtId,
        perPrayerEnabled: params.perPrayerEnabled,
        advanceMinutes: params.advanceMinutes,
      }),
    });

    if (!res.ok) return null;
    const parsed = await parseJsonSafe<{ subscription?: BackendSubscriptionSummary | null }>(res);
    if (!parsed.ok) return null;
    return parsed.data.subscription ?? null;
  } catch {
    return null;
  }
}

export async function sendBackendTestPushNotification(): Promise<{
  ok: boolean;
  statusCode?: number | null;
  eventKey?: string;
  error?: string;
  subscription?: BackendSubscriptionSummary | null;
}> {
  const { deviceId, deviceToken } = getOrCreateDeviceCredentials();
  try {
    const res = await fetchWithTimeout(backendEndpoint('test'), {
      method: 'POST',
      headers: buildBackendHeaders(deviceToken),
      body: JSON.stringify({ deviceId, deviceToken }),
    });

    const parsed = await parseJsonSafe<{
      ok?: boolean;
      statusCode?: number | null;
      eventKey?: string;
      error?: string;
      subscription?: BackendSubscriptionSummary | null;
    }>(res);

    if (!parsed.ok) {
      appendPushClientEvent({ level: 'error', stage: 'test_push', message: parsed.error, httpStatus: res.status });
      return { ok: false, error: parsed.error };
    }

    const ok = Boolean(res.ok && parsed.data.ok);
    appendPushClientEvent({
      level: ok ? 'info' : 'error',
      stage: 'test_push',
      message: ok
        ? `Backend accepted test push (HTTP ${parsed.data.statusCode ?? 201})`
        : parsed.data.error || `Test push failed (HTTP ${res.status})`,
      httpStatus: parsed.data.statusCode ?? res.status,
    });

    return {
      ok,
      statusCode: parsed.data.statusCode ?? res.status,
      eventKey: parsed.data.eventKey,
      error: ok ? undefined : parsed.data.error || `HTTP ${res.status}`,
      subscription: parsed.data.subscription ?? null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendPushClientEvent({ level: 'error', stage: 'test_push', message: msg });
    return { ok: false, error: msg };
  }
}

export async function scheduleBackgroundTestPush(params?: {
  delayMinutes?: number;
}): Promise<{
  ok: boolean;
  job?: BackgroundTestJobSummary | null;
  error?: string;
  httpStatus?: number | null;
}> {
  const { deviceId, deviceToken } = getOrCreateDeviceCredentials();
  const delayMinutes = params?.delayMinutes ?? 2;

  try {
    const res = await fetchWithTimeout(backendEndpoint('schedule-test-push'), {
      method: 'POST',
      headers: buildBackendHeaders(deviceToken),
      body: JSON.stringify({ deviceId, deviceToken, delayMinutes }),
    });

    const parsed = await parseJsonSafe<{
      ok?: boolean;
      job?: BackgroundTestJobSummary | null;
      error?: string;
    }>(res);

    if (!parsed.ok) {
      appendPushClientEvent({
        level: 'error',
        stage: 'schedule_test_push',
        message: parsed.error,
        httpStatus: res.status,
      });
      return { ok: false, error: parsed.error, httpStatus: res.status };
    }

    const ok = Boolean(res.ok && parsed.data.ok);
    appendPushClientEvent({
      level: ok ? 'info' : 'error',
      stage: 'schedule_test_push',
      message: ok
        ? `Scheduled background push in ${delayMinutes} min (${parsed.data.job?.scheduledAt ?? 'queued'})`
        : parsed.data.error || `Scheduling failed (HTTP ${res.status})`,
      httpStatus: res.status,
    });

    return {
      ok,
      job: parsed.data.job ?? null,
      error: ok ? undefined : parsed.data.error || `HTTP ${res.status}`,
      httpStatus: res.status,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendPushClientEvent({ level: 'error', stage: 'schedule_test_push', message: msg });
    return { ok: false, error: msg, httpStatus: null };
  }
}

export async function cancelBackgroundTestPush(): Promise<{
  ok: boolean;
  cancelledCount?: number;
  error?: string;
}> {
  const { deviceId, deviceToken } = getOrCreateDeviceCredentials();

  try {
    const res = await fetchWithTimeout(backendEndpoint('schedule-test-push'), {
      method: 'POST',
      headers: buildBackendHeaders(deviceToken),
      body: JSON.stringify({ action: 'cancel', deviceId, deviceToken }),
    });

    const parsed = await parseJsonSafe<{
      ok?: boolean;
      cancelledCount?: number;
      error?: string;
    }>(res);

    if (!parsed.ok) {
      appendPushClientEvent({
        level: 'error',
        stage: 'cancel_test_push',
        message: parsed.error,
        httpStatus: res.status,
      });
      return { ok: false, error: parsed.error };
    }

    const ok = Boolean(res.ok && parsed.data.ok);
    appendPushClientEvent({
      level: ok ? 'info' : 'warn',
      stage: 'cancel_test_push',
      message: ok ? 'Cancelled scheduled background test push.' : parsed.data.error || 'Cancel failed',
      httpStatus: res.status,
    });

    return {
      ok,
      cancelledCount: parsed.data.cancelledCount,
      error: ok ? undefined : parsed.data.error,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendPushClientEvent({ level: 'error', stage: 'cancel_test_push', message: msg });
    return { ok: false, error: msg };
  }
}

export async function fetchBackgroundTestJobStatus(): Promise<{
  ok: boolean;
  job: BackgroundTestJobSummary | null;
  error?: string;
}> {
  const { deviceId, deviceToken } = getOrCreateDeviceCredentials();

  try {
    const endpoint = backendEndpoint('schedule-test-push', deviceId);
    const res = await fetchWithTimeout(endpoint, {
      headers: buildBackendHeaders(deviceToken, false),
    });

    const parsed = await parseJsonSafe<{
      ok?: boolean;
      job?: BackgroundTestJobSummary | null;
      error?: string;
    }>(res);

    if (!parsed.ok) {
      return { ok: false, job: null, error: parsed.error };
    }

    return {
      ok: Boolean(res.ok && parsed.data.ok),
      job: parsed.data.job ?? null,
      error: res.ok ? undefined : parsed.data.error || `HTTP ${res.status}`,
    };
  } catch (err) {
    return { ok: false, job: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function verifyPushClickWithBackend(eventKey?: string | null): Promise<string | null> {
  const { deviceId, deviceToken } = getOrCreateDeviceCredentials();
  try {
    const res = await fetchWithTimeout(backendEndpoint('verify-click'), {
      method: 'POST',
      headers: buildBackendHeaders(deviceToken),
      body: JSON.stringify({ action: 'verify-click', deviceId, deviceToken, eventKey: eventKey ?? null }),
    });
    if (!res.ok) return null;
    const parsed = await parseJsonSafe<{ lastClickVerifiedAt?: string | null }>(res);
    return parsed.ok ? parsed.data.lastClickVerifiedAt ?? null : null;
  } catch {
    return null;
  }
}

export async function triggerExpiredCleanupDiagnostic(): Promise<{
  ok: boolean;
  subscription: BackendSubscriptionSummary | null;
  error?: string;
}> {
  const { deviceId, deviceToken } = getOrCreateDeviceCredentials();
  try {
    const res = await fetchWithTimeout(backendEndpoint('test-expired-cleanup'), {
      method: 'POST',
      headers: buildBackendHeaders(deviceToken),
      body: JSON.stringify({ action: 'simulate-410', deviceId, deviceToken }),
    });
    const parsed = await parseJsonSafe<{
      ok?: boolean;
      subscription?: BackendSubscriptionSummary | null;
      error?: string;
    }>(res);
    if (!parsed.ok) {
      return { ok: false, subscription: null, error: parsed.error };
    }
    return {
      ok: Boolean(res.ok && parsed.data.ok),
      subscription: parsed.data.subscription ?? null,
      error: parsed.data.error,
    };
  } catch (err) {
    return {
      ok: false,
      subscription: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function fetchPushDiagnosticsDetailed(): Promise<
  | { ok: true; httpStatus: number; data: PushDiagnosticsResponse }
  | { ok: false; httpStatus: number | null; error: string }
> {
  const { deviceId, deviceToken } = getOrCreateDeviceCredentials();
  try {
    const res = await fetchWithTimeout(backendEndpoint('diagnostics', deviceId), {
      headers: buildBackendHeaders(deviceToken, false),
    });

    const parsed = await parseJsonSafe<PushDiagnosticsResponse & { error?: string }>(res);
    if (!parsed.ok) {
      appendPushClientEvent({
        level: 'error',
        stage: 'diagnostics_fetch',
        message: parsed.error,
        httpStatus: res.status,
      });
      return { ok: false, httpStatus: res.status, error: parsed.error };
    }

    if (!res.ok) {
      const msg = parsed.data.error || `Backend returned HTTP ${res.status}`;
      appendPushClientEvent({
        level: 'error',
        stage: 'diagnostics_fetch',
        message: msg,
        httpStatus: res.status,
      });
      return { ok: false, httpStatus: res.status, error: msg };
    }

    return { ok: true, httpStatus: res.status, data: parsed.data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendPushClientEvent({ level: 'error', stage: 'diagnostics_fetch', message: msg });
    return { ok: false, httpStatus: null, error: msg };
  }
}

export async function fetchPushDiagnostics(): Promise<PushDiagnosticsResponse | null> {
  const res = await fetchPushDiagnosticsDetailed();
  return res.ok ? res.data : null;
}

export async function fetchVapidPublicKeyStatus(): Promise<{
  ok: boolean;
  configured?: boolean;
  status?: string;
  publicKeyPreview?: string | null;
  subject?: string | null;
  httpStatus?: number | null;
  error?: string;
  setupInstructions?: string[];
}> {
  try {
    const res = await fetchWithTimeout(backendEndpoint('vapid-public-key'), {
      headers: buildBackendHeaders(undefined, false),
    });
    const parsed = await parseJsonSafe<{
      configured?: boolean;
      status?: string;
      publicKey?: string | null;
      subject?: string | null;
      error?: string;
      setupInstructions?: string[];
    }>(res);

    if (!parsed.ok) {
      return {
        ok: false,
        configured: false,
        httpStatus: res.status,
        error: parsed.error,
      };
    }

    if (res.ok && parsed.data.publicKey) {
      return {
        ok: true,
        configured: true,
        status: parsed.data.status ?? 'configured',
        publicKeyPreview: `${parsed.data.publicKey.slice(0, 14)}…`,
        subject: parsed.data.subject ?? null,
        httpStatus: res.status,
      };
    }

    return {
      ok: false,
      configured: false,
      status: parsed.data.status,
      subject: parsed.data.subject ?? null,
      httpStatus: res.status,
      error: parsed.data.error || `HTTP ${res.status} from VAPID public-key endpoint.`,
      setupInstructions: Array.isArray(parsed.data.setupInstructions)
        ? parsed.data.setupInstructions
        : [],
    };
  } catch (err) {
    return {
      ok: false,
      configured: false,
      httpStatus: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function pingServiceWorker(): Promise<{
  ok: boolean;
  swVersion?: string;
  precacheCount?: number;
  error?: string;
}> {
  if (!('serviceWorker' in navigator)) return { ok: false, error: 'Service Worker unsupported' };
  try {
    const reg = await ensureServiceWorkerReady(4000);
    const active = reg.active;
    if (!active) return { ok: false, error: 'No active Service Worker' };
    return await new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = window.setTimeout(
        () => resolve({ ok: false, error: 'SW_PING timed out after 2s' }),
        2000
      );
      channel.port1.onmessage = (evt) => {
        window.clearTimeout(timer);
        const data = evt.data as
          | { ok?: boolean; swVersion?: string; precacheCount?: number }
          | undefined;
        resolve({
          ok: Boolean(data?.ok),
          swVersion: data?.swVersion,
          precacheCount: data?.precacheCount,
        });
      };
      active.postMessage({ type: 'SW_PING' }, [channel.port2]);
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
