import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeRequest, SelectionContext } from '@lexiside/shared';

const context: SelectionContext = {
  requestId: 'lookup-1',
  selectedText: 'resilient',
  sentence: 'The system remained resilient.',
  contextBefore: '',
  contextAfter: '',
  translation: '有韧性的',
  pageTitle: 'Article',
  pageUrl: 'https://example.com/first',
  siteName: 'example.com',
  lookupOrigin: 'web',
  capturedAt: '2026-10-08T00:00:00.000Z',
};

describe('current lookup follows the page', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('clears a previous lookup when the same tab navigates', async () => {
    let tabUrl = context.pageUrl;
    let messageListener!: (
      request: RuntimeRequest,
      sender: { id: string; tab: { id: number; windowId: number } },
      respond: (response: unknown) => void,
    ) => boolean;
    let tabUpdatedListener!: (tabId: number, changeInfo: { url?: string; status?: string }) => void;
    const local: Record<string, unknown> = {};
    const session: Record<string, unknown> = {};
    const sendMessageToTab = vi.fn().mockResolvedValue(undefined);
    const event = () => ({ addListener: vi.fn() });

    vi.stubGlobal('defineBackground', (start: () => void) => start());
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'extension-id',
        getURL: (path: string) => `chrome-extension://extension-id/${path}`,
        onInstalled: event(),
        onMessage: { addListener: (listener: typeof messageListener) => { messageListener = listener; } },
        sendMessage: vi.fn().mockResolvedValue(undefined),
      },
      contextMenus: { onClicked: event(), removeAll: vi.fn(), create: vi.fn() },
      sidePanel: { onOpened: event(), onClosed: event(), setPanelBehavior: vi.fn() },
      commands: { onCommand: event() },
      tabs: {
        onRemoved: event(),
        onUpdated: { addListener: (listener: typeof tabUpdatedListener) => { tabUpdatedListener = listener; } },
        get: async () => ({ id: 1, url: tabUrl }),
        query: async () => [{ id: 1, url: tabUrl }],
        sendMessage: sendMessageToTab,
      },
      storage: {
        local: {
          get: async (key: string) => ({ [key]: local[key] }),
          set: async (values: Record<string, unknown>) => { Object.assign(local, values); },
        },
        session: {
          get: async (key: string) => ({ [key]: session[key] }),
          set: async (values: Record<string, unknown>) => { Object.assign(session, values); },
          remove: async (key: string) => { delete session[key]; },
        },
      },
    });
    await import('../entrypoints/background');

    const send = (request: RuntimeRequest) => new Promise<{ ok: boolean; data?: unknown }>((resolve) => {
      messageListener(request, { id: 'extension-id', tab: { id: 1, windowId: 1 } }, (response) => resolve(response as { ok: boolean; data?: unknown }));
    });
    // Content scripts have the extension ID too, but may not configure API credentials.
    expect(await send({ type: 'GET_DEEPSEEK_STATUS' })).toMatchObject({ ok: false });
    expect(await send({ type: 'SAVE_DEEPSEEK_KEY', apiKey: 'page-injected-key' })).toMatchObject({ ok: false });
    expect(await send({ type: 'CHECK_DEEPSEEK' })).toMatchObject({ ok: false });
    expect(await send({ type: 'GET_DEEPSEEK_MODELS' })).toMatchObject({ ok: false });
    expect(await send({ type: 'SAVE_DEEPSEEK_MODEL', model: 'injected-model' })).toMatchObject({ ok: false });
    expect(local.deepseekApiKey).toBeUndefined();
    await send({ type: 'RECORD_LOOKUP', payload: { context, analysisState: 'idle', translationProvider: 'chrome' } });
    expect((await send({ type: 'GET_CURRENT', tabId: 1 })).data).toMatchObject({ context });
    expect(sendMessageToTab).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'CURRENT_UPDATED' }));
    expect((await send({ type: 'GET_SIDE_PANEL_STATE' })).data).toEqual({ open: false });
    await send({ type: 'SIDE_PANEL_READY', windowId: 1 });
    expect((await send({ type: 'GET_SIDE_PANEL_STATE' })).data).toEqual({ open: true });

    tabUrl = 'https://example.com/second';
    tabUpdatedListener(1, { url: tabUrl, status: 'loading' });
    expect((await send({ type: 'GET_CURRENT', tabId: 1 })).data).toBeNull();
    expect(session['current:1']).toBeUndefined();
  });
});
