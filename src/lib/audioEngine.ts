import type { AdhanAudioTrack } from '../shared/types';

const IDB_NAME = 'my_adhan_audio_db';
const IDB_STORE = 'uploaded_audio';

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

let activeAudioEl: HTMLAudioElement | null = null;
let activeObjectUrl: string | null = null;
let activeAudioCtx: AudioContext | null = null;

export function stopAdhanPlayback(): void {
  if (activeAudioEl) {
    activeAudioEl.pause();
    activeAudioEl.currentTime = 0;
    activeAudioEl = null;
  }
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
  if (activeAudioCtx) {
    activeAudioCtx.close().catch(() => undefined);
    activeAudioCtx = null;
  }
}

/**
 * Plays a gentle synthesized harmonic chime via Web Audio API (no copyrighted files).
 */
export async function playSynthesizedChime(volume: number, shortOnly: boolean): Promise<void> {
  stopAdhanPlayback();
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('Web Audio API is not supported in this browser.');
  }
  const ctx = new AudioCtx();
  activeAudioCtx = ctx;
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

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
  onEnded?: () => void;
}): Promise<void> {
  const { track, volume, playbackMode, onEnded } = params;
  stopAdhanPlayback();

  if (playbackMode === 'short_chime' || track.storagePath.startsWith('builtin://')) {
    await playSynthesizedChime(volume, playbackMode === 'short_chime');
    const ms = playbackMode === 'short_chime' ? 2200 : 3200;
    window.setTimeout(() => {
      onEnded?.();
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

  const audio = new Audio(srcUrl);
  audio.volume = Math.max(0, Math.min(1, volume));
  activeAudioEl = audio;
  audio.addEventListener('ended', () => {
    stopAdhanPlayback();
    onEnded?.();
  });
  await audio.play();
}
