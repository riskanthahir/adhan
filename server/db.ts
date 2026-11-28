import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { AdvanceMinutesOption, PrayerName } from '../src/shared/types.ts';

export type SubscriptionStatus = 'active' | 'disabled' | 'expired' | 'invalid';
export type DeliveryStatus = 'sent' | 'failed' | 'retrying' | 'expired';

export interface PushSubscriptionRow {
  id: string;
  deviceId: string;
  deviceTokenHash: string;
  endpoint: string;
  p256dhKey: string;
  authKey: string;
  districtId: string;
  zoneId: number;
  timezone: string;
  perPrayerEnabled: Record<PrayerName, boolean>;
  advanceMinutes: Record<PrayerName, AdvanceMinutesOption>;
  status: SubscriptionStatus;
  userAgent: string | null;
  lastRegisteredAt: string;
  lastVerifiedAt: string | null;
  lastDeliveryAttemptAt: string | null;
  lastDeliverySuccessAt: string | null;
  lastDeliveryError: string | null;
  lastClickVerifiedAt: string | null;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDeliveryRow {
  id: string;
  eventKey: string;
  subscriptionId: string;
  deviceId: string;
  dateISO: string;
  prayer: string;
  prayerTimeHHMM: string;
  advanceMinutes: number;
  scheduledForEpochMs: number;
  status: DeliveryStatus;
  attemptCount: number;
  httpStatus: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServerLogRow {
  id: number;
  level: 'info' | 'warn' | 'error';
  category: string;
  deviceId: string | null;
  message: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

let dbInstance: DatabaseSync | null = null;
let dbFilePath = '';

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function getDatabasePath(): string {
  if (dbFilePath) return dbFilePath;
  const configured = process.env.DATABASE_PATH?.trim();
  if (configured === ':memory:') {
    dbFilePath = ':memory:';
  } else {
    dbFilePath = configured
      ? path.resolve(configured)
      : path.resolve(process.cwd(), 'data', 'my-adhan.db');
  }
  return dbFilePath;
}

export function initDatabase(): DatabaseSync {
  if (dbInstance) return dbInstance;

  const targetPath = getDatabasePath();
  if (targetPath !== ':memory:') {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }

  const db = new DatabaseSync(targetPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');

  // Ensure migration tracking table exists before scanning migrations
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const migrationFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const checkMigration = db.prepare('SELECT version FROM schema_migrations WHERE version = ?');
  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)'
  );

  for (const file of migrationFiles) {
    const existing = checkMigration.get(file) as { version: string } | undefined;
    if (existing) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.exec('BEGIN;');
    try {
      db.exec(sql);
      insertMigration.run(file, new Date().toISOString());
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  dbInstance = db;
  return db;
}

function getDb(): DatabaseSync {
  return dbInstance ?? initDatabase();
}

export function resetDatabaseForTesting(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // Ignore close errors in test teardown
    }
    dbInstance = null;
  }
  dbFilePath = '';
}

export function getAppliedMigrations(): Array<{ version: string; appliedAt: string }> {
  const rows = getDb()
    .prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version ASC')
    .all() as Array<{ version: string; applied_at: string }>;
  return rows.map((r) => ({ version: r.version, appliedAt: r.applied_at }));
}

export function getConfigValue(key: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM app_config WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setConfigValue(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO app_config (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value, new Date().toISOString());
}

function mapSubscriptionRow(raw: Record<string, unknown>): PushSubscriptionRow {
  return {
    id: String(raw.id),
    deviceId: String(raw.device_id),
    deviceTokenHash: String(raw.device_token_hash),
    endpoint: String(raw.endpoint),
    p256dhKey: String(raw.p256dh_key),
    authKey: String(raw.auth_key),
    districtId: String(raw.district_id),
    zoneId: Number(raw.zone_id),
    timezone: String(raw.timezone),
    perPrayerEnabled: JSON.parse(String(raw.per_prayer_enabled_json)) as Record<
      PrayerName,
      boolean
    >,
    advanceMinutes: JSON.parse(String(raw.advance_minutes_json)) as Record<
      PrayerName,
      AdvanceMinutesOption
    >,
    status: String(raw.status) as SubscriptionStatus,
    userAgent: raw.user_agent ? String(raw.user_agent) : null,
    lastRegisteredAt: String(raw.last_registered_at),
    lastVerifiedAt: raw.last_verified_at ? String(raw.last_verified_at) : null,
    lastDeliveryAttemptAt: raw.last_delivery_attempt_at
      ? String(raw.last_delivery_attempt_at)
      : null,
    lastDeliverySuccessAt: raw.last_delivery_success_at
      ? String(raw.last_delivery_success_at)
      : null,
    lastDeliveryError: raw.last_delivery_error ? String(raw.last_delivery_error) : null,
    lastClickVerifiedAt: raw.last_click_verified_at
      ? String(raw.last_click_verified_at)
      : null,
    failureCount: Number(raw.failure_count ?? 0),
    createdAt: String(raw.created_at),
    updatedAt: String(raw.updated_at),
  };
}

export function upsertPushSubscription(params: {
  deviceId: string;
  deviceToken: string;
  endpoint: string;
  p256dhKey: string;
  authKey: string;
  districtId: string;
  zoneId: number;
  timezone: string;
  perPrayerEnabled: Record<PrayerName, boolean>;
  advanceMinutes: Record<PrayerName, AdvanceMinutesOption>;
  userAgent: string | null;
}): PushSubscriptionRow {
  const db = getDb();
  const now = new Date().toISOString();
  const tokenHash = hashDeviceToken(params.deviceToken);
  const id = randomUUID();

  // If another stale device record held this same push endpoint, remove the stale row first
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND device_id != ?').run(
    params.endpoint,
    params.deviceId
  );

  db.prepare(
    `INSERT INTO push_subscriptions (
      id, device_id, device_token_hash, endpoint, p256dh_key, auth_key,
      district_id, zone_id, timezone, per_prayer_enabled_json, advance_minutes_json,
      status, user_agent, last_registered_at, last_verified_at,
      last_delivery_error, failure_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL, 0, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      device_token_hash = excluded.device_token_hash,
      endpoint = excluded.endpoint,
      p256dh_key = excluded.p256dh_key,
      auth_key = excluded.auth_key,
      district_id = excluded.district_id,
      zone_id = excluded.zone_id,
      timezone = excluded.timezone,
      per_prayer_enabled_json = excluded.per_prayer_enabled_json,
      advance_minutes_json = excluded.advance_minutes_json,
      status = 'active',
      user_agent = excluded.user_agent,
      last_registered_at = excluded.last_registered_at,
      last_verified_at = excluded.last_verified_at,
      last_delivery_error = NULL,
      failure_count = 0,
      updated_at = excluded.updated_at`
  ).run(
    id,
    params.deviceId,
    tokenHash,
    params.endpoint,
    params.p256dhKey,
    params.authKey,
    params.districtId,
    params.zoneId,
    params.timezone,
    JSON.stringify(params.perPrayerEnabled),
    JSON.stringify(params.advanceMinutes),
    params.userAgent,
    now,
    now,
    now,
    now
  );

  const saved = getSubscriptionByDeviceId(params.deviceId);
  if (!saved) {
    throw new Error('Failed to verify persisted push subscription in SQLite.');
  }
  return saved;
}

export function getSubscriptionByDeviceId(deviceId: string): PushSubscriptionRow | null {
  const row = getDb()
    .prepare('SELECT * FROM push_subscriptions WHERE device_id = ?')
    .get(deviceId) as Record<string, unknown> | undefined;
  return row ? mapSubscriptionRow(row) : null;
}

export function verifyDeviceOwnership(
  sub: PushSubscriptionRow,
  deviceToken: string | undefined
): boolean {
  if (!deviceToken) return false;
  return sub.deviceTokenHash === hashDeviceToken(deviceToken);
}

export function updateSubscriptionPreferences(params: {
  deviceId: string;
  districtId: string;
  zoneId: number;
  perPrayerEnabled: Record<PrayerName, boolean>;
  advanceMinutes: Record<PrayerName, AdvanceMinutesOption>;
}): PushSubscriptionRow | null {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE push_subscriptions
       SET district_id = ?, zone_id = ?, per_prayer_enabled_json = ?, advance_minutes_json = ?,
           last_verified_at = ?, updated_at = ?
       WHERE device_id = ?`
    )
    .run(
      params.districtId,
      params.zoneId,
      JSON.stringify(params.perPrayerEnabled),
      JSON.stringify(params.advanceMinutes),
      now,
      now,
      params.deviceId
    );
  return getSubscriptionByDeviceId(params.deviceId);
}

export function markSubscriptionStatus(
  deviceId: string,
  status: SubscriptionStatus,
  errorMessage?: string | null
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE push_subscriptions
       SET status = ?,
           last_delivery_error = COALESCE(?, last_delivery_error),
           updated_at = ?
       WHERE device_id = ?`
    )
    .run(status, errorMessage ?? null, now, deviceId);
}

export function recordSubscriptionDeliverySuccess(deviceId: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE push_subscriptions
       SET last_delivery_attempt_at = ?,
           last_delivery_success_at = ?,
           last_delivery_error = NULL,
           failure_count = 0,
           updated_at = ?
       WHERE device_id = ?`
    )
    .run(now, now, now, deviceId);
}

export function recordSubscriptionDeliveryFailure(
  deviceId: string,
  errorMessage: string,
  markExpired: boolean
): void {
  const now = new Date().toISOString();
  if (markExpired) {
    getDb()
      .prepare(
        `UPDATE push_subscriptions
         SET status = 'expired',
             last_delivery_attempt_at = ?,
             last_delivery_error = ?,
             failure_count = failure_count + 1,
             updated_at = ?
         WHERE device_id = ?`
      )
      .run(now, errorMessage, now, deviceId);
  } else {
    getDb()
      .prepare(
        `UPDATE push_subscriptions
         SET last_delivery_attempt_at = ?,
             last_delivery_error = ?,
             failure_count = failure_count + 1,
             updated_at = ?
         WHERE device_id = ?`
      )
      .run(now, errorMessage, now, deviceId);
  }
}

export function markSubscriptionVerifiedAt(deviceId: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare('UPDATE push_subscriptions SET last_verified_at = ?, updated_at = ? WHERE device_id = ?')
    .run(now, now, deviceId);
}

export function updateLastClickVerified(deviceId: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      'UPDATE push_subscriptions SET last_click_verified_at = ?, updated_at = ? WHERE device_id = ?'
    )
    .run(now, now, deviceId);
}

export function listActiveSubscriptions(): PushSubscriptionRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM push_subscriptions WHERE status = 'active'`)
    .all() as Array<Record<string, unknown>>;
  return rows.map(mapSubscriptionRow);
}

export function getDeliveryByEventKey(eventKey: string): NotificationDeliveryRow | null {
  const raw = getDb()
    .prepare('SELECT * FROM notification_deliveries WHERE event_key = ?')
    .get(eventKey) as Record<string, unknown> | undefined;
  if (!raw) return null;
  return {
    id: String(raw.id),
    eventKey: String(raw.event_key),
    subscriptionId: String(raw.subscription_id),
    deviceId: String(raw.device_id),
    dateISO: String(raw.date_iso),
    prayer: String(raw.prayer),
    prayerTimeHHMM: String(raw.prayer_time_hhmm),
    advanceMinutes: Number(raw.advance_minutes),
    scheduledForEpochMs: Number(raw.scheduled_for_epoch_ms),
    status: String(raw.status) as DeliveryStatus,
    attemptCount: Number(raw.attempt_count),
    httpStatus: raw.http_status !== null && raw.http_status !== undefined ? Number(raw.http_status) : null,
    errorMessage: raw.error_message ? String(raw.error_message) : null,
    createdAt: String(raw.created_at),
    updatedAt: String(raw.updated_at),
  };
}

export function upsertDeliveryAttempt(params: {
  eventKey: string;
  subscriptionId: string;
  deviceId: string;
  dateISO: string;
  prayer: string;
  prayerTimeHHMM: string;
  advanceMinutes: number;
  scheduledForEpochMs: number;
  status: DeliveryStatus;
  httpStatus: number | null;
  errorMessage: string | null;
}): void {
  const now = new Date().toISOString();
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO notification_deliveries (
        id, event_key, subscription_id, device_id, date_iso, prayer, prayer_time_hhmm,
        advance_minutes, scheduled_for_epoch_ms, status, attempt_count, http_status,
        error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(event_key) DO UPDATE SET
        status = excluded.status,
        attempt_count = notification_deliveries.attempt_count + 1,
        http_status = excluded.http_status,
        error_message = excluded.error_message,
        updated_at = excluded.updated_at`
    )
    .run(
      id,
      params.eventKey,
      params.subscriptionId,
      params.deviceId,
      params.dateISO,
      params.prayer,
      params.prayerTimeHHMM,
      params.advanceMinutes,
      params.scheduledForEpochMs,
      params.status,
      params.httpStatus,
      params.errorMessage,
      now,
      now
    );
}

export function listDeliveriesForDevice(deviceId: string, limit = 15): NotificationDeliveryRow[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM notification_deliveries
       WHERE device_id = ?
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .all(deviceId, limit) as Array<Record<string, unknown>>;
  return rows.map((raw) => ({
    id: String(raw.id),
    eventKey: String(raw.event_key),
    subscriptionId: String(raw.subscription_id),
    deviceId: String(raw.device_id),
    dateISO: String(raw.date_iso),
    prayer: String(raw.prayer),
    prayerTimeHHMM: String(raw.prayer_time_hhmm),
    advanceMinutes: Number(raw.advance_minutes),
    scheduledForEpochMs: Number(raw.scheduled_for_epoch_ms),
    status: String(raw.status) as DeliveryStatus,
    attemptCount: Number(raw.attempt_count),
    httpStatus: raw.http_status !== null && raw.http_status !== undefined ? Number(raw.http_status) : null,
    errorMessage: raw.error_message ? String(raw.error_message) : null,
    createdAt: String(raw.created_at),
    updatedAt: String(raw.updated_at),
  }));
}

export function appendServerLog(params: {
  level: 'info' | 'warn' | 'error';
  category: string;
  deviceId?: string | null;
  message: string;
  meta?: Record<string, unknown> | null;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO push_server_logs (level, category, device_id, message, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    params.level,
    params.category,
    params.deviceId ?? null,
    params.message,
    params.meta ? JSON.stringify(params.meta) : null,
    new Date().toISOString()
  );

  // Keep table bounded to last 1,000 log lines
  db.exec(
    `DELETE FROM push_server_logs
     WHERE id NOT IN (SELECT id FROM push_server_logs ORDER BY id DESC LIMIT 1000);`
  );
}

export function listServerLogsForDevice(deviceId: string, limit = 20): ServerLogRow[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM push_server_logs
       WHERE device_id = ? OR device_id IS NULL
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(deviceId, limit) as Array<Record<string, unknown>>;

  return rows.map((raw) => ({
    id: Number(raw.id),
    level: String(raw.level) as ServerLogRow['level'],
    category: String(raw.category),
    deviceId: raw.device_id ? String(raw.device_id) : null,
    message: String(raw.message),
    meta: raw.meta_json ? (JSON.parse(String(raw.meta_json)) as Record<string, unknown>) : null,
    createdAt: String(raw.created_at),
  }));
}

export function getDatabaseStats(): {
  activeSubscriptions: number;
  totalSubscriptions: number;
  totalDeliveries: number;
  sentDeliveries: number;
  expiredSubscriptions: number;
} {
  const db = getDb();
  const active = (
    db.prepare(`SELECT COUNT(*) AS c FROM push_subscriptions WHERE status = 'active'`).get() as {
      c: number;
    }
  ).c;
  const totalSubs = (
    db.prepare(`SELECT COUNT(*) AS c FROM push_subscriptions`).get() as { c: number }
  ).c;
  const expiredSubs = (
    db.prepare(`SELECT COUNT(*) AS c FROM push_subscriptions WHERE status = 'expired'`).get() as {
      c: number;
    }
  ).c;
  const totalDeliv = (
    db.prepare(`SELECT COUNT(*) AS c FROM notification_deliveries`).get() as { c: number }
  ).c;
  const sentDeliv = (
    db.prepare(`SELECT COUNT(*) AS c FROM notification_deliveries WHERE status = 'sent'`).get() as {
      c: number;
    }
  ).c;
  return {
    activeSubscriptions: active,
    totalSubscriptions: totalSubs,
    totalDeliveries: totalDeliv,
    sentDeliveries: sentDeliv,
    expiredSubscriptions: expiredSubs,
  };
}

export interface TestPushJobRow {
  id: string;
  deviceId: string;
  scheduledAt: string;
  scheduledForEpochMs: number;
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';
  errorMessage: string | null;
  sentAt: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

export function createTestPushJob(params: {
  deviceId: string;
  scheduledAt: string;
  scheduledForEpochMs: number;
}): TestPushJobRow {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  // Cancel any existing pending jobs for this device
  cancelPendingTestPushJobs(params.deviceId);

  db.prepare(
    `INSERT INTO push_test_jobs (
      id, device_id, scheduled_at, scheduled_for_epoch_ms, status, error_message, sent_at, attempts, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pending', NULL, NULL, 0, ?, ?)`
  ).run(id, params.deviceId, params.scheduledAt, params.scheduledForEpochMs, now, now);

  return {
    id,
    deviceId: params.deviceId,
    scheduledAt: params.scheduledAt,
    scheduledForEpochMs: params.scheduledForEpochMs,
    status: 'pending',
    errorMessage: null,
    sentAt: null,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function cancelPendingTestPushJobs(deviceId: string): number {
  const db = getDb();
  const now = new Date().toISOString();
  const res = db.prepare(
    `UPDATE push_test_jobs
     SET status = 'cancelled', updated_at = ?
     WHERE device_id = ? AND status = 'pending'`
  ).run(now, deviceId);
  return Number(res.changes ?? 0);
}

export function getLatestTestPushJob(deviceId: string): TestPushJobRow | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT * FROM push_test_jobs WHERE device_id = ? ORDER BY id DESC LIMIT 1`
  ).get(deviceId) as Record<string, unknown> | undefined;

  if (!row) return null;
  return {
    id: String(row.id),
    deviceId: String(row.device_id),
    scheduledAt: String(row.scheduled_at),
    scheduledForEpochMs: Number(row.scheduled_for_epoch_ms),
    status: String(row.status) as TestPushJobRow['status'],
    errorMessage: row.error_message ? String(row.error_message) : null,
    sentAt: row.sent_at ? String(row.sent_at) : null,
    attempts: Number(row.attempts ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function claimDueTestPushJobs(nowEpochMs: number, limit = 20): TestPushJobRow[] {
  const db = getDb();
  const nowIso = new Date().toISOString();

  const rows = db.prepare(
    `SELECT * FROM push_test_jobs
     WHERE status = 'pending' AND scheduled_for_epoch_ms <= ?
     ORDER BY scheduled_for_epoch_ms ASC
     LIMIT ?`
  ).all(nowEpochMs, limit) as Array<Record<string, unknown>>;

  const claimed: TestPushJobRow[] = [];
  for (const r of rows) {
    const id = String(r.id);
    db.prepare(
      `UPDATE push_test_jobs
       SET status = 'processing', attempts = attempts + 1, updated_at = ?
       WHERE id = ? AND status = 'pending'`
    ).run(nowIso, id);

    claimed.push({
      id,
      deviceId: String(r.device_id),
      scheduledAt: String(r.scheduled_at),
      scheduledForEpochMs: Number(r.scheduled_for_epoch_ms),
      status: 'processing',
      errorMessage: r.error_message ? String(r.error_message) : null,
      sentAt: r.sent_at ? String(r.sent_at) : null,
      attempts: Number(r.attempts ?? 0) + 1,
      createdAt: String(r.created_at),
      updatedAt: nowIso,
    });
  }

  return claimed;
}

export function updateTestPushJobStatus(
  jobId: string,
  status: 'sent' | 'failed' | 'cancelled',
  errorMessage: string | null = null
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE push_test_jobs
     SET status = ?, error_message = ?, sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END, updated_at = ?
     WHERE id = ?`
  ).run(status, errorMessage, status, now, now, jobId);
}

