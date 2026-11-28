-- Migration 002: SQLite Background Push Test Jobs
CREATE TABLE IF NOT EXISTS push_test_jobs (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  scheduled_for_epoch_ms INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  sent_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_test_jobs_due
  ON push_test_jobs(status, scheduled_for_epoch_ms);

CREATE INDEX IF NOT EXISTS idx_push_test_jobs_device
  ON push_test_jobs(device_id, id DESC);
