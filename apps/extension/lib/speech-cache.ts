import type { SpeechCacheStatus } from './doubao-voices';
import { localDataChanged } from './local-data-events';

const AUDIO = 'audio';
const ENTRIES = 'entries';
const META = 'metadata';
const USAGE = 'usage';
export const AUDIO_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SWEEP_LIMIT = 32;
const SWEEP_INTERVAL_MS = 60_000;
export interface CachedAudioInfo { key: string; size: number; createdAt: number; expiresAt: number; lastUsed: number }
interface Usage { count: number; bytes: number }
const failure = (tx: IDBTransaction) => tx.error ?? new Error('语音缓存事务未完成');
const emptyUsage = (): Usage => ({ count: 0, bytes: 0 });

export class PersistentSpeechCache {
  private generation = 0;
  private writeWarning?: string;
  private nextSweepAt = 0;
  private readonly databaseName: string;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly onChange?: () => void;

  constructor(options: { databaseName?: string; maxEntries?: number; maxBytes?: number; onChange?: () => void } = {}) {
    this.databaseName = options.databaseName ?? 'lexiside-speech-cache';
    this.maxEntries = options.maxEntries ?? 100_000;
    this.maxBytes = options.maxBytes ?? 1024 ** 3;
    this.onChange = options.onChange;
  }
  getGeneration(): number { return this.generation; }
  getWarning(): string | undefined { return this.writeWarning; }

  private async withDatabase<T>(operation: (db: IDBDatabase) => Promise<T>): Promise<T> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 2);
      let blocked = false;
      request.onupgradeneeded = (event) => {
        const db = request.result;
        const tx = request.transaction!;
        if (event.oldVersion === 0) {
          db.createObjectStore(AUDIO, { keyPath: 'key' });
          db.createObjectStore(META);
        }
        const entries = db.createObjectStore(ENTRIES, { keyPath: 'key' });
        entries.createIndex('lastUsed', 'lastUsed');
        entries.createIndex('expiresAt', 'expiresAt');
        // One-time streaming v1 migration. Binary audio is left untouched. v1
        // has no creation time, so use its last recorded access as the baseline.
        if (event.oldVersion === 1) {
          const usage = emptyUsage();
          const cursorRequest = tx.objectStore(AUDIO).openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) { tx.objectStore(META).put(usage, USAGE); return; }
            const legacy = cursor.value as { key: string; audio: ArrayBuffer; lastUsed?: number };
            const createdAt = Number.isFinite(legacy.lastUsed) ? Math.min(legacy.lastUsed!, Date.now()) : Date.now();
            const size = legacy.audio.byteLength;
            entries.put({ key: legacy.key, size, createdAt, expiresAt: createdAt + AUDIO_TTL_MS, lastUsed: createdAt } satisfies CachedAudioInfo);
            usage.count++; usage.bytes += size;
            cursor.continue();
          };
        }
      };
      request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
      request.onerror = () => reject(request.error ?? new Error('无法打开语音缓存'));
      request.onblocked = () => { blocked = true; reject(new Error('语音缓存升级被占用，请关闭旧版扩展页面后重新加载。')); };
    });
    try { return await operation(db); } finally { db.close(); }
  }

  private async maybeSweep(): Promise<void> {
    const now = Date.now();
    if (now < this.nextSweepAt) return;
    this.nextSweepAt = now + SWEEP_INTERVAL_MS;
    let deleted = 0;
    try {
      await this.withDatabase((db) => new Promise<void>((resolve, reject) => {
        const tx = db.transaction([AUDIO, ENTRIES, META], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(failure(tx));
        const metadata = tx.objectStore(META);
        const usageRequest = metadata.get(USAGE);
        usageRequest.onsuccess = () => {
          const usage: Usage = usageRequest.result ?? emptyUsage();
          const request = tx.objectStore(ENTRIES).index('expiresAt').openCursor(IDBKeyRange.upperBound(now));
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor || deleted >= SWEEP_LIMIT) { if (deleted) metadata.put(usage, USAGE); return; }
            const entry = cursor.value as CachedAudioInfo;
            tx.objectStore(AUDIO).delete(entry.key); cursor.delete();
            usage.count--; usage.bytes -= entry.size; deleted++;
            if (deleted < SWEEP_LIMIT) cursor.continue(); else metadata.put(usage, USAGE);
          };
        };
      }));
      if (deleted) this.onChange?.();
    } catch (error) { this.nextSweepAt = 0; throw error; }
  }

  async get(key: string, options: { touch?: boolean; createdAt?: number } = {}): Promise<Uint8Array | null> {
    await this.maybeSweep();
    let removed = false;
    const result = await this.withDatabase((db) => new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = db.transaction([AUDIO, ENTRIES, META], 'readwrite');
      let audio: Uint8Array | null = null;
      tx.oncomplete = () => resolve(audio);
      tx.onerror = tx.onabort = () => reject(failure(tx));
      const store = tx.objectStore(ENTRIES);
      const request = store.get(key);
      request.onsuccess = () => {
        const entry = request.result as CachedAudioInfo | undefined;
        if (!entry || (options.createdAt !== undefined && entry.createdAt !== options.createdAt)) return;
        if (entry.expiresAt <= Date.now()) {
          removed = true; store.delete(key); tx.objectStore(AUDIO).delete(key);
          const usage = tx.objectStore(META).get(USAGE);
          usage.onsuccess = () => tx.objectStore(META).put({ count: (usage.result?.count ?? 1) - 1, bytes: (usage.result?.bytes ?? entry.size) - entry.size }, USAGE);
          return;
        }
        const data = tx.objectStore(AUDIO).get(key);
        data.onsuccess = () => { if (data.result) audio = new Uint8Array(data.result.audio); };
        // Touch only the small metadata record, never rewrite the audio on a hit.
        if (options.touch !== false) store.put({ ...entry, lastUsed: Date.now() });
      };
    }));
    if (removed) this.onChange?.();
    return result;
  }

  async put(key: string, audio: Uint8Array, generation = this.generation, original?: CachedAudioInfo): Promise<void> {
    if (!audio.byteLength || audio.byteLength > this.maxBytes || generation !== this.generation) return;
    if (original && original.expiresAt <= Date.now()) return;
    try {
      await this.maybeSweep();
      await this.withDatabase((db) => new Promise<void>((resolve, reject) => {
        if (generation !== this.generation) { resolve(); return; }
        const tx = db.transaction([AUDIO, ENTRIES, META], 'readwrite', { durability: 'strict' });
        const store = tx.objectStore(ENTRIES); const metadata = tx.objectStore(META);
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(failure(tx));
        const usageRequest = metadata.get(USAGE);
        usageRequest.onsuccess = () => {
          const usage: Usage = usageRequest.result ?? emptyUsage();
          const previousRequest = store.get(key);
          previousRequest.onsuccess = () => {
            const previous = previousRequest.result as CachedAudioInfo | undefined;
            // Restoring an older snapshot must not shorten an existing audio's life.
            if (original && previous && previous.expiresAt >= original.expiresAt) return;
            usage.count += previous ? 0 : 1;
            usage.bytes += audio.byteLength - (previous?.size ?? 0);
            const now = Date.now();
            tx.objectStore(AUDIO).put({ key, audio: audio.slice().buffer });
            store.put({ key, size: audio.byteLength, createdAt: original?.createdAt ?? now, expiresAt: original?.expiresAt ?? now + AUDIO_TTL_MS, lastUsed: original?.lastUsed ?? now } satisfies CachedAudioInfo);
            if (usage.count <= this.maxEntries && usage.bytes <= this.maxBytes) { metadata.put(usage, USAGE); return; }
            const cursorRequest = store.index('lastUsed').openCursor();
            cursorRequest.onsuccess = () => {
              const cursor = cursorRequest.result;
              if (!cursor || (usage.count <= this.maxEntries && usage.bytes <= this.maxBytes)) { metadata.put(usage, USAGE); return; }
              if (cursor.primaryKey !== key) {
                const entry = cursor.value as CachedAudioInfo;
                usage.count--; usage.bytes -= entry.size;
                tx.objectStore(AUDIO).delete(entry.key); cursor.delete();
              }
              cursor.continue();
            };
          };
        };
      }));
      this.writeWarning = undefined;
      if (generation === this.generation) this.onChange?.();
    } catch { this.writeWarning = '音频缓存保存失败，请检查磁盘空间；本次仍可播放，下次可能需要重新合成。'; }
  }

  async status(): Promise<SpeechCacheStatus> {
    await this.maybeSweep();
    return this.withDatabase((db) => new Promise((resolve, reject) => {
      const tx = db.transaction([META, ENTRIES], 'readonly');
      const usage = tx.objectStore(META).get(USAGE);
      const expired = tx.objectStore(ENTRIES).index('expiresAt').count(IDBKeyRange.upperBound(Date.now()));
      tx.oncomplete = () => resolve({ ...(usage.result ?? emptyUsage()), expiredCount: expired.result, ttlDays: 30, maxEntries: this.maxEntries, maxBytes: this.maxBytes, warning: this.writeWarning });
      tx.onerror = tx.onabort = () => reject(failure(tx));
    }));
  }

  // Metadata-only pages make external backups incremental and bounded in memory.
  async list(after?: string, limit = 128): Promise<CachedAudioInfo[]> {
    return this.withDatabase((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(ENTRIES, 'readonly');
      const request = tx.objectStore(ENTRIES).getAll(after ? IDBKeyRange.lowerBound(after, true) : undefined, limit);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(failure(tx));
    }));
  }

  async clear(): Promise<void> {
    ++this.generation;
    await this.withDatabase((db) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction([AUDIO, ENTRIES, META], 'readwrite', { durability: 'strict' });
      for (const name of [AUDIO, ENTRIES, META]) tx.objectStore(name).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(failure(tx));
    }));
    this.writeWarning = undefined;
    this.onChange?.();
  }
}

export const speechCache = new PersistentSpeechCache({ onChange: localDataChanged });
export async function speechCacheKey(text: string, voice: string, rate: number): Promise<string> {
  const material = JSON.stringify(['doubao-audio-v1', 'seed-tts-2.0', 'mp3', 24000, text, voice, rate]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function audioToBase64(audio: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < audio.length; offset += 32768) chunks.push(String.fromCharCode(...audio.subarray(offset, offset + 32768)));
  return btoa(chunks.join(''));
}
