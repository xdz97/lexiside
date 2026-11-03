import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearningCandidate, SelectionContext } from '@lexiside/shared';
import { addHistory, appendSavedContext, clearHistory, clearLibrary, deleteItem, exportBundle, getCachedAnalysis, getLibrary, getSettings, importBackup, importItems, putCachedAnalysis, saveCandidate, setSettings, updateItem } from './storage';

const context: SelectionContext = {
  requestId: 'test-request',
  selectedText: 'example',
  sentence: 'This is an example.',
  contextBefore: '',
  contextAfter: '',
  translation: '示例',
  pageTitle: 'Test page',
  pageUrl: 'https://example.com',
  siteName: 'example.com',
  lookupOrigin: 'web',
  capturedAt: '2026-09-24T00:00:00.000Z',
};

function candidate(text: string): LearningCandidate {
  return {
    type: 'word',
    value: {
      text,
      lemma: text,
      partOfSpeech: 'noun',
      phonetic: '',
      meaningZh: '示例',
      definitionEn: '',
      meaningInContext: '',
      collocations: [],
      confidence: 1,
    },
  };
}

describe('library writes', () => {
  beforeEach(() => {
    let stored: Record<string, unknown> = {};
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: structuredClone(stored[key]) }),
          set: async (values: Record<string, unknown>) => {
            await Promise.resolve();
            stored = { ...stored, ...structuredClone(values) };
          },
        },
      },
    });
  });

  it('persists every item when several saves arrive together', async () => {
    await Promise.all(['alpha', 'beta', 'gamma'].map((text) => saveCandidate(candidate(text), context)));
    expect((await getLibrary()).map((item) => item.displayText)).toEqual(['gamma', 'beta', 'alpha']);
  });

  it('continues processing saves after a failed edit', async () => {
    const missing = (await saveCandidate(candidate('alpha'), context));
    await expect(updateItem({ ...missing, id: 'missing' })).rejects.toThrow('词条不存在');
    await saveCandidate(candidate('beta'), context);
    expect((await getLibrary()).map((item) => item.displayText)).toEqual(['beta', 'alpha']);
  });

  it('appends confirmed context to a specific item while preserving personal edits', async () => {
    const item = await saveCandidate(candidate('example'), context);
    await updateItem({ ...item, meaningZh: '我的释义', note: '私人笔记', status: 'mastered' });
    const nextContext = { ...context, selectedText: 'examples', sentence: 'More examples follow.', translation: '多个例子' };
    const result = await appendSavedContext(item.id, nextContext);
    expect(result).toMatchObject({ id: item.id, meaningZh: '我的释义', note: '私人笔记', status: 'mastered', occurrenceCount: 2 });
    expect(result.occurrences[1]).toMatchObject({ selectedText: 'examples', meaningInContext: '多个例子', learningItemId: item.id });
    expect(result.occurrences[1]).not.toHaveProperty('requestId');
    expect((await getLibrary())).toHaveLength(1);
    expect((await appendSavedContext(item.id, nextContext)).occurrenceCount).toBe(2);
  });

  it('serializes concurrent context appends and rejects deleted items without recreating them', async () => {
    const item = await saveCandidate(candidate('example'), context);
    await Promise.all([
      appendSavedContext(item.id, { ...context, sentence: 'First new example.' }),
      appendSavedContext(item.id, { ...context, sentence: 'Second new example.' }),
      appendSavedContext(item.id, { ...context, sentence: 'First new example.' }),
    ]);
    expect((await getLibrary())[0]?.occurrenceCount).toBe(3);
    await deleteItem(item.id);
    await expect(appendSavedContext(item.id, context)).rejects.toThrow('词条不存在');
    expect(await getLibrary()).toEqual([]);
  });

  it('keeps both cache results when different analyses finish together', async () => {
    const analysis = { translation: '', contextExplanation: '', words: [], phrases: [], patterns: [] };
    const first = 'a'.repeat(32);
    const second = 'b'.repeat(32);
    await Promise.all([
      putCachedAnalysis(first, analysis, 7),
      putCachedAnalysis(second, analysis, 7),
    ]);
    expect(await getCachedAnalysis(first)).toEqual(analysis);
    expect(await getCachedAnalysis(second)).toEqual(analysis);
  });

  it('restores the exported JSON data after replacing the current data', async () => {
    await saveCandidate(candidate('resilient'), context);
    await addHistory({
      id: 'history-1', selectedText: 'resilient', translation: '有韧性的',
      sourceLanguage: 'en', targetLanguage: 'zh', provider: 'chrome',
      pageTitle: context.pageTitle, pageUrl: context.pageUrl, createdAt: context.capturedAt,
    });
    const backup = await exportBundle();
    await clearLibrary();
    await clearHistory();
    await setSettings({ ...backup.settings, theme: 'dark' });
    await putCachedAnalysis('a'.repeat(32), { translation: '', contextExplanation: '', words: [], phrases: [], patterns: [] }, 7);

    expect(await importBackup(backup, 'replace')).toBe(1);
    const restored = await exportBundle();
    expect(restored.items).toEqual(backup.items);
    expect(restored.history).toEqual(backup.history);
    expect(restored.settings).toEqual(backup.settings);
    expect(await getCachedAnalysis('a'.repeat(32))).toBeNull();
  });

  it('rejects an invalid backup before writing to storage', async () => {
    await saveCandidate(candidate('resilient'), context);
    const backup = await exportBundle();
    const write = vi.spyOn(chrome.storage.local, 'set');
    await expect(importBackup({ ...backup, version: 2 } as never, 'replace')).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
    expect(await getLibrary()).toEqual(backup.items);
  });

  it('merges a backup without replacing current settings or duplicating contexts', async () => {
    await saveCandidate(candidate('resilient'), context);
    const backup = await exportBundle();
    await setSettings({ ...backup.settings, theme: 'dark' });
    await importBackup(backup, 'merge');
    expect((await getLibrary())[0]?.occurrenceCount).toBe(1);
    expect((await getSettings()).theme).toBe('dark');
  });

  it('keeps a three-entry FIFO through both analyzed saves and direct appends', async () => {
    const item = await saveCandidate(candidate('example'), context);
    await saveCandidate(candidate('example'), { ...context, sentence: 'Second example.', pageUrl: 'https://second.example' });
    await appendSavedContext(item.id, { ...context, sentence: 'Third example.', pageUrl: 'https://third.example' });
    await saveCandidate(candidate('example'), context); // A duplicate must not move to the end.
    const result = await appendSavedContext(item.id, { ...context, sentence: 'Fourth example.', pageUrl: 'https://fourth.example' });
    expect(result.occurrences.map((entry) => entry.sentence)).toEqual(['Second example.', 'Third example.', 'Fourth example.']);
    expect(result.occurrenceCount).toBe(3);
    expect((await exportBundle()).items[0]?.occurrences).toHaveLength(3);
  });

  it('applies smaller limits immediately and larger limits do not restore evicted contexts', async () => {
    const item = await saveCandidate(candidate('example'), context);
    for (const sentence of ['Second example.', 'Third example.']) await appendSavedContext(item.id, { ...context, sentence });
    const settings = await getSettings();
    await setSettings({ ...settings, contextHistoryLimit: 1 });
    expect((await getLibrary())[0]?.occurrences.map((entry) => entry.sentence)).toEqual(['Third example.']);
    await setSettings({ ...settings, contextHistoryLimit: 5 });
    for (const sentence of ['Fourth example.', 'Fifth example.', 'Sixth example.', 'Seventh example.', 'Eighth example.']) {
      await appendSavedContext(item.id, { ...context, sentence });
    }
    const stored = (await getLibrary())[0]!;
    expect(stored.occurrenceCount).toBe(5);
    expect(stored.occurrences.map((entry) => entry.sentence)).toEqual(['Fourth example.', 'Fifth example.', 'Sixth example.', 'Seventh example.', 'Eighth example.']);
  });

  it('migrates and persists an oversized legacy library on first read without a settings field', async () => {
    const item = await saveCandidate(candidate('example'), context);
    const oversized = { ...item, occurrenceCount: 7, occurrences: Array.from({ length: 7 }, (_, i) => ({ ...item.occurrences[0]!, sentence: `Example ${i}.` })) };
    await chrome.storage.local.set({ library: [oversized], settings: { voiceName: 'auto' } });
    const result = (await getLibrary())[0]!;
    expect(result.occurrences.map((entry) => entry.sentence)).toEqual(['Example 4.', 'Example 5.', 'Example 6.']);
    expect((await chrome.storage.local.get('library')).library).toEqual([result]);
    expect((await getSettings()).contextHistoryLimit).toBe(3);
  });

  it('bounds JSON imports and merged backups using the current preference, while complete restore uses backup preferences', async () => {
    const item = await saveCandidate(candidate('example'), context);
    const backup = await exportBundle();
    const oversized = { ...item, occurrenceCount: 6, occurrences: Array.from({ length: 6 }, (_, i) => ({ ...item.occurrences[0]!, sentence: `Example ${i}.` })) };
    await setSettings({ ...backup.settings, contextHistoryLimit: 2 });
    await importItems([oversized]);
    expect((await getLibrary())[0]?.occurrences.map((entry) => entry.sentence)).toEqual(['Example 4.', 'Example 5.']);
    await clearLibrary();
    const bundle = { ...backup, items: [oversized], settings: { ...backup.settings, contextHistoryLimit: 5 } };
    await importBackup(bundle, 'merge');
    expect((await getLibrary())[0]?.occurrences).toHaveLength(2);
    expect((await getSettings()).contextHistoryLimit).toBe(2);
    await importBackup(bundle, 'replace');
    expect((await getLibrary())[0]?.occurrences.map((entry) => entry.sentence)).toEqual(['Example 1.', 'Example 2.', 'Example 3.', 'Example 4.', 'Example 5.']);
    expect((await getSettings()).contextHistoryLimit).toBe(5);
  });

  it('keeps current contexts when a stale edit form is saved after FIFO eviction', async () => {
    const stale = await saveCandidate(candidate('example'), context);
    for (const sentence of ['Second example.', 'Third example.', 'Fourth example.']) await appendSavedContext(stale.id, { ...context, sentence });
    const result = await updateItem({ ...stale, note: 'New note' });
    expect(result.note).toBe('New note');
    expect(result.occurrences.map((entry) => entry.sentence)).toEqual(['Second example.', 'Third example.', 'Fourth example.']);
  });

  it('serializes a limit change with concurrent saves, and rejects invalid limits before writing', async () => {
    const item = await saveCandidate(candidate('example'), context);
    const settings = await getSettings();
    await Promise.all([
      appendSavedContext(item.id, { ...context, sentence: 'Second example.' }),
      setSettings({ ...settings, contextHistoryLimit: 1 }),
      appendSavedContext(item.id, { ...context, sentence: 'Third example.' }),
    ]);
    expect((await getLibrary())[0]?.occurrences.map((entry) => entry.sentence)).toEqual(['Third example.']);
    const write = vi.spyOn(chrome.storage.local, 'set');
    await expect(setSettings({ ...settings, contextHistoryLimit: 0 })).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
    expect((await getSettings()).contextHistoryLimit).toBe(1);
  });

  it('does not persist a reduced preference if storage rejects the settings-and-library write', async () => {
    const item = await saveCandidate(candidate('example'), context);
    await appendSavedContext(item.id, { ...context, sentence: 'Second example.' });
    const settings = await getSettings();
    const write = vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(new Error('disk full'));
    await expect(setSettings({ ...settings, contextHistoryLimit: 1 })).rejects.toThrow('disk full');
    write.mockRestore();
    expect((await getSettings()).contextHistoryLimit).toBe(3);
    expect((await getLibrary())[0]?.occurrences).toHaveLength(2);
  });
});
