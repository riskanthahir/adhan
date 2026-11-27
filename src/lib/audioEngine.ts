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
let activeBufferSource: AudioBufferSourceNode | null = null;
let activeGainNode: GainNode | null = null;
let chimeTimeoutId: number | null = null;
let isAudioPlaying = false;
let sessionUnlocked = false;
let activeOnEnded: (() => void) | undefined;
const decodedBufferCache = new Map<string, AudioBuffer>();
const pendingDecodeMap = new Map<string, Promise<AudioBuffer | null>>();

function setIOSAudioSessionPlayback(): void {
  if (typeof navigator === 'undefined') return;
  try {
    const navWithSession = navigator as Navigator & {
      audioSession?: { type: string };
    };
    if (navWithSession.audioSession && navWithSession.audioSession.type !== 'playback') {
      navWithSession.audioSession.type = 'playback';
    }
  } catch {
    // Ignore unsupported audioSession API
  }
}

function getOrCreateAudioElement(): HTMLAudioElement {
  if (!sharedAudioEl) {
    sharedAudioEl = new Audio();
    sharedAudioEl.preload = 'auto';
    sharedAudioEl.setAttribute('playsinline', '');
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

async function decodeTrackToBuffer(track: AdhanAudioTrack): Promise<AudioBuffer | null> {
  if (track.storagePath.startsWith('builtin://')) return null;
  const cached = decodedBufferCache.get(track.id);
  if (cached) return cached;

  const existing = pendingDecodeMap.get(track.id);
  if (existing) return existing;

  const task = (async (): Promise<AudioBuffer | null> => {
    try {
      const ctx = getOrCreateAudioContext();
      if (!ctx) return null;

      let arrayBuffer: ArrayBuffer;
      if (track.storagePath.startsWith('indexeddb://')) {
        const id = track.storagePath.replace('indexeddb://', '');
        const blob = await getLocalAudioBlob(id);
        if (!blob) return null;
        arrayBuffer = await blob.arrayBuffer();
      } else {
        const res = await fetch(track.storagePath);
        if (!res.ok) return null;
        arrayBuffer = await res.arrayBuffer();
      }

      // Copy buffer for WebKit compatibility
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      decodedBufferCache.set(track.id, decoded);
      return decoded;
    } catch {
      return null;
    } finally {
      pendingDecodeMap.delete(track.id);
    }
  })();

  pendingDecodeMap.set(track.id, task);
  return task;
}

export function preloadAdhanTrack(track: AdhanAudioTrack): void {
  if (typeof window === 'undefined') return;
  void decodeTrackToBuffer(track);
}

/**
 * Unlocks Web Audio and HTMLAudioElement synchronously inside a user gesture so
 * scheduled prayer-time Adhan playback works on iOS Safari / Home Screen PWAs
 * without blocking or hanging other permission prompts.
 */
export async function unlockAudioForSession(trackToPreload?: AdhanAudioTrack): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  setIOSAudioSessionPlayback();

  if (trackToPreload) {
    preloadAdhanTrack(trackToPreload);
  }

  const ctx = getOrCreateAudioContext();
  if (sessionUnlocked && ctx && ctx.state === 'running') {
    return true;
  }

  let unlocked = sessionUnlocked;
  const tasks: Promise<void>[] = [];

  try {
    if (ctx) {
      if (ctx.state !== 'running') {
        tasks.push(
          ctx
            .resume()
            .then(() => {
              unlocked = true;
            })
            .catch(() => {
              // Ignore audio context resume failure
            })
        );
      } else {
        unlocked = true;
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
    if (!isAudioPlaying && !sessionUnlocked) {
      const el = getOrCreateAudioElement();
      el.muted = true;
      el.setAttribute('playsinline', '');
      el.src = SILENT_WAV_DATA_URI;
      const playPromise = el.play();
      if (playPromise && typeof playPromise.then === 'function') {
        tasks.push(
          playPromise
            .then(() => {
              if (!isAudioPlaying) {
                el.pause();
              }
              el.muted = false;
              unlocked = true;
            })
            .catch(() => {
              el.muted = false;
            })
        );
      } else {
        el.muted = false;
        unlocked = true;
      }
    }
  } catch {
    // Will retry on next user interaction
  }

  if (tasks.length > 0) {
    await Promise.race([
      Promise.allSettled(tasks),
      new Promise<void>((resolve) => window.setTimeout(resolve, 600)),
    ]);
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
  if (activeBufferSource) {
    try {
      activeBufferSource.onended = null;
      activeBufferSource.stop();
      activeBufferSource.disconnect();
    } catch {
      // Ignore already stopped source
    }
    activeBufferSource = null;
  }
  if (activeGainNode) {
    try {
      activeGainNode.disconnect();
    } catch {
      // Ignore
    }
    activeGainNode = null;
  }
  if (sharedAudioEl) {
    try {
      sharedAudioEl.pause();
      if (sharedAudioEl.readyState > 0) {
        sharedAudioEl.currentTime = 0;
      }
      sharedAudioEl.onended = null;
    } catch {
      // Ignore HTMLAudioElement state errors
    }
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
  setIOSAudioSessionPlayback();
  const ctx = getOrCreateAudioContext();
  if (!ctx) {
    throw new Error('Web Audio API is not supported in this browser.');
  }
  if (ctx.state !== 'running') {
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

async function playViaAudioBuffer(
  track: AdhanAudioTrack,
  volume: number
): Promise<boolean> {
  try {
    setIOSAudioSessionPlayback();
    const ctx = getOrCreateAudioContext();
    if (!ctx) return false;
    if (ctx.state !== 'running') {
      await ctx.resume();
    }
    const buffer = await decodeTrackToBuffer(track);
    if (!buffer) return false;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0, Math.min(1, volume)), ctx.currentTime);
    source.connect(gain);
    gain.connect(ctx.destination);

    activeBufferSource = source;
    activeGainNode = gain;
    isAudioPlaying = true;

    source.onended = () => {
      if (activeBufferSource !== source) return;
      const cb = activeOnEnded;
      stopAdhanPlayback();
      cb?.();
    };

    source.start(0);
    sessionUnlocked = true;
    return true;
  } catch {
    return false;
  }
}

function registerMediaSession(track: AdhanAudioTrack, mediaTitle?: string, mediaArtist?: string): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
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
  setIOSAudioSessionPlayback();
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
  audio.load();

  audio.onended = () => {
    const cb = activeOnEnded;
    stopAdhanPlayback();
    cb?.();
  };

  registerMediaSession(track, mediaTitle, mediaArtist);

  isAudioPlaying = true;
  try {
    await audio.play();
    sessionUnlocked = true;
    return;
  } catch (htmlErr) {
    // On iOS Safari / Standalone PWA, swapping HTMLAudioElement.src inside a timer can be rejected;
    // try playing the decoded Adhan AudioBuffer through the unlocked Web Audio API AudioContext.
    audio.onended = null;
    const bufferPlayed = await playViaAudioBuffer(track, volume);
    if (bufferPlayed) {
      return;
    }

    // Last resort: play synthesized chime through AudioContext if audio buffer failed
    try {
      await playSynthesizedChime(volume, false);
      activeOnEnded = onEnded;
      chimeTimeoutId = window.setTimeout(() => {
        isAudioPlaying = false;
        const cb = activeOnEnded;
        activeOnEnded = undefined;
        cb?.();
      }, 3200);
      return;
    } catch {
      isAudioPlaying = false;
      activeOnEnded = undefined;
      clearMediaSession();
      throw htmlErr;
    }
  }
}
