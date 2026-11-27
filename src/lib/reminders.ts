import {
  buildReminderDedupeKey,
  colomboDateTimeToEpochMs,
  formatTime12h,
} from '../shared/timetablePolicy';
import {
  PRAYER_LABELS,
  PRAYER_NAMES,
  type AdvanceMinutesOption,
  type PrayerName,
  type ResolvedDaySchedule,
  type UserPreferences,
} from '../shared/types';

export interface ScheduledReminderSummary {
  dedupeKey: string;
  prayer: PrayerName;
  prayerTimeHHMM: string;
  triggerAtEpochMs: number;
  advanceMinutes: AdvanceMinutesOption;
  alreadySent: boolean;
}

export interface AdapterCapabilities {
  adapterName: string;
  supportsBackgroundClosedApp: boolean;
  supportsFullAdhanWhenClosed: boolean;
  requiresUserInteractionForAudio: boolean;
  permissionState: NotificationPermission | 'unsupported';
  isStandalonePwa: boolean;
  isIOS: boolean;
  notes: string;
}

export interface ReminderAdapter {
  getCapabilities(): AdapterCapabilities;
  requestPermission(): Promise<NotificationPermission | 'unsupported'>;
  scheduleDay(params: {
    schedule: ResolvedDaySchedule;
    preferences: UserPreferences;
    zoneName: string;
    onTrigger?: (prayer: PrayerName, advanceMinutes: AdvanceMinutesOption, prayerTimeHHMM: string) => void;
  }): ScheduledReminderSummary[];
  scheduleTestTime?: (params: {
    triggerAtEpochMs: number;
    timeHHMM: string;
    zoneName: string;
    onTrigger?: (timeHHMM: string) => void;
  }) => void;
  clearTestTime?: () => void;
  checkDueRemindersNow(): void;
  cancelAll(): void;
  sendTestNotification(zoneName: string): Promise<boolean>;
}

const SENT_KEYS_STORAGE = 'my_adhan_sent_reminder_keys_v1';
const CATCHUP_GRACE_MS = 5 * 60 * 1000; // Catch missed timers up to 5 minutes after sleep/wake

export class ReminderDedupeRegistry {
  private keys: Set<string>;

  constructor() {
    this.keys = new Set(this.load());
  }

  private load(): string[] {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(SENT_KEYS_STORAGE);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') return;
    const trimmed = Array.from(this.keys).slice(-300);
    localStorage.setItem(SENT_KEYS_STORAGE, JSON.stringify(trimmed));
  }

  has(key: string): boolean {
    return this.keys.has(key);
  }

  markSent(key: string): void {
    this.keys.add(key);
    this.persist();
  }
}

interface ActiveReminderTarget {
  dedupeKey: string;
  prayer: PrayerName;
  prayerTimeHHMM: string;
  triggerAtEpochMs: number;
  advanceMinutes: AdvanceMinutesOption;
  zoneName: string;
  isAnnualRepeat: boolean;
}

export class WebNotificationReminderAdapter implements ReminderAdapter {
  private timers: number[] = [];
  private pollIntervalId: number | null = null;
  private activeTargets: ActiveReminderTarget[] = [];
  private activeOnTrigger?: (
    prayer: PrayerName,
    advanceMinutes: AdvanceMinutesOption,
    prayerTimeHHMM: string
  ) => void;
  private testTarget: {
    triggerAtEpochMs: number;
    timeHHMM: string;
    zoneName: string;
    fired: boolean;
    onTrigger?: (timeHHMM: string) => void;
  } | null = null;
  private testTimerId: number | null = null;
  private dedupe = new ReminderDedupeRegistry();

  private isStandalone(): boolean {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia?.('(display-mode: standalone)').matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
    );
  }

  private isIOS(): boolean {
    if (typeof navigator === 'undefined') return false;
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
  }

  getCapabilities(): AdapterCapabilities {
    const supported = typeof window !== 'undefined' && 'Notification' in window;
    const isIOS = this.isIOS();
    const isStandalonePwa = this.isStandalone();

    let notes =
      'Browser timers, catch-up checks, and Web Notifications fire while the app is open or active in memory. For guaranteed iOS Lock Screen alerts when the app is completely closed, add the 30-day calendar sync (.ics) to Apple Calendar.';
    if (isIOS && !isStandalonePwa) {
      notes =
        'In regular iPhone Safari tabs, Apple hides Web Notifications until you tap Share → Add to Home Screen. Once installed to the Home Screen (or synced via Apple Calendar), notifications work cleanly.';
    }

    return {
      adapterName: 'Web Notifications + Service Worker + Precision Poller',
      supportsBackgroundClosedApp: false,
      supportsFullAdhanWhenClosed: false,
      requiresUserInteractionForAudio: true,
      permissionState: supported ? Notification.permission : 'unsupported',
      isStandalonePwa,
      isIOS,
      notes,
    };
  }

  requestPermission(): Promise<NotificationPermission | 'unsupported'> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return Promise.resolve('unsupported');
    }
    if (Notification.permission === 'granted') return Promise.resolve('granted');
    if (Notification.permission === 'denied') return Promise.resolve('denied');

    return new Promise((resolve) => {
      let settled = false;
      const finish = (perm: NotificationPermission) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(perm);
      };

      const timeoutId = window.setTimeout(() => {
        finish(Notification.permission);
      }, 15_000);

      try {
        const res = Notification.requestPermission();
        if (res && typeof res.then === 'function') {
          res.then(
            (perm) => finish(perm),
            () => finish(Notification.permission)
          );
        } else {
          finish(Notification.permission);
        }
      } catch {
        try {
          Notification.requestPermission((perm) => finish(perm));
        } catch {
          finish(Notification.permission);
        }
      }
    });
  }

  cancelAll(): void {
    for (const id of this.timers) {
      window.clearTimeout(id);
    }
    this.timers = [];
    if (this.pollIntervalId !== null) {
      window.clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
    this.activeTargets = [];
  }

  private async showNotification(title: string, body: string, tag: string): Promise<void> {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const options: NotificationOptions & { renotify?: boolean; requireInteraction?: boolean } = {
      body,
      tag,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      renotify: true,
      requireInteraction: true,
    };

    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.showNotification(title, options);
          return;
        }
      }
    } catch {
      // Fall back to window Notification where allowed
    }

    try {
      new Notification(title, {
        body,
        tag,
        icon: '/pwa-192x192.png',
      });
    } catch {
      // Some mobile browsers (iOS / Android Chrome) forbid new Notification() without a SW
    }
  }

  private fireTarget(target: ActiveReminderTarget): void {
    if (this.dedupe.has(target.dedupeKey)) return;
    this.dedupe.markSent(target.dedupeKey);

    const label = PRAYER_LABELS[target.prayer];
    const formatted12 = formatTime12h(target.prayerTimeHHMM);
    const title =
      target.advanceMinutes > 0
        ? `${label} in ${target.advanceMinutes} min (${formatted12})`
        : `${label} Prayer Time (${formatted12})`;
    const body = `${target.zoneName} · ACJU Verified Timetable${
      target.isAnnualRepeat ? ' (2026 Annual Repeat)' : ''
    }`;

    void this.showNotification(title, body, target.dedupeKey);
    this.activeOnTrigger?.(target.prayer, target.advanceMinutes, target.prayerTimeHHMM);
  }

  private fireTestTarget(): void {
    if (!this.testTarget || this.testTarget.fired) return;
    this.testTarget.fired = true;
    const { timeHHMM, zoneName, triggerAtEpochMs, onTrigger } = this.testTarget;
    const formatted12 = formatTime12h(timeHHMM);
    void this.showNotification(
      `Sample Adhan Test (${formatted12})`,
      `${zoneName} · Live Notification & Adhan Playback Check`,
      `live-test-${triggerAtEpochMs}`
    );
    onTrigger?.(timeHHMM);
  }

  clearTestTime(): void {
    if (this.testTimerId !== null) {
      window.clearTimeout(this.testTimerId);
      this.testTimerId = null;
    }
    this.testTarget = null;
  }

  scheduleTestTime(params: {
    triggerAtEpochMs: number;
    timeHHMM: string;
    zoneName: string;
    onTrigger?: (timeHHMM: string) => void;
  }): void {
    this.clearTestTime();
    this.testTarget = {
      ...params,
      fired: false,
    };

    const delayMs = params.triggerAtEpochMs - Date.now();
    if (delayMs <= 0) {
      if (delayMs >= -CATCHUP_GRACE_MS) {
        this.fireTestTarget();
      }
      return;
    }

    if (delayMs <= 24 * 60 * 60 * 1000) {
      this.testTimerId = window.setTimeout(() => {
        this.fireTestTarget();
      }, delayMs);
    }

    if (this.pollIntervalId === null) {
      this.pollIntervalId = window.setInterval(() => {
        this.checkDueRemindersNow();
      }, 15_000);
    }
  }

  checkDueRemindersNow(): void {
    const nowMs = Date.now();
    for (const target of this.activeTargets) {
      if (this.dedupe.has(target.dedupeKey)) continue;
      const elapsedSinceTrigger = nowMs - target.triggerAtEpochMs;
      if (elapsedSinceTrigger >= 0 && elapsedSinceTrigger <= CATCHUP_GRACE_MS) {
        this.fireTarget(target);
      }
    }

    if (this.testTarget && !this.testTarget.fired) {
      const elapsed = nowMs - this.testTarget.triggerAtEpochMs;
      if (elapsed >= 0 && elapsed <= CATCHUP_GRACE_MS) {
        this.fireTestTarget();
      }
    }
  }

  scheduleDay(params: {
    schedule: ResolvedDaySchedule;
    preferences: UserPreferences;
    zoneName: string;
    onTrigger?: (prayer: PrayerName, advanceMinutes: AdvanceMinutesOption, prayerTimeHHMM: string) => void;
  }): ScheduledReminderSummary[] {
    this.cancelAll();

    const { schedule, preferences, zoneName, onTrigger } = params;
    this.activeOnTrigger = onTrigger;

    if (!schedule.isVerified || schedule.isDemoSample || !schedule.times) {
      return [];
    }

    const nowMs = Date.now();
    const summaries: ScheduledReminderSummary[] = [];
    const versionTag = schedule.versionId ?? `y${schedule.sourceYear ?? schedule.targetYear}`;

    for (const prayer of PRAYER_NAMES) {
      if (!preferences.perPrayerEnabled[prayer]) continue;
      const prayerTimeHHMM = schedule.times[prayer];
      const advanceMinutes = preferences.advanceMinutes[prayer] ?? 0;
      const prayerEpoch = colomboDateTimeToEpochMs(schedule.targetDate, prayerTimeHHMM);
      const triggerAtEpochMs = prayerEpoch - advanceMinutes * 60 * 1000;

      const dedupeKey = buildReminderDedupeKey({
        dateISO: schedule.targetDate,
        zoneId: schedule.zoneId,
        prayer,
        advanceMinutes,
        versionId: versionTag,
      });

      const alreadySent = this.dedupe.has(dedupeKey);
      summaries.push({
        dedupeKey,
        prayer,
        prayerTimeHHMM,
        triggerAtEpochMs,
        advanceMinutes,
        alreadySent,
      });

      if (alreadySent) continue;

      const target: ActiveReminderTarget = {
        dedupeKey,
        prayer,
        prayerTimeHHMM,
        triggerAtEpochMs,
        advanceMinutes,
        zoneName,
        isAnnualRepeat: schedule.isAnnualRepeat,
      };
      this.activeTargets.push(target);

      const delayMs = triggerAtEpochMs - nowMs;
      if (delayMs > 0 && delayMs <= 24 * 60 * 60 * 1000) {
        const timerId = window.setTimeout(() => {
          this.fireTarget(target);
        }, delayMs);
        this.timers.push(timerId);
      }
    }

    // Immediate catch-up check if a prayer arrived within the last 5 minutes, plus 15s precision poll
    this.checkDueRemindersNow();
    this.pollIntervalId = window.setInterval(() => {
      this.checkDueRemindersNow();
    }, 15_000);

    return summaries;
  }

  async sendTestNotification(zoneName: string): Promise<boolean> {
    const perm = await this.requestPermission();
    if (perm !== 'granted') return false;
    await this.showNotification(
      'My Adhan — Test Alert',
      `Notifications are active for ${zoneName} (Asia/Colombo). Keep the app open or use Apple Calendar sync for closed-app lock screen alerts.`,
      `test-${Date.now()}`
    );
    return true;
  }
}

export class IOSAlarmKitAdapter implements ReminderAdapter {
  getCapabilities(): AdapterCapabilities {
    return {
      adapterName: 'Native iOS AlarmKit Bridge (Unavailable in Browser PWA)',
      supportsBackgroundClosedApp: true,
      supportsFullAdhanWhenClosed: true,
      requiresUserInteractionForAudio: false,
      permissionState: 'unsupported',
      isStandalonePwa: true,
      isIOS: true,
      notes:
        'Requires native iOS app shell with AlarmKit entitlement. In the browser/Safari PWA runtime, WebNotificationReminderAdapter is active instead.',
    };
  }

  async requestPermission(): Promise<NotificationPermission | 'unsupported'> {
    return 'unsupported';
  }

  scheduleDay(): ScheduledReminderSummary[] {
    return [];
  }

  checkDueRemindersNow(): void {
    // Native bridge no-op
  }

  cancelAll(): void {
    // Native bridge no-op
  }

  async sendTestNotification(): Promise<boolean> {
    return false;
  }
}

export function createReminderAdapter(): ReminderAdapter {
  const nativeBridge = (window as unknown as { MyAdhanAlarmKit?: ReminderAdapter })?.MyAdhanAlarmKit;
  if (nativeBridge) return nativeBridge;
  return new WebNotificationReminderAdapter();
}
