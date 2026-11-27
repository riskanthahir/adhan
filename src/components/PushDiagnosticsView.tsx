import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  CheckCircle2,
  PlayCircle,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  PUSH_CHANNEL_NAME,
  disableBackgroundPushNotifications,
  enableBackgroundPushNotifications,
  ensureServiceWorkerReady,
  fetchPushDiagnostics,
  inspectPushEnvironment,
  pingServiceWorker,
  sendBackendTestPushNotification,
  triggerExpiredCleanupDiagnostic,
  type PushDiagnosticsResponse,
} from '../lib/webPushClient';
import { formatTime12h } from '../shared/timetablePolicy';
import type { AcjuDistrict, AcjuZone, UserPreferences } from '../shared/types';

interface PushDiagnosticsViewProps {
  selectedDistrict: AcjuDistrict;
  selectedZone: AcjuZone;
  preferences: UserPreferences;
  onBack: () => void;
  onPushStatusUpdated: () => void;
}

interface DiagnosticCheckItem {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'warn' | 'pending';
  detail: string;
}

function formatTs(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export const PushDiagnosticsView: React.FC<PushDiagnosticsViewProps> = ({
  selectedDistrict,
  selectedZone,
  preferences,
  onBack,
  onPushStatusUpdated,
}) => {
  const [diag, setDiag] = useState<PushDiagnosticsResponse | null>(null);
  const [checks, setChecks] = useState<DiagnosticCheckItem[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<
    Array<{ type: string; detail: string; at: string }>
  >([]);

  const runLiveChecks = useCallback(async () => {
    const env = inspectPushEnvironment();
    const list: DiagnosticCheckItem[] = [];

    list.push({
      id: 'https',
      label: 'HTTPS Secure Context',
      status: env.isSecureContext ? 'pass' : 'fail',
      detail: env.isSecureContext
        ? window.location.origin
        : 'Web Push requires HTTPS.',
    });

    list.push({
      id: 'sw-support',
      label: 'Service Worker Support & Registration',
      status: 'pending',
      detail: 'Checking…',
    });

    let swReg: ServiceWorkerRegistration | null = null;
    if (env.serviceWorkerSupported) {
      try {
        swReg = await ensureServiceWorkerReady(5000);
        const ping = await pingServiceWorker();
        list[list.length - 1] = {
          id: 'sw-support',
          label: 'Service Worker Registration & Ping',
          status: ping.ok ? 'pass' : 'warn',
          detail: ping.ok
            ? `Active (${ping.swVersion}) · scope ${swReg.scope}`
            : `Registered (${swReg.active?.state ?? 'pending'})`,
        };
      } catch (err) {
        list[list.length - 1] = {
          id: 'sw-support',
          label: 'Service Worker Registration',
          status: 'fail',
          detail: (err as Error).message,
        };
      }
    } else {
      list[list.length - 1] = {
        id: 'sw-support',
        label: 'Service Worker Registration',
        status: 'fail',
        detail: 'Not supported in this browser.',
      };
    }

    list.push({
      id: 'permission',
      label: 'Notification Permission',
      status:
        env.permission === 'granted'
          ? 'pass'
          : env.permission === 'denied'
          ? 'fail'
          : 'warn',
      detail:
        env.isIOS && !env.isStandalonePwa
          ? `${env.permission} (On iPhone, open from Home Screen icon for Web Push)`
          : `State: ${env.permission}`,
    });

    list.push({
      id: 'pushmanager',
      label: 'PushManager Availability',
      status: env.pushManagerSupported ? 'pass' : 'fail',
      detail: env.pushManagerSupported
        ? env.isIOS
          ? env.isStandalonePwa
            ? 'Available in iOS Home Screen PWA'
            : 'Requires Home Screen installation on iPhone'
          : 'PushManager API available'
        : 'Unavailable in current browser tab',
    });

    let browserSub: PushSubscription | null = null;
    if (swReg?.pushManager) {
      try {
        browserSub = await swReg.pushManager.getSubscription();
        list.push({
          id: 'browser-sub',
          label: 'Push Subscription Creation (Browser)',
          status: browserSub ? 'pass' : 'warn',
          detail: browserSub
            ? `Active endpoint: ${new URL(browserSub.endpoint).hostname}`
            : 'No active PushManager subscription yet — tap Enable Prayer Notifications.',
        });
      } catch (err) {
        list.push({
          id: 'browser-sub',
          label: 'Push Subscription Creation (Browser)',
          status: 'fail',
          detail: (err as Error).message,
        });
      }
    }

    const backendDiag = await fetchPushDiagnostics();
    setDiag(backendDiag);

    if (backendDiag) {
      list.push({
        id: 'vapid',
        label: 'VAPID Environment Configuration & Key-Pair Match',
        status: backendDiag.vapid.configured ? 'pass' : 'fail',
        detail: backendDiag.vapid.configured
          ? `${backendDiag.vapid.publicKeyPreview} (Environment Variables · Validated Match · ${backendDiag.vapid.subject ?? ''})`
          : backendDiag.vapid.errorMessage ||
            'VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT are not configured on the backend server.',
      });

      list.push({
        id: 'backend-storage',
        label: 'Backend Subscription Storage',
        status:
          backendDiag.subscription?.status === 'active'
            ? 'pass'
            : backendDiag.subscription
            ? 'warn'
            : 'warn',
        detail: backendDiag.subscription
          ? `Status: ${backendDiag.subscription.status} · Zone ${backendDiag.subscription.zoneId} (${backendDiag.subscription.districtId})`
          : 'Not stored on server yet for this device.',
      });

      list.push({
        id: 'scheduler',
        label: 'Server Scheduler & ACJU Integration',
        status: backendDiag.scheduler.running ? 'pass' : 'fail',
        detail: `Colombo ${backendDiag.colomboDate} ${backendDiag.colomboTime.slice(0, 5)} · Tick every ${Math.round(
          backendDiag.scheduler.intervalMs / 1000
        )}s · TTL ${backendDiag.scheduler.ttlSeconds}s`,
      });

      list.push({
        id: 'sw-push-display',
        label: 'Test Delivery & Service Worker Display',
        status: backendDiag.subscription?.lastDeliverySuccessAt ? 'pass' : 'warn',
        detail: backendDiag.subscription?.lastDeliverySuccessAt
          ? `Last accepted push: ${formatTs(backendDiag.subscription.lastDeliverySuccessAt)}`
          : 'Send a test push notification below to verify APNs/FCM + Service Worker display.',
      });

      list.push({
        id: 'click-handling',
        label: 'Notification Click Handling',
        status: backendDiag.subscription?.lastClickVerifiedAt ? 'pass' : 'warn',
        detail: backendDiag.subscription?.lastClickVerifiedAt
          ? `Verified click at ${formatTs(backendDiag.subscription.lastClickVerifiedAt)}`
          : 'Tap a delivered system notification to verify notificationclick opening & tracking.',
      });

      list.push({
        id: 'expiration-handling',
        label: 'Subscription Expiration & Renewal Support',
        status: 'pass',
        detail:
          'HTTP 404/410 cleanup + Service Worker pushsubscriptionchange auto-renewal active.',
      });
    } else {
      list.push({
        id: 'backend-offline',
        label: 'Backend Server Reachability',
        status: 'fail',
        detail: 'Could not reach /api/push/diagnostics.',
      });
    }

    setChecks(list);
  }, []);

  useEffect(() => {
    void runLiveChecks();
  }, [runLiveChecks]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel(PUSH_CHANNEL_NAME);
    bc.onmessage = (evt) => {
      const data = evt.data as {
        type?: string;
        title?: string;
        eventKey?: string;
        receivedAt?: string;
        clickedAt?: string;
      };
      if (!data?.type) return;
      setLiveEvents((prev) => [
        {
          type: data.type ?? 'EVENT',
          detail: data.title || data.eventKey || 'Service Worker event',
          at: data.receivedAt || data.clickedAt || new Date().toISOString(),
        },
        ...prev.slice(0, 9),
      ]);
      void runLiveChecks();
    };
    return () => bc.close();
  }, [runLiveChecks]);

  const handleEnablePush = async () => {
    setBusyAction('enable');
    setActionFeedback(null);
    try {
      const res = await enableBackgroundPushNotifications({
        districtId: selectedDistrict.id,
        perPrayerEnabled: preferences.perPrayerEnabled,
        advanceMinutes: preferences.advanceMinutes,
      });
      setActionFeedback(
        res.ok
          ? 'Subscription created, saved to SQLite, and verified.'
          : res.error || 'Subscription failed.'
      );
      onPushStatusUpdated();
      await runLiveChecks();
    } finally {
      setBusyAction(null);
    }
  };

  const handleTestPush = async () => {
    setBusyAction('test');
    setActionFeedback(null);
    try {
      const res = await sendBackendTestPushNotification();
      setActionFeedback(
        res.ok
          ? `Server pushed encrypted payload (HTTP ${res.statusCode ?? 201}). Watch for your device notification and tap it to verify click handling.`
          : res.error || 'Test push failed.'
      );
      onPushStatusUpdated();
      await runLiveChecks();
    } finally {
      setBusyAction(null);
    }
  };

  const handleSimulateExpiration = async () => {
    setBusyAction('expire');
    setActionFeedback(null);
    try {
      const res = await triggerExpiredCleanupDiagnostic();
      setActionFeedback(
        res.ok
          ? 'Marked subscription as expired (simulated 410 Gone). Tap Enable/Renew below to test automatic renewal.'
          : res.error || 'Could not test expiration cleanup.'
      );
      onPushStatusUpdated();
      await runLiveChecks();
    } finally {
      setBusyAction(null);
    }
  };

  const handleDisablePush = async () => {
    setBusyAction('disable');
    setActionFeedback(null);
    try {
      const res = await disableBackgroundPushNotifications();
      setActionFeedback(
        res.ok ? 'Unsubscribed browser and marked backend subscription disabled.' : res.error || 'Disable failed.'
      );
      onPushStatusUpdated();
      await runLiveChecks();
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-stone-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Back</span>
          </button>
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-slate-50">
              Web Push &amp; iOS Lock Screen Diagnostics
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {selectedDistrict.name} · {selectedZone.name} · Asia/Colombo
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void runLiveChecks()}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3.5 text-xs font-medium text-slate-700 hover:bg-stone-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Refresh Checks</span>
        </button>
      </div>

      {/* Action Controls */}
      <section className="rounded-3xl border border-stone-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void handleEnablePush()}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-emerald-800 px-4 text-xs font-semibold text-white hover:bg-emerald-900 disabled:opacity-50 dark:bg-emerald-700"
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            <span>{busyAction === 'enable' ? 'Subscribing…' : 'Enable / Renew Subscription'}</span>
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void handleTestPush()}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-emerald-700 bg-emerald-50 px-4 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-200"
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
            <span>{busyAction === 'test' ? 'Sending Push…' : 'Send End-to-End Test Push'}</span>
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void handleSimulateExpiration()}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-stone-300 bg-stone-50 px-3.5 text-xs font-medium text-slate-800 hover:bg-stone-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <PlayCircle className="h-4 w-4" aria-hidden="true" />
            <span>Test 410 Expiration Cleanup</span>
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void handleDisablePush()}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-rose-300 bg-rose-50 px-3.5 text-xs font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            <span>Disable &amp; Unsubscribe</span>
          </button>
        </div>

        {actionFeedback && (
          <p className="mt-3 rounded-xl bg-stone-100 px-3.5 py-2 text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-200">
            {actionFeedback}
          </p>
        )}
      </section>

      {diag && !diag.vapid.configured && (
        <section className="rounded-3xl border border-amber-300 bg-amber-50 p-4 sm:p-5 text-amber-950 dark:border-amber-700/70 dark:bg-amber-950/40 dark:text-amber-100">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
            <div className="space-y-2 text-xs">
              <h2 className="text-sm font-semibold">
                VAPID Keys Not Configured ({diag.vapid.status})
              </h2>
              <p>{diag.vapid.errorMessage}</p>
              <ol className="list-decimal space-y-1 pl-4 text-amber-900 dark:text-amber-200">
                {diag.vapid.setupInstructions.map((step, i) => (
                  <li key={i}>{step.replace(/^\d+\.\s*/, '')}</li>
                ))}
              </ol>
            </div>
          </div>
        </section>
      )}

      {/* Diagnostic Matrix */}
      <section className="rounded-3xl border border-stone-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          System Verification Checks
        </h2>
        <div className="mt-3 divide-y divide-stone-100 dark:divide-slate-800">
          {checks.map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-medium text-slate-900 dark:text-slate-100">
                  {item.label}
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 break-words">
                  {item.detail}
                </p>
              </div>
              <span className="shrink-0 pt-0.5">
                {item.status === 'pass' ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                ) : item.status === 'fail' ? (
                  <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                )}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Live Service Worker Events + Next Scheduled Prayer */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-3xl border border-stone-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Backend Next Prayer &amp; Scheduler State
            </h2>
          </div>

          {diag ? (
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Next Prayer on Server</dt>
                <dd className="font-mono-tabular font-semibold text-slate-900 dark:text-slate-100">
                  {diag.subscription?.nextScheduledPrayer
                    ? `${diag.subscription.nextScheduledPrayer.label} at ${formatTime12h(
                        diag.subscription.nextScheduledPrayer.timeHHMM
                      )}`
                    : 'Subscribe to bind district schedule'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Last Scheduler Tick</dt>
                <dd className="text-slate-700 dark:text-slate-300">
                  {formatTs(diag.scheduler.lastTickAt)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Active / Total Subscriptions</dt>
                <dd className="font-mono-tabular text-slate-700 dark:text-slate-300">
                  {diag.stats.activeSubscriptions} / {diag.stats.totalSubscriptions} (Expired:{' '}
                  {diag.stats.expiredSubscriptions})
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">SQLite Migrations</dt>
                <dd className="font-mono-tabular text-slate-700 dark:text-slate-300">
                  {diag.migrations.map((m) => m.version).join(', ') || 'None'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-xs text-slate-500">Loading backend diagnostics…</p>
          )}

          {liveEvents.length > 0 && (
            <div className="mt-4 border-t border-stone-100 pt-3 dark:border-slate-800">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Live Service Worker Events (This Session)
              </p>
              <ul className="mt-2 space-y-1.5 text-xs">
                {liveEvents.map((e, i) => (
                  <li
                    key={i}
                    className="rounded-xl bg-emerald-50/70 px-3 py-1.5 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-200"
                  >
                    <span className="font-semibold">{e.type}</span> — {e.detail} (
                    {formatTs(e.at)})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-stone-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Recent Server Delivery Attempts &amp; Logs
          </h2>
          {diag && diag.recentDeliveries.length > 0 ? (
            <div className="mt-3 space-y-2">
              {diag.recentDeliveries.slice(0, 6).map((d) => (
                <div
                  key={d.id}
                  className="rounded-xl border border-stone-200 bg-stone-50/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {d.prayer.toUpperCase()} ({d.prayerTimeHHMM})
                    </span>
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        d.status === 'sent'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                      }`}
                    >
                      {d.status} {d.httpStatus ? `(${d.httpStatus})` : ''}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {formatTs(d.updatedAt)}
                    {d.errorMessage ? ` · ${d.errorMessage}` : ''}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-500">
              No delivery attempts recorded yet for this device.
            </p>
          )}
        </section>
      </div>

      {/* Physical iPhone Verification Guide */}
      <section className="rounded-3xl border border-stone-200 bg-stone-100/80 p-4 sm:p-5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Physical iPhone Verification Matrix (A–G)
        </h2>
        <p className="mt-1 leading-relaxed">
          Apple Push Notification service (<code className="font-mono-tabular">web.push.apple.com</code>)
          delivers Web Push only to apps opened from the <strong>iPhone Home Screen icon</strong> (iOS
          16.4+) over <strong>HTTPS</strong>. Sound played when locked uses the system notification
          chime (not custom MP3 Adhan audio, which Apple reserves for foreground app playback).
        </p>
        <ul className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
          <li>A. Foreground open → Test Push shows banner + system notification</li>
          <li>B. Backgrounded → Test Push arrives on Notification Center</li>
          <li>C. App swiped closed → Background push still delivered via APNs</li>
          <li>D. iPhone screen locked → Notification wakes Lock Screen</li>
          <li>E. Offline briefly → Short 5-min TTL delivers if reconnected promptly</li>
          <li>F. Reopened hours later → Preference sync &amp; renewal check run</li>
          <li>G. Disabled then re-enabled → Unsubscribes old key &amp; verifies new endpoint</li>
        </ul>
      </section>
    </div>
  );
};
