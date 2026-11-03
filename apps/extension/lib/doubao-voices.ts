// Seed-TTS 2.0 voices. Source: https://www.volcengine.com/docs/6561/1257544
// This is a curated list, not an account-specific list of authorized voices.
export const DOUBAO_VOICES = [
  { id: 'en_female_dacey_uranus_bigtts', name: 'Dacey · 美式女声（清晰明快）' },
  { id: 'en_female_stokie_uranus_bigtts', name: 'Stokie · 美式女声（轻松自然）' },
  { id: 'en_male_tim_uranus_bigtts', name: 'Tim · 美式男声（亲切自然）' },
  { id: 'zh_female_vv_uranus_bigtts', name: 'Vivi 2.0 · 女声（中英双语）' },
] as const;

export interface DoubaoStatus { configured: boolean }

export interface SpeechCacheStatus {
  count: number;
  bytes: number;
  maxEntries: number;
  maxBytes: number;
  ttlDays: number;
  expiredCount: number;
  warning?: string;
}

export interface SpeechResult {
  provider: 'system' | 'doubao';
  voiceName: string;
  text: string;
  fallbackReason?: string;
}
