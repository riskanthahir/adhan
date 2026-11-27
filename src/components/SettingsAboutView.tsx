import React from 'react';
import { LockScreenSyncCard } from './LockScreenSyncCard';
import { PWAInstallButton } from './PWAInstallModal';
import type { AcjuDistrict, AcjuZone, UserPreferences } from '../shared/types';

interface SettingsAboutViewProps {
  zones: readonly AcjuZone[];
  selectedDistrict: AcjuDistrict;
  selectedZone: AcjuZone;
  preferences: UserPreferences;
  onUpdatePreferences: (patch: Partial<UserPreferences>) => void;
}

export const SettingsAboutView: React.FC<SettingsAboutViewProps> = ({
  zones,
  selectedDistrict,
  selectedZone,
  preferences,
  onUpdatePreferences,
}) => {
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {/* Preferences */}
      <section className="lg:col-span-5 space-y-5 rounded-2xl border border-stone-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          App Settings &amp; PWA
        </h1>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 border-b border-stone-100 pb-4 dark:border-slate-800">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Appearance</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Light, dark, or match device</p>
            </div>
            <select
              value={preferences.theme}
              onChange={(e) =>
                onUpdatePreferences({
                  theme: e.target.value as UserPreferences['theme'],
                })
              }
              aria-label="Theme appearance"
              className="min-h-[44px] rounded-xl border border-stone-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          <div className="flex items-center justify-between gap-4 border-b border-stone-100 pb-4 dark:border-slate-800">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Timezone</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Fixed to Sri Lanka Standard Time (UTC+05:30)</p>
            </div>
            <span className="font-mono-tabular text-sm font-medium text-emerald-800 dark:text-emerald-300">
              Asia/Colombo
            </span>
          </div>

          <div className="flex items-center justify-between gap-4 border-b border-stone-100 pb-4 dark:border-slate-800">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Offline Dataset
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                All 4,745 daily records (13 ACJU groups × 365 days) are embedded directly in the app for instant offline use.
              </p>
            </div>
          </div>

          <div className="pt-1">
            <p className="mb-2 text-sm font-medium text-slate-900 dark:text-slate-100">
              Install Progressive Web App
            </p>
            <PWAInstallButton />
          </div>

          <div className="pt-1">
            <LockScreenSyncCard
              district={selectedDistrict}
              zone={selectedZone}
              preferences={preferences}
              compact
            />
          </div>
        </div>
      </section>

      {/* About, Timetable Policy & 13 ACJU Groups */}
      <section className="lg:col-span-7 space-y-5 rounded-2xl border border-stone-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
            ACJU Data Policy &amp; 13 Official Zones
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            All-Ceylon Jamiyyathul Ulama (ACJU) Sri Lanka Prayer Timetable Standards
          </p>
        </div>

        <div className="space-y-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          <p>
            <strong className="text-slate-900 dark:text-slate-100">Embedded Official 2026 ACJU Timetable:</strong>{' '}
            My Adhan embeds the complete 2026 official ACJU prayer timetable across all 13 geographical groups (4,745 daily entries). It never estimates or fabricates prayer times.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-100">Annual Repeat Policy (2027+):</strong>{' '}
            For years after 2026, dates are automatically matched by month and day against the embedded 2026 ACJU reference timetable and clearly labelled as annual repeats.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-100">Safe Leap-Year February 29 Policy:</strong>{' '}
            Because 2026 is not a leap year, 29 February has no entry in the 2026 ACJU reference dataset. My Adhan never silently copies 28 February or invents a time for 29 February.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-100">Hijri Calendar Note:</strong>{' '}
            Displayed Hijri dates are tabular approximations and may differ by one day from official Sri Lankan moon-sighting announcements.
          </p>
        </div>

        <div className="border-t border-stone-200 pt-4 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            The 13 Official ACJU Geographical Groups
          </h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {zones.map((z) => (
              <div
                key={z.id}
                className="rounded-xl border border-stone-200 bg-stone-50/70 px-3.5 py-2.5 text-xs dark:border-slate-800 dark:bg-slate-950/50"
              >
                <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                  Group {z.id}
                </span>{' '}
                <span className="text-slate-700 dark:text-slate-300">
                  · {z.officialDescription}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};
