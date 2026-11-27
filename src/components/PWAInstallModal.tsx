import React, { useState } from 'react';
import { Download, Share, PlusSquare, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 whitespace-nowrap shrink-0 dark:bg-emerald-700 dark:hover:bg-emerald-600"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        <span>{compact ? 'Install' : 'Install App'}</span>
      </button>
    );
  }

  if (isIOS || !compact) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          <span>{isIOS ? 'Install on iPhone' : 'Install Guide'}</span>
        </button>

        {showIOSGuide && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
            className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-4 backdrop-blur-sm sm:items-center"
          >
            <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="ios-install-title" className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                    Install My Adhan on iPhone &amp; Android
                  </h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    Add My Adhan to your home screen for full-screen standalone launch and offline timetable access.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Close installation guide"
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-500 hover:bg-stone-100 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-5 space-y-4 text-sm text-slate-700 dark:text-slate-300">
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">iPhone / iPad (Safari)</p>
                  <ol className="mt-2 space-y-2 text-slate-600 dark:text-slate-400">
                    <li className="flex items-center gap-2">
                      <Share className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                      <span>1. Open this site in Safari over HTTPS and tap the Share icon.</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <PlusSquare className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                      <span>2. Scroll down and tap &ldquo;Add to Home Screen&rdquo;, then tap Add.</span>
                    </li>
                  </ol>
                </div>

                <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">Android (Chrome / Edge)</p>
                  <p className="mt-1.5 text-slate-600 dark:text-slate-400">
                    Tap the browser menu (three dots) and select &ldquo;Install app&rdquo; or &ldquo;Add to Home screen&rdquo;.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-6 min-h-[44px] w-full rounded-xl bg-emerald-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-900 dark:bg-emerald-700 dark:hover:bg-emerald-600"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
