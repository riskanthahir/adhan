import {
  buildSubscriptionSummary,
  enforceRateLimit,
  getCorsHeaders,
  getSupabaseAdmin,
  isValidDeviceId,
  isValidDeviceToken,
  jsonResponse,
  verifyCronSecret,
  verifyDeviceOwnership,
} from '../_shared/security.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }

  if (req.method !== 'POST') {
    return jsonResponse(req, { error: 'Method not allowed.' }, 405);
  }

  try {
    const supabase = getSupabaseAdmin();
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  // Diagnostic endpoint for simulating 410 Gone expiration safely for one owned device
  if (body.action === 'simulate-410') {
    const deviceId = body.deviceId;
    const deviceToken = req.headers.get('x-device-token') ?? (typeof body.deviceToken === 'string' ? body.deviceToken : null);
    if (!isValidDeviceId(deviceId) || !isValidDeviceToken(deviceToken)) {
      return jsonResponse(req, { error: 'Invalid deviceId or deviceToken.' }, 400);
    }

    const allowed = await enforceRateLimit(supabase, `cleanup_diag:${deviceId}`, 60, 10);
    if (!allowed) {
      return jsonResponse(req, { error: 'Too many diagnostic calls.' }, 429);
    }

    const { data: dev } = await supabase
      .from('devices')
      .select('id, device_token_hash')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (!dev || !(await verifyDeviceOwnership(dev.device_token_hash, deviceToken))) {
      return jsonResponse(req, { error: 'Unauthorized device token.' }, 403);
    }

    await supabase
      .from('push_subscriptions')
      .update({
        status: 'expired',
        last_delivery_attempt_at: new Date().toISOString(),
        last_delivery_error: 'Simulated 410 Gone expiration check — subscription flagged for renewal.',
      })
      .eq('device_uuid', dev.id);

    return jsonResponse(req, {
      ok: true,
      subscription: await buildSubscriptionSummary(supabase, deviceId),
    });
  }

  // Scheduled cron cleanup path
  if (!verifyCronSecret(req)) {
    return jsonResponse(req, { error: 'Unauthorized cron cleanup request.' }, 401);
  }

  const cutoff30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const cutoff24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Flag subscriptions with repeated failures (>= 10) as invalid
  const { data: flaggedRows } = await supabase
    .from('push_subscriptions')
    .update({ status: 'invalid' })
    .eq('status', 'active')
    .gte('failure_count', 10)
    .select('id');

  // Remove old expired/invalid subscriptions older than 30 days
  const { data: deletedRows } = await supabase
    .from('push_subscriptions')
    .delete()
    .in('status', ['expired', 'invalid'])
    .lt('updated_at', cutoff30Days)
    .select('id');

  // Prune old rate-limit buckets
  await supabase.from('edge_rate_limits').delete().lt('updated_at', cutoff24Hours);

    return jsonResponse(req, {
      ok: true,
      flaggedInvalidCount: flaggedRows?.length ?? 0,
      purgedExpiredCount: deletedRows?.length ?? 0,
      cleanedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[cleanup-subscriptions] Unhandled error:', err instanceof Error ? err.message : String(err));
    return jsonResponse(req, { ok: false, error: 'Failed to run subscription cleanup.' }, 500);
  }
});
