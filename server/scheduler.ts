import { sendNotification } from 'web-push';
import {
  appendServerLog,
  getDeliveryByEventKey,
  listActiveSubscriptions,
  recordSubscriptionDeliveryFailure,
  recordSubscriptionDeliverySuccess,
  upsertDeliveryAttempt,
  type PushSubscriptionRow,
} from './db.ts';
import { ensureVapidConfigured } from './vapid.ts';
import { resolveEmbeddedDaySchedule } from '../src/shared/acju2026Timetable.ts';
import { ACJU_DISTRICTS, ACJU_ZONES } from '../src/shared/acjuSeed.ts';
import {
  colomboDateTimeToEpochMs,
  computeNextPrayer,
  formatTime12h,
  getColomboNowParts,
} from '../src/shared/timetablePolicy.ts';
import {
  PRAYER_LABELS,
  PRAYER_NAMES,
  type AdvanceMinutesOption,
  type PrayerName,
} from '../src/shared/types.ts';

const SCHEDULER_INTERVAL_MS = 15_000;
const DELIVERY_GRACE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const PUSH_TTL_SECONDS = 300; // Short 5-min TTL so stale prayer notifications never arrive hours late
const MAX_TRANSIENT_ATTEMPTS = 3;

let intervalId: NodeJS.Timeout | null = null;
let tickInFlight = false;
let lastTickAt: string | null = null;
let lastTickSummary: {
  checkedSubscriptions: number;
  attempted: number;
  sent: number;
  retried: number;
  expired: number;
} | null = null;

function shiftColomboDateISO(dateISO: string, deltaDays: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;
}

export interface WebPushPayload {
  title: string;
  body: string;
  prayer?: PrayerName | 'test';
  prayerTimeHHMM?: string;
  advanceMinutes?: number;
  dateISO?: string;
  zoneId?: number;
  zoneName?: string;
  eventKey: string;
  url: string;
  sentAt: string;
  isTest?: boolean;
}

export const pushTransport = {
  sendNotification,
};

export async function sendEncryptedWebPush(params: {
  subscription: PushSubscriptionRow;
  payload: WebPushPayload;
  ttlSeconds?: number;
}): Promise<{ ok: boolean; statusCode: number | null; error: string | null; expired: boolean }> {
  ensureVapidConfigured();

  const target = {
    endpoint: params.subscription.endpoint,
    keys: {
      p256dh: params.subscription.p256dhKey,
      auth: params.subscription.authKey,
    },
  };

  try {
    const res = await pushTransport.sendNotification(target, JSON.stringify(params.payload), {
      TTL: params.ttlSeconds ?? PUSH_TTL_SECONDS,
      urgency: 'high',
      topic: params.payload.isTest ? 'my-adhan-test' : `adhan-${params.payload.prayer ?? 'prayer'}`,
    });
    return {
      ok: true,
      statusCode: res.statusCode ?? 201,
      error: null,
      expired: false,
    };
  } catch (err) {
    const pushErr = err as { statusCode?: number; body?: string; message?: string };
    const statusCode = typeof pushErr.statusCode === 'number' ? pushErr.statusCode : null;
    const expired = statusCode === 404 || statusCode === 410;
    const msgParts = [
      statusCode ? `HTTP ${statusCode}` : 'Network/Push error',
      pushErr.message || 'Delivery failed',
      pushErr.body ? pushErr.body.slice(0, 180) : '',
    ].filter(Boolean);
    return {
      ok: false,
      statusCode,
      error: msgParts.join(' — '),
      expired,
    };
  }
}

export function getNextScheduledPrayerForSubscription(sub: PushSubscriptionRow, now = new Date()) {
  const district = ACJU_DISTRICTS.find((d) => d.id === sub.districtId);
  const zoneId = district?.zoneId ?? sub.zoneId;
  const zone = ACJU_ZONES.find((z) => z.id === zoneId) ?? ACJU_ZONES[0];
  const colombo = getColomboNowParts(now);
  const today = resolveEmbeddedDaySchedule(zoneId, colombo.dateISO);
  const tomorrow = resolveEmbeddedDaySchedule(zoneId, shiftColomboDateISO(colombo.dateISO, 1));
  const next = computeNextPrayer(today, tomorrow, now);

  return {
    zoneId,
    zoneName: zone.name,
    districtName: district?.name ?? sub.districtId,
    colomboDate: colombo.dateISO,
    colomboTime: colombo.formattedTime,
    isVerifiedToday: today.isVerified,
    scheduleSource: today.scheduleSource,
    nextPrayer: next,
  };
}

export async function runSchedulerTick(now = new Date()): Promise<{
  checkedSubscriptions: number;
  attempted: number;
  sent: number;
  retried: number;
  expired: number;
}> {
  if (tickInFlight) {
    return (
      lastTickSummary ?? {
        checkedSubscriptions: 0,
        attempted: 0,
        sent: 0,
        retried: 0,
        expired: 0,
      }
    );
  }

  tickInFlight = true;
  const stats = {
    checkedSubscriptions: 0,
    attempted: 0,
    sent: 0,
    retried: 0,
    expired: 0,
  };

  try {
    ensureVapidConfigured();
    const activeSubs = listActiveSubscriptions();
    stats.checkedSubscriptions = activeSubs.length;

    const nowMs = now.getTime();
    const colombo = getColomboNowParts(now);
    const candidateDates = [
      shiftColomboDateISO(colombo.dateISO, -1),
      colombo.dateISO,
      shiftColomboDateISO(colombo.dateISO, 1),
    ];

    for (const sub of activeSubs) {
      const district = ACJU_DISTRICTS.find((d) => d.id === sub.districtId);
      const zoneId = district?.zoneId ?? sub.zoneId;
      const zone = ACJU_ZONES.find((z) => z.id === zoneId) ?? ACJU_ZONES[0];

      for (const dateISO of candidateDates) {
        const schedule = resolveEmbeddedDaySchedule(zoneId, dateISO);
        if (!schedule.isVerified || schedule.isDemoSample || !schedule.times) {
          continue;
        }
        const versionTag = schedule.versionId ?? `y${schedule.sourceYear ?? schedule.targetYear}`;

        for (const prayer of PRAYER_NAMES) {
          if (!sub.perPrayerEnabled?.[prayer]) continue;

          const prayerTimeHHMM = schedule.times[prayer];
          const advanceMinutes = (sub.advanceMinutes?.[prayer] ?? 0) as AdvanceMinutesOption;
          const prayerEpochMs = colomboDateTimeToEpochMs(dateISO, prayerTimeHHMM);
          const triggerAtEpochMs = prayerEpochMs - advanceMinutes * 60_000;
          const elapsedMs = nowMs - triggerAtEpochMs;

          // Only fire inside [0, 5 min] window
          if (elapsedMs < 0 || elapsedMs > DELIVERY_GRACE_WINDOW_MS) {
            continue;
          }

          const eventKey = `${sub.deviceId}::${dateISO}::${prayer}::m${advanceMinutes}::v${versionTag}`;
          const existing = getDeliveryByEventKey(eventKey);
          if (existing && (existing.status === 'sent' || existing.status === 'expired')) {
            continue;
          }
          if (existing && existing.attemptCount >= MAX_TRANSIENT_ATTEMPTS) {
            continue;
          }

          // Exponential backoff on retries (wait >= 30s * attemptCount)
          if (existing && existing.status === 'retrying') {
            const lastAttemptMs = new Date(existing.updatedAt).getTime();
            if (nowMs - lastAttemptMs < 30_000 * existing.attemptCount) {
              continue;
            }
          }

          stats.attempted += 1;
          const label = PRAYER_LABELS[prayer];
          const formatted12 = formatTime12h(prayerTimeHHMM);
          const title =
            advanceMinutes > 0
              ? `${label} in ${advanceMinutes} min · ${formatted12}`
              : `${label} Prayer Time · ${formatted12}`;
          const body = `${district?.name ?? zone.name} (${zone.name}) · ACJU Sri Lanka`;

          const result = await sendEncryptedWebPush({
            subscription: sub,
            payload: {
              title,
              body,
              prayer,
              prayerTimeHHMM,
              advanceMinutes,
              dateISO,
              zoneId,
              zoneName: zone.name,
              eventKey,
              url: `/?fromPush=1&prayer=${encodeURIComponent(prayer)}&eventKey=${encodeURIComponent(eventKey)}`,
              sentAt: new Date().toISOString(),
            },
            ttlSeconds: PUSH_TTL_SECONDS,
          });

          if (result.ok) {
            stats.sent += 1;
            upsertDeliveryAttempt({
              eventKey,
              subscriptionId: sub.id,
              deviceId: sub.deviceId,
              dateISO,
              prayer,
              prayerTimeHHMM,
              advanceMinutes,
              scheduledForEpochMs: triggerAtEpochMs,
              status: 'sent',
              httpStatus: result.statusCode,
              errorMessage: null,
            });
            recordSubscriptionDeliverySuccess(sub.deviceId);
            appendServerLog({
              level: 'info',
              category: 'scheduler_delivery',
              deviceId: sub.deviceId,
              message: `Delivered ${label} (${formatted12}) push to ${zone.name}`,
              meta: { eventKey, statusCode: result.statusCode, advanceMinutes },
            });
          } else if (result.expired) {
            stats.expired += 1;
            upsertDeliveryAttempt({
              eventKey,
              subscriptionId: sub.id,
              deviceId: sub.deviceId,
              dateISO,
              prayer,
              prayerTimeHHMM,
              advanceMinutes,
              scheduledForEpochMs: triggerAtEpochMs,
              status: 'expired',
              httpStatus: result.statusCode,
              errorMessage: result.error,
            });
            recordSubscriptionDeliveryFailure(
              sub.deviceId,
              result.error ?? 'Subscription expired (410 Gone)',
              true
            );
            appendServerLog({
              level: 'warn',
              category: 'subscription_cleanup',
              deviceId: sub.deviceId,
              message: `Marked expired push subscription after ${result.statusCode}`,
              meta: { eventKey, error: result.error },
            });
            break; // Stop checking more prayers for this expired subscription
          } else {
            const nextAttempt = (existing?.attemptCount ?? 0) + 1;
            const status = nextAttempt >= MAX_TRANSIENT_ATTEMPTS ? 'failed' : 'retrying';
            stats.retried += 1;
            upsertDeliveryAttempt({
              eventKey,
              subscriptionId: sub.id,
              deviceId: sub.deviceId,
              dateISO,
              prayer,
              prayerTimeHHMM,
              advanceMinutes,
              scheduledForEpochMs: triggerAtEpochMs,
              status,
              httpStatus: result.statusCode,
              errorMessage: result.error,
            });
            recordSubscriptionDeliveryFailure(
              sub.deviceId,
              result.error ?? 'Transient delivery error',
              false
            );
            appendServerLog({
              level: 'error',
              category: 'scheduler_delivery',
              deviceId: sub.deviceId,
              message: `Failed ${label} push (${status})`,
              meta: { eventKey, statusCode: result.statusCode, error: result.error },
            });
          }
        }
      }
    }

    lastTickAt = new Date().toISOString();
    lastTickSummary = stats;
    return stats;
  } finally {
    tickInFlight = false;
  }
}

export function startScheduler(): void {
  if (intervalId) return;
  // Immediate startup recovery tick + 15-second precision loop
  void runSchedulerTick().catch((err) => {
    appendServerLog({
      level: 'error',
      category: 'scheduler',
      message: `Startup scheduler tick error: ${(err as Error).message}`,
    });
  });

  intervalId = setInterval(() => {
    void runSchedulerTick().catch((err) => {
      appendServerLog({
        level: 'error',
        category: 'scheduler',
        message: `Periodic scheduler tick error: ${(err as Error).message}`,
      });
    });
  }, SCHEDULER_INTERVAL_MS);
}

export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function getSchedulerStatus() {
  return {
    running: intervalId !== null,
    intervalMs: SCHEDULER_INTERVAL_MS,
    graceWindowMs: DELIVERY_GRACE_WINDOW_MS,
    ttlSeconds: PUSH_TTL_SECONDS,
    lastTickAt,
    lastTickSummary,
  };
}
