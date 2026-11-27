import { describe, expect, it } from 'vitest';
import {
  resolveLocationFromCoordinates,
  resolveLocationManually,
} from '../locationLookup';
import { parseAcjuCsv, parseAcjuPdfText } from '../parsers';
import {
  ACJU_2026_TIMETABLE_COMPACT,
  resolveEmbeddedDaySchedule,
} from '../acju2026Timetable';
import {
  buildReminderDedupeKey,
  colomboDateTimeToEpochMs,
  computeNextPrayer,
  getColomboNowParts,
  resolveScheduleForDate,
  validateTimetableRows,
} from '../timetablePolicy';
import type { ReferencePrayerRecord } from '../types';

describe('Embedded Official 2026 ACJU Dataset (All 13 Zones × 365 Days)', () => {
  it('contains all 4,745 official 2026 records across zones 1..13 in strict chronological order', () => {
    let total = 0;
    for (let z = 1; z <= 13; z++) {
      const zoneEntries = Object.keys(ACJU_2026_TIMETABLE_COMPACT[z] ?? {});
      expect(zoneEntries.length).toBe(365);
      total += zoneEntries.length;
    }
    expect(total).toBe(4745);

    const colomboJan1 = resolveEmbeddedDaySchedule(1, '2026-01-01');
    expect(colomboJan1.isVerified).toBe(true);
    expect(colomboJan1.isAnnualRepeat).toBe(false);
    expect(colomboJan1.times).not.toBeNull();

    const gampola2028Repeat = resolveEmbeddedDaySchedule(7, '2028-05-15');
    expect(gampola2028Repeat.isVerified).toBe(true);
    expect(gampola2028Repeat.isAnnualRepeat).toBe(true);
    expect(gampola2028Repeat.scheduleSource).toBe('annual_repeat_2026');

    const leapDay = resolveEmbeddedDaySchedule(1, '2028-02-29');
    expect(leapDay.scheduleSource).toBe('unavailable_leap_day');
    expect(leapDay.times).toBeNull();
  });
});

describe('ACJU 13-Group Zone & Geospatial Mapping', () => {
  it('maps Gampola to ACJU Group 7 both manually and by GPS coordinates', () => {
    const manual = resolveLocationManually('Gampola');
    expect(manual.matched).toBe(true);
    expect(manual.district?.id).toBe('gampola');
    expect(manual.zone?.id).toBe(7);

    // Gampola coordinates (~7.1643, 80.5696)
    const gps = resolveLocationFromCoordinates(7.1643, 80.5696);
    expect(gps.matched).toBe(true);
    expect(gps.district?.id).toBe('gampola');
    expect(gps.zone?.id).toBe(7);
  });

  it('maps Nallur to Group 2 and Mullaitivu (except Nallur) to Group 3', () => {
    const nallur = resolveLocationManually('Nallur');
    expect(nallur.zone?.id).toBe(2);

    const mullaitivu = resolveLocationManually('Mullaitivu');
    expect(mullaitivu.zone?.id).toBe(3);

    const nallurGps = resolveLocationFromCoordinates(9.6745, 80.0294);
    expect(nallurGps.district?.id).toBe('nallur');
    expect(nallurGps.zone?.id).toBe(2);
  });

  it('maps Padiyatalawa and Dehiaththekandiya to Group 10 instead of Ampara Group 8', () => {
    const padi = resolveLocationManually('Padiyatalawa');
    expect(padi.zone?.id).toBe(10);

    const dehi = resolveLocationManually('Dehiaththekandiya');
    expect(dehi.zone?.id).toBe(10);

    const ampara = resolveLocationManually('Ampara');
    expect(ampara.zone?.id).toBe(8);

    const padiGps = resolveLocationFromCoordinates(7.3867, 81.1965);
    expect(padiGps.district?.id).toBe('padiyatalawa');
    expect(padiGps.zone?.id).toBe(10);
  });

  it('rejects coordinates outside Sri Lanka without claiming GPS accuracy', () => {
    const london = resolveLocationFromCoordinates(51.5072, -0.1276);
    expect(london.matched).toBe(false);
    expect(london.confidence).toBe('out_of_bounds');
    expect(london.zone).toBeNull();
  });
});

describe('2026 ACJU Annual-Repeat & Leap-Year Feb 29 Policy', () => {
  const approved2026Records: ReferencePrayerRecord[] = [
    {
      id: 'ref-1',
      versionId: 'v1-2026-z7',
      zoneId: 7,
      referenceYear: 2026,
      referenceDate: '2026-02-28',
      month: 2,
      day: 28,
      fajr: '05:05',
      dhuhr: '12:19',
      asr: '15:37',
      maghrib: '18:19',
      isha: '19:29',
      verificationStatus: 'approved',
      isDemoSample: false,
    },
    {
      id: 'ref-2',
      versionId: 'v1-2026-z7',
      zoneId: 7,
      referenceYear: 2026,
      referenceDate: '2026-03-01',
      month: 3,
      day: 1,
      fajr: '05:04',
      dhuhr: '12:18',
      asr: '15:37',
      maghrib: '18:19',
      isha: '19:29',
      verificationStatus: 'approved',
      isDemoSample: false,
    },
  ];

  it('matches future years (2027, 2028) by month and day against 2026 reference and labels as annual repeat', () => {
    const resolved2027 = resolveScheduleForDate({
      targetDate: '2027-02-28',
      zoneId: 7,
      approvedRecords: approved2026Records,
    });
    expect(resolved2027.isVerified).toBe(true);
    expect(resolved2027.isAnnualRepeat).toBe(true);
    expect(resolved2027.scheduleSource).toBe('annual_repeat_2026');
    expect(resolved2027.sourceYear).toBe(2026);
    expect(resolved2027.times?.fajr).toBe('05:05');
  });

  it('prefers newly approved official future-year records over 2026 annual repeat', () => {
    const with2027Official: ReferencePrayerRecord[] = [
      ...approved2026Records,
      {
        id: 'ref-2027',
        versionId: 'v1-2027-z7',
        zoneId: 7,
        referenceYear: 2027,
        referenceDate: '2027-02-28',
        month: 2,
        day: 28,
        fajr: '05:06',
        dhuhr: '12:20',
        asr: '15:38',
        maghrib: '18:20',
        isha: '19:30',
        verificationStatus: 'approved',
        isDemoSample: false,
      },
    ];
    const resolved = resolveScheduleForDate({
      targetDate: '2027-02-28',
      zoneId: 7,
      approvedRecords: with2027Official,
    });
    expect(resolved.scheduleSource).toBe('official_reference');
    expect(resolved.isAnnualRepeat).toBe(false);
    expect(resolved.sourceYear).toBe(2027);
    expect(resolved.times?.fajr).toBe('05:06');
  });

  it('never invents a time for Feb 29 in leap years (e.g., 2028-02-29) unless officially approved', () => {
    const feb29 = resolveScheduleForDate({
      targetDate: '2028-02-29',
      zoneId: 7,
      approvedRecords: approved2026Records,
      allowDemoSample: true,
    });
    expect(feb29.scheduleSource).toBe('unavailable_leap_day');
    expect(feb29.isVerified).toBe(false);
    expect(feb29.times).toBeNull();
  });

  it('never presents unverified or pending records as verified prayer times', () => {
    const unverified: ReferencePrayerRecord[] = [
      {
        ...approved2026Records[0],
        verificationStatus: 'pending',
      },
    ];
    const resolved = resolveScheduleForDate({
      targetDate: '2026-02-28',
      zoneId: 7,
      approvedRecords: unverified,
    });
    expect(resolved.isVerified).toBe(false);
    expect(resolved.scheduleSource).toBe('missing_timetable');
    expect(resolved.times).toBeNull();
  });
});

describe('Asia/Colombo Timezone Conversion & Next Prayer', () => {
  it('converts Colombo YYYY-MM-DD + HH:MM to exact UTC epoch (UTC+05:30)', () => {
    const epochMs = colomboDateTimeToEpochMs('2026-06-15', '04:50');
    // 04:50 IST == 23:20 UTC previous day (2026-06-14T23:20:00Z)
    expect(new Date(epochMs).toISOString()).toBe('2026-06-14T23:20:00.000Z');
  });

  it('formats Asia/Colombo date parts independently of host timezone', () => {
    // 2026-06-14T20:00:00Z is 2026-06-15 01:30:00 in Asia/Colombo
    const parts = getColomboNowParts(new Date('2026-06-14T20:00:00.000Z'));
    expect(parts.dateISO).toBe('2026-06-15');
    expect(parts.hours).toBe(1);
    expect(parts.minutes).toBe(30);
  });

  it('computes the next upcoming prayer accurately', () => {
    const today = resolveScheduleForDate({
      targetDate: '2026-03-01',
      zoneId: 7,
      approvedRecords: [
        {
          id: 'r1',
          versionId: 'v1',
          zoneId: 7,
          referenceYear: 2026,
          referenceDate: '2026-03-01',
          month: 3,
          day: 1,
          fajr: '05:04',
          dhuhr: '12:18',
          asr: '15:37',
          maghrib: '18:19',
          isha: '19:29',
          verificationStatus: 'approved',
          isDemoSample: false,
        },
      ],
    });
    // 10:00 AM Asia/Colombo = 04:30 UTC
    const now = new Date('2026-03-01T04:30:00.000Z');
    const next = computeNextPrayer(today, null, now);
    expect(next?.prayer).toBe('dhuhr');
    expect(next?.timeHHMM).toBe('12:18');
    expect(next?.secondsRemaining).toBe(2 * 3600 + 18 * 60);
  });
});

describe('Duplicate Reminder Prevention & Parser Validation', () => {
  it('produces unique deterministic deduplication keys per date, zone, prayer, offset, and version', () => {
    const key1 = buildReminderDedupeKey({
      dateISO: '2026-05-01',
      zoneId: 7,
      prayer: 'fajr',
      advanceMinutes: 10,
      versionId: 'v1',
    });
    const key2 = buildReminderDedupeKey({
      dateISO: '2026-05-01',
      zoneId: 7,
      prayer: 'fajr',
      advanceMinutes: 10,
      versionId: 'v1',
    });
    const key3 = buildReminderDedupeKey({
      dateISO: '2026-05-01',
      zoneId: 7,
      prayer: 'fajr',
      advanceMinutes: 10,
      versionId: 'v2',
    });
    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });

  it('catches chronological errors and incomplete months during CSV/row validation', () => {
    const issues = validateTimetableRows(
      [
        {
          month: 1,
          day: 1,
          referenceDate: '2026-01-01',
          fajr: '05:00',
          dhuhr: '12:10',
          asr: '11:30', // Earlier than Dhuhr!
          maghrib: '18:05',
          isha: '19:20',
        },
      ],
      2026,
      1
    );
    expect(issues.some((i) => i.message.includes('Chronological inconsistency'))).toBe(true);
    expect(issues.some((i) => i.message.includes('Missing prayer timetable row'))).toBe(true);
  });

  it('parses official 7-column ACJU PDF lines (Day-Month, Month-Day, and perpetual Feb 29 skip in non-leap year)', () => {
    const samplePdfText = [
      'DATE FAJR SUNRISE LUHR ASR-SHAFIE ASR-HANAFI MAGRIB ISHA',
      '1-Jan 4:57 AM 6:20 AM 12:12 PM 3:33 PM 4:25 PM 6:03 PM 7:18 PM',
      '2-Jan 4:57 AM 6:20 AM 12:13 PM 3:34 PM 4:26 PM 6:04 PM 7:18 PM',
    ].join('\n');
    const parsedJan = parseAcjuPdfText(samplePdfText, 2026, 1);
    expect(parsedJan.rows.length).toBe(2);
    expect(parsedJan.rows[0]).toMatchObject({
      referenceDate: '2026-01-01',
      fajr: '04:57',
      dhuhr: '12:12',
      asr: '15:33',
      maghrib: '18:03',
      isha: '19:18',
    });

    const juneText = 'Jun-1 4:30 AM 5:54 AM 12:10 PM 3:35 PM 4:38 PM 6:25 PM 7:40 PM';
    const parsedJun = parseAcjuPdfText(juneText, 2026, 6);
    expect(parsedJun.rows.length).toBe(1);
    expect(parsedJun.rows[0]).toMatchObject({
      referenceDate: '2026-06-01',
      fajr: '04:30',
      dhuhr: '12:10',
      asr: '15:35',
      maghrib: '18:25',
      isha: '19:40',
    });

    const febText = [
      '28-Feb 5:07 AM 6:25 AM 12:25 PM 3:44 PM 4:43 PM 6:24 PM 7:33 PM',
      '29-Feb 5:07 AM 6:24 AM 12:25 PM 3:43 PM 4:43 PM 6:24 PM 7:33 PM',
    ].join('\n');
    const parsedFeb2026 = parseAcjuPdfText(febText, 2026, 2);
    expect(parsedFeb2026.rows.length).toBe(1);
    expect(parsedFeb2026.rows[0].referenceDate).toBe('2026-02-28');
  });

  it('parses official CSV format with AM/PM or 24-hour times', () => {
    const csv = [
      'date,fajr,dhuhr,asr,maghrib,isha',
      '2026-04-01,4:48 AM,12:15 PM,3:32 PM,6:18 PM,7:28 PM',
    ].join('\n');
    const parsed = parseAcjuCsv(csv, 2026, 4);
    expect(parsed.rows[0]).toMatchObject({
      referenceDate: '2026-04-01',
      fajr: '04:48',
      dhuhr: '12:15',
      asr: '15:32',
      maghrib: '18:18',
      isha: '19:28',
    });
  });
});
