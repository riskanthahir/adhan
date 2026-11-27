# My Adhan — Sri Lanka Prayer Times PWA

**My Adhan** is an offline-ready Progressive Web App (PWA) for Sri Lanka built with React, TypeScript, Vite, Tailwind CSS, and custom Service Worker (`src/sw.ts`). It embeds the complete official **2026 All-Ceylon Jamiyyathul Ulama (ACJU)** prayer timetable across all 29 Sri Lankan district/area entries (`13` geographical zones, `365` days per zone, including daily `Sunrise`) and supports **background iOS 16.4+ & Android Web Push notifications** backed by **Supabase (PostgreSQL + Edge Functions + `pg_cron` + `pg_net` + Vault)** when deployed on **Vercel**, as well as a local Express + SQLite preview mode.

---

## Architecture Highlights

- **Frontend (GitHub + Vercel):** React 19 SPA + `vite-plugin-pwa` (`injectManifest`) with offline precaching, ACJU timetable lookup, GPS district matching, Sunrise display, Sample Adhan test row, `.ics` Lock Screen calendar export, foreground Adhan audio studio, Notification Settings, and a live Push Diagnostics Console (`PushDiagnosticsView`).
- **ACJU Source-of-Truth JSON (`data/acju-2026/*.json`):** Exported JSON schedules for all 29 Sri Lankan districts (`Asia/Colombo`, zero fabricated Feb 29 dates), versioned in GitHub and synced to Supabase `public.prayer_times` via `npm run supabase:sync-prayers`.
- **Supabase Backend (`supabase/`):**
  - **PostgreSQL + RLS Migrations:** `devices`, `push_subscriptions`, `notification_preferences`, `prayer_times`, `notification_logs` (unique `idempotency_key`), `scheduler_logs`, and `edge_rate_limits`.
  - **5 Edge Functions:** `register-device`, `update-preferences`, `send-test-push`, `dispatch-prayer-push`, `cleanup-subscriptions`.
  - **`pg_cron` + `pg_net` + Vault Scheduler:** Runs every minute (`* * * * *`) in `Asia/Colombo` time with short `TTL=300s`, retries, and HTTP `404/410` expired endpoint cleanup.
- **Local Express Preview (`server.ts`):** When `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are unset, automatically runs against local `/api/push/*` routes backed by Node 22 `node:sqlite`.

---

## Commands

```bash
npm install
cp .env.example .env           # Configure local & backend variables cleanly
npm run vapid:generate         # One-time P-256 VAPID keypair generator

npm run dev                    # Starts local Express + Vite dev server on port 3000
npm run acju:export-json       # Exports data/acju-2026/*.json (29 districts x 365 days)
npm run supabase:sync-prayers  # Syncs ACJU JSON schedules into Supabase prayer_times
npm test                       # Runs all Vitest suites
npm run lint                   # Runs TypeScript type-checking (tsc --noEmit)
npm run build                  # Builds production frontend + dist/sw.js for Vercel
```

---

## Complete Supabase + Vercel Deployment & iPhone Verification Guide

See 👉 **[docs/IOS_WEB_PUSH_SETUP.md](./docs/IOS_WEB_PUSH_SETUP.md)** for full instructions covering database migrations, Vault & `pg_cron`, VAPID secrets, Edge Function deployment, Vercel environment variables, security boundaries, and the 13-point physical iPhone verification matrix.
