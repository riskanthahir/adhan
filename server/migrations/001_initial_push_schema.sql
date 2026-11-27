-- Migration 001: Initial Web Push Notifications, Subscriptions, Delivery Deduplication & Logs

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL UNIQUE,
  device_token_hash TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh_key TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  district_id TEXT NOT NULL,
  zone_id INTEGER NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Colombo',
  per_prayer_enabled_json TEXT NOT NULL,
  advance_minutes_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  user_agent TEXT,
  last_registered_at TEXT NOT NULL,
  last_verified_at TEXT,
  last_delivery_attempt_at TEXT,
  last_delivery_success_at TEXT,
  last_delivery_error TEXT,
  last_click_verified_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_status
  ON push_subscriptions(status);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_zone
  ON push_subscriptions(zone_id);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  subscription_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  date_iso TEXT NOT NULL,
  prayer TEXT NOT NULL,
  prayer_time_hhmm TEXT NOT NULL,
  advance_minutes INTEGER NOT NULL DEFAULT 0,
  scheduled_for_epoch_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  http_status INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_device_date
  ON notification_deliveries(device_id, date_iso);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status
  ON notification_deliveries(status, updated_at);

CREATE TABLE IF NOT EXISTS push_server_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  category TEXT NOT NULL,
  device_id TEXT,
  message TEXT NOT NULL,
  meta_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_server_logs_device_time
  ON push_server_logs(device_id, id DESC);
