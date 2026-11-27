import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download } from 'lucide-react';
import { resolveEmbeddedMonthSchedules } from '../shared/acju2026Timetable';
import { formatTime12h, getColomboNowParts } from '../shared/timetablePolicy';
import type { AcjuZone } from '../shared/types';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

interface TimetableViewProps {
  zones: readonly AcjuZone[];
  defaultZoneId: number;
}

export const TimetableView: React.FC<TimetableViewProps> = ({
  zones,
  defaultZoneId,
}) => {
  const colombo = getColomboNowParts();
  const [zoneId, setZoneId] = useState(defaultZoneId);
  const [year, setYear] = useState(Math.max(2026, colombo.year));
  const [month, setMonth] = useState(colombo.month);

  useEffect(() => {
    setZoneId(defaultZoneId);
  }, [defaultZoneId]);

  const yearOptions = useMemo(() => {
    const base = Math.max(2026, colombo.year);
    const list: number[] = [];
    for (let y = 2026; y <= base + 4; y++) {
      list.push(y);
    }
    return list;
  }, [colombo.year]);

  const days = useMemo(
    () => resolveEmbeddedMonthSchedules(zoneId, year, month),
    [zoneId, year, month]
  );

  const selectedZone = zones.find((z) => z.id === zoneId);
  const hasVerifiedRows = days.some((d) => d.isVerified && d.times);
  const hasAnnualRepeat = days.some((d) => d.isAnnualRepeat);
  const hasLeapDayUnavailable = days.some((d) => d.scheduleSource === 'unavailable_leap_day');

  const handleExportCsv = () => {
    const verifiedDays = days.filter((d) => d.isVerified && d.times);
    if (verifiedDays.length === 0) return;
    const header = 'date,zone_id,source,fajr,sunrise,dhuhr,asr,maghrib,isha';
    const rows = verifiedDays.map(
      (d) =>
        `${d.targetDate},${d.zoneId},${d.scheduleSource},${d.times!.fajr},${d.times!.sunrise ?? ''},${d.times!.dhuhr},${d.times!.asr},${d.times!.maghrib},${d.times!.isha}`
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-adhan-zone-${zoneId}-${year}-${String(month).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
              Monthly ACJU Timetable
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {selectedZone?.name} · {selectedZone?.officialDescription}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <select
              value={zoneId}
              onChange={(e) => setZoneId(Number(e.target.value))}
              aria-label="Select ACJU Zone"
              className="min-h-[44px] rounded-xl border border-stone-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  Group {z.id} ({z.officialDescription})
                </option>
              ))}
            </select>

            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              aria-label="Select Month"
              className="min-h-[44px] rounded-xl border border-stone-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {MONTH_NAMES.map((name, idx) => (
                <option key={name} value={idx + 1}>
                  {name}
                </option>
              ))}
            </select>

            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              aria-label="Select Year"
              className="min-h-[44px] rounded-xl border border-stone-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y} {y === 2026 ? '(Reference)' : (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? '(Leap Year)' : ''}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={!hasVerifiedRows}
              onClick={handleExportCsv}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-stone-300 bg-stone-50 px-4 text-sm font-medium text-slate-800 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Status / Provenance Notices */}
        <div className="mt-4 space-y-2 text-xs">
          {hasAnnualRepeat && (
            <p className="text-slate-600 dark:text-slate-300">
              Provenance: Entries for {year} are <span className="font-semibold">annual repeats from the official 2026 ACJU reference dataset</span>.
            </p>
          )}
          {hasLeapDayUnavailable && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                29 February ({year}) has no entry in the embedded 2026 ACJU reference timetable, so no times are invented for 29 Feb.
              </span>
            </div>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-xs font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                <th className="px-4 py-3 whitespace-nowrap">Date</th>
                <th className="px-4 py-3 whitespace-nowrap">Fajr</th>
                <th className="px-4 py-3 whitespace-nowrap text-amber-800 dark:text-amber-300">Sunrise</th>
                <th className="px-4 py-3 whitespace-nowrap">Dhuhr</th>
                <th className="px-4 py-3 whitespace-nowrap">Asr</th>
                <th className="px-4 py-3 whitespace-nowrap">Maghrib</th>
                <th className="px-4 py-3 whitespace-nowrap">Isha</th>
                <th className="px-4 py-3 whitespace-nowrap">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-slate-800">
              {days.map((row) => {
                const isToday = row.targetDate === colombo.dateISO;
                return (
                  <tr
                    key={row.targetDate}
                    className={
                      isToday
                        ? 'bg-emerald-50/80 dark:bg-emerald-950/35'
                        : 'hover:bg-stone-50/70 dark:hover:bg-slate-800/40'
                    }
                  >
                    <td className="px-4 py-3 font-mono-tabular whitespace-nowrap font-medium text-slate-900 dark:text-slate-100">
                      {row.targetDate}
                      {isToday && (
                        <span className="ml-2 font-sans text-xs font-medium text-emerald-700 dark:text-emerald-300">
                          Today
                        </span>
                      )}
                    </td>
                    {row.times ? (
                      <>
                        <td className="px-4 py-3 font-mono-tabular whitespace-nowrap text-slate-800 dark:text-slate-200">
                          {formatTime12h(row.times.fajr)}
                        </td>
                        <td className="px-4 py-3 font-mono-tabular whitespace-nowrap text-amber-800 dark:text-amber-300">
                          {row.times.sunrise ? formatTime12h(row.times.sunrise) : '—'}
                        </td>
                        <td className="px-4 py-3 font-mono-tabular whitespace-nowrap text-slate-800 dark:text-slate-200">
                          {formatTime12h(row.times.dhuhr)}
                        </td>
                        <td className="px-4 py-3 font-mono-tabular whitespace-nowrap text-slate-800 dark:text-slate-200">
                          {formatTime12h(row.times.asr)}
                        </td>
                        <td className="px-4 py-3 font-mono-tabular whitespace-nowrap text-slate-800 dark:text-slate-200">
                          {formatTime12h(row.times.maghrib)}
                        </td>
                        <td className="px-4 py-3 font-mono-tabular whitespace-nowrap text-slate-800 dark:text-slate-200">
                          {formatTime12h(row.times.isha)}
                        </td>
                      </>
                    ) : (
                      <td
                        colSpan={6}
                        className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400"
                      >
                        Unavailable — Feb 29 leap-year policy (no invented time)
                      </td>
                    )}
                    <td className="px-4 py-3 text-xs whitespace-nowrap text-slate-600 dark:text-slate-400">
                      {row.scheduleSource === 'official_reference' && 'Official 2026 ACJU'}
                      {row.scheduleSource === 'annual_repeat_2026' && '2026 Annual Repeat'}
                      {row.scheduleSource === 'unavailable_leap_day' && 'Leap Day Policy'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
