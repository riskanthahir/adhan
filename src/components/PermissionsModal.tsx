import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, MapPin, ShieldCheck, Volume2, X } from 'lucide-react';

interface PermissionsModalProps {
  isOpen: boolean;
  isIOSBrowserTab: boolean;
  onComplete: () => void;
  onGrantAll: () => Promise<void>;
}

export const PermissionsModal: React.FC<PermissionsModalProps> = ({
  isOpen,
  isIOSBrowserTab,
  onComplete,
  onGrantAll,
}) => {
  const [busy, setBusy] = useState(false);

  const handleAllow = async () => {
    setBusy(true);
    try {
      await onGrantAll();
    } finally {
      setBusy(false);
      onComplete();
    }
  };

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
                    One-time setup for accurate ACJU times &amp; alerts
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
              <div className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-stone-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/50">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                <div>
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Location Access
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                    Automatically detects your Sri Lanka district and updates your ACJU group when you travel.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-stone-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/50">
                <Bell className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                <div>
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Prayer Time Notifications
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                    {isIOSBrowserTab
                      ? 'On iPhone, tap Share → Add to Home Screen to unlock iOS notifications, or sync to Apple Calendar.'
                      : 'Shows alerts when each prayer time arrives.'}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-stone-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/50">
                <Volume2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                <div>
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Adhan Audio Playback
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                    Unlocks browser audio so Adhan can play automatically at prayer time while the app is open.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-2">
              <motion.button
                whileTap={{ scale: 0.98 }}
                type="button"
                disabled={busy}
                onClick={() => void handleAllow()}
                className="min-h-[46px] w-full rounded-2xl bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-900 disabled:opacity-60 dark:bg-emerald-700 dark:hover:bg-emerald-600"
              >
                {busy ? 'Requesting Permissions…' : 'Allow All & Continue'}
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
