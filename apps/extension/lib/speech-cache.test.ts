import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { AUDIO_TTL_MS, PersistentSpeechCache, audioToBase64, speechCacheKey } from './speech-cache';

const bytes = (text: string) => new TextEncoder().encode(text);
const decode = (audio: Uint8Array | null) => audio ? new TextDecoder().decode(audio) : null;

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('persistent speech audio cache', () => {
  it('stores binary audio and usage across cache instances with generous production limits', async () => {
    const cache = new PersistentSpeechCache();
    await cache.put('a', bytes('audio-one'));
    const restarted = new PersistentSpeechCache();
    expect(decode(await restarted.get('a'))).toBe('audio-one');
    expect(await restarted.status()).toMatchObject({ count: 1, bytes: 9, maxEntries: 100_000, maxBytes: 1024 ** 3 });
  });

  it('evicts least recently used audio when the entry limit is reached', async () => {
    const cache = new PersistentSpeechCache({ maxEntries: 2 });
    const clock = vi.spyOn(Date, 'now');
    clock.mockReturnValue(1); await cache.put('a', bytes('one'));
    clock.mockReturnValue(2); await cache.put('b', bytes('two'));
    clock.mockReturnValue(3); await cache.get('a');
    clock.mockReturnValue(4); await cache.put('c', bytes('three'));
    expect(await cache.get('b')).toBeNull();
    expect(decode(await cache.get('a'))).toBe('one');
    expect(decode(await cache.get('c'))).toBe('three');
    expect(await cache.status()).toMatchObject({ count: 2, bytes: 8 });
  });

  it('enforces the byte budget and accounts for replaced entries without double-counting', async () => {
    const cache = new PersistentSpeechCache({ maxBytes: 10 });
    await cache.put('a', bytes('12345'));
    await cache.put('a', bytes('123456'));
    expect(await cache.status()).toMatchObject({ count: 1, bytes: 6 });
    await cache.put('b', bytes('67890'));
    expect(await cache.get('a')).toBeNull();
    expect(await cache.status()).toMatchObject({ count: 1, bytes: 5 });
    await cache.put('oversize', bytes('a'.repeat(11)));
    expect(await cache.status()).toMatchObject({ count: 1, bytes: 5 });
  });

  it('serializes concurrent writes and replacements in IndexedDB transactions', async () => {
    const cache = new PersistentSpeechCache();
    await Promise.all(Array.from({ length: 100 }, (_, i) => cache.put(`key-${i}`, bytes('audio'))));
    expect(await cache.status()).toMatchObject({ count: 100, bytes: 500 });
    await Promise.all(Array.from({ length: 10 }, () => cache.put('same-key', bytes('same'))));
    expect(await cache.status()).toMatchObject({ count: 101, bytes: 504 });
  });

  it('clears both audio and usage and prevents older in-flight synthesis from restoring it', async () => {
    const cache = new PersistentSpeechCache();
    await cache.put('a', bytes('old'));
    const generation = cache.getGeneration();
    await cache.clear();
    await cache.put('late-audio', bytes('late'), generation);
    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('late-audio')).toBeNull();
    expect(await cache.status()).toMatchObject({ count: 0, bytes: 0 });
    await cache.put('new', bytes('new'));
    expect(await cache.status()).toMatchObject({ count: 1, bytes: 3 });
  });

  it('uses separate hashes for text, voices and rates without storing raw text in the key', async () => {
    const keys = await Promise.all([
      speechCacheKey('hello', 'voice-a', 1), speechCacheKey('hello', 'voice-a', 1),
      speechCacheKey('Hello', 'voice-a', 1), speechCacheKey('hello', 'voice-b', 1), speechCacheKey('hello', 'voice-a', 0.75),
    ]);
    expect(keys[0]).toBe(keys[1]);
    expect(new Set(keys).size).toBe(4);
    expect(keys[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it('round-trips large binary audio without call-stack overflow', () => {
    const audio = Uint8Array.from({ length: 256 * 1024 }, (_, i) => i % 256);
    const decoded = Uint8Array.from(atob(audioToBase64(audio)), (char) => char.charCodeAt(0));
    expect(decoded).toEqual(audio);
  });

  it('still allows playback after disk-write failure and reports the cache problem', async () => {
    const cache = new PersistentSpeechCache();
    const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new DOMException('disk full', 'QuotaExceededError'); });
    await expect(cache.put('paid-audio', bytes('audio'))).resolves.toBeUndefined();
    open.mockRestore();
    expect((await cache.status()).warning).toContain('下次可能需要重新合成');
    await cache.put('new-audio', bytes('audio'));
    expect((await cache.status()).warning).toBeUndefined();
  });
});


describe('fixed audio expiry and lazy collection', () => {
  it('expires exactly 30 days after generation even when played and restarted', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const cache = new PersistentSpeechCache();
    await cache.put('a', bytes('one'));
    now.mockReturnValue(1000 + AUDIO_TTL_MS - 1);
    expect(decode(await cache.get('a'))).toBe('one');
    expect((await cache.list())[0]).toMatchObject({ createdAt: 1000, expiresAt: 1000 + AUDIO_TTL_MS });
    now.mockReturnValue(1000 + AUDIO_TTL_MS);
    expect(await new PersistentSpeechCache().get('a')).toBeNull();
    expect(await cache.status()).toMatchObject({ count: 0, bytes: 0, expiredCount: 0, ttlDays: 30 });
  });

  it('bounds indexed collection to 32 per minute of activity and never serves a requested expired item', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1);
    const cache = new PersistentSpeechCache();
    for (let i = 0; i < 100; i++) await cache.put(`a${i.toString().padStart(3, '0')}`, bytes('old'));
    now.mockReturnValue(AUDIO_TTL_MS + 2);
    expect(await cache.status()).toMatchObject({ count: 68, expiredCount: 68, bytes: 204 });
    expect(await cache.get('a099')).toBeNull();
    expect(await cache.status()).toMatchObject({ count: 67, expiredCount: 67 });
    now.mockReturnValue(AUDIO_TTL_MS + 60_002);
    expect(await cache.status()).toMatchObject({ count: 35, expiredCount: 35 });
  });

  it('does not touch playback recency for backups and preserves the original expiry on restore', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const cache = new PersistentSpeechCache();
    await cache.put('a', bytes('one'));
    const [original] = await cache.list();
    now.mockReturnValue(2000);
    expect(await cache.get('a', { touch: false, createdAt: 999 })).toBeNull();
    expect(decode(await cache.get('a', { touch: false, createdAt: 1000 }))).toBe('one');
    expect((await cache.list())[0]!.lastUsed).toBe(1000);
    const restored = new PersistentSpeechCache({ databaseName: 'restored' });
    await restored.put('a', bytes('one'), restored.getGeneration(), original!);
    expect((await restored.list())[0]).toEqual(original);
    now.mockReturnValue(1000 + AUDIO_TTL_MS);
    expect(await restored.get('a')).toBeNull();
    await restored.put('a', bytes('one'), restored.getGeneration(), original!);
    expect(await restored.status()).toMatchObject({ count: 0 });
  });

  it('migrates v1 binary audio once without losing it or duplicating usage', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('legacy', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('metadata');
        const audio = db.createObjectStore('audio', { keyPath: 'key' });
        audio.createIndex('lastUsed', 'lastUsed');
        audio.put({ key: 'a', audio: bytes('legacy-audio').buffer, size: 12, lastUsed: 1000 });
      };
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    });
    const cache = new PersistentSpeechCache({ databaseName: 'legacy' });
    expect(decode(await cache.get('a'))).toBe('legacy-audio');
    expect((await cache.list())[0]).toMatchObject({ createdAt: 1000, expiresAt: 1000 + AUDIO_TTL_MS, size: 12 });
    expect(await cache.status()).toMatchObject({ count: 1, bytes: 12 });
  });
});


it('keeps newer local audio when merging an older directory snapshot', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
  const cache = new PersistentSpeechCache();
  await cache.put('a', bytes('old'));
  const [original] = await cache.list();
  clock.mockReturnValue(2000);
  await cache.put('a', bytes('new'));
  await cache.put('a', bytes('old'), cache.getGeneration(), original!);
  expect(decode(await cache.get('a'))).toBe('new');
  expect((await cache.list())[0]!.createdAt).toBe(2000);
  expect(await cache.status()).toMatchObject({ count: 1, bytes: 3 });
});
