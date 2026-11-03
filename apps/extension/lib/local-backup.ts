import { exportBundle, getLibrary, importBackup } from '../entrypoints/background/storage';
import { activateBackupCandidate, forgetBackupDirectory, getBackupDirectory } from './backup-directory';
import { deleteDirectoryBackup, readDirectoryBackup, restoreDirectoryAudio, writeDirectoryBackup } from './local-backup-files';
import { speechCache } from './speech-cache';

export interface LocalBackupStatus {
  configured: boolean; directoryName?: string; permission?: PermissionState;
  busy: boolean; lastBackupAt?: string; error?: string; errorCode?: 'permission';
}
const STATE_KEY = 'localBackupState';
const LEGACY_PERMISSION_ERROR = '本机备份目录需要重新授权，请点击“重新选择目录”。';
class BackupPermissionError extends Error {
  constructor() { super('本机备份目录需要确认读写权限，请在设置中点击“重新授权”。'); }
}
let running: Promise<void> | undefined;
let scheduled: ReturnType<typeof setTimeout> | undefined;
let dirty = false;
let paused = false;
let promptTail: Promise<unknown> = Promise.resolve();

export async function getLocalBackupStatus(): Promise<LocalBackupStatus> {
  const handle = await getBackupDirectory();
  const stored = await chrome.storage.local.get(STATE_KEY);
  const state = stored[STATE_KEY] as { lastBackupAt?: string; error?: string; errorCode?: 'permission' } | undefined;
  const permission = handle ? await handle.queryPermission({ mode: 'readwrite' }) : undefined;
  // Permission status has its own actionable UI. Do not repeat a persisted
  // permission failure as a second error, or keep showing it after regranting.
  const permissionError = state?.errorCode === 'permission' || state?.error === LEGACY_PERMISSION_ERROR;
  return {
    configured: Boolean(handle), directoryName: handle?.name, permission, busy: Boolean(running) || paused,
    lastBackupAt: state?.lastBackupAt, error: permissionError ? undefined : state?.error,
    errorCode: permissionError && permission !== 'granted' ? 'permission' : undefined,
  };
}
async function recordFailure(error: unknown): Promise<void> {
  const previous = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY] as object | undefined;
  await chrome.storage.local.set({ [STATE_KEY]: {
    ...previous, error: error instanceof Error ? error.message : '本机目录备份失败',
    errorCode: error instanceof BackupPermissionError ? 'permission' : null,
  } });
}

export function scheduleLocalBackup(): void {
  dirty = true;
  if (paused || running || scheduled) return;
  // This debounce coalesces writes; expiration never uses timers or alarms.
  scheduled = setTimeout(() => { scheduled = undefined; void runLocalBackup().catch(() => undefined); }, 750);
}
export async function runLocalBackup(): Promise<void> {
  if (scheduled) { clearTimeout(scheduled); scheduled = undefined; }
  if (paused) throw new Error('目录正在连接或断开，请稍后重试。');
  if (running) return running;
  running = (async () => {
    const directory = await getBackupDirectory();
    if (!directory) { dirty = false; return; }
    if (await directory.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new BackupPermissionError();
    const keepAlive = setInterval(() => { void chrome.runtime.getPlatformInfo().catch(() => undefined); }, 20_000);
    try {
      do {
        dirty = false;
        await writeDirectoryBackup(directory, await exportBundle(), speechCache);
        await chrome.storage.local.set({ [STATE_KEY]: { lastBackupAt: new Date().toISOString() } });
      } while (dirty && !paused);
    } finally { clearInterval(keepAlive); }
  })();
  try { await running; } catch (error) { await recordFailure(error); throw error; }
  finally { running = undefined; }
}

export async function connectLocalBackup(restore: boolean): Promise<{ restoredWords: number; restoredAudio: number; skippedAudio: number }> {
  if (paused) throw new Error('目录操作正在进行，请稍后重试。');
  paused = true;
  if (scheduled) { clearTimeout(scheduled); scheduled = undefined; }
  let success = false;
  try {
    await running?.catch(() => undefined);
    const directory = await getBackupDirectory(true);
    if (!directory || await directory.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('请选择并授权本机备份目录。');
    const backup = await readDirectoryBackup(directory);
    if (backup && !restore) throw new Error('此目录已有拾词备份，请使用“从已有目录恢复”，避免覆盖已有数据。');
    if (!backup && restore) throw new Error('此目录没有找到 lexiside-backup.json，请选择原先的拾词数据目录。');
    let restoredWords = 0; let restoredAudio = 0; let skippedAudio = 0;
    if (backup) {
      // Merge into existing libraries; a fresh installation also restores settings.
      const fresh = (await getLibrary()).length === 0;
      const audio = await restoreDirectoryAudio(directory, backup, speechCache);
      restoredAudio = audio.restored; skippedAudio = audio.skipped;
      restoredWords = await importBackup(backup.bundle, fresh ? 'replace' : 'merge');
    }
    await activateBackupCandidate();
    await chrome.storage.local.set({ recoveryPromptSeen: true });
    success = true;
    return { restoredWords, restoredAudio, skippedAudio };
  } finally {
    paused = false;
    if (success) scheduleLocalBackup();
  }
}

export async function disconnectLocalBackup(removeFiles = false): Promise<void> {
  if (paused) throw new Error('目录操作正在进行，请稍后重试。');
  paused = true;
  if (scheduled) { clearTimeout(scheduled); scheduled = undefined; }
  try {
    await running?.catch(() => undefined);
    const directory = await getBackupDirectory();
    if (removeFiles && directory) {
      if (await directory.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('删除本机备份前需要重新授权目录。');
      await deleteDirectoryBackup(directory);
    }
    await forgetBackupDirectory();
    await chrome.storage.local.set({ [STATE_KEY]: {} });
  } finally { paused = false; dirty = false; }
}

export async function claimRecoveryPrompt(): Promise<boolean> {
  // Serialize claims from multiple side panels so the first-run question is shown once.
  const result = promptTail.then(async () => {
    const stored = await chrome.storage.local.get('recoveryPromptSeen');
    if (stored.recoveryPromptSeen) return false;
    await chrome.storage.local.set({ recoveryPromptSeen: true });
    if (await getBackupDirectory() || (await getLibrary()).length > 0) return false;
    return true;
  });
  promptTail = result.catch(() => undefined);
  return result;
}
