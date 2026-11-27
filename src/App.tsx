import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  Bell,
  Calendar,
  Home,
  Play,
  Settings,
  Square,
  Volume2,
  WifiOff,
  X,
} from 'lucide-react';
import { AudioRemindersView } from './components/AudioRemindersView';
import { HomeView, type LiveTestAlarmState } from './components/HomeView';
import { LocationSelectorModal } from './components/LocationSelectorModal';
import { PermissionsModal } from './components/PermissionsModal';
import { PWAInstallButton } from './components/PWAInstallModal';
import { SettingsAboutView } from './components/SettingsAboutView';
import { TimetableView } from './components/TimetableView';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import {
  listLocalAudioTracks,
  playAdhanTrack,
  stopAdhanPlayback,
  unlockAudioForSession,
} from './lib/audioEngine';
import {
  createReminderAdapter,
  type ScheduledReminderSummary,
} from './lib/reminders';
import { resolveEmbeddedDaySchedule } from './shared/acju2026Timetable';
import { ACJU_DISTRICTS, ACJU_ZONES } from './shared/acjuSeed';
import { resolveLocationFromCoordinates } from './shared/locationLookup';
import {
  colomboDateTimeToEpochMs,
  formatTime12h,
  getColomboNowParts,
} from './shared/timetablePolicy';
import {
  PRAYER_LABELS,
  type AdhanAudioTrack,
  type AdvanceMinutesOption,
  type LocationResolution,
  type PrayerName,
  type UserPreferences,
} from './shared/types';

type AppTab = 'today' | 'timetable' | 'audio' | 'settings';

const PREFS_STORAGE_KEY = 'my_adhan_prefs_v2';
const LEGACY_PREFS_STORAGE_KEY = 'my_adhan_prefs_v1';
const LOCATION_STORAGE_KEY = 'my_adhan_location_v1';
const LOCATION_PROMPTED_KEY = 'my_adhan_location_prompted_v1';
const PERMISSIONS_ONBOARDED_KEY = 'my_adhan_permissions_onboarded_v1';
const LOCATION_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const LOCATION_RESUME_MIN_GAP_MS = 60 * 1000;

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
  autoUpdate: boolean;
}

function saveLocationToStorage(loc: SavedLocation): void {
  try {
    localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(loc));
  } catch {
    // Ignore storage errors
  }
}

function loadSavedLocation(): SavedLocation {
  try {
    const raw = localStorage.getItem(LOCATION_STORAGE_KEY);
    if (!raw) return { districtId: 'colombo', detectionMethod: 'manual', autoUpdate: true };
    const parsed = JSON.parse(raw) as Partial<SavedLocation>;
    const hasPromptedBefore = localStorage.getItem(LOCATION_PROMPTED_KEY) === '1';
    return {
      districtId: parsed.districtId || 'colombo',
      detectionMethod: parsed.detectionMethod === 'gps' ? 'gps' : 'manual',
      autoUpdate:
        typeof parsed.autoUpdate === 'boolean'
          ? parsed.autoUpdate
          : parsed.detectionMethod === 'gps' || !hasPromptedBefore,
    };
  } catch {
    return { districtId: 'colombo', detectionMethod: 'manual', autoUpdate: true };
  }
}

async function getGeolocationPermissionState(): Promise<'granted' | 'prompt' | 'denied' | 'unknown'> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return 'denied';
  }
  if ('permissions' in navigator && typeof navigator.permissions?.query === 'function') {
    try {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      return status.state;
    } catch {
      return 'unknown';
    }
  }
  return 'unknown';
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
  const [permissionsModalOpen, setPermissionsModalOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PERMISSIONS_ONBOARDED_KEY) !== '1';
    } catch {
      return false;
    }
  });
  const [activeAdhanAlert, setActiveAdhanAlert] = useState<{
    prayer: PrayerName;
    advanceMinutes: AdvanceMinutesOption;
    prayerTimeHHMM: string;
    isPlaying: boolean;
    audioBlocked: boolean;
    isTest?: boolean;
  } | null>(null);
  const [testAlarm, setTestAlarm] = useState<LiveTestAlarmState | null>(null);

  const [scheduledSummaries, setScheduledSummaries] = useState<ScheduledReminderSummary[]>([]);
  const reminderAdapterRef = useRef(createReminderAdapter());
  const [capabilities, setCapabilities] = useState(() =>
    reminderAdapterRef.current.getCapabilities()
  );

  // Unlock browser audio on the first user gesture so prayer-time Adhan can play automatically
  useEffect(() => {
    const handleFirstGesture = () => {
      void unlockAudioForSession();
    };
    window.addEventListener('pointerdown', handleFirstGesture, { passive: true });
    window.addEventListener('keydown', handleFirstGesture, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', handleFirstGesture);
      window.removeEventListener('keydown', handleFirstGesture);
    };
  }, []);

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

  const lastLocationCheckAtRef = useRef<number>(0);
  const locationCheckInFlightRef = useRef<boolean>(false);

  const handleSelectLocation = useCallback((res: LocationResolution) => {
    if (!res.district) return;
    if (res.detectionMethod === 'gps') {
      try {
        localStorage.setItem(LOCATION_PROMPTED_KEY, '1');
      } catch {
        // Ignore storage errors
      }
    }
    const next: SavedLocation = {
      districtId: res.district.id,
      detectionMethod: res.detectionMethod,
      autoUpdate: res.detectionMethod === 'gps',
    };
    setSavedLocation(next);
    saveLocationToStorage(next);
  }, []);

  const handleToggleAutoUpdateLocation = useCallback((enabled: boolean) => {
    setSavedLocation((prev) => {
      const next: SavedLocation = { ...prev, autoUpdate: enabled };
      saveLocationToStorage(next);
      return next;
    });
  }, []);

  // Ask location permission once on first visit, then check regularly to keep ACJU group/zone updated
  useEffect(() => {
    if (permissionsModalOpen) return;
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return;

    let cancelled = false;
    let permissionStatus: PermissionStatus | null = null;

    const runLocationCheck = (isInitialPromptAttempt: boolean) => {
      if (cancelled || locationCheckInFlightRef.current) return;
      locationCheckInFlightRef.current = true;

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          locationCheckInFlightRef.current = false;
          lastLocationCheckAtRef.current = Date.now();
          try {
            localStorage.setItem(LOCATION_PROMPTED_KEY, '1');
          } catch {
            // Ignore
          }
          if (cancelled) return;

          const resolved = resolveLocationFromCoordinates(
            pos.coords.latitude,
            pos.coords.longitude,
            districts,
            zones
          );

          if (resolved.matched && resolved.district) {
            const matchedDistrictId = resolved.district.id;
            setSavedLocation((prev) => {
              if (!isInitialPromptAttempt && !prev.autoUpdate) return prev;
              if (
                prev.districtId === matchedDistrictId &&
                prev.detectionMethod === 'gps' &&
                prev.autoUpdate
              ) {
                return prev;
              }
              const next: SavedLocation = {
                districtId: matchedDistrictId,
                detectionMethod: 'gps',
                autoUpdate: true,
              };
              saveLocationToStorage(next);
              return next;
            });
          }
        },
        (err) => {
          locationCheckInFlightRef.current = false;
          lastLocationCheckAtRef.current = Date.now();
          try {
            localStorage.setItem(LOCATION_PROMPTED_KEY, '1');
          } catch {
            // Ignore
          }
          if (cancelled) return;

          if (err.code === err.PERMISSION_DENIED) {
            setSavedLocation((prev) => {
              if (!prev.autoUpdate) return prev;
              const next: SavedLocation = { ...prev, autoUpdate: false };
              saveLocationToStorage(next);
              return next;
            });
          }
        },
        {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: isInitialPromptAttempt ? 0 : 60000,
        }
      );
    };

    const checkIfPermitted = async () => {
      if (cancelled || !savedLocation.autoUpdate) return;
      const permState = await getGeolocationPermissionState();
      if (cancelled) return;

      if (permState === 'granted') {
        runLocationCheck(false);
      } else if (permState === 'unknown' && savedLocation.detectionMethod === 'gps') {
        runLocationCheck(false);
      } else if (permState === 'denied') {
        setSavedLocation((prev) => {
          if (!prev.autoUpdate) return prev;
          const next: SavedLocation = { ...prev, autoUpdate: false };
          saveLocationToStorage(next);
          return next;
        });
      }
    };

    const init = async () => {
      let alreadyPrompted = false;
      try {
        alreadyPrompted = localStorage.getItem(LOCATION_PROMPTED_KEY) === '1';
      } catch {
        alreadyPrompted = false;
      }

      const permState = await getGeolocationPermissionState();
      if (cancelled) return;

      // 1. Ask for location permission once on first visit (never re-prompts automatically if dismissed/denied)
      if (!alreadyPrompted && permState !== 'denied') {
        try {
          localStorage.setItem(LOCATION_PROMPTED_KEY, '1');
        } catch {
          // Ignore
        }
        runLocationCheck(true);
      } else if (savedLocation.autoUpdate) {
        // 2. Subsequent visits: silently check if already granted
        if (permState === 'granted' || (permState === 'unknown' && savedLocation.detectionMethod === 'gps')) {
          if (Date.now() - lastLocationCheckAtRef.current > 10000) {
            runLocationCheck(false);
          }
        } else if (permState === 'denied') {
          setSavedLocation((prev) => {
            if (!prev.autoUpdate) return prev;
            const next: SavedLocation = { ...prev, autoUpdate: false };
            saveLocationToStorage(next);
            return next;
          });
        }
      }

      // Listen for browser permission changes if supported
      if ('permissions' in navigator && typeof navigator.permissions?.query === 'function') {
        try {
          permissionStatus = await navigator.permissions.query({ name: 'geolocation' });
          if (!cancelled && permissionStatus) {
            permissionStatus.onchange = () => {
              if (!permissionStatus) return;
              if (permissionStatus.state === 'granted') {
                setSavedLocation((prev) => {
                  const next: SavedLocation = { ...prev, autoUpdate: true };
                  saveLocationToStorage(next);
                  return next;
                });
                runLocationCheck(false);
              } else if (permissionStatus.state === 'denied') {
                setSavedLocation((prev) => {
                  if (!prev.autoUpdate) return prev;
                  const next: SavedLocation = { ...prev, autoUpdate: false };
                  saveLocationToStorage(next);
                  return next;
                });
              }
            };
          }
        } catch {
          // Ignore browsers that reject permissions.query
        }
      }
    };

    void init();

    // 3. Regular periodic location check (every 5 minutes) when auto-update is enabled
    const intervalId = window.setInterval(() => {
      void checkIfPermitted();
    }, LOCATION_CHECK_INTERVAL_MS);

    // 4. Refresh when returning to foreground on mobile/desktop (throttled to avoid rapid triggers)
    const handleResume = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      if (Date.now() - lastLocationCheckAtRef.current < LOCATION_RESUME_MIN_GAP_MS) return;
      void checkIfPermitted();
    };

    document.addEventListener('visibilitychange', handleResume);
    window.addEventListener('focus', handleResume);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleResume);
      window.removeEventListener('focus', handleResume);
      if (permissionStatus) {
        permissionStatus.onchange = null;
      }
    };
  }, [districts, zones, savedLocation.autoUpdate, savedLocation.detectionMethod, permissionsModalOpen]);

  const handleTogglePrayerReminder = (prayer: PrayerName) => {
    updatePreferences({
      perPrayerEnabled: {
        ...preferences.perPrayerEnabled,
        [prayer]: !preferences.perPrayerEnabled[prayer],
      },
    });
  };

  const playSelectedAdhan = useCallback(
    async (mediaTitle?: string, onEnded?: () => void): Promise<boolean> => {
      const localTracks = await listLocalAudioTracks();
      const all = [...BUILTIN_AUDIO_TRACKS, ...localTracks];
      const track = all.find((t) => t.id === preferences.selectedAudioId) ?? all[0];
      if (!track) return false;
      try {
        await playAdhanTrack({
          track,
          volume: preferences.volume,
          playbackMode: preferences.playbackMode,
          mediaTitle: mediaTitle ?? track.title,
          mediaArtist: `${selectedDistrict.name} · ${selectedZone.name}`,
          onEnded,
        });
        return true;
      } catch {
        return false;
      }
    },
    [
      preferences.selectedAudioId,
      preferences.volume,
      preferences.playbackMode,
      selectedDistrict.name,
      selectedZone.name,
    ]
  );

  const handlePreviewSelectedAudio = useCallback(async () => {
    await unlockAudioForSession();
    const ok = await playSelectedAdhan('My Adhan — Audio Test');
    if (!ok) {
      setActiveTab('audio');
    }
  }, [playSelectedAdhan]);

  const handlePrayerTrigger = useCallback(
    async (
      prayer: PrayerName,
      advanceMinutes: AdvanceMinutesOption,
      prayerTimeHHMM: string,
      isTest = false
    ) => {
      const title = isTest
        ? `Sample Adhan Test (${formatTime12h(prayerTimeHHMM)})`
        : advanceMinutes > 0
        ? `${PRAYER_LABELS[prayer]} in ${advanceMinutes} min (${formatTime12h(prayerTimeHHMM)})`
        : `${PRAYER_LABELS[prayer]} Prayer Time (${formatTime12h(prayerTimeHHMM)})`;

      setActiveAdhanAlert({
        prayer,
        advanceMinutes,
        prayerTimeHHMM,
        isPlaying: true,
        audioBlocked: false,
        isTest,
      });

      const played = await playSelectedAdhan(title, () => {
        setActiveAdhanAlert((prev) => (prev ? { ...prev, isPlaying: false } : null));
      });

      if (!played) {
        setActiveAdhanAlert((prev) =>
          prev ? { ...prev, isPlaying: false, audioBlocked: true } : null
        );
      }
    },
    [playSelectedAdhan]
  );

  const handleArmTestAlarm = useCallback(
    async (timeHHMM: string) => {
      if (!/^\d{2}:\d{2}$/.test(timeHHMM)) return;
      await unlockAudioForSession();
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
        await reminderAdapterRef.current.requestPermission();
        setCapabilities(reminderAdapterRef.current.getCapabilities());
      }

      const nowColombo = getColomboNowParts();
      let targetEpochMs = colomboDateTimeToEpochMs(nowColombo.dateISO, timeHHMM);
      if (targetEpochMs <= Date.now()) {
        // If chosen HH:MM has already passed today in Colombo time, schedule for tomorrow
        targetEpochMs = colomboDateTimeToEpochMs(getTomorrowColomboISO(nowColombo.dateISO), timeHHMM);
      }

      setTestAlarm({
        timeHHMM,
        triggerAtEpochMs: targetEpochMs,
        fired: false,
      });

      reminderAdapterRef.current.scheduleTestTime?.({
        triggerAtEpochMs: targetEpochMs,
        timeHHMM,
        zoneName: selectedZone.name,
        onTrigger: (firedHHMM) => {
          setTestAlarm((prev) => (prev ? { ...prev, fired: true } : null));
          void handlePrayerTrigger('isha', 0, firedHHMM, true);
        },
      });
    },
    [selectedZone.name, handlePrayerTrigger]
  );

  const handleClearTestAlarm = useCallback(() => {
    reminderAdapterRef.current.clearTestTime?.();
    setTestAlarm(null);
  }, []);

  // Refresh scheduled reminders whenever schedule, zone, or preferences change
  useEffect(() => {
    const summaries = reminderAdapterRef.current.scheduleDay({
      schedule: todaySchedule,
      preferences,
      zoneName: selectedZone.name,
      onTrigger: (prayer, advanceMinutes, prayerTimeHHMM) => {
        void handlePrayerTrigger(prayer, advanceMinutes, prayerTimeHHMM);
      },
    });
    setScheduledSummaries(summaries);
    setCapabilities(reminderAdapterRef.current.getCapabilities());
  }, [todaySchedule, preferences, selectedZone.name, handlePrayerTrigger]);

  // Check for due/missed prayer alerts whenever app wakes or returns to foreground
  useEffect(() => {
    const checkOnWake = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      reminderAdapterRef.current.checkDueRemindersNow();
    };
    document.addEventListener('visibilitychange', checkOnWake);
    window.addEventListener('focus', checkOnWake);
    window.addEventListener('pageshow', checkOnWake);
    return () => {
      document.removeEventListener('visibilitychange', checkOnWake);
      window.removeEventListener('focus', checkOnWake);
      window.removeEventListener('pageshow', checkOnWake);
    };
  }, []);

  const handleRequestNotificationPermission = async () => {
    await unlockAudioForSession();
    await reminderAdapterRef.current.requestPermission();
    setCapabilities(reminderAdapterRef.current.getCapabilities());
  };

  const handleSendTestNotification = async (): Promise<boolean> => {
    await unlockAudioForSession();
    const sent = await reminderAdapterRef.current.sendTestNotification(selectedZone.name);
    setCapabilities(reminderAdapterRef.current.getCapabilities());
    return sent;
  };

  const handleCompleteOnboarding = useCallback(() => {
    try {
      localStorage.setItem(PERMISSIONS_ONBOARDED_KEY, '1');
      localStorage.setItem(LOCATION_PROMPTED_KEY, '1');
    } catch {
      // Ignore storage errors
    }
    setPermissionsModalOpen(false);
  }, []);

  const handleGrantAllFirstAccessPermissions = useCallback(async () => {
    await unlockAudioForSession();

    // Request Notification permission inside this user tap
    if (typeof window !== 'undefined' && 'Notification' in window) {
      await reminderAdapterRef.current.requestPermission();
      setCapabilities(reminderAdapterRef.current.getCapabilities());
    }

    // Request Geolocation permission once inside this user tap
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        const timer = window.setTimeout(done, 8000);
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            window.clearTimeout(timer);
            lastLocationCheckAtRef.current = Date.now();
            const resolved = resolveLocationFromCoordinates(
              pos.coords.latitude,
              pos.coords.longitude,
              districts,
              zones
            );
            if (resolved.matched && resolved.district) {
              const next: SavedLocation = {
                districtId: resolved.district.id,
                detectionMethod: 'gps',
                autoUpdate: true,
              };
              setSavedLocation(next);
              saveLocationToStorage(next);
            }
            done();
          },
          (err) => {
            window.clearTimeout(timer);
            if (err.code === err.PERMISSION_DENIED) {
              setSavedLocation((prev) => {
                const next: SavedLocation = { ...prev, autoUpdate: false };
                saveLocationToStorage(next);
                return next;
              });
            }
            done();
          },
          { enableHighAccuracy: false, timeout: 7500, maximumAge: 60000 }
        );
      });
    }
  }, [districts, zones]);

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

        {/* Live Prayer Time / Adhan Alert Banner */}
        <AnimatePresence>
          {activeAdhanAlert && (
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              role="alert"
              className="mx-auto mt-3 max-w-6xl px-3.5 sm:px-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-700/50 bg-emerald-900 px-4 py-3 text-white shadow-lg">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Bell className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {activeAdhanAlert.isTest
                        ? 'Sample Adhan (Live Test)'
                        : activeAdhanAlert.advanceMinutes > 0
                        ? `${PRAYER_LABELS[activeAdhanAlert.prayer]} in ${activeAdhanAlert.advanceMinutes} min`
                        : `${PRAYER_LABELS[activeAdhanAlert.prayer]} Prayer Time`}{' '}
                      · {formatTime12h(activeAdhanAlert.prayerTimeHHMM)}
                    </p>
                    <p className="text-xs text-emerald-100/80">
                      {activeAdhanAlert.audioBlocked
                        ? 'Tap Play to start Adhan audio in this browser session'
                        : activeAdhanAlert.isPlaying
                        ? 'Playing Adhan…'
                        : 'Prayer reminder active'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {activeAdhanAlert.isPlaying ? (
                    <button
                      type="button"
                      onClick={() => {
                        stopAdhanPlayback();
                        setActiveAdhanAlert(null);
                      }}
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-amber-300 px-3 py-1.5 text-xs font-semibold text-emerald-950 hover:bg-amber-200"
                    >
                      <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                      <span>Stop Adhan</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={async () => {
                        await unlockAudioForSession();
                        const ok = await playSelectedAdhan(
                          `${PRAYER_LABELS[activeAdhanAlert.prayer]} Prayer Time`,
                          () => setActiveAdhanAlert((prev) => (prev ? { ...prev, isPlaying: false } : null))
                        );
                        setActiveAdhanAlert((prev) =>
                          prev ? { ...prev, isPlaying: ok, audioBlocked: !ok } : null
                        );
                      }}
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-amber-300 px-3 py-1.5 text-xs font-semibold text-emerald-950 hover:bg-amber-200"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                      <span>Play Adhan</span>
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Dismiss prayer alert"
                    onClick={() => {
                      stopAdhanPlayback();
                      setActiveAdhanAlert(null);
                    }}
                    className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-xl text-emerald-100 hover:bg-white/10"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
                  autoUpdateLocation={savedLocation.autoUpdate}
                  todaySchedule={todaySchedule}
                  tomorrowSchedule={tomorrowSchedule}
                  preferences={preferences}
                  testAlarm={testAlarm}
                  onArmTestAlarm={(timeHHMM) => void handleArmTestAlarm(timeHHMM)}
                  onClearTestAlarm={handleClearTestAlarm}
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
                  selectedDistrict={selectedDistrict}
                  selectedZone={selectedZone}
                  onUpdatePreferences={updatePreferences}
                  onRequestNotificationPermission={handleRequestNotificationPermission}
                  onSendTestNotification={handleSendTestNotification}
                />
              )}

              {activeTab === 'settings' && (
                <SettingsAboutView
                  zones={zones}
                  selectedDistrict={selectedDistrict}
                  selectedZone={selectedZone}
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
          autoUpdateLocation={savedLocation.autoUpdate}
          onToggleAutoUpdate={handleToggleAutoUpdateLocation}
          onSelectLocation={handleSelectLocation}
        />

        {/* First-Access Permissions Setup */}
        <PermissionsModal
          isOpen={permissionsModalOpen}
          isIOSBrowserTab={capabilities.isIOS && !capabilities.isStandalonePwa}
          onComplete={handleCompleteOnboarding}
          onGrantAll={handleGrantAllFirstAccessPermissions}
        />
      </div>
    </MotionConfig>
  );
}
