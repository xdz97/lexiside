import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  active: undefined as FileSystemDirectoryHandle | undefined,
  candidate: undefined as FileSystemDirectoryHandle | undefined,
  read: vi.fn(), write: vi.fn(), restore: vi.fn(), remove: vi.fn(),
  library: vi.fn(), import: vi.fn(), export: vi.fn(),
}));
vi.mock('./backup-directory', () => ({
  getBackupDirectory: async (candidate = false) => candidate ? mocks.candidate : mocks.active,
  activateBackupCandidate: async () => { mocks.active = mocks.candidate; mocks.candidate = undefined; },
  forgetBackupDirectory: async () => { mocks.active = undefined; mocks.candidate = undefined; },
}));
vi.mock('./local-backup-files', () => ({ readDirectoryBackup: mocks.read, writeDirectoryBackup: mocks.write, restoreDirectoryAudio: mocks.restore, deleteDirectoryBackup: mocks.remove }));
vi.mock('../entrypoints/background/storage', () => ({ getLibrary: mocks.library, importBackup: mocks.import, exportBundle: mocks.export }));
let stored: Record<string, unknown>;
const directory = (permission = 'granted') => ({ name: 'data', queryPermission: vi.fn(async () => permission) }) as unknown as FileSystemDirectoryHandle;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.active = undefined; mocks.candidate = undefined; stored = {};
  mocks.library.mockResolvedValue([]); mocks.read.mockResolvedValue(null);
  mocks.export.mockResolvedValue({ items: [] }); mocks.write.mockResolvedValue(undefined);
  mocks.restore.mockResolvedValue({ restored: 3, skipped: 2 }); mocks.import.mockResolvedValue(5);
  vi.stubGlobal('chrome', { storage: { local: {
    get: async (key: string) => ({ [key]: stored[key] }),
    set: async (values: Record<string, unknown>) => { Object.assign(stored, values); },
  } }, runtime: { getPlatformInfo: async () => ({ os: 'mac' }) } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('directory backup lifecycle', () => {
  it('claims the recovery prompt once across simultaneous panels and later opens', async () => {
    const { claimRecoveryPrompt } = await import('./local-backup');
    expect(await Promise.all([claimRecoveryPrompt(), claimRecoveryPrompt()])).toEqual([true, false]);
    expect(await claimRecoveryPrompt()).toBe(false);
  });
  it('does not prompt users who already have a library', async () => {
    mocks.library.mockResolvedValue([{}]);
    expect(await (await import('./local-backup')).claimRecoveryPrompt()).toBe(false);
    expect(stored.recoveryPromptSeen).toBe(true);
  });
  it('restores automatically after authorization, merges existing words, and coalesces backup writes', async () => {
    vi.useFakeTimers();
    mocks.candidate = directory(); mocks.library.mockResolvedValue([{}]);
    const bundle = { items: [{}] }; mocks.read.mockResolvedValue({ bundle });
    const api = await import('./local-backup');
    expect(await api.connectLocalBackup(true)).toEqual({ restoredWords: 5, restoredAudio: 3, skippedAudio: 2 });
    expect(mocks.import).toHaveBeenCalledWith(bundle, 'merge');
    expect(mocks.active).toBeDefined(); expect(stored.recoveryPromptSeen).toBe(true);
    api.scheduleLocalBackup(); api.scheduleLocalBackup();
    await vi.advanceTimersByTimeAsync(750);
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(await api.getLocalBackupStatus()).toMatchObject({ configured: true, permission: 'granted', busy: false, lastBackupAt: expect.any(String) });
  });
  it('restores settings for a fresh library, and protects the existing snapshot from accidental overwrite', async () => {
    vi.useFakeTimers(); mocks.candidate = directory();
    const bundle = { items: [] }; mocks.read.mockResolvedValue({ bundle });
    const api = await import('./local-backup');
    await expect(api.connectLocalBackup(false)).rejects.toThrow('已有拾词备份');
    expect(mocks.import).not.toHaveBeenCalled(); expect(mocks.active).toBeUndefined();
    await api.connectLocalBackup(true);
    expect(mocks.import).toHaveBeenCalledWith(bundle, 'replace');
    await api.disconnectLocalBackup();
    expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.active).toBeUndefined();
  });
  it('does not alter the word library when audio restoration fails', async () => {
    mocks.candidate = directory(); mocks.read.mockResolvedValue({ bundle: { items: [] } }); mocks.restore.mockRejectedValue(new Error('disk full'));
    await expect((await import('./local-backup')).connectLocalBackup(true)).rejects.toThrow('disk full');
    expect(mocks.import).not.toHaveBeenCalled(); expect(mocks.active).toBeUndefined();
  });
  it('never prompts for permission in the background and records failures for the settings UI', async () => {
    mocks.active = directory('prompt');
    const api = await import('./local-backup');
    await expect(api.runLocalBackup()).rejects.toThrow('重新授权');
    expect(mocks.write).not.toHaveBeenCalled();
    expect(await api.getLocalBackupStatus()).toMatchObject({ permission: 'prompt', errorCode: 'permission', error: undefined, busy: false });
    await expect(api.disconnectLocalBackup(true)).rejects.toThrow('重新授权');
    expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.active).toBeDefined();
  });
  it('requires an explicit delete operation to remove a backup', async () => {
    mocks.active = directory(); const api = await import('./local-backup');
    await api.disconnectLocalBackup(true);
    expect(mocks.remove).toHaveBeenCalledTimes(1); expect(mocks.active).toBeUndefined();
  });

  it('resumes backup after regranting without reconnecting or importing old data', async () => {
    mocks.active = directory('prompt');
    const api = await import('./local-backup');
    await expect(api.runLocalBackup()).rejects.toThrow('重新授权');
    expect(mocks.write).not.toHaveBeenCalled();
    vi.mocked(mocks.active.queryPermission).mockResolvedValue('granted');
    expect(await api.getLocalBackupStatus()).toMatchObject({ permission: 'granted', error: undefined, errorCode: undefined });
    await api.runLocalBackup();
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.import).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(await api.getLocalBackupStatus()).toMatchObject({ configured: true, permission: 'granted', lastBackupAt: expect.any(String), error: undefined });
  });

  it('deduplicates the legacy permission error and stops showing it once access is granted', async () => {
    mocks.active = directory('prompt');
    stored.localBackupState = { lastBackupAt: '2026-10-28T01:00:00.000Z', error: '本机备份目录需要重新授权，请点击“重新选择目录”。' };
    const api = await import('./local-backup');
    expect(await api.getLocalBackupStatus()).toMatchObject({ permission: 'prompt', errorCode: 'permission', error: undefined, lastBackupAt: '2026-10-28T01:00:00.000Z' });
    vi.mocked(mocks.active.queryPermission).mockResolvedValue('granted');
    expect(await api.getLocalBackupStatus()).toMatchObject({ permission: 'granted', errorCode: undefined, error: undefined });
  });

  it('does not hide a subsequent real write failure behind an old permission error', async () => {
    mocks.active = directory('prompt');
    const api = await import('./local-backup');
    await expect(api.runLocalBackup()).rejects.toThrow('重新授权');
    vi.mocked(mocks.active.queryPermission).mockResolvedValue('granted');
    mocks.write.mockRejectedValue(new Error('disk full'));
    await expect(api.runLocalBackup()).rejects.toThrow('disk full');
    expect(await api.getLocalBackupStatus()).toMatchObject({ permission: 'granted', error: 'disk full', errorCode: undefined });
  });
});
