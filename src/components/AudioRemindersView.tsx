import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bell,
  Check,
  ChevronDown,
  Info,
  Music,
  Play,
  Square,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  deleteLocalAudioTrack,
  listLocalAudioTracks,
  playAdhanTrack,
  saveLocalAudioFile,
  stopAdhanPlayback,
  unlockAudioForSession,
} from '../lib/audioEngine';
import type { BackendSubscriptionSummary } from '../lib/webPushClient';
import { LockScreenSyncCard } from './LockScreenSyncCard';
import type { AdapterCapabilities, ScheduledReminderSummary } from '../lib/reminders';
import { PRAYER_LABELS, PRAYER_NAMES } from '../shared/types';
import type {
  AcjuDistrict,
  AcjuZone,
  AdhanAudioTrack,
  AdvanceMinutesOption,
  PrayerName,
  UserPreferences,
} from '../shared/types';

interface AudioRemindersViewProps {
  serverTracks: AdhanAudioTrack[];
  preferences: UserPreferences;
  capabilities: AdapterCapabilities;
  scheduledSummaries: ScheduledReminderSummary[];
  hasVerifiedToday: boolean;
  selectedDistrict: AcjuDistrict;
  selectedZone: AcjuZone;
  backendPushSubscription: BackendSubscriptionSummary | null;
  pushBusy: boolean;
  pushFeedback: string | null;
  onUpdatePreferences: (patch: Partial<UserPreferences>) => void;
  onEnableBackgroundPush: () => Promise<void>;
  onDisableBackgroundPush: () => Promise<void>;
  onSendBackgroundTestPush: () => Promise<void>;
  onOpenDiagnostics: () => void;
}

const ADVANCE_OPTIONS: AdvanceMinutesOption[] = [0, 5, 10, 15, 30];

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const AudioRemindersView: React.FC<AudioRemindersViewProps> = ({
  serverTracks,
  preferences,
  capabilities,
  scheduledSummaries,
  hasVerifiedToday,
  selectedDistrict,
  selectedZone,
  backendPushSubscription,
  pushBusy,
  pushFeedback,
  onUpdatePreferences,
  onEnableBackgroundPush,
  onDisableBackgroundPush,
  onSendBackgroundTestPush,
  onOpenDiagnostics,
}) => {
  const [localTracks, setLocalTracks] = useState<AdhanAudioTrack[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioMessage, setAudioMessage] = useState<string | null>(null);
  const [showIosDetails, setShowIosDetails] = useState(false);

  useEffect(() => {
    void listLocalAudioTracks().then(setLocalTracks);
  }, []);

  const allTracks = [...serverTracks, ...localTracks];
  const selectedTrack =
    allTracks.find((t) => t.id === preferences.selectedAudioId) ?? allTracks[0];

  const isSelectedPlaying = Boolean(selectedTrack && playingId === selectedTrack.id);

  const handleUploadAudio = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioMessage(null);
    try {
      const saved = await saveLocalAudioFile(file);
      const updated = await listLocalAudioTracks();
      setLocalTracks(updated);
      onUpdatePreferences({ selectedAudioId: saved.id, playbackMode: 'full_adhan' });
      setAudioMessage(`Saved "${saved.title}" locally on this device.`);
    } catch (err) {
      setAudioMessage(`Could not load audio file: ${(err as Error).message}`);
    } finally {
      e.target.value = '';
    }
  };

  const handleDeleteLocalTrack = async (id: string) => {
    stopAdhanPlayback();
    if (playingId === id) setPlayingId(null);
    await deleteLocalAudioTrack(id);
    const updated = await listLocalAudioTracks();
    setLocalTracks(updated);
    if (preferences.selectedAudioId === id && serverTracks[0]) {
      onUpdatePreferences({ selectedAudioId: serverTracks[0].id });
    }
  };

  const handlePreview = async (track: AdhanAudioTrack) => {
    setAudioMessage(null);
    await unlockAudioForSession();
    if (playingId === track.id) {
      stopAdhanPlayback();
      setPlayingId(null);
      return;
    }
    try {
      setPlayingId(track.id);
      await playAdhanTrack({
        track,
        volume: preferences.volume,
        playbackMode: preferences.playbackMode,
        mediaTitle: `${track.title} (Preview)`,
        mediaArtist: `${selectedDistrict.name} · ${selectedZone.name}`,
        onEnded: () => setPlayingId(null),
      });
    } catch (err) {
      setPlayingId(null);
      setAudioMessage(
        `Playback blocked or failed: ${(err as Error).message}. Tap again to allow browser audio.`
      );
    }
  };

  const handleTogglePrayer = (prayer: PrayerName) => {
    onUpdatePreferences({
      perPrayerEnabled: {
        ...preferences.perPrayerEnabled,
        [prayer]: !preferences.perPrayerEnabled[prayer],
      },
    });
  };

  const handleAdvanceChange = (prayer: PrayerName, val: AdvanceMinutesOption) => {
    onUpdatePreferences({
      advanceMinutes: {
        ...preferences.advanceMinutes,
        [prayer]: val,
      },
    });
  };

  const permissionLabel =
    capabilities.permissionState === 'granted'
      ? 'Granted'
      : capabilities.permissionState === 'denied'
      ? 'Denied'
      : capabilities.permissionState === 'unsupported'
      ? 'Unsupported'
      : 'Not requested (default)';

  const subscriptionStatusLabel =
    backendPushSubscription?.status === 'active'
      ? 'Active (Background Web Push)'
      : backendPushSubscription?.status === 'disabled'
      ? 'Disabled'
      : backendPushSubscription?.status === 'expired'
      ? 'Expired — tap Enable to renew'
      : backendPushSubscription?.status === 'invalid'
      ? 'Invalid — tap Enable to renew'
      : 'Not Subscribed';

  const formatTimestamp = (iso: string | null | undefined) => {
    if (!iso) return 'Not registered yet';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  };

  return (
    <div className="grid gap-4 sm:gap-6 lg:grid-cols-12 lg:items-start">
      {/* Left Column: Sleek Audio Studio + Track Library */}
      <div className="lg:col-span-6 space-y-4 sm:space-y-5">
        {/* Sleek Active Tone Studio Card */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="relative overflow-hidden rounded-3xl border border-emerald-700/40 bg-gradient-to-br from-emerald-950 via-[#0b3d2b] to-[#062319] p-5 sm:p-6 text-white shadow-[0_20px_45px_-18px_rgba(6,78,59,0.5)]"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full bg-amber-300/12 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/10"
          />

          {/* Top Studio Header */}
          <div className="relative flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium tracking-[0.14em] uppercase text-emerald-200/75">
                Active Alarm Tone
              </p>
              <h1 className="mt-1 text-lg sm:text-xl font-semibold tracking-tight text-white">
                Adhan Audio Studio
              </h1>
            </div>

            {/* Animated 4-bar equalizer */}
            <div className="flex h-7 items-end gap-1 px-1" aria-hidden="true">
              {[0.5, 0.9, 0.65, 1].map((h, i) => (
                <motion.span
                  key={i}
                  className={`w-1 rounded-full ${
                    isSelectedPlaying ? 'bg-amber-300' : 'bg-white/25'
                  }`}
                  animate={
                    isSelectedPlaying
                      ? {
                          height: ['28%', `${h * 100}%`, '36%', `${Math.max(0.4, 1.1 - h) * 100}%`],
                        }
                      : { height: `${Math.round(h * 45)}%` }
                  }
                  transition={
                    isSelectedPlaying
                      ? {
                          duration: 0.75 + i * 0.12,
                          repeat: Infinity,
                          repeatType: 'reverse',
                          ease: 'easeInOut',
                        }
                      : { duration: 0.25 }
                  }
                />
              ))}
            </div>
          </div>

          {/* Now Selected Track + Quick Preview Button */}
          {selectedTrack && (
            <div className="relative mt-4 flex items-center justify-between gap-3 rounded-2xl bg-black/22 p-3.5 sm:p-4 ring-1 ring-inset ring-white/10">
              <div className="min-w-0">
                <p className="truncate text-sm sm:text-base font-semibold text-white">
                  {selectedTrack.title}
                </p>
                <p className="mt-0.5 truncate text-xs text-emerald-100/70">
                  {selectedTrack.reciter} · {formatDuration(selectedTrack.durationSeconds)}
                </p>
              </div>
              <motion.button
                whileTap={{ scale: 0.93 }}
                type="button"
                onClick={() => void handlePreview(selectedTrack)}
                aria-label={isSelectedPlaying ? 'Stop preview' : 'Play preview'}
                className="inline-flex h-11 min-w-[44px] shrink-0 items-center justify-center gap-2 rounded-2xl bg-amber-300 px-4 text-xs font-semibold text-emerald-950 shadow-sm transition-colors hover:bg-amber-200"
              >
                {isSelectedPlaying ? (
                  <>
                    <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                    <span>Stop</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                    <span>Preview</span>
                  </>
                )}
              </motion.button>
            </div>
          )}

          {/* Segmented Playback Mode + Smooth Volume Slider */}
          <div className="relative mt-4 space-y-4">
            <div className="grid grid-cols-2 rounded-2xl bg-black/25 p-1 ring-1 ring-inset ring-white/10">
              {(
                [
                  { id: 'full_adhan', label: 'Full Adhan' },
                  { id: 'short_chime', label: 'Short Chime' },
                ] as const
              ).map((mode) => {
                const active = preferences.playbackMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => onUpdatePreferences({ playbackMode: mode.id })}
                    className={`relative min-h-[40px] rounded-xl px-3 text-xs font-medium transition-colors ${
                      active ? 'text-emerald-950' : 'text-emerald-100/80 hover:text-white'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="playback-mode-indicator"
                        transition={{ type: 'spring', stiffness: 460, damping: 35 }}
                        className="absolute inset-0 rounded-xl bg-white shadow-xs"
                      />
                    )}
                    <span className="relative z-10">{mode.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-emerald-100/80">
                <span className="flex items-center gap-1.5">
                  {preferences.volume === 0 ? (
                    <VolumeX className="h-4 w-4 text-emerald-200/70" aria-hidden="true" />
                  ) : (
                    <Volume2 className="h-4 w-4 text-amber-300" aria-hidden="true" />
                  )}
                  <span>Alarm Volume</span>
                </span>
                <span className="font-mono-tabular font-medium text-white">
                  {Math.round(preferences.volume * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={preferences.volume}
                onChange={(e) => onUpdatePreferences({ volume: Number(e.target.value) })}
                aria-label="Adhan volume"
                className="h-2 w-full cursor-pointer accent-amber-300"
              />
            </div>
          </div>
        </motion.section>

        {/* Sound Library & Local Upload Card */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
          className="space-y-4 rounded-3xl border border-stone-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Available Recordings
            </h2>
            <span className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
              {allTracks.length} {allTracks.length === 1 ? 'track' : 'tracks'}
            </span>
          </div>

          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {allTracks.map((track) => {
                const isSelected = selectedTrack?.id === track.id;
                const isPlaying = playingId === track.id;
                return (
                  <motion.div
                    key={track.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: 0.2 }}
                    className={`flex items-center justify-between gap-2.5 rounded-2xl border p-3 transition-colors ${
                      isSelected
                        ? 'border-emerald-700 bg-emerald-50/75 dark:border-emerald-600 dark:bg-emerald-950/35'
                        : 'border-stone-200 bg-stone-50/50 hover:bg-stone-50 dark:border-slate-800 dark:bg-slate-950/40 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onUpdatePreferences({ selectedAudioId: track.id })}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors ${
                          isSelected
                            ? 'bg-emerald-800 text-white dark:bg-emerald-600'
                            : 'bg-stone-200/70 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {isSelected ? (
                          <Check className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Music className="h-4 w-4" aria-hidden="true" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          {track.title}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                          {track.reciter} · {formatDuration(track.durationSeconds)}
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <motion.button
                        whileTap={{ scale: 0.92 }}
                        type="button"
                        onClick={() => void handlePreview(track)}
                        aria-label={isPlaying ? `Stop ${track.title}` : `Preview ${track.title}`}
                        className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border transition-colors ${
                          isPlaying
                            ? 'border-emerald-700 bg-emerald-800 text-white dark:border-emerald-500 dark:bg-emerald-700'
                            : 'border-stone-300 bg-white text-slate-800 hover:bg-stone-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'
                        }`}
                      >
                        {isPlaying ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </motion.button>

                      {track.isLocalUpload && (
                        <motion.button
                          whileTap={{ scale: 0.92 }}
                          type="button"
                          onClick={() => void handleDeleteLocalTrack(track.id)}
                          aria-label={`Delete ${track.title}`}
                          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-stone-300 bg-white text-rose-700 hover:bg-rose-50 dark:border-slate-700 dark:bg-slate-800 dark:text-rose-400 dark:hover:bg-rose-950/40"
                        >
                          <Trash2 className="h-4 w-4" />
                        </motion.button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {/* Local Audio File Picker */}
          <div>
            <label className="flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-stone-300 bg-stone-50/80 px-4 py-2.5 text-xs sm:text-sm font-medium text-slate-700 transition-colors hover:border-emerald-600 hover:bg-emerald-50/40 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-200 dark:hover:border-emerald-500">
              <Upload className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <span>Add Custom Adhan File (MP3 / M4A / WAV)</span>
              <input
                type="file"
                accept="audio/*"
                onChange={(e) => void handleUploadAudio(e)}
                className="sr-only"
              />
            </label>
            <AnimatePresence>
              {audioMessage && (
                <motion.p
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-2 text-xs text-emerald-800 dark:text-emerald-300"
                >
                  {audioMessage}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </motion.section>
      </div>

      {/* Right Column: Smart Prayer Reminders & iOS Delivery Notes */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
        className="lg:col-span-6 space-y-4 sm:space-y-5 rounded-3xl border border-stone-200 bg-white p-4 sm:p-6 dark:border-slate-800 dark:bg-slate-900"
      >
        {/* Header + Background Web Push Controls & Status */}
        <div className="space-y-3.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-slate-50">
                Background Push &amp; Prayer Reminders
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Server-scheduled iOS Home Screen &amp; Web Push alerts (works when closed or locked)
              </p>
            </div>
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                backendPushSubscription?.status === 'active'
                  ? 'bg-emerald-500'
                  : capabilities.permissionState === 'denied'
                  ? 'bg-rose-500'
                  : 'bg-amber-400'
              }`}
            />
          </div>

          {/* Primary Push Actions */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <motion.button
              whileTap={{ scale: 0.97 }}
              type="button"
              disabled={pushBusy}
              onClick={() => void onEnableBackgroundPush()}
              className="min-h-[44px] rounded-2xl bg-emerald-800 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-900 disabled:opacity-55 dark:bg-emerald-700 dark:hover:bg-emerald-600"
            >
              {pushBusy
                ? 'Working…'
                : backendPushSubscription?.status === 'active'
                ? 'Renew Push Subscription'
                : 'Enable Prayer Notifications'}
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.97 }}
              type="button"
              disabled={pushBusy || backendPushSubscription?.status !== 'active'}
              onClick={() => void onSendBackgroundTestPush()}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-2xl border border-stone-300 bg-stone-50 px-3.5 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-stone-100 disabled:opacity-45 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <Bell className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <span>Send Test Notification</span>
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.97 }}
              type="button"
              disabled={pushBusy || !backendPushSubscription || backendPushSubscription.status === 'disabled'}
              onClick={() => void onDisableBackgroundPush()}
              className="min-h-[44px] rounded-2xl border border-stone-300 bg-white px-3.5 py-2 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-45 dark:border-slate-700 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-950/30"
            >
              Disable Notifications
            </motion.button>
          </div>

          <AnimatePresence>
            {pushFeedback && (
              <motion.p
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-xl bg-emerald-50/80 px-3 py-2 text-xs text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
              >
                {pushFeedback}
              </motion.p>
            )}
          </AnimatePresence>

          {/* Subscription Telemetry Box */}
          <dl className="space-y-1.5 rounded-2xl border border-stone-200 bg-stone-50/80 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/60">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Subscription Status</dt>
              <dd className="font-semibold text-slate-900 dark:text-slate-100">
                {subscriptionStatusLabel}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Permission Status</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-200">{permissionLabel}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Last Registered</dt>
              <dd className="font-mono-tabular text-[11px] text-slate-700 dark:text-slate-300">
                {formatTimestamp(backendPushSubscription?.lastRegisteredAt)}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-2">
              <dt className="shrink-0 text-slate-500 dark:text-slate-400">Last Delivery Error</dt>
              <dd className="text-right text-[11px] text-rose-700 dark:text-rose-300 break-words">
                {backendPushSubscription?.lastDeliveryError ?? 'None'}
              </dd>
            </div>
          </dl>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {backendPushSubscription?.nextScheduledPrayer
                ? `Server next: ${backendPushSubscription.nextScheduledPrayer.label} (${backendPushSubscription.nextScheduledPrayer.timeHHMM})`
                : `District: ${selectedDistrict.name} · ${selectedZone.name}`}
            </span>
            <button
              type="button"
              onClick={onOpenDiagnostics}
              className="text-xs font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-900 dark:text-emerald-300"
            >
              Open Push Diagnostics
            </button>
          </div>
        </div>

        {!hasVerifiedToday && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            Reminders are paused today (February 29 leap-year boundary) because no prayer times are invented for dates outside the 2026 ACJU reference timetable.
          </div>
        )}

        {/* Per-Prayer Rules with Spring Switches */}
        <div className="divide-y divide-stone-100 rounded-2xl border border-stone-200 dark:divide-slate-800/80 dark:border-slate-800">
          {PRAYER_NAMES.map((prayer) => {
            const enabled = preferences.perPrayerEnabled[prayer];
            const advance = preferences.advanceMinutes[prayer];
            const scheduled = scheduledSummaries.find((s) => s.prayer === prayer);

            return (
              <div
                key={prayer}
                className="flex items-center justify-between gap-3 px-3.5 py-3 sm:px-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {PRAYER_LABELS[prayer]}
                  </p>
                  {scheduled ? (
                    <p className="mt-0.5 truncate text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                      {scheduled.alreadySent
                        ? 'Delivered today'
                        : `At ${new Date(scheduled.triggerAtEpochMs).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}`}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[11px] sm:text-xs text-slate-400 dark:text-slate-500">
                      {enabled ? 'Active' : 'Muted'}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  <select
                    value={advance}
                    disabled={!enabled}
                    onChange={(e) =>
                      handleAdvanceChange(prayer, Number(e.target.value) as AdvanceMinutesOption)
                    }
                    aria-label={`${PRAYER_LABELS[prayer]} advance reminder`}
                    className="min-h-[40px] rounded-xl border border-stone-300 bg-white px-2.5 text-xs text-slate-800 disabled:opacity-45 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                  >
                    {ADVANCE_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m === 0 ? 'On time' : `${m}m early`}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`Toggle ${PRAYER_LABELS[prayer]} reminder`}
                    onClick={() => handleTogglePrayer(prayer)}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors ${
                      enabled
                        ? 'bg-emerald-700 dark:bg-emerald-600'
                        : 'bg-stone-300 dark:bg-slate-700'
                    }`}
                  >
                    <motion.span
                      layout
                      transition={{ type: 'spring', stiffness: 520, damping: 34 }}
                      className={`h-5 w-5 rounded-full bg-white shadow-xs ${
                        enabled ? 'ml-auto' : 'mr-auto'
                      }`}
                    />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Optional iPhone Lock Screen Calendar Sync */}
        <LockScreenSyncCard
          district={selectedDistrict}
          zone={selectedZone}
          preferences={preferences}
          compact
        />

        {/* Collapsible iOS & Browser Limitations Accordion (keeps mobile viewport compact) */}
        <div className="rounded-2xl border border-stone-200 bg-stone-50/70 dark:border-slate-800 dark:bg-slate-950/50">
          <button
            type="button"
            onClick={() => setShowIosDetails((prev) => !prev)}
            aria-expanded={showIosDetails}
            className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 py-3 text-left"
          >
            <span className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <Info className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <span>iOS Safari &amp; Background Playback Notes</span>
            </span>
            <motion.span
              animate={{ rotate: showIosDetails ? 180 : 0 }}
              transition={{ duration: 0.2 }}
              className="text-slate-400"
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </motion.span>
          </button>

          <AnimatePresence initial={false}>
            {showIosDetails && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="space-y-2 border-t border-stone-200 px-4 py-3 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:text-slate-400">
                  <p>
                    <strong>Background Web Push (Closed / Locked iPhone):</strong> On iOS 16.4+ installed Home Screen apps, server-scheduled Web Push displays a standard iPhone Lock Screen &amp; Notification Center banner with the standard iOS notification sound.
                  </p>
                  <p>
                    <strong>Adhan Audio Playback (Manual / Open App):</strong> Apple iOS does not allow Web Push notifications to trigger custom 3-minute MP3 Adhan audio while the iPhone is locked or the app is closed. Manual Adhan playback and in-app alarm tones play whenever the app is open on screen.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.section>
    </div>
  );
};
