import type { AdhanAudioTrack } from '../shared/types';

const IDB_NAME = 'my_adhan_audio_db';
const IDB_STORE = 'uploaded_audio';

// 1-sample silent WAV used to unlock HTMLAudioElement playback inside a user gesture on iOS Safari / Chrome
const SILENT_WAV_DATA_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

export interface StoredLocalAudio {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  blob: Blob;
  durationSeconds: number;
  createdAt: string;
}

function openAudioDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocalAudioFile(file: File): Promise<AdhanAudioTrack> {
  const id = `local-${Date.now()}`;
  const durationSeconds = await probeAudioDuration(file);
  const record: StoredLocalAudio = {
    id,
    title: file.name.replace(/\.[^.]+$/, ''),
    fileName: file.name,
    mimeType: file.type || 'audio/mpeg',
    blob: file,
    durationSeconds,
    createdAt: new Date().toISOString(),
  };

  const db = await openAudioDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return {
    id,
    title: record.title,
    reciter: 'User Local File',
    licenseType: 'User-provided local audio',
    licenseUrl: null,
    storagePath: `indexeddb://${id}`,
    durationSeconds,
    isShortChime: false,
    isLocalUpload: true,
  };
}

export async function listLocalAudioTracks(): Promise<AdhanAudioTrack[]> {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const db = await openAudioDb();
    const records = await new Promise<StoredLocalAudio[]>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => resolve(req.result as StoredLocalAudio[]);
      req.onerror = () => reject(req.error);
    });
    return records.map((r) => ({
      id: r.id,
      title: r.title,
      reciter: 'User Local File',
      licenseType: 'User-provided local audio',
      licenseUrl: null,
      storagePath: `indexeddb://${r.id}`,
      durationSeconds: r.durationSeconds,
      isShortChime: false,
      isLocalUpload: true,
    }));
  } catch {
    return [];
  }
}

export async function deleteLocalAudioTrack(id: string): Promise<void> {
  const db = await openAudioDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getLocalAudioBlob(id: string): Promise<Blob | null> {
  const db = await openAudioDb();
  const record = await new Promise<StoredLocalAudio | undefined>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(id);
    req.onsuccess = () => resolve(req.result as StoredLocalAudio | undefined);
    req.onerror = () => reject(req.error);
  });
  return record?.blob ?? null;
}

function probeAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    const cleanup = () => URL.revokeObjectURL(url);
    audio.addEventListener('loadedmetadata', () => {
      const dur = Number.isFinite(audio.duration) ? Math.round(audio.duration) : 0;
      cleanup();
      resolve(dur);
    });
    audio.addEventListener('error', () => {
      cleanup();
      resolve(0);
    });
  });
}

let sharedAudioEl: HTMLAudioElement | null = null;
let activeObjectUrl: string | null = null;
let sharedAudioCtx: AudioContext | null = null;
let chimeTimeoutId: number | null = null;
let isAudioPlaying = false;
let sessionUnlocked = false;
let activeOnEnded: (() => void) | undefined;

function getOrCreateAudioElement(): HTMLAudioElement {
  if (!sharedAudioEl) {
    sharedAudioEl = new Audio();
    sharedAudioEl.preload = 'auto';
  }
  return sharedAudioEl;
}

function getOrCreateAudioContext(): AudioContext | null {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new AudioCtx();
  }
  return sharedAudioCtx;
}

/**
 * Unlocks Web Audio and HTMLAudioElement on the first user gesture so scheduled
 * prayer-time Adhan playback succeeds on iOS Safari and mobile Chrome while active.
 */
export async function unlockAudioForSession(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (sessionUnlocked) return true;

  let unlocked = false;

  try {
    const ctx = getOrCreateAudioContext();
    if (ctx) {
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      unlocked = true;
    }
  } catch {
    // Continue to HTMLAudioElement unlock
  }

  try {
    if (!isAudioPlaying) {
      const el = getOrCreateAudioElement();
      el.muted = true;
      el.src = SILENT_WAV_DATA_URI;
      await el.play();
      el.pause();
      el.currentTime = 0;
      el.muted = false;
      unlocked = true;
    }
  } catch {
    // Will retry on next user interaction
  }

  if (unlocked) {
    sessionUnlocked = true;
  }
  return unlocked;
}

export function isAudioSessionUnlocked(): boolean {
  return sessionUnlocked;
}

function clearMediaSession(): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.playbackState = 'none';
    navigator.mediaSession.setActionHandler('pause', null);
    navigator.mediaSession.setActionHandler('stop', null);
  } catch {
    // Ignore unsupported Media Session calls
  }
}

export function stopAdhanPlayback(): void {
  isAudioPlaying = false;
  activeOnEnded = undefined;

  if (chimeTimeoutId !== null) {
    window.clearTimeout(chimeTimeoutId);
    chimeTimeoutId = null;
  }
  if (sharedAudioEl) {
    sharedAudioEl.pause();
    sharedAudioEl.currentTime = 0;
    sharedAudioEl.onended = null;
  }
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
  clearMediaSession();
}

/**
 * Plays a gentle synthesized harmonic chime via Web Audio API.
 */
export async function playSynthesizedChime(volume: number, shortOnly: boolean): Promise<void> {
  stopAdhanPlayback();
  const ctx = getOrCreateAudioContext();
  if (!ctx) {
    throw new Error('Web Audio API is not supported in this browser.');
  }
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  isAudioPlaying = true;
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.setValueAtTime(Math.max(0.01, Math.min(1, volume)) * 0.35, now);
  master.connect(ctx.destination);

  const notes = shortOnly ? [523.25, 659.25, 783.99] : [440, 523.25, 659.25, 783.99, 659.25];
  notes.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const noteGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + idx * 0.42);
    noteGain.gain.setValueAtTime(0.001, now + idx * 0.42);
    noteGain.gain.exponentialRampToValueAtTime(1, now + idx * 0.42 + 0.06);
    noteGain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.42 + 1.1);
    osc.connect(noteGain);
    noteGain.connect(master);
    osc.start(now + idx * 0.42);
    osc.stop(now + idx * 0.42 + 1.15);
  });
}

export async function playAdhanTrack(params: {
  track: AdhanAudioTrack;
  volume: number;
  playbackMode: 'full_adhan' | 'short_chime';
  mediaTitle?: string;
  mediaArtist?: string;
  onEnded?: () => void;
}): Promise<void> {
  const { track, volume, playbackMode, mediaTitle, mediaArtist, onEnded } = params;
  stopAdhanPlayback();
  activeOnEnded = onEnded;

  if (playbackMode === 'short_chime' || track.storagePath.startsWith('builtin://')) {
    await playSynthesizedChime(volume, playbackMode === 'short_chime');
    const ms = playbackMode === 'short_chime' ? 2200 : 3200;
    chimeTimeoutId = window.setTimeout(() => {
      isAudioPlaying = false;
      const cb = activeOnEnded;
      activeOnEnded = undefined;
      cb?.();
    }, ms);
    return;
  }

  let srcUrl = track.storagePath;
  if (track.storagePath.startsWith('indexeddb://')) {
    const id = track.storagePath.replace('indexeddb://', '');
    const blob = await getLocalAudioBlob(id);
    if (!blob) {
      throw new Error('Uploaded audio file was not found in local device storage.');
    }
    activeObjectUrl = URL.createObjectURL(blob);
    srcUrl = activeObjectUrl;
  }

  const audio = getOrCreateAudioElement();
  audio.muted = false;
  audio.volume = Math.max(0, Math.min(1, volume));
  audio.src = srcUrl;
  audio.currentTime = 0;

  audio.onended = () => {
    const cb = activeOnEnded;
    stopAdhanPlayback();
    cb?.();
  };

  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: mediaTitle ?? track.title,
        artist: mediaArtist ?? 'My Adhan · ACJU Sri Lanka',
        artwork: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      });
      navigator.mediaSession.playbackState = 'playing';
      navigator.mediaSession.setActionHandler('pause', () => {
        const cb = activeOnEnded;
        stopAdhanPlayback();
        cb?.();
      });
      navigator.mediaSession.setActionHandler('stop', () => {
        const cb = activeOnEnded;
        stopAdhanPlayback();
        cb?.();
      });
    } catch {
      // Ignore Media Session errors on unsupported browsers
    }
  }

  isAudioPlaying = true;
  try {
    await audio.play();
    sessionUnlocked = true;
  } catch (err) {
    isAudioPlaying = false;
    activeOnEnded = undefined;
    clearMediaSession();
    throw err;
  }
}
