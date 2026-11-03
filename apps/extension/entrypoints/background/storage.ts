import {
  AppSettingsSchema,
  AnalysisResultSchema,
  ExportBundleSchema,
  LearningItemSchema,
  LookupHistorySchema,
  createLearningItem,
  findSavedCandidate,
  learningItemKey,
  mergeLearningItem,
  mergeOccurrence,
  retainLearningItemContexts,
  type AppSettings,
  type AnalysisResult,
  type ExportBundle,
  type LearningCandidate,
  type LearningItem,
  type LookupHistory,
  type SelectionContext,
} from '@lexiside/shared';
import { putFifo, resizeFifo, type AnalysisCacheEntry } from '../../lib/analysis-cache';

const KEYS = {
  settings: 'settings',
  library: 'library',
  history: 'history',
  analysisCache: 'analysisCache',
} as const;

let analysisCacheWriteTail: Promise<void> = Promise.resolve();

function withAnalysisCacheWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = analysisCacheWriteTail.then(operation);
  analysisCacheWriteTail = result.then(() => undefined, () => undefined);
  return result;
}

async function getAnalysisCache(): Promise<AnalysisCacheEntry[]> {
  const result = await chrome.storage.local.get(KEYS.analysisCache);
  const stored = result[KEYS.analysisCache];
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const candidate = value as Partial<AnalysisCacheEntry>;
    const analysis = AnalysisResultSchema.safeParse(candidate.analysis);
    return typeof candidate.key === 'string'
      && /^[a-f0-9]{32}$/.test(candidate.key)
      && typeof candidate.createdAt === 'string'
      && analysis.success
      ? [{ key: candidate.key, createdAt: candidate.createdAt, analysis: analysis.data }]
      : [];
  });
}

export async function getCachedAnalysis(key: string): Promise<AnalysisResult | null> {
  return (await getAnalysisCache()).find((entry) => entry.key === key)?.analysis ?? null;
}

export async function putCachedAnalysis(
  key: string,
  analysis: AnalysisResult,
  limit: number,
): Promise<void> {
  await withAnalysisCacheWrite(async () => {
    const entries = putFifo(await getAnalysisCache(), {
      key,
      analysis: AnalysisResultSchema.parse(analysis),
      createdAt: new Date().toISOString(),
    }, limit);
    await chrome.storage.local.set({ [KEYS.analysisCache]: entries });
  });
}

async function resizeAnalysisCache(limit: number): Promise<void> {
  await withAnalysisCacheWrite(async () => {
    await chrome.storage.local.set({
      [KEYS.analysisCache]: resizeFifo(await getAnalysisCache(), limit),
    });
  });
}

export async function getSettings(): Promise<AppSettings> {
  const result = await chrome.storage.local.get(KEYS.settings);
  const stored = result[KEYS.settings];
  const isLegacy = Boolean(
    stored
    && typeof stored === 'object'
    && !Array.isArray(stored)
    && !('voiceName' in stored),
  );
  const settings = AppSettingsSchema.parse(
    isLegacy ? { ...stored as object, speechScope: 'sentence' } : stored ?? {},
  );
  if (isLegacy) await chrome.storage.local.set({ [KEYS.settings]: settings });
  return settings;
}

export async function setSettings(settings: AppSettings): Promise<AppSettings> {
  const validated = AppSettingsSchema.parse(settings);
  return withLibraryWrite(async () => {
    const previous = await getSettings();
    const items = await readLibrary();
    const retained = items.map((item) => retainLearningItemContexts(item, validated.contextHistoryLimit));
    await chrome.storage.local.set({
      [KEYS.settings]: validated,
      ...(retained.some((item, index) => item !== items[index]) ? { [KEYS.library]: retained } : {}),
    });
    if (previous.analysisCacheSize !== validated.analysisCacheSize) {
      await resizeAnalysisCache(validated.analysisCacheSize);
    }
    return validated;
  });
}

async function readLibrary(): Promise<LearningItem[]> {
  const result = await chrome.storage.local.get(KEYS.library);
  const stored = result[KEYS.library];
  const raw: unknown[] = Array.isArray(stored) ? (stored as unknown[]) : [];
  return raw.flatMap((value: unknown) => {
    const parsed = LearningItemSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

// Upgrade old unbounded libraries lazily, under the same queue as all writes.
// Internal callers already holding the queue use readRetainedLibrary instead.
async function readRetainedLibrary(limit: number): Promise<LearningItem[]> {
  const items = await readLibrary();
  const retained = items.map((item) => retainLearningItemContexts(item, limit));
  if (retained.some((item, index) => item !== items[index])) await setLibrary(retained);
  return retained;
}

export async function getLibrary(): Promise<LearningItem[]> {
  return withLibraryWrite(async () => readRetainedLibrary((await getSettings()).contextHistoryLimit));
}

async function setLibrary(items: LearningItem[]): Promise<void> {
  await chrome.storage.local.set({ [KEYS.library]: items });
}

// chrome.storage.local does not serialize read-modify-write operations. Keep every
// library mutation in one queue so saves, edits, imports and clears cannot overwrite
// one another when messages arrive together.
let libraryWriteTail: Promise<void> = Promise.resolve();

function withLibraryWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = libraryWriteTail.then(operation);
  libraryWriteTail = result.then(() => undefined, () => undefined);
  return result;
}

export async function saveCandidate(
  candidate: LearningCandidate,
  context: SelectionContext,
): Promise<LearningItem> {
  return withLibraryWrite(async () => {
    const { contextHistoryLimit } = await getSettings();
    const items = await readRetainedLibrary(contextHistoryLimit);
    const created = createLearningItem(candidate, context, {
      itemId: crypto.randomUUID(),
      occurrenceId: crypto.randomUUID(),
    });
    const existing = findSavedCandidate(items, candidate);
    const index = existing ? items.indexOf(existing) : -1;
    const saved =
      index >= 0
        ? mergeLearningItem(items[index]!, created, contextHistoryLimit)
        : created;
    if (index >= 0) items[index] = saved;
    else items.unshift(saved);
    await setLibrary(items);
    return saved;
  });
}

export async function appendSavedContext(itemId: string, context: SelectionContext): Promise<LearningItem> {
  return withLibraryWrite(async () => {
    const { contextHistoryLimit } = await getSettings();
    const items = await readRetainedLibrary(contextHistoryLimit);
    const index = items.findIndex((item) => item.id === itemId);
    const item = items[index];
    if (!item) throw new Error('词条不存在，请重新查询');
    const updated = mergeOccurrence(item, {
      id: crypto.randomUUID(),
      learningItemId: item.id,
      selectedText: context.selectedText,
      sentence: context.sentence,
      contextBefore: context.contextBefore,
      contextAfter: context.contextAfter,
      meaningInContext: context.translation,
      pageTitle: context.pageTitle,
      pageUrl: context.pageUrl,
      siteName: context.siteName,
      lookupOrigin: context.lookupOrigin,
      capturedAt: context.capturedAt,
    }, contextHistoryLimit);
    if (updated !== item) {
      items[index] = updated;
      await setLibrary(items);
    }
    return updated;
  });
}

export async function updateItem(item: LearningItem): Promise<LearningItem> {
  return withLibraryWrite(async () => {
    const { contextHistoryLimit } = await getSettings();
    const parsed = LearningItemSchema.parse(item);
    const items = await readRetainedLibrary(contextHistoryLimit);
    const index = items.findIndex((current) => current.id === parsed.id);
    if (index < 0) throw new Error('词条不存在');
    // An edit dialog may hold an old snapshot. Its metadata edits must not
    // resurrect evicted contexts or discard contexts appended since it opened.
    const current = items[index]!;
    const validated = retainLearningItemContexts({ ...parsed, occurrences: current.occurrences,
      occurrenceCount: current.occurrenceCount, updatedAt: new Date().toISOString() }, contextHistoryLimit);
    items[index] = validated;
    await setLibrary(items);
    return validated;
  });
}

export async function deleteItem(itemId: string): Promise<void> {
  await withLibraryWrite(async () => {
    await setLibrary((await readRetainedLibrary((await getSettings()).contextHistoryLimit)).filter((item) => item.id !== itemId));
  });
}

export async function importItems(incoming: LearningItem[]): Promise<number> {
  return withLibraryWrite(async () => {
    const { contextHistoryLimit } = await getSettings();
    const existing = await readLibrary();
    const items = mergeItems(existing, incoming.map((item) => LearningItemSchema.parse(item)), contextHistoryLimit);
    await setLibrary(items);
    return incoming.length;
  });
}

function mergeItems(existing: LearningItem[], incoming: LearningItem[], limit: number): LearningItem[] {
  const byKey = new Map(existing.map((item) => [learningItemKey(item.type, item.normalizedText, item.partOfSpeech), item]));
  for (const item of incoming) {
    const key = learningItemKey(item.type, item.normalizedText, item.partOfSpeech);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, item);
      continue;
    }
    byKey.set(key, mergeLearningItem(current, item, limit));
  }
  return [...byKey.values()].map((item) => retainLearningItemContexts(item, limit)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function importBackup(raw: ExportBundle, mode: 'merge' | 'replace'): Promise<number> {
  if (mode !== 'merge' && mode !== 'replace') throw new Error('不支持的备份导入方式');
  const bundle = ExportBundleSchema.parse(raw);
  return withLibraryWrite(async () => {
    const settings = mode === 'replace' ? bundle.settings : await getSettings();
    const items = mode === 'replace'
      ? bundle.items.map((item) => retainLearningItemContexts(item, settings.contextHistoryLimit))
      : mergeItems(await readLibrary(), bundle.items, settings.contextHistoryLimit);
    const storedHistory = await chrome.storage.local.get(KEYS.history);
    const existingHistory = Array.isArray(storedHistory[KEYS.history])
      ? (storedHistory[KEYS.history] as unknown[]).flatMap((entry) => {
        const parsed = LookupHistorySchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      })
      : [];
    const history = mode === 'replace' ? bundle.history : [
      ...new Map([...existingHistory, ...bundle.history].map((entry) => [entry.id, entry] as const)).values(),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
    const values: Record<string, unknown> = { [KEYS.library]: items, [KEYS.history]: history };
    if (mode === 'replace') {
      values[KEYS.settings] = bundle.settings;
      values[KEYS.analysisCache] = [];
    }
    await chrome.storage.local.set(values);
    return bundle.items.length;
  });
}

export async function addHistory(entry: LookupHistory): Promise<void> {
  const settings = await getSettings();
  if (!settings.historyEnabled) return;
  const result = await chrome.storage.local.get(KEYS.history);
  const history = Array.isArray(result[KEYS.history]) ? (result[KEYS.history] as LookupHistory[]) : [];
  await chrome.storage.local.set({ [KEYS.history]: [entry, ...history].slice(0, 200) });
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.set({ [KEYS.history]: [] });
}

export async function clearLibrary(): Promise<void> {
  await withLibraryWrite(() => setLibrary([]));
}

export async function exportBundle(): Promise<ExportBundle> {
  return withLibraryWrite(async () => {
    const settings = await getSettings();
    const result = await chrome.storage.local.get(KEYS.history);
    const history = Array.isArray(result[KEYS.history])
      ? (result[KEYS.history] as unknown[]).flatMap((entry) => {
        const parsed = LookupHistorySchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      })
      : [];
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      items: await readRetainedLibrary(settings.contextHistoryLimit),
      history: history.slice(0, 200),
      settings,
    };
  });
}

export function bundleToCsv(bundle: ExportBundle): string {
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [
    ['type', 'text', 'meaningZh', 'definitionEn', 'collocations', 'usage', 'partOfSpeech', 'status', 'note', 'occurrenceCount', 'sources'],
    ...bundle.items.map((item) => [
      item.type,
      item.displayText,
      item.meaningZh,
      item.definitionEn,
      item.collocations.join(' | '),
      item.usage,
      item.partOfSpeech,
      item.status,
      item.note,
      item.occurrenceCount,
      item.occurrences.map((entry) => entry.pageUrl).join(' | '),
    ]),
  ];
  return rows.map((row) => row.map(quote).join(',')).join('\n');
}
