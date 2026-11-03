// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { AppSettingsSchema, mergeOccurrence } from '@lexiside/shared';
import { savedItem } from '../tests/helpers/reencounter-fixtures';

let root: ShadowRoot;
let onMessage: (message: Record<string, unknown>) => void;
let dispose: () => void;
const send = vi.fn();

function select(text: string) {
  document.querySelector('p')!.textContent = `They ${text} their experience.`;
  const node = document.querySelector('p')!.firstChild!;
  const range = document.createRange();
  range.setStart(node, 5); range.setEnd(node, 5 + text.length);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  onMessage({ type: 'COMMAND_TRANSLATE' });
}

beforeEach(async () => {
  vi.resetModules(); send.mockReset();
  document.body.innerHTML = '<p></p>';
  const attachShadow = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
    root = attachShadow.call(this, init); return root;
  });
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(50, 150, 60, 20));
  vi.stubGlobal('defineContentScript', (definition: unknown) => definition);
  vi.stubGlobal('Translator', { create: async () => ({ translate: async () => '利用', destroy: vi.fn() }) });
  vi.stubGlobal('chrome', { runtime: { sendMessage: send, onMessage: {
    addListener: (listener: typeof onMessage) => { onMessage = listener; }, removeListener: vi.fn(),
  } } });
  send.mockImplementation(async (request) => {
    if (request.type === 'GET_SETTINGS') return { ok: true, data: AppSettingsSchema.parse({}) };
    if (request.type === 'GET_SAVED_MATCHES') return { ok: true, data: [savedItem] };
    return { ok: true, data: null };
  });
  const { default: definition } = await import('../entrypoints/content');
  await (definition as unknown as { main: (context: unknown) => Promise<void> }).main({ onInvalidated: (callback: () => void) => { dispose = callback; } });
});
afterEach(() => { dispose?.(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('reencounter in the web popup', () => {
  it('leaves a stalled local translator after 30 seconds and shows a retryable fallback error', async () => {
    vi.useFakeTimers();
    let finish!: (translator: unknown) => void;
    vi.stubGlobal('Translator', { create: () => new Promise((resolve) => { finish = resolve; }) });
    const original = send.getMockImplementation()!;
    send.mockImplementation((request) => request.type === 'TRANSLATE_FALLBACK'
      ? Promise.resolve({ ok: false, error: '请先配置 API Key' }) : original(request));
    select('leverage');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(root.textContent).toContain('请先配置 API Key');
    expect(root.querySelector('[aria-label="翻译失败"]')).not.toBeNull();
    expect(root.textContent).toContain('重试');
    finish({ translate: async () => 'late translation' });
    await vi.advanceTimersByTimeAsync(0);
    expect(root.textContent).not.toContain('late translation');
    expect(send.mock.calls.some(([request]) => request.type === 'RECORD_LOOKUP')).toBe(false);
  });

  it('shows old context and appends confirmed context instead of creating a new word', async () => {
    select('leverage');
    await waitFor(() => expect(root.textContent).toContain('We leverage existing tools.'));
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://example.com/earlier');
    fireEvent.click(root.querySelector('[data-action="append-context"]')!);
    const input = root.querySelector('input')!;
    input.value = '利用经验'; fireEvent.input(input);
    send.mockImplementation(async (request) => {
      if (request.type === 'APPEND_SAVED_CONTEXT') return { ok: true, data: savedItem };
      if (request.type === 'GET_SAVED_MATCHES') {
        const saveRequest = send.mock.calls.find(([value]) => value.type === 'APPEND_SAVED_CONTEXT')![0];
        return { ok: true, data: [mergeOccurrence(savedItem, { ...saveRequest.context, id: 'new', learningItemId: savedItem.id, meaningInContext: '利用经验' })] };
      }
      return { ok: true };
    });
    fireEvent.submit(root.querySelector('form')!);
    await waitFor(() => expect(root.textContent).toContain('当前语境已保存'));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'APPEND_SAVED_CONTEXT', itemId: 'saved', context: expect.objectContaining({ translation: '利用经验', sentence: 'They leverage their experience.' }) }));
    expect(send.mock.calls.some(([request]) => request.type === 'SAVE_BASIC_SELECTION')).toBe(false);
  });

  it('does not let a stale matching response replace a newly selected word', async () => {
    let resolveOld!: (value: unknown) => void;
    send.mockImplementation((request) => request.type === 'GET_SAVED_MATCHES'
      ? request.text === 'leverage' ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve({ ok: true, data: [] })
      : Promise.resolve({ ok: true }));
    select('leverage');
    await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
    select('experience');
    await waitFor(() => expect(root.querySelector('.lexi-original')?.textContent).toBe('experience'));
    resolveOld({ ok: true, data: [savedItem] });
    await Promise.resolve(); await Promise.resolve();
    expect(root.textContent).not.toContain('We leverage existing tools.');
  });

  it('requires choosing a word when a context-menu save matches several parts of speech', async () => {
    const original = send.getMockImplementation()!;
    send.mockImplementation((request) => request.type === 'GET_SAVED_MATCHES'
      ? Promise.resolve({ ok: true, data: [savedItem, { ...savedItem, id: 'noun', partOfSpeech: 'noun' }] }) : original(request));
    select('leverage');
    await waitFor(() => expect(root.querySelectorAll('[data-action="append-context"]')).toHaveLength(2));
    onMessage({ type: 'CONTEXT_ACTION', action: 'save', selectedText: 'leverage' });
    await waitFor(() => expect(root.textContent).toContain('请在旧语境中选择要追加的词条。'));
    expect(root.querySelector('form')).toBeNull();
    expect(send.mock.calls.some(([request]) => request.type === 'SAVE_BASIC_SELECTION' || request.type === 'APPEND_SAVED_CONTEXT')).toBe(false);
  });
});
