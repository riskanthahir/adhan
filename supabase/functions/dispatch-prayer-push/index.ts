import {
  colomboDateTimeToEpochMs,
  formatTime12h,
  getColomboNowParts,
  getCorsHeaders,
  getSupabaseAdmin,
  getValidatedVapidConfig,
  jsonResponse,
  PRAYER_LABELS,
  PRAYER_NAMES,
  resolveDistrictAndZone,
  sendEncryptedPush,
  shiftColomboDateISO,
  verifyCronSecret,
} from '../_shared/security.ts';

const DELIVERY_GRACE_WINDOW_MS = 5 * 60 * 1000;
const PUSH_TTL_SECONDS = 300;
const MAX_TRANSIENT_ATTEMPTS = 3;

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
  const now = new Date();
  const nowMs = now.getTime();
  const colombo = getColomboNowParts(now);
  const candidateDates = [
    shiftColomboDateISO(colombo.dateISO, -1),
    colombo.dateISO,
    shiftColomboDateISO(colombo.dateISO, 1),
  ];

  const vapid = getValidatedVapidConfig();
  if (!vapid.configured) {
    await supabase.from('scheduler_logs').insert({
      colombo_date: colombo.dateISO,
      colombo_time: colombo.formattedTime,
      status: 'vapid_missing',
      details: { error: vapid.errorMessage, vapidStatus: vapid.status },
    });
    return jsonResponse(req, { ok: false, error: vapid.errorMessage }, 503);
  }

  // 1. Load active push subscriptions joined with device and preferences
  const { data: subs, error: subErr } = await supabase
    .from('push_subscriptions')
    .select(`
      id, endpoint, p256dh_key, auth_key, status, failure_count,
      devices!inner (
        id, device_id, district_id, zone_id, timezone,
        notification_preferences (
          fajr_enabled, dhuhr_enabled, asr_enabled, maghrib_enabled, isha_enabled,
          fajr_offset_min, dhuhr_offset_min, asr_offset_min, maghrib_offset_min, isha_offset_min
        )
      )
    `)
    .eq('status', 'active');

  if (subErr) {
    await supabase.from('scheduler_logs').insert({
      colombo_date: colombo.dateISO,
      colombo_time: colombo.formattedTime,
      status: 'error',
      details: { error: subErr.message },
    });
    return jsonResponse(req, { error: subErr.message }, 500);
  }

  // 2. Load ACJU prayer_times rows for candidate Colombo dates
  const { data: prayerRows, error: ptErr } = await supabase
    .from('prayer_times')
    .select('*')
    .in('prayer_date', candidateDates);

  if (ptErr) {
    await supabase.from('scheduler_logs').insert({
      colombo_date: colombo.dateISO,
      colombo_time: colombo.formattedTime,
      status: 'error',
      details: { error: ptErr.message },
    });
    return jsonResponse(req, { error: ptErr.message }, 500);
  }

  const scheduleByDistrictAndDate = new Map<string, Record<string, unknown>>();
  for (const row of prayerRows ?? []) {
    scheduleByDistrictAndDate.set(`${row.district_id}::${row.prayer_date}`, row);
  }

  let dueCount = 0;
  let sentCount = 0;
  let failedCount = 0;
  let expiredCount = 0;

  for (const sub of subs ?? []) {
    const dev = Array.isArray(sub.devices) ? sub.devices[0] : sub.devices;
    if (!dev) continue;

    const rawPrefs = Array.isArray(dev.notification_preferences)
      ? dev.notification_preferences[0]
      : dev.notification_preferences;
    const zoneInfo = resolveDistrictAndZone(dev.district_id);
    let stopThisSub = false;

    for (const dateISO of candidateDates) {
      if (stopThisSub) break;
      const dayRow = scheduleByDistrictAndDate.get(`${dev.district_id}::${dateISO}`);
      if (!dayRow) continue;

      for (const prayer of PRAYER_NAMES) {
        const enabled = rawPrefs ? Boolean(rawPrefs[`${prayer}_enabled`]) : true;
        if (!enabled) continue;

        const offsetMin = rawPrefs ? Number(rawPrefs[`${prayer}_offset_min`] ?? 0) : 0;
        const prayerHHMM = String(dayRow[prayer]);
        const prayerEpochMs = colomboDateTimeToEpochMs(dateISO, prayerHHMM);
        const triggerAtEpochMs = prayerEpochMs - offsetMin * 60_000;
        const elapsedMs = nowMs - triggerAtEpochMs;

        if (elapsedMs < 0 || elapsedMs > DELIVERY_GRACE_WINDOW_MS) {
          continue;
        }

        // Exact idempotency key: device_id + prayer_date + prayer_name + reminder_offset
        const idempotencyKey = `${dev.device_id}:${dateISO}:${prayer}:${offsetMin}`;

        const { data: existingLog } = await supabase
          .from('notification_logs')
          .select('*')
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle();

        if (existingLog) {
          if (existingLog.status === 'sent' || existingLog.status === 'expired') continue;
          if (existingLog.attempt_count >= MAX_TRANSIENT_ATTEMPTS) continue;
          const lastAttemptMs = new Date(existingLog.updated_at).getTime();
          if (nowMs - lastAttemptMs < 30_000 * existingLog.attempt_count) continue;
        }

        dueCount += 1;
        const label = PRAYER_LABELS[prayer];
        const formatted12 = formatTime12h(prayerHHMM);
        const title =
          offsetMin > 0
            ? `${label} in ${offsetMin} min · ${formatted12}`
            : `${label} Prayer Time · ${formatted12}`;
        const bodyText = `${zoneInfo.districtName} (${zoneInfo.zoneName}) · ACJU Sri Lanka`;

        const res = await sendEncryptedPush({
          endpoint: sub.endpoint,
          p256dhKey: sub.p256dh_key,
          authKey: sub.auth_key,
          ttlSeconds: PUSH_TTL_SECONDS,
          topic: `adhan-${prayer}`,
          payload: {
            title,
            body: bodyText,
            prayer,
            prayerTimeHHMM: prayerHHMM,
            advanceMinutes: offsetMin,
            dateISO,
            zoneId: zoneInfo.zoneId,
            zoneName: zoneInfo.zoneName,
            eventKey: idempotencyKey,
            url: `/?fromPush=1&prayer=${encodeURIComponent(prayer)}&eventKey=${encodeURIComponent(idempotencyKey)}`,
            sentAt: now.toISOString(),
          },
        });

        const nextAttempts = (existingLog?.attempt_count ?? 0) + 1;
        const nextStatus = res.ok
          ? 'sent'
          : res.expired
          ? 'expired'
          : nextAttempts >= MAX_TRANSIENT_ATTEMPTS
          ? 'failed'
          : 'retrying';

        await supabase.from('notification_logs').upsert(
          {
            device_uuid: dev.id,
            subscription_id: sub.id,
            idempotency_key: idempotencyKey,
            prayer_date: dateISO,
            prayer_name: prayer,
            prayer_time_hhmm: prayerHHMM,
            reminder_offset_min: offsetMin,
            scheduled_for_utc: new Date(triggerAtEpochMs).toISOString(),
            status: nextStatus,
            attempt_count: nextAttempts,
            http_status: res.statusCode,
            error_message: res.error,
          },
          { onConflict: 'idempotency_key' }
        );

        const attemptIso = new Date().toISOString();
        if (res.ok) {
          sentCount += 1;
          await supabase
            .from('push_subscriptions')
            .update({
              last_delivery_attempt_at: attemptIso,
              last_delivery_success_at: attemptIso,
              last_delivery_error: null,
              failure_count: 0,
            })
            .eq('id', sub.id);
        } else if (res.expired) {
          expiredCount += 1;
          await supabase
            .from('push_subscriptions')
            .update({
              status: 'expired',
              last_delivery_attempt_at: attemptIso,
              last_delivery_error: res.error ?? 'HTTP 410 Gone',
              failure_count: (sub.failure_count ?? 0) + 1,
            })
            .eq('id', sub.id);
          stopThisSub = true;
        } else {
          failedCount += 1;
          await supabase
            .from('push_subscriptions')
            .update({
              last_delivery_attempt_at: attemptIso,
              last_delivery_error: res.error,
              failure_count: (sub.failure_count ?? 0) + 1,
            })
            .eq('id', sub.id);
        }
      }
    }
  }

  await supabase.from('scheduler_logs').insert({
    colombo_date: colombo.dateISO,
    colombo_time: colombo.formattedTime,
    checked_subscriptions: subs?.length ?? 0,
    due_count: dueCount,
    sent_count: sentCount,
    failed_count: failedCount,
    expired_count: expiredCount,
    status: 'ok',
    details: { candidateDates, ttlSeconds: PUSH_TTL_SECONDS },
  });

    return jsonResponse(req, {
      ok: true,
      colomboDate: colombo.dateISO,
      colomboTime: colombo.formattedTime,
      checkedSubscriptions: subs?.length ?? 0,
      dueCount,
      sentCount,
      failedCount,
      expiredCount,
    });
  } catch (err) {
    console.error('[dispatch-prayer-push] Unhandled error:', err instanceof Error ? err.message : String(err));
    return jsonResponse(req, { ok: false, error: 'Internal scheduler dispatch error.' }, 500);
  }
});
