import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { ExportBundleSchema } from '@lexiside/shared';
import { AUDIO_TTL_MS, PersistentSpeechCache } from './speech-cache';
import { BACKUP_MANIFEST, deleteDirectoryBackup, readDirectoryBackup, restoreDirectoryAudio, writeDirectoryBackup } from './local-backup-files';

class MemoryDirectory {
  name = '拾词数据';
  files = new Map<string, Blob>();
  directories = new Map<string, MemoryDirectory>();
  writes = new Map<string, number>();
  failWrite?: string;
  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!options?.create) throw new DOMException('missing', 'NotFoundError');
      this.files.set(name, new Blob());
    }
    return {
      getFile: async () => this.files.get(name)!,
      createWritable: async () => {
        let pending: Blob;
        return {
          write: async (data: string | ArrayBuffer) => { if (this.failWrite === name) throw new Error('disk full'); pending = new Blob([data]); },
          close: async () => { this.files.set(name, pending); this.writes.set(name, (this.writes.get(name) ?? 0) + 1); },
          abort: async () => undefined,
        };
      },
    };
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    if (!this.directories.has(name)) {
      if (!options?.create) throw new DOMException('missing', 'NotFoundError');
      this.directories.set(name, new MemoryDirectory());
    }
    return this.directories.get(name)!;
  }
  async removeEntry(name: string) { if (!this.files.delete(name)) throw new DOMException('missing', 'NotFoundError'); }
  asHandle() { return this as unknown as FileSystemDirectoryHandle; }
}
const bundle = () => ExportBundleSchema.parse({ version: 1, exportedAt: new Date().toISOString(), items: [], history: [], settings: {} });
const key = (n: number) => n.toString(16).padStart(64, '0');
const bytes = new TextEncoder().encode('paid-audio');
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('user-selected directory backups', () => {
  it('backs up incrementally, restores across databases, and retains generation expiry', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const source = new PersistentSpeechCache();
    const dir = new MemoryDirectory();
    await source.put(key(1), bytes);
    const contents = bundle();
    await writeDirectoryBackup(dir.asHandle(), contents, source);
    clock.mockReturnValue(2000);
    await writeDirectoryBackup(dir.asHandle(), contents, source);
    expect([...dir.directories.get('lexiside-audio')!.writes.values()]).toEqual([1]);
    expect((await source.list())[0]!.lastUsed).toBe(1000);
    const manifest = (await readDirectoryBackup(dir.asHandle()))!;
    expect(manifest.bundle).toEqual(contents);
    expect(manifest.audio[0]).toMatchObject({ createdAt: 1000, expiresAt: 1000 + AUDIO_TTL_MS });
    const target = new PersistentSpeechCache({ databaseName: 'reinstalled' });
    expect(await restoreDirectoryAudio(dir.asHandle(), manifest, target)).toEqual({ restored: 1, skipped: 0 });
    expect(await target.get(key(1))).toEqual(bytes);
    expect((await target.list())[0]!.expiresAt).toBe(1000 + AUDIO_TTL_MS);
    clock.mockReturnValue(1000 + AUDIO_TTL_MS);
    const another = new PersistentSpeechCache({ databaseName: 'later' });
    expect(await restoreDirectoryAudio(dir.asHandle(), manifest, another)).toEqual({ restored: 0, skipped: 1 });
    expect(await another.status()).toMatchObject({ count: 0 });
  });

  it('skips missing or size-mismatched audio without restoring invalid bytes', async () => {
    const source = new PersistentSpeechCache(); const dir = new MemoryDirectory();
    await source.put(key(1), bytes); await source.put(key(2), bytes);
    await writeDirectoryBackup(dir.asHandle(), bundle(), source);
    const audio = dir.directories.get('lexiside-audio')!;
    const names = [...audio.files.keys()];
    audio.files.delete(names[0]!); audio.files.set(names[1]!, new Blob(['bad']));
    expect(await restoreDirectoryAudio(dir.asHandle(), (await readDirectoryBackup(dir.asHandle()))!, new PersistentSpeechCache({ databaseName: 'target' }))).toEqual({ restored: 0, skipped: 2 });
  });

  it('preserves the previous committed snapshot when new audio cannot be written', async () => {
    const source = new PersistentSpeechCache(); const dir = new MemoryDirectory();
    await source.put(key(1), bytes);
    await writeDirectoryBackup(dir.asHandle(), bundle(), source);
    const previous = await (await dir.getFileHandle(BACKUP_MANIFEST)).getFile();
    await source.put(key(2), bytes);
    const entry = (await source.list()).find((entry) => entry.key === key(2))!;
    dir.directories.get('lexiside-audio')!.failWrite = `${entry.key}-${entry.createdAt}.mp3`;
    await expect(writeDirectoryBackup(dir.asHandle(), bundle(), source)).rejects.toThrow('disk full');
    const before = JSON.parse(await previous.text());
    const after = (await readDirectoryBackup(dir.asHandle()))!;
    expect(after.bundle).toEqual(before.bundle); expect(after.audio).toEqual(before.audio);
    expect(after.garbage).toContain(`${entry.key}-${entry.createdAt}.mp3`);
    await deleteDirectoryBackup(dir.asHandle());
    expect(dir.directories.get('lexiside-audio')!.files.size).toBe(0);
  });

  it('rejects corrupt or traversal manifests before overwriting or deleting anything', async () => {
    const dir = new MemoryDirectory();
    const corrupt = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), bundle: bundle(), audio: [], garbage: ['../private.txt'] })]);
    dir.files.set(BACKUP_MANIFEST, corrupt);
    await expect(writeDirectoryBackup(dir.asHandle(), bundle(), new PersistentSpeechCache())).rejects.toThrow('格式无效');
    await expect(deleteDirectoryBackup(dir.asHandle())).rejects.toThrow('格式无效');
    expect(dir.files.get(BACKUP_MANIFEST)).toBe(corrupt);
  });

  it('collects expired backup files on activity and deletes only files owned by the manifest', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const cache = new PersistentSpeechCache(); const dir = new MemoryDirectory();
    await cache.put(key(1), bytes);
    await writeDirectoryBackup(dir.asHandle(), bundle(), cache);
    const audio = dir.directories.get('lexiside-audio')!;
    dir.files.set('my-notes.txt', new Blob(['private']));
    audio.files.set('unrelated.mp3', new Blob(['private']));
    clock.mockReturnValue(1000 + AUDIO_TTL_MS);
    await writeDirectoryBackup(dir.asHandle(), bundle(), cache);
    expect((await readDirectoryBackup(dir.asHandle()))!.audio).toEqual([]);
    expect([...audio.files.keys()]).toEqual(['unrelated.mp3']);
    await cache.put(key(2), bytes);
    await writeDirectoryBackup(dir.asHandle(), bundle(), cache);
    await deleteDirectoryBackup(dir.asHandle());
    expect([...dir.files.keys()]).toEqual(['my-notes.txt']);
    expect([...audio.files.keys()]).toEqual(['unrelated.mp3']);
  });
});


it('reuses already committed audio files when retrying an interrupted snapshot', async () => {
  const cache = new PersistentSpeechCache(); const dir = new MemoryDirectory();
  await cache.put(key(1), bytes); await cache.put(key(2), bytes);
  const entries = await cache.list();
  const name1 = `${entries[0]!.key}-${entries[0]!.createdAt}.mp3`;
  const name2 = `${entries[1]!.key}-${entries[1]!.createdAt}.mp3`;
  const audio = await dir.getDirectoryHandle('lexiside-audio', { create: true });
  audio.failWrite = name2;
  await expect(writeDirectoryBackup(dir.asHandle(), bundle(), cache)).rejects.toThrow('disk full');
  expect(audio.writes.get(name1)).toBe(1);
  audio.failWrite = undefined;
  await writeDirectoryBackup(dir.asHandle(), bundle(), cache);
  expect(audio.writes.get(name1)).toBe(1);
  expect(audio.writes.get(name2)).toBe(1);
  expect((await readDirectoryBackup(dir.asHandle()))!.audio).toHaveLength(2);
});
