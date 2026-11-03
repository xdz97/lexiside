import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSettingsSchema } from '@lexiside/shared';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { getDoubaoStatus, saveDoubaoKey, synthesizeDoubao } from './doubao';
import { exportBundle, importBackup } from '../entrypoints/background/storage';

let stored: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;
const settings = AppSettingsSchema.parse({ ttsProvider: 'doubao', speechRate: 0.75 });
const run = (text = 'Hello world.', signal = new AbortController().signal) => synthesizeDoubao(text, settings, signal);

function audioResponse(packets: unknown[]): Response {
  const bytes = new TextEncoder().encode(packets.map((packet) => `event: 352\r\ndata: ${JSON.stringify(packet)}\r\n\r\n`).join(''));
  return new Response(new ReadableStream({ start(controller) {
    // Every byte is a separate network chunk, including UTF-8 and SSE boundaries.
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  } }));
}
const success = () => audioResponse([{ code: 0, data: btoa('first') }, { code: 0, data: btoa('second') }, { code: 20000000, data: null }]);

beforeEach(async () => {
  stored = {};
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  vi.stubGlobal('chrome', {
    storage: { local: {
      get: async (key: string) => ({ [key]: structuredClone(stored[key]) }),
      set: async (values: Record<string, unknown>) => { Object.assign(stored, structuredClone(values)); },
      setAccessLevel: vi.fn().mockResolvedValue(undefined),
    } },
    runtime: { getPlatformInfo: vi.fn().mockResolvedValue({ os: 'mac' }) },
  });
  await saveDoubaoKey('');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Doubao speech API', () => {
  it('keeps credentials private through status, export and backup replacement', async () => {
    await saveDoubaoKey('  private-test-key  ');
    expect(await getDoubaoStatus()).toEqual({ configured: true });
    expect(chrome.storage.local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    const backup = await exportBundle();
    expect(JSON.stringify(backup)).not.toContain('private-test-key');
    await importBackup(backup, 'replace');
    expect(stored.doubaoApiKey).toBe('private-test-key');
    await expect(saveDoubaoKey('bad\nkey')).rejects.toThrow('格式不正确');
    expect(stored.doubaoApiKey).toBe('private-test-key');
    await saveDoubaoKey('');
    expect(await getDoubaoStatus()).toEqual({ configured: false });
  });

  it('requires a key and rejects long text before sending a request', async () => {
    await expect(run()).rejects.toThrow('填写豆包');
    await expect(run('a'.repeat(2001))).rejects.toThrow('2000');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('joins independently padded audio chunks and sends only the requested text', async () => {
    await saveDoubaoKey('private-test-key');
    fetchMock.mockResolvedValue(success());
    expect(atob(await run())).toBe('firstsecond');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse');
    expect(init.headers['X-Api-Key']).toBe('private-test-key');
    expect(init.headers['X-Api-Resource-Id']).toBe('seed-tts-2.0');
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body)).toEqual({ user: { uid: 'lexiside' }, req_params: {
      text: 'Hello world.', speaker: settings.doubaoVoice,
      audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: -25 },
    } });
  });

  it('persists audio by voice and rate independently of API key changes', async () => {
    await saveDoubaoKey('key-one');
    fetchMock.mockImplementation(async () => success());
    await run(); await run();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await synthesizeDoubao('Hello world.', { ...settings, speechRate: 1 }, new AbortController().signal);
    await synthesizeDoubao('Hello world.', { ...settings, doubaoVoice: 'en_male_tim_uranus_bigtts' }, new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await saveDoubaoKey('key-two'); await run();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await saveDoubaoKey('');
    expect(atob(await run())).toBe('firstsecond');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reuses committed audio after the background modules restart with no key or network', async () => {
    await saveDoubaoKey('key');
    fetchMock.mockResolvedValue(success());
    await run();
    await saveDoubaoKey('');
    vi.resetModules();
    const restarted = await import('./doubao');
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(atob(await restarted.synthesizeDoubao('Hello world.', settings, new AbortController().signal))).toBe('firstsecond');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await exportBundle())).not.toContain('Zmlyc3RzZWNvbmQ=');
  });

  it.each([401, 403, 429, 503])('does not expose server bodies for HTTP %s', async (status) => {
    await saveDoubaoKey('private-test-key');
    fetchMock.mockResolvedValue(new Response('private-test-key server details', { status }));
    const error = await run().catch((reason: Error) => reason);
    expect(String(error)).toContain('豆包');
    expect(String(error)).not.toContain('private-test-key');
  });

  it('rejects provider errors, interrupted streams, empty and malformed audio', async () => {
    await saveDoubaoKey('key');
    fetchMock.mockResolvedValueOnce(audioResponse([{ code: 45000000, message: 'private details' }]));
    await expect(run()).rejects.toThrow('鉴权失败');
    fetchMock.mockResolvedValueOnce(audioResponse([{ code: 45000010, message: 'Invalid X-Api-Key' }]));
    await expect(run()).rejects.toThrow('火山语音服务的 Key');
    fetchMock.mockResolvedValueOnce(audioResponse([{ code: 0, data: btoa('partial') }]));
    await expect(run()).rejects.toThrow('传输中断');
    fetchMock.mockResolvedValueOnce(audioResponse([{ code: 20000000 }]));
    await expect(run()).rejects.toThrow('没有返回音频');
    fetchMock.mockResolvedValueOnce(audioResponse([{ code: 0, data: '!bad!' }]));
    await expect(run()).rejects.toThrow('音频无效');
    fetchMock.mockResolvedValueOnce(new Response('data: invalid\n\n'));
    await expect(run()).rejects.toThrow('格式不正确');
  });

  it('aborts network requests on stop and on timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    await saveDoubaoKey('key');
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const controller = new AbortController();
    const cancelled = run('hello', controller.signal);
    const cancelCheck = expect(cancelled).rejects.toThrow('取消或超时');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort(); await cancelCheck;
    const timedOut = expect(run()).rejects.toThrow('取消或超时');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(25_000); await timedOut;
    expect(vi.getTimerCount()).toBe(0);
  });
});


it('coalesces real provider requests across pending speech calls and replays cached audio afterward', async () => {
  await saveDoubaoKey('private-test-key');
  let finish!: (response: Response) => void;
  fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
  const playback = vi.fn(async (_message: unknown) => ({ ok: true, data: null }));
  Object.assign(chrome.runtime, {
    ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
    getURL: (path: string) => `chrome-extension://test/${path}`,
    getContexts: async () => [{}], sendMessage: playback,
  });
  Object.assign(chrome, { tts: { stop: vi.fn(), speak: vi.fn(), getVoices: async () => [] } });
  const { speak } = await import('./speech');
  const first = speak('Hello world.', Promise.resolve(settings));
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  const second = speak('Hello world.', Promise.resolve(settings));
  const third = speak('Hello world.', Promise.resolve(settings));
  await Promise.resolve();
  expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(false);
  finish(success());
  const results = await Promise.all([first, second, third]);
  expect(results).toEqual(Array.from({ length: 3 }, () => expect.objectContaining({ provider: 'doubao' })));
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(playback.mock.calls.filter(([message]) => (message as { action: string }).action === 'play')).toHaveLength(1);
  await saveDoubaoKey('');
  expect(await speak('Hello world.', settings)).toMatchObject({ provider: 'doubao' });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(playback.mock.calls.filter(([message]) => (message as { action: string }).action === 'play')).toHaveLength(2);
});
