import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeWithDeepSeek, checkDeepSeek, getDeepSeekStatus, listDeepSeekModels, saveDeepSeekKey, saveDeepSeekModel, translateWithDeepSeek } from './deepseek';
import { exportBundle, importBackup } from '../entrypoints/background/storage';

let stored: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;

function streamResult(result: unknown, finish = 'stop'): Response {
  const data = JSON.stringify(result);
  const events = [
    ': keep-alive\n\n',
    `data: ${JSON.stringify({ choices: [{ delta: { content: data.slice(0, 12) }, finish_reason: null }] })}\r\n\r\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: data.slice(12) }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
  // Split every byte to exercise UTF-8 decoding and SSE boundaries.
  const bytes = new TextEncoder().encode(events);
  return new Response(new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

beforeEach(() => {
  stored = {};
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('chrome', {
    storage: { local: {
      get: async (key: string) => ({ [key]: structuredClone(stored[key]) }),
      set: async (values: Record<string, unknown>) => { Object.assign(stored, structuredClone(values)); },
      setAccessLevel: vi.fn().mockResolvedValue(undefined),
    } },
    runtime: { getPlatformInfo: vi.fn().mockResolvedValue({ os: 'mac' }) },
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('direct DeepSeek API', () => {
  it('asks for a key before making any request', async () => {
    await expect(translateWithDeepSeek('hello')).rejects.toThrow('设置 → 翻译与 AI');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the key out of status, settings and backup, including backup replacement', async () => {
    await saveDeepSeekKey('  test-private-key  ');
    expect(chrome.storage.local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    expect(await getDeepSeekStatus()).toEqual({ configured: true, model: 'deepseek-flash' });
    const backup = await exportBundle();
    expect(JSON.stringify(backup)).not.toContain('test-private-key');
    await importBackup(backup, 'replace');
    expect(stored.deepseekApiKey).toBe('test-private-key');
    await saveDeepSeekKey('');
    expect((await getDeepSeekStatus()).configured).toBe(false);
  });

  it('does not overwrite a working key with malformed input', async () => {
    await saveDeepSeekKey('test-private-key');
    await expect(saveDeepSeekKey('invalid\nkey')).rejects.toThrow('格式不正确');
    expect(stored.deepseekApiKey).toBe('test-private-key');
  });

  it('translates using authenticated streaming JSON without a native host', async () => {
    await saveDeepSeekKey('test-private-key');
    fetchMock.mockResolvedValue(streamResult({ translation: '你好，世界' }));
    expect(await translateWithDeepSeek('Hello world')).toBe('你好，世界');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer test-private-key');
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'deepseek-flash', stream: true, thinking: { type: 'disabled' }, response_format: { type: 'json_object' } });
    expect(init.body).not.toContain('test-private-key');
  });

  it('validates analysis and does not send the page URL or selection metadata', async () => {
    await saveDeepSeekKey('test-private-key');
    fetchMock.mockResolvedValue(streamResult({ translation: '这是示例。', words: [], phrases: [], patterns: [] }));
    const result = await analyzeWithDeepSeek({
      requestId: 'secret-request-id', selectedText: 'example', sentence: 'This is an example.',
      contextBefore: '', contextAfter: '', translation: '', pageTitle: '',
      pageUrl: 'https://private.example.com/secret', siteName: '', lookupOrigin: 'web', capturedAt: '2026-10-28T00:00:00.000Z',
    });
    expect(result.translation).toBe('这是示例。');
    expect(fetchMock.mock.calls[0]![1].body).not.toContain('private.example.com');
    expect(fetchMock.mock.calls[0]![1].body).not.toContain('secret-request-id');
  });

  it.each([[401, 'Key 无效'], [402, '余额不足'], [429, '过于频繁'], [503, '服务暂时不可用']])('explains HTTP %s without reflecting response bodies', async (status, message) => {
    await saveDeepSeekKey('test-private-key');
    fetchMock.mockResolvedValue(new Response('sensitive server response', { status: Number(status) }));
    await expect(translateWithDeepSeek('hello')).rejects.toThrow(String(message));
  });

  it('rejects truncated and invalid model responses', async () => {
    await saveDeepSeekKey('test-private-key');
    fetchMock.mockResolvedValueOnce(streamResult({ translation: '你好' }, 'length'));
    await expect(translateWithDeepSeek('hello')).rejects.toThrow('不完整');
    fetchMock.mockResolvedValueOnce(streamResult({ wrong: 'shape' }));
    await expect(translateWithDeepSeek('hello')).rejects.toThrow('翻译格式不正确');
    fetchMock.mockResolvedValueOnce(new Response('data: {broken}\n\n'));
    await expect(translateWithDeepSeek('hello')).rejects.toThrow('格式不正确');
  });

  it('checks model access without generating a billed completion', async () => {
    await saveDeepSeekKey('test-private-key');
    fetchMock.mockResolvedValue(Response.json({ data: [{ id: 'deepseek-flash' }] }));
    expect(await checkDeepSeek()).toEqual({ configured: true, model: 'deepseek-flash', models: ['deepseek-flash'] });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.deepseek.com/models');
    expect(fetchMock.mock.calls[0]![1].method).toBe('GET');
  });

  it('persists model changes and uses the selected model for translation', async () => {
    await saveDeepSeekKey('test-private-key');
    await saveDeepSeekModel('deepseek-v4-pro');
    expect((await getDeepSeekStatus()).model).toBe('deepseek-v4-pro');
    fetchMock.mockResolvedValue(streamResult({ translation: '你好' }));
    await translateWithDeepSeek('hello');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).model).toBe('deepseek-v4-pro');
    await expect(saveDeepSeekModel('invalid model')).rejects.toThrow('模型 ID 格式不正确');
    expect((await getDeepSeekStatus()).model).toBe('deepseek-v4-pro');
  });

  it('deduplicates available models and checks the saved model', async () => {
    await saveDeepSeekKey('test-private-key');
    await saveDeepSeekModel('deepseek-v4-pro');
    const models = { data: [{ id: 'deepseek-v4-pro' }, { id: 'deepseek-flash' }, { id: 'deepseek-flash' }] };
    fetchMock.mockImplementation(() => Promise.resolve(Response.json(models)));
    expect(await listDeepSeekModels()).toEqual(['deepseek-flash', 'deepseek-v4-pro']);
    expect((await checkDeepSeek()).model).toBe('deepseek-v4-pro');
    fetchMock.mockResolvedValueOnce(Response.json({ data: [{ id: 'deepseek-flash' }] }));
    await expect(checkDeepSeek()).rejects.toThrow('无法使用 deepseek-v4-pro');
  });

  it('times out stalled requests and stops the worker keepalive', async () => {
    vi.useFakeTimers();
    await saveDeepSeekKey('test-private-key');
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const pending = expect(translateWithDeepSeek('hello')).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(25_000);
    await pending;
    expect(chrome.runtime.getPlatformInfo).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
