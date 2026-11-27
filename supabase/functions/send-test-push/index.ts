import {
  buildSubscriptionSummary,
  enforceRateLimit,
  getColomboNowParts,
  getCorsHeaders,
  getSupabaseAdmin,
  getValidatedVapidConfig,
  isValidDeviceId,
  isValidDeviceToken,
  jsonResponse,
  resolveDistrictAndZone,
  sendEncryptedPush,
  verifyDeviceOwnership,
} from '../_shared/security.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }

  if (req.method !== 'POST') {
    return jsonResponse(req, { error: 'Method not allowed.' }, 405);
  }

  const vapid = getValidatedVapidConfig();
  if (!vapid.configured) {
    return jsonResponse(
      req,
      {
        ok: false,
        status: vapid.status,
        error: vapid.errorMessage ?? 'VAPID secrets are not configured.',
        setupInstructions: vapid.setupInstructions,
      },
      503
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse(req, { error: 'Invalid JSON request body.' }, 400);
  }

  const deviceId = body.deviceId;
  const deviceToken = req.headers.get('x-device-token') ?? (typeof body.deviceToken === 'string' ? body.deviceToken : null);

  if (!isValidDeviceId(deviceId) || !isValidDeviceToken(deviceToken)) {
    return jsonResponse(req, { error: 'Invalid deviceId or deviceToken.' }, 400);
  }

  const supabase = getSupabaseAdmin();
  const allowed = await enforceRateLimit(supabase, `test_push:${deviceId}`, 300, 12);
  if (!allowed) {
    return jsonResponse(req, { error: 'Rate limit exceeded for test notifications (max 12 per 5 minutes).' }, 429);
  }

  const { data: dev } = await supabase
    .from('devices')
    .select('*')
    .eq('device_id', deviceId)
    .maybeSingle();

  if (!dev) {
    return jsonResponse(req, { error: 'Device not registered. Enable Prayer Notifications first.' }, 404);
  }
  if (!(await verifyDeviceOwnership(dev.device_token_hash, deviceToken))) {
    return jsonResponse(req, { error: 'Unauthorized device token.' }, 403);
  }

  const { data: sub } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('device_uuid', dev.id)
    .maybeSingle();

  if (!sub) {
    return jsonResponse(req, { error: 'No push subscription saved for this device.' }, 404);
  }
  if (sub.status !== 'active') {
    return jsonResponse(req, { error: `Subscription status is "${sub.status}". Re-enable notifications to renew.` }, 409);
  }

  const summaryBefore = await buildSubscriptionSummary(supabase, deviceId);
  const nextPrayer = summaryBefore?.nextScheduledPrayer as { label?: string; timeHHMM?: string } | null;
  const zoneInfo = resolveDistrictAndZone(dev.district_id);
  const colombo = getColomboNowParts();
  const idempotencyKey = `${deviceId}:test:${Date.now()}`;
  const nextLine = nextPrayer?.label
    ? `Next prayer: ${nextPrayer.label} at ${nextPrayer.timeHHMM}`
    : 'ACJU timetable synced';

  const result = await sendEncryptedPush({
    endpoint: sub.endpoint,
    p256dhKey: sub.p256dh_key,
    authKey: sub.auth_key,
    ttlSeconds: 120,
    topic: 'my-adhan-test',
    payload: {
      title: 'My Adhan · Background Push Active',
      body: `${zoneInfo.districtName} (${zoneInfo.zoneName}) — ${nextLine}`,
      prayer: 'test',
      prayerTimeHHMM: colombo.formattedTime.slice(0, 5),
      dateISO: colombo.dateISO,
      zoneId: zoneInfo.zoneId,
      zoneName: zoneInfo.zoneName,
      eventKey: idempotencyKey,
      url: `/?fromPush=1&prayer=test&eventKey=${encodeURIComponent(idempotencyKey)}`,
      sentAt: new Date().toISOString(),
      isTest: true,
    },
  });

  const nowIso = new Date().toISOString();
  await supabase.from('notification_logs').insert({
    device_uuid: dev.id,
    subscription_id: sub.id,
    idempotency_key: idempotencyKey,
    prayer_date: colombo.dateISO,
    prayer_name: 'test',
    prayer_time_hhmm: colombo.formattedTime.slice(0, 5),
    reminder_offset_min: 0,
    scheduled_for_utc: nowIso,
    status: result.ok ? 'sent' : result.expired ? 'expired' : 'failed',
    attempt_count: 1,
    http_status: result.statusCode,
    error_message: result.error,
  });

  if (result.ok) {
    await supabase
      .from('push_subscriptions')
      .update({
        last_delivery_attempt_at: nowIso,
        last_delivery_success_at: nowIso,
        last_delivery_error: null,
        failure_count: 0,
      })
      .eq('id', sub.id);

    return jsonResponse(req, {
      ok: true,
      statusCode: result.statusCode,
      eventKey: idempotencyKey,
      testedAt: nowIso,
      subscription: await buildSubscriptionSummary(supabase, deviceId),
    });
  }

  await supabase
    .from('push_subscriptions')
    .update({
      status: result.expired ? 'expired' : sub.status,
      last_delivery_attempt_at: nowIso,
      last_delivery_error: result.error,
      failure_count: (sub.failure_count ?? 0) + 1,
    })
    .eq('id', sub.id);

  return jsonResponse(
    req,
    {
      ok: false,
      statusCode: result.statusCode,
      expired: result.expired,
      error: result.error ?? 'Failed to deliver test notification.',
      subscription: await buildSubscriptionSummary(supabase, deviceId),
    },
    result.expired ? 410 : 502
  );
});
