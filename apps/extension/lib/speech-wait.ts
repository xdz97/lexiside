export const SPEECH_WAIT_MS = 5_000;
const STORAGE_KEY = 'speechSlowWaitDaily';
export interface SpeechWaitTip { type: 'SPEECH_WAIT_TIP'; count: number }
export const SPEECH_WAIT_TIP_TEXT = '今天已多次等待朗读超过 5 秒。可在「设置 → 朗读」切换为系统语音，并选择本地声线，减少等待。';
let tail: Promise<unknown> = Promise.resolve();

// One bounded record, serialized across callers and retained across worker/browser restarts.
export function recordSlowSpeech(): Promise<SpeechWaitTip | null> {
  const operation = tail.then(async () => {
    const now = new Date();
    const date = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as { date?: string; count?: number } | undefined;
    const previous = stored?.date === date && Number.isInteger(stored.count) && Number(stored.count) >= 0 ? Number(stored.count) : 0;
    const count = Math.min(previous + 1, 6);
    await chrome.storage.local.set({ [STORAGE_KEY]: { date, count } });
    return count >= 3 && count <= 5 ? { type: 'SPEECH_WAIT_TIP' as const, count } : null;
  });
  tail = operation.catch(() => undefined);
  return operation;
}
