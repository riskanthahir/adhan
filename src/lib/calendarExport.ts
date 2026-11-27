import { resolveEmbeddedDaySchedule } from '../shared/acju2026Timetable';
import {
  colomboDateTimeToEpochMs,
  formatTime12h,
  getColomboNowParts,
} from '../shared/timetablePolicy';
import {
  PRAYER_LABELS,
  PRAYER_NAMES,
  type AcjuZone,
  type AdvanceMinutesOption,
  type PrayerName,
} from '../shared/types';

function toIcsUtcStamp(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${day}T${hh}${mm}${ss}Z`;
}

function addDaysISO(dateISO: string, offsetDays: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + offsetDays));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;
}

function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

export interface CalendarExportParams {
  zone: AcjuZone;
  districtName: string;
  perPrayerEnabled: Record<PrayerName, boolean>;
  advanceMinutes: Record<PrayerName, AdvanceMinutesOption>;
  daysCount?: number;
  startDateISO?: string;
}

/**
 * Generates an RFC 5545 .ics calendar file with the five daily ACJU prayer times
 * for the selected Sri Lanka zone. Importing into Apple Calendar on iPhone enables:
 * - Upcoming prayer times on the iPhone Lock Screen via the Calendar "Up Next" widget
 * - Native iOS lock-screen alerts & sound even when the browser/PWA is closed
 */
export function buildAcjuCalendarIcs(params: CalendarExportParams): string {
  const {
    zone,
    districtName,
    perPrayerEnabled,
    advanceMinutes,
    daysCount = 30,
    startDateISO = getColomboNowParts().dateISO,
  } = params;

  const nowStamp = toIcsUtcStamp(Date.now());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//My Adhan//ACJU Sri Lanka Prayer Times//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(`My Adhan — ${districtName} (Group ${zone.id})`)}`,
    'X-WR-TIMEZONE:Asia/Colombo',
  ];

  for (let offset = 0; offset < daysCount; offset++) {
    const dateISO = addDaysISO(startDateISO, offset);
    const schedule = resolveEmbeddedDaySchedule(zone.id, dateISO);
    if (!schedule.isVerified || !schedule.times) continue;

    const times = schedule.times;
    const daySummary = [
      `Fajr ${formatTime12h(times.fajr)}`,
      times.sunrise ? `Sunrise ${formatTime12h(times.sunrise)}` : null,
      `Dhuhr ${formatTime12h(times.dhuhr)}`,
      `Asr ${formatTime12h(times.asr)}`,
      `Maghrib ${formatTime12h(times.maghrib)}`,
      `Isha ${formatTime12h(times.isha)}`,
    ]
      .filter(Boolean)
      .join(' | ');

    for (const prayer of PRAYER_NAMES) {
      if (!perPrayerEnabled[prayer]) continue;
      const timeHHMM = times[prayer];
      const startMs = colomboDateTimeToEpochMs(dateISO, timeHHMM);
      const endMs = startMs + 10 * 60 * 1000;
      const adv = advanceMinutes[prayer] ?? 0;

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:my-adhan-z${zone.id}-${dateISO}-${prayer}@myadhan.lk`);
      lines.push(`DTSTAMP:${nowStamp}`);
      lines.push(`DTSTART:${toIcsUtcStamp(startMs)}`);
      lines.push(`DTEND:${toIcsUtcStamp(endMs)}`);
      lines.push(
        `SUMMARY:${escapeIcsText(`${PRAYER_LABELS[prayer]} — ${formatTime12h(timeHHMM)}`)}`
      );
      lines.push(`LOCATION:${escapeIcsText(`${districtName}, Sri Lanka (ACJU Group ${zone.id})`)}`);
      lines.push(
        `DESCRIPTION:${escapeIcsText(
          `${PRAYER_LABELS[prayer]} Prayer Time (${districtName} · ${zone.name})\nToday: ${daySummary}`
        )}`
      );
      lines.push('CATEGORIES:Prayer Times');
      lines.push('STATUS:CONFIRMED');
      lines.push('TRANSP:TRANSPARENT');
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(
        `DESCRIPTION:${escapeIcsText(`${PRAYER_LABELS[prayer]} Prayer Time (${formatTime12h(timeHHMM)})`)}`
      );
      lines.push(`TRIGGER:-PT${adv}M`);
      lines.push('END:VALARM');
      lines.push('END:VEVENT');
    }
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadAcjuCalendarIcs(params: CalendarExportParams): number {
  const ics = buildAcjuCalendarIcs(params);
  const eventCount = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `my-adhan-group-${params.zone.id}-30days.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  return eventCount;
}
