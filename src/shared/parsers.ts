import { isLeapYear, validateTimetableRows } from './timetablePolicy';
import type { PrayerTimesRow, ValidationIssue } from './types';

export interface ParseResult {
  rows: PrayerTimesRow[];
  issues: ValidationIssue[];
}

/**
 * Normalizes times like "4:48", "04:48", "4.48", "04:48 AM", "12:15 PM", "3:32 PM" into 24h HH:MM.
 */
export function normalizePrayerTimeToken(
  raw: string,
  expectedPeriodHint?: 'am' | 'pm' | 'dhuhr'
): string | null {
  const cleaned = raw.trim().replace('.', ':').toUpperCase();
  const match = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/.exec(cleaned);
  if (!match) return null;

  let hh = Number(match[1]);
  const mm = Number(match[2]);
  const meridiem = match[3] as 'AM' | 'PM' | undefined;

  if (mm < 0 || mm > 59 || hh < 0 || hh > 23) return null;

  if (meridiem) {
    if (hh < 1 || hh > 12) return null;
    if (meridiem === 'AM') {
      if (hh === 12) hh = 0;
    } else {
      if (hh !== 12) hh += 12;
    }
  } else if (expectedPeriodHint) {
    if (expectedPeriodHint === 'pm' && hh >= 1 && hh <= 11) {
      hh += 12;
    } else if (expectedPeriodHint === 'dhuhr' && hh >= 1 && hh <= 4) {
      // Dhuhr in Sri Lanka is ~11:45–12:35 (never 01:00–04:00 AM)
      hh += 12;
    }
  }

  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Parses an official ACJU CSV timetable file.
 * Supports either full `date` (`YYYY-MM-DD`) or `day` (`1..31`) column plus
 * `fajr, dhuhr (or luhar/zuhr), asr, maghrib, isha`.
 */
export function parseAcjuCsv(
  csvText: string,
  targetYear: number,
  targetMonth: number
): ParseResult {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length < 2) {
    return {
      rows: [],
      issues: [
        {
          rowIndex: -1,
          severity: 'error',
          message: 'CSV file must include a header row and at least one data row.',
        },
      ],
    };
  }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const findCol = (aliases: string[]) => headers.findIndex((h) => aliases.includes(h));

  const dateCol = findCol(['date', 'reference_date', 'gregorian_date']);
  const dayCol = findCol(['day', 'day_of_month', 'dt']);
  const fajrCol = findCol(['fajr', 'subah', 'subh']);
  const dhuhrCol = findCol(['dhuhr', 'luhar', 'zuhr', 'dhuhar', 'luhr']);
  const asrCol = findCol(['asr', 'asar', 'asr-shafie']);
  const maghribCol = findCol(['maghrib', 'magrib']);
  const ishaCol = findCol(['isha', 'ishaa']);

  const parseIssues: ValidationIssue[] = [];
  if (dateCol === -1 && dayCol === -1) {
    parseIssues.push({
      rowIndex: 0,
      severity: 'error',
      message: 'CSV header missing "date" or "day" column.',
    });
  }
  if ([fajrCol, dhuhrCol, asrCol, maghribCol, ishaCol].some((c) => c === -1)) {
    parseIssues.push({
      rowIndex: 0,
      severity: 'error',
      message: 'CSV header must include columns for fajr, dhuhr, asr, maghrib, and isha.',
    });
  }
  if (parseIssues.length > 0) {
    return { rows: [], issues: parseIssues };
  }

  const rows: PrayerTimesRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    let dayNum = NaN;
    let referenceDate = '';

    if (dateCol !== -1 && cols[dateCol]) {
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(cols[dateCol]);
      if (m) {
        dayNum = Number(m[3]);
        referenceDate = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
      } else {
        referenceDate = cols[dateCol];
      }
    }
    if (Number.isNaN(dayNum) && dayCol !== -1 && cols[dayCol]) {
      dayNum = Number(cols[dayCol]);
      if (Number.isInteger(dayNum)) {
        referenceDate = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(
          dayNum
        ).padStart(2, '0')}`;
      }
    }

    const fajr = normalizePrayerTimeToken(cols[fajrCol] ?? '', 'am') ?? (cols[fajrCol] ?? '');
    const dhuhr = normalizePrayerTimeToken(cols[dhuhrCol] ?? '', 'dhuhr') ?? (cols[dhuhrCol] ?? '');
    const asr = normalizePrayerTimeToken(cols[asrCol] ?? '', 'pm') ?? (cols[asrCol] ?? '');
    const maghrib =
      normalizePrayerTimeToken(cols[maghribCol] ?? '', 'pm') ?? (cols[maghribCol] ?? '');
    const isha = normalizePrayerTimeToken(cols[ishaCol] ?? '', 'pm') ?? (cols[ishaCol] ?? '');

    rows.push({
      month: targetMonth,
      day: Number.isInteger(dayNum) ? dayNum : 0,
      referenceDate:
        referenceDate ||
        `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(dayNum || 0).padStart(
          2,
          '0'
        )}`,
      fajr,
      dhuhr,
      asr,
      maghrib,
      isha,
    });
  }

  const validationIssues = validateTimetableRows(rows, targetYear, targetMonth);
  return {
    rows,
    issues: validationIssues,
  };
}

/**
 * Parses extracted text lines from an official ACJU monthly PDF timetable.
 * Handles:
 * - Official 7-column ACJU PDFs: DATE | FAJR | SUNRISE | LUHR | ASR-SHAFIE | ASR-HANAFI | MAGRIB | ISHA
 * - 6-column PDFs: DAY | FAJR | SUNRISE | DHUHR | ASR | MAGHRIB | ISHA
 * - 5-column PDFs: DAY | FAJR | DHUHR | ASR | MAGHRIB | ISHA
 * Note: Official ACJU February PDFs include 29-Feb for leap years; for non-leap years (e.g. 2026),
 * 29-Feb is skipped with an informational note and never written as a fake 2026-02-29 date.
 */
export function parseAcjuPdfText(
  extractedText: string,
  targetYear: number,
  targetMonth: number
): ParseResult {
  const normalizedText = extractedText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Split concatenated rows on either "1-Jan" or "Jun-1"
    .replace(
      /(?!^)\b(\d{1,2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{1,2})\b/gi,
      '\n$1'
    );

  const lines = normalizedText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const rows: PrayerTimesRow[] = [];
  const parseWarnings: ValidationIssue[] = [];
  const timeRegex = /\b(\d{1,2}[:.]\d{2}(?:\s*(?:AM|PM))?)\b/gi;

  for (const line of lines) {
    // Match line starting with Gregorian day ("1-Jan ...", "Jun-1 ...", or "1 ...")
    const dayFirstMatch = /^(\d{1,2})(?:-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))?\b/i.exec(
      line
    );
    const monthFirstMatch =
      /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[-\s]+(\d{1,2})\b/i.exec(line);
    const dayStr = dayFirstMatch?.[1] ?? monthFirstMatch?.[1];
    if (!dayStr) continue;
    const dayNum = Number(dayStr);
    if (dayNum < 1 || dayNum > 31) continue;

    const timesFound = [...line.matchAll(timeRegex)].map((m) => m[1]);
    if (timesFound.length < 5) continue;

    if (targetMonth === 2 && dayNum === 29 && !isLeapYear(targetYear)) {
      parseWarnings.push({
        rowIndex: -1,
        date: `${targetYear}-02-29`,
        severity: 'warning',
        message: `Skipped perpetual 29-Feb row from PDF because ${targetYear} is not a leap year.`,
      });
      continue;
    }

    let fiveTimes: string[];
    if (timesFound.length === 7) {
      // Official ACJU 7-column format: [0=Fajr, 1=Sunrise, 2=Luhr, 3=Asr-Shafie, 4=Asr-Hanafi, 5=Maghrib, 6=Isha]
      fiveTimes = [timesFound[0], timesFound[2], timesFound[3], timesFound[5], timesFound[6]];
    } else if (timesFound.length === 6) {
      // 6-column format: [0=Fajr, 1=Sunrise, 2=Dhuhr, 3=Asr, 4=Maghrib, 5=Isha]
      fiveTimes = [timesFound[0], timesFound[2], timesFound[3], timesFound[4], timesFound[5]];
      parseWarnings.push({
        rowIndex: rows.length,
        date: `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`,
        severity: 'warning',
        message: `Row for day ${dayNum} contained 6 time columns (skipped column 2 as Sunrise). Verify against PDF.`,
      });
    } else if (timesFound.length === 5) {
      fiveTimes = timesFound;
    } else {
      fiveTimes = timesFound.slice(0, 5);
      parseWarnings.push({
        rowIndex: rows.length,
        date: `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`,
        severity: 'warning',
        message: `Row for day ${dayNum} had ${timesFound.length} time values; please review extracted columns.`,
      });
    }

    const referenceDate = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(
      dayNum
    ).padStart(2, '0')}`;

    rows.push({
      month: targetMonth,
      day: dayNum,
      referenceDate,
      fajr: normalizePrayerTimeToken(fiveTimes[0], 'am') ?? fiveTimes[0],
      dhuhr: normalizePrayerTimeToken(fiveTimes[1], 'dhuhr') ?? fiveTimes[1],
      asr: normalizePrayerTimeToken(fiveTimes[2], 'pm') ?? fiveTimes[2],
      maghrib: normalizePrayerTimeToken(fiveTimes[3], 'pm') ?? fiveTimes[3],
      isha: normalizePrayerTimeToken(fiveTimes[4], 'pm') ?? fiveTimes[4],
    });
  }

  if (rows.length === 0) {
    return {
      rows: [],
      issues: [
        {
          rowIndex: -1,
          severity: 'error',
          message:
            'Could not extract tabular daily rows (1..31 with 5 prayer times) from this PDF. Check if the PDF is scanned/image-only or upload an official CSV.',
        },
      ],
    };
  }

  const validationIssues = validateTimetableRows(rows, targetYear, targetMonth);
  return {
    rows,
    issues: [...parseWarnings, ...validationIssues],
  };
}

/**
 * Generates an official-format CSV template (empty or populated) for administrators.
 */
export function buildOfficialCsvTemplate(year: number, month: number): string {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const header = 'date,fajr,dhuhr,asr,maghrib,isha';
  const lines = [header];
  for (let d = 1; d <= days; d++) {
    const mm = String(month).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    lines.push(`${year}-${mm}-${dd},04:50,12:08,15:25,18:02,19:15`);
  }
  return lines.join('\n');
}
