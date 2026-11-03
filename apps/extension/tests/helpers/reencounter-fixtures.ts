import { createLearningItem, SelectionContextSchema, type LearningCandidate } from '@lexiside/shared';

export const oldContext = SelectionContextSchema.parse({
  requestId: 'old', selectedText: 'leverage', sentence: 'We leverage existing tools.', translation: '利用',
  pageTitle: 'Earlier article', pageUrl: 'https://example.com/earlier', siteName: 'example.com', capturedAt: '2026-10-01T00:00:00.000Z',
});
export const newContext = { ...oldContext, requestId: 'new', sentence: 'They leverage their experience.',
  pageTitle: 'New article', pageUrl: 'https://example.com/new', capturedAt: '2026-11-02T00:00:00.000Z' };
export const savedCandidate: LearningCandidate = { type: 'word', value: {
  text: 'leverage', lemma: 'leverage', partOfSpeech: 'verb', phonetic: '', meaningZh: '利用',
  definitionEn: '', meaningInContext: '利用现有工具', collocations: [], confidence: 1,
} };
export const savedItem = createLearningItem(savedCandidate, oldContext, { itemId: 'saved', occurrenceId: 'old' });
