import { describe, expect, it } from 'vitest';
import { createLearningItem, findSavedCandidate, findSavedSelection, hasSavedContext, previousSavedOccurrence, type LearningCandidate } from './domain.js';
import { SelectionContextSchema } from './schemas.js';

const context = SelectionContextSchema.parse({
  requestId: 'old', selectedText: 'running', sentence: 'The service is running.',
  pageUrl: 'https://example.com/old', capturedAt: '2026-10-01T00:00:00.000Z',
});
const candidate: LearningCandidate = { type: 'word', value: {
  text: 'running', lemma: 'run', partOfSpeech: 'verb', phonetic: '', meaningZh: '运行',
  definitionEn: '', meaningInContext: '服务正在运行', collocations: [], confidence: 1,
} };
const item = createLearningItem(candidate, context, { itemId: 'run', occurrenceId: 'old' });

describe('saved context matching', () => {
  it('matches normalized known forms, but never substrings or guessed inflections', () => {
    expect(findSavedSelection([item], ' ＲＵＮ ')).toEqual([item]);
    expect(findSavedSelection([item], 'RUNNING')).toEqual([item]);
    expect(findSavedSelection([item], 'runner')).toEqual([]);
    expect(findSavedSelection([item], 'runs')).toEqual([]);
    expect(findSavedSelection([item], 'runs', 'run')).toEqual([item]);
    expect(findSavedSelection([item], '  ')).toEqual([]);
  });

  it('recognizes forms captured in earlier occurrences', () => {
    const withForm = { ...item, occurrences: [...item.occurrences, { ...item.occurrences[0]!, selectedText: 'ran' }] };
    expect(findSavedSelection([withForm], 'ran')).toEqual([withForm]);
  });

  it('matches candidates by lemma and prefers the same part of speech', () => {
    const noun = { ...item, id: 'noun', partOfSpeech: 'noun' };
    const basic = { ...item, id: 'basic', partOfSpeech: '' };
    const next: LearningCandidate = { ...candidate, value: { ...candidate.value, text: 'runs' } };
    expect(findSavedCandidate([basic, noun, item], next)).toBe(item);
    expect(findSavedCandidate([noun], next)).toBeUndefined();
    expect(findSavedCandidate([noun, basic], next)).toBe(basic);
  });

  it('uses the same context identity as persistence', () => {
    expect(hasSavedContext(item, { ...context, sentence: ' THE service IS running. ' })).toBe(true);
    expect(hasSavedContext(item, { ...context, pageUrl: 'https://example.com/new' })).toBe(false);
    expect(hasSavedContext(item, { ...context, lookupOrigin: 'definition' })).toBe(false);
  });

  it('shows the most recent different context even when imports are out of order', () => {
    const occurrences = [
      { ...item.occurrences[0]!, id: 'middle', capturedAt: '2026-10-10T00:00:00.000Z', sentence: 'The job is running.' },
      { ...item.occurrences[0]!, id: 'new', capturedAt: '2026-10-20T00:00:00.000Z', sentence: 'They are running.' },
      item.occurrences[0]!,
    ];
    const multiple = { ...item, occurrences };
    expect(previousSavedOccurrence(multiple, context)?.id).toBe('new');
    expect(previousSavedOccurrence(multiple, { ...context, sentence: 'They are running.' })?.id).toBe('middle');
    expect(previousSavedOccurrence(item, context)?.id).toBe('old');
    expect(previousSavedOccurrence({ ...item, occurrences: [] }, context)).toBeUndefined();
    expect(multiple.occurrences).toEqual(occurrences);
  });
});
