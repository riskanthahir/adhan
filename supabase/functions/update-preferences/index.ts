import {
  buildSubscriptionSummary,
  enforceRateLimit,
  getCorsHeaders,
  getSupabaseAdmin,
  isValidDeviceId,
  isValidDeviceToken,
  jsonResponse,
  resolveDistrictAndZone,
  VALID_ADVANCE_MINUTES,
  verifyDeviceOwnership,
} from '../_shared/security.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }

  if (req.method !== 'PATCH' && req.method !== 'POST') {
    return jsonResponse(req, { error: 'Method not allowed.' }, 405);
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
  const allowed = await enforceRateLimit(supabase, `prefs:${deviceId}`, 60, 40);
  if (!allowed) {
    return jsonResponse(req, { error: 'Too many preference updates. Please wait briefly.' }, 429);
  }

  const { data: dev } = await supabase
    .from('devices')
    .select('*')
    .eq('device_id', deviceId)
    .maybeSingle();

  if (!dev) {
    return jsonResponse(req, { error: 'Device not registered yet.' }, 404);
  }
  if (!(await verifyDeviceOwnership(dev.device_token_hash, deviceToken))) {
    return jsonResponse(req, { error: 'Unauthorized device token.' }, 403);
  }

  const { districtId, zoneId } = resolveDistrictAndZone(body.districtId ?? dev.district_id);
  const nowIso = new Date().toISOString();

  await supabase
    .from('devices')
    .update({ district_id: districtId, zone_id: zoneId, last_seen_at: nowIso })
    .eq('id', dev.id);

  const { data: existingPrefs } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('device_uuid', dev.id)
    .maybeSingle();

  const perPrayer = (body.perPrayerEnabled as Record<string, unknown> | undefined) ?? {};
  const adv = (body.advanceMinutes as Record<string, unknown> | undefined) ?? {};
  const pickOffset = (val: unknown, fallback: number) =>
    VALID_ADVANCE_MINUTES.has(Number(val)) ? Number(val) : fallback;

  await supabase.from('notification_preferences').upsert(
    {
      device_uuid: dev.id,
      fajr_enabled: typeof perPrayer.fajr === 'boolean' ? perPrayer.fajr : existingPrefs?.fajr_enabled ?? true,
      dhuhr_enabled: typeof perPrayer.dhuhr === 'boolean' ? perPrayer.dhuhr : existingPrefs?.dhuhr_enabled ?? true,
      asr_enabled: typeof perPrayer.asr === 'boolean' ? perPrayer.asr : existingPrefs?.asr_enabled ?? true,
      maghrib_enabled: typeof perPrayer.maghrib === 'boolean' ? perPrayer.maghrib : existingPrefs?.maghrib_enabled ?? true,
      isha_enabled: typeof perPrayer.isha === 'boolean' ? perPrayer.isha : existingPrefs?.isha_enabled ?? true,
      fajr_offset_min: pickOffset(adv.fajr, existingPrefs?.fajr_offset_min ?? 0),
      dhuhr_offset_min: pickOffset(adv.dhuhr, existingPrefs?.dhuhr_offset_min ?? 0),
      asr_offset_min: pickOffset(adv.asr, existingPrefs?.asr_offset_min ?? 0),
      maghrib_offset_min: pickOffset(adv.maghrib, existingPrefs?.maghrib_offset_min ?? 0),
      isha_offset_min: pickOffset(adv.isha, existingPrefs?.isha_offset_min ?? 0),
    },
    { onConflict: 'device_uuid' }
  );

  await supabase
    .from('push_subscriptions')
    .update({ last_verified_at: nowIso })
    .eq('device_uuid', dev.id);

  const summary = await buildSubscriptionSummary(supabase, deviceId);
  return jsonResponse(req, { ok: true, subscription: summary });
});
