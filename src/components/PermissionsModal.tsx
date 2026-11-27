import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  MapPin,
  ShieldCheck,
  Volume2,
  X,
} from 'lucide-react';

export type LocationPermissionUiState =
  | 'idle'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'unavailable';

interface PermissionsModalProps {
  isOpen: boolean;
  isIOSBrowserTab: boolean;
  notificationState: NotificationPermission | 'unsupported';
  locationState: LocationPermissionUiState;
  locationLabel?: string | null;
  locationMessage?: string | null;
  audioUnlocked: boolean;
  onRequestLocation: () => Promise<LocationPermissionUiState>;
  onRequestNotifications: () => Promise<NotificationPermission | 'unsupported'>;
  onUnlockAudio: () => Promise<boolean>;
  onComplete: () => void;
}

export const PermissionsModal: React.FC<PermissionsModalProps> = ({
  isOpen,
  isIOSBrowserTab,
  notificationState,
  locationState,
  locationLabel,
  locationMessage,
  audioUnlocked,
  onRequestLocation,
  onRequestNotifications,
  onUnlockAudio,
  onComplete,
}) => {
  const [notifRequesting, setNotifRequesting] = useState(false);
  const [audioRequesting, setAudioRequesting] = useState(false);
  const [notifHint, setNotifHint] = useState<string | null>(null);

  const canPromptNotifications =
    !isIOSBrowserTab && notificationState === 'default';
  const canPromptLocation =
    locationState === 'idle' || locationState === 'unavailable';

  // Auto-finish smoothly if both Location & Notifications are granted (or N/A) and Audio is ready
  useEffect(() => {
    if (!isOpen) return;
    const locationDone = locationState === 'granted';
    const notifDone =
      notificationState === 'granted' ||
      notificationState === 'unsupported' ||
      isIOSBrowserTab;
    if (locationDone && notifDone && audioUnlocked) {
      const id = window.setTimeout(() => {
        onComplete();
      }, 450);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [
    isOpen,
    locationState,
    notificationState,
    isIOSBrowserTab,
    audioUnlocked,
    onComplete,
  ]);

  const handleAllowLocationTap = () => {
    if (locationState === 'requesting') return;
    // Trigger geolocation synchronously first; unlock audio alongside without awaiting beforehand
    const locPromise = onRequestLocation();
    void onUnlockAudio();
    void locPromise;
  };

  const handleAllowNotificationsTap = () => {
    if (notifRequesting) return;
    setNotifHint(null);
    setNotifRequesting(true);
    // CRITICAL FOR IPHONE: Call Notification.requestPermission() synchronously inside tap
    // before any async audio unlock so iOS WebKit honors the user gesture.
    const permPromise = onRequestNotifications();
    void onUnlockAudio();
    void permPromise
      .then((perm) => {
        if (perm === 'denied') {
          setNotifHint(
            'Blocked in iPhone/browser settings. Enable Notifications for My Adhan in Settings or sync Apple Calendar.'
          );
        } else if (perm === 'default') {
          setNotifHint(
            'Prompt was dismissed or skipped by iOS. Tap Allow again or enable notifications in iPhone Settings.'
          );
        }
      })
      .finally(() => {
        setNotifRequesting(false);
      });
  };

  const handleEnableAudioTap = () => {
    if (audioRequesting) return;
    setAudioRequesting(true);
    void onUnlockAudio().finally(() => {
      setAudioRequesting(false);
    });
  };

  // Determine the single next synchronous action for the primary button
  let primaryLabel = 'Continue to My Adhan';
  let primaryBusy = false;
  let onPrimaryClick: () => void = onComplete;

  if (canPromptLocation || locationState === 'requesting') {
    primaryLabel =
      locationState === 'requesting'
        ? 'Checking Location…'
        : canPromptNotifications
        ? 'Step 1: Allow Location Access'
        : 'Allow Location Access';
    primaryBusy = locationState === 'requesting';
    onPrimaryClick = handleAllowLocationTap;
  } else if (canPromptNotifications || notifRequesting) {
    primaryLabel = notifRequesting
      ? 'Waiting for Notification Access…'
      : 'Allow Prayer Notifications';
    primaryBusy = notifRequesting;
    onPrimaryClick = handleAllowNotificationsTap;
  } else if (!audioUnlocked) {
    primaryLabel = audioRequesting
      ? 'Enabling Adhan Audio…'
      : 'Enable Adhan Audio & Continue';
    primaryBusy = audioRequesting;
    onPrimaryClick = () => {
      if (audioRequesting) return;
      setAudioRequesting(true);
      void onUnlockAudio().finally(() => {
        setAudioRequesting(false);
        onComplete();
      });
    };
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="permissions-modal-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-md rounded-t-3xl border border-stone-200 bg-white p-5 sm:p-6 shadow-2xl sm:rounded-3xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-800 text-white dark:bg-emerald-700">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2
                    id="permissions-modal-title"
                    className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-50"
                  >
                    Allow Required Permissions
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Tap each permission below so iOS shows the access prompt
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onComplete}
                aria-label="Skip permissions setup"
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-400 hover:bg-stone-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-2.5">
              {/* Location Access Row */}
              <div className="flex items-start justify-between gap-3 rounded-2xl border border-stone-200 bg-stone-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/50">
                <div className="flex items-start gap-2.5 min-w-0">
                  <MapPin
                    className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Location Access
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                      {locationState === 'granted'
                        ? locationLabel
                          ? `Detected: ${locationLabel}`
                          : 'Location access is already active.'
                        : locationMessage ??
                          'Detects your Sri Lanka district & ACJU group automatically.'}
                    </p>
                  </div>
                </div>
                <div className="shrink-0">
                  {locationState === 'granted' ? (
                    <span className="inline-flex items-center gap-1 rounded-xl bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Allowed
                    </span>
                  ) : locationState === 'denied' ? (
                    <span className="inline-flex items-center gap-1 rounded-xl bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                      <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      Blocked
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={locationState === 'requesting'}
                      onClick={handleAllowLocationTap}
                      className="min-h-[36px] rounded-xl bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-900 disabled:opacity-60 dark:bg-emerald-700 dark:hover:bg-emerald-600"
                    >
                      {locationState === 'requesting' ? 'Asking…' : 'Allow'}
                    </button>
                  )}
                </div>
              </div>

              {/* Notifications Row */}
              <div className="flex items-start justify-between gap-3 rounded-2xl border border-stone-200 bg-stone-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/50">
                <div className="flex items-start gap-2.5 min-w-0">
                  <Bell
                    className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Prayer Time Notifications
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                      {isIOSBrowserTab
                        ? 'Open from the saved Home Screen icon on iPhone to enable iOS notifications.'
                        : notifHint ??
                          'Shows alerts when each prayer time arrives.'}
                    </p>
                  </div>
                </div>
                <div className="shrink-0">
                  {notificationState === 'granted' ? (
                    <span className="inline-flex items-center gap-1 rounded-xl bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Allowed
                    </span>
                  ) : notificationState === 'denied' ? (
                    <span className="inline-flex items-center gap-1 rounded-xl bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                      <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      Blocked
                    </span>
                  ) : isIOSBrowserTab || notificationState === 'unsupported' ? (
                    <span className="inline-flex rounded-xl bg-stone-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {isIOSBrowserTab ? 'PWA Only' : 'N/A'}
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={notifRequesting}
                      onClick={handleAllowNotificationsTap}
                      className="min-h-[36px] rounded-xl bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-900 disabled:opacity-60 dark:bg-emerald-700 dark:hover:bg-emerald-600"
                    >
                      {notifRequesting ? 'Asking…' : 'Allow'}
                    </button>
                  )}
                </div>
              </div>

              {/* Adhan Audio Row */}
              <div className="flex items-start justify-between gap-3 rounded-2xl border border-stone-200 bg-stone-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/50">
                <div className="flex items-start gap-2.5 min-w-0">
                  <Volume2
                    className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Adhan Audio Playback
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                      Unlocks browser audio so Adhan can play at prayer time while open.
                    </p>
                  </div>
                </div>
                <div className="shrink-0">
                  {audioUnlocked ? (
                    <span className="inline-flex items-center gap-1 rounded-xl bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Ready
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={audioRequesting}
                      onClick={handleEnableAudioTap}
                      className="min-h-[36px] rounded-xl bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-900 disabled:opacity-60 dark:bg-emerald-700 dark:hover:bg-emerald-600"
                    >
                      {audioRequesting ? 'Unlocking…' : 'Enable'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-2">
              <motion.button
                whileTap={{ scale: 0.98 }}
                type="button"
                disabled={primaryBusy}
                onClick={onPrimaryClick}
                className="min-h-[46px] w-full rounded-2xl bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-900 disabled:opacity-60 dark:bg-emerald-700 dark:hover:bg-emerald-600"
              >
                {primaryLabel}
              </motion.button>
              <button
                type="button"
                onClick={onComplete}
                className="min-h-[42px] w-full rounded-2xl px-4 py-2 text-xs font-medium text-slate-600 hover:bg-stone-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                Skip for Now (Choose Location Manually)
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
