import React, { useEffect, useState } from 'react';
import {
  Bell,
  BellOff,
  Calendar,
  MapPin,
  Volume2,
} from 'lucide-react';
import {
  computeNextPrayer,
  formatTime12h,
  getColomboNowParts,
  getEstimatedHijriDate,
} from '../shared/timetablePolicy';
import {
  PRAYER_LABELS,
  PRAYER_NAMES,
  type AcjuDistrict,
  type AcjuZone,
  type PrayerName,
  type ResolvedDaySchedule,
  type UserPreferences,
} from '../shared/types';

interface HomeViewProps {
  selectedDistrict: AcjuDistrict;
  selectedZone: AcjuZone;
  detectionMethod: 'gps' | 'manual';
  todaySchedule: ResolvedDaySchedule;
  tomorrowSchedule: ResolvedDaySchedule;
  preferences: UserPreferences;
  onOpenLocationModal: () => void;
  onTogglePrayerReminder: (prayer: PrayerName) => void;
  onPreviewAudio: () => void;
  onNavigateTab: (tab: 'timetable' | 'audio' | 'settings') => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  selectedDistrict,
  selectedZone,
  detectionMethod,
  todaySchedule,
  tomorrowSchedule,
  preferences,
  onOpenLocationModal,
  onTogglePrayerReminder,
  onPreviewAudio,
  onNavigateTab,
}) => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const colombo = getColomboNowParts(now);
  const hijriEstimated = getEstimatedHijriDate(now);
  const nextPrayer =
    todaySchedule.times
      ? computeNextPrayer(todaySchedule, tomorrowSchedule, now)
      : null;

  const canScheduleReminders = Boolean(todaySchedule.isVerified && todaySchedule.times);

  return (
    <div className="space-y-6">
      {/* Location & Date Header */}
      <section className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
              <span>{colombo.formattedGregorian}</span>
              <span aria-hidden="true">·</span>
              <span>Asia/Colombo ({colombo.formattedTime})</span>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-300">
              {hijriEstimated}{' '}
              <span className="text-xs text-slate-500 dark:text-slate-400">
                (Estimated Hijri date — subject to Sri Lanka crescent sighting)
              </span>
            </p>
            <div className="pt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl dark:text-slate-50">
                {selectedDistrict.name}
                {selectedDistrict.isAreaOverride ? `, ${selectedDistrict.parentDistrict}` : ''}
              </h1>
              <span className="text-sm text-slate-500 dark:text-slate-400">·</span>
              <span className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                ACJU Group {selectedZone.id} ({selectedZone.officialDescription})
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Location source: {detectionMethod === 'gps' ? 'On-demand GPS lookup' : 'Manual selection'}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenLocationModal}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-stone-300 bg-stone-50 px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-stone-100 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              <MapPin className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <span>Change Area</span>
            </button>
          </div>
        </div>
      </section>

      {todaySchedule.scheduleSource === 'annual_repeat_2026' && (
        <div className="rounded-2xl border border-stone-200 bg-stone-100/80 px-4 py-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300">
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            Annual Repeat Policy Active:
          </span>{' '}
          Showing {todaySchedule.targetDate} matched by month and day from the official{' '}
          <span className="font-medium">2026 ACJU reference timetable</span>.
        </div>
      )}

      {/* Main Content Split: Next Prayer Spotlight (left/top) + 5 Prayer Cards (right/bottom) */}
      {!todaySchedule.times ? (
        <section className="rounded-2xl border border-stone-200 bg-white p-6 sm:p-8 dark:border-slate-800 dark:bg-slate-900">
          <div className="max-w-xl space-y-3">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              {todaySchedule.scheduleSource === 'unavailable_leap_day'
                ? 'Leap-Year 29 February Policy'
                : `Schedule Unavailable for Group ${selectedZone.id}`}
            </h2>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {todaySchedule.statusMessage}
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => onNavigateTab('timetable')}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-stone-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-stone-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Calendar className="h-4 w-4" aria-hidden="true" />
                <span>View Monthly Timetable</span>
              </button>
            </div>
          </div>
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
          {/* Focal Next Prayer Countdown Card */}
          <section className="lg:col-span-5 rounded-2xl bg-emerald-900 p-6 text-white shadow-sm dark:bg-emerald-950 dark:border dark:border-emerald-800/60">
            <div className="flex items-center justify-between text-xs text-emerald-200">
              <span>
                {todaySchedule.isAnnualRepeat
                  ? 'Official 2026 ACJU (Annual Repeat)'
                  : `Official ${todaySchedule.sourceYear ?? 2026} ACJU Timetable`}
              </span>
              <span>Group {selectedZone.id}</span>
            </div>

            {nextPrayer ? (
              <div className="mt-5">
                <p className="text-sm text-emerald-100/90">
                  Next prayer {nextPrayer.isTomorrow ? 'tomorrow' : 'today'}
                </p>
                <div className="mt-1 flex items-baseline justify-between gap-4">
                  <h2 className="text-3xl font-semibold tracking-tight text-white">
                    {nextPrayer.label}
                  </h2>
                  <span className="font-mono-tabular text-2xl font-medium text-amber-300">
                    {formatTime12h(nextPrayer.timeHHMM)}
                  </span>
                </div>
                <div className="mt-6 border-t border-emerald-800/80 pt-4">
                  <p className="text-xs text-emerald-200">Time remaining (Asia/Colombo)</p>
                  <p className="mt-1 font-mono-tabular text-4xl font-semibold tracking-tight text-white">
                    {nextPrayer.countdownFormatted}
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-5">
                <h2 className="text-xl font-semibold">All five daily prayers completed</h2>
                <p className="mt-2 text-sm text-emerald-100/80">
                  Tomorrow&apos;s Fajr schedule is unavailable for this leap-year boundary.
                </p>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-emerald-800/80 pt-4">
              <button
                type="button"
                onClick={onPreviewAudio}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-white/20"
              >
                <Volume2 className="h-4 w-4" aria-hidden="true" />
                <span>Test Adhan / Chime</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('audio')}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-emerald-100 transition-colors hover:bg-white/10"
              >
                <span>Reminder Settings</span>
              </button>
            </div>
          </section>

          {/* Five Daily Prayer Cards */}
          <section className="lg:col-span-7 space-y-3" aria-label="Daily prayer times">
            {PRAYER_NAMES.map((prayer) => {
              const time24 = todaySchedule.times![prayer];
              const isNext = nextPrayer && !nextPrayer.isTomorrow && nextPrayer.prayer === prayer;
              const enabled = preferences.perPrayerEnabled[prayer];
              const advance = preferences.advanceMinutes[prayer];

              return (
                <div
                  key={prayer}
                  className={`flex min-h-[68px] items-center justify-between gap-4 rounded-2xl border px-5 py-3.5 transition-colors ${
                    isNext
                      ? 'border-emerald-700 bg-emerald-50/70 dark:border-emerald-600 dark:bg-emerald-950/40'
                      : 'border-stone-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold text-slate-900 dark:text-slate-50">
                        {PRAYER_LABELS[prayer]}
                      </span>
                      {isNext && (
                        <span className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                          · Next
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {!canScheduleReminders
                        ? 'Reminders paused'
                        : enabled
                        ? advance > 0
                          ? `Reminder ${advance} min before`
                          : 'Reminder at prayer time'
                        : 'Reminder off'}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p className="font-mono-tabular text-lg font-semibold text-slate-900 dark:text-slate-50">
                        {formatTime12h(time24)}
                      </p>
                      <p className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
                        {time24}
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={!canScheduleReminders}
                      onClick={() => onTogglePrayerReminder(prayer)}
                      aria-label={`Toggle ${PRAYER_LABELS[prayer]} reminder`}
                      aria-pressed={enabled && canScheduleReminders}
                      className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        enabled && canScheduleReminders
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'border-stone-200 bg-stone-50 text-slate-500 hover:bg-stone-100 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {enabled && canScheduleReminders ? (
                        <Bell className="h-4 w-4" />
                      ) : (
                        <BellOff className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        </div>
      )}
    </div>
  );
};
