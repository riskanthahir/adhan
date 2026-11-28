import { timingSafeEqual } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import {
  appendServerLog,
  cancelPendingTestPushJobs,
  createTestPushJob,
  getAppliedMigrations,
  getDatabasePath,
  getDatabaseStats,
  getLatestTestPushJob,
  getSubscriptionByDeviceId,
  listDeliveriesForDevice,
  listServerLogsForDevice,
  markSubscriptionStatus,
  markSubscriptionVerifiedAt,
  recordSubscriptionDeliveryFailure,
  recordSubscriptionDeliverySuccess,
  updateLastClickVerified,
  updateSubscriptionPreferences,
  upsertDeliveryAttempt,
  upsertPushSubscription,
  verifyDeviceOwnership,
} from './db.ts';
import {
  getNextScheduledPrayerForSubscription,
  getSchedulerStatus,
  runSchedulerTick,
  sendEncryptedWebPush,
} from './scheduler.ts';
import { getPublicVapidConfig } from './vapid.ts';
import { ACJU_DISTRICTS } from '../src/shared/acjuSeed.ts';
import { getColomboNowParts } from '../src/shared/timetablePolicy.ts';
import {
  PRAYER_NAMES,
  type AdvanceMinutesOption,
  type PrayerName,
} from '../src/shared/types.ts';

const VALID_ADVANCE_MINUTES = new Set<number>([0, 5, 10, 15, 30]);

function isValidDeviceId(val: unknown): val is string {
  return typeof val === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(val);
}

function isValidDeviceToken(val: unknown): val is string {
  return typeof val === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(val);
}

function validatePushEndpoint(endpoint: unknown): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof endpoint !== 'string' || endpoint.length < 16 || endpoint.length > 2048) {
    return { ok: false, error: 'Push subscription endpoint must be a valid HTTPS URL.' };
  }
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return { ok: false, error: 'Invalid push endpoint URL syntax.' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Push subscription endpoint must use HTTPS.' };
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host === '169.254.169.254' ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return { ok: false, error: 'Push subscription endpoint host is not allowed.' };
  }
  return { ok: true, url: parsed.toString() };
}

function isValidBase64Key(val: unknown, minLen = 12, maxLen = 256): val is string {
  return typeof val === 'string' && val.length >= minLen && val.length <= maxLen && /^[A-Za-z0-9+/_=-]+$/.test(val);
}

function sanitizePerPrayerEnabled(raw: unknown): Record<PrayerName, boolean> {
  const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    fajr: typeof obj.fajr === 'boolean' ? obj.fajr : true,
    dhuhr: typeof obj.dhuhr === 'boolean' ? obj.dhuhr : true,
    asr: typeof obj.asr === 'boolean' ? obj.asr : true,
    maghrib: typeof obj.maghrib === 'boolean' ? obj.maghrib : true,
    isha: typeof obj.isha === 'boolean' ? obj.isha : true,
  };
}

function sanitizeAdvanceMinutes(raw: unknown): Record<PrayerName, AdvanceMinutesOption> {
  const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const result = {} as Record<PrayerName, AdvanceMinutesOption>;
  for (const prayer of PRAYER_NAMES) {
    const val = Number(obj[prayer]);
    result[prayer] = (VALID_ADVANCE_MINUTES.has(val) ? val : 0) as AdvanceMinutesOption;
  }
  return result;
}

function resolveDistrictAndZone(districtId: unknown): { districtId: string; zoneId: number } {
  if (typeof districtId === 'string') {
    const found = ACJU_DISTRICTS.find((d) => d.id === districtId);
    if (found) {
      return { districtId: found.id, zoneId: found.zoneId };
    }
  }
  return { districtId: 'colombo', zoneId: 1 };
}

function extractDeviceToken(req: Request): string | undefined {
  const headerToken = req.header('x-device-token');
  if (headerToken) return headerToken;
  if (typeof req.body === 'object' && req.body !== null && typeof req.body.deviceToken === 'string') {
    return req.body.deviceToken;
  }
  return undefined;
}

function serializeSubscriptionSummary(sub: ReturnType<typeof getSubscriptionByDeviceId>) {
  if (!sub) return null;
  const nextInfo = getNextScheduledPrayerForSubscription(sub);
  return {
    subscriptionId: sub.id,
    deviceId: sub.deviceId,
    status: sub.status,
    districtId: sub.districtId,
    zoneId: sub.zoneId,
    zoneName: nextInfo.zoneName,
    timezone: sub.timezone,
    perPrayerEnabled: sub.perPrayerEnabled,
    advanceMinutes: sub.advanceMinutes,
    endpointPreview: sub.endpoint.slice(0, 64) + (sub.endpoint.length > 64 ? '…' : ''),
    lastRegisteredAt: sub.lastRegisteredAt,
    lastVerifiedAt: sub.lastVerifiedAt,
    lastDeliveryAttemptAt: sub.lastDeliveryAttemptAt,
    lastDeliverySuccessAt: sub.lastDeliverySuccessAt,
    lastDeliveryError: sub.lastDeliveryError,
    lastClickVerifiedAt: sub.lastClickVerifiedAt,
    failureCount: sub.failureCount,
    nextScheduledPrayer: nextInfo.nextPrayer,
    latestTestJob: getLatestTestPushJob(sub.deviceId),
  };
}

export function createPushRouter(): express.Router {
  const router = express.Router();
  router.use(express.json({ limit: '32kb' }));

  router.get('/health', (_req: Request, res: Response) => {
    const vapid = getPublicVapidConfig();
    const colombo = getColomboNowParts();
    res.json({
      ok: true,
      service: 'my-adhan-web-push',
      colomboDate: colombo.dateISO,
      colomboTime: colombo.formattedTime,
      vapidConfigured: vapid.configured,
      vapidStatus: vapid.status,
      vapidError: vapid.errorMessage,
      vapidConfiguredViaEnv: vapid.configuredViaEnv,
      scheduler: getSchedulerStatus(),
      stats: getDatabaseStats(),
    });
  });

  router.get('/push/vapid-public-key', (_req: Request, res: Response) => {
    const vapid = getPublicVapidConfig();
    if (!vapid.configured || !vapid.publicKey) {
      res.status(503).json({
        configured: false,
        status: vapid.status,
        publicKey: null,
        subject: vapid.subject,
        configuredViaEnv: false,
        error: vapid.errorMessage,
        setupInstructions: vapid.setupInstructions,
      });
      return;
    }

    res.json({
      configured: true,
      status: vapid.status,
      publicKey: vapid.publicKey,
      subject: vapid.subject,
      configuredViaEnv: vapid.configuredViaEnv,
    });
  });

  router.post('/push/subscribe', (req: Request, res: Response) => {
    const vapid = getPublicVapidConfig();
    if (!vapid.configured) {
      res.status(503).json({
        ok: false,
        status: vapid.status,
        error: vapid.errorMessage ?? 'VAPID keys are not configured on the backend server.',
        setupInstructions: vapid.setupInstructions,
      });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const deviceId = body.deviceId;
    const deviceToken = extractDeviceToken(req);
    const subObj = body.subscription as Record<string, unknown> | undefined;
    const keysObj = subObj?.keys as Record<string, unknown> | undefined;

    if (!isValidDeviceId(deviceId) || !isValidDeviceToken(deviceToken)) {
      res.status(400).json({ error: 'Invalid deviceId or deviceToken.' });
      return;
    }

    const endpointCheck = validatePushEndpoint(subObj?.endpoint);
    if (!endpointCheck.ok) {
      res.status(400).json({ error: endpointCheck.error });
      return;
    }

    if (!isValidBase64Key(keysObj?.p256dh, 20) || !isValidBase64Key(keysObj?.auth, 12)) {
      res.status(400).json({ error: 'Invalid Web Push encryption keys (p256dh / auth).' });
      return;
    }

    // If updating an existing device record, verify existing token OR allow initial registration
    const existing = getSubscriptionByDeviceId(deviceId);
    if (existing && !verifyDeviceOwnership(existing, deviceToken)) {
      res.status(403).json({ error: 'Device ownership verification failed for this deviceId.' });
      return;
    }

    const { districtId, zoneId } = resolveDistrictAndZone(body.districtId);
    const perPrayerEnabled = sanitizePerPrayerEnabled(body.perPrayerEnabled);
    const advanceMinutes = sanitizeAdvanceMinutes(body.advanceMinutes);
    const userAgent = typeof req.header('user-agent') === 'string' ? req.header('user-agent')!.slice(0, 250) : null;

    const saved = upsertPushSubscription({
      deviceId,
      deviceToken,
      endpoint: endpointCheck.url,
      p256dhKey: keysObj.p256dh,
      authKey: keysObj.auth,
      districtId,
      zoneId,
      timezone: 'Asia/Colombo',
      perPrayerEnabled,
      advanceMinutes,
      userAgent,
    });

    appendServerLog({
      level: 'info',
      category: 'subscription_registered',
      deviceId: saved.deviceId,
      message: `Saved push subscription for ${saved.districtId} (Group ${saved.zoneId})`,
      meta: { endpointHost: new URL(saved.endpoint).hostname },
    });

    res.json({
      ok: true,
      verified: true,
      subscription: serializeSubscriptionSummary(saved),
    });
  });

  router.patch('/push/preferences', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const deviceId = body.deviceId;
    const deviceToken = extractDeviceToken(req);

    if (!isValidDeviceId(deviceId) || !isValidDeviceToken(deviceToken)) {
      res.status(400).json({ error: 'Invalid deviceId or deviceToken.' });
      return;
    }

    const existing = getSubscriptionByDeviceId(deviceId);
    if (!existing) {
      res.status(404).json({ error: 'No push subscription registered for this device.' });
      return;
    }
    if (!verifyDeviceOwnership(existing, deviceToken)) {
      res.status(403).json({ error: 'Unauthorized device token.' });
      return;
    }

    const { districtId, zoneId } = resolveDistrictAndZone(body.districtId ?? existing.districtId);
    const perPrayerEnabled =
      body.perPrayerEnabled !== undefined
        ? sanitizePerPrayerEnabled(body.perPrayerEnabled)
        : existing.perPrayerEnabled;
    const advanceMinutes =
      body.advanceMinutes !== undefined
        ? sanitizeAdvanceMinutes(body.advanceMinutes)
        : existing.advanceMinutes;

    const updated = updateSubscriptionPreferences({
      deviceId,
      districtId,
      zoneId,
      perPrayerEnabled,
      advanceMinutes,
    });

    appendServerLog({
      level: 'info',
      category: 'preferences_updated',
      deviceId,
      message: `Synced district=${districtId} (Group ${zoneId}) and prayer preferences`,
    });

    res.json({
      ok: true,
      subscription: serializeSubscriptionSummary(updated),
    });
  });

  router.post('/push/unsubscribe', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const deviceId = body.deviceId;
    const deviceToken = extractDeviceToken(req);

    if (!isValidDeviceId(deviceId) || !isValidDeviceToken(deviceToken)) {
      res.status(400).json({ error: 'Invalid deviceId or deviceToken.' });
      return;
    }

    const existing = getSubscriptionByDeviceId(deviceId);
    if (!existing) {
      res.json({ ok: true, status: 'disabled' });
      return;
    }
    if (!verifyDeviceOwnership(existing, deviceToken)) {
      res.status(403).json({ error: 'Unauthorized device token.' });
      return;
    }

    markSubscriptionStatus(deviceId, 'disabled');
    appendServerLog({
      level: 'info',
      category: 'subscription_disabled',
      deviceId,
      message: 'User disabled background push notifications on this device.',
    });

    const updated = getSubscriptionByDeviceId(deviceId);
    res.json({
      ok: true,
      subscription: serializeSubscriptionSummary(updated),
    });
  });

  router.get('/push/status', (req: Request, res: Response) => {
    const deviceId = req.query.deviceId;
    const deviceToken = extractDeviceToken(req);

    if (!isValidDeviceId(deviceId)) {
      res.status(400).json({ error: 'Missing or invalid deviceId query parameter.' });
      return;
    }

    const existing = getSubscriptionByDeviceId(deviceId);
    if (!existing) {
      res.json({ exists: false, subscription: null });
      return;
    }
    if (!verifyDeviceOwnership(existing, deviceToken)) {
      res.status(403).json({ error: 'Unauthorized device token.' });
      return;
    }

    markSubscriptionVerifiedAt(deviceId);
    const refreshed = getSubscriptionByDeviceId(deviceId);
    res.json({
      exists: true,
      subscription: serializeSubscriptionSummary(refreshed),
      recentDeliveries: listDeliveriesForDevice(deviceId, 10),
    });
  });

  router.post('/push/test', async (req: Request, res: Response) => {
    const vapid = getPublicVapidConfig();
    if (!vapid.configured) {
      res.status(503).json({
        ok: false,
        status: vapid.status,
        error: vapid.errorMessage ?? 'VAPID keys are not configured on the backend server.',
        setupInstructions: vapid.setupInstructions,
      });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const deviceId = body.deviceId;
    const deviceToken = extractDeviceToken(req);

    if (!isValidDeviceId(deviceId) || !isValidDeviceToken(deviceToken)) {
      res.status(400).json({ error: 'Invalid deviceId or deviceToken.' });
      return;
    }

    const sub = getSubscriptionByDeviceId(deviceId);
    if (!sub) {
      res.status(404).json({ error: 'No backend push subscription found. Enable Prayer Notifications first.' });
      return;
    }
    if (!verifyDeviceOwnership(sub, deviceToken)) {
      res.status(403).json({ error: 'Unauthorized device token.' });
      return;
    }
    if (sub.status !== 'active') {
      res.status(409).json({ error: `Subscription status is "${sub.status}". Re-enable notifications to renew.` });
      return;
    }

    const nextInfo = getNextScheduledPrayerForSubscription(sub);
    const colombo = getColomboNowParts();
    const eventKey = `${deviceId}::test::${Date.now()}`;
    const nextLabel = nextInfo.nextPrayer
      ? `Next prayer: ${nextInfo.nextPrayer.label} at ${nextInfo.nextPrayer.timeHHMM}`
      : 'ACJU timetable active';

    const result = await sendEncryptedWebPush({
      subscription: sub,
      payload: {
        title: `My Adhan · Background Push Active`,
        body: `${nextInfo.districtName} (${nextInfo.zoneName}) — ${nextLabel}`,
        prayer: 'test',
        prayerTimeHHMM: colombo.formattedTime.slice(0, 5),
        dateISO: colombo.dateISO,
        zoneId: nextInfo.zoneId,
        zoneName: nextInfo.zoneName,
        eventKey,
        url: `/?fromPush=1&prayer=test&eventKey=${encodeURIComponent(eventKey)}`,
        sentAt: new Date().toISOString(),
        isTest: true,
      },
      ttlSeconds: 120,
    });

    upsertDeliveryAttempt({
      eventKey,
      subscriptionId: sub.id,
      deviceId: sub.deviceId,
      dateISO: colombo.dateISO,
      prayer: 'test',
      prayerTimeHHMM: colombo.formattedTime.slice(0, 5),
      advanceMinutes: 0,
      scheduledForEpochMs: Date.now(),
      status: result.ok ? 'sent' : result.expired ? 'expired' : 'failed',
      httpStatus: result.statusCode,
      errorMessage: result.error,
    });

    if (result.ok) {
      recordSubscriptionDeliverySuccess(sub.deviceId);
      appendServerLog({
        level: 'info',
        category: 'test_push',
        deviceId: sub.deviceId,
        message: 'Test Web Push accepted by push service.',
        meta: { statusCode: result.statusCode, eventKey },
      });
      res.json({
        ok: true,
        statusCode: result.statusCode,
        eventKey,
        testedAt: new Date().toISOString(),
        subscription: serializeSubscriptionSummary(getSubscriptionByDeviceId(deviceId)),
      });
    } else {
      recordSubscriptionDeliveryFailure(
        sub.deviceId,
        result.error ?? 'Push delivery failed',
        result.expired
      );
      appendServerLog({
        level: result.expired ? 'warn' : 'error',
        category: 'test_push',
        deviceId: sub.deviceId,
        message: `Test push failed: ${result.error ?? 'unknown error'}`,
        meta: { statusCode: result.statusCode, expired: result.expired },
      });
      res.status(result.expired ? 410 : 502).json({
        ok: false,
        statusCode: result.statusCode,
        expired: result.expired,
        error: result.error ?? 'Failed to deliver test notification.',
        subscription: serializeSubscriptionSummary(getSubscriptionByDeviceId(deviceId)),
      });
    }
  });

  // Diagnostic endpoint to verify 410/expired subscription cleanup path end-to-end safely
  router.post('/push/test-expired-cleanup', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const deviceId = body.deviceId;
    const deviceToken = extractDeviceToken(req);

    if (!isValidDeviceId(deviceId) || !isValidDeviceToken(deviceToken)) {
      res.status(400).json({ error: 'Invalid deviceId or deviceToken.' });
      return;
    }

    const sub = getSubscriptionByDeviceId(deviceId);
    if (!sub) {
      res.status(404).json({ error: 'No subscription found for device.' });
      return;
    }
    if (!verifyDeviceOwnership(sub, deviceToken)) {
      res.status(403).json({ error: 'Unauthorized device token.' });
      return;
    }

    recordSubscriptionDeliveryFailure(
      deviceId,
      'Simulated 410 Gone expiration check — subscription flagged for renewal.',
      true
    );
    appendServerLog({
      level: 'warn',
      category: 'diagnostic_expiration_test',
      deviceId,
      message: 'Verified expired (410) cleanup transition on device subscription.',
    });

    res.json({
      ok: true,
      subscription: serializeSubscriptionSummary(getSubscriptionByDeviceId(deviceId)),
    });
  });

  router.get('/push/schedule-test-push', (req: Request, res: Response) => {
    const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;
    const deviceToken = extractDeviceToken(req);

    if (!isValidDeviceId(deviceId) || !isValidDeviceToken(deviceToken)) {
      res.status(400).json({ error: 'Invalid deviceId or deviceToken.' });
      return;
    }

    const sub = getSubscriptionByDeviceId(deviceId);
    if (!sub || !verifyDeviceOwnership(sub, deviceToken)) {
      res.status(403).json({ error: 'Unauthorized device token.' });
      return;
    }

    const job = getLatestTestPushJob(deviceId);
    res.json({ ok: true, job });
  });

  router.post('/push/schedule-test-push', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const deviceId = body.deviceId;
    const deviceToken = extractDeviceToken(req);

    if (!isValidDeviceId(deviceId) || !isValidDeviceToken(deviceToken)) {
      res.status(400).json({ error: 'Invalid deviceId or deviceToken.' });
      return;
    }

    const sub = getSubscriptionByDeviceId(deviceId);
    if (!sub || !verifyDeviceOwnership(sub, deviceToken)) {
      res.status(403).json({ error: 'Unauthorized device token.' });
      return;
    }

    if (body.action === 'cancel') {
      const cancelledCount = cancelPendingTestPushJobs(deviceId);
      res.json({ ok: true, cancelled: cancelledCount > 0 });
      return;
    }

    if (sub.status !== 'active') {
      res.status(409).json({ error: 'Active push subscription required to schedule test.' });
      return;
    }

    let delayMinutes = 2;
    if (typeof body.delayMinutes === 'number' && Number.isFinite(body.delayMinutes)) {
      delayMinutes = Math.min(15, Math.max(1, Math.round(body.delayMinutes)));
    }
    const scheduledForEpochMs = Date.now() + delayMinutes * 60_000;
    const scheduledAt = new Date(scheduledForEpochMs).toISOString();

    const job = createTestPushJob({
      deviceId,
      scheduledAt,
      scheduledForEpochMs,
    });

    res.json({
      ok: true,
      job: {
        id: job.id,
        deviceId: job.deviceId,
        scheduledAt: job.scheduledAt,
        status: job.status,
        delayMinutes,
        createdAt: job.createdAt,
      },
    });
  });

  router.post('/push/verify-click', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const deviceId = body.deviceId;
    const deviceToken = extractDeviceToken(req);

    if (!isValidDeviceId(deviceId) || !isValidDeviceToken(deviceToken)) {
      res.status(400).json({ error: 'Invalid deviceId or deviceToken.' });
      return;
    }

    const sub = getSubscriptionByDeviceId(deviceId);
    if (!sub || !verifyDeviceOwnership(sub, deviceToken)) {
      res.status(403).json({ error: 'Unauthorized device token.' });
      return;
    }

    updateLastClickVerified(deviceId);
    appendServerLog({
      level: 'info',
      category: 'notification_click_verified',
      deviceId,
      message: `Notification click verified in app (${typeof body.eventKey === 'string' ? body.eventKey : 'unknown'})`,
    });

    res.json({
      ok: true,
      lastClickVerifiedAt: getSubscriptionByDeviceId(deviceId)?.lastClickVerifiedAt ?? null,
    });
  });

  router.post('/push/cron', async (req: Request, res: Response) => {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret) {
      res.status(403).json({
        error: 'CRON_SECRET is not configured. The built-in server scheduler runs automatically every 15s.',
      });
      return;
    }
    const authHeader = req.header('authorization') ?? '';
    const expected = `Bearer ${secret}`;
    const a = Buffer.from(authHeader);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(401).json({ error: 'Unauthorized cron trigger.' });
      return;
    }

    const summary = await runSchedulerTick();
    res.json({ ok: true, summary, ranAt: new Date().toISOString() });
  });

  router.get('/push/diagnostics', (req: Request, res: Response) => {
    const deviceId = req.query.deviceId;
    const deviceToken = extractDeviceToken(req);

    const vapid = getPublicVapidConfig();
    const colombo = getColomboNowParts();

    let subscriptionSummary: ReturnType<typeof serializeSubscriptionSummary> = null;
    let recentDeliveries: ReturnType<typeof listDeliveriesForDevice> = [];
    let recentLogs: ReturnType<typeof listServerLogsForDevice> = [];

    if (isValidDeviceId(deviceId)) {
      const existing = getSubscriptionByDeviceId(deviceId);
      if (existing) {
        if (!verifyDeviceOwnership(existing, deviceToken)) {
          res.status(403).json({ error: 'Unauthorized device token.' });
          return;
        }
        subscriptionSummary = serializeSubscriptionSummary(existing);
        recentDeliveries = listDeliveriesForDevice(deviceId, 15);
        recentLogs = listServerLogsForDevice(deviceId, 20);
      }
    }

    res.json({
      ok: true,
      colomboDate: colombo.dateISO,
      colomboTime: colombo.formattedTime,
      databasePath: getDatabasePath(),
      migrations: getAppliedMigrations(),
      stats: getDatabaseStats(),
      scheduler: getSchedulerStatus(),
      vapid: {
        configured: vapid.configured,
        status: vapid.status,
        publicKeyPreview: vapid.publicKey ? `${vapid.publicKey.slice(0, 16)}…` : null,
        configuredViaEnv: vapid.configuredViaEnv,
        subject: vapid.subject,
        errorMessage: vapid.errorMessage,
        setupInstructions: vapid.setupInstructions,
      },
      subscription: subscriptionSummary,
      recentDeliveries,
      recentLogs,
    });
  });

  router.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  return router;
}
