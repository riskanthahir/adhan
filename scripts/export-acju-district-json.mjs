#!/usr/bin/env node
/**
 * Exports official embedded 2026 ACJU prayer schedules per district into
 * version-controlled JSON files under `data/acju-2026/<district>.json`.
 *
 * Preserves exact published ACJU timings, uses Asia/Colombo timezone, and
 * never invents missing dates (2026 has 365 days; no Feb 29 row).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ACJU_DISTRICTS, ACJU_ZONES } from '../src/shared/acjuSeed.ts';
import { ACJU_2026_TIMETABLE_COMPACT } from '../src/shared/acju2026Timetable.ts';

const OUT_DIR = path.resolve(process.cwd(), 'data', 'acju-2026');
fs.mkdirSync(OUT_DIR, { recursive: true });

const manifestDistricts = [];

for (const district of ACJU_DISTRICTS) {
  const zone = ACJU_ZONES.find((z) => z.id === district.zoneId);
  const compactZoneMap = ACJU_2026_TIMETABLE_COMPACT[district.zoneId];
  if (!compactZoneMap) {
    throw new Error(`Missing ACJU 2026 timetable data for zone ${district.zoneId} (${district.id}).`);
  }

  const keys = Object.keys(compactZoneMap).sort();
  const records = keys.map((mmdd) => {
    const packed = compactZoneMap[mmdd];
    const parts = packed.split('|');
    if (parts.length !== 6) {
      throw new Error(`Unexpected packed entry "${packed}" for zone ${district.zoneId} on ${mmdd}.`);
    }
    const [fajr, sunrise, dhuhr, asr, maghrib, isha] = parts;
    return {
      prayer_date: `2026-${mmdd}`,
      fajr,
      sunrise,
      dhuhr,
      asr,
      maghrib,
      isha,
      source_version: `acju-2026-official-z${district.zoneId}`,
    };
  });

  const payload = {
    district_id: district.id,
    district_name: district.name,
    parent_district: district.parentDistrict,
    zone_id: district.zoneId,
    zone_code: zone?.zoneCode ?? `ZONE_${String(district.zoneId).padStart(2, '0')}`,
    zone_name: zone?.name ?? `Zone ${district.zoneId}`,
    timezone: 'Asia/Colombo',
    reference_year: 2026,
    source: 'All-Ceylon Jamiyyathul Ulama (ACJU) Official 2026 Timetable',
    source_version: `acju-2026-official-z${district.zoneId}`,
    record_count: records.length,
    records,
  };

  const outFile = path.join(OUT_DIR, `${district.id}.json`);
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  manifestDistricts.push({
    district_id: district.id,
    district_name: district.name,
    zone_id: district.zoneId,
    zone_code: payload.zone_code,
    file: `${district.id}.json`,
    record_count: records.length,
    source_version: payload.source_version,
  });
}

fs.writeFileSync(
  path.join(OUT_DIR, 'index.json'),
  JSON.stringify(
    {
      timezone: 'Asia/Colombo',
      reference_year: 2026,
      source: 'All-Ceylon Jamiyyathul Ulama (ACJU) Official 2026 Timetable',
      district_count: manifestDistricts.length,
      districts: manifestDistricts,
    },
    null,
    2
  ) + '\n',
  'utf8'
);

console.log(
  `[My Adhan] Exported ${manifestDistricts.length} ACJU district JSON files (365 days each) to data/acju-2026/.`
);
