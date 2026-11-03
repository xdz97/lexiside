import { afterEach, beforeEach, expect, it, vi } from 'vitest';
let local: Record<string, unknown>;
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 28, 12));
  local = {};
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async (key: string) => ({ [key]: local[key] })),
    set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(local, values); }),
  } } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('only suggests on the third, fourth and fifth slow request, including concurrent calls', async () => {
  const { recordSlowSpeech } = await import('./speech-wait');
  expect(await Promise.all(Array.from({ length: 8 }, () => recordSlowSpeech()))).toEqual([
    null, null, { type: 'SPEECH_WAIT_TIP', count: 3 }, { type: 'SPEECH_WAIT_TIP', count: 4 }, { type: 'SPEECH_WAIT_TIP', count: 5 }, null, null, null,
  ]);
  expect(local).toEqual({ speechSlowWaitDaily: { date: '2026-10-28', count: 6 } });
});

it('retains the count across worker restarts and resets on the next local calendar day', async () => {
  const first = await import('./speech-wait');
  await first.recordSlowSpeech(); await first.recordSlowSpeech();
  vi.resetModules();
  const second = await import('./speech-wait');
  expect(await second.recordSlowSpeech()).toMatchObject({ count: 3 });
  vi.setSystemTime(new Date(2026, 9, 29, 0));
  expect(await second.recordSlowSpeech()).toBeNull();
  expect(local.speechSlowWaitDaily).toMatchObject({ date: '2026-10-29', count: 1 });
});

it('recovers after storage failure without poisoning later counter writes', async () => {
  const { recordSlowSpeech } = await import('./speech-wait');
  vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(recordSlowSpeech()).rejects.toThrow('storage unavailable');
  expect(await recordSlowSpeech()).toBeNull();
});
