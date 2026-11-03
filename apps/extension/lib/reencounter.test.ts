import { describe, expect, it } from 'vitest';
import { savedContextsHtml, safeSourceUrl, selectionLemma } from './reencounter';
import { newContext, savedCandidate, savedItem } from '../tests/helpers/reencounter-fixtures';

describe('saved context web rendering', () => {
  it('escapes imported content and excludes executable source URLs', () => {
    const item = { ...savedItem, displayText: '<img src=x>', id: '" onclick="evil()', occurrences: [{
      ...savedItem.occurrences[0]!, sentence: '<script>alert(1)</script>', pageTitle: '<b>title</b>', pageUrl: 'javascript:alert(1)',
    }] };
    const html = savedContextsHtml([item], newContext);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href=');
    expect(html).toContain('data-item-id="&quot; onclick=&quot;evil()"');
    expect(safeSourceUrl('data:text/html,hi')).toBeUndefined();
    expect(safeSourceUrl('not a URL')).toBeUndefined();
    expect(safeSourceUrl('https://example.com/page')).toBe('https://example.com/page');
  });

  it('distinguishes a saved word from an already saved occurrence', () => {
    expect(savedContextsHtml([savedItem], newContext)).toContain('>保存当前语境</button>');
    expect(savedContextsHtml([savedItem], { ...newContext, ...savedItem.occurrences[0]! })).toContain('disabled>当前语境已保存');
  });

  it('uses only the lemma of the selected word, not another analysis candidate', () => {
    const word = savedCandidate.type === 'word' ? savedCandidate.value : null;
    expect(word).not.toBeNull();
    expect(selectionLemma({ context: { ...newContext, selectedText: 'leveraged' }, translationProvider: 'chrome', analysisState: 'ready', analysis: {
      translation: '', contextExplanation: '', words: [{ ...word!, text: 'leveraged' }], phrases: [], patterns: [],
    } })).toBe('leverage');
    expect(selectionLemma({ context: { ...newContext, selectedText: 'experience' }, translationProvider: 'chrome', analysisState: 'ready', analysis: {
      translation: '', contextExplanation: '', words: [word!], phrases: [], patterns: [],
    } })).toBeUndefined();
  });
});
