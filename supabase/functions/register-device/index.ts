import {
  buildSubscriptionSummary,
  enforceRateLimit,
  getColomboNowParts,
  getCorsHeaders,
  getSupabaseAdmin,
  getValidatedVapidConfig,
  hashDeviceToken,
  isValidBase64Key,
  isValidDeviceId,
  isValidDeviceToken,
  jsonResponse,
  resolveDistrictAndZone,
  VALID_ADVANCE_MINUTES,
  validatePushEndpoint,
  verifyDeviceOwnership,
} from '../_shared/security.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }

  try {
    const supabase = getSupabaseAdmin();
    const url = new URL(req.url);
    const action = url.searchParams.get('action') ?? '';

  if (req.method === 'GET') {
    if (action === 'vapid-public-key') {
      const vapid = getValidatedVapidConfig();
      if (!vapid.configured || !vapid.publicKey) {
        return jsonResponse(
          req,
          {
            configured: false,
            status: vapid.status,
            publicKey: null,
            subject: vapid.subject,
            error: vapid.errorMessage,
            setupInstructions: vapid.setupInstructions,
          },
          503
        );
      }
      return jsonResponse(req, {
        configured: true,
        status: vapid.status,
        publicKey: vapid.publicKey,
        subject: vapid.subject,
        configuredViaEnv: true,
      });
    }

    const deviceId = url.searchParams.get('deviceId');
    const token = req.headers.get('x-device-token');

    if (action === 'diagnostics') {
      const vapid = getValidatedVapidConfig();
      const colombo = getColomboNowParts();

      let subscription: Record<string, unknown> | null = null;
      let recentDeliveries: Array<Record<string, unknown>> = [];
      let recentLogs: Array<Record<string, unknown>> = [];

      if (isValidDeviceId(deviceId)) {
        const { data: dev } = await supabase
          .from('devices')
          .select('id, device_token_hash')
          .eq('device_id', deviceId)
          .maybeSingle();

        if (dev) {
          if (!(await verifyDeviceOwnership(dev.device_token_hash, token))) {
            return jsonResponse(req, { error: 'Unauthorized device token.' }, 403);
          }
          subscription = await buildSubscriptionSummary(supabase, deviceId);

          const { data: notifLogs } = await supabase
            .from('notification_logs')
            .select('*')
            .eq('device_uuid', dev.id)
            .order('updated_at', { ascending: false })
            .limit(15);

          recentDeliveries = (notifLogs ?? []).map((row) => ({
            id: row.id,
            eventKey: row.idempotency_key,
            prayer: row.prayer_name,
            prayerTimeHHMM: row.prayer_time_hhmm,
            advanceMinutes: row.reminder_offset_min,
            dateISO: row.prayer_date,
            status: row.status,
            attemptCount: row.attempt_count,
            httpStatus: row.http_status,
            errorMessage: row.error_message,
            updatedAt: row.updated_at,
          }));
        }
      }

      const { data: schedRows } = await supabase
        .from('scheduler_logs')
        .select('*')
        .order('run_at', { ascending: false })
        .limit(15);

      recentLogs = (schedRows ?? []).map((row, i) => ({
        id: i + 1,
        level: row.failed_count > 0 ? 'error' : row.expired_count > 0 ? 'warn' : 'info',
        category: 'pg_cron_scheduler',
        deviceId: null,
        message: `Run ${row.colombo_date} ${row.colombo_time}: checked=${row.checked_subscriptions}, due=${row.due_count}, sent=${row.sent_count}, failed=${row.failed_count}, expired=${row.expired_count}`,
        meta: row.details ?? null,
        createdAt: row.run_at,
      }));

      const { count: activeCount } = await supabase
        .from('push_subscriptions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');
      const { count: totalSubsCount } = await supabase
        .from('push_subscriptions')
        .select('*', { count: 'exact', head: true });
      const { count: expiredSubsCount } = await supabase
        .from('push_subscriptions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'expired');
      const { count: totalDelivCount } = await supabase
        .from('notification_logs')
        .select('*', { count: 'exact', head: true });
      const { count: sentDelivCount } = await supabase
        .from('notification_logs')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'sent');

      const latestRun = schedRows?.[0] ?? null;

      return jsonResponse(req, {
        ok: true,
        backendMode: 'supabase',
        colomboDate: colombo.dateISO,
        colomboTime: colombo.formattedTime,
        databasePath: 'Supabase PostgreSQL (pg_cron + pg_net)',
        migrations: [
          { version: '20261127000001_initial_adhan_push_schema.sql', appliedAt: colombo.dateISO },
          { version: '20261127000002_pg_cron_scheduler.sql', appliedAt: colombo.dateISO },
        ],
        stats: {
          activeSubscriptions: activeCount ?? 0,
          totalSubscriptions: totalSubsCount ?? 0,
          totalDeliveries: totalDelivCount ?? 0,
          sentDeliveries: sentDelivCount ?? 0,
          expiredSubscriptions: expiredSubsCount ?? 0,
        },
        scheduler: {
          running: true,
          intervalMs: 60_000,
          graceWindowMs: 300_000,
          ttlSeconds: 300,
          lastTickAt: latestRun?.run_at ?? null,
          lastTickSummary: latestRun
            ? {
                checkedSubscriptions: latestRun.checked_subscriptions,
                attempted: latestRun.due_count,
                sent: latestRun.sent_count,
                retried: latestRun.failed_count,
                expired: latestRun.expired_count,
              }
            : null,
        },
        vapid: {
          configured: vapid.configured,
          status: vapid.status,
          publicKeyPreview: vapid.publicKey ? `${vapid.publicKey.slice(0, 16)}…` : null,
          configuredViaEnv: vapid.configured,
          subject: vapid.subject,
          errorMessage: vapid.errorMessage,
          setupInstructions: vapid.setupInstructions,
        },
        subscription,
        recentDeliveries,
        recentLogs,
      });
    }

    // Default GET or ?action=status
    if (!isValidDeviceId(deviceId)) {
      return jsonResponse(req, { error: 'Missing or invalid deviceId query parameter.' }, 400);
    }

    const { data: dev } = await supabase
      .from('devices')
      .select('id, device_token_hash')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (!dev) {
      return jsonResponse(req, { exists: false, subscription: null, recentDeliveries: [] });
    }
    if (!(await verifyDeviceOwnership(dev.device_token_hash, token))) {
      return jsonResponse(req, { error: 'Unauthorized device token.' }, 403);
    }

    await supabase
      .from('push_subscriptions')
      .update({ last_verified_at: new Date().toISOString() })
      .eq('device_uuid', dev.id);

    const summary = await buildSubscriptionSummary(supabase, deviceId);
    const { data: notifLogs } = await supabase
      .from('notification_logs')
      .select('*')
      .eq('device_uuid', dev.id)
      .order('updated_at', { ascending: false })
      .limit(10);

    return jsonResponse(req, {
      exists: Boolean(summary),
      subscription: summary,
      recentDeliveries: (notifLogs ?? []).map((row) => ({
        id: row.id,
        eventKey: row.idempotency_key,
        prayer: row.prayer_name,
        prayerTimeHHMM: row.prayer_time_hhmm,
        advanceMinutes: row.reminder_offset_min,
        dateISO: row.prayer_date,
        status: row.status,
        attemptCount: row.attempt_count,
        httpStatus: row.http_status,
        errorMessage: row.error_message,
        updatedAt: row.updated_at,
      })),
    });
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

  const allowed = await enforceRateLimit(supabase, `register:${deviceId}`, 60, 30);
  if (!allowed) {
    return jsonResponse(req, { error: 'Too many requests. Please wait a moment and try again.' }, 429);
  }

  if (req.method === 'DELETE' || body.action === 'delete') {
    const { data: dev } = await supabase
      .from('devices')
      .select('id, device_token_hash')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (!dev) return jsonResponse(req, { ok: true, deleted: false });
    if (!(await verifyDeviceOwnership(dev.device_token_hash, deviceToken))) {
      return jsonResponse(req, { error: 'Unauthorized device token.' }, 403);
    }
    await supabase.from('devices').delete().eq('id', dev.id);
    return jsonResponse(req, { ok: true, deleted: true });
  }

  if (req.method === 'POST' && body.action === 'unsubscribe') {
    const { data: dev } = await supabase
      .from('devices')
      .select('id, device_token_hash')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (!dev) {
      return jsonResponse(req, { ok: true, status: 'disabled', subscription: null });
    }
    if (!(await verifyDeviceOwnership(dev.device_token_hash, deviceToken))) {
      return jsonResponse(req, { error: 'Unauthorized device token.' }, 403);
    }
    await supabase
      .from('push_subscriptions')
      .update({ status: 'disabled' })
      .eq('device_uuid', dev.id);

    const summary = await buildSubscriptionSummary(supabase, deviceId);
    return jsonResponse(req, { ok: true, subscription: summary });
  }

  if (req.method === 'POST' && body.action === 'verify-click') {
    const { data: dev } = await supabase
      .from('devices')
      .select('id, device_token_hash')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (!dev || !(await verifyDeviceOwnership(dev.device_token_hash, deviceToken))) {
      return jsonResponse(req, { error: 'Unauthorized device token.' }, 403);
    }

    const nowIso = new Date().toISOString();
    await supabase
      .from('push_subscriptions')
      .update({ last_click_verified_at: nowIso })
      .eq('device_uuid', dev.id);

    return jsonResponse(req, { ok: true, lastClickVerifiedAt: nowIso });
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
        error: vapid.errorMessage ?? 'VAPID keys are not configured on Supabase.',
        setupInstructions: vapid.setupInstructions,
      },
      503
    );
  }

  const subObj = body.subscription as Record<string, unknown> | undefined;
  const keysObj = subObj?.keys as Record<string, unknown> | undefined;
  const endpointCheck = validatePushEndpoint(subObj?.endpoint);
  if (!endpointCheck.ok) {
    return jsonResponse(req, { error: endpointCheck.error }, 400);
  }

  if (!isValidBase64Key(keysObj?.p256dh, 20) || !isValidBase64Key(keysObj?.auth, 12)) {
    return jsonResponse(req, { error: 'Invalid Web Push encryption keys (p256dh / auth).' }, 400);
  }

  const { data: existingDev } = await supabase
    .from('devices')
    .select('id, device_token_hash')
    .eq('device_id', deviceId)
    .maybeSingle();

  if (existingDev && !(await verifyDeviceOwnership(existingDev.device_token_hash, deviceToken))) {
    return jsonResponse(req, { error: 'Device ownership verification failed.' }, 403);
  }

  const tokenHash = await hashDeviceToken(deviceToken);
  const { districtId, zoneId } = resolveDistrictAndZone(body.districtId);
  const userAgent = req.headers.get('user-agent')?.slice(0, 250) ?? null;
  const nowIso = new Date().toISOString();

  const { data: upsertedDev, error: devErr } = await supabase
    .from('devices')
    .upsert(
      {
        device_id: deviceId,
        device_token_hash: tokenHash,
        district_id: districtId,
        zone_id: zoneId,
        timezone: 'Asia/Colombo',
        user_agent: userAgent,
        last_seen_at: nowIso,
      },
      { onConflict: 'device_id' }
    )
    .select('id')
    .single();

  if (devErr || !upsertedDev) {
    return jsonResponse(req, { error: devErr?.message ?? 'Failed to persist device.' }, 500);
  }

  // Remove stale endpoint owned by an old device row before upserting
  await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpointCheck.url)
    .neq('device_uuid', upsertedDev.id);

  const { error: subErr } = await supabase.from('push_subscriptions').upsert(
    {
      device_uuid: upsertedDev.id,
      endpoint: endpointCheck.url,
      p256dh_key: String(keysObj.p256dh),
      auth_key: String(keysObj.auth),
      status: 'active',
      failure_count: 0,
      last_registered_at: nowIso,
      last_verified_at: nowIso,
      last_delivery_error: null,
    },
    { onConflict: 'device_uuid' }
  );

  if (subErr) {
    return jsonResponse(req, { error: subErr.message }, 500);
  }

  const perPrayer = (body.perPrayerEnabled as Record<string, unknown> | undefined) ?? {};
  const adv = (body.advanceMinutes as Record<string, unknown> | undefined) ?? {};
  const offsetOrZero = (val: unknown) => (VALID_ADVANCE_MINUTES.has(Number(val)) ? Number(val) : 0);

  const { error: prefErr } = await supabase.from('notification_preferences').upsert(
    {
      device_uuid: upsertedDev.id,
      fajr_enabled: typeof perPrayer.fajr === 'boolean' ? perPrayer.fajr : true,
      dhuhr_enabled: typeof perPrayer.dhuhr === 'boolean' ? perPrayer.dhuhr : true,
      asr_enabled: typeof perPrayer.asr === 'boolean' ? perPrayer.asr : true,
      maghrib_enabled: typeof perPrayer.maghrib === 'boolean' ? perPrayer.maghrib : true,
      isha_enabled: typeof perPrayer.isha === 'boolean' ? perPrayer.isha : true,
      fajr_offset_min: offsetOrZero(adv.fajr),
      dhuhr_offset_min: offsetOrZero(adv.dhuhr),
      asr_offset_min: offsetOrZero(adv.asr),
      maghrib_offset_min: offsetOrZero(adv.maghrib),
      isha_offset_min: offsetOrZero(adv.isha),
    },
    { onConflict: 'device_uuid' }
  );

  if (prefErr) {
    return jsonResponse(req, { error: prefErr.message }, 500);
  }

    const summary = await buildSubscriptionSummary(supabase, deviceId);
    return jsonResponse(req, {
      ok: true,
      verified: true,
      subscription: summary,
    });
  } catch (err) {
    console.error('[register-device] Unhandled error:', err instanceof Error ? err.message : String(err));
    return jsonResponse(
      req,
      {
        ok: false,
        error: 'Internal server error while processing device push request.',
      },
      500
    );
  }
});
