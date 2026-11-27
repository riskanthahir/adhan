-- ============================================================================
-- Migration 001: My Adhan Supabase PostgreSQL Schema, RLS, Indexes & Constraints
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Trigger function to automatically maintain updated_at timestamps
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 1. devices
CREATE TABLE IF NOT EXISTS public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL UNIQUE,
  device_token_hash text NOT NULL,
  district_id text NOT NULL DEFAULT 'colombo',
  zone_id integer NOT NULL DEFAULT 1,
  timezone text NOT NULL DEFAULT 'Asia/Colombo',
  user_agent text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_devices_district_zone
  ON public.devices (district_id, zone_id);

DROP TRIGGER IF EXISTS trg_devices_updated_at ON public.devices;
CREATE TRIGGER trg_devices_updated_at
  BEFORE UPDATE ON public.devices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. push_subscriptions
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_uuid uuid NOT NULL UNIQUE REFERENCES public.devices(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh_key text NOT NULL,
  auth_key text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'expired', 'invalid')),
  failure_count integer NOT NULL DEFAULT 0,
  last_registered_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz,
  last_delivery_attempt_at timestamptz,
  last_delivery_success_at timestamptz,
  last_delivery_error text,
  last_click_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_status
  ON public.push_subscriptions (status);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_expired_updated
  ON public.push_subscriptions (status, updated_at);

DROP TRIGGER IF EXISTS trg_push_subscriptions_updated_at ON public.push_subscriptions;
CREATE TRIGGER trg_push_subscriptions_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. notification_preferences
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_uuid uuid NOT NULL UNIQUE REFERENCES public.devices(id) ON DELETE CASCADE,
  fajr_enabled boolean NOT NULL DEFAULT true,
  dhuhr_enabled boolean NOT NULL DEFAULT true,
  asr_enabled boolean NOT NULL DEFAULT true,
  maghrib_enabled boolean NOT NULL DEFAULT true,
  isha_enabled boolean NOT NULL DEFAULT true,
  fajr_offset_min integer NOT NULL DEFAULT 0 CHECK (fajr_offset_min IN (0, 5, 10, 15, 30)),
  dhuhr_offset_min integer NOT NULL DEFAULT 0 CHECK (dhuhr_offset_min IN (0, 5, 10, 15, 30)),
  asr_offset_min integer NOT NULL DEFAULT 0 CHECK (asr_offset_min IN (0, 5, 10, 15, 30)),
  maghrib_offset_min integer NOT NULL DEFAULT 0 CHECK (maghrib_offset_min IN (0, 5, 10, 15, 30)),
  isha_offset_min integer NOT NULL DEFAULT 0 CHECK (isha_offset_min IN (0, 5, 10, 15, 30)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_notification_preferences_updated_at ON public.notification_preferences;
CREATE TRIGGER trg_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. prayer_times (ACJU Sri Lanka source-of-truth schedules)
CREATE TABLE IF NOT EXISTS public.prayer_times (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id text NOT NULL,
  zone_id integer NOT NULL,
  prayer_date date NOT NULL,
  fajr text NOT NULL,
  sunrise text,
  dhuhr text NOT NULL,
  asr text NOT NULL,
  maghrib text NOT NULL,
  isha text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Colombo',
  source_version text NOT NULL,
  is_annual_repeat boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (district_id, prayer_date)
);

CREATE INDEX IF NOT EXISTS idx_prayer_times_date_district
  ON public.prayer_times (prayer_date, district_id);

CREATE INDEX IF NOT EXISTS idx_prayer_times_date_zone
  ON public.prayer_times (prayer_date, zone_id);

DROP TRIGGER IF EXISTS trg_prayer_times_updated_at ON public.prayer_times;
CREATE TRIGGER trg_prayer_times_updated_at
  BEFORE UPDATE ON public.prayer_times
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. notification_logs (Idempotent delivery ledger)
CREATE TABLE IF NOT EXISTS public.notification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_uuid uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES public.push_subscriptions(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL UNIQUE,
  prayer_date date NOT NULL,
  prayer_name text NOT NULL,
  prayer_time_hhmm text NOT NULL,
  reminder_offset_min integer NOT NULL DEFAULT 0,
  scheduled_for_utc timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'retrying', 'expired')),
  attempt_count integer NOT NULL DEFAULT 1,
  http_status integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_device_updated
  ON public.notification_logs (device_uuid, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_logs_status_date
  ON public.notification_logs (status, prayer_date);

DROP TRIGGER IF EXISTS trg_notification_logs_updated_at ON public.notification_logs;
CREATE TRIGGER trg_notification_logs_updated_at
  BEFORE UPDATE ON public.notification_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. scheduler_logs (Audit log for pg_cron + dispatch-prayer-push invocations)
CREATE TABLE IF NOT EXISTS public.scheduler_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  colombo_date date NOT NULL,
  colombo_time text NOT NULL,
  checked_subscriptions integer NOT NULL DEFAULT 0,
  due_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  expired_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ok',
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduler_logs_run_at
  ON public.scheduler_logs (run_at DESC);

DROP TRIGGER IF EXISTS trg_scheduler_logs_updated_at ON public.scheduler_logs;
CREATE TRIGGER trg_scheduler_logs_updated_at
  BEFORE UPDATE ON public.scheduler_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 7. edge_rate_limits (Rate limiting state for Edge Functions)
CREATE TABLE IF NOT EXISTS public.edge_rate_limits (
  rate_key text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_edge_rate_limits_updated_at ON public.edge_rate_limits;
CREATE TRIGGER trg_edge_rate_limits_updated_at
  BEFORE UPDATE ON public.edge_rate_limits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Atomic rate limit function callable only by service_role
CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  p_key text,
  p_window_seconds integer,
  p_max_requests integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_count integer;
BEGIN
  INSERT INTO public.edge_rate_limits (rate_key, window_start, request_count)
  VALUES (p_key, v_now, 1)
  ON CONFLICT (rate_key) DO UPDATE SET
    request_count = CASE
      WHEN public.edge_rate_limits.window_start + make_interval(secs => p_window_seconds) <= v_now
        THEN 1
      ELSE public.edge_rate_limits.request_count + 1
    END,
    window_start = CASE
      WHEN public.edge_rate_limits.window_start + make_interval(secs => p_window_seconds) <= v_now
        THEN v_now
      ELSE public.edge_rate_limits.window_start
    END
  RETURNING request_count INTO v_count;

  RETURN v_count <= p_max_requests;
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(text, integer, integer) TO service_role;

-- ============================================================================
-- Row Level Security (RLS)
-- Only Edge Functions using SUPABASE_SERVICE_ROLE_KEY may access device tables.
-- Public read-only access is permitted only on official ACJU prayer_times.
-- ============================================================================
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prayer_times ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduler_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edge_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read ACJU prayer times" ON public.prayer_times;
CREATE POLICY "Public read ACJU prayer times"
  ON public.prayer_times
  FOR SELECT
  TO anon, authenticated
  USING (true);
