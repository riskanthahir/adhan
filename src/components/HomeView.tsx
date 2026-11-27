import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bell,
  BellOff,
  Calendar,
  ChevronRight,
  MapPin,
  Volume2,
} from 'lucide-react';
import {
  colomboDateTimeToEpochMs,
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

  // Smooth progress ratio toward the next prayer for visual transition indicator
  const countdownProgress = useMemo(() => {
    if (!nextPrayer || !todaySchedule.times) return 0;
    const nowMs = now.getTime();
    const targetDate = nextPrayer.isTomorrow ? tomorrowSchedule.targetDate : todaySchedule.targetDate;
    const nextMs = colomboDateTimeToEpochMs(targetDate, nextPrayer.timeHHMM);

    let prevMs = nextMs - 6 * 3600 * 1000;
    if (nextPrayer.isTomorrow) {
      prevMs = colomboDateTimeToEpochMs(todaySchedule.targetDate, todaySchedule.times.isha);
    } else {
      const idx = PRAYER_NAMES.indexOf(nextPrayer.prayer);
      if (idx > 0) {
        const prevPrayer = PRAYER_NAMES[idx - 1];
        prevMs = colomboDateTimeToEpochMs(todaySchedule.targetDate, todaySchedule.times[prevPrayer]);
      }
    }

    const total = Math.max(1, nextMs - prevMs);
    const elapsed = Math.max(0, Math.min(total, nowMs - prevMs));
    return Math.round((elapsed / total) * 1000) / 10;
  }, [nextPrayer, todaySchedule, tomorrowSchedule, now]);

  const locationDisplay = `${selectedDistrict.name}${
    selectedDistrict.isAreaOverride ? `, ${selectedDistrict.parentDistrict}` : ''
  }`;

  return (
    <div className="space-y-4 sm:space-y-6">
      {!todaySchedule.times ? (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-8 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="max-w-xl space-y-4">
            <button
              type="button"
              onClick={onOpenLocationModal}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-stone-300 bg-stone-50 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-stone-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <MapPin className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <span>{locationDisplay}</span>
              <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            </button>

            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                {todaySchedule.scheduleSource === 'unavailable_leap_day'
                  ? 'Leap-Year 29 February Policy'
                  : `Schedule Unavailable for Group ${selectedZone.id}`}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                {todaySchedule.statusMessage}
              </p>
            </div>

            <button
              type="button"
              onClick={() => onNavigateTab('timetable')}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-stone-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-stone-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Calendar className="h-4 w-4" aria-hidden="true" />
              <span>View Monthly Timetable</span>
            </button>
          </div>
        </motion.section>
      ) : (
        <div className="grid gap-4 sm:gap-6 lg:grid-cols-12 lg:items-start">
          {/* Sleek Next Prayer Hero Card (Location + Date + Live Countdown + Quick Actions) */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="relative lg:col-span-5 overflow-hidden rounded-3xl border border-emerald-700/40 bg-gradient-to-br from-emerald-950 via-[#0b3d2b] to-[#062319] p-5 sm:p-6 text-white shadow-[0_20px_45px_-18px_rgba(6,78,59,0.55)]"
          >
            {/* Subtle atmospheric glow & hairline sheen */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-20 -right-16 h-52 w-52 rounded-full bg-amber-300/12 blur-3xl"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/10"
            />

            {/* Sleek Top Location & Live Clock Bar */}
            <div className="relative flex items-start justify-between gap-3">
              <div className="min-w-0">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  type="button"
                  onClick={onOpenLocationModal}
                  aria-label="Change Sri Lanka area or ACJU zone"
                  className="group inline-flex min-h-[38px] max-w-full items-center gap-2 rounded-2xl bg-white/[0.08] px-3.5 py-1.5 text-left text-xs font-medium text-white ring-1 ring-inset ring-white/12 backdrop-blur-sm transition-colors hover:bg-white/[0.14]"
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
                  <span className="truncate">{locationDisplay}</span>
                  <ChevronRight
                    className="h-3.5 w-3.5 shrink-0 text-emerald-200/80 transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </motion.button>
                <p className="mt-2.5 text-xs text-emerald-100/80">
                  {colombo.formattedGregorian} · {hijriEstimated} (Est.)
                </p>
                <p className="mt-0.5 text-[11px] text-emerald-200/60">
                  {selectedZone.officialDescription} · {detectionMethod === 'gps' ? 'GPS' : 'Manual'}
                </p>
              </div>

              <div className="shrink-0 text-right pt-0.5">
                <p className="font-mono-tabular text-sm font-semibold tracking-tight text-white/95">
                  {colombo.formattedTime}
                </p>
                <p className="mt-0.5 text-[10px] font-medium tracking-[0.12em] uppercase text-emerald-200/60">
                  Colombo
                </p>
              </div>
            </div>

            {/* Inset Glass Countdown Panel */}
            {nextPrayer ? (
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${nextPrayer.prayer}-${nextPrayer.isTomorrow ? 'tmw' : 'tdy'}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  className="relative mt-4 sm:mt-5 rounded-2xl bg-black/22 p-4 sm:p-5 ring-1 ring-inset ring-white/10 backdrop-blur-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-medium tracking-[0.14em] uppercase text-emerald-200/75">
                      Next prayer {nextPrayer.isTomorrow ? 'tomorrow' : 'today'}
                    </p>
                    <span className="font-mono-tabular text-base sm:text-lg font-semibold text-amber-300">
                      {formatTime12h(nextPrayer.timeHHMM)}
                    </span>
                  </div>

                  <div className="mt-1 flex items-baseline justify-between gap-3">
                    <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
                      {nextPrayer.label}
                    </h1>
                  </div>

                  <div className="mt-4 space-y-2.5 border-t border-white/10 pt-3.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-xs text-emerald-100/70">Time remaining</p>
                      <p className="font-mono-tabular text-2xl sm:text-3xl font-semibold tracking-tight text-white">
                        {nextPrayer.countdownFormatted}
                      </p>
                    </div>
                    <div
                      aria-hidden="true"
                      className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"
                    >
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-amber-300 to-emerald-300"
                        initial={{ width: 0 }}
                        animate={{ width: `${countdownProgress}%` }}
                        transition={{ duration: 0.5, ease: 'easeOut' }}
                      />
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>
            ) : (
              <div className="relative mt-4 sm:mt-5 rounded-2xl bg-black/22 p-4 ring-1 ring-inset ring-white/10">
                <h1 className="text-lg sm:text-xl font-semibold">All five daily prayers completed</h1>
                <p className="mt-1.5 text-xs sm:text-sm text-emerald-100/80">
                  Tomorrow&apos;s Fajr schedule is unavailable for this leap-year boundary.
                </p>
              </div>
            )}

            {/* Quick Actions */}
            <div className="relative mt-4 sm:mt-5 grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:items-center">
              <motion.button
                whileTap={{ scale: 0.97 }}
                type="button"
                onClick={onPreviewAudio}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-white/[0.12] px-4 py-2 text-xs font-medium text-white ring-1 ring-inset ring-white/15 transition-colors hover:bg-white/[0.18]"
              >
                <Volume2 className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                <span className="truncate">Test Adhan</span>
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.97 }}
                type="button"
                onClick={() => onNavigateTab('audio')}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-transparent px-4 py-2 text-xs font-medium text-emerald-100/90 ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/[0.08]"
              >
                <span className="truncate">Reminder Settings</span>
              </motion.button>
            </div>
          </motion.section>

          {/* Five Daily Prayer Cards */}
          <section className="lg:col-span-7 space-y-2.5 sm:space-y-3" aria-label="Daily prayer times">
            {PRAYER_NAMES.map((prayer, idx) => {
              const time24 = todaySchedule.times![prayer];
              const isNext = nextPrayer && !nextPrayer.isTomorrow && nextPrayer.prayer === prayer;
              const enabled = preferences.perPrayerEnabled[prayer];
              const advance = preferences.advanceMinutes[prayer];

              return (
                <motion.div
                  key={prayer}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.24,
                    delay: idx * 0.04,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className={`flex min-h-[60px] sm:min-h-[68px] items-center justify-between gap-3 sm:gap-4 rounded-2xl border px-4 py-2.5 sm:px-5 sm:py-3.5 transition-colors ${
                    isNext
                      ? 'border-emerald-700 bg-emerald-50/70 shadow-xs dark:border-emerald-600 dark:bg-emerald-950/40'
                      : 'border-stone-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-50">
                        {PRAYER_LABELS[prayer]}
                      </span>
                      {isNext && (
                        <motion.span
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="text-xs font-medium text-emerald-800 dark:text-emerald-300"
                        >
                          · Next
                        </motion.span>
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

                  <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
                    <div className="text-right">
                      <p className="font-mono-tabular text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-50">
                        {formatTime12h(time24)}
                      </p>
                      <p className="font-mono-tabular text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                        {time24}
                      </p>
                    </div>

                    <motion.button
                      whileTap={{ scale: 0.92 }}
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
                    </motion.button>
                  </div>
                </motion.div>
              );
            })}
          </section>
        </div>
      )}

      {todaySchedule.scheduleSource === 'annual_repeat_2026' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, delay: 0.2 }}
          className="rounded-2xl border border-stone-200 bg-stone-100/80 px-4 py-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300"
        >
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            Annual Repeat Policy Active:
          </span>{' '}
          Showing {todaySchedule.targetDate} matched by month and day from the official{' '}
          <span className="font-medium">2026 ACJU reference timetable</span>.
        </motion.div>
      )}
    </div>
  );
};
