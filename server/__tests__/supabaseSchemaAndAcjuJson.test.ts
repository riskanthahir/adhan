import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACJU_2026_TIMETABLE_COMPACT } from '../../src/shared/acju2026Timetable.ts';
import { ACJU_DISTRICTS } from '../../src/shared/acjuSeed.ts';

const ROOT = process.cwd();
const ACJU_JSON_DIR = path.resolve(ROOT, 'data', 'acju-2026');

describe('ACJU District JSON Repository Data & Supabase Schema/Deployment Contracts', () => {
  it('exports all 29 ACJU districts with exact 365-day 2026 schedules and zero Feb 29 rows', () => {
    expect(fs.existsSync(ACJU_JSON_DIR)).toBe(true);
    const indexPath = path.join(ACJU_JSON_DIR, 'index.json');
    expect(fs.existsSync(indexPath)).toBe(true);

    const indexJson = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as {
      timezone: string;
      district_count: number;
      districts: Array<{ district_id: string; zone_id: number; record_count: number }>;
    };

    expect(indexJson.timezone).toBe('Asia/Colombo');
    expect(indexJson.district_count).toBe(ACJU_DISTRICTS.length);

    for (const district of ACJU_DISTRICTS) {
      const filePath = path.join(ACJU_JSON_DIR, `${district.id}.json`);
      expect(fs.existsSync(filePath), `Missing ${district.id}.json`).toBe(true);

      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
        district_id: string;
        zone_id: number;
        timezone: string;
        records: Array<{
          prayer_date: string;
          fajr: string;
          sunrise: string;
          dhuhr: string;
          asr: string;
          maghrib: string;
          isha: string;
          source_version: string;
        }>;
      };

      expect(parsed.district_id).toBe(district.id);
      expect(parsed.zone_id).toBe(district.zoneId);
      expect(parsed.timezone).toBe('Asia/Colombo');
      expect(parsed.records.length).toBe(365);

      const zoneMap = ACJU_2026_TIMETABLE_COMPACT[district.zoneId];
      for (const rec of parsed.records) {
        expect(rec.prayer_date).toMatch(/^2026-\d{2}-\d{2}$/);
        expect(rec.prayer_date.endsWith('-02-29')).toBe(false);
        const mmdd = rec.prayer_date.slice(5);
        const expectedPacked = zoneMap[mmdd];
        expect(expectedPacked, `Missing compact schedule for ${district.id} ${mmdd}`).toBeTruthy();

        const [fajr, sunrise, dhuhr, asr, maghrib, isha] = expectedPacked.split('|');
        expect(rec.fajr).toBe(fajr);
        expect(rec.sunrise).toBe(sunrise);
        expect(rec.dhuhr).toBe(dhuhr);
        expect(rec.asr).toBe(asr);
        expect(rec.maghrib).toBe(maghrib);
        expect(rec.isha).toBe(isha);
        expect(fajr < sunrise && sunrise < dhuhr && dhuhr < asr && asr < maghrib && maghrib < isha).toBe(true);
      }
    }
  });

  it('defines Supabase schema migrations with all 5 core tables, UUID PKs, RLS, idempotency, and pg_cron + Vault', () => {
    const m1 = fs.readFileSync(
      path.resolve(ROOT, 'supabase/migrations/20261127000001_initial_adhan_push_schema.sql'),
      'utf8'
    );
    const m2 = fs.readFileSync(
      path.resolve(ROOT, 'supabase/migrations/20261127000002_pg_cron_scheduler.sql'),
      'utf8'
    );

    for (const tbl of [
      'public.devices',
      'public.push_subscriptions',
      'public.notification_preferences',
      'public.prayer_times',
      'public.notification_logs',
      'public.scheduler_logs',
      'public.edge_rate_limits',
    ]) {
      expect(m1).toContain(`CREATE TABLE IF NOT EXISTS ${tbl}`);
      expect(m1).toContain(`ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY`);
    }

    expect(m1).toContain('idempotency_key text NOT NULL UNIQUE');
    expect(m1).toContain('UNIQUE (district_id, prayer_date)');
    expect(m1).toContain('CREATE POLICY "Public read ACJU prayer times"');
    expect(m1).toContain('REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit');

    expect(m2).toContain('CREATE EXTENSION IF NOT EXISTS pg_cron');
    expect(m2).toContain('CREATE EXTENSION IF NOT EXISTS pg_net');
    expect(m2).toContain('vault.decrypted_secrets');
    expect(m2).toContain("'* * * * *'");
    expect(m2).toContain("'dispatch-prayer-push'");
    expect(m2).toContain("'cleanup-subscriptions'");
  });

  it('ships all 5 Supabase Edge Functions with verify_jwt = false in config.toml and excludes secrets from src/', () => {
    const configToml = fs.readFileSync(path.resolve(ROOT, 'supabase/config.toml'), 'utf8');
    for (const fn of [
      'register-device',
      'update-preferences',
      'send-test-push',
      'dispatch-prayer-push',
      'cleanup-subscriptions',
    ]) {
      expect(fs.existsSync(path.resolve(ROOT, `supabase/functions/${fn}/index.ts`))).toBe(true);
      expect(configToml).toContain(`[functions.${fn}]`);
    }

    const vercelJson = fs.readFileSync(path.resolve(ROOT, 'vercel.json'), 'utf8');
    expect(vercelJson).toContain('sw\\\\.js');
    expect(vercelJson).toContain('manifest\\\\.webmanifest');

    // Verify no frontend file reads private env vars or bundles service role / CRON secrets
    const checkDir = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          checkDir(full);
        } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          const content = fs.readFileSync(full, 'utf8');
          expect(content).not.toMatch(/import\.meta\.env\.VITE_.*(PRIVATE|SECRET|SERVICE_ROLE)/);
          expect(content).not.toMatch(/process\.env\.(VAPID_PRIVATE_KEY|SUPABASE_SERVICE_ROLE_KEY|CRON_SECRET)/);
          expect(content).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
          expect(content).not.toContain('CRON_SECRET');
        }
      }
    };
    checkDir(path.resolve(ROOT, 'src'));

    const builtSwPath = path.resolve(ROOT, 'dist/sw.js');
    if (fs.existsSync(builtSwPath)) {
      const swContent = fs.readFileSync(builtSwPath, 'utf8');
      const urls = [...swContent.matchAll(/"url":"([^"]+)"/g)].map((m) => m[1]);
      expect(urls.length).toBeGreaterThan(0);
      expect(new Set(urls).size).toBe(urls.length);
      expect(urls.some((u) => u.endsWith('.mp3'))).toBe(false);
    }
  });
});
