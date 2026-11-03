import { describe, expect, it } from 'vitest';
import { AppSettingsSchema, ContextHistoryLimitSchema, SelectionContextSchema } from './schemas.js';
import { createLearningItem, mergeLearningItem, mergeOccurrence, retainLearningItemContexts } from './domain.js';

const context = SelectionContextSchema.parse({ requestId: 'first', selectedText: 'word', sentence: 'First word.',
  pageUrl: 'https://a.example', capturedAt: '2026-11-02T00:00:00.000Z' });
const first = createLearningItem({ type: 'phrase', value: { text: 'word', meaningZh: '词', usage: '', confidence: 1 } },
  context, { itemId: 'word', occurrenceId: 'A' });
const occurrence = (id: string) => ({ ...first.occurrences[0]!, id, pageUrl: `https://${id.toLowerCase()}.example`, sentence: `${id} word.` });

describe('context history FIFO', () => {
  it('defaults old settings to three and rejects zero, fractions and unbounded values', () => {
    expect(AppSettingsSchema.parse({}).contextHistoryLimit).toBe(3);
    for (const value of [0, -1, 1.5, 101, Infinity, NaN]) expect(ContextHistoryLimitSchema.safeParse(value).success).toBe(false);
  });

  it('keeps the latest three insertions across websites without sorting by capture time', () => {
    const second = mergeOccurrence(first, occurrence('B'));
    const third = mergeOccurrence(second, occurrence('C'));
    const duplicate = mergeOccurrence(third, { ...first.occurrences[0]!, id: 'duplicate' });
    expect(duplicate).toBe(third);
    const fourth = mergeOccurrence(duplicate, { ...occurrence('D'), capturedAt: '2020-01-01T00:00:00.000Z' });
    expect(fourth.occurrences.map((entry) => entry.id)).toEqual(['B', 'C', 'D']);
    expect(fourth.occurrenceCount).toBe(3);
    expect(third.occurrences.map((entry) => entry.id)).toEqual(['A', 'B', 'C']);
  });

  it('supports a custom limit including one and preserves metadata when shrinking', () => {
    const five = { ...first, note: 'keep me', status: 'mastered' as const, occurrenceCount: 5,
      occurrences: ['A', 'B', 'C', 'D', 'E'].map(occurrence) };
    const retained = retainLearningItemContexts(five, 2);
    expect(retained.occurrences.map((entry) => entry.id)).toEqual(['D', 'E']);
    expect(retained).toMatchObject({ note: 'keep me', status: 'mastered', occurrenceCount: 2, updatedAt: five.updatedAt });
    expect(mergeOccurrence(retained, occurrence('F'), 1).occurrences.map((entry) => entry.id)).toEqual(['F']);
    expect(retainLearningItemContexts(retained, 10).occurrences).toEqual(retained.occurrences);
  });

  it('deduplicates an import batch before evicting, so its trailing duplicates cannot reinsert old entries', () => {
    const incoming = { ...first, occurrences: ['A', 'B', 'C', 'D', 'A', 'B'].map(occurrence) };
    const result = mergeLearningItem({ ...first, occurrences: [occurrence('A')] }, incoming);
    expect(result.occurrences.map((entry) => entry.id)).toEqual(['B', 'C', 'D']);
    expect(result.occurrenceCount).toBe(3);
    expect(result.occurrences.every((entry) => entry.learningItemId === first.id)).toBe(true);
  });

  it('trims oversized legacy data even when the next save is a duplicate, and repairs its retained count', () => {
    const oversized = { ...first, occurrenceCount: 100, occurrences: ['A', 'B', 'C', 'D'].map(occurrence) };
    const result = mergeOccurrence(oversized, occurrence('D'));
    expect(result.occurrences.map((entry) => entry.id)).toEqual(['B', 'C', 'D']);
    expect(result.occurrenceCount).toBe(3);
  });
});
