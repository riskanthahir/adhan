#!/usr/bin/env node
/**
 * One-time VAPID key pair generator using the official `web-push` package.
 *
 * - Reads `.env` if present.
 * - If VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY already exist, refuses to overwrite
 *   them (so existing user push subscriptions are never invalidated), and validates
 *   that the existing public & private keys match.
 * - If keys do not exist yet, generates a fresh EC P-256 VAPID pair via `web-push`
 *   and saves VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT into `.env`
 *   (gitignored via `.gitignore`).
 * - Never prints VAPID_PRIVATE_KEY to stdout.
 */
import { createECDH, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { generateVAPIDKeys } from 'web-push';

const ENV_PATH = path.resolve(process.cwd(), '.env');
const EXAMPLE_PATH = path.resolve(process.cwd(), '.env.example');
const DEFAULT_SUBJECT = 'mailto:notifications@myadhan.lk';

function parseEnvFile(content) {
  const map = new Map();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    map.set(key, val);
  }
  return map;
}

function keysMatch(pubKey, privKey) {
  try {
    const pubBuf = Buffer.from(pubKey.replace(/=+$/, ''), 'base64url');
    const privBuf = Buffer.from(privKey.replace(/=+$/, ''), 'base64url');
    if (pubBuf.length !== 65 || pubBuf[0] !== 0x04 || privBuf.length !== 32) {
      return false;
    }
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(privBuf);
    const derived = ecdh.getPublicKey();
    return derived.length === pubBuf.length && timingSafeEqual(derived, pubBuf);
  } catch {
    return false;
  }
}

function upsertEnvKeys(existingContent, updates) {
  const lines = existingContent ? existingContent.split(/\r?\n/) : [];
  const handled = new Set();
  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) return line;
    const k = trimmed.slice(0, eqIdx).trim();
    if (Object.prototype.hasOwnProperty.call(updates, k)) {
      handled.add(k);
      return `${k}=${updates[k]}`;
    }
    return line;
  });

  for (const [k, v] of Object.entries(updates)) {
    if (!handled.has(k)) {
      out.push(`${k}=${v}`);
    }
  }

  return out.join('\n').replace(/\n*$/, '\n');
}

const force = process.argv.includes('--force');

let baseContent = '';
if (fs.existsSync(ENV_PATH)) {
  baseContent = fs.readFileSync(ENV_PATH, 'utf8');
} else if (fs.existsSync(EXAMPLE_PATH)) {
  baseContent = fs.readFileSync(EXAMPLE_PATH, 'utf8');
}

const parsed = parseEnvFile(baseContent);
const existingPub = parsed.get('VAPID_PUBLIC_KEY') || process.env.VAPID_PUBLIC_KEY || '';
const existingPriv = parsed.get('VAPID_PRIVATE_KEY') || process.env.VAPID_PRIVATE_KEY || '';
const existingSubject =
  parsed.get('VAPID_SUBJECT') || process.env.VAPID_SUBJECT || DEFAULT_SUBJECT;

if (existingPub && existingPriv && !force) {
  const matches = keysMatch(existingPub, existingPriv);
  if (!matches) {
    console.error(
      '[My Adhan] Existing VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY do NOT match! Pass --force to generate a fresh key pair or fix .env manually.'
    );
    process.exit(1);
  }
  console.log('[My Adhan] VAPID keys already exist and match — keeping existing keys.');
  console.log(`VAPID_PUBLIC_KEY=${existingPub}`);
  console.log(`VAPID_SUBJECT=${existingSubject}`);
  console.log('VAPID_PRIVATE_KEY=[already configured in .env, hidden for security]');
  process.exit(0);
}

const generated = generateVAPIDKeys();
if (!keysMatch(generated.publicKey, generated.privateKey)) {
  console.error('[My Adhan] Generated VAPID keys failed self-verification check.');
  process.exit(1);
}

const nextEnvContent = upsertEnvKeys(baseContent, {
  VAPID_PUBLIC_KEY: generated.publicKey,
  VAPID_PRIVATE_KEY: generated.privateKey,
  VAPID_SUBJECT: existingSubject,
});

fs.writeFileSync(ENV_PATH, nextEnvContent, { encoding: 'utf8', mode: 0o600 });
try {
  fs.chmodSync(ENV_PATH, 0o600);
} catch {
  // Ignore chmod errors on platforms where not supported
}

console.log('[My Adhan] Generated new VAPID key pair using web-push and saved to .env (mode 0600, gitignored).');
console.log(`VAPID_PUBLIC_KEY=${generated.publicKey}`);
console.log(`VAPID_SUBJECT=${existingSubject}`);
console.log('VAPID_PRIVATE_KEY=[written securely to .env — never expose or commit]');
