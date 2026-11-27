# iPhone & Backend Web Push Setup Guide (My Adhan)

This document details the full architecture, database schema, VAPID key management, scheduling, deployment, iPhone PWA setup, audio behavior, and physical iPhone verification workflow for **My Adhan** background prayer notifications.

---

## 1. Architecture Overview

| Component | File(s) | Purpose |
| --- | --- | --- |
| Express Server | `server.ts` | Serves `/api/*`, mounts Vite middleware in dev (`tsx server.ts`) or `dist/` static assets in production (`node server.ts`), starts the scheduler loop |
| Push API Routes | `server/pushRoutes.ts` | `/api/health`, `/api/push/vapid-public-key`, `/api/push/subscribe`, `/api/push/preferences`, `/api/push/unsubscribe`, `/api/push/status`, `/api/push/test`, `/api/push/verify-click`, `/api/push/diagnostics`, `/api/push/cron` |
| SQLite Storage & Migrations | `server/db.ts`, `server/migrations/001_initial_push_schema.sql` | Uses Node 22 built-in `node:sqlite` (`WAL` mode) for `push_subscriptions`, `notification_deliveries`, `app_config`, and `push_server_logs` |
| VAPID Key Manager | `server/vapid.ts` | Loads `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` from environment variables or auto-generates & stores a persistent keypair in SQLite `app_config` |
| Server Prayer Scheduler | `server/scheduler.ts` | Runs every 15s (plus startup recovery tick), reads embedded ACJU schedules (`src/shared/acju2026Timetable.ts`), dispatches encrypted Web Push notifications via `web-push` with `TTL=300s`, retries transient errors, and cleans up `404`/`410` expired endpoints |
| Service Worker | `src/sw.ts` | `vite-plugin-pwa` `injectManifest` custom Service Worker handling `push` (always calling `showNotification()`), `notificationclick` (focus/open app + click verification), and `pushsubscriptionchange` (automatic key renewal) |
| Frontend Push Client & Diagnostics | `src/lib/webPushClient.ts`, `src/components/PushDiagnosticsView.tsx`, `src/components/AudioRemindersView.tsx` | 10-step iOS-compatible subscription registration, per-prayer toggles, configurable reminder lead time (`0 / 5 / 10 / 15 / 30` min), live SW telemetry, and diagnostics |

---

## 2. Database Schema & Migrations

Migrations live in `server/migrations/` and run automatically on server boot inside an atomic transaction tracked in `schema_migrations`.

Core tables in `server/migrations/001_initial_push_schema.sql`:
- `schema_migrations`: Tracks applied `.sql` migration versions.
- `app_config`: Key/value store (stores auto-generated `vapid_public_key` / `vapid_private_key` if not provided via environment variables).
- `push_subscriptions`: Stores `device_id`, SHA-256 `device_token_hash`, `endpoint`, `p256dh_key`, `auth_key`, `district_id`, `zone_id`, `timezone` (`Asia/Colombo`), `per_prayer_enabled_json`, `advance_minutes_json`, `status` (`active | disabled | expired | invalid`), timestamps, `failure_count`, and `last_delivery_error`.
- `notification_deliveries`: Deduplication ledger keyed on unique `event_key` (`deviceId::dateISO::prayer::m{advance}::v{version}`), tracking `status`, `attempt_count`, `http_status`, and `error_message`.
- `push_server_logs`: Bounded (last 1,000 rows) operational audit log visible in the Diagnostics view.

To reset the database locally, stop the server and delete the SQLite file specified by `DATABASE_PATH` (defaults to `./data/my-adhan.db`).

---

## 3. Environment Variables & VAPID Setup

Copy `.env.example` to `.env`:

```bash
PORT=3000
NODE_ENV=production
DATABASE_PATH=./data/my-adhan.db
VAPID_SUBJECT=mailto:notifications@myadhan.lk
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
CRON_SECRET=
```

### Generating Static VAPID Keys (Recommended for Production)

```bash
npx web-push generate-vapid-keys
```

Set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in your hosting environment.
- **Security**: `VAPID_PRIVATE_KEY` is only loaded inside `server/vapid.ts` and is never returned by any API endpoint or bundled into `dist/`.
- If `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are left blank, the server generates an EC P-256 VAPID pair automatically on first boot and persists it in `app_config`.

---

## 4. Scheduler Configuration & External Cron

1. **Always-On Node Hosting (Default)**: `server.ts` calls `startScheduler()`, running every **15 seconds** independently of any user browser or phone, using `Asia/Colombo` (`UTC+05:30`) and the embedded ACJU timetable. If the backend restarts inside the 5-minute grace window (`DELIVERY_GRACE_WINDOW_MS = 300000`), missed deliveries recover automatically without duplicating already-sent `event_key` rows.
2. **External Cron Fallback (`POST /api/push/cron`)**: If deploying to an environment with external cron triggers, configure `CRON_SECRET` and send an authenticated POST request every minute:
   ```bash
   curl -X POST https://your-domain.com/api/push/cron \
     -H "Authorization: Bearer YOUR_CRON_SECRET"
   ```

---

## 5. Production Deployment Instructions (HTTPS Required for iOS Web Push)

Apple Push Notification service (`web.push.apple.com`) **requires a valid HTTPS origin** and a persistent Node.js server (static-only CDNs cannot run the background 15-second scheduler or SQLite database).

Recommended deployment targets: **Railway, Render, Fly.io, DigitalOcean App Platform, or a VPS behind Nginx/Caddy with TLS**:

```bash
# Requires Node.js v22+ (uses built-in node:sqlite & native TS stripping)
npm ci
npm run build
NODE_ENV=production node server.ts
```

Important reverse-proxy headers:
- Terminate TLS (HTTPS) in front of port `3000` (`server.ts` sets `app.set('trust proxy', 1)`).
- Ensure `/sw.js` is served with `Cache-Control: public, max-age=0, must-revalidate` (already set in `server.ts`).
- Mount a persistent volume at `/app/data` (or point `DATABASE_PATH` to your mounted disk) so subscriptions and VAPID keys survive container redeploys.

---

## 6. Installing on iPhone (iOS 16.4+) & Enabling Permissions

1. Open the deployed **HTTPS** URL of My Adhan in **Safari** on your iPhone (iOS 16.4 or newer). *(Do not use an in-app browser.)*
2. Tap the **Share** icon → **Add to Home Screen** → **Add**.
3. **Close Safari** and launch **My Adhan** from your iPhone Home Screen icon. *(Web Push / Notification APIs are only exposed on iOS inside an installed Home Screen standalone app.)*
4. Go to **Audio & Alerts** → **Background Web Push (iOS 16.4+ & Android)** and tap **Enable Prayer Notifications**.
5. Accept the iOS system notification prompt when shown (triggered directly from your tap).
6. Verify the badge reads **Subscribed** and tap **Send Test Notification** to confirm end-to-end delivery.
7. Optionally open **Push Diagnostics** (`Diagnostics` button in Audio & Alerts or Settings) to inspect every check.

---

## 7. iOS Background Audio vs Web Push Notification Sound Limitations

- **Background Web Push (app closed or iPhone locked)**: Safari / iOS WebKit strictly forbids running background web audio or playing custom `.mp3` Adhan recordings from a Service Worker `push` event. Apple also **requires** every `push` event to call `registration.showNotification(...)` visibly (otherwise Apple revokes push permission). When a prayer push arrives on a locked iPhone, iOS plays the **standard system notification sound/banner** and shows the prayer name & ACJU local time.
- **Foreground / Manual Adhan Playback**: Full Makkah Adhan `.mp3`, harmonic chime, or custom local audio plays when triggered manually in **Audio & Alerts**, or during an active foreground session when the **Sample Adhan** live test row or prayer countdown completes while the screen is open and audio has been unlocked.

---

## 8. Physical iPhone Testing Report Template & Verification Checklist

Verify the following scenarios on a **physical iPhone (iOS 16.4+)** installed to Home Screen over HTTPS (use the **Audio & Alerts** per-prayer lead time or **Send Test Notification**, plus **Push Diagnostics**):

| Scenario | Test Action | Expected Result |
| --- | --- | --- |
| **A. App open in foreground** | Tap **Send Test Notification** (or wait for scheduled prayer / lead reminder) with app open | System banner notification appears; **Push Diagnostics** shows `PUSH_RECEIVED` from Service Worker and updated `Last Delivery Success` timestamp |
| **B. App in background** | Switch to another app without force-closing My Adhan; trigger test or scheduled prayer push | iOS displays banner notification on screen with prayer name, time, and ACJU district |
| **C. App completely closed** | Swipe up in iOS App Switcher to force-quit My Adhan; send test / wait for prayer time | Notification still arrives reliably from the Node scheduler via APNs (`web.push.apple.com`) |
| **D. iPhone screen locked** | Lock the iPhone screen; wait for scheduled prayer time (`Fajr/Dhuhr/Asr/Maghrib/Isha`) | Lock screen wakes and displays the prayer-time notification with system chime |
| **E. Temporary disconnect** | Toggle Airplane Mode on for 1–2 minutes across a test push, then reconnect (within 300s TTL) | Notification is queued by APNs and delivered upon reconnection; stale pushes older than `TTL=300s` expire so old prayers do not arrive hours late |
| **F. Reopened after hours** | Lock/leave phone overnight and reopen Home Screen app hours later | Subscription status remains `active`; **Push Diagnostics** reflects delivered prayer rows & click verification updates `Last Notification Click` when tapping a banner |
| **G. Disable & Re-enable** | Tap **Disable Notifications**, confirm `Disabled` status & server rejects test sends; tap **Enable Prayer Notifications** again | Backend reactivates subscription (`active`), updates `Last Registered`, and test push succeeds immediately |
