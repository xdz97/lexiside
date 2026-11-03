import { afterEach, expect, it, vi } from 'vitest';
import { withLocalTranslationTimeout } from './local-translation';

afterEach(() => { vi.useRealTimers(); });

it('bounds a stalled lookup and ignores a late local result after the caller has fallen back', async () => {
  vi.useFakeTimers();
  let finish!: (translation: string) => void;
  const local = new Promise<string>((resolve) => { finish = resolve; });
  const fallback = vi.fn(() => 'API result');
  const result = withLocalTranslationTimeout(local).catch(fallback);
  await vi.advanceTimersByTimeAsync(29_999);
  expect(fallback).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toBe('API result');
  finish('late local result');
  await Promise.resolve();
  expect(await result).toBe('API result');
  expect(fallback).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('cleans up the timeout on both success and an immediate local failure', async () => {
  vi.useFakeTimers();
  expect(await withLocalTranslationTimeout(Promise.resolve('利用'))).toBe('利用');
  expect(vi.getTimerCount()).toBe(0);
  await expect(withLocalTranslationTimeout(Promise.reject(new Error('language pack unavailable')))).rejects.toThrow('language pack unavailable');
  expect(vi.getTimerCount()).toBe(0);
});
