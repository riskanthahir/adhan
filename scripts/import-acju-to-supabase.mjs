#!/usr/bin/env node
/**
 * Safely imports / synchronizes ACJU district JSON files (`data/acju-2026/*.json`)
 * into Supabase PostgreSQL `prayer_times` table via @supabase/supabase-js using
 * server-side SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 * - Never invents missing dates (Feb 29 skipped cleanly for future years).
 * - Preserves exact published ACJU timings (Fajr < Sunrise < Dhuhr < Asr < Maghrib < Isha).
 * - Uses idempotent upsert on `(district_id, prayer_date)`.
 *
 * Usage:
 *   npm run supabase:sync-prayers
 *   node scripts/import-acju-to-supabase.mjs --years=2026,2027,2028
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const JSON_DIR = path.resolve(process.cwd(), 'data', 'acju-2026');
const BATCH_SIZE = 500;

function parseTimeToMins(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function validateRecordChronology(districtId, rec) {
  const order = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const mins = order.map((k) => parseTimeToMins(rec[k]));
  if (mins.some((v) => v === null)) {
    throw new Error(`Invalid HH:MM time in ${districtId} on ${rec.prayer_date}`);
  }
  for (let i = 0; i < mins.length - 1; i++) {
    if (mins[i] >= mins[i + 1]) {
      throw new Error(
        `Chronology error in ${districtId} on ${rec.prayer_date}: ${order[i]} (${rec[order[i]]}) >= ${order[i + 1]} (${rec[order[i + 1]]})`
      );
    }
  }
}

const yearsArg = process.argv.find((a) => a.startsWith('--years='));
const targetYears = yearsArg
  ? yearsArg
      .slice('--years='.length)
      .split(',')
      .map((y) => Number(y.trim()))
      .filter((y) => Number.isInteger(y) && y >= 2026 && y <= 2035)
  : [2026, 2027];

const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    '[My Adhan] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable.\n' +
      'Set both in .env (server-side only, never VITE_ for service role key) and re-run `npm run supabase:sync-prayers`.'
  );
  process.exit(1);
}

if (!fs.existsSync(JSON_DIR)) {
  console.error('[My Adhan] data/acju-2026 directory not found. Run `npm run acju:export-json` first.');
  process.exit(1);
}

const files = fs
  .readdirSync(JSON_DIR)
  .filter((f) => f.endsWith('.json') && f !== 'index.json')
  .sort();

const rowsToUpsert = [];

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(JSON_DIR, file), 'utf8'));
  for (const rec of data.records) {
    validateRecordChronology(data.district_id, rec);
    const mmdd = rec.prayer_date.slice(5); // MM-DD

    for (const year of targetYears) {
      // Never invent Feb 29 (2026 is not a leap year)
      if (mmdd === '02-29') continue;
      const targetDate = `${year}-${mmdd}`;
      rowsToUpsert.push({
        district_id: data.district_id,
        zone_id: data.zone_id,
        prayer_date: targetDate,
        fajr: rec.fajr,
        sunrise: rec.sunrise,
        dhuhr: rec.dhuhr,
        asr: rec.asr,
        maghrib: rec.maghrib,
        isha: rec.isha,
        timezone: 'Asia/Colombo',
        source_version:
          year === 2026 ? rec.source_version : `${rec.source_version}-annual-repeat-${year}`,
        is_annual_repeat: year > 2026,
      });
    }
  }
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log(
  `[My Adhan] Syncing ${rowsToUpsert.length} validated ACJU rows across ${files.length} districts (years: ${targetYears.join(', ')}) to Supabase...`
);

for (let i = 0; i < rowsToUpsert.length; i += BATCH_SIZE) {
  const batch = rowsToUpsert.slice(i, i + BATCH_SIZE);
  const { error } = await supabase
    .from('prayer_times')
    .upsert(batch, { onConflict: 'district_id,prayer_date' });
  if (error) {
    console.error(`[My Adhan] Batch upsert failed at offset ${i}:`, error.message);
    process.exit(1);
  }
}

console.log('[My Adhan] Successfully synchronized ACJU prayer_times to Supabase.');
