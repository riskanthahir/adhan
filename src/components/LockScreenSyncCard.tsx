import React, { useState } from 'react';
import { CalendarPlus, Check, Smartphone } from 'lucide-react';
import { motion } from 'motion/react';
import { downloadAcjuCalendarIcs } from '../lib/calendarExport';
import type { AcjuDistrict, AcjuZone, UserPreferences } from '../shared/types';

interface LockScreenSyncCardProps {
  district: AcjuDistrict;
  zone: AcjuZone;
  preferences: UserPreferences;
  compact?: boolean;
}

export const LockScreenSyncCard: React.FC<LockScreenSyncCardProps> = ({
  district,
  zone,
  preferences,
  compact = false,
}) => {
  const [exportedCount, setExportedCount] = useState<number | null>(null);

  const handleExport = () => {
    const count = downloadAcjuCalendarIcs({
      zone,
      districtName: district.name,
      perPrayerEnabled: preferences.perPrayerEnabled,
      advanceMinutes: preferences.advanceMinutes,
      daysCount: 30,
    });
    setExportedCount(count);
  };

  return (
    <div
      className={`rounded-2xl border border-stone-200 bg-stone-50/80 dark:border-slate-800 dark:bg-slate-950/60 ${
        compact ? 'p-3.5 sm:p-4' : 'p-4 sm:p-5'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          <Smartphone className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            iPhone Lock Screen Prayer Times (Optional)
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            Add the next 30 days of {district.name} (Group {zone.id}) prayer times to Apple Calendar. Then add the{' '}
            <strong className="font-medium text-slate-800 dark:text-slate-200">Calendar &ldquo;Up Next&rdquo;</strong>{' '}
            widget to your iPhone Lock Screen for live lock-screen prayer times and closed-app alerts.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <motion.button
              whileTap={{ scale: 0.97 }}
              type="button"
              onClick={handleExport}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-emerald-800 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-900 dark:bg-emerald-700 dark:hover:bg-emerald-600"
            >
              <CalendarPlus className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Add 5 Prayers to iPhone Calendar (.ics)</span>
            </motion.button>

            {exportedCount !== null && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-300">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Ready ({exportedCount} events) — tap &ldquo;Add All&rdquo; in Calendar</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
