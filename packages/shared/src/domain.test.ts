import { describe, expect, it } from 'vitest';
import { createLearningItem, filterAnalysis, mergeLearningItem, mergeOccurrence, normalizeLearningText, type LearningCandidate } from './domain.js';
import { AppSettingsSchema, LearningItemSchema, SelectionContextSchema, type AnalysisResult, type LearningItem, type Occurrence, type SelectionContext } from './schemas.js';

it('starts with learning analysis on demand', () => {
  expect(AppSettingsSchema.parse({}).deepseekMode).toBe('manual');
});

describe('normalizeLearningText', () => {
  it('normalizes case and whitespace', () => {
    expect(normalizeLearningText('  Remain   Resilient ')).toBe('remain resilient');
  });
});

describe('filterAnalysis', () => {
  it('drops low confidence candidates and enforces limits', () => {
    const analysis: AnalysisResult = {
      translation: '',
      contextExplanation: '',
      words: Array.from({ length: 5 }, (_, index) => ({
        text: `word-${index}`,
        lemma: `word-${index}`,
        partOfSpeech: 'noun',
        phonetic: '',
        meaningZh: '词',
        definitionEn: '',
        meaningInContext: '',
        collocations: [],
        confidence: index === 0 ? 0.5 : 0.9,
      })),
      phrases: [],
      patterns: [],
    };
    expect(filterAnalysis(analysis).words).toHaveLength(3);
    expect(filterAnalysis(analysis).words[0]?.text).toBe('word-1');
  });
});

describe('mergeOccurrence', () => {
  const occurrence: Occurrence = {
    id: 'occ-1',
    learningItemId: 'item-1',
    selectedText: 'resilient',
    sentence: 'The system remained resilient.',
    contextBefore: '',
    contextAfter: '',
    meaningInContext: '',
    pageTitle: 'Article',
    pageUrl: 'https://example.com/a',
    siteName: 'example.com',
    lookupOrigin: 'web',
    capturedAt: '2026-09-22T00:00:00.000Z',
  };
  const item: LearningItem = {
    id: 'item-1',
    type: 'word',
    normalizedText: 'resilient',
    displayText: 'resilient',
    partOfSpeech: 'adjective',
    phonetic: '',
    meaningZh: '有韧性的',
    definitionEn: '',
    collocations: [],
    usage: '',
    note: '',
    status: 'new',
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
    occurrenceCount: 1,
    occurrences: [occurrence],
  };

  it('does not add the same sentence from the same URL twice', () => {
    expect(mergeOccurrence(item, { ...occurrence, id: 'occ-2' }).occurrenceCount).toBe(1);
  });

  it('adds a new context and rewrites its owner id', () => {
    const merged = mergeOccurrence(item, {
      ...occurrence,
      id: 'occ-2',
      learningItemId: 'different',
      sentence: 'A resilient team recovered quickly.',
    });
    expect(merged.occurrenceCount).toBe(2);
    expect(merged.occurrences[1]?.learningItemId).toBe('item-1');
  });

  it('keeps definition lookups distinct from identical webpage text', () => {
    const merged = mergeOccurrence(item, { ...occurrence, id: 'occ-2', lookupOrigin: 'definition' });
    expect(merged.occurrenceCount).toBe(2);
    expect(merged.occurrences[1]?.lookupOrigin).toBe('definition');
  });
});

describe('learning item details', () => {
  const context: SelectionContext = {
    requestId: 'request-1',
    selectedText: 'statement',
    sentence: 'The group issued a joint statement.',
    contextBefore: '',
    contextAfter: '',
    translation: '该组织发表了一份联合声明。',
    pageTitle: 'Article',
    pageUrl: 'https://example.com/article',
    siteName: 'example.com',
    lookupOrigin: 'web',
    capturedAt: '2026-09-22T00:00:00.000Z',
  };
  const candidate: LearningCandidate = {
    type: 'word',
    value: {
      text: 'statement',
      lemma: 'statement',
      partOfSpeech: 'noun',
      phonetic: '/ˈsteɪtmənt/',
      meaningZh: '声明；正式表态',
      definitionEn: 'an official announcement expressing a position',
      meaningInContext: '指该组织发布的正式书面声明',
      collocations: ['issue a statement', 'a joint statement'],
      confidence: 0.98,
    },
  };

  it('persists definitions, contextual meaning, and collocations', () => {
    const item = createLearningItem(candidate, context, { itemId: 'item-2', occurrenceId: 'occ-2' });
    expect(item.definitionEn).toBe('an official announcement expressing a position');
    expect(item.collocations).toEqual(['issue a statement', 'a joint statement']);
    expect(item.occurrences[0]?.meaningInContext).toBe('指该组织发布的正式书面声明');
  });

  it('enriches an existing basic item when the analyzed candidate is saved later', () => {
    const detailed = createLearningItem(candidate, context, { itemId: 'new-item', occurrenceId: 'new-occ' });
    const basic: LearningItem = {
      ...detailed,
      id: 'existing-item',
      partOfSpeech: '',
      phonetic: '',
      definitionEn: '',
      collocations: [],
      occurrences: detailed.occurrences.map((occurrence) => ({ ...occurrence, learningItemId: 'existing-item' })),
    };
    const merged = mergeLearningItem(basic, detailed);
    expect(merged.id).toBe('existing-item');
    expect(merged.partOfSpeech).toBe('noun');
    expect(merged.definitionEn).toBe(detailed.definitionEn);
    expect(merged.collocations).toEqual(detailed.collocations);
  });
});

describe('lookup source compatibility', () => {
  it('treats legacy contexts and occurrences as webpage lookups', () => {
    const legacyContext = {
      requestId: 'legacy', selectedText: 'word', sentence: 'A word.', pageUrl: 'https://example.com',
      capturedAt: '2026-09-22T00:00:00.000Z',
    };
    expect(SelectionContextSchema.parse(legacyContext).lookupOrigin).toBe('web');
    const item = createLearningItem({ type: 'word', value: {
      text: 'word', lemma: 'word', partOfSpeech: '', phonetic: '', meaningZh: '词',
      definitionEn: '', meaningInContext: '', collocations: [], confidence: 1,
    } }, SelectionContextSchema.parse(legacyContext), { itemId: 'item', occurrenceId: 'occ' });
    const legacyItem = { ...item, occurrences: item.occurrences.map(({ lookupOrigin: _ignored, ...occurrence }) => occurrence) };
    expect(LearningItemSchema.parse(legacyItem).occurrences[0]?.lookupOrigin).toBe('web');
  });
});
