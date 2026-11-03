import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('NativeBridge timeouts', () => {
  it('waits past 45 seconds for a cold analysis and reconnects after timeout', async () => {
    vi.useFakeTimers();
    const ports: Array<{ disconnect: ReturnType<typeof vi.fn> }> = [];
    vi.stubGlobal('chrome', {
      runtime: {
        connectNative: () => {
          const port = {
            onMessage: { addListener: vi.fn() },
            onDisconnect: { addListener: vi.fn() },
            postMessage: vi.fn(),
            disconnect: vi.fn(),
          };
          ports.push(port);
          return port;
        },
      },
    });
    const { nativeBridge } = await import('./native');
    const request = { requestId: 'analysis-1', type: 'analyze' as const, payload: {
      requestId: 'selection-1',
      selectedText: 'example',
      sentence: 'This is an example.',
      contextBefore: '',
      contextAfter: '',
      translation: '',
      pageTitle: '',
      pageUrl: 'https://example.com',
      siteName: 'example.com',
      lookupOrigin: 'web' as const,
      capturedAt: '2026-09-24T00:00:00.000Z',
    } };
    let settled = false;
    const first = nativeBridge.request(request).catch((error: unknown) => {
      settled = true;
      throw error;
    });
    const rejected = expect(first).rejects.toThrow('学习分析等待 Companion 超时');
    await vi.advanceTimersByTimeAsync(45_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(75_000);
    await rejected;
    expect(ports[0]?.disconnect).toHaveBeenCalledOnce();

    const second = nativeBridge.request({ ...request, requestId: 'analysis-2' });
    expect(ports).toHaveLength(2);
    void second.catch(() => undefined);
  });
});
