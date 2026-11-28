import {
  getColomboNowParts,
  getCorsHeaders,
  getSupabaseAdmin,
  getValidatedVapidConfig,
  jsonResponse,
  resolveDistrictAndZone,
  sendEncryptedPush,
  verifyCronSecret,
} from '../_shared/security.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }

  if (req.method !== 'POST') {
    return jsonResponse(req, { error: 'Method not allowed.' }, 405);
  }

  if (!verifyCronSecret(req)) {
    return jsonResponse(req, { error: 'Unauthorized cron trigger.' }, 401);
  }

  try {
    const supabase = getSupabaseAdmin();
    const vapid = getValidatedVapidConfig();

    if (!vapid.configured) {
      return jsonResponse(
        req,
        { ok: false, error: vapid.errorMessage ?? 'VAPID secrets are not configured.' },
        503
      );
    }

    // 1. Concurrency-safe atomic claim of due pending jobs via RPC (FOR UPDATE SKIP LOCKED)
    let claimedJobs: Array<{
      id: string;
      device_uuid: string;
      scheduled_at: string;
      attempts: number;
    }> = [];

    const { data: rpcJobs, error: rpcErr } = await supabase.rpc('claim_due_test_push_jobs', {
      p_limit: 20,
    });

    if (!rpcErr && Array.isArray(rpcJobs)) {
      claimedJobs = rpcJobs;
    } else {
      // Fallback if RPC migration is still applying: atomic update
      const nowIso = new Date().toISOString();
      const { data: fallbackJobs } = await supabase
        .from('push_test_jobs')
        .update({ status: 'processing', attempts: 1 })
        .eq('status', 'pending')
        .lte('scheduled_at', nowIso)
        .order('scheduled_at', { ascending: true })
        .limit(20)
        .select('id, device_uuid, scheduled_at, attempts');

      claimedJobs = fallbackJobs ?? [];
    }

    const colombo = getColomboNowParts();
    let sentCount = 0;
    let failedCount = 0;

    for (const job of claimedJobs) {
      const nowIso = new Date().toISOString();

      // Retrieve device and active push subscription
      const { data: dev } = await supabase
        .from('devices')
        .select('id, device_id, district_id, zone_id')
        .eq('id', job.device_uuid)
        .maybeSingle();

      const { data: sub } = await supabase
        .from('push_subscriptions')
        .select('id, endpoint, p256dh_key, auth_key, status, failure_count')
        .eq('device_uuid', job.device_uuid)
        .maybeSingle();

      if (!dev || !sub || sub.status !== 'active') {
        const errorMsg = !dev
          ? 'Registered device not found'
          : !sub
          ? 'Push subscription record missing'
          : `Push subscription is not active (status: ${sub.status})`;

        await supabase
          .from('push_test_jobs')
          .update({
            status: 'failed',
            error_message: errorMsg,
          })
          .eq('id', job.id);

        failedCount++;
        continue;
      }

      const zoneInfo = resolveDistrictAndZone(dev.district_id);
      const idempotencyKey = `test-job:${job.id}`;

      // Dispatch Web Push notification (omitting topic to prevent BadWebPushTopic on APNs)
      const result = await sendEncryptedPush({
        endpoint: sub.endpoint,
        p256dhKey: sub.p256dh_key,
        authKey: sub.auth_key,
        ttlSeconds: 300,
        payload: {
          title: 'My Adhan — Background Test',
          body: 'This test notification was scheduled by My Adhan.',
          prayer: 'test',
          prayerTimeHHMM: colombo.formattedTime.slice(0, 5),
          dateISO: colombo.dateISO,
          zoneId: dev.zone_id,
          zoneName: zoneInfo.zoneName,
          jobId: job.id,
          eventKey: idempotencyKey,
          url: `/?fromPush=1&testJobId=${encodeURIComponent(job.id)}`,
          isBackgroundTest: true,
          sentAt: nowIso,
        },
      });

      if (result.ok) {
        await supabase
          .from('push_test_jobs')
          .update({
            status: 'sent',
            sent_at: nowIso,
            error_message: null,
          })
          .eq('id', job.id);

        await supabase
          .from('push_subscriptions')
          .update({
            last_delivery_attempt_at: nowIso,
            last_delivery_success_at: nowIso,
            last_delivery_error: null,
            failure_count: 0,
          })
          .eq('id', sub.id);

        await supabase.from('notification_logs').insert({
          device_uuid: dev.id,
          subscription_id: sub.id,
          idempotency_key: idempotencyKey,
          prayer_date: colombo.dateISO,
          prayer_name: 'test',
          prayer_time_hhmm: colombo.formattedTime.slice(0, 5),
          reminder_offset_min: 0,
          scheduled_for_utc: job.scheduled_at,
          status: 'sent',
          attempt_count: job.attempts,
          http_status: result.statusCode,
          error_message: null,
        });

        sentCount++;
      } else {
        await supabase
          .from('push_test_jobs')
          .update({
            status: 'failed',
            error_message: result.error,
          })
          .eq('id', job.id);

        await supabase
          .from('push_subscriptions')
          .update({
            status: result.expired ? 'expired' : sub.status,
            last_delivery_attempt_at: nowIso,
            last_delivery_error: result.error,
            failure_count: (sub.failure_count ?? 0) + 1,
          })
          .eq('id', sub.id);

        await supabase.from('notification_logs').insert({
          device_uuid: dev.id,
          subscription_id: sub.id,
          idempotency_key: idempotencyKey,
          prayer_date: colombo.dateISO,
          prayer_name: 'test',
          prayer_time_hhmm: colombo.formattedTime.slice(0, 5),
          reminder_offset_min: 0,
          scheduled_for_utc: job.scheduled_at,
          status: result.expired ? 'expired' : 'failed',
          attempt_count: job.attempts,
          http_status: result.statusCode,
          error_message: result.error,
        });

        failedCount++;
      }
    }

    // Clean up expired pending jobs older than 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await supabase
      .from('push_test_jobs')
      .update({ status: 'failed', error_message: 'Job expired without worker claim' })
      .eq('status', 'pending')
      .lte('scheduled_at', twoHoursAgo);

    return jsonResponse(req, {
      ok: true,
      claimed: claimedJobs.length,
      sent: sentCount,
      failed: failedCount,
    });
  } catch (err) {
    console.error('[dispatch-test-push] Unhandled error:', err instanceof Error ? err.message : String(err));
    return jsonResponse(req, { ok: false, error: 'Internal server error while dispatching test jobs.' }, 500);
  }
});
