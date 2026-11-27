import React, { useEffect, useState } from 'react';
import { Bell, Info, Play, Square, Trash2, Upload, Volume2 } from 'lucide-react';
import {
  deleteLocalAudioTrack,
  listLocalAudioTracks,
  playAdhanTrack,
  saveLocalAudioFile,
  stopAdhanPlayback,
} from '../lib/audioEngine';
import type { AdapterCapabilities, ScheduledReminderSummary } from '../lib/reminders';
import { PRAYER_LABELS, PRAYER_NAMES } from '../shared/types';
import type {
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
  onUpdatePreferences: (patch: Partial<UserPreferences>) => void;
  onRequestNotificationPermission: () => Promise<void>;
  onSendTestNotification: () => Promise<void>;
}

const ADVANCE_OPTIONS: AdvanceMinutesOption[] = [0, 5, 10, 15, 30];

export const AudioRemindersView: React.FC<AudioRemindersViewProps> = ({
  serverTracks,
  preferences,
  capabilities,
  scheduledSummaries,
  hasVerifiedToday,
  onUpdatePreferences,
  onRequestNotificationPermission,
  onSendTestNotification,
}) => {
  const [localTracks, setLocalTracks] = useState<AdhanAudioTrack[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioMessage, setAudioMessage] = useState<string | null>(null);
  const [notifFeedback, setNotifFeedback] = useState<string | null>(null);

  useEffect(() => {
    void listLocalAudioTracks().then(setLocalTracks);
    return () => {
      stopAdhanPlayback();
    };
  }, []);

  const allTracks = [...serverTracks, ...localTracks];
  const selectedTrack =
    allTracks.find((t) => t.id === preferences.selectedAudioId) ?? allTracks[0];

  const handleUploadAudio = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioMessage(null);
    try {
      const saved = await saveLocalAudioFile(file);
      const updated = await listLocalAudioTracks();
      setLocalTracks(updated);
      onUpdatePreferences({ selectedAudioId: saved.id, playbackMode: 'full_adhan' });
      setAudioMessage(`Saved "${saved.title}" locally in browser storage for offline playback.`);
    } catch (err) {
      setAudioMessage(`Could not load audio file: ${(err as Error).message}`);
    } finally {
      e.target.value = '';
    }
  };

  const handleDeleteLocalTrack = async (id: string) => {
    stopAdhanPlayback();
    await deleteLocalAudioTrack(id);
    const updated = await listLocalAudioTracks();
    setLocalTracks(updated);
    if (preferences.selectedAudioId === id && serverTracks[0]) {
      onUpdatePreferences({ selectedAudioId: serverTracks[0].id });
    }
  };

  const handlePreview = async (track: AdhanAudioTrack) => {
    setAudioMessage(null);
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
        onEnded: () => setPlayingId(null),
      });
    } catch (err) {
      setPlayingId(null);
      setAudioMessage(
        `Playback blocked or failed: ${(err as Error).message}. Browser audio requires direct user interaction.`
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

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {/* Adhan Audio Library */}
      <section className="lg:col-span-6 space-y-5 rounded-2xl border border-stone-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
            Adhan Audio &amp; Playback
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Includes the default Adhan alarm tone and a synthesized harmonic chime. You may also select your own local Adhan recording (stored only on this device).
          </p>
        </div>

        {/* Playback Mode & Volume */}
        <div className="space-y-4 rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
              Playback Mode
            </span>
            <div className="inline-flex rounded-xl bg-stone-200/80 p-1 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => onUpdatePreferences({ playbackMode: 'short_chime' })}
                className={`min-h-[36px] rounded-lg px-3 text-xs font-medium transition-colors whitespace-nowrap ${
                  preferences.playbackMode === 'short_chime'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                Short Notification
              </button>
              <button
                type="button"
                onClick={() => onUpdatePreferences({ playbackMode: 'full_adhan' })}
                className={`min-h-[36px] rounded-lg px-3 text-xs font-medium transition-colors whitespace-nowrap ${
                  preferences.playbackMode === 'full_adhan'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                Full Adhan
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <Volume2 className="h-4 w-4" aria-hidden="true" />
                Volume
              </span>
              <span className="font-mono-tabular">{Math.round(preferences.volume * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={preferences.volume}
              onChange={(e) => onUpdatePreferences({ volume: Number(e.target.value) })}
              aria-label="Adhan volume"
              className="w-full accent-emerald-700"
            />
          </div>
        </div>

        {/* Audio Tracks List */}
        <div className="divide-y divide-stone-200 rounded-xl border border-stone-200 dark:divide-slate-800 dark:border-slate-800">
          {allTracks.map((track) => {
            const isSelected = selectedTrack?.id === track.id;
            const isPlaying = playingId === track.id;
            return (
              <div
                key={track.id}
                className={`flex items-center justify-between gap-3 p-4 ${
                  isSelected ? 'bg-emerald-50/60 dark:bg-emerald-950/30' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => onUpdatePreferences({ selectedAudioId: track.id })}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {track.title}
                    {isSelected && (
                      <span className="ml-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                        · Active
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {track.reciter} · {track.licenseType}
                    {track.durationSeconds > 0 ? ` · ${track.durationSeconds}s` : ''}
                  </p>
                </button>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handlePreview(track)}
                    aria-label={isPlaying ? `Stop ${track.title}` : `Preview ${track.title}`}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-stone-300 bg-white text-slate-800 hover:bg-stone-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  >
                    {isPlaying ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>
                  {track.isLocalUpload && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteLocalTrack(track.id)}
                      aria-label={`Delete ${track.title}`}
                      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-stone-300 text-rose-700 hover:bg-rose-50 dark:border-slate-700 dark:text-rose-400 dark:hover:bg-rose-950/40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Upload local Adhan audio */}
        <div>
          <label className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-stone-300 bg-stone-50 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-stone-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700">
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span>Select Local Adhan Audio File (MP3 / M4A / WAV)</span>
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => void handleUploadAudio(e)}
              className="sr-only"
            />
          </label>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Custom uploaded audio files stay private in your browser&apos;s IndexedDB storage.
          </p>
          {audioMessage && (
            <p className="mt-2 text-xs text-emerald-800 dark:text-emerald-300">{audioMessage}</p>
          )}
        </div>
      </section>

      {/* Prayer Reminders & Honest iOS PWA Limitations */}
      <section className="lg:col-span-6 space-y-5 rounded-2xl border border-stone-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
              Prayer Reminders
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Permission: <span className="font-medium">{capabilities.permissionState}</span> · Adapter: {capabilities.adapterName}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void onRequestNotificationPermission()}
              className="min-h-[44px] rounded-xl bg-emerald-800 px-3.5 py-2 text-xs font-medium text-white hover:bg-emerald-900 whitespace-nowrap dark:bg-emerald-700 dark:hover:bg-emerald-600"
            >
              Enable Notifications
            </button>
            <button
              type="button"
              onClick={async () => {
                await onSendTestNotification();
                setNotifFeedback('Test notification triggered (check your device notification tray).');
              }}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-stone-300 px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-stone-50 whitespace-nowrap dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Bell className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Test Alert</span>
            </button>
          </div>
        </div>

        {notifFeedback && (
          <p className="text-xs text-emerald-800 dark:text-emerald-300">{notifFeedback}</p>
        )}

        {!hasVerifiedToday && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            Reminders are paused today (February 29 leap-year boundary) because no prayer times are invented for dates outside the 2026 ACJU reference timetable.
          </div>
        )}

        {/* Per-prayer reminder rules */}
        <div className="divide-y divide-stone-200 rounded-xl border border-stone-200 dark:divide-slate-800 dark:border-slate-800">
          {PRAYER_NAMES.map((prayer) => {
            const enabled = preferences.perPrayerEnabled[prayer];
            const advance = preferences.advanceMinutes[prayer];
            const scheduled = scheduledSummaries.find((s) => s.prayer === prayer);

            return (
              <div
                key={prayer}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {PRAYER_LABELS[prayer]}
                  </p>
                  {scheduled && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {scheduled.alreadySent
                        ? 'Already delivered today (deduplicated)'
                        : `Scheduled for ${new Date(scheduled.triggerAtEpochMs).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}`}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={advance}
                    disabled={!enabled}
                    onChange={(e) =>
                      handleAdvanceChange(prayer, Number(e.target.value) as AdvanceMinutesOption)
                    }
                    aria-label={`${PRAYER_LABELS[prayer]} advance reminder`}
                    className="min-h-[40px] rounded-lg border border-stone-300 bg-white px-2.5 text-xs text-slate-800 disabled:opacity-45 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                  >
                    {ADVANCE_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m === 0 ? 'At prayer time' : `${m} min early`}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    onClick={() => handleTogglePrayer(prayer)}
                    className={`min-h-[40px] min-w-[64px] rounded-lg px-3 text-xs font-medium transition-colors ${
                      enabled
                        ? 'bg-emerald-800 text-white dark:bg-emerald-700'
                        : 'bg-stone-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {enabled ? 'On' : 'Off'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Honest Platform Limitations & AlarmKit Architecture */}
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
          <div className="flex items-start gap-2.5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            <div className="space-y-1.5">
              <p className="font-semibold text-slate-900 dark:text-slate-100">
                iOS Safari &amp; Browser PWA Delivery Limitations
              </p>
              <p>
                {capabilities.notes} Full Adhan audio cannot be guaranteed when the PWA is closed or backgrounded on iPhone. Browser audio playback also requires at least one user tap per session to unlock Web Audio.
              </p>
              <p>
                For guaranteed lock-screen alarms with custom Adhan audio when closed, My Adhan exposes a typed <code className="font-mono-tabular">ReminderAdapter</code> interface ready for a future native iOS <code className="font-mono-tabular">AlarmKit</code> wrapper.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
