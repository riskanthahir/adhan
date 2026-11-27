import {
  PRAYER_LABELS,
  PRAYER_NAMES,
  type AdvanceMinutesOption,
  type PrayerName,
  type PrayerTimesRow,
  type ReferencePrayerRecord,
  type ResolvedDaySchedule,
  type ValidationIssue,
} from './types.ts';

export const SRI_LANKA_TIMEZONE = 'Asia/Colombo';
export const BASE_REFERENCE_YEAR = 2026;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseTimeToMinutes(timeStr: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(timeStr.trim());
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

export function formatMinutesToHHMM(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hh = Math.floor(normalized / 60);
  const mm = normalized % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function formatTime12h(hhmm: string): string {
  const mins = parseTimeToMinutes(hhmm);
  if (mins === null) return hhmm;
  const hh24 = Math.floor(mins / 60);
  const mm = mins % 60;
  const period = hh24 >= 12 ? 'PM' : 'AM';
  const hh12 = hh24 % 12 === 0 ? 12 : hh24 % 12;
  return `${hh12}:${String(mm).padStart(2, '0')} ${period}`;
}

/**
 * Validates extracted or edited monthly ACJU timetable rows for:
 * - Date validity & uniqueness
 * - HH:MM 24h format for all 5 prayers
 * - Strict chronological consistency (Fajr < Dhuhr < Asr < Maghrib < Isha)
 * - Month completeness (flags missing days in the target year/month)
 */
export function validateTimetableRows(
  rows: PrayerTimesRow[],
  expectedYear: number,
  expectedMonth: number
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenDates = new Set<string>();
  const expectedDays = getDaysInMonth(expectedYear, expectedMonth);

  rows.forEach((row, idx) => {
    const expectedDate = `${expectedYear}-${String(expectedMonth).padStart(2, '0')}-${String(
      row.day
    ).padStart(2, '0')}`;

    if (row.month !== expectedMonth || row.day < 1 || row.day > expectedDays) {
      issues.push({
        rowIndex: idx,
        date: row.referenceDate,
        field: 'referenceDate',
        severity: 'error',
        message: `Day ${row.day} is out of range for ${expectedYear}-${String(expectedMonth).padStart(2, '0')}.`,
      });
    }

    if (row.referenceDate !== expectedDate) {
      issues.push({
        rowIndex: idx,
        date: row.referenceDate,
        field: 'referenceDate',
        severity: 'error',
        message: `Date "${row.referenceDate}" does not match expected "${expectedDate}".`,
      });
    }

    if (seenDates.has(row.referenceDate)) {
      issues.push({
        rowIndex: idx,
        date: row.referenceDate,
        field: 'referenceDate',
        severity: 'error',
        message: `Duplicate record for ${row.referenceDate}.`,
      });
    }
    seenDates.add(row.referenceDate);

    const mins: number[] = [];
    for (const p of PRAYER_NAMES) {
      const m = parseTimeToMinutes(row[p]);
      if (m === null) {
        issues.push({
          rowIndex: idx,
          date: row.referenceDate,
          field: p,
          severity: 'error',
          message: `Invalid ${PRAYER_LABELS[p]} time "${row[p]}" (expected HH:MM 24-hour format).`,
        });
      } else {
        mins.push(m);
      }
    }

    if (mins.length === 5) {
      for (let i = 0; i < 4; i++) {
        if (mins[i] >= mins[i + 1]) {
          issues.push({
            rowIndex: idx,
            date: row.referenceDate,
            field: PRAYER_NAMES[i + 1],
            severity: 'error',
            message: `Chronological inconsistency on ${row.referenceDate}: ${PRAYER_LABELS[PRAYER_NAMES[i]]} (${row[PRAYER_NAMES[i]]}) must be earlier than ${PRAYER_LABELS[PRAYER_NAMES[i + 1]]} (${row[PRAYER_NAMES[i + 1]]}).`,
          });
        }
      }
      // Sanity bounds for Sri Lanka (Fajr 03:30-06:00, Isha 18:15-21:15)
      if (mins[0] < 210 || mins[0] > 360) {
        issues.push({
          rowIndex: idx,
          date: row.referenceDate,
          field: 'fajr',
          severity: 'warning',
          message: `Unusual Fajr time (${row.fajr}) for Sri Lanka; please double-check source PDF.`,
        });
      }
      if (mins[4] < 1095 || mins[4] > 1275) {
        issues.push({
          rowIndex: idx,
          date: row.referenceDate,
          field: 'isha',
          severity: 'warning',
          message: `Unusual Isha time (${row.isha}) for Sri Lanka; please double-check source PDF.`,
        });
      }

      if (row.sunrise) {
        const sunriseMins = parseTimeToMinutes(row.sunrise);
        if (sunriseMins === null) {
          issues.push({
            rowIndex: idx,
            date: row.referenceDate,
            field: 'sunrise',
            severity: 'error',
            message: `Invalid Sunrise time "${row.sunrise}" (expected HH:MM 24-hour format).`,
          });
        } else if (sunriseMins <= mins[0] || sunriseMins >= mins[1]) {
          issues.push({
            rowIndex: idx,
            date: row.referenceDate,
            field: 'sunrise',
            severity: 'error',
            message: `Chronological inconsistency on ${row.referenceDate}: Sunrise (${row.sunrise}) must be between Fajr (${row.fajr}) and Dhuhr (${row.dhuhr}).`,
          });
        }
      }
    }
  });

  // Completeness check
  for (let d = 1; d <= expectedDays; d++) {
    const iso = `${expectedYear}-${String(expectedMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!seenDates.has(iso)) {
      issues.push({
        rowIndex: -1,
        date: iso,
        severity: 'error',
        message: `Missing prayer timetable row for ${iso} (${expectedDays} days required).`,
      });
    }
  }

  return issues;
}

/**
 * Resolves a single calendar date for a given ACJU zone using ONLY verified/approved records:
 * 1. First checks for an approved official record matching (zoneId, targetYear, month, day).
 * 2. For future years (targetYear > 2026) when no new official timetable exists for targetYear:
 *    - Leap-year Feb 29 policy: 2026 is NOT a leap year. Never invent or copy Feb 28 silently.
 *      If Feb 29 has no explicit approved record for targetYear, returns `unavailable_leap_day`.
 *    - Otherwise matches (month, day) against approved 2026 reference records and marks
 *      `scheduleSource = 'annual_repeat_2026'` and `isAnnualRepeat = true`.
 * 3. If demo sample preview is explicitly permitted AND sample rows are provided, marks
 *    `scheduleSource = 'demo_sample'` (never verified, reminders disabled).
 * 4. Otherwise returns `missing_timetable` with null times (never fabricating prayer times).
 */
export function resolveScheduleForDate(params: {
  targetDate: string; // YYYY-MM-DD
  zoneId: number;
  approvedRecords: readonly ReferencePrayerRecord[];
  demoSampleRecords?: readonly ReferencePrayerRecord[];
  allowDemoSample?: boolean;
}): ResolvedDaySchedule {
  const { targetDate, zoneId, approvedRecords, demoSampleRecords = [], allowDemoSample = false } = params;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(targetDate);
  if (!match) {
    throw new Error(`Invalid targetDate "${targetDate}". Expected YYYY-MM-DD.`);
  }
  const targetYear = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Strict filter: ONLY approved, non-demo records qualify as verified ACJU data
  const verifiedOnly = approvedRecords.filter(
    (r) => r.verificationStatus === 'approved' && !r.isDemoSample && r.zoneId === zoneId
  );

  // 1. Direct official match for exact targetYear + month + day
  const exactYearMatch = verifiedOnly.find(
    (r) => r.referenceYear === targetYear && r.month === month && r.day === day
  );
  if (exactYearMatch) {
    return {
      targetDate,
      targetYear,
      month,
      day,
      zoneId,
      scheduleSource: 'official_reference',
      isVerified: true,
      isDemoSample: false,
      isAnnualRepeat: false,
      sourceYear: exactYearMatch.referenceYear,
      versionId: exactYearMatch.versionId,
      statusMessage: `Verified official ${exactYearMatch.referenceYear} ACJU timetable.`,
      times: {
        fajr: exactYearMatch.fajr,
        ...(exactYearMatch.sunrise ? { sunrise: exactYearMatch.sunrise } : {}),
        dhuhr: exactYearMatch.dhuhr,
        asr: exactYearMatch.asr,
        maghrib: exactYearMatch.maghrib,
        isha: exactYearMatch.isha,
      },
    };
  }

  // 2. Future year annual-repeat policy from 2026 ACJU reference dataset
  if (targetYear > BASE_REFERENCE_YEAR) {
    // Explicit safe Leap-Year Feb 29 policy: never invent or silently extrapolate
    if (month === 2 && day === 29) {
      return {
        targetDate,
        targetYear,
        month,
        day,
        zoneId,
        scheduleSource: 'unavailable_leap_day',
        isVerified: false,
        isDemoSample: false,
        isAnnualRepeat: false,
        sourceYear: null,
        versionId: null,
        statusMessage:
          'Leap-year policy: 29 February has no entry in the embedded 2026 ACJU reference timetable, so no prayer times are invented and reminders are paused for this date.',
        times: null,
      };
    }

    const ref2026Match = verifiedOnly.find(
      (r) => r.referenceYear === BASE_REFERENCE_YEAR && r.month === month && r.day === day
    );
    if (ref2026Match) {
      return {
        targetDate,
        targetYear,
        month,
        day,
        zoneId,
        scheduleSource: 'annual_repeat_2026',
        isVerified: true,
        isDemoSample: false,
        isAnnualRepeat: true,
        sourceYear: BASE_REFERENCE_YEAR,
        versionId: ref2026Match.versionId,
        statusMessage:
          'Annual repeat from 2026 ACJU reference dataset — not newly published ACJU data.',
        times: {
          fajr: ref2026Match.fajr,
          ...(ref2026Match.sunrise ? { sunrise: ref2026Match.sunrise } : {}),
          dhuhr: ref2026Match.dhuhr,
          asr: ref2026Match.asr,
          maghrib: ref2026Match.maghrib,
          isha: ref2026Match.isha,
        },
      };
    }
  }

  // 3. Optional clearly-labelled Demo Sample fallback (never verified, reminders disabled)
  if (allowDemoSample) {
    const sampleMatch = demoSampleRecords.find(
      (r) => r.zoneId === zoneId && r.month === month && r.day === day
    );
    if (sampleMatch) {
      return {
        targetDate,
        targetYear,
        month,
        day,
        zoneId,
        scheduleSource: 'demo_sample',
        isVerified: false,
        isDemoSample: true,
        isAnnualRepeat: false,
        sourceYear: null,
        versionId: null,
        statusMessage:
          'Local Demo Sample — placeholder data only. NOT verified ACJU prayer times; live reminders are disabled.',
        times: {
          fajr: sampleMatch.fajr,
          ...(sampleMatch.sunrise ? { sunrise: sampleMatch.sunrise } : {}),
          dhuhr: sampleMatch.dhuhr,
          asr: sampleMatch.asr,
          maghrib: sampleMatch.maghrib,
          isha: sampleMatch.isha,
        },
      };
    }
  }

  // 4. No verified record available — never invent times
  return {
    targetDate,
    targetYear,
    month,
    day,
    zoneId,
    scheduleSource: 'missing_timetable',
    isVerified: false,
    isDemoSample: false,
    isAnnualRepeat: false,
    sourceYear: null,
    versionId: null,
    statusMessage:
      'No verified ACJU timetable record published for this zone and date. An administrator must import and approve the official ACJU PDF or CSV.',
    times: null,
  };
}

/**
 * Returns YYYY-MM-DD and current HH:MM:SS in Asia/Colombo regardless of the user's device timezone.
 */
export function getColomboNowParts(now: Date = new Date()): {
  dateISO: string;
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalSecondsSinceMidnight: number;
  formattedGregorian: string;
  formattedTime: string;
} {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: SRI_LANKA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';

  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  let hours = Number(get('hour'));
  if (hours === 24) hours = 0;
  const minutes = Number(get('minute'));
  const seconds = Number(get('second'));

  const dateISO = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const formattedGregorian = new Intl.DateTimeFormat('en-LK', {
    timeZone: SRI_LANKA_TIMEZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(now);

  const formattedTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
    seconds
  ).padStart(2, '0')}`;

  return {
    dateISO,
    year,
    month,
    day,
    hours,
    minutes,
    seconds,
    totalSecondsSinceMidnight: hours * 3600 + minutes * 60 + seconds,
    formattedGregorian,
    formattedTime,
  };
}

/**
 * Formats an estimated Hijri date using Intl Islamic calendar.
 * Must always be labelled as an estimate (subject to Sri Lanka crescent sighting).
 */
export function getEstimatedHijriDate(now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
      timeZone: SRI_LANKA_TIMEZONE,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-u-ca-islamic', {
      timeZone: SRI_LANKA_TIMEZONE,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(now);
  }
}

/**
 * Converts a Colombo local date (YYYY-MM-DD) + HH:MM time into an exact UTC epoch timestamp (ms).
 * Sri Lanka (Asia/Colombo) is fixed at UTC+05:30 with no DST.
 */
export function colomboDateTimeToEpochMs(dateISO: string, hhmm: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  const mins = parseTimeToMinutes(hhmm);
  if (!match || mins === null) {
    throw new Error(`Invalid Colombo date/time: ${dateISO} ${hhmm}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  // Asia/Colombo is UTC+05:30 -> subtract 330 minutes from UTC date construction
  return Date.UTC(year, month - 1, day, hh, mm, 0, 0) - 330 * 60 * 1000;
}

export interface NextPrayerInfo {
  prayer: PrayerName;
  label: string;
  timeHHMM: string;
  isTomorrow: boolean;
  secondsRemaining: number;
  countdownFormatted: string;
}

export function formatCountdownSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function computeNextPrayer(
  todaySchedule: ResolvedDaySchedule,
  tomorrowSchedule: ResolvedDaySchedule | null,
  now: Date = new Date()
): NextPrayerInfo | null {
  if (!todaySchedule.times) return null;
  const nowMs = now.getTime();

  for (const prayer of PRAYER_NAMES) {
    const timeHHMM = todaySchedule.times[prayer];
    const targetMs = colomboDateTimeToEpochMs(todaySchedule.targetDate, timeHHMM);
    if (targetMs > nowMs) {
      const sec = Math.floor((targetMs - nowMs) / 1000);
      return {
        prayer,
        label: PRAYER_LABELS[prayer],
        timeHHMM,
        isTomorrow: false,
        secondsRemaining: sec,
        countdownFormatted: formatCountdownSeconds(sec),
      };
    }
  }

  // After Isha: point to tomorrow's Fajr if verified/available
  if (tomorrowSchedule?.times) {
    const timeHHMM = tomorrowSchedule.times.fajr;
    const targetMs = colomboDateTimeToEpochMs(tomorrowSchedule.targetDate, timeHHMM);
    const sec = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
    return {
      prayer: 'fajr',
      label: PRAYER_LABELS.fajr,
      timeHHMM,
      isTomorrow: true,
      secondsRemaining: sec,
      countdownFormatted: formatCountdownSeconds(sec),
    };
  }

  return null;
}

/**
 * Generates a deterministic deduplication key for a scheduled prayer reminder.
 * Prevents duplicate notifications across timer refreshes or app reloads.
 */
export function buildReminderDedupeKey(params: {
  dateISO: string;
  zoneId: number;
  prayer: PrayerName;
  advanceMinutes: AdvanceMinutesOption;
  versionId: string;
}): string {
  return `${params.dateISO}::z${params.zoneId}::${params.prayer}::m${params.advanceMinutes}::v${params.versionId}`;
}
