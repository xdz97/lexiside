import type { AppSettings, TtsVoiceInfo } from '@lexiside/shared';

export interface BrowserTtsVoice {
  voiceName?: string;
  lang?: string;
  remote?: boolean;
  eventTypes?: string[];
}

const NATURAL_VOICE = /\b(neural|natural|premium|enhanced|studio)\b/i;
const TRUSTED_ENGINE = /\b(google|microsoft|apple)\b/i;
const COMPACT_VOICE = /\b(compact|espeak|novelty)\b/i;
const KNOWN_MAC_VOICE = /\b(ava|daniel|jamie|karen|moira|samantha|serena|tessa)\b/i;
const FEMALE_VOICE = /\b(allison|aria|ava|emma|female|fiona|joana|karen|kathy|libby|martha|moira|nicky|samantha|serena|sonia|susan|tessa|victoria|zira)\b/i;
const MALE_VOICE = /\b(aaron|alex|arthur|brian|christopher|daniel|david|eric|fred|george|guy|lee|liam|male|mark|oliver|rishi|ryan|tom)\b/i;

type VoiceGender = TtsVoiceInfo['gender'];

function normalizedLang(lang: string | undefined): string {
  return (lang ?? '').replace('_', '-').toLowerCase();
}

export function voiceQualityScore(voice: BrowserTtsVoice, requestedLang: string): number {
  const name = voice.voiceName ?? '';
  const lang = normalizedLang(voice.lang);
  const requested = normalizedLang(requestedLang);
  if (!name || !lang.startsWith('en')) return Number.NEGATIVE_INFINITY;

  let score = lang === requested ? 200 : lang.split('-')[0] === requested.split('-')[0] ? 25 : -100;
  if (NATURAL_VOICE.test(name)) score += 90;
  if (TRUSTED_ENGINE.test(name)) score += 55;
  if (KNOWN_MAC_VOICE.test(name)) score += 35;
  if (voice.remote) score += 20;
  if (voice.eventTypes?.includes('end')) score += 5;
  if (COMPACT_VOICE.test(name)) score -= 120;
  return score;
}

export function voiceGender(voice: BrowserTtsVoice): VoiceGender {
  const name = voice.voiceName ?? '';
  if (FEMALE_VOICE.test(name)) return 'female';
  if (MALE_VOICE.test(name)) return 'male';
  return 'unknown';
}

function rankedEnglishVoices(
  voices: BrowserTtsVoice[],
  requestedLang: string,
  genderPreference: AppSettings['voiceGenderPreference'],
): BrowserTtsVoice[] {
  const requested = normalizedLang(requestedLang);
  const english = voices.filter((voice) => normalizedLang(voice.lang).startsWith('en'));
  const exactLocale = english.filter((voice) => normalizedLang(voice.lang) === requested);
  const localePool = exactLocale.length > 0 ? exactLocale : english;
  const genderPool = genderPreference === 'auto'
    ? localePool
    : localePool.filter((voice) => voiceGender(voice) === genderPreference);
  const preferred = new Set(genderPool.length > 0 ? genderPool : localePool);

  return [...english].sort((a, b) => {
    const preferredDifference = Number(preferred.has(b)) - Number(preferred.has(a));
    if (preferredDifference !== 0) return preferredDifference;
    return voiceQualityScore(b, requestedLang) - voiceQualityScore(a, requestedLang)
      || (a.voiceName ?? '').localeCompare(b.voiceName ?? '');
  });
}

export function listEnglishVoices(
  voices: BrowserTtsVoice[],
  requestedLang: string,
  genderPreference: AppSettings['voiceGenderPreference'] = 'auto',
): TtsVoiceInfo[] {
  const ranked = rankedEnglishVoices(voices, requestedLang, genderPreference)
    .filter((voice): voice is BrowserTtsVoice & { voiceName: string; lang: string } =>
      Boolean(voice.voiceName && voice.lang));
  const recommendedName = ranked[0]?.voiceName;
  return ranked.map((voice) => ({
    voiceName: voice.voiceName,
    lang: voice.lang,
    remote: Boolean(voice.remote),
    recommended: voice.voiceName === recommendedName,
    gender: voiceGender(voice),
  }));
}

export function chooseVoice(
  voices: BrowserTtsVoice[],
  settings: Pick<AppSettings, 'voice' | 'voiceName' | 'voiceGenderPreference'>,
): BrowserTtsVoice | undefined {
  const explicit = settings.voiceName === 'auto'
    ? undefined
    : voices.find((voice) => voice.voiceName === settings.voiceName);
  if (explicit) return explicit;
  return rankedEnglishVoices(voices, settings.voice, settings.voiceGenderPreference)[0];
}

export function speechText(
  text: string,
  context: string | undefined,
  scope: AppSettings['speechScope'],
): string {
  const selected = text.replace(/\s+/g, ' ').trim();
  const sentence = context?.replace(/\s+/g, ' ').trim();
  return scope === 'sentence' && sentence ? sentence : selected;
}
