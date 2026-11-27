import type { AdvanceMinutesOption, PrayerName } from '../shared/types';

const DEVICE_ID_KEY = 'my_adhan_device_id_v1';
const DEVICE_TOKEN_KEY = 'my_adhan_device_token_v1';
const SW_META_DB = 'my_adhan_sw_meta';
const SW_META_STORE = 'kv';
export const PUSH_CHANNEL_NAME = 'my-adhan-push';

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
    publicKeyPreview: string;
    configuredViaEnv: boolean;
    subject: string;
  };
  subscription: BackendSubscriptionSummary | null;
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

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
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
  const isSecureContext = typeof window !== 'undefined' ? window.isSecureContext : false;
  const isIOS =
    typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  const isStandalonePwa =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
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

  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    const swUrl = import.meta.env.DEV ? '/dev-sw.js?dev-sw' : '/sw.js';
    reg = await navigator.serviceWorker.register(
      swUrl,
      import.meta.env.DEV ? { type: 'module', scope: '/' } : { scope: '/' }
    );
  }

  const readyReg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      window.setTimeout(
        () => reject(new Error('Timed out waiting for Service Worker activation.')),
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
  steps: EnablePushStepLog[];
}

export async function enableBackgroundPushNotifications(params: {
  districtId: string;
  perPrayerEnabled: Record<PrayerName, boolean>;
  advanceMinutes: Record<PrayerName, AdvanceMinutesOption>;
}): Promise<EnablePushResult> {
  const steps: EnablePushStepLog[] = [];
  const env = inspectPushEnvironment();

  // CRITICAL FOR iOS 16.4+: Call Notification.requestPermission() synchronously FIRST
  // inside the user tap gesture before awaiting anything asynchronous!
  const permissionPromise =
    env.notificationSupported && env.permission === 'default'
      ? requestNotificationPermissionSync()
      : Promise.resolve(env.permission);

  if (!env.serviceWorkerSupported) {
    steps.push({ step: 'Service Worker Support', ok: false, detail: 'navigator.serviceWorker unavailable' });
    return {
      ok: false,
      permission: await permissionPromise,
      subscription: null,
      error: 'Service Workers are not supported in this browser.',
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
    return { ok: false, permission: perm, subscription: null, error: iosHint, steps };
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
    return { ok: false, permission, subscription: null, error: msg, steps };
  }

  let reg: ServiceWorkerRegistration;
  try {
    reg = await ensureServiceWorkerReady();
    steps.push({
      step: 'Service Worker Ready',
      ok: true,
      detail: `Active script: ${reg.active?.scriptURL ?? 'registered'}`,
    });
  } catch (err) {
    const detail = (err as Error).message;
    steps.push({ step: 'Service Worker Ready', ok: false, detail });
    return { ok: false, permission, subscription: null, error: detail, steps };
  }

  let vapidPublicKey = '';
  try {
    const keyRes = await fetch('/api/push/vapid-public-key');
    if (!keyRes.ok) {
      throw new Error(`HTTP ${keyRes.status} from /api/push/vapid-public-key`);
    }
    const keyJson = (await keyRes.json()) as { publicKey?: string };
    if (!keyJson.publicKey) {
      throw new Error('Server returned empty VAPID public key.');
    }
    vapidPublicKey = keyJson.publicKey;
    steps.push({
      step: 'VAPID Public Key',
      ok: true,
      detail: `Fetched (${vapidPublicKey.slice(0, 14)}…)`,
    });
  } catch (err) {
    const detail = (err as Error).message;
    steps.push({ step: 'VAPID Public Key', ok: false, detail });
    return { ok: false, permission, subscription: null, error: detail, steps };
  }

  const expectedAppServerKey = urlBase64ToUint8Array(vapidPublicKey);
  let browserSub: PushSubscription;

  try {
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      const existingKey = uint8ArrayToBase64Url(existing.options?.applicationServerKey ?? null);
      if (existingKey && existingKey !== vapidPublicKey) {
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
  } catch (err) {
    const detail = (err as Error).message;
    steps.push({ step: 'PushManager Subscription', ok: false, detail });
    return { ok: false, permission, subscription: null, error: detail, steps };
  }

  const { deviceId, deviceToken } = getOrCreateDeviceCredentials();
  const subJson = browserSub.toJSON();

  try {
    const saveRes = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Token': deviceToken,
      },
      body: JSON.stringify({
        deviceId,
        deviceToken,
        subscription: subJson,
        districtId: params.districtId,
        perPrayerEnabled: params.perPrayerEnabled,
        advanceMinutes: params.advanceMinutes,
      }),
    });

    const saveJson = (await saveRes.json()) as {
      ok?: boolean;
      error?: string;
      subscription?: BackendSubscriptionSummary;
    };

    if (!saveRes.ok || !saveJson.ok || !saveJson.subscription) {
      throw new Error(saveJson.error || `Backend returned HTTP ${saveRes.status}`);
    }

    await writeSwMeta('device_registration', {
      deviceId,
      deviceToken,
      districtId: params.districtId,
      perPrayerEnabled: params.perPrayerEnabled,
      advanceMinutes: params.advanceMinutes,
      vapidPublicKey,
    });

    steps.push({
      step: 'Backend Storage',
      ok: true,
      detail: `Saved for ${saveJson.subscription.zoneName}`,
    });

    // Explicitly verify persisted registration
    const verifyStatus = await fetchBackendPushStatus();
    if (!verifyStatus.exists || verifyStatus.subscription?.status !== 'active') {
      throw new Error('Backend verification check did not confirm an active subscription.');
    }

    steps.push({
      step: 'Registration Verification',
      ok: true,
      detail: `Verified active subscription ID ${verifyStatus.subscription.subscriptionId.slice(0, 8)}`,
    });

    return {
      ok: true,
      permission,
      subscription: verifyStatus.subscription,
      steps,
    };
  } catch (err) {
    const detail = (err as Error).message;
    steps.push({ step: 'Backend Registration', ok: false, detail });
    return { ok: false, permission, subscription: null, error: detail, steps };
  }
}

export async function disableBackgroundPushNotifications(): Promise<{
  ok: boolean;
  subscription: BackendSubscriptionSummary | null;
  error?: string;
}> {
  const { deviceId, deviceToken } = getOrCreateDeviceCredentials();

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      const existing = await reg?.pushManager?.getSubscription();
      if (existing) {
        await existing.unsubscribe();
      }
    }
  } catch {
    // Proceed to mark backend disabled even if browser unsubscribe fails
  }

  const res = await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Token': deviceToken,
    },
    body: JSON.stringify({ deviceId, deviceToken }),
  });

  const json = (await res.json()) as {
    ok?: boolean;
    error?: string;
    subscription?: BackendSubscriptionSummary | null;
  };
  if (!res.ok) {
    return {
      ok: false,
      subscription: json.subscription ?? null,
      error: json.error || `HTTP ${res.status}`,
    };
  }
  return { ok: true, subscription: json.subscription ?? null };
}

export async function fetchBackendPushStatus(): Promise<{
  exists: boolean;
  subscription: BackendSubscriptionSummary | null;
  recentDeliveries: BackendDeliveryAttempt[];
  browserHasSubscription: boolean;
}> {
  const { deviceId, deviceToken } = getOrCreateDeviceCredentials();

  let browserHasSubscription = false;
  try {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager?.getSubscription();
      browserHasSubscription = Boolean(sub);
    }
  } catch {
    browserHasSubscription = false;
  }

  const res = await fetch(`/api/push/status?deviceId=${encodeURIComponent(deviceId)}`, {
    headers: {
      'X-Device-Token': deviceToken,
    },
  });

  if (!res.ok) {
    return {
      exists: false,
      subscription: null,
      recentDeliveries: [],
      browserHasSubscription,
    };
  }

  const json = (await res.json()) as {
    exists: boolean;
    subscription: BackendSubscriptionSummary | null;
    recentDeliveries?: BackendDeliveryAttempt[];
  };

  return {
    exists: Boolean(json.exists),
    subscription: json.subscription ?? null,
    recentDeliveries: json.recentDeliveries ?? [],
    browserHasSubscription,
  };
}

export async function syncPushPreferencesToBackend(params: {
  districtId: string;
  perPrayerEnabled: Record<PrayerName, boolean>;
  advanceMinutes: Record<PrayerName, AdvanceMinutesOption>;
}): Promise<BackendSubscriptionSummary | null> {
  const { deviceId, deviceToken } = getOrCreateDeviceCredentials();

  // Also ensure browser subscription didn't silently expire/rotate while app was closed
  try {
    if ('serviceWorker' in navigator && 'PushManager' in window && Notification.permission === 'granted') {
      const reg = await navigator.serviceWorker.getRegistration();
      const browserSub = await reg?.pushManager?.getSubscription();
      if (browserSub) {
        await writeSwMeta('device_registration', {
          deviceId,
          deviceToken,
          districtId: params.districtId,
          perPrayerEnabled: params.perPrayerEnabled,
          advanceMinutes: params.advanceMinutes,
        });
      }
    }
  } catch {
    // Ignore SW inspection failure during background sync
  }

  const res = await fetch('/api/push/preferences', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Token': deviceToken,
    },
    body: JSON.stringify({
      deviceId,
      deviceToken,
      districtId: params.districtId,
      perPrayerEnabled: params.perPrayerEnabled,
      advanceMinutes: params.advanceMinutes,
    }),
  });

  if (!res.ok) return null;
  const json = (await res.json()) as { subscription?: BackendSubscriptionSummary | null };
  return json.subscription ?? null;
}

export async function sendBackendTestPushNotification(): Promise<{
  ok: boolean;
  statusCode?: number | null;
  eventKey?: string;
  error?: string;
  subscription?: BackendSubscriptionSummary | null;
}> {
  const { deviceId, deviceToken } = getOrCreateDeviceCredentials();
  const res = await fetch('/api/push/test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Token': deviceToken,
    },
    body: JSON.stringify({ deviceId, deviceToken }),
  });

  const json = (await res.json()) as {
    ok?: boolean;
    statusCode?: number | null;
    eventKey?: string;
    error?: string;
    subscription?: BackendSubscriptionSummary | null;
  };
  return {
    ok: Boolean(res.ok && json.ok),
    statusCode: json.statusCode,
    eventKey: json.eventKey,
    error: json.error,
    subscription: json.subscription ?? null,
  };
}

export async function verifyPushClickWithBackend(eventKey?: string | null): Promise<string | null> {
  const { deviceId, deviceToken } = getOrCreateDeviceCredentials();
  try {
    const res = await fetch('/api/push/verify-click', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Token': deviceToken,
      },
      body: JSON.stringify({ deviceId, deviceToken, eventKey: eventKey ?? null }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { lastClickVerifiedAt?: string | null };
    return json.lastClickVerifiedAt ?? null;
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
  const res = await fetch('/api/push/test-expired-cleanup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Token': deviceToken,
    },
    body: JSON.stringify({ deviceId, deviceToken }),
  });
  const json = (await res.json()) as {
    ok?: boolean;
    subscription?: BackendSubscriptionSummary | null;
    error?: string;
  };
  return {
    ok: Boolean(res.ok && json.ok),
    subscription: json.subscription ?? null,
    error: json.error,
  };
}

export async function fetchPushDiagnostics(): Promise<PushDiagnosticsResponse | null> {
  const { deviceId, deviceToken } = getOrCreateDeviceCredentials();
  const res = await fetch(`/api/push/diagnostics?deviceId=${encodeURIComponent(deviceId)}`, {
    headers: {
      'X-Device-Token': deviceToken,
    },
  });
  if (!res.ok) return null;
  return (await res.json()) as PushDiagnosticsResponse;
}

export async function pingServiceWorker(): Promise<{ ok: boolean; swVersion?: string }> {
  if (!('serviceWorker' in navigator)) return { ok: false };
  try {
    const reg = await ensureServiceWorkerReady(4000);
    const active = reg.active;
    if (!active) return { ok: false };
    return await new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = window.setTimeout(() => resolve({ ok: false }), 1500);
      channel.port1.onmessage = (evt) => {
        window.clearTimeout(timer);
        const data = evt.data as { ok?: boolean; swVersion?: string } | undefined;
        resolve({ ok: Boolean(data?.ok), swVersion: data?.swVersion });
      };
      active.postMessage({ type: 'SW_PING' }, [channel.port2]);
    });
  } catch {
    return { ok: false };
  }
}
