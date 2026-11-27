import express from 'express';
import http from 'node:http';
import { generateVAPIDKeys } from 'web-push';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAppliedMigrations,
  getDeliveryByEventKey,
  getSubscriptionByDeviceId,
  initDatabase,
  resetDatabaseForTesting,
  upsertPushSubscription,
  verifyDeviceOwnership,
} from '../db.ts';
import { createPushRouter } from '../pushRoutes.ts';
import {
  getNextScheduledPrayerForSubscription,
  pushTransport,
  runSchedulerTick,
} from '../scheduler.ts';
import {
  ensureVapidConfigured,
  getPublicVapidConfig,
  resetVapidCacheForTesting,
  validateVapidKeyPair,
} from '../vapid.ts';
import { resolveEmbeddedDaySchedule } from '../../src/shared/acju2026Timetable.ts';
import { colomboDateTimeToEpochMs } from '../../src/shared/timetablePolicy.ts';

async function startTestAppServer() {
  const app = express();
  app.use('/api', createPushRouter());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe('My Adhan Web Push Backend, VAPID Validation, Scheduler & ACJU Integration', () => {
  let testKeys: { publicKey: string; privateKey: string };

  beforeEach(() => {
    process.env.DATABASE_PATH = ':memory:';
    testKeys = generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = testKeys.publicKey;
    process.env.VAPID_PRIVATE_KEY = testKeys.privateKey;
    process.env.VAPID_SUBJECT = 'mailto:notifications@myadhan.lk';
    delete process.env.CRON_SECRET;
    resetDatabaseForTesting();
    resetVapidCacheForTesting();
    initDatabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetDatabaseForTesting();
    resetVapidCacheForTesting();
  });

  it('requires backend env VAPID keys, validates public/private key-pair match, never exposes private key, and returns setup instructions when missing', async () => {
    const migrations = getAppliedMigrations();
    expect(migrations.map((m) => m.version)).toContain('001_initial_push_schema.sql');

    // Valid matched pair succeeds without leaking private key
    const validCfg = ensureVapidConfigured();
    expect(validCfg.configured).toBe(true);
    expect(validCfg.status).toBe('configured');
    expect(validCfg.publicKey).toBe(testKeys.publicKey);
    expect((validCfg as unknown as Record<string, unknown>).privateKey).toBeUndefined();

    // Public API view omits private key
    const pub = getPublicVapidConfig() as unknown as Record<string, unknown>;
    expect(pub.publicKey).toBe(testKeys.publicKey);
    expect(pub.privateKey).toBeUndefined();

    // Mismatched public/private keys fail cryptographic EC P-256 check
    const otherPair = generateVAPIDKeys();
    const mismatch = validateVapidKeyPair(
      testKeys.publicKey,
      otherPair.privateKey,
      'mailto:notifications@myadhan.lk'
    );
    expect(mismatch.valid).toBe(false);
    expect(mismatch.status).toBe('mismatched_keys');

    // Invalid subject rejected cleanly
    const badSubject = validateVapidKeyPair(
      testKeys.publicKey,
      testKeys.privateKey,
      'not-a-valid-subject'
    );
    expect(badSubject.valid).toBe(false);
    expect(badSubject.status).toBe('invalid_subject');

    // Missing keys NEVER silently auto-generate; return clear setup instructions over HTTP 503
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    resetVapidCacheForTesting();

    const missingCfg = ensureVapidConfigured();
    expect(missingCfg.configured).toBe(false);
    expect(missingCfg.status).toBe('missing_keys');
    expect(missingCfg.publicKey).toBeNull();
    expect(missingCfg.setupInstructions.length).toBeGreaterThan(0);

    const srv = await startTestAppServer();
    try {
      const keyRes = await fetch(`${srv.baseUrl}/api/push/vapid-public-key`);
      expect(keyRes.status).toBe(503);
      const keyJson = (await keyRes.json()) as {
        configured: boolean;
        status: string;
        publicKey: string | null;
        setupInstructions: string[];
      };
      expect(keyJson.configured).toBe(false);
      expect(keyJson.status).toBe('missing_keys');
      expect(keyJson.publicKey).toBeNull();
      expect(keyJson.setupInstructions.length).toBeGreaterThan(0);
    } finally {
      await srv.close();
    }
  });

  it('persists subscriptions with SHA-256 device token auth and enforces endpoint/SSRF & ownership rules', async () => {
    const srv = await startTestAppServer();
    try {
      // 1. SSRF / insecure HTTP endpoint blocked
      const badEndpointRes = await fetch(`${srv.baseUrl}/api/push/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: 'device_ios_001',
          deviceToken: 'secret_device_token_123456',
          subscription: {
            endpoint: 'http://127.0.0.1:8080/internal-hook',
            keys: {
              p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=',
              auth: 'tBHItJI5svbpez7KI4CCXg==',
            },
          },
          districtId: 'colombo',
        }),
      });
      expect(badEndpointRes.status).toBe(400);

      // 2. Valid Apple APNs web push endpoint succeeds & verifies next prayer
      const validSubRes = await fetch(`${srv.baseUrl}/api/push/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: 'device_ios_001',
          deviceToken: 'secret_device_token_123456',
          subscription: {
            endpoint: 'https://web.push.apple.com/QBqFakeEndpointTokenForUnitTest1234567890',
            keys: {
              p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=',
              auth: 'tBHItJI5svbpez7KI4CCXg==',
            },
          },
          districtId: 'kandy',
          perPrayerEnabled: {
            fajr: true,
            dhuhr: true,
            asr: true,
            maghrib: true,
            isha: true,
          },
          advanceMinutes: { fajr: 10, dhuhr: 0, asr: 5, maghrib: 0, isha: 0 },
        }),
      });
      expect(validSubRes.status).toBe(200);
      const validJson = (await validSubRes.json()) as {
        ok: boolean;
        verified: boolean;
        subscription: { districtId: string; zoneId: number; status: string };
      };
      expect(validJson.ok).toBe(true);
      expect(validJson.verified).toBe(true);
      expect(validJson.subscription.districtId).toBe('kandy');
      expect(validJson.subscription.zoneId).toBe(7);
      expect(validJson.subscription.status).toBe('active');

      // 3. Wrong device token rejected on PATCH preferences
      const unauthorizedRes = await fetch(`${srv.baseUrl}/api/push/preferences`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Token': 'wrong_token_attacker_999999',
        },
        body: JSON.stringify({
          deviceId: 'device_ios_001',
          districtId: 'jaffna',
        }),
      });
      expect(unauthorizedRes.status).toBe(403);

      // 4. Correct device token updates district + zone + advanceMinutes cleanly
      const patchRes = await fetch(`${srv.baseUrl}/api/push/preferences`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Token': 'secret_device_token_123456',
        },
        body: JSON.stringify({
          deviceId: 'device_ios_001',
          districtId: 'jaffna',
          advanceMinutes: { fajr: 5, dhuhr: 10, asr: 0, maghrib: 0, isha: 0 },
        }),
      });
      expect(patchRes.status).toBe(200);
      const patchJson = (await patchRes.json()) as {
        subscription: { districtId: string; zoneId: number; advanceMinutes: { dhuhr: number } };
      };
      expect(patchJson.subscription.districtId).toBe('jaffna');
      expect(patchJson.subscription.zoneId).toBe(2);
      expect(patchJson.subscription.advanceMinutes.dhuhr).toBe(10);

      // 5. Disable / unsubscribe sets status = 'disabled'
      const unsubRes = await fetch(`${srv.baseUrl}/api/push/unsubscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Token': 'secret_device_token_123456',
        },
        body: JSON.stringify({ deviceId: 'device_ios_001' }),
      });
      expect(unsubRes.status).toBe(200);
      expect(getSubscriptionByDeviceId('device_ios_001')?.status).toBe('disabled');
    } finally {
      await srv.close();
    }
  });

  it('resolves ACJU schedule & dispatches deduplicated encrypted pushes at prayer time and advance offsets', async () => {
    const schedule = resolveEmbeddedDaySchedule(1, '2026-06-15');
    expect(schedule.isVerified).toBe(true);
    expect(schedule.times).not.toBeNull();
    const dhuhrTime = schedule.times!.dhuhr;
    const asrTime = schedule.times!.asr;

    const sub = upsertPushSubscription({
      deviceId: 'device_scheduler_test_1',
      deviceToken: 'token_scheduler_test_12345',
      endpoint: 'https://web.push.apple.com/QBqSchedulerUnitTestEndpoint001',
      p256dhKey: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=',
      authKey: 'tBHItJI5svbpez7KI4CCXg==',
      districtId: 'colombo',
      zoneId: 1,
      timezone: 'Asia/Colombo',
      perPrayerEnabled: {
        fajr: true,
        dhuhr: true,
        asr: false, // Disabled by user
        maghrib: true,
        isha: true,
      },
      advanceMinutes: {
        fajr: 0,
        dhuhr: 10, // 10 min before Dhuhr
        asr: 0,
        maghrib: 0,
        isha: 0,
      },
      userAgent: 'Vitest-iOS-PWA',
    });

    expect(verifyDeviceOwnership(sub, 'token_scheduler_test_12345')).toBe(true);

    const futureNext = getNextScheduledPrayerForSubscription(
      sub,
      new Date(colomboDateTimeToEpochMs('2027-06-15', '04:00'))
    );
    expect(futureNext.zoneId).toBe(1);
    expect(futureNext.nextPrayer?.prayer).toBe('fajr');

    const sendSpy = vi
      .spyOn(pushTransport, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, headers: {}, body: '' });

    const dhuhrMinus10Ms = colomboDateTimeToEpochMs('2026-06-15', dhuhrTime) - 10 * 60_000 + 20_000;
    const firstTick = await runSchedulerTick(new Date(dhuhrMinus10Ms));
    expect(firstTick.sent).toBe(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const payloadRaw = sendSpy.mock.calls[0]?.[1] as string;
    const parsedPayload = JSON.parse(payloadRaw) as {
      title: string;
      prayer: string;
      advanceMinutes: number;
      eventKey: string;
    };
    expect(parsedPayload.prayer).toBe('dhuhr');
    expect(parsedPayload.advanceMinutes).toBe(10);
    expect(parsedPayload.title).toContain('Dhuhr in 10 min');

    const storedDelivery = getDeliveryByEventKey(parsedPayload.eventKey);
    expect(storedDelivery?.status).toBe('sent');

    // Second tick 15 seconds later MUST deduplicate
    const duplicateTick = await runSchedulerTick(new Date(dhuhrMinus10Ms + 15_000));
    expect(duplicateTick.attempted).toBe(0);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    // Disabled Asr prayer MUST NOT fire
    const asrMs = colomboDateTimeToEpochMs('2026-06-15', asrTime) + 15_000;
    const asrTick = await runSchedulerTick(new Date(asrMs));
    expect(asrTick.attempted).toBe(0);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('marks expired 410 Gone subscriptions cleanly and retries transient 503 failures', async () => {
    const schedule = resolveEmbeddedDaySchedule(1, '2026-06-15');
    const maghribTime = schedule.times!.maghrib;
    const ishaTime = schedule.times!.isha;

    upsertPushSubscription({
      deviceId: 'device_transient_err',
      deviceToken: 'token_transient_12345678',
      endpoint: 'https://web.push.apple.com/QBqTransientTestEndpoint',
      p256dhKey: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=',
      authKey: 'tBHItJI5svbpez7KI4CCXg==',
      districtId: 'colombo',
      zoneId: 1,
      timezone: 'Asia/Colombo',
      perPrayerEnabled: { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true },
      advanceMinutes: { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
      userAgent: null,
    });

    const sendSpy = vi
      .spyOn(pushTransport, 'sendNotification')
      .mockRejectedValueOnce({ statusCode: 503, message: 'APNs temporarily unavailable' })
      .mockRejectedValueOnce({ statusCode: 410, message: 'Gone' });

    const maghribMs = colomboDateTimeToEpochMs('2026-06-15', maghribTime) + 10_000;
    const transientTick = await runSchedulerTick(new Date(maghribMs));
    expect(transientTick.retried).toBe(1);
    expect(getSubscriptionByDeviceId('device_transient_err')?.status).toBe('active');
    expect(getSubscriptionByDeviceId('device_transient_err')?.failureCount).toBe(1);

    const ishaMs = colomboDateTimeToEpochMs('2026-06-15', ishaTime) + 10_000;
    const goneTick = await runSchedulerTick(new Date(ishaMs));
    expect(goneTick.expired).toBe(1);
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(getSubscriptionByDeviceId('device_transient_err')?.status).toBe('expired');

    const afterExpiredTick = await runSchedulerTick(new Date(ishaMs + 45_000));
    expect(afterExpiredTick.checkedSubscriptions).toBe(0);
  });
});
