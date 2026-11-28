import {
  enforceRateLimit,
  getCorsHeaders,
  getSupabaseAdmin,
  getValidatedVapidConfig,
  isValidDeviceId,
  isValidDeviceToken,
  jsonResponse,
  verifyDeviceOwnership,
} from '../_shared/security.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }

  try {
    const supabase = getSupabaseAdmin();
    const url = new URL(req.url);

    // 1. GET: Fetch latest background test job status for device
    if (req.method === 'GET') {
      const deviceId = url.searchParams.get('deviceId');
      const deviceToken = req.headers.get('x-device-token');

      if (!isValidDeviceId(deviceId) || !isValidDeviceToken(deviceToken)) {
        return jsonResponse(req, { error: 'Invalid deviceId or x-device-token header.' }, 400);
      }

      const { data: dev } = await supabase
        .from('devices')
        .select('id, device_token_hash')
        .eq('device_id', deviceId)
        .maybeSingle();

      if (!dev || !(await verifyDeviceOwnership(dev.device_token_hash, deviceToken))) {
        return jsonResponse(req, { error: 'Unauthorized device token.' }, 403);
      }

      const { data: jobRow } = await supabase
        .from('push_test_jobs')
        .select('id, status, scheduled_at, sent_at, error_message, created_at, attempts')
        .eq('device_uuid', dev.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      return jsonResponse(req, {
        ok: true,
        job: jobRow
          ? {
              id: jobRow.id,
              status: jobRow.status,
              scheduledAt: jobRow.scheduled_at,
              sentAt: jobRow.sent_at,
              errorMessage: jobRow.error_message,
              createdAt: jobRow.created_at,
              attempts: jobRow.attempts,
            }
          : null,
      });
    }

    if (req.method !== 'POST') {
      return jsonResponse(req, { error: 'Method not allowed.' }, 405);
    }

    // 2. POST: Schedule or Cancel background test job
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return jsonResponse(req, { error: 'Invalid JSON request body.' }, 400);
    }

    const deviceId = body.deviceId;
    const deviceToken =
      req.headers.get('x-device-token') ??
      (typeof body.deviceToken === 'string' ? body.deviceToken : null);

    if (!isValidDeviceId(deviceId) || !isValidDeviceToken(deviceToken)) {
      return jsonResponse(req, { error: 'Invalid deviceId or deviceToken.' }, 400);
    }

    const allowed = await enforceRateLimit(supabase, `schedule_test:${deviceId}`, 60, 10);
    if (!allowed) {
      return jsonResponse(
        req,
        { error: 'Rate limit exceeded for test scheduling (max 10 per minute).' },
        429
      );
    }

    const { data: dev } = await supabase
      .from('devices')
      .select('id, device_token_hash')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (!dev || !(await verifyDeviceOwnership(dev.device_token_hash, deviceToken))) {
      return jsonResponse(req, { error: 'Unauthorized device token.' }, 403);
    }

    // Handle cancellation
    if (body.action === 'cancel') {
      const { data: cancelledJobs } = await supabase
        .from('push_test_jobs')
        .update({ status: 'cancelled' })
        .eq('device_uuid', dev.id)
        .eq('status', 'pending')
        .select('id, scheduled_at, status');

      return jsonResponse(req, {
        ok: true,
        cancelled: Boolean(cancelledJobs && cancelledJobs.length > 0),
        message: 'Pending background test push cancelled.',
      });
    }

    // Check active push subscription
    const { data: sub } = await supabase
      .from('push_subscriptions')
      .select('id, status')
      .eq('device_uuid', dev.id)
      .maybeSingle();

    if (!sub || sub.status !== 'active') {
      return jsonResponse(
        req,
        {
          error:
            sub?.status === 'disabled'
              ? 'Notifications are disabled on this device. Tap Enable Prayer Notifications first.'
              : sub?.status === 'expired'
              ? 'Subscription has expired. Tap Enable / Renew Subscription first.'
              : 'No active push subscription found. Tap Enable Prayer Notifications first.',
        },
        409
      );
    }

    // Validate VAPID configuration
    const vapid = getValidatedVapidConfig();
    if (!vapid.configured) {
      return jsonResponse(
        req,
        {
          ok: false,
          error: vapid.errorMessage ?? 'VAPID keys must be configured on the server.',
          setupInstructions: vapid.setupInstructions,
        },
        503
      );
    }

    // Validate delay (default 2 minutes, bounds 1 to 15 minutes)
    let delayMinutes = 2;
    if (typeof body.delayMinutes === 'number' && Number.isFinite(body.delayMinutes)) {
      delayMinutes = Math.min(15, Math.max(1, Math.round(body.delayMinutes)));
    } else if (typeof body.scheduledAtIso === 'string') {
      const targetTime = new Date(body.scheduledAtIso).getTime();
      const diffMs = targetTime - Date.now();
      if (Number.isNaN(targetTime) || diffMs < 30_000 || diffMs > 16 * 60_000) {
        return jsonResponse(
          req,
          { error: 'Scheduled time must be between 1 and 15 minutes in the future.' },
          400
        );
      }
      delayMinutes = Math.max(1, Math.round(diffMs / 60_000));
    }

    const scheduledAt = new Date(Date.now() + delayMinutes * 60_000).toISOString();

    // Cancel any previous pending jobs for this device
    await supabase
      .from('push_test_jobs')
      .update({ status: 'cancelled' })
      .eq('device_uuid', dev.id)
      .eq('status', 'pending');

    const { data: job, error: insertErr } = await supabase
      .from('push_test_jobs')
      .insert({
        device_uuid: dev.id,
        scheduled_at: scheduledAt,
        status: 'pending',
        attempts: 0,
      })
      .select('id, scheduled_at, status, created_at')
      .single();

    if (insertErr || !job) {
      return jsonResponse(
        req,
        { error: insertErr?.message ?? 'Failed to schedule background test job.' },
        500
      );
    }

    return jsonResponse(req, {
      ok: true,
      job: {
        id: job.id,
        deviceId,
        status: job.status,
        scheduledAt: job.scheduled_at,
        delayMinutes,
        createdAt: job.created_at,
      },
    });
  } catch (err) {
    console.error('[schedule-test-push] Unhandled error:', err instanceof Error ? err.message : String(err));
    return jsonResponse(
      req,
      { ok: false, error: 'Internal server error while scheduling background test push.' },
      500
    );
  }
});
