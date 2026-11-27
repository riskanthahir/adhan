import { createECDH, timingSafeEqual } from 'node:crypto';
import { setVapidDetails } from 'web-push';

export type VapidValidationStatus =
  | 'configured'
  | 'missing_keys'
  | 'invalid_subject'
  | 'invalid_format'
  | 'mismatched_keys';

export interface VapidRuntimeConfig {
  configured: boolean;
  status: VapidValidationStatus;
  publicKey: string | null;
  subject: string | null;
  configuredViaEnv: boolean;
  errorMessage: string | null;
  setupInstructions: string[];
}

export const VAPID_SETUP_INSTRUCTIONS: string[] = [
  '1. Generate a one-time VAPID key pair using the web-push CLI or script: npm run vapid:generate (or npx web-push generate-vapid-keys).',
  '2. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT (e.g. mailto:notifications@yourdomain.com or https://yourdomain.com) in your backend .env file or server environment secrets.',
  '3. Never commit .env or expose VAPID_PRIVATE_KEY in frontend code, API responses, browser logs, or GitHub.',
  '4. Restart the backend server so Web Push scheduling and device registration activate.',
];

let lastValidatedTuple = '';
let lastConfigResult: VapidRuntimeConfig | null = null;

function isValidBase64Url(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function isValidVapidSubject(subject: string): boolean {
  if (!subject) return false;
  if (subject.startsWith('mailto:')) {
    const emailPart = subject.slice('mailto:'.length).trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailPart);
  }
  if (subject.startsWith('https://')) {
    try {
      const u = new URL(subject);
      return u.protocol === 'https:' && Boolean(u.hostname);
    } catch {
      return false;
    }
  }
  return false;
}

export function validateVapidKeyPair(
  publicKey: string,
  privateKey: string,
  subject: string
): {
  valid: boolean;
  status: VapidValidationStatus;
  errorMessage: string | null;
} {
  if (!publicKey || !privateKey) {
    return {
      valid: false,
      status: 'missing_keys',
      errorMessage:
        'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are missing from backend environment variables.',
    };
  }

  if (!isValidVapidSubject(subject)) {
    return {
      valid: false,
      status: 'invalid_subject',
      errorMessage:
        'VAPID_SUBJECT must be configured as a valid mailto:email@domain or https://domain URL.',
    };
  }

  const normalizedPub = publicKey.replace(/=+$/, '');
  const normalizedPriv = privateKey.replace(/=+$/, '');

  if (!isValidBase64Url(normalizedPub) || !isValidBase64Url(normalizedPriv)) {
    return {
      valid: false,
      status: 'invalid_format',
      errorMessage:
        'VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY is not valid URL-safe Base64.',
    };
  }

  const pubBuf = Buffer.from(normalizedPub, 'base64url');
  const privBuf = Buffer.from(normalizedPriv, 'base64url');

  if (pubBuf.length !== 65 || pubBuf[0] !== 0x04 || privBuf.length !== 32) {
    return {
      valid: false,
      status: 'invalid_format',
      errorMessage:
        'VAPID keys must be an uncompressed 65-byte P-256 public key and a 32-byte P-256 private key.',
    };
  }

  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(privBuf);
    const derivedPub = ecdh.getPublicKey();
    if (derivedPub.length !== pubBuf.length || !timingSafeEqual(derivedPub, pubBuf)) {
      return {
        valid: false,
        status: 'mismatched_keys',
        errorMessage:
          'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY do not belong to the same EC P-256 key pair.',
      };
    }
  } catch {
    return {
      valid: false,
      status: 'invalid_format',
      errorMessage: 'VAPID_PRIVATE_KEY is outside the valid EC P-256 scalar range.',
    };
  }

  return {
    valid: true,
    status: 'configured',
    errorMessage: null,
  };
}

export function ensureVapidConfigured(): VapidRuntimeConfig {
  const envPub = process.env.VAPID_PUBLIC_KEY?.trim() ?? '';
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim() ?? '';
  const envSubject = process.env.VAPID_SUBJECT?.trim() ?? '';

  const tupleKey = `${envPub}|${envPriv.length > 0 ? 'set' : 'unset'}:${envPriv.slice(0, 4)}:${envPriv.length}|${envSubject}`;
  if (lastConfigResult && lastValidatedTuple === tupleKey && lastConfigResult.configured) {
    return lastConfigResult;
  }

  const check = validateVapidKeyPair(envPub, envPriv, envSubject);

  if (!check.valid) {
    const result: VapidRuntimeConfig = {
      configured: false,
      status: check.status,
      publicKey: null,
      subject: envSubject || null,
      configuredViaEnv: false,
      errorMessage: check.errorMessage,
      setupInstructions: [...VAPID_SETUP_INSTRUCTIONS],
    };
    lastValidatedTuple = tupleKey;
    lastConfigResult = result;
    return result;
  }

  try {
    setVapidDetails(envSubject, envPub, envPriv);
  } catch (err) {
    const result: VapidRuntimeConfig = {
      configured: false,
      status: 'invalid_format',
      publicKey: null,
      subject: envSubject,
      configuredViaEnv: false,
      errorMessage: `VAPID configuration rejected by web-push: ${(err as Error).message}`,
      setupInstructions: [...VAPID_SETUP_INSTRUCTIONS],
    };
    lastValidatedTuple = tupleKey;
    lastConfigResult = result;
    return result;
  }

  const result: VapidRuntimeConfig = {
    configured: true,
    status: 'configured',
    publicKey: envPub,
    subject: envSubject,
    configuredViaEnv: true,
    errorMessage: null,
    setupInstructions: [],
  };
  lastValidatedTuple = tupleKey;
  lastConfigResult = result;
  return result;
}

export function getPublicVapidConfig(): VapidRuntimeConfig {
  return ensureVapidConfigured();
}

export function resetVapidCacheForTesting(): void {
  lastValidatedTuple = '';
  lastConfigResult = null;
}
