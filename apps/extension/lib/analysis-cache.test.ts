import { describe, expect, it } from 'vitest';
import { analysisCacheMaterial, modelAnalysisContext, putFifo, resizeFifo, type AnalysisCacheEntry } from './analysis-cache';

const entry = (key: string): AnalysisCacheEntry => ({
  key,
  createdAt: '2026-09-22T00:00:00.000Z',
  analysis: { translation: '', contextExplanation: '', words: [], phrases: [], patterns: [] },
});

describe('analysis FIFO cache', () => {
  it('evicts the oldest item without promoting cache hits', () => {
    const initial = [entry('a'), entry('b')];
    expect(putFifo(initial, entry('a'), 2).map(({ key }) => key)).toEqual(['a', 'b']);
    expect(putFifo(initial, entry('c'), 2).map(({ key }) => key)).toEqual(['b', 'c']);
  });

  it('supports disabling and resizing the cache', () => {
    expect(resizeFifo([entry('a')], 0)).toEqual([]);
    expect(resizeFifo([entry('a'), entry('b')], 1).map(({ key }) => key)).toEqual(['b']);
  });

  it('uses the actual analysis input instead of the selected word or request metadata', () => {
    const base = {
      requestId: 'request', contextBefore: '', contextAfter: '',
      translation: '', pageTitle: '', pageUrl: 'https://example.com', siteName: '',
      lookupOrigin: 'web' as const,
      capturedAt: '2026-09-22T00:00:00.000Z',
    };
    const paragraph = { ...base, selectedText: 'They record it.', sentence: 'They record it.' };
    const word = { ...paragraph, requestId: 'another-request', selectedText: 'record', translation: '记录' };
    expect(analysisCacheMaterial(paragraph)).toBe(analysisCacheMaterial(word));
    expect(analysisCacheMaterial(paragraph))
      .not.toBe(analysisCacheMaterial({ ...word, sentence: 'A record exists.' }));
  });

  it('reuses an identical model input for a sentence and a word inside it', () => {
    const sentence = 'They record the result for future study.';
    const base = {
      requestId: 'first', selectedText: sentence, sentence,
      contextBefore: 'The experiment is complete.', contextAfter: 'The notes remain available.',
      translation: '', pageTitle: 'Study', pageUrl: 'https://example.com', siteName: 'example.com',
      lookupOrigin: 'web' as const, capturedAt: '2026-09-22T00:00:00.000Z',
    };
    const settings = { contextRange: 'adjacent' as const, sharePageMetadata: true };
    const word = { ...base, requestId: 'second', selectedText: 'record', translation: '记录' };
    expect(analysisCacheMaterial(modelAnalysisContext(base, settings)))
      .toBe(analysisCacheMaterial(modelAnalysisContext(word, settings)));

    expect(analysisCacheMaterial(modelAnalysisContext(base, settings)))
      .not.toBe(analysisCacheMaterial(modelAnalysisContext(word, { ...settings, contextRange: 'sentence' })));
  });

  it('separates inputs that change the model prompt', () => {
    const base = {
      requestId: 'request', selectedText: 'record', contextBefore: '', contextAfter: '',
      translation: '', pageTitle: '', pageUrl: 'https://example.com', siteName: '',
      lookupOrigin: 'web' as const,
      capturedAt: '2026-09-22T00:00:00.000Z',
    };
    const input = { ...base, sentence: 'They record it.' };
    for (const changed of [
      { sentence: 'A record exists.' },
      { contextBefore: 'Earlier sentence.' },
      { contextAfter: 'Later sentence.' },
      { pageTitle: 'Another page' },
      { siteName: 'another.example' },
    ]) {
      expect(analysisCacheMaterial(input)).not.toBe(analysisCacheMaterial({ ...input, ...changed }));
    }
  });
});
