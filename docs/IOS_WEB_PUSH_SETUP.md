# iPhone, Supabase & Vercel Web Push Setup Guide (My Adhan)

This document covers the complete production deployment architecture (**GitHub + Vercel + Supabase PostgreSQL + Supabase Edge Functions + `pg_cron`/`pg_net` + Supabase Vault**), local Express development mode, ACJU JSON data sync, VAPID key configuration, iOS 16.4+ PWA installation, audio behavior, and the **13-point Physical iPhone Verification Matrix**.

---

## 1. Dual Backend Architecture

**My Adhan** automatically selects its backend transport at build/runtime:

| Environment | Frontend Variable(s) | Backend Storage & Push Engine |
| --- | --- | --- |
| **Production (Vercel + Supabase)** *(Recommended)* | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` | **Supabase PostgreSQL** (`devices`, `push_subscriptions`, `notification_preferences`, `prayer_times`, `notification_logs`, `scheduler_logs`, `edge_rate_limits`), **5 Supabase Edge Functions**, and **`pg_cron` (`* * * * *`) + `pg_net` + Vault** |
| **Local Preview / Express Node Hosting** | Omit `VITE_SUPABASE_*` | Local Express (`server.ts`, `server/pushRoutes.ts`), Node 22 SQLite (`node:sqlite`), and 15-second Node scheduler (`server/scheduler.ts`) |

---

## 2. Database Schema & Migrations (Supabase PostgreSQL)

Migrations live in `supabase/migrations/`:

1. `supabase/migrations/20261127000001_initial_adhan_push_schema.sql`
   - `devices`: UUID PK, `device_id`, SHA-256 `device_token_hash`, `district_id`, `zone_id`, `timezone` (`Asia/Colombo`), `user_agent`, `last_seen_at`, timestamps.
   - `push_subscriptions`: Foreign key `device_uuid -> devices(id) ON DELETE CASCADE`, unique HTTPS `endpoint`, `p256dh_key`, `auth_key`, `status` (`active | disabled | expired | invalid`), `failure_count`, registration/verification/delivery/click timestamps.
   - `notification_preferences`: Per-prayer booleans (`fajr_enabled`..`isha_enabled`) and allowed lead offsets (`0 | 5 | 10 | 15 | 30` minutes).
   - `prayer_times`: Official ACJU district prayer times (`fajr`, `sunrise`, `dhuhr`, `asr`, `maghrib`, `isha`, `timezone`, `source_version`, `is_annual_repeat`) with `UNIQUE (district_id, prayer_date)`.
   - `notification_logs`: Deduplication ledger enforcing `UNIQUE (idempotency_key)` shaped as `<device_id>:<prayer_date>:<prayer_name>:<reminder_offset>`.
   - `scheduler_logs` & `edge_rate_limits` + atomic `check_and_increment_rate_limit(...)` RPC.
   - **Row Level Security (RLS):** Enabled on all 7 tables. Public (`anon`/`authenticated`) gets read-only `SELECT` exclusively on `prayer_times`; all user/device/subscription/log tables are completely restricted to server-side `service_role` inside Edge Functions.
2. `supabase/migrations/20261127000002_pg_cron_scheduler.sql`
   - Enables `pg_cron` and `pg_net`.
   - Defines `public.invoke_my_adhan_edge_function(text)` reading `project_url` and `cron_secret` from `vault.decrypted_secrets`.
   - Schedules `dispatch-prayer-push` every minute (`* * * * *`) and `cleanup-subscriptions` daily (`15 21 * * *` UTC / 02:45 `Asia/Colombo`).

---

## 3. ACJU District JSON Repository & Sync

- Official 2026 ACJU district timetables are stored in GitHub under `data/acju-2026/*.json` (`29` district files × `365` days each + `index.json`), exported directly from `src/shared/acjuSeed.ts` and `src/shared/acju2026Timetable.ts` so the offline PWA remains 100% functional without network connectivity.
- **Never** invent Feb 29 or modify published ACJU times.

Commands:

```bash
# Re-export district JSON files if source timetable updates
npm run acju:export-json

# Validate chronology and upsert ACJU JSON schedules into Supabase prayer_times
# Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (never commit .env)
npm run supabase:sync-prayers
```

---

## 4. VAPID Key Pair Generation & Security Boundaries

Generate one persistent VAPID key pair once:

```bash
npm run vapid:generate
```

### Key Placement Rules (Critical Security)

| Secret / Variable | Where to Set | Allowed in Frontend / GitHub? |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Vercel Env Vars & local `.env` | Yes (`VITE_*` client-safe) |
| `VITE_SUPABASE_ANON_KEY` | Vercel Env Vars & local `.env` | Yes (`VITE_*` client-safe; protected by RLS) |
| `VAPID_PUBLIC_KEY` | Supabase Edge Function Secrets | Exposed via backend `register-device?action=vapid-public-key` only |
| `VAPID_PRIVATE_KEY` | Supabase Edge Function Secrets | **NEVER** in frontend, Vercel `VITE_*`, or GitHub |
| `VAPID_SUBJECT` | Supabase Edge Function Secrets (`mailto:...`) | Backend only |
| `CRON_SECRET` | Supabase Edge Secrets **AND** Supabase Vault (`cron_secret`) | **NEVER** in frontend or GitHub |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Edge Secrets + local `.env` for sync script | **NEVER** in frontend, Vercel `VITE_*`, or GitHub |

If VAPID secrets are missing or mismatched, the backend **refuses** to silently invent keys and returns HTTP `503` with clear setup steps.

---

## 5. Step-by-Step Supabase + Vercel Deployment

### Step 1: Create Supabase Project & Push Database Migrations

```bash
npm install -g supabase
supabase login
supabase link --project-ref <YOUR_PROJECT_REF>
supabase db push
```

### Step 2: Configure Supabase Secrets & Vault

1. Set Edge Function secrets:
   ```bash
   # Generate a strong CRON_SECRET first, e.g.: openssl rand -hex 32
   supabase secrets set \
     VAPID_PUBLIC_KEY="<YOUR_VAPID_PUBLIC_KEY>" \
     VAPID_PRIVATE_KEY="<YOUR_VAPID_PRIVATE_KEY>" \
     VAPID_SUBJECT="mailto:notifications@myadhan.lk" \
     CRON_SECRET="<YOUR_RANDOM_CRON_SECRET>"
   ```
2. Add Vault secrets in **Supabase Dashboard → SQL Editor** (must match `CRON_SECRET` above):
   ```sql
   SELECT vault.create_secret('https://<YOUR_PROJECT_REF>.supabase.co', 'project_url');
   SELECT vault.create_secret('<YOUR_RANDOM_CRON_SECRET>', 'cron_secret');
   ```
3. Optional: restrict `ALLOWED_ORIGIN` once Vercel URL is ready:
   ```bash
   supabase secrets set ALLOWED_ORIGIN="https://<YOUR_APP>.vercel.app"
   ```

### Step 3: Deploy the 5 Supabase Edge Functions

(`supabase/config.toml` already sets `verify_jwt = false` so custom `X-Device-Token` and Vault `CRON_SECRET` verification run directly inside each Edge Function.)

```bash
supabase functions deploy register-device
supabase functions deploy update-preferences
supabase functions deploy send-test-push
supabase functions deploy dispatch-prayer-push
supabase functions deploy cleanup-subscriptions
```

### Step 4: Import ACJU Prayer Data into Supabase

Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in local `.env` (gitignored) and run:

```bash
npm run supabase:sync-prayers
```

Verify in Supabase Table Editor that `public.prayer_times` is populated for all 29 districts (`Colombo`, `Gampola`, `Nallur`, `Kandy`, `Galle`, etc.).

### Step 5: Deploy Frontend on Vercel

1. Push the repository to GitHub (`.env*` is ignored by `.gitignore`).
2. Import the repository in **Vercel** (`Build Command: npm run build`, `Output Directory: dist`).
3. Add **only** these client-safe environment variables in **Vercel Project Settings → Environment Variables**:
   - `VITE_SUPABASE_URL` = `https://<YOUR_PROJECT_REF>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `<YOUR_SUPABASE_ANON_KEY>`
4. Deploy. `vercel.json` ensures `/sw.js`, `/manifest.webmanifest`, `/pwa-*.png`, and `/assets/*` are served directly without falling back to `index.html`.

### Step 6: Verify Cron & Scheduler Logs

Wait 1–2 minutes after enabling a subscription, then inspect `public.scheduler_logs` in Supabase Dashboard or run the diagnostic test:

```bash
curl -X POST "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/dispatch-prayer-push" \
  -H "Authorization: Bearer <YOUR_RANDOM_CRON_SECRET>"
```

---

## 6. Installing on Physical iPhone (iOS 16.4+)

1. Open the deployed **Vercel HTTPS URL** in **Safari** on your physical iPhone (iOS 16.4 or newer).
2. Tap **Share → Add to Home Screen → Add**.
3. Close Safari and open **My Adhan** from the iPhone Home Screen icon *(iOS Web Push only exists in Home Screen standalone mode)*.
4. Open **Audio & Alerts → Background Push & Prayer Reminders** and tap **Enable Prayer Notifications**.
5. Accept the iOS Notification prompt triggered directly by your tap.
6. Confirm status reads **Active (Background Web Push)** and tap **Send Test Notification**.

---

## 7. iOS System Sound vs In-App Adhan Audio

- **Closed / Locked iPhone (`push` event)**: Apple iOS forbids Service Workers from playing background MP3 audio and strictly requires `registration.showNotification(...)` on every incoming push. Prayer alerts arrive on Lock Screen & Notification Center with the **iOS system notification sound**.
- **Open App (Manual / Foreground)**: Full Makkah Adhan `.mp3`, harmonic chime, and custom uploaded audio play whenever the app is open on screen.

---

## 8. Physical iPhone 13-Point Verification Matrix

*(To be executed on a physical iPhone after Supabase + Vercel deployment — do not mark passed before live hardware testing.)*

| # | Verification Item | Expected Outcome | Status |
| --- | --- | --- | --- |
| 1 | Installed PWA on physical iPhone (iOS 16.4+) over Vercel HTTPS | Opens cleanly in standalone mode from Home Screen icon | Pending physical iPhone test |
| 2 | Service Worker registration & ping active | **Push Diagnostics** shows active `my-adhan-push-v1` SW | Pending physical iPhone test |
| 3 | User-gesture notification permission | System prompt appears only when tapping **Enable Prayer Notifications** | Pending physical iPhone test |
| 4 | Web Push subscription created & stored in Supabase | Row persisted in `devices`, `push_subscriptions` (`active`), `notification_preferences` | Pending physical iPhone test |
| 5 | ACJU district prayer times accurate (`Asia/Colombo`) | Selected district timings in `prayer_times` match official ACJU 2026 schedule | Pending physical iPhone test |
| 6 | Scheduled / test push when PWA open in foreground | Banner appears + Diagnostics logs `PUSH_RECEIVED` | Pending physical iPhone test |
| 7 | Scheduled / test push when PWA is backgrounded | Banner arrives cleanly in Notification Center | Pending physical iPhone test |
| 8 | Scheduled / test push when PWA is swiped/closed completely | Notification still delivered via `web.push.apple.com` + `pg_cron` | Pending physical iPhone test |
| 9 | Scheduled / test push wakes iPhone Lock Screen | Locked iPhone lights up with prayer banner & system chime | Pending physical iPhone test |
| 10 | Notification tap opens My Adhan cleanly | Tapping notification focuses/opens app & records `last_click_verified_at` | Pending physical iPhone test |
| 11 | No duplicate notifications | Repeated scheduler runs skip sent `idempotency_key` rows | Pending physical iPhone test |
| 12 | Invalid / `410 Gone` cleanup & renewal | Expired subscription flagged & `pushsubscriptionchange` / re-enable restores active push | Pending physical iPhone test |
| 13 | Disable & Re-enable flow | Unsubscribes browser, marks backend `disabled`, and re-enables cleanly | Pending physical iPhone test |
