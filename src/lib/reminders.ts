import {
  buildReminderDedupeKey,
  colomboDateTimeToEpochMs,
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
  notes: string;
}

/**
 * Clean abstraction for prayer reminder scheduling.
 * Allows plugging in a future native iOS AlarmKit implementation (via Capacitor/Swift bridge)
 * without changing UI or timetable resolution code.
 */
export interface ReminderAdapter {
  getCapabilities(): AdapterCapabilities;
  requestPermission(): Promise<NotificationPermission | 'unsupported'>;
  scheduleDay(params: {
    schedule: ResolvedDaySchedule;
    preferences: UserPreferences;
    zoneName: string;
    onTrigger?: (prayer: PrayerName, advanceMinutes: AdvanceMinutesOption) => void;
  }): ScheduledReminderSummary[];
  cancelAll(): void;
  sendTestNotification(zoneName: string): Promise<boolean>;
}

const SENT_KEYS_STORAGE = 'my_adhan_sent_reminder_keys_v1';

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
    // Keep only the latest 300 entries to prevent unbounded growth
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

export class WebNotificationReminderAdapter implements ReminderAdapter {
  private timers: number[] = [];
  private dedupe = new ReminderDedupeRegistry();

  getCapabilities(): AdapterCapabilities {
    const supported = typeof window !== 'undefined' && 'Notification' in window;
    return {
      adapterName: 'Web Notifications + Service Worker',
      supportsBackgroundClosedApp: false,
      supportsFullAdhanWhenClosed: false,
      requiresUserInteractionForAudio: true,
      permissionState: supported ? Notification.permission : 'unsupported',
      notes:
        'Browser timers and Web Notifications fire reliably while the PWA is open or active in memory. On iOS Safari and Android browsers, background delivery and full Adhan audio when the app is closed or suspended are restricted by the operating system.',
    };
  }

  async requestPermission(): Promise<NotificationPermission | 'unsupported'> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    if (Notification.permission === 'granted') return 'granted';
    return await Notification.requestPermission();
  }

  cancelAll(): void {
    for (const id of this.timers) {
      window.clearTimeout(id);
    }
    this.timers = [];
  }

  private async showNotification(title: string, body: string, tag: string): Promise<void> {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.showNotification(title, {
            body,
            tag,
            icon: '/pwa-192x192.png',
            badge: '/pwa-192x192.png',
          });
          return;
        }
      }
    } catch {
      // Fallback to window Notification below
    }

    new Notification(title, {
      body,
      tag,
      icon: '/pwa-192x192.png',
    });
  }

  scheduleDay(params: {
    schedule: ResolvedDaySchedule;
    preferences: UserPreferences;
    zoneName: string;
    onTrigger?: (prayer: PrayerName, advanceMinutes: AdvanceMinutesOption) => void;
  }): ScheduledReminderSummary[] {
    this.cancelAll();

    const { schedule, preferences, zoneName, onTrigger } = params;

    // CRITICAL POLICY: Unverified, missing, leap-day, or demo sample data must NEVER schedule live reminders.
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

      const delayMs = triggerAtEpochMs - nowMs;
      // Schedule timers up to 24h ahead; setTimeout max safe int check
      if (delayMs > 0 && delayMs <= 24 * 60 * 60 * 1000) {
        const timerId = window.setTimeout(() => {
          if (this.dedupe.has(dedupeKey)) return;
          this.dedupe.markSent(dedupeKey);
          const label = PRAYER_LABELS[prayer];
          const title =
            advanceMinutes > 0
              ? `${label} in ${advanceMinutes} min (${prayerTimeHHMM})`
              : `${label} Prayer Time (${prayerTimeHHMM})`;
          const body = `${zoneName} · ACJU Verified Timetable${
            schedule.isAnnualRepeat ? ' (2026 Annual Repeat)' : ''
          }`;
          void this.showNotification(title, body, dedupeKey);
          onTrigger?.(prayer, advanceMinutes);
        }, delayMs);
        this.timers.push(timerId);
      }
    }

    return summaries;
  }

  async sendTestNotification(zoneName: string): Promise<boolean> {
    const perm = await this.requestPermission();
    if (perm !== 'granted') return false;
    await this.showNotification(
      'My Adhan — Test Reminder',
      `Reminders are enabled for ${zoneName} (Asia/Colombo). Note: iOS PWA background delivery requires the app/system notification channel to remain active.`,
      `test-${Date.now()}`
    );
    return true;
  }
}

/**
 * Future Native iOS AlarmKit Adapter Contract.
 * Designed for a Swift/Capacitor bridge targeting iOS 26+ AlarmKit when packaged natively.
 */
export class IOSAlarmKitAdapter implements ReminderAdapter {
  getCapabilities(): AdapterCapabilities {
    return {
      adapterName: 'Native iOS AlarmKit Bridge (Unavailable in Browser PWA)',
      supportsBackgroundClosedApp: true,
      supportsFullAdhanWhenClosed: true,
      requiresUserInteractionForAudio: false,
      permissionState: 'unsupported',
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

  cancelAll(): void {
    // Native bridge no-op in browser runtime
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
