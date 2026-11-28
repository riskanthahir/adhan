import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  CalendarClock,
  CheckCircle2,
  Clock,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  PUSH_CHANNEL_NAME,
  appendPushClientEvent,
  cancelBackgroundTestPush,
  clearPushClientEvents,
  disableBackgroundPushNotifications,
  enableBackgroundPushNotifications,
  ensureServiceWorkerReady,
  fetchPushDiagnosticsDetailed,
  fetchVapidPublicKeyStatus,
  getBackendTransportMode,
  getPushClientEvents,
  inspectPushEnvironment,
  pingServiceWorker,
  scheduleBackgroundTestPush,
  sendBackendTestPushNotification,
  triggerExpiredCleanupDiagnostic,
  type BackgroundTestJobSummary,
  type PushClientEnvironment,
  type PushClientLogEntry,
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

export type DiagnosticStatus = 'pass' | 'fail' | 'warning' | 'pending';

export interface DiagnosticCheckItem {
  id: string;
  label: string;
  status: DiagnosticStatus;
  detail: string;
}

function formatTs(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function safeHostname(urlStr: string | null | undefined): string {
  if (!urlStr) return 'unknown';
  try {
    return new URL(urlStr).hostname || 'unknown';
  } catch {
    return 'redacted-endpoint';
  }
}

export function buildInitialDiagnosticChecks(env: PushClientEnvironment): DiagnosticCheckItem[] {
  const originLabel =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'Non-browser environment';

  return [
    {
      id: 'https',
      label: '1. HTTPS Secure Context',
      status: env.isSecureContext ? 'pass' : 'fail',
      detail: env.isSecureContext
        ? originLabel
        : 'Web Push requires an HTTPS origin (or localhost in dev).',
    },
    {
      id: 'ios-device',
      label: '2. iOS Device Detection',
      status: 'pass',
      detail: env.isIOS ? 'iPhone / iPadOS (WebKit)' : 'Non-iOS browser / desktop environment',
    },
    {
      id: 'standalone-pwa',
      label: '3. Standalone Home Screen PWA',
      status: env.isIOS ? (env.isStandalonePwa ? 'pass' : 'warning') : env.isStandalonePwa ? 'pass' : 'warning',
      detail: env.isIOS
        ? env.isStandalonePwa
          ? 'Opened from iPhone Home Screen icon (display-mode: standalone)'
          : 'Safari tab detected — on iPhone 16.4+, Web Push requires Share → Add to Home Screen'
        : env.isStandalonePwa
        ? 'Installed standalone PWA window'
        : 'Standard browser tab (Web Push supported on desktop/Android)',
    },
    {
      id: 'permission',
      label: '4. Notification Permission',
      status:
        env.permission === 'granted'
          ? 'pass'
          : env.permission === 'denied'
          ? 'fail'
          : env.permission === 'unsupported'
          ? 'fail'
          : 'warning',
      detail: `Notification.permission = "${env.permission}"`,
    },
    {
      id: 'sw-support',
      label: '5. Service Worker Support',
      status: env.serviceWorkerSupported ? 'pass' : 'fail',
      detail: env.serviceWorkerSupported
        ? 'navigator.serviceWorker available'
        : 'Service Workers are unsupported in this browser context.',
    },
    {
      id: 'sw-registration',
      label: '6. Service Worker Registration',
      status: env.serviceWorkerSupported ? 'pending' : 'fail',
      detail: env.serviceWorkerSupported ? 'Checking registration…' : 'Skipped (SW unsupported)',
    },
    {
      id: 'sw-activation',
      label: '7. Service Worker Activation',
      status: env.serviceWorkerSupported ? 'pending' : 'fail',
      detail: env.serviceWorkerSupported ? 'Checking active state…' : 'Skipped (SW unsupported)',
    },
    {
      id: 'sw-ping',
      label: '8. Service Worker Communication (SW_PING)',
      status: env.serviceWorkerSupported ? 'pending' : 'fail',
      detail: env.serviceWorkerSupported ? 'Pinging active Service Worker…' : 'Skipped (SW unsupported)',
    },
    {
      id: 'pushmanager',
      label: '9. PushManager Availability',
      status: env.pushManagerSupported ? 'pass' : 'fail',
      detail: env.pushManagerSupported
        ? 'window.PushManager available'
        : env.isIOS && !env.isStandalonePwa
        ? 'Unavailable in Safari browser tab — open installed Home Screen app icon'
        : 'PushManager API is unavailable.',
    },
    {
      id: 'browser-sub',
      label: '10. Existing Browser PushSubscription',
      status: env.pushManagerSupported && env.serviceWorkerSupported ? 'pending' : 'fail',
      detail:
        env.pushManagerSupported && env.serviceWorkerSupported
          ? 'Inspecting PushManager.getSubscription()…'
          : 'Unavailable without Service Worker + PushManager.',
    },
    {
      id: 'vapid-endpoint',
      label: '11. VAPID Public-Key Endpoint',
      status: 'pending',
      detail: 'Querying backend VAPID public key endpoint…',
    },
    {
      id: 'vapid-compat',
      label: '12. VAPID Public / Private Key Compatibility',
      status: 'pending',
      detail: 'Verifying server VAPID key pair validation…',
    },
    {
      id: 'backend-reachability',
      label: '13. Backend Reachability',
      status: 'pending',
      detail: `Contacting ${getBackendTransportMode()} push backend…`,
    },
    {
      id: 'edge-function-response',
      label: '14. Supabase Edge Function Response',
      status: 'pending',
      detail: 'Waiting for backend diagnostics payload…',
    },
    {
      id: 'device-registration',
      label: '15. Device Registration (devices)',
      status: 'pending',
      detail: 'Checking registered device record…',
    },
    {
      id: 'push-sub-persistence',
      label: '16. Push Subscription Persistence (push_subscriptions)',
      status: 'pending',
      detail: 'Checking persisted encrypted subscription…',
    },
    {
      id: 'backend-verification',
      label: '17. Backend Registration Verification',
      status: 'pending',
      detail: 'Verifying active subscription binding…',
    },
    {
      id: 'cron-scheduler',
      label: '18. Cron Scheduler Status',
      status: 'pending',
      detail: 'Checking backend prayer scheduler status…',
    },
    {
      id: 'prayer-dispatch',
      label: '19. Prayer-Time Dispatch Readiness',
      status: 'pending',
      detail: 'Checking ACJU schedule & next due prayer…',
    },
    {
      id: 'last-push-delivery',
      label: '20. Last Successful Push Delivery',
      status: 'pending',
      detail: 'Checking delivery logs…',
    },
    {
      id: 'last-notification-click',
      label: '21. Last Notification Click Verification',
      status: 'pending',
      detail: 'Checking notification tap tracking…',
    },
  ];
}

function statusBadgeLabel(status: DiagnosticStatus): string {
  switch (status) {
    case 'pass':
      return 'PASS';
    case 'fail':
      return 'FAIL';
    case 'warning':
      return 'WARNING';
    case 'pending':
      return 'PENDING';
  }
}

export const PushDiagnosticsView: React.FC<PushDiagnosticsViewProps> = ({
  selectedDistrict,
  selectedZone,
  preferences,
  onBack,
  onPushStatusUpdated,
}) => {
  const [diag, setDiag] = useState<PushDiagnosticsResponse | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [checks, setChecks] = useState<DiagnosticCheckItem[]>(() =>
    buildInitialDiagnosticChecks(inspectPushEnvironment())
  );
  const [runningDiagnostics, setRunningDiagnostics] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);
  const [clientLogs, setClientLogs] = useState<PushClientLogEntry[]>(() => getPushClientEvents());
  const [liveEvents, setLiveEvents] = useState<
    Array<{ type: string; detail: string; at: string }>
  >([]);

  const runSeqRef = useRef(0);

  const patchCheck = useCallback(
    (seq: number, id: string, status: DiagnosticStatus, detail: string) => {
      if (runSeqRef.current !== seq) return;
      setChecks((prev) =>
        prev.map((item) => (item.id === id ? { ...item, status, detail } : item))
      );
    },
    []
  );

  const runLiveChecks = useCallback(async () => {
    const seq = ++runSeqRef.current;
    setRunningDiagnostics(true);
    setBackendError(null);

    const env = inspectPushEnvironment();
    setChecks(buildInitialDiagnosticChecks(env));
    setClientLogs(getPushClientEvents());

    let swReg: ServiceWorkerRegistration | null = null;

    if (env.serviceWorkerSupported) {
      try {
        swReg = await ensureServiceWorkerReady(6000);
        const scope = swReg.scope || '/';
        patchCheck(seq, 'sw-registration', 'pass', `Registered (scope: ${scope})`);

        const activeState = swReg.active?.state ?? swReg.waiting?.state ?? swReg.installing?.state ?? 'unknown';
        patchCheck(
          seq,
          'sw-activation',
          swReg.active ? 'pass' : 'warning',
          swReg.active ? `Active (${activeState})` : `Not yet activated (state: ${activeState})`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        patchCheck(seq, 'sw-registration', 'fail', msg);
        patchCheck(seq, 'sw-activation', 'fail', 'Service Worker failed to activate.');
        patchCheck(seq, 'sw-ping', 'fail', 'Cannot ping without an active Service Worker.');
      }

      if (swReg?.active) {
        try {
          const ping = await pingServiceWorker();
          if (ping.ok) {
            patchCheck(
              seq,
              'sw-ping',
              'pass',
              `Responded (${ping.swVersion ?? 'sw'}) · precache entries: ${ping.precacheCount ?? 'n/a'}`
            );
          } else {
            patchCheck(
              seq,
              'sw-ping',
              'warning',
              ping.error || 'No SW_PING reply within 2s.'
            );
          }
        } catch (err) {
          patchCheck(
            seq,
            'sw-ping',
            'fail',
            err instanceof Error ? err.message : String(err)
          );
        }
      }
    }

    if (swReg?.pushManager) {
      try {
        const browserSub = await swReg.pushManager.getSubscription();
        if (browserSub) {
          patchCheck(
            seq,
            'browser-sub',
            'pass',
            `Active browser subscription on host ${safeHostname(browserSub.endpoint)}`
          );
        } else {
          patchCheck(
            seq,
            'browser-sub',
            'warning',
            'No active PushSubscription in browser yet — tap Enable / Renew Subscription.'
          );
        }
      } catch (err) {
        patchCheck(
          seq,
          'browser-sub',
          'fail',
          err instanceof Error ? err.message : String(err)
        );
      }
    } else if (env.serviceWorkerSupported && env.pushManagerSupported) {
      patchCheck(
        seq,
        'browser-sub',
        'fail',
        'Service Worker PushManager unavailable because SW did not activate.'
      );
    }

    // Run VAPID endpoint check & full diagnostics request concurrently so partial failures remain visible
    const [vapidRes, diagRes] = await Promise.all([
      fetchVapidPublicKeyStatus(),
      fetchPushDiagnosticsDetailed(),
    ]);

    if (runSeqRef.current !== seq) return;

    if (vapidRes.ok && vapidRes.configured) {
      patchCheck(
        seq,
        'vapid-endpoint',
        'pass',
        `HTTP ${vapidRes.httpStatus ?? 200} · Public key ${vapidRes.publicKeyPreview ?? 'loaded'}`
      );
    } else {
      patchCheck(
        seq,
        'vapid-endpoint',
        'fail',
        vapidRes.error || 'VAPID public-key endpoint did not return a key.'
      );
    }

    if (diagRes.ok) {
      const d = diagRes.data;
      setDiag(d);
      const isSupabaseMode =
        d.backendMode === 'supabase' || getBackendTransportMode() === 'supabase';

      patchCheck(
        seq,
        'backend-reachability',
        'pass',
        `Reachable (${isSupabaseMode ? 'Supabase Edge Functions' : 'Express API'})`
      );
      patchCheck(
        seq,
        'edge-function-response',
        'pass',
        `HTTP ${diagRes.httpStatus} JSON OK · Colombo ${d.colomboDate} ${(d.colomboTime || '').slice(0, 5)}`
      );

      patchCheck(
        seq,
        'vapid-compat',
        d.vapid?.configured ? 'pass' : 'fail',
        d.vapid?.configured
          ? `Validated P-256 pair (${d.vapid.publicKeyPreview ?? 'ok'}) · ${d.vapid.subject ?? ''}`
          : d.vapid?.errorMessage || 'Backend reported VAPID keys missing or mismatched.'
      );

      const sub = d.subscription;
      patchCheck(
        seq,
        'device-registration',
        sub?.deviceId ? 'pass' : 'warning',
        sub?.deviceId
          ? `Device registered (ID prefix ${sub.deviceId.slice(0, 8)} · ${sub.districtId})`
          : 'No device row found yet in backend for this browser.'
      );

      patchCheck(
        seq,
        'push-sub-persistence',
        sub?.subscriptionId ? 'pass' : 'warning',
        sub?.subscriptionId
          ? `Persisted (${sub.endpointPreview || 'endpoint saved'}) · Last registered ${formatTs(sub.lastRegisteredAt)}`
          : 'No push_subscriptions row persisted yet.'
      );

      patchCheck(
        seq,
        'backend-verification',
        sub?.status === 'active' ? 'pass' : sub ? 'fail' : 'warning',
        sub?.status === 'active'
          ? `Verified active (${sub.zoneName}) · Verified at ${formatTs(sub.lastVerifiedAt ?? sub.lastRegisteredAt)}`
          : sub
          ? `Subscription status is "${sub.status}" — tap Enable / Renew Subscription.`
          : 'Awaiting initial device registration.'
      );

      patchCheck(
        seq,
        'cron-scheduler',
        d.scheduler?.running ? 'pass' : 'fail',
        d.scheduler?.running
          ? `${isSupabaseMode ? 'pg_cron' : 'Server scheduler'} active · Last tick: ${formatTs(d.scheduler.lastTickAt)}`
          : 'Scheduler reported inactive.'
      );

      patchCheck(
        seq,
        'prayer-dispatch',
        sub?.status === 'active' && sub?.nextScheduledPrayer ? 'pass' : 'warning',
        sub?.nextScheduledPrayer
          ? `Ready — Next: ${sub.nextScheduledPrayer.label} at ${formatTime12h(
              sub.nextScheduledPrayer.timeHHMM
            )} (${sub.nextScheduledPrayer.countdownFormatted})`
          : 'Register device to bind district prayer schedule.'
      );

      patchCheck(
        seq,
        'last-push-delivery',
        sub?.lastDeliverySuccessAt
          ? 'pass'
          : sub?.lastDeliveryError
          ? 'fail'
          : 'warning',
        sub?.lastDeliverySuccessAt
          ? `Last accepted push: ${formatTs(sub.lastDeliverySuccessAt)}`
          : sub?.lastDeliveryError
          ? `Last error: ${sub.lastDeliveryError}`
          : 'No push deliveries yet — tap Send End-to-End Test Push.'
      );

      patchCheck(
        seq,
        'last-notification-click',
        sub?.lastClickVerifiedAt ? 'pass' : 'warning',
        sub?.lastClickVerifiedAt
          ? `Click verified at ${formatTs(sub.lastClickVerifiedAt)}`
          : 'Tap a delivered system notification to confirm click tracking.'
      );
    } else {
      setDiag(null);
      setBackendError(diagRes.error);

      patchCheck(
        seq,
        'vapid-compat',
        vapidRes.ok ? 'warning' : 'fail',
        vapidRes.ok
          ? 'VAPID public key reachable, but full backend diagnostics failed.'
          : vapidRes.error || 'VAPID compatibility check failed.'
      );

      const isReachableButHttpError = diagRes.httpStatus !== null;
      patchCheck(
        seq,
        'backend-reachability',
        isReachableButHttpError ? 'pass' : 'fail',
        isReachableButHttpError
          ? `Reached server (HTTP ${diagRes.httpStatus}), request rejected.`
          : diagRes.error
      );

      patchCheck(
        seq,
        'edge-function-response',
        'fail',
        diagRes.httpStatus
          ? `HTTP ${diagRes.httpStatus}: ${diagRes.error}`
          : diagRes.error
      );

      for (const id of [
        'device-registration',
        'push-sub-persistence',
        'backend-verification',
        'cron-scheduler',
        'prayer-dispatch',
        'last-push-delivery',
        'last-notification-click',
      ]) {
        patchCheck(seq, id, 'fail', 'Blocked because backend diagnostics failed.');
      }
    }

    if (runSeqRef.current === seq) {
      setClientLogs(getPushClientEvents());
      setRunningDiagnostics(false);
    }
  }, [patchCheck]);

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
    if (busyAction !== null) return;
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
          ? {
              tone: 'success',
              message: 'Subscription created, persisted to backend storage, and verified active.',
            }
          : {
              tone: 'error',
              message: `${res.failedStage ? `[${res.failedStage}] ` : ''}${
                res.error || 'Subscription failed.'
              }`,
            }
      );
      onPushStatusUpdated();
      await runLiveChecks();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendPushClientEvent({ level: 'error', stage: 'diag_enable', message: msg });
      setActionFeedback({ tone: 'error', message: `Unexpected error: ${msg}` });
    } finally {
      setBusyAction(null);
    }
  };

  const handleTestPush = async () => {
    if (busyAction !== null) return;
    setBusyAction('test');
    setActionFeedback(null);
    try {
      const res = await sendBackendTestPushNotification();
      setActionFeedback(
        res.ok
          ? {
              tone: 'success',
              message: `Server pushed encrypted payload (HTTP ${res.statusCode ?? 201}). Watch for your device notification and tap it to verify click handling.`,
            }
          : {
              tone: 'error',
              message: res.error || 'Test push failed.',
            }
      );
      onPushStatusUpdated();
      await runLiveChecks();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendPushClientEvent({ level: 'error', stage: 'diag_test', message: msg });
      setActionFeedback({ tone: 'error', message: `Unexpected error: ${msg}` });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSimulateExpiration = async () => {
    if (busyAction !== null) return;
    setBusyAction('expire');
    setActionFeedback(null);
    try {
      const res = await triggerExpiredCleanupDiagnostic();
      setActionFeedback(
        res.ok
          ? {
              tone: 'success',
              message:
                'Marked subscription as expired (simulated 410 Gone). Tap Enable / Renew below to test automatic renewal.',
            }
          : {
              tone: 'error',
              message: res.error || 'Could not test expiration cleanup.',
            }
      );
      onPushStatusUpdated();
      await runLiveChecks();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendPushClientEvent({ level: 'error', stage: 'diag_expire', message: msg });
      setActionFeedback({ tone: 'error', message: `Unexpected error: ${msg}` });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDisablePush = async () => {
    if (busyAction !== null) return;
    setBusyAction('disable');
    setActionFeedback(null);
    try {
      const res = await disableBackgroundPushNotifications();
      setActionFeedback(
        res.ok
          ? {
              tone: 'success',
              message: 'Unsubscribed browser and marked backend subscription disabled.',
            }
          : {
              tone: 'error',
              message: res.error || 'Disable failed.',
            }
      );
      onPushStatusUpdated();
      await runLiveChecks();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendPushClientEvent({ level: 'error', stage: 'diag_disable', message: msg });
      setActionFeedback({ tone: 'error', message: `Unexpected error: ${msg}` });
    } finally {
      setBusyAction(null);
    }
  };

  const handleScheduleTestPush = async (delayMinutes = 2) => {
    if (busyAction !== null) return;
    setBusyAction('schedule-test');
    setActionFeedback(null);
    try {
      const res = await scheduleBackgroundTestPush({ delayMinutes });
      setActionFeedback(
        res.ok
          ? {
              tone: 'success',
              message: `Scheduled ${delayMinutes}-minute background test push (${res.job?.scheduledAt ?? 'queued'}). Close PWA or lock iPhone screen to test.`,
            }
          : {
              tone: 'error',
              message: res.error || 'Failed to schedule background test job.',
            }
      );
      onPushStatusUpdated();
      await runLiveChecks();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendPushClientEvent({ level: 'error', stage: 'diag_schedule_test', message: msg });
      setActionFeedback({ tone: 'error', message: `Unexpected error: ${msg}` });
    } finally {
      setBusyAction(null);
    }
  };

  const handleCancelTestPush = async () => {
    if (busyAction !== null) return;
    setBusyAction('cancel-test');
    setActionFeedback(null);
    try {
      const res = await cancelBackgroundTestPush();
      setActionFeedback(
        res.ok
          ? {
              tone: 'success',
              message: 'Cancelled pending background test push job.',
            }
          : {
              tone: 'error',
              message: res.error || 'Could not cancel scheduled test job.',
            }
      );
      onPushStatusUpdated();
      await runLiveChecks();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendPushClientEvent({ level: 'error', stage: 'diag_cancel_test', message: msg });
      setActionFeedback({ tone: 'error', message: `Unexpected error: ${msg}` });
    } finally {
      setBusyAction(null);
    }
  };

  const passCount = checks.filter((c) => c.status === 'pass').length;
  const failCount = checks.filter((c) => c.status === 'fail').length;
  const warnCount = checks.filter((c) => c.status === 'warning').length;

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
          disabled={runningDiagnostics}
          onClick={() => void runLiveChecks()}
          className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3.5 text-xs font-semibold text-slate-800 hover:bg-stone-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${runningDiagnostics ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span>{runningDiagnostics ? 'Running Diagnostics…' : 'Run Diagnostics Again'}</span>
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
            onClick={() => void handleScheduleTestPush(2)}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-amber-600 bg-amber-50 px-3.5 text-xs font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
            <span>{busyAction === 'schedule-test' ? 'Scheduling…' : 'Schedule 2m Lock Screen Test'}</span>
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
          <p
            role={actionFeedback.tone === 'error' ? 'alert' : 'status'}
            className={`mt-3 rounded-xl border px-3.5 py-2 text-xs ${
              actionFeedback.tone === 'error'
                ? 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'
                : 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
            }`}
          >
            {actionFeedback.message}
          </p>
        )}

        {backendError && (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-rose-300 bg-rose-50/90 px-3.5 py-2 text-xs text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
          >
            <strong>Backend Diagnostics Warning:</strong> {backendError}
          </p>
        )}
      </section>

      {diag && !diag.vapid?.configured && (
        <section className="rounded-3xl border border-amber-300 bg-amber-50 p-4 sm:p-5 text-amber-950 dark:border-amber-700/70 dark:bg-amber-950/40 dark:text-amber-100">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
            <div className="space-y-2 text-xs">
              <h2 className="text-sm font-semibold">
                VAPID Keys Not Configured ({diag.vapid?.status ?? 'missing'})
              </h2>
              <p>{diag.vapid?.errorMessage}</p>
              <ol className="list-decimal space-y-1 pl-4 text-amber-900 dark:text-amber-200">
                {(diag.vapid?.setupInstructions ?? []).map((step, i) => (
                  <li key={i}>{step.replace(/^\d+\.\s*/, '')}</li>
                ))}
              </ol>
            </div>
          </div>
        </section>
      )}

      {/* 21-Point Diagnostic Matrix */}
      <section className="rounded-3xl border border-stone-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            System Verification Checks ({checks.length})
          </h2>
          <div className="flex items-center gap-2 font-mono-tabular text-[11px]">
            <span className="rounded-md bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-300">
              {passCount} PASS
            </span>
            <span className="rounded-md bg-amber-100 px-2 py-0.5 font-semibold text-amber-900 dark:bg-amber-950/70 dark:text-amber-300">
              {warnCount} WARNING
            </span>
            <span className="rounded-md bg-rose-100 px-2 py-0.5 font-semibold text-rose-900 dark:bg-rose-950/70 dark:text-rose-300">
              {failCount} FAIL
            </span>
          </div>
        </div>

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
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 font-mono-tabular text-[10px] font-bold uppercase tracking-wider ${
                  item.status === 'pass'
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                    : item.status === 'fail'
                    ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300'
                    : item.status === 'warning'
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300'
                    : 'bg-stone-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {item.status === 'pass' ? (
                  <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                ) : item.status === 'fail' ? (
                  <XCircle className="h-3 w-3" aria-hidden="true" />
                ) : item.status === 'warning' ? (
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <Clock className="h-3 w-3" aria-hidden="true" />
                )}
                <span>{statusBadgeLabel(item.status)}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Background Test Job Status & Verification Stages */}
      {(() => {
        const testJob = diag?.subscription?.latestTestJob ?? diag?.latestTestJob;
        const clickVerified = Boolean(diag?.subscription?.lastClickVerifiedAt);
        return (
          <section className="rounded-3xl border border-stone-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Background Test Push Verification Stages
                </h2>
              </div>
              {testJob && testJob.status === 'pending' && (
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void handleCancelTestPush()}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-800 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:bg-slate-950 dark:text-rose-300"
                >
                  <RotateCcw
                    className={`h-3 w-3 ${busyAction === 'cancel-test' ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>Cancel Pending Job</span>
                </button>
              )}
            </div>

            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Multi-stage delivery verification for closed-app / locked-screen push testing.
            </p>

            <div className="mt-3.5 grid gap-3 sm:grid-cols-3">
              {/* Stage 1: Job Scheduled in Database */}
              <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-950/50">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    1. Job Scheduled
                  </span>
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      testJob
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-stone-200 text-slate-700 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    {testJob ? testJob.status : 'None'}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {testJob
                    ? `Scheduled for: ${formatTs(testJob.scheduledAt)} (ID: ${testJob.id.slice(0, 8)}…)`
                    : 'No test job scheduled yet.'}
                </p>
              </div>

              {/* Stage 2: Push Dispatched / Accepted */}
              <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-950/50">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    2. Push Dispatched
                  </span>
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      testJob?.status === 'sent'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : testJob?.status === 'failed'
                        ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                        : testJob?.status === 'processing'
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        : 'bg-stone-200 text-slate-700 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    {testJob?.status === 'sent'
                      ? 'Dispatched'
                      : testJob?.status === 'failed'
                      ? 'Failed'
                      : testJob?.status === 'processing'
                      ? 'In Flight'
                      : 'Pending'}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {testJob?.sentAt
                    ? `Dispatched at: ${formatTs(testJob.sentAt)} (No topic header)`
                    : testJob?.errorMessage
                    ? `Error: ${testJob.errorMessage}`
                    : testJob?.status === 'pending'
                    ? 'Awaiting pg_cron tick at scheduled minute.'
                    : 'Not yet dispatched.'}
                </p>
              </div>

              {/* Stage 3: Notification Received & Click Verified */}
              <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-950/50">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    3. Notification Click
                  </span>
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      clickVerified
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-stone-200 text-slate-700 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    {clickVerified ? 'Verified' : 'Unconfirmed'}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {clickVerified
                    ? `Last tap verified: ${formatTs(diag?.subscription?.lastClickVerifiedAt)}`
                    : 'Tap lock screen push banner to verify app launch.'}
                </p>
              </div>
            </div>
          </section>
        );
      })()}

      {/* Backend State + Technical Event Log */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-3xl border border-stone-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
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
                  {formatTs(diag.scheduler?.lastTickAt)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Active / Total Subscriptions</dt>
                <dd className="font-mono-tabular text-slate-700 dark:text-slate-300">
                  {diag.stats?.activeSubscriptions ?? 0} / {diag.stats?.totalSubscriptions ?? 0} (Expired:{' '}
                  {diag.stats?.expiredSubscriptions ?? 0})
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Backend Engine</dt>
                <dd className="text-right text-slate-700 dark:text-slate-300">
                  {diag.databasePath || getBackendTransportMode()}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Database Migrations</dt>
                <dd className="font-mono-tabular text-right text-slate-700 dark:text-slate-300">
                  {(diag.migrations ?? []).map((m) => m.version).join(', ') || 'None'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-xs text-slate-500">
              {backendError
                ? 'Backend telemetry unavailable due to request error above.'
                : 'Loading backend diagnostics…'}
            </p>
          )}

          <div className="mt-4 border-t border-stone-100 pt-3 dark:border-slate-800">
            <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Recent Server Delivery Attempts
            </h3>
            {diag && Array.isArray(diag.recentDeliveries) && diag.recentDeliveries.length > 0 ? (
              <div className="mt-2 space-y-2">
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
              <p className="mt-2 text-xs text-slate-500">
                No delivery attempts recorded yet for this device.
              </p>
            )}
          </div>
        </section>

        {/* Technical Event Log (Sanitized Client + SW + Backend Logs) */}
        <section className="rounded-3xl border border-stone-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Technical Event Log
              </h2>
            </div>
            {clientLogs.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  clearPushClientEvents();
                  setClientLogs([]);
                }}
                className="text-[11px] font-medium text-slate-500 underline underline-offset-2 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              >
                Clear Log
              </button>
            )}
          </div>

          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Timestamped client, Service Worker, and backend stages (tokens, private keys, and full push URLs are redacted).
          </p>

          {liveEvents.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                Live Service Worker Broadcasts
              </p>
              {liveEvents.map((e, i) => (
                <div
                  key={i}
                  className="rounded-xl bg-emerald-50/70 px-3 py-1.5 font-mono-tabular text-[11px] text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-200"
                >
                  <span className="font-semibold">[{e.type}]</span> {e.detail} · {formatTs(e.at)}
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {clientLogs.length === 0 && (!diag?.recentLogs || diag.recentLogs.length === 0) ? (
              <p className="text-xs text-slate-500">
                No push events recorded yet in this browser. Tap &ldquo;Enable / Renew Subscription&rdquo; or &ldquo;Run Diagnostics Again&rdquo;.
              </p>
            ) : (
              <>
                {clientLogs.map((entry) => (
                  <div
                    key={entry.id}
                    className={`rounded-xl border px-3 py-1.5 font-mono-tabular text-[11px] break-words ${
                      entry.level === 'error'
                        ? 'border-rose-200 bg-rose-50/70 text-rose-950 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200'
                        : entry.level === 'warn'
                        ? 'border-amber-200 bg-amber-50/70 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200'
                        : 'border-stone-200 bg-stone-50/70 text-slate-700 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold uppercase">
                        {entry.level} · {entry.stage}
                        {entry.httpStatus ? ` (HTTP ${entry.httpStatus})` : ''}
                      </span>
                      <span className="shrink-0 opacity-70">{formatTs(entry.at)}</span>
                    </div>
                    <p className="mt-0.5">{entry.message}</p>
                  </div>
                ))}

                {(diag?.recentLogs ?? []).slice(0, 8).map((log) => (
                  <div
                    key={`srv-${log.id}`}
                    className="rounded-xl border border-stone-200 bg-stone-50/50 px-3 py-1.5 font-mono-tabular text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400 break-words"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold uppercase">
                        SERVER · {log.level} · {log.category}
                      </span>
                      <span className="shrink-0 opacity-70">{formatTs(log.createdAt)}</span>
                    </div>
                    <p className="mt-0.5">{log.message}</p>
                  </div>
                ))}
              </>
            )}
          </div>
        </section>
      </div>

      {/* Physical iPhone Verification Matrix */}
      <section className="rounded-3xl border border-stone-200 bg-stone-100/80 p-4 sm:p-5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Physical iPhone Verification Matrix (13-Point Checklist)
        </h2>
        <p className="mt-1 leading-relaxed">
          Apple Push Notification service (<code className="font-mono-tabular">web.push.apple.com</code>)
          delivers Web Push only to apps opened from the <strong>iPhone Home Screen icon</strong> (iOS
          16.4+) over <strong>HTTPS</strong>. Sound played when locked uses the system notification
          chime (not custom MP3 Adhan audio, which Apple reserves for foreground app playback).
        </p>
        <ol className="mt-2.5 grid list-decimal gap-1.5 pl-4 sm:grid-cols-2">
          <li>Installed PWA on physical iPhone (iOS 16.4+) over Vercel HTTPS</li>
          <li>Service Worker registration &amp; ping active in standalone mode</li>
          <li>Notification permission granted via user tap inside Home Screen app</li>
          <li>Web Push subscription created &amp; persisted in Supabase</li>
          <li>ACJU district prayer times verified for Asia/Colombo in prayer_times</li>
          <li>Scheduled push received when PWA is open in foreground</li>
          <li>Scheduled push received when PWA is in background</li>
          <li>Scheduled push received when PWA is swiped/closed completely</li>
          <li>Scheduled push wakes iPhone Lock Screen when screen is locked</li>
          <li>Notification tap opens My Adhan cleanly &amp; verifies click</li>
          <li>No duplicate notification delivery (unique idempotency_key)</li>
          <li>Invalid/expired 410 Gone subscription flagged &amp; cleaned up</li>
          <li>Disable &amp; Re-enable flow unsubscribes &amp; re-registers clean key</li>
        </ol>
      </section>
    </div>
  );
};
