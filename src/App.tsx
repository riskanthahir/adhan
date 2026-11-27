import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  Calendar,
  Home,
  Settings,
  Volume2,
  WifiOff,
} from 'lucide-react';
import { AudioRemindersView } from './components/AudioRemindersView';
import { HomeView } from './components/HomeView';
import { LocationSelectorModal } from './components/LocationSelectorModal';
import { PWAInstallButton } from './components/PWAInstallModal';
import { SettingsAboutView } from './components/SettingsAboutView';
import { TimetableView } from './components/TimetableView';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { listLocalAudioTracks, playAdhanTrack } from './lib/audioEngine';
import {
  createReminderAdapter,
  type ScheduledReminderSummary,
} from './lib/reminders';
import { resolveEmbeddedDaySchedule } from './shared/acju2026Timetable';
import { ACJU_DISTRICTS, ACJU_ZONES } from './shared/acjuSeed';
import { getColomboNowParts } from './shared/timetablePolicy';
import type {
  AdhanAudioTrack,
  LocationResolution,
  PrayerName,
  UserPreferences,
} from './shared/types';

type AppTab = 'today' | 'timetable' | 'audio' | 'settings';

const PREFS_STORAGE_KEY = 'my_adhan_prefs_v2';
const LEGACY_PREFS_STORAGE_KEY = 'my_adhan_prefs_v1';
const LOCATION_STORAGE_KEY = 'my_adhan_location_v1';

const BUILTIN_AUDIO_TRACKS: AdhanAudioTrack[] = [
  {
    id: 'default-adhan-tone',
    title: 'Adhan (Default Alarm Tone)',
    reciter: 'Standard Adhan Recording',
    licenseType: 'App Default Asset',
    licenseUrl: null,
    storagePath: '/assets/aistudio/Adhan_a222d363.mp3',
    durationSeconds: 205,
    isShortChime: false,
  },
  {
    id: 'builtin-harmonic-chime',
    title: 'Gentle Harmonic Chime (Built-in)',
    reciter: 'Synthesized Web Audio',
    licenseType: 'CC0 / Royalty-Free',
    licenseUrl: null,
    storagePath: 'builtin://harmonic-chime',
    durationSeconds: 4,
    isShortChime: true,
  },
];

const DEFAULT_PREFERENCES: UserPreferences = {
  timezone: 'Asia/Colombo',
  perPrayerEnabled: {
    fajr: true,
    dhuhr: true,
    asr: true,
    maghrib: true,
    isha: true,
  },
  advanceMinutes: {
    fajr: 0,
    dhuhr: 0,
    asr: 0,
    maghrib: 0,
    isha: 0,
  },
  selectedAudioId: 'default-adhan-tone',
  playbackMode: 'full_adhan',
  volume: 0.8,
  theme: 'system',
  allowDemoSamplePreview: false,
};

function loadSavedPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UserPreferences>;
      return {
        ...DEFAULT_PREFERENCES,
        ...parsed,
        timezone: 'Asia/Colombo',
        perPrayerEnabled: {
          ...DEFAULT_PREFERENCES.perPrayerEnabled,
          ...(parsed.perPrayerEnabled ?? {}),
        },
        advanceMinutes: {
          ...DEFAULT_PREFERENCES.advanceMinutes,
          ...(parsed.advanceMinutes ?? {}),
        },
      };
    }

    const legacyRaw = localStorage.getItem(LEGACY_PREFS_STORAGE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as Partial<UserPreferences>;
      const hasCustomLocalUpload = Boolean(legacy.selectedAudioId?.startsWith('local-'));
      const migrated: UserPreferences = {
        ...DEFAULT_PREFERENCES,
        ...legacy,
        timezone: 'Asia/Colombo',
        selectedAudioId: hasCustomLocalUpload
          ? (legacy.selectedAudioId as string)
          : DEFAULT_PREFERENCES.selectedAudioId,
        playbackMode: hasCustomLocalUpload
          ? (legacy.playbackMode ?? DEFAULT_PREFERENCES.playbackMode)
          : DEFAULT_PREFERENCES.playbackMode,
        perPrayerEnabled: {
          ...DEFAULT_PREFERENCES.perPrayerEnabled,
          ...(legacy.perPrayerEnabled ?? {}),
        },
        advanceMinutes: {
          ...DEFAULT_PREFERENCES.advanceMinutes,
          ...(legacy.advanceMinutes ?? {}),
        },
      };
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }

    return DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

interface SavedLocation {
  districtId: string;
  detectionMethod: 'gps' | 'manual';
}

function loadSavedLocation(): SavedLocation {
  try {
    const raw = localStorage.getItem(LOCATION_STORAGE_KEY);
    if (!raw) return { districtId: 'colombo', detectionMethod: 'manual' };
    const parsed = JSON.parse(raw) as Partial<SavedLocation>;
    return {
      districtId: parsed.districtId || 'colombo',
      detectionMethod: parsed.detectionMethod === 'gps' ? 'gps' : 'manual',
    };
  } catch {
    return { districtId: 'colombo', detectionMethod: 'manual' };
  }
}

function getTomorrowColomboISO(todayISO: string): string {
  const [y, m, d] = todayISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;
}

export default function App() {
  const isOnline = useOnlineStatus();
  const [activeTab, setActiveTab] = useState<AppTab>('today');
  const zones = ACJU_ZONES;
  const districts = ACJU_DISTRICTS;

  const [preferences, setPreferences] = useState<UserPreferences>(loadSavedPreferences);
  const [savedLocation, setSavedLocation] = useState<SavedLocation>(loadSavedLocation);
  const [locationModalOpen, setLocationModalOpen] = useState(false);

  const [scheduledSummaries, setScheduledSummaries] = useState<ScheduledReminderSummary[]>([]);
  const reminderAdapterRef = useRef(createReminderAdapter());
  const [capabilities, setCapabilities] = useState(() =>
    reminderAdapterRef.current.getCapabilities()
  );

  // Sync theme to documentElement
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const shouldDark =
        preferences.theme === 'dark' || (preferences.theme === 'system' && prefersDark);
      root.classList.toggle('dark', shouldDark);
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [preferences.theme]);

  const selectedDistrict = useMemo(
    () => districts.find((d) => d.id === savedLocation.districtId) ?? districts[0],
    [districts, savedLocation.districtId]
  );

  const selectedZone = useMemo(
    () => zones.find((z) => z.id === selectedDistrict.zoneId) ?? zones[0],
    [zones, selectedDistrict.zoneId]
  );

  // Track Asia/Colombo date rollover so schedules refresh at midnight Colombo time
  const [colomboDateISO, setColomboDateISO] = useState(() => getColomboNowParts().dateISO);
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = getColomboNowParts().dateISO;
      setColomboDateISO((prev) => (prev !== next ? next : prev));
    }, 30000);
    return () => window.clearInterval(id);
  }, []);

  const todaySchedule = useMemo(
    () => resolveEmbeddedDaySchedule(selectedZone.id, colomboDateISO),
    [selectedZone.id, colomboDateISO]
  );

  const tomorrowSchedule = useMemo(
    () => resolveEmbeddedDaySchedule(selectedZone.id, getTomorrowColomboISO(colomboDateISO)),
    [selectedZone.id, colomboDateISO]
  );

  const updatePreferences = useCallback((patch: Partial<UserPreferences>) => {
    setPreferences((prev) => {
      const next: UserPreferences = {
        ...prev,
        ...patch,
        timezone: 'Asia/Colombo',
      };
      try {
        localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

  const handleSelectLocation = (res: LocationResolution) => {
    if (!res.district) return;
    const next: SavedLocation = {
      districtId: res.district.id,
      detectionMethod: res.detectionMethod,
    };
    setSavedLocation(next);
    try {
      localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore
    }
  };

  const handleTogglePrayerReminder = (prayer: PrayerName) => {
    updatePreferences({
      perPrayerEnabled: {
        ...preferences.perPrayerEnabled,
        [prayer]: !preferences.perPrayerEnabled[prayer],
      },
    });
  };

  const handlePreviewSelectedAudio = useCallback(async () => {
    const localTracks = await listLocalAudioTracks();
    const all = [...BUILTIN_AUDIO_TRACKS, ...localTracks];
    const track = all.find((t) => t.id === preferences.selectedAudioId) ?? all[0];
    if (!track) return;
    try {
      await playAdhanTrack({
        track,
        volume: preferences.volume,
        playbackMode: preferences.playbackMode,
      });
    } catch {
      setActiveTab('audio');
    }
  }, [preferences.selectedAudioId, preferences.volume, preferences.playbackMode]);

  // Refresh scheduled reminders whenever schedule, zone, or preferences change
  useEffect(() => {
    const summaries = reminderAdapterRef.current.scheduleDay({
      schedule: todaySchedule,
      preferences,
      zoneName: selectedZone.name,
      onTrigger: () => {
        void handlePreviewSelectedAudio();
      },
    });
    setScheduledSummaries(summaries);
    setCapabilities(reminderAdapterRef.current.getCapabilities());
  }, [todaySchedule, preferences, selectedZone.name, handlePreviewSelectedAudio]);

  const handleRequestNotificationPermission = async () => {
    await reminderAdapterRef.current.requestPermission();
    setCapabilities(reminderAdapterRef.current.getCapabilities());
  };

  const handleSendTestNotification = async () => {
    await reminderAdapterRef.current.sendTestNotification(selectedZone.name);
    setCapabilities(reminderAdapterRef.current.getCapabilities());
  };

  const navItems: ReadonlyArray<{ id: AppTab; label: string; icon: React.ReactNode }> = [
    { id: 'today', label: 'Today', icon: <Home className="h-5 w-5" /> },
    { id: 'timetable', label: 'Timetable', icon: <Calendar className="h-5 w-5" /> },
    { id: 'audio', label: 'Audio', icon: <Volume2 className="h-5 w-5" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="h-5 w-5" /> },
  ];

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-stone-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        {/* Clean Top Header */}
        <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/90 backdrop-blur-md pt-safe dark:border-slate-800 dark:bg-slate-950/90">
          <div className="mx-auto flex h-[52px] max-w-6xl items-center justify-between gap-8 px-4 sm:h-16 sm:px-6">
            <button
              type="button"
              onClick={() => setActiveTab('today')}
              className="font-display text-lg font-bold tracking-tight text-emerald-900 whitespace-nowrap shrink-0 dark:text-emerald-300"
            >
              My Adhan
            </button>

            <nav className="hidden md:flex items-center gap-6" aria-label="Primary navigation">
              {navItems.map((item) => {
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`relative min-h-[44px] text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'text-emerald-900 dark:text-emerald-300'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                    }`}
                  >
                    {item.label}
                    {active && (
                      <motion.span
                        layoutId="desktop-nav-underline"
                        transition={{ type: 'spring', stiffness: 450, damping: 36 }}
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-800 dark:bg-emerald-400"
                      />
                    )}
                  </button>
                );
              })}
            </nav>

            <div className="hidden sm:flex items-center gap-2 shrink-0">
              <PWAInstallButton compact />
            </div>
          </div>
        </header>

        {/* Main Content with Smooth View Transitions */}
        <main className="mx-auto max-w-6xl px-3.5 py-4 pb-24 sm:px-6 sm:py-6 md:pb-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              {activeTab === 'today' && (
                <HomeView
                  selectedDistrict={selectedDistrict}
                  selectedZone={selectedZone}
                  detectionMethod={savedLocation.detectionMethod}
                  todaySchedule={todaySchedule}
                  tomorrowSchedule={tomorrowSchedule}
                  preferences={preferences}
                  onOpenLocationModal={() => setLocationModalOpen(true)}
                  onTogglePrayerReminder={handleTogglePrayerReminder}
                  onPreviewAudio={() => void handlePreviewSelectedAudio()}
                  onNavigateTab={(tab) => setActiveTab(tab)}
                />
              )}

              {activeTab === 'timetable' && (
                <TimetableView
                  zones={zones}
                  defaultZoneId={selectedZone.id}
                />
              )}

              {activeTab === 'audio' && (
                <AudioRemindersView
                  serverTracks={BUILTIN_AUDIO_TRACKS}
                  preferences={preferences}
                  capabilities={capabilities}
                  scheduledSummaries={scheduledSummaries}
                  hasVerifiedToday={Boolean(todaySchedule.isVerified && todaySchedule.times)}
                  onUpdatePreferences={updatePreferences}
                  onRequestNotificationPermission={handleRequestNotificationPermission}
                  onSendTestNotification={handleSendTestNotification}
                />
              )}

              {activeTab === 'settings' && (
                <SettingsAboutView
                  zones={zones}
                  preferences={preferences}
                  onUpdatePreferences={updatePreferences}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Mobile Thumb-Zone Bottom Tab Bar */}
        <nav
          aria-label="Mobile navigation"
          className="fixed bottom-0 left-0 right-0 z-40 border-t border-stone-200 bg-white/95 backdrop-blur-md pb-safe md:hidden dark:border-slate-800 dark:bg-slate-950/95"
        >
          <div className="grid h-14 grid-cols-4">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`relative flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                    active
                      ? 'text-emerald-800 dark:text-emerald-300'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="mobile-nav-indicator"
                      transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                      className="absolute top-0 left-4 right-4 h-0.5 rounded-b bg-emerald-700 dark:bg-emerald-400"
                    />
                  )}
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Offline Indicator */}
        {!isOnline && (
          <div
            role="status"
            className="fixed bottom-16 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-800 px-3 py-2 text-xs font-medium text-white shadow-lg md:bottom-4"
          >
            <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Offline mode — embedded timetable active</span>
          </div>
        )}

        {/* Location & Zone Modal */}
        <LocationSelectorModal
          isOpen={locationModalOpen}
          onClose={() => setLocationModalOpen(false)}
          districts={districts}
          zones={zones}
          currentDistrictId={selectedDistrict.id}
          onSelectLocation={handleSelectLocation}
        />
      </div>
    </MotionConfig>
  );
}
