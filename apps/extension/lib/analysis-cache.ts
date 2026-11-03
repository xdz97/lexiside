import type { AnalysisResult, AppSettings, SelectionContext } from '@lexiside/shared';

export interface AnalysisCacheEntry {
  key: string;
  analysis: AnalysisResult;
  createdAt: string;
}

export function modelAnalysisContext(
  context: SelectionContext,
  settings: Pick<AppSettings, 'contextRange' | 'sharePageMetadata'>,
): SelectionContext {
  return {
    ...context,
    selectedText: context.sentence,
    contextBefore: settings.contextRange === 'adjacent' ? context.contextBefore : '',
    contextAfter: settings.contextRange === 'adjacent' ? context.contextAfter : '',
    pageTitle: settings.sharePageMetadata ? context.pageTitle : '',
    siteName: settings.sharePageMetadata ? context.siteName : '',
  };
}

export function analysisCacheMaterial(context: SelectionContext): string {
  // These are exactly the fields used to build the DeepSeek analysis prompt.
  // Request metadata, the selected span, and its translation are not sent to the model.
  return JSON.stringify([
    context.sentence,
    context.contextBefore,
    context.contextAfter,
    context.pageTitle,
    context.siteName,
  ]);
}

export function putFifo(
  entries: AnalysisCacheEntry[],
  entry: AnalysisCacheEntry,
  limit: number,
): AnalysisCacheEntry[] {
  if (limit <= 0) return [];
  if (entries.some((current) => current.key === entry.key)) return entries.slice(-limit);
  return [...entries, entry].slice(-limit);
}

export function resizeFifo(entries: AnalysisCacheEntry[], limit: number): AnalysisCacheEntry[] {
  return limit <= 0 ? [] : entries.slice(-limit);
}
