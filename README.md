# My Adhan — Sri Lanka Prayer Times PWA

**My Adhan** is a standalone, offline-ready Progressive Web App (PWA) for Sri Lanka built with React, TypeScript, Vite, and Tailwind CSS. It runs 100% client-side with **no database or backend required** and embeds the complete official **2026 All-Ceylon Jamiyyathul Ulama (ACJU)** prayer timetable across all 13 geographical groups (`4,745` daily records).

---

## Key Features

- **Complete Embedded Official 2026 ACJU Timetable:** All 5 daily prayers (`Fajr`, `Dhuhr`, `Asr`, `Maghrib`, `Isha`) for all 13 Sri Lankan ACJU geographical groups are bundled directly in the app (`src/shared/acju2026Timetable.ts`).
- **Annual Repeat Policy (2027+):** Future years automatically match `(month, day)` against the 2026 ACJU reference dataset and clearly label entries as annual repeats.
- **Safe Leap-Year February 29 Policy:** Because 2026 is not a leap year, 29 February is never silently invented or copied from 28 February; reminders pause on that date.
- **13 ACJU Groups & GPS Detection:** On-demand GPS boundary detection plus manual search/picker for all Sri Lankan districts and overrides (`Gampola` → Group 7, `Nallur` → Group 2, `Mullaitivu` → Group 3, `Padiyatalawa` / `Dehiaththekandiya` → Group 10).
- **Adhan Audio & Reminders:** Includes the default Adhan alarm tone (`/assets/aistudio/Adhan_a222d363.mp3`), a synthesized harmonic chime, and private IndexedDB local audio file upload. Fixed to `Asia/Colombo` (`UTC+05:30`).

---

## Local Development

```bash
npm install
npm run dev      # Starts Vite on http://localhost:3000
npm test         # Runs Vitest unit tests
npm run lint     # Runs TypeScript type-checking
npm run build    # Builds static production bundle to dist/
```

---

## Deploying to Vercel (Zero Configuration)

1. Push this repository to GitHub, GitLab, or Bitbucket.
2. Import the repository in **Vercel** (`vercel.com/new`).
3. Vercel automatically uses `vercel.json` (`vite` framework preset, `npm run build`, output directory `dist`, no environment variables needed).
4. Click **Deploy** — you immediately get an HTTPS URL ready for iPhone and Android installation.

---

## Installing & Testing on iPhone (Safari over HTTPS)

1. Open your Vercel HTTPS URL in **Safari** on iPhone.
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Open **My Adhan** from your Home Screen icon (required on iOS 16.4+ to unlock Web Notifications).
4. Note: iOS does not allow full Adhan audio playback when the PWA is closed or backgrounded; tap **Test Adhan / Chime** inside the app to verify audio playback and ensure your iPhone silent switch is off.
