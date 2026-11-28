import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generateVAPIDKeys } from 'web-push';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioRemindersView } from '../../components/AudioRemindersView.tsx';
import { ErrorBoundary } from '../../components/ErrorBoundary.tsx';
import {
  PushDiagnosticsView,
  buildInitialDiagnosticChecks,
} from '../../components/PushDiagnosticsView.tsx';
import { ACJU_DISTRICTS, ACJU_ZONES } from '../../shared/acjuSeed.ts';
import type { UserPreferences } from '../../shared/types.ts';
import {
  appendPushClientEvent,
  cancelBackgroundTestPush,
  clearPushClientEvents,
  enableBackgroundPushNotifications,
  fetchBackgroundTestJobStatus,
  fetchPushDiagnosticsDetailed,
  getPushClientEvents,
  inspectPushEnvironment,
  scheduleBackgroundTestPush,
  urlBase64ToUint8Array,
} from '../webPushClient.ts';

function installWindowPolyfill(opts: {
  isSecureContext?: boolean;
  hasServiceWorker?: boolean;
  hasPushManager?: boolean;
  hasNotification?: boolean;
  permission?: NotificationPermission;
  userAgent?: string;
  standalone?: boolean;
  serviceWorkerOverride?: Record<string, unknown>;
} = {}) {
  const storage = new Map<string, string>();

  const localStorageMock = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => {
      storage.set(k, String(v));
    },
    removeItem: (k: string) => {
      storage.delete(k);
    },
    clear: () => {
      storage.clear();
    },
  };

  const windowObj: Record<string, unknown> = {
    isSecureContext: opts.isSecureContext ?? true,
    location: { origin: 'https://adhan-khaki.vercel.app' },
    atob: (b64: string) => Buffer.from(b64, 'base64').toString('binary'),
    btoa: (bin: string) => Buffer.from(bin, 'binary').toString('base64'),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: (query: string) => ({
      matches: Boolean(opts.standalone && query.includes('standalone')),
    }),
  };

  if (opts.hasPushManager !== false) {
    windowObj.PushManager = function PushManagerStub() {};
  }

  const notificationMock = {
    permission: opts.permission ?? 'granted',
    requestPermission: vi.fn(async () => opts.permission ?? 'granted'),
  };

  if (opts.hasNotification !== false) {
    windowObj.Notification = notificationMock;
  }

  const navigatorObj: Record<string, unknown> = {
    userAgent:
      opts.userAgent ??
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    maxTouchPoints: 5,
    standalone: opts.standalone ?? true,
  };

  if (opts.hasServiceWorker !== false) {
    navigatorObj.serviceWorker = opts.serviceWorkerOverride ?? {
      getRegistration: vi.fn(async () => undefined),
      register: vi.fn(async () => {
        throw new Error('Default mock SW register not configured');
      }),
      get ready() {
        return Promise.reject(new Error('No active SW'));
      },
    };
  }

  vi.stubGlobal('window', windowObj);
  vi.stubGlobal('navigator', navigatorObj);
  vi.stubGlobal('localStorage', localStorageMock);
  if (opts.hasNotification !== false) {
    vi.stubGlobal('Notification', notificationMock);
  } else {
    vi.stubGlobal('Notification', undefined);
  }

  return { notificationMock, navigatorObj, windowObj };
}

function makeFakeSubscription(endpoint = 'https://web.push.apple.com/QBqTestTokenSecret1234567890', appServerKeyBytes?: Uint8Array) {
  return {
    endpoint,
    options: appServerKeyBytes ? { applicationServerKey: appServerKeyBytes.buffer } : undefined,
    unsubscribe: vi.fn(async () => true),
    toJSON: () => ({
      endpoint,
      keys: {
        p256dh:
          'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=',
        auth: 'tBHItJI5svbpez7KI4CCXg==',
      },
    }),
  };
}

const SAMPLE_PREFS: UserPreferences = {
  timezone: 'Asia/Colombo',
  perPrayerEnabled: {
    fajr: true,
    dhuhr: true,
    asr: true,
    maghrib: true,
    isha: true,
  },
  advanceMinutes: {
    fajr: 0,
    dhuhr: 0,
    asr: 0,
    maghrib: 0,
    isha: 0,
  },
  selectedAudioId: 'default-adhan-tone',
  playbackMode: 'full_adhan',
  volume: 0.8,
  theme: 'system',
  allowDemoSamplePreview: false,
};

describe('webPushClient & PushDiagnosticsView reliability suite', () => {
  beforeEach(() => {
    clearPushClientEvents();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearPushClientEvents();
  });

  it('validates VAPID base64url conversion and rejects malformed or non-P256 keys', () => {
    installWindowPolyfill();
    const { publicKey } = generateVAPIDKeys();
    const converted = urlBase64ToUint8Array(`  "${publicKey}"  `);
    expect(converted).toBeInstanceOf(Uint8Array);
    expect(converted.length).toBe(65);
    expect(converted[0]).toBe(0x04);

    expect(() => urlBase64ToUint8Array('not valid!@#')).toThrow(/URL-safe Base64/i);

    const shortKey = Buffer.from(new Uint8Array(32).fill(1)).toString('base64url');
    expect(() => urlBase64ToUint8Array(shortKey)).toThrow(/65-byte P-256/i);

    const wrongPrefix = new Uint8Array(65).fill(0x02);
    expect(() => urlBase64ToUint8Array(Buffer.from(wrongPrefix).toString('base64url'))).toThrow(
      /65-byte P-256/i
    );
  });

  it('fails clearly on denied notification permission without calling backend', async () => {
    installWindowPolyfill({ permission: 'denied' });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = await enableBackgroundPushNotifications({
      districtId: 'colombo',
      perPrayerEnabled: SAMPLE_PREFS.perPrayerEnabled,
      advanceMinutes: SAMPLE_PREFS.advanceMinutes,
    });

    expect(res.ok).toBe(false);
    expect(res.permission).toBe('denied');
    expect(res.failedStage).toBe('Notification Permission');
    expect(res.error).toMatch(/denied/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails clearly when Service Worker API is missing', async () => {
    installWindowPolyfill({ hasServiceWorker: false });
    const res = await enableBackgroundPushNotifications({
      districtId: 'colombo',
      perPrayerEnabled: SAMPLE_PREFS.perPrayerEnabled,
      advanceMinutes: SAMPLE_PREFS.advanceMinutes,
    });

    expect(res.ok).toBe(false);
    expect(res.failedStage).toBe('Service Worker Support');
    expect(res.error).toMatch(/Service Workers are not supported/i);
  });

  it('fails clearly with iOS Home Screen hint when PushManager is unavailable in Safari tab', async () => {
    installWindowPolyfill({
      hasPushManager: false,
      standalone: false,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/604.1',
    });

    const res = await enableBackgroundPushNotifications({
      districtId: 'colombo',
      perPrayerEnabled: SAMPLE_PREFS.perPrayerEnabled,
      advanceMinutes: SAMPLE_PREFS.advanceMinutes,
    });

    expect(res.ok).toBe(false);
    expect(res.failedStage).toBe('PushManager Support');
    expect(res.error).toMatch(/Add to Home Screen/i);
  });

  it('reports PushSubscription creation failure cleanly when pushManager.subscribe throws', async () => {
    const { publicKey } = generateVAPIDKeys();
    const swReg = {
      scope: '/',
      active: { state: 'activated', scriptURL: 'https://adhan-khaki.vercel.app/sw.js' },
      pushManager: {
        getSubscription: vi.fn(async () => null),
        subscribe: vi.fn(async () => {
          throw new Error('APNs registration rejected by WebKit');
        }),
      },
    };
    installWindowPolyfill({
      serviceWorkerOverride: {
        getRegistration: vi.fn(async () => swReg),
        register: vi.fn(async () => swReg),
        ready: Promise.resolve(swReg),
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ configured: true, publicKey }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    const res = await enableBackgroundPushNotifications({
      districtId: 'colombo',
      perPrayerEnabled: SAMPLE_PREFS.perPrayerEnabled,
      advanceMinutes: SAMPLE_PREFS.advanceMinutes,
    });

    expect(res.ok).toBe(false);
    expect(res.failedStage).toBe('PushSubscription Creation');
    expect(res.error).toContain('APNs registration rejected');
  });

  it('handles non-JSON 502 HTML backend registration failures cleanly without throwing SyntaxError', async () => {
    const { publicKey } = generateVAPIDKeys();
    const fakeSub = makeFakeSubscription();
    const swReg = {
      scope: '/',
      active: { state: 'activated', scriptURL: 'https://adhan-khaki.vercel.app/sw.js' },
      pushManager: {
        getSubscription: vi.fn(async () => fakeSub),
        subscribe: vi.fn(async () => fakeSub),
      },
    };
    installWindowPolyfill({
      serviceWorkerOverride: {
        getRegistration: vi.fn(async () => swReg),
        register: vi.fn(async () => swReg),
        ready: Promise.resolve(swReg),
      },
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ configured: true, publicKey }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response('<html><body>502 Bad Gateway</body></html>', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await enableBackgroundPushNotifications({
      districtId: 'colombo',
      perPrayerEnabled: SAMPLE_PREFS.perPrayerEnabled,
      advanceMinutes: SAMPLE_PREFS.advanceMinutes,
    });

    expect(res.ok).toBe(false);
    expect(res.failedStage).toBe('Backend Registration Request');
    expect(res.error).toMatch(/Non-JSON response \(HTTP 502\)/i);
  });

  it('fails verification stage if POST succeeds but backend status verification reports missing/inactive', async () => {
    const { publicKey } = generateVAPIDKeys();
    const fakeSub = makeFakeSubscription();
    const swReg = {
      scope: '/',
      active: { state: 'activated', scriptURL: 'https://adhan-khaki.vercel.app/sw.js' },
      pushManager: {
        getSubscription: vi.fn(async () => fakeSub),
        subscribe: vi.fn(async () => fakeSub),
      },
    };
    installWindowPolyfill({
      serviceWorkerOverride: {
        getRegistration: vi.fn(async () => swReg),
        register: vi.fn(async () => swReg),
        ready: Promise.resolve(swReg),
      },
    });

    const summary = {
      subscriptionId: 'sub_12345678',
      deviceId: 'dev_12345678',
      status: 'active',
      districtId: 'colombo',
      zoneId: 1,
      zoneName: 'Zone 01',
      timezone: 'Asia/Colombo',
      perPrayerEnabled: SAMPLE_PREFS.perPrayerEnabled,
      advanceMinutes: SAMPLE_PREFS.advanceMinutes,
      endpointPreview: 'https://web.push.apple.com/[redacted]',
      lastRegisteredAt: '2026-11-27T10:00:00.000Z',
      lastVerifiedAt: '2026-11-27T10:00:00.000Z',
      lastDeliveryAttemptAt: null,
      lastDeliverySuccessAt: null,
      lastDeliveryError: null,
      lastClickVerifiedAt: null,
      failureCount: 0,
      nextScheduledPrayer: null,
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ configured: true, publicKey }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, subscription: summary }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ exists: false, subscription: null }), { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);

    const res = await enableBackgroundPushNotifications({
      districtId: 'colombo',
      perPrayerEnabled: SAMPLE_PREFS.perPrayerEnabled,
      advanceMinutes: SAMPLE_PREFS.advanceMinutes,
    });

    expect(res.ok).toBe(false);
    expect(res.failedStage).toBe('Backend Registration Verification');
    expect(res.error).toMatch(/verification failed/i);
  });

  it('rotates mismatched VAPID browser subscriptions, deduplicates concurrent calls, and succeeds after backend verification', async () => {
    const { publicKey } = generateVAPIDKeys();
    const { publicKey: oldKey } = generateVAPIDKeys();
    const oldBytes = Buffer.from(oldKey, 'base64url');
    const oldSub = makeFakeSubscription('https://web.push.apple.com/OldSecretPath', oldBytes);
    const newSub = makeFakeSubscription('https://web.push.apple.com/NewSecretPath');

    let currentSub: ReturnType<typeof makeFakeSubscription> | null = oldSub;
    oldSub.unsubscribe = vi.fn(async () => {
      currentSub = null;
      return true;
    });

    const swReg = {
      scope: '/',
      active: { state: 'activated', scriptURL: 'https://adhan-khaki.vercel.app/sw.js' },
      pushManager: {
        getSubscription: vi.fn(async () => currentSub),
        subscribe: vi.fn(async () => {
          currentSub = newSub;
          return newSub;
        }),
      },
    };

    installWindowPolyfill({
      serviceWorkerOverride: {
        getRegistration: vi.fn(async () => swReg),
        register: vi.fn(async () => swReg),
        ready: Promise.resolve(swReg),
      },
    });

    const activeSummary = {
      subscriptionId: 'sub_verified_99',
      deviceId: 'dev_verified_99',
      status: 'active' as const,
      districtId: 'colombo',
      zoneId: 1,
      zoneName: 'Zone 01',
      timezone: 'Asia/Colombo',
      perPrayerEnabled: SAMPLE_PREFS.perPrayerEnabled,
      advanceMinutes: SAMPLE_PREFS.advanceMinutes,
      endpointPreview: 'https://web.push.apple.com/[redacted]',
      lastRegisteredAt: '2026-11-27T10:00:00.000Z',
      lastVerifiedAt: '2026-11-27T10:00:01.000Z',
      lastDeliveryAttemptAt: null,
      lastDeliverySuccessAt: null,
      lastDeliveryError: null,
      lastClickVerifiedAt: null,
      failureCount: 0,
      nextScheduledPrayer: null,
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ configured: true, publicKey }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, subscription: activeSummary }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ exists: true, subscription: activeSummary }), { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);

    const p1 = enableBackgroundPushNotifications({
      districtId: 'colombo',
      perPrayerEnabled: SAMPLE_PREFS.perPrayerEnabled,
      advanceMinutes: SAMPLE_PREFS.advanceMinutes,
    });
    const p2 = enableBackgroundPushNotifications({
      districtId: 'colombo',
      perPrayerEnabled: SAMPLE_PREFS.perPrayerEnabled,
      advanceMinutes: SAMPLE_PREFS.advanceMinutes,
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(r1.ok).toBe(true);
    expect(r1.subscription?.status).toBe('active');
    expect(oldSub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(swReg.pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('catches unexpected exceptions safely and redacts tokens/endpoints from client event logs', async () => {
    installWindowPolyfill({
      serviceWorkerOverride: {
        getRegistration: vi.fn(async () => {
          throw new Error('Unexpected IndexedDB disk lock');
        }),
        register: vi.fn(async () => {
          throw new Error('Unexpected IndexedDB disk lock');
        }),
      },
    });

    const res = await enableBackgroundPushNotifications({
      districtId: 'colombo',
      perPrayerEnabled: SAMPLE_PREFS.perPrayerEnabled,
      advanceMinutes: SAMPLE_PREFS.advanceMinutes,
    });

    expect(res.ok).toBe(false);
    expect(res.failedStage).toBe('Service Worker Activation');

    appendPushClientEvent({
      level: 'error',
      stage: 'security_check',
      message:
        'Endpoint https://web.push.apple.com/SuperSecretEndpointToken1234567890 failed with token abcdef1234567890abcdef1234567890',
    });

    const logs = getPushClientEvents();
    const combined = JSON.stringify(logs);
    expect(combined).not.toContain('SuperSecretEndpointToken1234567890');
    expect(combined).not.toContain('abcdef1234567890abcdef1234567890');
    expect(combined).toContain('https://web.push.apple.com/[redacted-path]');
  });

  it('handles diagnostics backend partial/HTTP error cleanly and renders all 21 checks + fallback UI immediately', async () => {
    installWindowPolyfill();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Database unavailable' }), { status: 503 }))
    );

    const diagRes = await fetchPushDiagnosticsDetailed();
    expect(diagRes.ok).toBe(false);
    if (!diagRes.ok) {
      expect(diagRes.httpStatus).toBe(503);
      expect(diagRes.error).toContain('Database unavailable');
    }

    const initialChecks = buildInitialDiagnosticChecks(inspectPushEnvironment());
    expect(initialChecks).toHaveLength(21);

    const district = ACJU_DISTRICTS[0];
    const zone = ACJU_ZONES[0];

    const diagHtml = renderToStaticMarkup(
      React.createElement(PushDiagnosticsView, {
        selectedDistrict: district,
        selectedZone: zone,
        preferences: SAMPLE_PREFS,
        onBack: () => {},
        onPushStatusUpdated: () => {},
      })
    );

    expect(diagHtml).toContain('Web Push &amp; iOS Lock Screen Diagnostics');
    expect(diagHtml).toContain('Run Diagnostics Again');
    expect(diagHtml).toContain('System Verification Checks (21)');
    expect(diagHtml).toContain('Technical Event Log');
    expect(diagHtml).toContain('14. Supabase Edge Function Response');
    expect(diagHtml).toContain('21. Last Notification Click Verification');

    const audioHtml = renderToStaticMarkup(
      React.createElement(AudioRemindersView, {
        serverTracks: [],
        preferences: SAMPLE_PREFS,
        capabilities: {
          adapterName: 'TestAdapter',
          supportsBackgroundClosedApp: true,
          supportsFullAdhanWhenClosed: false,
          requiresUserInteractionForAudio: true,
          permissionState: 'granted',
          isStandalonePwa: true,
          isIOS: true,
          notes: 'iOS Home Screen PWA test capability',
        },
        scheduledSummaries: [],
        hasVerifiedToday: true,
        selectedDistrict: district,
        selectedZone: zone,
        backendPushSubscription: null,
        pushBusy: false,
        pushFeedback: {
          tone: 'error',
          stage: 'Backend Registration Request',
          message: 'HTTP 502 Bad Gateway',
          technicalDetail: 'Non-JSON response (HTTP 502)',
        },
        onUpdatePreferences: () => {},
        onEnableBackgroundPush: async () => {},
        onDisableBackgroundPush: async () => {},
        onSendBackgroundTestPush: async () => {},
        onOpenDiagnostics: () => {},
      })
    );

    expect(audioHtml).toContain('Failed at stage:');
    expect(audioHtml).toContain('Backend Registration Request');
    expect(audioHtml).toContain('Open Push Diagnostics');

    const ebHtml = renderToStaticMarkup(
      React.createElement(ErrorBoundary, {
        onResetToHome: () => {},
        children: React.createElement('div', null, 'Diagnostics Safe Child'),
      })
    );
    expect(ebHtml).toContain('Diagnostics Safe Child');
  });

  it('schedules and cancels background test pushes cleanly via fetch mock', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('schedule-test-push')) {
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body || '{}'));
          if (body.action === 'cancel') {
            return new Response(JSON.stringify({ ok: true, cancelledCount: 1 }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(
            JSON.stringify({
              ok: true,
              job: {
                id: 'job-123',
                deviceUuid: 'dev-uuid',
                status: 'pending',
                scheduledAt: new Date(Date.now() + 120_000).toISOString(),
                createdAt: new Date().toISOString(),
              },
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } }
          );
        }
        // GET status
        return new Response(
          JSON.stringify({
            ok: true,
            job: {
              id: 'job-123',
              deviceUuid: 'dev-uuid',
              status: 'pending',
              scheduledAt: new Date(Date.now() + 120_000).toISOString(),
              createdAt: new Date().toISOString(),
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);

    const schedRes = await scheduleBackgroundTestPush({ delayMinutes: 2 });
    expect(schedRes.ok).toBe(true);
    expect(schedRes.job?.id).toBe('job-123');
    expect(schedRes.job?.status).toBe('pending');

    const statusRes = await fetchBackgroundTestJobStatus();
    expect(statusRes.ok).toBe(true);
    expect(statusRes.job?.id).toBe('job-123');

    const cancelRes = await cancelBackgroundTestPush();
    expect(cancelRes.ok).toBe(true);
    expect(cancelRes.cancelledCount).toBe(1);
  });
});
