import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeRequest, RuntimeResponse } from '@lexiside/shared';

let listener: (request: RuntimeRequest, sender: chrome.runtime.MessageSender, respond: (response: RuntimeResponse) => void) => boolean;
beforeEach(async () => {
  vi.resetModules();
  const event = () => ({ addListener: vi.fn() });
  vi.stubGlobal('defineBackground', (start: () => void) => start());
  vi.stubGlobal('chrome', {
    runtime: { id: 'test', getURL: (path: string) => `chrome-extension://test/${path}`, onInstalled: event(),
      onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } },
    storage: { local: { setAccessLevel: vi.fn().mockResolvedValue(undefined) } },
    contextMenus: { onClicked: event() }, commands: { onCommand: event() },
    sidePanel: { onOpened: event(), onClosed: event() }, tabs: { onRemoved: event(), onUpdated: event() },
  });
  await import('../entrypoints/background');
});
afterEach(() => vi.unstubAllGlobals());

describe('speech configuration trust boundary', () => {
  it.each<RuntimeRequest>([
    { type: 'GET_DOUBAO_STATUS' },
    { type: 'SAVE_DOUBAO_KEY', apiKey: 'untrusted-key' },
    { type: 'PREVIEW_SPEECH', provider: 'doubao' },
    { type: 'GET_SPEECH_CACHE_STATUS' },
    { type: 'CLEAR_SPEECH_CACHE' },
    { type: 'GET_STORAGE_USAGE' }, { type: 'GET_LOCAL_BACKUP_STATUS' }, { type: 'CLAIM_RECOVERY_PROMPT' },
    { type: 'CONNECT_LOCAL_BACKUP', restore: true }, { type: 'RUN_LOCAL_BACKUP' },
    { type: 'DISCONNECT_LOCAL_BACKUP' }, { type: 'DELETE_LOCAL_BACKUP' },
  ])('rejects $type from a content script before reading credentials or invoking speech', (request) => {
    const respond = vi.fn();
    expect(listener(request, { id: 'test', url: 'https://example.com/', tab: { id: 1 } as chrome.tabs.Tab }, respond)).toBe(false);
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: expect.stringContaining('侧栏设置') }));
  });

  it('does not answer internal audio messages, leaving them to offscreen', () => {
    const respond = vi.fn();
    expect(listener({ target: 'lexiside-audio', action: 'play' } as unknown as RuntimeRequest, { id: 'test' }, respond)).toBe(false);
    expect(respond).not.toHaveBeenCalled();
  });
});
