import { z } from 'zod';

export const CandidateWordSchema = z.object({
  text: z.string().min(1).max(120),
  lemma: z.string().min(1).max(120),
  partOfSpeech: z.string().max(40).default(''),
  phonetic: z.string().max(120).default(''),
  meaningZh: z.string().min(1).max(500),
  definitionEn: z.string().max(500).default(''),
  meaningInContext: z.string().max(500).default(''),
  collocations: z.array(z.string().min(1).max(160)).max(6).default([]),
  confidence: z.number().min(0).max(1),
});

export const CandidatePhraseSchema = z.object({
  text: z.string().min(1).max(240),
  meaningZh: z.string().min(1).max(500),
  usage: z.string().max(500).default(''),
  confidence: z.number().min(0).max(1),
});

export const CandidatePatternSchema = z.object({
  text: z.string().min(1).max(240),
  explanationZh: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
});

export const AnalysisResultSchema = z.object({
  translation: z.string().max(4_000).default(''),
  contextExplanation: z.string().max(1_000).default(''),
  words: z.array(CandidateWordSchema).max(3).default([]),
  phrases: z.array(CandidatePhraseSchema).max(3).default([]),
  patterns: z.array(CandidatePatternSchema).max(2).default([]),
});

export const SelectionContextSchema = z.object({
  requestId: z.string().min(1),
  selectedText: z.string().trim().min(1).max(2_000),
  sentence: z.string().trim().min(1).max(4_000),
  contextBefore: z.string().max(4_000).default(''),
  contextAfter: z.string().max(4_000).default(''),
  translation: z.string().max(4_000).default(''),
  pageTitle: z.string().max(500).default(''),
  pageUrl: z.string().url(),
  siteName: z.string().max(255).default(''),
  lookupOrigin: z.enum(['web', 'definition']).default('web'),
  capturedAt: z.string().datetime(),
});

export const LearningItemTypeSchema = z.enum(['word', 'phrase', 'pattern']);
export const LearningStatusSchema = z.enum(['new', 'learning', 'mastered']);

export const OccurrenceSchema = z.object({
  id: z.string().min(1),
  learningItemId: z.string().min(1),
  selectedText: z.string().max(2_000),
  sentence: z.string().max(4_000),
  contextBefore: z.string().max(4_000).default(''),
  contextAfter: z.string().max(4_000).default(''),
  meaningInContext: z.string().max(1_000).default(''),
  pageTitle: z.string().max(500).default(''),
  pageUrl: z.string().url(),
  siteName: z.string().max(255).default(''),
  lookupOrigin: z.enum(['web', 'definition']).default('web'),
  capturedAt: z.string().datetime(),
});

export const LearningItemSchema = z.object({
  id: z.string().min(1),
  type: LearningItemTypeSchema,
  normalizedText: z.string().min(1).max(240),
  displayText: z.string().min(1).max(240),
  partOfSpeech: z.string().max(40).default(''),
  phonetic: z.string().max(120).default(''),
  meaningZh: z.string().max(500).default(''),
  definitionEn: z.string().max(500).default(''),
  collocations: z.array(z.string().max(160)).max(12).default([]),
  usage: z.string().max(500).default(''),
  note: z.string().max(2_000).default(''),
  status: LearningStatusSchema.default('new'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  occurrenceCount: z.number().int().nonnegative(),
  occurrences: z.array(OccurrenceSchema).default([]),
});

export const LookupHistorySchema = z.object({
  id: z.string().min(1),
  selectedText: z.string().max(2_000),
  translation: z.string().max(4_000),
  sourceLanguage: z.string().default('en'),
  targetLanguage: z.string().default('zh'),
  provider: z.enum(['chrome', 'deepseek']),
  pageTitle: z.string().max(500).default(''),
  pageUrl: z.string().url(),
  createdAt: z.string().datetime(),
});

export const DEFAULT_CONTEXT_HISTORY_LIMIT = 3;
export const MAX_CONTEXT_HISTORY_LIMIT = 100;
export const ContextHistoryLimitSchema = z.number().int().min(1).max(MAX_CONTEXT_HISTORY_LIMIT).default(DEFAULT_CONTEXT_HISTORY_LIMIT);

export const AppSettingsSchema = z.object({
  doubleClickMode: z.enum(['immediate', 'button', 'off']).default('immediate'),
  phraseSelectionMode: z.enum(['button', 'immediate', 'off']).default('button'),
  sidePanelSelectionMode: z.enum(['immediate', 'button', 'off']).default('immediate'),
  underlineSaved: z.boolean().default(false),
  targetLanguage: z.literal('zh').default('zh'),
  deepseekMode: z.enum(['auto', 'manual', 'off']).default('manual'),
  analysisCacheSize: z.number().int().min(0).max(30).default(7),
  contextHistoryLimit: ContextHistoryLimitSchema,
  contextRange: z.enum(['sentence', 'adjacent']).default('sentence'),
  sharePageMetadata: z.boolean().default(false),
  ttsProvider: z.enum(['system', 'doubao']).default('system'),
  doubaoVoice: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/).default('en_female_dacey_uranus_bigtts'),
  voice: z.enum(['en-US', 'en-GB']).default('en-US'),
  voiceName: z.string().max(200).default('auto'),
  speechRate: z.union([z.literal(0.75), z.literal(1), z.literal(1.25)]).default(1),
  speechScope: z.enum(['word', 'sentence']).default('sentence'),
  voiceGenderPreference: z.enum(['auto', 'female', 'male']).default('auto'),
  historyEnabled: z.boolean().default(true),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  uiFont: z.enum(['system', 'inter']).default('system'),
  disabledSites: z.array(z.string()).default([]),
});

export const ExportBundleSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  items: z.array(LearningItemSchema),
  history: z.array(LookupHistorySchema).max(200),
  settings: AppSettingsSchema,
});

export const NativeRequestSchema = z.discriminatedUnion('type', [
  z.object({
    requestId: z.string().min(1),
    type: z.literal('ping'),
  }),
  z.object({
    requestId: z.string().min(1),
    type: z.literal('analyze'),
    payload: SelectionContextSchema,
  }),
  z.object({
    requestId: z.string().min(1),
    type: z.literal('translate'),
    payload: z.object({
      text: z.string().trim().min(1).max(2_000),
      sourceLanguage: z.literal('en').default('en'),
      targetLanguage: z.literal('zh').default('zh'),
    }),
  }),
]);

export const NativeResponseSchema = z.object({
  requestId: z.string().min(1),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

export type CandidateWord = z.infer<typeof CandidateWordSchema>;
export type CandidatePhrase = z.infer<typeof CandidatePhraseSchema>;
export type CandidatePattern = z.infer<typeof CandidatePatternSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type SelectionContext = z.infer<typeof SelectionContextSchema>;
export type LearningItemType = z.infer<typeof LearningItemTypeSchema>;
export type LearningStatus = z.infer<typeof LearningStatusSchema>;
export type Occurrence = z.infer<typeof OccurrenceSchema>;
export type LearningItem = z.infer<typeof LearningItemSchema>;
export type LookupHistory = z.infer<typeof LookupHistorySchema>;
export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type NativeRequest = z.infer<typeof NativeRequestSchema>;
export type NativeResponse = z.infer<typeof NativeResponseSchema>;
