-- ============================================================================
-- Migration 002: Supabase pg_cron + pg_net + Supabase Vault Scheduler Setup
--
-- IMPORTANT SETUP NOTE BEFORE RUNNING CRON:
-- Add these two secrets in Supabase Dashboard -> Project Settings -> Vault
-- (or via SQL):
--   SELECT vault.create_secret('https://<PROJECT_REF>.supabase.co', 'project_url');
--   SELECT vault.create_secret('<YOUR_RANDOM_CRON_SECRET>', 'cron_secret');
-- And set the same CRON_SECRET as an Edge Function secret:
--   supabase secrets set CRON_SECRET=<YOUR_RANDOM_CRON_SECRET>
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Helper function invoking a Supabase Edge Function using Vault-stored URL & CRON_SECRET
CREATE OR REPLACE FUNCTION public.invoke_my_adhan_edge_function(p_function_slug text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_project_url text;
  v_cron_secret text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_project_url
  FROM vault.decrypted_secrets
  WHERE name = 'project_url'
  LIMIT 1;

  SELECT decrypted_secret INTO v_cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;

  IF v_project_url IS NULL OR v_cron_secret IS NULL THEN
    RAISE NOTICE 'My Adhan cron skipped: missing Vault secrets project_url or cron_secret.';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/' || p_function_slug,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_cron_secret
    ),
    body := jsonb_build_object('triggered_by', 'pg_cron', 'triggered_at', now())
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_my_adhan_edge_function(text) FROM PUBLIC, anon, authenticated;

-- Idempotently schedule dispatch-prayer-push every minute (* * * * *)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'my_adhan_dispatch_prayer_push') THEN
    PERFORM cron.unschedule('my_adhan_dispatch_prayer_push');
  END IF;
  PERFORM cron.schedule(
    'my_adhan_dispatch_prayer_push',
    '* * * * *',
    $$SELECT public.invoke_my_adhan_edge_function('dispatch-prayer-push');$$
  );
END;
$$;

-- Idempotently schedule cleanup-subscriptions daily at 21:15 UTC (02:45 Asia/Colombo)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'my_adhan_cleanup_subscriptions') THEN
    PERFORM cron.unschedule('my_adhan_cleanup_subscriptions');
  END IF;
  PERFORM cron.schedule(
    'my_adhan_cleanup_subscriptions',
    '15 21 * * *',
    $$SELECT public.invoke_my_adhan_edge_function('cleanup-subscriptions');$$
  );
END;
$$;
