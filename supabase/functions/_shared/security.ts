import { createECDH, timingSafeEqual } from 'node:crypto';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.49.4';
import { sendNotification, setVapidDetails } from 'npm:web-push@4.0.0';

export const PRAYER_NAMES = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
export type PrayerName = (typeof PRAYER_NAMES)[number];

export const PRAYER_LABELS: Record<PrayerName, string> = {
  fajr: 'Fajr',
  dhuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
};

export const VALID_ADVANCE_MINUTES = new Set([0, 5, 10, 15, 30]);

export const DISTRICT_ZONE_MAP: Record<string, { name: string; zoneId: number; zoneName: string }> = {
  colombo: { name: 'Colombo', zoneId: 1, zoneName: 'Zone 1 — Western Coast' },
  gampaha: { name: 'Gampaha', zoneId: 1, zoneName: 'Zone 1 — Western Coast' },
  kalutara: { name: 'Kalutara', zoneId: 1, zoneName: 'Zone 1 — Western Coast' },
  nallur: { name: 'Nallur', zoneId: 2, zoneName: 'Zone 2 — Jaffna & Nallur' },
  jaffna: { name: 'Jaffna', zoneId: 2, zoneName: 'Zone 2 — Jaffna & Nallur' },
  mullaitivu: { name: 'Mullaitivu', zoneId: 3, zoneName: 'Zone 3 — Northern Vanni' },
  kilinochchi: { name: 'Kilinochchi', zoneId: 3, zoneName: 'Zone 3 — Northern Vanni' },
  vavuniya: { name: 'Vavuniya', zoneId: 3, zoneName: 'Zone 3 — Northern Vanni' },
  mannar: { name: 'Mannar', zoneId: 4, zoneName: 'Zone 4 — North-West Coast' },
  puttalam: { name: 'Puttalam', zoneId: 4, zoneName: 'Zone 4 — North-West Coast' },
  anuradhapura: { name: 'Anuradhapura', zoneId: 5, zoneName: 'Zone 5 — North Central' },
  polonnaruwa: { name: 'Polonnaruwa', zoneId: 5, zoneName: 'Zone 5 — North Central' },
  kurunegala: { name: 'Kurunegala', zoneId: 6, zoneName: 'Zone 6 — Wayamba Interior' },
  gampola: { name: 'Gampola', zoneId: 7, zoneName: 'Zone 7 — Central Highlands' },
  kandy: { name: 'Kandy', zoneId: 7, zoneName: 'Zone 7 — Central Highlands' },
  matale: { name: 'Matale', zoneId: 7, zoneName: 'Zone 7 — Central Highlands' },
  nuwara_eliya: { name: 'Nuwara Eliya', zoneId: 7, zoneName: 'Zone 7 — Central Highlands' },
  batticaloa: { name: 'Batticaloa', zoneId: 8, zoneName: 'Zone 8 — Eastern Coast' },
  ampara: { name: 'Ampara', zoneId: 8, zoneName: 'Zone 8 — Eastern Coast' },
  trincomalee: { name: 'Trincomalee', zoneId: 9, zoneName: 'Zone 9 — Trincomalee' },
  padiyatalawa: { name: 'Padiyatalawa', zoneId: 10, zoneName: 'Zone 10 — Uva & Mahaweli East' },
  dehiaththekandiya: { name: 'Dehiaththekandiya', zoneId: 10, zoneName: 'Zone 10 — Uva & Mahaweli East' },
  badulla: { name: 'Badulla', zoneId: 10, zoneName: 'Zone 10 — Uva & Mahaweli East' },
  monaragala: { name: 'Monaragala', zoneId: 10, zoneName: 'Zone 10 — Uva & Mahaweli East' },
  ratnapura: { name: 'Ratnapura', zoneId: 11, zoneName: 'Zone 11 — Sabaragamuwa' },
  kegalle: { name: 'Kegalle', zoneId: 11, zoneName: 'Zone 11 — Sabaragamuwa' },
  galle: { name: 'Galle', zoneId: 12, zoneName: 'Zone 12 — Southern Coast' },
  matara: { name: 'Matara', zoneId: 12, zoneName: 'Zone 12 — Southern Coast' },
  hambantota: { name: 'Hambantota', zoneId: 13, zoneName: 'Zone 13 — Hambantota' },
};

export const VAPID_SETUP_INSTRUCTIONS: string[] = [
  '1. Generate one persistent VAPID key pair via `npm run vapid:generate` or `npx web-push generate-vapid-keys`.',
  '2. Store VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT in Supabase Edge Function secrets via `supabase secrets set`.',
  '3. Never expose VAPID_PRIVATE_KEY or SUPABASE_SERVICE_ROLE_KEY in frontend code or GitHub.',
];

export function getCorsHeaders(req: Request): Record<string, string> {
  const configuredRaw = Deno.env.get('ALLOWED_ORIGIN')?.trim();
  const reqOrigin = req.headers.get('origin')?.trim().replace(/\/+$/, '');
  let allowOrigin = '*';

  if (configuredRaw) {
    const allowedList = configuredRaw
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean);
    if (reqOrigin && allowedList.includes(reqOrigin)) {
      allowOrigin = reqOrigin;
    } else if (allowedList.length > 0) {
      allowOrigin = allowedList[0];
    }
  } else if (
    reqOrigin &&
    (reqOrigin.startsWith('https://') || reqOrigin.startsWith('http://localhost') || reqOrigin.startsWith('http://127.0.0.1'))
  ) {
    allowOrigin = reqOrigin;
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-device-token',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(req),
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function getSupabaseAdmin(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')?.trim();
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!url || !serviceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY secret in Edge Function.');
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function decodeBase64Url(str: string): Uint8Array {
  const cleaned = str.replace(/=+$/, '');
  const pad = '='.repeat((4 - (cleaned.length % 4)) % 4);
  const b64 = (cleaned + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export interface VapidConfigStatus {
  configured: boolean;
  status: 'configured' | 'missing_keys' | 'invalid_subject' | 'invalid_format' | 'mismatched_keys';
  publicKey: string | null;
  subject: string | null;
  errorMessage: string | null;
  setupInstructions: string[];
}

export function getValidatedVapidConfig(): VapidConfigStatus {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')?.trim() ?? '';
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')?.trim() ?? '';
  const subject = Deno.env.get('VAPID_SUBJECT')?.trim() ?? '';

  if (!publicKey || !privateKey) {
    return {
      configured: false,
      status: 'missing_keys',
      publicKey: null,
      subject: subject || null,
      errorMessage: 'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are missing from Supabase Edge Function secrets.',
      setupInstructions: [...VAPID_SETUP_INSTRUCTIONS],
    };
  }

  const validSubject =
    (subject.startsWith('mailto:') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject.slice(7))) ||
    subject.startsWith('https://');
  if (!validSubject) {
    return {
      configured: false,
      status: 'invalid_subject',
      publicKey: null,
      subject: subject || null,
      errorMessage: 'VAPID_SUBJECT must be a valid mailto: or https:// URI.',
      setupInstructions: [...VAPID_SETUP_INSTRUCTIONS],
    };
  }

  if (!/^[A-Za-z0-9_-]+$/.test(publicKey.replace(/=+$/, '')) || !/^[A-Za-z0-9_-]+$/.test(privateKey.replace(/=+$/, ''))) {
    return {
      configured: false,
      status: 'invalid_format',
      publicKey: null,
      subject,
      errorMessage: 'VAPID keys must be URL-safe Base64.',
      setupInstructions: [...VAPID_SETUP_INSTRUCTIONS],
    };
  }

  try {
    const pubBuf = decodeBase64Url(publicKey);
    const privBuf = decodeBase64Url(privateKey);
    if (pubBuf.length !== 65 || pubBuf[0] !== 0x04 || privBuf.length !== 32) {
      return {
        configured: false,
        status: 'invalid_format',
        publicKey: null,
        subject,
        errorMessage: 'VAPID keys must be P-256 (65-byte uncompressed public, 32-byte private).',
        setupInstructions: [...VAPID_SETUP_INSTRUCTIONS],
      };
    }

    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(privBuf);
    const derived = new Uint8Array(ecdh.getPublicKey());
    if (derived.length !== pubBuf.length || !timingSafeEqual(derived, pubBuf)) {
      return {
        configured: false,
        status: 'mismatched_keys',
        publicKey: null,
        subject,
        errorMessage: 'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY do not match the same key pair.',
        setupInstructions: [...VAPID_SETUP_INSTRUCTIONS],
      };
    }

    setVapidDetails(subject, publicKey, privateKey);
    return {
      configured: true,
      status: 'configured',
      publicKey,
      subject,
      errorMessage: null,
      setupInstructions: [],
    };
  } catch (err) {
    return {
      configured: false,
      status: 'invalid_format',
      publicKey: null,
      subject,
      errorMessage: `Invalid VAPID key configuration: ${(err as Error).message}`,
      setupInstructions: [...VAPID_SETUP_INSTRUCTIONS],
    };
  }
}

export async function hashDeviceToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function constantTimeEqualStrings(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function verifyDeviceOwnership(expectedHash: string, providedToken: string | null): Promise<boolean> {
  if (!providedToken) return false;
  const computed = await hashDeviceToken(providedToken);
  return constantTimeEqualStrings(expectedHash, computed);
}

export function isValidDeviceId(val: unknown): val is string {
  return typeof val === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(val);
}

export function isValidDeviceToken(val: unknown): val is string {
  return typeof val === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(val);
}

export function isValidBase64Key(val: unknown, minLen = 12, maxLen = 256): val is string {
  return typeof val === 'string' && val.length >= minLen && val.length <= maxLen && /^[A-Za-z0-9+/_=-]+$/.test(val);
}

export function validatePushEndpoint(endpoint: unknown): { ok: true; url: string } | { ok: false; error: string } {
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

export function resolveDistrictAndZone(districtId: unknown): {
  districtId: string;
  districtName: string;
  zoneId: number;
  zoneName: string;
} {
  if (typeof districtId === 'string' && DISTRICT_ZONE_MAP[districtId]) {
    const m = DISTRICT_ZONE_MAP[districtId];
    return { districtId, districtName: m.name, zoneId: m.zoneId, zoneName: m.zoneName };
  }
  return {
    districtId: 'colombo',
    districtName: 'Colombo',
    zoneId: 1,
    zoneName: DISTRICT_ZONE_MAP.colombo.zoneName,
  };
}

export async function enforceRateLimit(
  supabase: SupabaseClient,
  rateKey: string,
  windowSeconds: number,
  maxRequests: number
): Promise<boolean> {
  const { data, error } = await supabase.rpc('check_and_increment_rate_limit', {
    p_key: rateKey,
    p_window_seconds: windowSeconds,
    p_max_requests: maxRequests,
  });
  if (error) {
    console.warn('[rate_limit] RPC error:', error.message);
    return true; // Fail open cleanly if transient DB error, log warning
  }
  return Boolean(data);
}

export function verifyCronSecret(req: Request): boolean {
  const secret = Deno.env.get('CRON_SECRET')?.trim();
  if (!secret) return false;
  const authHeader = req.headers.get('authorization') ?? '';
  return constantTimeEqualStrings(authHeader, `Bearer ${secret}`);
}

export function getColomboNowParts(now = new Date()): {
  dateISO: string;
  formattedTime: string;
} {
  // Asia/Colombo is fixed UTC+05:30 with no DST
  const colomboMs = now.getTime() + 330 * 60 * 1000;
  const dt = new Date(colomboMs);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  const hh = String(dt.getUTCHours()).padStart(2, '0');
  const mm = String(dt.getUTCMinutes()).padStart(2, '0');
  const ss = String(dt.getUTCSeconds()).padStart(2, '0');
  return {
    dateISO: `${y}-${m}-${d}`,
    formattedTime: `${hh}:${mm}:${ss}`,
  };
}

export function shiftColomboDateISO(dateISO: string, deltaDays: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;
}

export function colomboDateTimeToEpochMs(dateISO: string, hhmm: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm, 0, 0) - 330 * 60 * 1000;
}

export function formatTime12h(hhmm: string): string {
  const [hhStr, mmStr] = hhmm.split(':');
  const hh24 = Number(hhStr);
  const mm = Number(mmStr);
  if (Number.isNaN(hh24) || Number.isNaN(mm)) return hhmm;
  const period = hh24 >= 12 ? 'PM' : 'AM';
  const hh12 = hh24 % 12 === 0 ? 12 : hh24 % 12;
  return `${hh12}:${String(mm).padStart(2, '0')} ${period}`;
}

export function formatCountdownSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export async function sendEncryptedPush(params: {
  endpoint: string;
  p256dhKey: string;
  authKey: string;
  payload: Record<string, unknown>;
  ttlSeconds: number;
  topic?: string;
}): Promise<{ ok: boolean; statusCode: number | null; error: string | null; expired: boolean }> {
  const vapid = getValidatedVapidConfig();
  if (!vapid.configured) {
    return {
      ok: false,
      statusCode: null,
      error: vapid.errorMessage ?? 'VAPID secrets are not configured.',
      expired: false,
    };
  }

  try {
    const res = await sendNotification(
      {
        endpoint: params.endpoint,
        keys: {
          p256dh: params.p256dhKey,
          auth: params.authKey,
        },
      },
      JSON.stringify(params.payload),
      {
        TTL: params.ttlSeconds,
        urgency: 'high',
        topic: params.topic,
      }
    );
    return {
      ok: true,
      statusCode: res.statusCode ?? 201,
      error: null,
      expired: false,
    };
  } catch (err) {
    const pushErr = err as { statusCode?: number; body?: string; message?: string };
    const statusCode = typeof pushErr.statusCode === 'number' ? pushErr.statusCode : null;
    const isBadTopic =
      statusCode === 400 &&
      (String(pushErr.body || '').includes('BadWebPushTopic') ||
        String(pushErr.message || '').includes('BadWebPushTopic'));
    if (isBadTopic && params.topic) {
      console.warn('[push] BadWebPushTopic returned from push service; retrying without topic header');
      return sendEncryptedPush({ ...params, topic: undefined });
    }

    const expired = statusCode === 404 || statusCode === 410;
    const errorText = [
      statusCode ? `HTTP ${statusCode}` : 'Push error',
      pushErr.message || 'Delivery failed',
      pushErr.body ? String(pushErr.body).slice(0, 180) : '',
    ]
      .filter(Boolean)
      .join(' — ');
    return { ok: false, statusCode, error: errorText, expired };
  }
}

export async function buildSubscriptionSummary(
  supabase: SupabaseClient,
  deviceId: string
): Promise<Record<string, unknown> | null> {
  const { data: dev } = await supabase
    .from('devices')
    .select('*')
    .eq('device_id', deviceId)
    .maybeSingle();
  if (!dev) return null;

  const { data: sub } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('device_uuid', dev.id)
    .maybeSingle();
  if (!sub) return null;

  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('device_uuid', dev.id)
    .maybeSingle();

  const resolvedZone = resolveDistrictAndZone(dev.district_id);
  const colombo = getColomboNowParts();
  const tomorrowISO = shiftColomboDateISO(colombo.dateISO, 1);

  const { data: scheduleRows } = await supabase
    .from('prayer_times')
    .select('*')
    .eq('district_id', dev.district_id)
    .in('prayer_date', [colombo.dateISO, tomorrowISO]);

  const todayRow = scheduleRows?.find((r) => r.prayer_date === colombo.dateISO) ?? null;
  const tomorrowRow = scheduleRows?.find((r) => r.prayer_date === tomorrowISO) ?? null;

  const nowMs = Date.now();
  let nextPrayer: Record<string, unknown> | null = null;

  if (todayRow) {
    for (const prayer of PRAYER_NAMES) {
      const hhmm = String(todayRow[prayer]);
      const targetMs = colomboDateTimeToEpochMs(colombo.dateISO, hhmm);
      if (targetMs > nowMs) {
        const sec = Math.floor((targetMs - nowMs) / 1000);
        nextPrayer = {
          prayer,
          label: PRAYER_LABELS[prayer],
          timeHHMM: hhmm,
          isTomorrow: false,
          secondsRemaining: sec,
          countdownFormatted: formatCountdownSeconds(sec),
        };
        break;
      }
    }
  }
  if (!nextPrayer && tomorrowRow) {
    const hhmm = String(tomorrowRow.fajr);
    const targetMs = colomboDateTimeToEpochMs(tomorrowISO, hhmm);
    const sec = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
    nextPrayer = {
      prayer: 'fajr',
      label: PRAYER_LABELS.fajr,
      timeHHMM: hhmm,
      isTomorrow: true,
      secondsRemaining: sec,
      countdownFormatted: formatCountdownSeconds(sec),
    };
  }

  const endpointStr = String(sub.endpoint);

  let latestTestJob: Record<string, unknown> | null = null;
  try {
    const { data: jobRow } = await supabase
      .from('push_test_jobs')
      .select('id, status, scheduled_at, sent_at, error_message, created_at, attempts')
      .eq('device_uuid', dev.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (jobRow) {
      latestTestJob = {
        id: jobRow.id,
        status: jobRow.status,
        scheduledAt: jobRow.scheduled_at,
        sentAt: jobRow.sent_at,
        errorMessage: jobRow.error_message,
        createdAt: jobRow.created_at,
        attempts: jobRow.attempts,
      };
    }
  } catch {
    // Gracefully ignore if migration is pending in dev
  }

  return {
    subscriptionId: sub.id,
    deviceId: dev.device_id,
    status: sub.status,
    districtId: dev.district_id,
    zoneId: dev.zone_id,
    zoneName: resolvedZone.zoneName,
    timezone: dev.timezone,
    perPrayerEnabled: {
      fajr: prefs?.fajr_enabled ?? true,
      dhuhr: prefs?.dhuhr_enabled ?? true,
      asr: prefs?.asr_enabled ?? true,
      maghrib: prefs?.maghrib_enabled ?? true,
      isha: prefs?.isha_enabled ?? true,
    },
    advanceMinutes: {
      fajr: prefs?.fajr_offset_min ?? 0,
      dhuhr: prefs?.dhuhr_offset_min ?? 0,
      asr: prefs?.asr_offset_min ?? 0,
      maghrib: prefs?.maghrib_offset_min ?? 0,
      isha: prefs?.isha_offset_min ?? 0,
    },
    endpointPreview: endpointStr.slice(0, 64) + (endpointStr.length > 64 ? '…' : ''),
    lastRegisteredAt: sub.last_registered_at,
    lastVerifiedAt: sub.last_verified_at,
    lastDeliveryAttemptAt: sub.last_delivery_attempt_at,
    lastDeliverySuccessAt: sub.last_delivery_success_at,
    lastDeliveryError: sub.last_delivery_error,
    lastClickVerifiedAt: sub.last_click_verified_at,
    failureCount: sub.failure_count,
    nextScheduledPrayer: nextPrayer,
    latestTestJob,
  };
}
