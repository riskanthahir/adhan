-- ============================================================================
-- Migration 003: Dedicated Background Push Test Jobs & Scheduled Dispatch
--
-- Adds public.push_test_jobs, atomic claiming RPC with FOR UPDATE SKIP LOCKED,
-- and pg_cron minute-by-minute invocation for dispatch-test-push.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.push_test_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_uuid UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  error_message text,
  attempts int NOT NULL DEFAULT 0
);

-- Partial index for fast minute-by-minute worker claims of due pending jobs
CREATE INDEX IF NOT EXISTS idx_push_test_jobs_due
  ON public.push_test_jobs (status, scheduled_at)
  WHERE status = 'pending';

-- Index for device history and status lookups
CREATE INDEX IF NOT EXISTS idx_push_test_jobs_device
  ON public.push_test_jobs (device_uuid, created_at DESC);

-- Enable Row Level Security (accessed securely via service-role in Edge Functions)
ALTER TABLE public.push_test_jobs ENABLE ROW LEVEL SECURITY;

-- Concurrency-safe atomic job claiming function using FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_due_test_push_jobs(p_limit int DEFAULT 20)
RETURNS SETOF public.push_test_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH due_jobs AS (
    SELECT id
    FROM public.push_test_jobs
    WHERE status = 'pending'
      AND scheduled_at <= now()
    ORDER BY scheduled_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.push_test_jobs j
  SET status = 'processing',
      attempts = j.attempts + 1
  FROM due_jobs
  WHERE j.id = due_jobs.id
  RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_test_push_jobs(int) FROM PUBLIC, anon, authenticated;

-- Schedule dispatch-test-push every minute (* * * * *) via existing pg_cron + Vault setup
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'my_adhan_dispatch_test_push') THEN
    PERFORM cron.unschedule('my_adhan_dispatch_test_push');
  END IF;

  PERFORM cron.schedule(
    'my_adhan_dispatch_test_push',
    '* * * * *',
    $$SELECT public.invoke_my_adhan_edge_function('dispatch-test-push');$$
  );
END;
$$;
