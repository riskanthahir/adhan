# My Adhan — Sri Lanka Prayer Times PWA

**My Adhan** is a full-stack, offline-ready Progressive Web App (PWA) for Sri Lanka built with React, TypeScript, Vite, Tailwind CSS, Express, and SQLite (`node:sqlite`). It embeds the complete official **2026 All-Ceylon Jamiyyathul Ulama (ACJU)** prayer timetable across all 13 geographical groups (`4,745` daily records) and includes a **server-side Web Push notification engine** compatible with installed **iOS 16.4+ Home Screen PWAs**, Android, and desktop browsers.

---

## Key Features

- **Complete Embedded Official 2026 ACJU Timetable:** All 5 daily prayers (`Fajr`, `Dhuhr`, `Asr`, `Maghrib`, `Isha`) plus daily `Sunrise` for all 13 Sri Lankan ACJU geographical groups (`src/shared/acju2026Timetable.ts`).
- **Background Web Push Notifications (iOS 16.4+ APNs & Android FCM):** Server-side Node scheduler (`server/scheduler.ts`) runs independently every 15 seconds in `Asia/Colombo` time, dispatches encrypted VAPID Web Push messages (`web-push`) for each user's district & per-prayer preferences (including configurable `0 / 5 / 10 / 15 / 30` minute lead reminders), deduplicates by unique `event_key`, retries transient errors, and cleans up `410 Gone` subscriptions.
- **Custom Service Worker (`src/sw.ts`):** Handles Workbox offline precaching plus mandatory Apple-compliant `showNotification()`, `notificationclick` opening/verification, and `pushsubscriptionchange` automatic key renewal.
- **Push Diagnostics Console (`PushDiagnosticsView`):** Verifies HTTPS, Service Worker registration/ping, `Notification.permission`, `PushManager`, subscription persistence, VAPID config, test push delivery, click verification, and `410` cleanup.
- **Annual Repeat & Feb 29 Safety Policy:** Future years match `(month, day)` cleanly against 2026 ACJU data; Feb 29 is never silently invented.
- **Manual Adhan Audio & Lock Screen Calendar Sync:** Keeps full Makkah Adhan `.mp3`, harmonic chime, and local MP3 playback inside the app cleanly separated from iOS system-sound background Web Push notifications, alongside one-tap `.ics` iPhone Lock Screen calendar export.

---

## Local Development & Production Commands

```bash
npm install
cp .env.example .env   # Optional; auto-generates persistent VAPID keys in SQLite if omitted

npm run dev            # Starts Express + Vite middleware on http://localhost:3000
npm test               # Runs all Vitest suites (ACJU timetable + Web Push backend/scheduler)
npm run lint           # Runs TypeScript type-checking (tsc --noEmit)
npm run build          # Builds production client bundle + custom sw.js into dist/
npm start              # Runs production server (NODE_ENV=production node server.ts)
```

---

## Documentation

Full instructions for database schema & migrations, VAPID key generation, `.env` variables, HTTPS server deployment, iPhone Home Screen installation, iOS audio limitations, and physical iPhone A–G verification scenarios are in:

👉 **[docs/IOS_WEB_PUSH_SETUP.md](./docs/IOS_WEB_PUSH_SETUP.md)**
