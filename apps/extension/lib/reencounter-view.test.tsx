// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AppSettingsSchema, mergeOccurrence, type CurrentLookup, type RuntimeRequest } from '@lexiside/shared';
import { CurrentView } from '../entrypoints/sidepanel/views/CurrentView';
import { newContext, savedCandidate, savedItem } from '../tests/helpers/reencounter-fixtures';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('./runtime', () => ({ sendRuntime: send, runtimeErrorMessage: (error: Error) => error.message }));
let current: CurrentLookup;
const listeners = new Set<(message: unknown) => void>();
beforeEach(() => {
  send.mockReset();
  listeners.clear();
  current = { tabId: 1, context: newContext, translationProvider: 'chrome', analysisState: 'idle' };
  const event = { addListener: vi.fn(), removeListener: vi.fn() };
  vi.stubGlobal('chrome', { runtime: { onMessage: {
    addListener: (listener: (message: unknown) => void) => listeners.add(listener),
    removeListener: (listener: (message: unknown) => void) => listeners.delete(listener),
  } }, tabs: { query: async () => [{ id: 1 }], onActivated: event, onRemoved: event } });
  send.mockImplementation(async (request: RuntimeRequest) => {
    if (request.type === 'GET_CURRENT') return current;
    if (request.type === 'GET_SETTINGS') return AppSettingsSchema.parse({ deepseekMode: 'off' });
    if (request.type === 'LIST_LIBRARY') return [savedItem];
    if (request.type === 'APPEND_SAVED_CONTEXT' || request.type === 'SAVE_CANDIDATE') return mergeOccurrence(savedItem, {
      ...newContext, id: 'new-occurrence', learningItemId: savedItem.id, meaningInContext: '利用经验',
    });
    throw new Error(`Unexpected ${request.type}`);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('reencounter in the side panel', () => {
  it('shows old context without AI, confirms the new meaning and saves to the same item', async () => {
    render(<CurrentView />);
    expect(await screen.findByText('We leverage existing tools.')).toBeVisible();
    expect(screen.getByText('当时的含义：利用现有工具')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Earlier article' })).toHaveAttribute('href', 'https://example.com/earlier');
    expect(send.mock.calls.some(([request]) => request.type === 'REQUEST_ANALYSIS')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '保存当前语境' }));
    fireEvent.change(screen.getByLabelText('确认当前语境的含义'), { target: { value: '利用经验' } });
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }));
    await screen.findByText('当前语境已保存');
    expect(send).toHaveBeenCalledWith({ type: 'APPEND_SAVED_CONTEXT', itemId: savedItem.id, context: { ...newContext, translation: '利用经验' } });
    expect(screen.queryByRole('button', { name: '保存当前语境' })).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '已收藏的 leverage' })).toHaveFocus();
    expect(screen.getByText('We leverage existing tools.')).toBeVisible();
  });

  it('enables a saved candidate for a new occurrence and disables it after saving', async () => {
    current = { ...current, context: { ...newContext, selectedText: newContext.sentence }, analysisState: 'ready', analysis: {
      translation: '', contextExplanation: '', words: savedCandidate.type === 'word' ? [savedCandidate.value] : [], phrases: [], patterns: [],
    } };
    render(<CurrentView />);
    const button = await screen.findByRole('button', { name: '保存 leverage 的当前语境' });
    expect(button).toBeEnabled();
    expect(screen.getByText('We leverage existing tools.')).toBeVisible();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('button', { name: '当前语境已保存' })).toBeDisabled());
  });

  it('uses the analysis lemma to recognize a new inflection', async () => {
    current = { ...current, context: { ...newContext, selectedText: 'leveraged' }, analysisState: 'ready', analysis: {
      translation: '', contextExplanation: '', words: savedCandidate.type === 'word' ? [{ ...savedCandidate.value, text: 'leveraged' }] : [], phrases: [], patterns: [],
    } };
    render(<CurrentView />);
    expect(await screen.findByText('We leverage existing tools.')).toBeVisible();
    expect(screen.getAllByText(/你曾收藏过/)).toHaveLength(1);
  });

  it('keeps a failed append retryable and does not duplicate requests while saving', async () => {
    let reject!: (error: Error) => void;
    const original = send.getMockImplementation()!;
    send.mockImplementation((request: RuntimeRequest) => request.type === 'APPEND_SAVED_CONTEXT'
      ? new Promise((_resolve, rejectRequest) => { reject = rejectRequest; }) : original(request));
    render(<CurrentView />);
    fireEvent.click(await screen.findByRole('button', { name: '保存当前语境' }));
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }));
    expect(screen.getByRole('button', { name: '正在保存…' })).toBeDisabled();
    await act(async () => reject(new Error('磁盘不可用')));
    expect(await screen.findByRole('alert')).toHaveTextContent('磁盘不可用');
    expect(screen.getByRole('button', { name: '确认保存' })).toBeEnabled();
    expect(send.mock.calls.filter(([request]) => request.type === 'APPEND_SAVED_CONTEXT')).toHaveLength(1);
  });

  it('ignores a library response for a lookup that has already been replaced', async () => {
    let resolveOld!: (value: unknown) => void;
    const original = send.getMockImplementation()!;
    send.mockImplementation((request: RuntimeRequest) => request.type === 'LIST_LIBRARY'
      ? new Promise((resolve) => { resolveOld = resolve; }) : original(request));
    render(<CurrentView />);
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'LIST_LIBRARY' }));
    const completeOld = resolveOld;
    await act(async () => { for (const listener of listeners) listener({ type: 'CURRENT_UPDATED', current: { ...current, context: { ...newContext, requestId: 'another', selectedText: 'experience' } } }); });
    await act(async () => completeOld([savedItem]));
    expect(screen.queryByText('We leverage existing tools.')).not.toBeInTheDocument();
    await act(async () => resolveOld([]));
  });
});
