import { generateVAPIDKeys, setVapidDetails } from 'web-push';
import { getConfigValue, setConfigValue } from './db.ts';

export interface VapidRuntimeConfig {
  publicKey: string;
  subject: string;
  configuredViaEnv: boolean;
}

let cachedPublicKey = '';
let cachedPrivateKey = '';
let cachedSubject = '';
let configuredViaEnv = false;

const DEFAULT_VAPID_SUBJECT = 'mailto:notifications@myadhan.lk';

export function ensureVapidConfigured(): VapidRuntimeConfig {
  if (cachedPublicKey && cachedPrivateKey) {
    return {
      publicKey: cachedPublicKey,
      subject: cachedSubject,
      configuredViaEnv,
    };
  }

  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
  const envSubject = process.env.VAPID_SUBJECT?.trim() || DEFAULT_VAPID_SUBJECT;

  if (envPub && envPriv) {
    cachedPublicKey = envPub;
    cachedPrivateKey = envPriv;
    cachedSubject = envSubject;
    configuredViaEnv = true;
  } else {
    let dbPub = getConfigValue('vapid_public_key');
    let dbPriv = getConfigValue('vapid_private_key');
    if (!dbPub || !dbPriv) {
      const keys = generateVAPIDKeys();
      dbPub = keys.publicKey;
      dbPriv = keys.privateKey;
      setConfigValue('vapid_public_key', dbPub);
      setConfigValue('vapid_private_key', dbPriv);
    }
    cachedPublicKey = dbPub;
    cachedPrivateKey = dbPriv;
    cachedSubject = envSubject;
    configuredViaEnv = false;
  }

  setVapidDetails(cachedSubject, cachedPublicKey, cachedPrivateKey);

  return {
    publicKey: cachedPublicKey,
    subject: cachedSubject,
    configuredViaEnv,
  };
}

export function getPublicVapidConfig(): VapidRuntimeConfig {
  return ensureVapidConfigured();
}

export function resetVapidCacheForTesting(): void {
  cachedPublicKey = '';
  cachedPrivateKey = '';
  cachedSubject = '';
  configuredViaEnv = false;
}
