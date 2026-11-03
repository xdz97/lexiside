import type { AppSettings, RuntimeResponse } from '@lexiside/shared';
import { DOUBAO_VOICES, type SpeechResult } from './doubao-voices';
import { synthesizeDoubao } from './doubao';
import { chooseVoice, speechText } from './tts';
import { recordSlowSpeech, SPEECH_WAIT_MS, type SpeechWaitTip } from './speech-wait';

const OFFSCREEN_PATH = 'offscreen.html';
let creating: Promise<void> | undefined;
let currentJob = 0;
let synthesis: AbortController | undefined;
let audioTail: Promise<unknown> = Promise.resolve();
type SpeechResponse = SpeechResult | { cancelled: true };
interface SpeechOptions {
  preview?: boolean;
  provider?: AppSettings['ttsProvider'];
  context?: string;
  scope?: AppSettings['speechScope'];
  onSlowPreparation?: (tip: SpeechWaitTip) => void;
}
let latestRequest = 0;
interface PendingSpeech { key: string; task: Promise<SpeechResponse>; notify?: SpeechOptions['onSlowPreparation'] }
let pendingSpeech: PendingSpeech | undefined;

function audioCommand<T>(operation: () => Promise<T>): Promise<T> {
  const next = audioTail.then(operation);
  audioTail = next.catch(() => undefined);
  return next;
}

async function hasAudioDocument(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

async function ensureAudioDocument(): Promise<void> {
  if (creating) return creating;
  creating = (async () => {
    if (await hasAudioDocument()) return;
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: '播放用户请求的豆包 AI 单词和原句朗读',
    });
  })();
  try { await creating; } finally { creating = undefined; }
}

async function stopAudio(): Promise<void> {
  if (!await hasAudioDocument()) return;
  // Chrome may close an idle audio document between getContexts and sendMessage.
  await chrome.runtime.sendMessage({ target: 'lexiside-audio', action: 'stop' }).catch(() => undefined);
}

export async function stopSpeech(): Promise<void> {
  ++latestRequest;
  ++currentJob;
  pendingSpeech = undefined;
  synthesis?.abort();
  synthesis = undefined;
  chrome.tts.stop();
  await audioCommand(stopAudio);
}

async function speakSystem(text: string, settings: AppSettings, job: number): Promise<SpeechResult | { cancelled: true }> {
  const voices = await chrome.tts.getVoices();
  if (job !== currentJob) return { cancelled: true };
  const selected = chooseVoice(voices, settings);
  await chrome.tts.speak(text, {
    lang: selected?.lang ?? settings.voice, voiceName: selected?.voiceName,
    rate: settings.speechRate, pitch: 1, volume: 1,
  });
  return { provider: 'system', voiceName: selected?.voiceName ?? '系统默认声线', text };
}

export async function speak(
  text: string, settingsValue: AppSettings | Promise<AppSettings>, options: SpeechOptions = {},
): Promise<SpeechResponse> {
  // Reserve intent before loading settings so STOP cannot be undone by a late read.
  const request = ++latestRequest;
  const startedAt = Date.now();
  const stored = await settingsValue;
  const settings = { ...stored, ttsProvider: options.provider ?? stored.ttsProvider };
  text = speechText(text, options.context, options.scope ?? settings.speechScope);
  if (!text) throw new Error('没有可朗读的文本');
  const key = JSON.stringify([text, settings.ttsProvider, settings.speechRate,
    settings.ttsProvider === 'doubao' ? settings.doubaoVoice : [settings.voice, settings.voiceName, settings.voiceGenderPreference],
    Boolean(options.preview)]);
  // Coalesce before aborting old work: repeated clicks must not cancel a paid
  // request and issue the same synthesis again. Share playback startup as well.
  if (pendingSpeech?.key === key) {
    if (options.onSlowPreparation) pendingSpeech.notify = options.onSlowPreparation;
    return pendingSpeech.task;
  }
  if (request !== latestRequest) return { cancelled: true };
  const pending: PendingSpeech = { key, notify: options.onSlowPreparation, task: startSpeech(text, settings, {
    ...options, onSlowPreparation: (tip) => pending.notify?.(tip),
  }, startedAt) };
  pendingSpeech = pending;
  try { return await pending.task; }
  finally { if (pendingSpeech === pending) pendingSpeech = undefined; }
}

async function startSpeech(text: string, settings: AppSettings, options: SpeechOptions, startedAt: number): Promise<SpeechResponse> {
  const job = ++currentJob;
  synthesis?.abort();
  const controller = new AbortController();
  synthesis = controller;
  chrome.tts.stop();
  let waiting = true;
  const timer = settings.ttsProvider === 'doubao' ? setTimeout(() => {
    if (!waiting || job !== currentJob) return;
    void recordSlowSpeech().then((tip) => {
      if (tip && waiting && job === currentJob) options.onSlowPreparation?.(tip);
    }).catch(() => undefined); // A failed usage counter must never interrupt playback.
  }, Math.max(0, SPEECH_WAIT_MS - (Date.now() - startedAt))) : undefined;
  try {
    await audioCommand(stopAudio);
    if (job !== currentJob) return { cancelled: true };
    if (settings.ttsProvider === 'doubao') {
      try {
        const audio = await synthesizeDoubao(text, settings, controller.signal);
        return await audioCommand(async () => {
          if (job !== currentJob) return { cancelled: true } as const;
          await ensureAudioDocument();
          if (job !== currentJob) return { cancelled: true } as const;
          const response = await chrome.runtime.sendMessage({ target: 'lexiside-audio', action: 'play', audio }) as RuntimeResponse | undefined;
          if (!response?.ok) throw new Error(response && !response.ok ? response.error : '音频播放器没有响应。');
          return { provider: 'doubao', voiceName: DOUBAO_VOICES.find((voice) => voice.id === settings.doubaoVoice)?.name ?? settings.doubaoVoice, text };
        });
      } catch (error) {
        if (job !== currentJob) return { cancelled: true };
        // Preview must surface the real provider failure, never disguise it as success.
        if (options.preview) throw error;
        const fallbackReason = error instanceof Error ? error.message : '豆包语音暂不可用';
        return await audioCommand(async () => job !== currentJob
          ? { cancelled: true } as const
          : { ...await speakSystem(text, settings, job), fallbackReason });
      }
    }
    return await audioCommand(async () => {
      if (job !== currentJob) return { cancelled: true } as const;
      return speakSystem(text, settings, job);
    });
  } finally {
    waiting = false;
    if (timer !== undefined) clearTimeout(timer);
    if (synthesis === controller) synthesis = undefined;
  }
}
