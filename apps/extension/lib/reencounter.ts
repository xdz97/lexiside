import { hasSavedContext, normalizeLearningText, previousSavedOccurrence, type CurrentLookup, type LearningItem, type SelectionContext } from '@lexiside/shared';

export function selectionLemma(current: CurrentLookup): string | undefined {
  const selected = normalizeLearningText(current.context.selectedText);
  return current.analysis?.words.find((word) => normalizeLearningText(word.text) === selected
    || normalizeLearningText(word.lemma) === selected)?.lemma;
}

export function safeSourceUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]!);
}

// The web popup uses a closed Shadow DOM rather than React. Keep the data and
// duplicate rules shared with the side panel, and escape all imported content.
export function savedContextsHtml(items: LearningItem[], context: SelectionContext): string {
  return items.map((item) => {
    const occurrence = previousSavedOccurrence(item, context);
    const saved = hasSavedContext(item, context);
    const source = occurrence && safeSourceUrl(occurrence.pageUrl);
    const label = occurrence?.pageTitle || occurrence?.siteName || '原网页';
    return `<aside class="lexi-reencounter" aria-label="已收藏的 ${escapeHtml(item.displayText)}">
      <p class="lexi-reencounter-title">你曾收藏过 ${escapeHtml(item.displayText)}${item.partOfSpeech ? ` · ${escapeHtml(item.partOfSpeech)}` : ''}</p>
      ${occurrence ? `<p class="lexi-reencounter-sentence" lang="en">${escapeHtml(occurrence.sentence)}</p>
      ${occurrence.meaningInContext ? `<p class="lexi-reencounter-meaning">当时的含义：${escapeHtml(occurrence.meaningInContext)}</p>` : ''}
      <p class="lexi-reencounter-source">${source ? `<a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>` : escapeHtml(label)} · ${escapeHtml(new Date(occurrence.capturedAt).toLocaleDateString())}</p>` : ''}
      <button class="lexi-retry" data-action="append-context" data-item-id="${escapeHtml(item.id)}" ${saved ? 'disabled' : ''}>${saved ? '当前语境已保存' : '保存当前语境'}</button>
    </aside>`;
  }).join('');
}
