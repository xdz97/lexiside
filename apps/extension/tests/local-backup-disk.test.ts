import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import process from 'node:process';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { AppSettingsSchema, ExportBundleSchema, LearningItemSchema, LookupHistorySchema } from '@lexiside/shared';
import { DiskBackupDirectory, diskChromeStorage } from './helpers/disk-backup-adapter';

// The runtime cannot clone real browser handles in Node. Only this platform
// boundary is replaced; storage, cache, manifest, coordinator and TTS cache-hit
// code below are the production implementations.
const directories = vi.hoisted(() => ({ active: undefined as FileSystemDirectoryHandle | undefined, candidate: undefined as FileSystemDirectoryHandle | undefined }));
vi.mock('../lib/backup-directory', () => ({
  getBackupDirectory: async (candidate = false) => candidate ? directories.candidate : directories.active,
  activateBackupCandidate: async () => { directories.active = directories.candidate; directories.candidate = undefined; },
  forgetBackupDirectory: async () => { directories.active = undefined; directories.candidate = undefined; },
}));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('round-trips a real disk backup in a fresh process, including expiry boundaries', async () => {
  const root = process.env.LEXISIDE_DISK_TEST_ROOT;
  const phase = process.env.LEXISIDE_DISK_TEST_PHASE;
  if (!root || !phase) throw new Error('Run npm run test:backup:disk to create an isolated disk fixture.');
  const base = Date.parse('2026-10-01T00:00:00.000Z');
  const day = 86_400_000;
  const clock = vi.spyOn(Date, 'now');
  const phaseTime = phase === 'expired' ? base + 30 * day : phase === 'all-expired' ? base + 58 * day : base + 29 * day + 3_600_000;
  clock.mockReturnValue(phaseTime);
  const profile = join(root, 'profiles', phase);
  await mkdir(profile, { recursive: true });
  const local = await diskChromeStorage(join(profile, 'chrome-local.json'));
  vi.stubGlobal('chrome', { storage: { local }, runtime: { getPlatformInfo: async () => ({ os: 'mac' }) } });
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  const network = vi.fn(async () => { throw new Error('Network forbidden in disk integration test'); });
  vi.stubGlobal('fetch', network);

  const storage = await import('../entrypoints/background/storage');
  const { speechCache, speechCacheKey, AUDIO_TTL_MS } = await import('../lib/speech-cache');
  const { readDirectoryBackup } = await import('../lib/local-backup-files');
  const backup = await import('../lib/local-backup');
  const { synthesizeDoubao } = await import('../lib/doubao');
  const settings = AppSettingsSchema.parse({
    theme: 'dark', uiFont: 'inter', ttsProvider: 'doubao', doubaoVoice: 'en_female_stokie_uranus_bigtts',
    speechRate: 0.75, voice: 'en-GB', speechScope: 'word', historyEnabled: true,
    doubleClickMode: 'button', contextRange: 'adjacent', disabledSites: ['example.test'],
  });
  const date = '2026-10-01T00:00:00.000Z';
  const word = LearningItemSchema.parse({
    id: 'disk-word-resilient', type: 'word', normalizedText: 'resilient', displayText: 'resilient', partOfSpeech: 'adjective',
    meaningZh: '有韧性的', definitionEn: 'able to recover quickly', phonetic: '/rɪˈzɪliənt/', note: '中文备注：真实磁盘备份验收',
    status: 'learning', collocations: ['a resilient system'], createdAt: date, updatedAt: date, occurrenceCount: 1,
    occurrences: [{ id: 'disk-occurrence', learningItemId: 'disk-word-resilient', selectedText: 'resilient', sentence: 'Build a resilient system.',
      pageTitle: '隔离测试页面', pageUrl: 'https://example.test/backup', siteName: 'example.test', capturedAt: date }],
  });
  const phrase = LearningItemSchema.parse({ id: 'disk-phrase', type: 'phrase', normalizedText: 'keep an eye on', displayText: 'keep an eye on',
    meaningZh: '留意', note: '短语也要恢复', status: 'mastered', createdAt: date, updatedAt: date, occurrenceCount: 0 });
  const history = [LookupHistorySchema.parse({ id: 'disk-history', selectedText: 'resilient', translation: '有韧性的',
    provider: 'chrome', pageUrl: 'https://example.test/backup', createdAt: date })];
  const expected = ExportBundleSchema.parse({ version: 1, exportedAt: date, items: [word, phrase], settings, history });
  const texts = ['Build a resilient system.', 'Keep an eye on the results.', 'This audio was already expired.'];
  const keys = await Promise.all(texts.map((text) => speechCacheKey(text, settings.doubaoVoice, settings.speechRate)));
  const audio = await Promise.all([0, 1, 2].map(async (i) => new Uint8Array(await readFile(join(root, 'fixtures', `tone-${i}.mp3`)))));
  const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
  const handle = new DiskBackupDirectory(join(root, phase === 'merge' ? 'initial-backup' : 'backup')).asHandle();
  const record: Record<string, unknown> = { phase, pid: process.pid, checks: [], time: new Date(phaseTime).toISOString() };
  const checks = record.checks as string[];

  try {
    if (phase === 'backup') {
      await storage.importBackup(expected, 'replace');
      await local.set({ deepseekApiKey: 'fixture-deepseek-not-a-real-key', doubaoApiKey: 'fixture-doubao-not-a-real-key' });
      clock.mockReturnValue(base - 2 * day); await speechCache.put(keys[2]!, audio[2]!);
      clock.mockReturnValue(base); await speechCache.put(keys[0]!, audio[0]!);
      clock.mockReturnValue(base + 28 * day); await speechCache.put(keys[1]!, audio[1]!);
      clock.mockReturnValue(phaseTime);
      directories.candidate = handle;
      await backup.connectLocalBackup(false); await backup.runLocalBackup();
      const manifest = (await readDirectoryBackup(handle))!;
      expect(manifest.bundle.items).toEqual(expected.items); expect(manifest.bundle.settings).toEqual(settings); expect(manifest.bundle.history).toEqual(history);
      expect(manifest.audio.map((entry) => entry.key).sort()).toEqual(keys.slice(0, 2).sort());
      const files = await readdir(join(root, 'backup', 'lexiside-audio'));
      expect(files).toHaveLength(2);
      for (let i = 0; i < 2; i++) {
        const entry = manifest.audio.find((entry) => entry.key === keys[i])!;
        expect(sha(await readFile(join(root, 'backup', 'lexiside-audio', `${entry.key}-${entry.createdAt}.mp3`)))).toBe(sha(audio[i]!));
        expect(entry.expiresAt).toBe(entry.createdAt + AUDIO_TTL_MS);
      }
      const raw = await readFile(join(root, 'backup', 'lexiside-backup.json'), 'utf8');
      expect(raw).not.toContain('ApiKey'); expect(raw).not.toContain('fixture-deepseek'); expect(raw).not.toContain('fixture-doubao');
      await backup.disconnectLocalBackup();
      expect(await readDirectoryBackup(handle)).not.toBeNull();
      checks.push('真实 JSON 与两份 MP3 已落盘，SHA-256 一致', '词库、中文备注、语境、历史、非默认设置完整', '备份时已过期音频未导出', 'API Key 未写入备份', '断开目录后文件仍保留');
      record.manifestAudio = manifest.audio; record.audioHashes = audio.slice(0, 2).map(sha);
    } else {
      expect(await storage.getLibrary()).toEqual([]); expect(await speechCache.status()).toMatchObject({ count: 0 });
      expect((await storage.getSettings()).theme).toBe('system');
      expect(await backup.claimRecoveryPrompt()).toBe(true); expect(await backup.claimRecoveryPrompt()).toBe(false);
      checks.push('新进程、空词库和空音频数据库开始恢复', '首次恢复提示仅领取一次');
      let localAudioCreatedAt: number | undefined;
      if (phase === 'merge') {
        const baselineSettings = AppSettingsSchema.parse({ theme: 'light', speechRate: 1.25 });
        const existing = LearningItemSchema.parse({ ...word, id: 'disk-existing', normalizedText: 'existing', displayText: 'existing', note: '保留原有备注', occurrences: [], occurrenceCount: 0 });
        await storage.importBackup({ ...expected, items: [existing], history: [], settings: baselineSettings }, 'replace');
        await speechCache.put(keys[1]!, audio[2]!); localAudioCreatedAt = Date.now();
      }
      const originalManifest = (await readDirectoryBackup(handle))!;
      const fileTimes = new Map(await Promise.all(originalManifest.audio.map(async (entry) => {
        const name = `${entry.key}-${entry.createdAt}.mp3`;
        return [name, (await stat(join((handle as unknown as DiskBackupDirectory).path, 'lexiside-audio', name), { bigint: true })).mtimeNs] as const;
      })));
      directories.candidate = handle;
      const restored = await backup.connectLocalBackup(true);
      record.restored = restored;
      if (phase === 'merge') {
        expect(restored).toEqual({ restoredWords: 2, restoredAudio: 2, skippedAudio: 0 });
        expect(await storage.getLibrary()).toHaveLength(3);
        expect((await storage.getLibrary()).find((item) => item.id === 'disk-existing')!.note).toBe('保留原有备注');
        expect(await storage.getSettings()).toEqual(AppSettingsSchema.parse({ theme: 'light', speechRate: 1.25 }));
        expect(await speechCache.get(keys[1]!)).toEqual(audio[2]);
        expect((await speechCache.list()).find((entry) => entry.key === keys[1])!.createdAt).toBe(localAudioCreatedAt);
        checks.push('已有词库与备份合并，原有词条和设置保留', '旧备份没有覆盖更新的本机音频');
      } else {
        expect(await storage.getLibrary()).toEqual(expected.items); expect(await storage.getSettings()).toEqual(settings);
        expect((await storage.exportBundle()).history).toEqual(history);
        expect(await local.get(['deepseekApiKey', 'doubaoApiKey'])).toEqual({ deepseekApiKey: undefined, doubaoApiKey: undefined });
        checks.push('恢复后的词库、语境、备注、历史和全部设置逐字段一致', 'API Key 未被恢复');
        const count = phase === 'recover' ? 2 : phase === 'expired' ? 1 : 0;
        expect(restored).toEqual({ restoredWords: 2, restoredAudio: count, skippedAudio: originalManifest.audio.length - count });
        const restoredMetadata = await speechCache.list(); expect(restoredMetadata).toHaveLength(count);
        for (let i = 0; i < 2; i++) {
          const original = originalManifest.audio.find((entry) => entry.key === keys[i]);
          const valid = Boolean(original && original.expiresAt > Date.now());
          if (valid) {
            expect(await speechCache.get(keys[i]!)).toEqual(audio[i]);
            expect(restoredMetadata.find((entry) => entry.key === keys[i])!.expiresAt).toBe(original!.expiresAt);
            const cached = await synthesizeDoubao(texts[i]!, settings, new AbortController().signal);
            const recoveredAudio = Buffer.from(cached, 'base64'); expect(sha(recoveredAudio)).toBe(sha(audio[i]!));
            await writeFile(join(profile, `recovered-${i}.mp3`), recoveredAudio);
          } else {
            expect(await speechCache.get(keys[i]!)).toBeNull();
            await expect(synthesizeDoubao(texts[i]!, settings, new AbortController().signal)).rejects.toThrow('填写豆包 API Key');
          }
        }
        checks.push('有效音频逐字节一致且无 Key 时走生产缓存命中分支', '恢复保持原过期时间，过期边界音频未写入新缓存');
        await backup.runLocalBackup();
        const nextManifest = (await readDirectoryBackup(handle))!; expect(nextManifest.audio).toHaveLength(count);
        expect(await readdir(join(root, 'backup', 'lexiside-audio'))).toHaveLength(count);
        for (const entry of nextManifest.audio) {
          const name = `${entry.key}-${entry.createdAt}.mp3`;
          expect((await stat(join(root, 'backup', 'lexiside-audio', name), { bigint: true })).mtimeNs).toBe(fileTimes.get(name));
        }
        checks.push('再次备份不重写有效音频，过期备份文件在活动时清理');
        record.remainingAudio = nextManifest.audio;
      }
      await backup.disconnectLocalBackup();
    }
    expect(network).not.toHaveBeenCalled(); record.networkRequests = network.mock.calls.length;
    checks.push('未发出任何网络请求，未产生语音合成费用');
    record.passed = true;
    await writeFile(join(root, `result-${phase}.json`), JSON.stringify(record, null, 2));
  } finally {
    await backup.disconnectLocalBackup().catch(() => undefined);
  }
}, 30_000);
