import { describe, expect, it } from 'vitest';
import { runtimeErrorMessage } from './runtime';

describe('runtimeErrorMessage', () => {
  it('keeps Error messages readable for the UI', () => {
    expect(runtimeErrorMessage(new Error('Companion 未连接'))).toBe('Companion 未连接');
  });

  it('normalizes non-Error failures', () => {
    expect(runtimeErrorMessage('翻译失败')).toBe('翻译失败');
  });
});
