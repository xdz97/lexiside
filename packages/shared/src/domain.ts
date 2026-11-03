import type {
  AnalysisResult,
  CandidatePattern,
  CandidatePhrase,
  CandidateWord,
  LearningItem,
  LearningItemType,
  Occurrence,
  SelectionContext,
} from './schemas.js';
import { ContextHistoryLimitSchema, DEFAULT_CONTEXT_HISTORY_LIMIT } from './schemas.js';

export const CONFIDENCE_THRESHOLD = 0.72;

export const normalizeLearningText = (text: string): string =>
  text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');

export const learningItemKey = (
  type: LearningItemType,
  text: string,
  partOfSpeech = '',
): string => `${type}:${normalizeLearningText(text)}:${partOfSpeech.trim().toLowerCase()}`;

export const filterAnalysis = (analysis: AnalysisResult): AnalysisResult => ({
  ...analysis,
  words: analysis.words.filter((item) => item.confidence >= CONFIDENCE_THRESHOLD).slice(0, 3),
  phrases: analysis.phrases.filter((item) => item.confidence >= CONFIDENCE_THRESHOLD).slice(0, 3),
  patterns: analysis.patterns.filter((item) => item.confidence >= CONFIDENCE_THRESHOLD).slice(0, 2),
});

export type LearningCandidate =
  | { type: 'word'; value: CandidateWord }
  | { type: 'phrase'; value: CandidatePhrase }
  | { type: 'pattern'; value: CandidatePattern };

export const analysisCandidates = (analysis: AnalysisResult): LearningCandidate[] => [
  ...analysis.words.map((value) => ({ type: 'word' as const, value })),
  ...analysis.phrases.map((value) => ({ type: 'phrase' as const, value })),
  ...analysis.patterns.map((value) => ({ type: 'pattern' as const, value })),
];

export const sameOccurrence = (
  existing: Pick<Occurrence, 'pageUrl' | 'lookupOrigin' | 'sentence'>,
  context: Pick<SelectionContext, 'pageUrl' | 'lookupOrigin' | 'sentence'>,
): boolean => existing.pageUrl === context.pageUrl
  && existing.lookupOrigin === context.lookupOrigin
  && normalizeLearningText(existing.sentence) === normalizeLearningText(context.sentence);

export const hasSavedContext = (item: LearningItem, context: SelectionContext): boolean =>
  item.occurrences.some((occurrence) => sameOccurrence(occurrence, context));

// Match only known forms. Inflections not previously saved need the analysis lemma;
// substring matching and guessed stemming would confuse unrelated words.
export const findSavedSelection = (items: LearningItem[], text: string, lemma?: string): LearningItem[] => {
  const forms = new Set([text, ...(lemma ? [lemma] : [])].map(normalizeLearningText).filter(Boolean));
  if (!forms.size) return [];
  return items.filter((item) => [item.normalizedText, item.displayText, ...item.occurrences.map((entry) => entry.selectedText)]
    .some((form) => forms.has(normalizeLearningText(form))));
};

export const findSavedCandidate = (items: LearningItem[], candidate: LearningCandidate): LearningItem | undefined => {
  const text = candidate.type === 'word' ? candidate.value.lemma : candidate.value.text;
  const partOfSpeech = candidate.type === 'word' ? candidate.value.partOfSpeech : '';
  const key = learningItemKey(candidate.type, text, partOfSpeech);
  return items.find((item) => learningItemKey(item.type, item.normalizedText, item.partOfSpeech) === key)
    ?? (candidate.type === 'word' ? items.find((item) => item.type === 'word'
      && item.normalizedText === normalizeLearningText(text)
      && (!item.partOfSpeech || !partOfSpeech)) : undefined);
};

export const previousSavedOccurrence = (item: LearningItem, context: SelectionContext): Occurrence | undefined => {
  const previous = item.occurrences.filter((entry) => !sameOccurrence(entry, context));
  return (previous.length ? previous : item.occurrences)
    .reduce<Occurrence | undefined>((latest, entry) => !latest || Date.parse(entry.capturedAt) > Date.parse(latest.capturedAt) ? entry : latest, undefined);
};

const candidateText = (candidate: LearningCandidate): string => candidate.value.text;
const candidateMeaning = (candidate: LearningCandidate): string => {
  if (candidate.type === 'pattern') return candidate.value.explanationZh;
  return candidate.value.meaningZh;
};

export const createLearningItem = (
  candidate: LearningCandidate,
  context: SelectionContext,
  ids: { itemId: string; occurrenceId: string },
): LearningItem => {
  const text = candidateText(candidate);
  const now = new Date().toISOString();
  const partOfSpeech = candidate.type === 'word' ? candidate.value.partOfSpeech : '';
  const occurrence: Occurrence = {
    id: ids.occurrenceId,
    learningItemId: ids.itemId,
    selectedText: text,
    sentence: context.sentence,
    contextBefore: context.contextBefore,
    contextAfter: context.contextAfter,
    meaningInContext:
      candidate.type === 'word'
        ? candidate.value.meaningInContext
        : candidate.type === 'phrase'
          ? candidate.value.usage
          : candidate.value.explanationZh,
    pageTitle: context.pageTitle,
    pageUrl: context.pageUrl,
    siteName: context.siteName,
    lookupOrigin: context.lookupOrigin,
    capturedAt: context.capturedAt,
  };

  return {
    id: ids.itemId,
    type: candidate.type,
    normalizedText:
      candidate.type === 'word' ? normalizeLearningText(candidate.value.lemma) : normalizeLearningText(text),
    displayText: text,
    partOfSpeech,
    phonetic: candidate.type === 'word' ? candidate.value.phonetic : '',
    meaningZh: candidateMeaning(candidate),
    definitionEn: candidate.type === 'word' ? candidate.value.definitionEn : '',
    collocations: candidate.type === 'word' ? candidate.value.collocations : [],
    usage: candidate.type === 'phrase' ? candidate.value.usage : '',
    note: '',
    status: 'new',
    createdAt: now,
    updatedAt: now,
    occurrenceCount: 1,
    occurrences: [occurrence],
  };
};

// Array order is insertion order. Reading or saving a duplicate never refreshes
// its place in the FIFO, and imported capture times do not reorder that queue.
export const retainLearningItemContexts = (item: LearningItem, limit = DEFAULT_CONTEXT_HISTORY_LIMIT): LearningItem => {
  const boundedLimit = ContextHistoryLimitSchema.parse(limit);
  if (item.occurrences.length <= boundedLimit && item.occurrenceCount === item.occurrences.length) return item;
  const occurrences = item.occurrences.slice(-boundedLimit);
  return { ...item, occurrences, occurrenceCount: occurrences.length };
};

export const mergeLearningItem = (item: LearningItem, incoming: LearningItem, limit = DEFAULT_CONTEXT_HISTORY_LIMIT): LearningItem => {
  const collocations = [...new Set([...item.collocations, ...incoming.collocations])].slice(0, 12);
  const enriched = {
    ...item,
    partOfSpeech: item.partOfSpeech || incoming.partOfSpeech,
    phonetic: item.phonetic || incoming.phonetic,
    meaningZh: item.meaningZh || incoming.meaningZh,
    definitionEn: item.definitionEn || incoming.definitionEn,
    collocations,
    usage: item.usage || incoming.usage,
  };
  const detailsChanged = enriched.partOfSpeech !== item.partOfSpeech
    || enriched.phonetic !== item.phonetic
    || enriched.meaningZh !== item.meaningZh
    || enriched.definitionEn !== item.definitionEn
    || enriched.usage !== item.usage
    || collocations.length !== item.collocations.length;
  // Deduplicate the entire incoming batch before trimming: otherwise an old
  // duplicate near the end of a backup could reinsert a just-evicted context.
  const keyOf = (entry: Occurrence) => JSON.stringify([entry.pageUrl, entry.lookupOrigin, normalizeLearningText(entry.sentence)]);
  const seen = new Set(item.occurrences.map(keyOf));
  const added = incoming.occurrences.filter((entry) => {
    const key = keyOf(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((entry) => ({ ...entry, learningItemId: item.id }));
  const occurrences = [...item.occurrences, ...added];
  return retainLearningItemContexts({
    ...enriched, occurrences, occurrenceCount: occurrences.length,
    updatedAt: detailsChanged || added.length ? new Date().toISOString() : item.updatedAt,
  }, limit);
};

export const mergeOccurrence = (item: LearningItem, occurrence: Occurrence, limit = DEFAULT_CONTEXT_HISTORY_LIMIT): LearningItem => {
  const duplicate = item.occurrences.some((existing) => sameOccurrence(existing, occurrence));
  if (duplicate) return retainLearningItemContexts(item, limit);
  const occurrences = [...item.occurrences, { ...occurrence, learningItemId: item.id }];
  return retainLearningItemContexts({
    ...item,
    occurrences,
    occurrenceCount: occurrences.length,
    updatedAt: new Date().toISOString(),
  }, limit);
};
