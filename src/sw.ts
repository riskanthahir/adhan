/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null } | string>;
};

const SW_META_DB = 'my_adhan_sw_meta';
const SW_META_STORE = 'kv';
const PUSH_CHANNEL_NAME = 'my-adhan-push';

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = self.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function readSwMeta(key: string): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(SW_META_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SW_META_STORE)) {
          db.createObjectStore(SW_META_STORE);
        }
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          const tx = db.transaction(SW_META_STORE, 'readonly');
          const getReq = tx.objectStore(SW_META_STORE).get(key);
          getReq.onsuccess = () => resolve(getReq.result ?? null);
          getReq.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function broadcastPushEvent(message: Record<string, unknown>): void {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel(PUSH_CHANNEL_NAME);
      bc.postMessage(message);
      bc.close();
    }
  } catch {
    // Ignore BroadcastChannel unavailability
  }
}

cleanupOutdatedCaches();
const manifestEntries = self.__WB_MANIFEST ?? [];
precacheAndRoute(manifestEntries);

const hasPrecachedIndex = manifestEntries.some((entry) => {
  const url = typeof entry === 'string' ? entry : entry.url;
  return url === '/index.html' || url === 'index.html';
});

if (hasPrecachedIndex) {
  const navHandler = createHandlerBoundToURL('/index.html');
  registerRoute(
    new NavigationRoute(navHandler, {
      denylist: [/^\/api\//],
    })
  );
}

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const data = event.data as { type?: string } | null;
  if (data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  } else if (data?.type === 'SW_PING') {
    event.ports?.[0]?.postMessage({
      ok: true,
      swVersion: 'my-adhan-push-v1',
      timestamp: new Date().toISOString(),
    });
  }
});

interface IncomingPushData {
  title?: string;
  body?: string;
  prayer?: string;
  prayerTimeHHMM?: string;
  advanceMinutes?: number;
  dateISO?: string;
  zoneId?: number;
  zoneName?: string;
  eventKey?: string;
  url?: string;
  sentAt?: string;
  isTest?: boolean;
}

self.addEventListener('push', (event: PushEvent) => {
  event.waitUntil(
    (async () => {
      let parsed: IncomingPushData = {};
      try {
        if (event.data) {
          const text = event.data.text();
          try {
            parsed = JSON.parse(text) as IncomingPushData;
          } catch {
            parsed = { body: text };
          }
        }
      } catch {
        parsed = {};
      }

      const title =
        typeof parsed.title === 'string' && parsed.title.trim()
          ? parsed.title.trim().slice(0, 120)
          : 'My Adhan · Prayer Reminder';

      const body =
        typeof parsed.body === 'string' && parsed.body.trim()
          ? parsed.body.trim().slice(0, 240)
          : 'Prayer time notification (Asia/Colombo)';

      const eventKey =
        typeof parsed.eventKey === 'string' && parsed.eventKey
          ? parsed.eventKey
          : `adhan-push-${Date.now()}`;

      const targetUrl =
        typeof parsed.url === 'string' && parsed.url.startsWith('/')
          ? parsed.url
          : '/?fromPush=1';

      // IMPORTANT FOR APPLE iOS 16.4+: Always display a visible notification on every push
      await self.registration.showNotification(title, {
        body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag: eventKey,
        data: {
          url: targetUrl,
          prayer: parsed.prayer ?? null,
          prayerTimeHHMM: parsed.prayerTimeHHMM ?? null,
          eventKey,
          receivedAt: new Date().toISOString(),
          isTest: Boolean(parsed.isTest),
        },
      });

      broadcastPushEvent({
        type: 'PUSH_RECEIVED',
        title,
        body,
        eventKey,
        prayer: parsed.prayer ?? null,
        receivedAt: new Date().toISOString(),
      });

      try {
        const allClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        for (const client of allClients) {
          client.postMessage({
            type: 'PUSH_RECEIVED',
            title,
            body,
            eventKey,
            prayer: parsed.prayer ?? null,
            receivedAt: new Date().toISOString(),
          });
        }
      } catch {
        // Ignore client postMessage failures
      }
    })()
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  const notifData = (event.notification.data ?? {}) as {
    url?: string;
    eventKey?: string;
    prayer?: string | null;
  };
  const targetPath =
    typeof notifData.url === 'string' && notifData.url.startsWith('/')
      ? notifData.url
      : '/?fromPush=1';

  event.waitUntil(
    (async () => {
      broadcastPushEvent({
        type: 'NOTIFICATION_CLICKED',
        eventKey: notifData.eventKey ?? null,
        url: targetPath,
        clickedAt: new Date().toISOString(),
      });

      // Notify backend that notification click handling succeeded
      try {
        const deviceMeta = (await readSwMeta('device_registration')) as {
          deviceId?: string;
          deviceToken?: string;
        } | null;
        if (deviceMeta?.deviceId && deviceMeta?.deviceToken) {
          await fetch('/api/push/verify-click', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Device-Token': deviceMeta.deviceToken,
            },
            body: JSON.stringify({
              deviceId: deviceMeta.deviceId,
              eventKey: notifData.eventKey ?? null,
            }),
          });
        }
      } catch {
        // Non-blocking best-effort click verification
      }

      const fullTargetUrl = new URL(targetPath, self.location.origin).toString();
      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          await client.focus();
          client.postMessage({
            type: 'NOTIFICATION_CLICKED',
            eventKey: notifData.eventKey ?? null,
            url: targetPath,
          });
          return;
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(fullTargetUrl);
      }
    })()
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  const pushChangeEvent = event as ExtendableEvent & {
    oldSubscription?: PushSubscription;
    newSubscription?: PushSubscription;
  };

  pushChangeEvent.waitUntil(
    (async () => {
      try {
        const deviceMeta = (await readSwMeta('device_registration')) as {
          deviceId?: string;
          deviceToken?: string;
          districtId?: string;
          perPrayerEnabled?: Record<string, boolean>;
          advanceMinutes?: Record<string, number>;
          vapidPublicKey?: string;
        } | null;

        if (!deviceMeta?.deviceId || !deviceMeta?.deviceToken) return;

        let newSub = pushChangeEvent.newSubscription;
        if (!newSub) {
          let vapidPublicKey = deviceMeta.vapidPublicKey;
          if (!vapidPublicKey) {
            const keyRes = await fetch('/api/push/vapid-public-key');
            if (keyRes.ok) {
              const keyJson = (await keyRes.json()) as { publicKey?: string };
              vapidPublicKey = keyJson.publicKey;
            }
          }
          if (!vapidPublicKey) return;

          newSub = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
          });
        }

        const subJson = newSub.toJSON();
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Device-Token': deviceMeta.deviceToken,
          },
          body: JSON.stringify({
            deviceId: deviceMeta.deviceId,
            deviceToken: deviceMeta.deviceToken,
            subscription: subJson,
            districtId: deviceMeta.districtId ?? 'colombo',
            perPrayerEnabled: deviceMeta.perPrayerEnabled,
            advanceMinutes: deviceMeta.advanceMinutes,
          }),
        });

        broadcastPushEvent({
          type: 'SUBSCRIPTION_RENEWED',
          renewedAt: new Date().toISOString(),
        });
      } catch {
        // Subscription renewal will be retried when app opens
      }
    })()
  );
});
