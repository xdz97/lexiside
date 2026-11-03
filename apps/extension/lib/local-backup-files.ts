import { z } from 'zod';
import { ExportBundleSchema, type ExportBundle } from '@lexiside/shared';
import { AUDIO_TTL_MS, type CachedAudioInfo, type PersistentSpeechCache } from './speech-cache';

export const BACKUP_MANIFEST = 'lexiside-backup.json';
const AUDIO_DIRECTORY = 'lexiside-audio';
const MAX_MANIFEST_BYTES = 128 * 1024 * 1024;
const nameSchema = z.string().regex(/^[a-f0-9]{64}-\d{1,16}\.mp3$/);
const audioSchema = z.object({
  key: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().min(1).max(4 * 1024 * 1024),
  createdAt: z.number().int().nonnegative().max(8.64e15), expiresAt: z.number().int().nonnegative().max(8.64e15),
  lastUsed: z.number().int().nonnegative().max(8.64e15),
}).refine((entry) => entry.expiresAt === entry.createdAt + AUDIO_TTL_MS, '音频有效期无效');
const manifestSchema = z.object({
  version: z.literal(1), exportedAt: z.string().datetime(), bundle: ExportBundleSchema,
  audio: z.array(audioSchema).max(100_000), garbage: z.array(nameSchema).max(1_000_000).default([]),
});
export type DirectoryBackup = z.infer<typeof manifestSchema>;
const audioName = (entry: CachedAudioInfo) => nameSchema.parse(`${entry.key}-${entry.createdAt}.mp3`);
const isMissing = (error: unknown) => error instanceof Error && error.name === 'NotFoundError';

export async function readDirectoryBackup(directory: FileSystemDirectoryHandle): Promise<DirectoryBackup | null> {
  let handle: FileSystemFileHandle;
  try { handle = await directory.getFileHandle(BACKUP_MANIFEST); } catch (error) { if (isMissing(error)) return null; throw error; }
  const file = await handle.getFile();
  if (file.size > MAX_MANIFEST_BYTES) throw new Error('备份索引超过大小限制，无法读取。');
  const parsed = manifestSchema.safeParse(JSON.parse(await file.text()));
  if (!parsed.success) throw new Error('本机目录中的拾词备份格式无效，未修改现有数据。');
  if (new Set(parsed.data.audio.map((entry) => entry.key)).size !== parsed.data.audio.length) throw new Error('备份包含重复音频标识。');
  return parsed.data;
}

async function writeFile(directory: FileSystemDirectoryHandle, name: string, contents: string | Uint8Array): Promise<void> {
  const handle = await directory.getFileHandle(name, { create: true });
  const stream = await handle.createWritable();
  try { await stream.write(typeof contents === 'string' ? contents : contents.slice().buffer); await stream.close(); }
  catch (error) { await stream.abort().catch(() => undefined); throw error; }
}
async function writeManifest(directory: FileSystemDirectoryHandle, value: DirectoryBackup): Promise<void> {
  const text = JSON.stringify(value);
  if (new Blob([text]).size > MAX_MANIFEST_BYTES) throw new Error('备份索引过大，未覆盖原备份。');
  await writeFile(directory, BACKUP_MANIFEST, text);
}

export async function writeDirectoryBackup(directory: FileSystemDirectoryHandle, bundle: ExportBundle, cache: PersistentSpeechCache): Promise<void> {
  const previous = await readDirectoryBackup(directory);
  const oldFiles = new Set(previous?.audio.map(audioName) ?? []);
  const audioDirectory = await directory.getDirectoryHandle(AUDIO_DIRECTORY, { create: true });
  const planned: CachedAudioInfo[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await cache.list(after);
    if (!page.length) break;
    for (const entry of page) if (entry.expiresAt > Date.now()) planned.push(entry);
    after = page.at(-1)!.key;
  }
  const newNames = planned.map(audioName).filter((name) => !oldFiles.has(name));
  // Journal planned writes before creating files. The previous snapshot stays
  // readable, and interrupted files remain identifiable for retry or deletion.
  const pending = [...new Set([...(previous?.garbage ?? []), ...newNames])];
  if (newNames.length) await writeManifest(directory, {
    version: 1, exportedAt: previous?.exportedAt ?? new Date().toISOString(),
    bundle: previous?.bundle ?? bundle, audio: previous?.audio ?? [], garbage: pending,
  });
  const audio: CachedAudioInfo[] = [];
  for (const entry of planned) {
    if (entry.expiresAt <= Date.now()) continue;
    const name = audioName(entry);
    if (!oldFiles.has(name)) {
      // Reuse completed files from an interrupted run without rewriting audio.
      let complete = false;
      try { complete = (await (await audioDirectory.getFileHandle(name)).getFile()).size === entry.size; }
      catch (error) { if (!isMissing(error)) throw error; }
      if (!complete) {
        const data = await cache.get(entry.key, { touch: false, createdAt: entry.createdAt });
        if (!data) continue;
        await writeFile(audioDirectory, name, data);
      }
    }
    audio.push(entry);
  }
  const currentFiles = new Set(audio.map(audioName));
  const garbage = [...new Set([...pending, ...oldFiles])].filter((name) => !currentFiles.has(name));
  const manifest: DirectoryBackup = { version: 1, exportedAt: new Date().toISOString(), bundle, audio, garbage };
  // Commit the index only after all referenced new audio files are complete.
  await writeManifest(directory, manifest);
  // Reclaim a bounded number of old backup files on activity, with no timer job.
  const remaining = [...garbage];
  for (const name of garbage.slice(0, 32)) {
    try { await audioDirectory.removeEntry(name); } catch (error) { if (!isMissing(error)) throw error; }
    remaining.shift();
  }
  if (remaining.length !== garbage.length) await writeManifest(directory, { ...manifest, garbage: remaining });
}

export async function restoreDirectoryAudio(directory: FileSystemDirectoryHandle, backup: DirectoryBackup, cache: PersistentSpeechCache): Promise<{ restored: number; skipped: number }> {
  let audioDirectory: FileSystemDirectoryHandle;
  try { audioDirectory = await directory.getDirectoryHandle(AUDIO_DIRECTORY); }
  catch (error) { if (isMissing(error)) return { restored: 0, skipped: backup.audio.length }; throw error; }
  let restored = 0; let skipped = 0;
  for (const entry of backup.audio) {
    if (entry.expiresAt <= Date.now() || entry.createdAt > Date.now() + 300_000) { skipped++; continue; }
    try {
      const file = await (await audioDirectory.getFileHandle(audioName(entry))).getFile();
      if (file.size !== entry.size) { skipped++; continue; }
      const data = new Uint8Array(await file.arrayBuffer());
      await cache.put(entry.key, data, cache.getGeneration(), entry);
      if (cache.getWarning()) throw new Error('磁盘无法保存恢复的音频，请腾出空间后重试。');
      restored++;
    } catch (error) { if (isMissing(error)) skipped++; else throw error; }
  }
  return { restored, skipped };
}

export async function deleteDirectoryBackup(directory: FileSystemDirectoryHandle): Promise<void> {
  const backup = await readDirectoryBackup(directory);
  if (!backup) return;
  try {
    const audio = await directory.getDirectoryHandle(AUDIO_DIRECTORY);
    for (const name of new Set([...backup.audio.map(audioName), ...backup.garbage])) {
      try { await audio.removeEntry(name); } catch (error) { if (!isMissing(error)) throw error; }
    }
  } catch (error) { if (!isMissing(error)) throw error; }
  await directory.removeEntry(BACKUP_MANIFEST);
  // Deliberately leave the chosen directory and unrelated files untouched.
}
