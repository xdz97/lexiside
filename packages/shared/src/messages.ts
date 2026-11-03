import type {
  AnalysisResult,
  AppSettings,
  LearningCandidate,
  LearningItem,
  LookupHistory,
  SelectionContext,
} from './index.js';

export type AnalysisState = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

export interface CurrentLookup {
  tabId?: number;
  context: SelectionContext;
  translationProvider: 'chrome' | 'deepseek';
  analysisState: AnalysisState;
  analysis?: AnalysisResult;
  error?: string;
}

export interface TtsVoiceInfo {
  voiceName: string;
  lang: string;
  remote: boolean;
  recommended: boolean;
  gender: 'female' | 'male' | 'unknown';
}

export interface StorageUsage {
  categories: Array<{ id: string; label: string; count: number | null; bytes: number }>;
  totalBytes: number;
}

export type RuntimeRequest =
  | { type: 'RECORD_LOOKUP'; payload: CurrentLookup }
  | { type: 'GET_CURRENT'; tabId?: number }
  | { type: 'GET_SIDE_PANEL_STATE' }
  | { type: 'TRANSLATE_FALLBACK'; requestId: string; text: string }
  | { type: 'GET_DEEPSEEK_STATUS' }
  | { type: 'SAVE_DEEPSEEK_KEY'; apiKey: string }
  | { type: 'GET_DEEPSEEK_MODELS' }
  | { type: 'SAVE_DEEPSEEK_MODEL'; model: string }
  | { type: 'CHECK_DEEPSEEK' }
  | { type: 'REQUEST_ANALYSIS'; context: SelectionContext }
  | { type: 'TOGGLE_SIDE_PANEL'; context?: SelectionContext }
  | { type: 'SIDE_PANEL_READY'; windowId: number }
  | { type: 'SAVE_CANDIDATE'; candidate: LearningCandidate; context: SelectionContext }
  | { type: 'SAVE_BASIC_SELECTION'; context: SelectionContext }
  | { type: 'GET_SAVED_MATCHES'; text: string; lemma?: string }
  | { type: 'APPEND_SAVED_CONTEXT'; itemId: string; context: SelectionContext }
  | { type: 'LIST_LIBRARY'; query?: string; itemType?: 'all' | 'word' | 'phrase' | 'pattern' }
  | { type: 'DELETE_ITEM'; itemId: string }
  | { type: 'UPDATE_ITEM'; item: LearningItem }
  | { type: 'GET_SETTINGS' }
  | { type: 'UPDATE_SETTINGS'; settings: AppSettings }
  | { type: 'GET_TTS_VOICES'; lang?: 'en-US' | 'en-GB' }
  | { type: 'GET_DOUBAO_STATUS' }
  | { type: 'SAVE_DOUBAO_KEY'; apiKey: string }
  | { type: 'GET_SPEECH_CACHE_STATUS' }
  | { type: 'CLEAR_SPEECH_CACHE' }
  | { type: 'GET_STORAGE_USAGE' }
  | { type: 'GET_LOCAL_BACKUP_STATUS' }
  | { type: 'CLAIM_RECOVERY_PROMPT' }
  | { type: 'CONNECT_LOCAL_BACKUP'; restore: boolean }
  | { type: 'RUN_LOCAL_BACKUP' }
  | { type: 'DISCONNECT_LOCAL_BACKUP' }
  | { type: 'DELETE_LOCAL_BACKUP' }
  | { type: 'PREVIEW_SPEECH'; provider: 'system' | 'doubao' }
  | { type: 'SPEAK'; text: string; context?: string; scope?: 'word' | 'sentence' }
  | { type: 'STOP_SPEAKING' }
  | { type: 'EXPORT_DATA'; format: 'json' | 'csv' }
  | { type: 'IMPORT_DATA'; items: LearningItem[] }
  | { type: 'IMPORT_BACKUP'; bundle: ExportBundle; mode: 'merge' | 'replace' }
  | { type: 'CLEAR_HISTORY' }
  | { type: 'CLEAR_LIBRARY' };

export type RuntimeResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface ExportBundle {
  version: 1;
  exportedAt: string;
  items: LearningItem[];
  history: LookupHistory[];
  settings: AppSettings;
}
