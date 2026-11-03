import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSettingsSchema } from '@lexiside/shared';

const { synthesize } = vi.hoisted(() => ({ synthesize: vi.fn() }));
vi.mock('./doubao', () => ({ synthesizeDoubao: synthesize }));
let hasDocument: boolean;
let sendMessage: ReturnType<typeof vi.fn>;
let systemSpeak: ReturnType<typeof vi.fn>;
let local: Record<string, unknown>;
const settings = AppSettingsSchema.parse({ ttsProvider: 'doubao' });

beforeEach(() => {
  vi.resetModules(); synthesize.mockReset();
  hasDocument = false;
  sendMessage = vi.fn().mockResolvedValue({ ok: true, data: null });
  systemSpeak = vi.fn().mockResolvedValue(undefined);
  local = {};
  vi.stubGlobal('chrome', {
    runtime: {
      ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
      getURL: (path: string) => `chrome-extension://test/${path}`,
      getContexts: vi.fn(async () => hasDocument ? [{}] : []), sendMessage,
    },
    offscreen: { Reason: { AUDIO_PLAYBACK: 'AUDIO_PLAYBACK' }, createDocument: vi.fn(async () => { hasDocument = true; }) },
    tts: { stop: vi.fn(), speak: systemSpeak, getVoices: vi.fn().mockResolvedValue([{ voiceName: 'Ava', lang: 'en-US' }]) },
    storage: { local: {
      get: vi.fn(async (key: string) => ({ [key]: local[key] })),
      set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(local, values); }),
    } },
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('speech routing and cancellation', () => {
  it('honors stop even while settings are still loading', async () => {
    let resolveSettings!: (settings: ReturnType<typeof AppSettingsSchema.parse>) => void;
    const loading = new Promise<ReturnType<typeof AppSettingsSchema.parse>>((resolve) => { resolveSettings = resolve; });
    const { speak, stopSpeech } = await import('./speech');
    const pending = speak('old', loading);
    await stopSpeech();
    resolveSettings(settings);
    expect(await pending).toEqual({ cancelled: true });
    expect(synthesize).not.toHaveBeenCalled();
    expect(systemSpeak).not.toHaveBeenCalled();
  });

  it('plays cloud audio in an offscreen document without sending credentials', async () => {
    synthesize.mockResolvedValue(btoa('audio'));
    const { speak } = await import('./speech');
    expect(await speak('Hello.', settings)).toMatchObject({ provider: 'doubao' });
    expect(chrome.offscreen.createDocument).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith({ target: 'lexiside-audio', action: 'play', audio: btoa('audio') });
    expect(systemSpeak).not.toHaveBeenCalled();
  });

  it('falls back for ordinary speech but surfaces provider failures in preview', async () => {
    synthesize.mockRejectedValue(new Error('Key 无效'));
    const { speak } = await import('./speech');
    expect(await speak('Hello.', settings)).toMatchObject({ provider: 'system', fallbackReason: 'Key 无效' });
    expect(systemSpeak).toHaveBeenCalledOnce();
    await expect(speak('Hello.', settings, { preview: true })).rejects.toThrow('Key 无效');
    expect(systemSpeak).toHaveBeenCalledOnce();
  });

  it('also falls back when the audio player rejects playback', async () => {
    synthesize.mockResolvedValue(btoa('audio'));
    sendMessage.mockResolvedValue({ ok: false, error: '播放失败' });
    const { speak } = await import('./speech');
    expect(await speak('Hello.', settings)).toMatchObject({ provider: 'system', fallbackReason: '播放失败' });
  });

  it('uses system speech directly when selected', async () => {
    const { speak } = await import('./speech');
    expect(await speak('Hello.', { ...settings, ttsProvider: 'system' })).toMatchObject({ provider: 'system' });
    expect(synthesize).not.toHaveBeenCalled();
    expect(systemSpeak).toHaveBeenCalledWith('Hello.', expect.objectContaining({ voiceName: 'Ava' }));
  });

  it('never plays or falls back after a pending synthesis is stopped', async () => {
    let resolve!: (audio: string) => void;
    synthesize.mockImplementation(() => new Promise<string>((done) => { resolve = done; }));
    const { speak, stopSpeech } = await import('./speech');
    const pending = speak('old text', settings);
    await vi.waitFor(() => expect(synthesize).toHaveBeenCalledOnce());
    const signal = synthesize.mock.calls[0]![2] as AbortSignal;
    await stopSpeech(); resolve(btoa('audio'));
    expect(await pending).toEqual({ cancelled: true });
    expect(signal.aborted).toBe(true);
    expect(systemSpeak).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'play' }));
  });

  it('lets the latest click replace earlier work without playing stale audio', async () => {
    let resolve!: (audio: string) => void;
    synthesize.mockImplementationOnce(() => new Promise<string>((done) => { resolve = done; })).mockResolvedValueOnce(btoa('new'));
    const { speak } = await import('./speech');
    const first = speak('old', settings);
    await vi.waitFor(() => expect(synthesize).toHaveBeenCalledOnce());
    const second = await speak('new', settings);
    resolve(btoa('old'));
    expect(await first).toEqual({ cancelled: true });
    expect(second).toMatchObject({ provider: 'doubao', text: 'new' });
    expect(sendMessage.mock.calls.filter(([message]) => message.action === 'play')).toEqual([[{ target: 'lexiside-audio', action: 'play', audio: btoa('new') }]]);
  });

  it('does not start a stale fallback if stopped while system voices are loading', async () => {
    let resolveVoices!: (voices: unknown[]) => void;
    synthesize.mockRejectedValue(new Error('offline'));
    vi.mocked(chrome.tts.getVoices).mockImplementation(() => new Promise((resolve) => { resolveVoices = resolve; }) as never);
    const { speak, stopSpeech } = await import('./speech');
    const pending = speak('old', settings);
    await vi.waitFor(() => expect(chrome.tts.getVoices).toHaveBeenCalled());
    const stopped = stopSpeech();
    resolveVoices([]);
    expect(await pending).toMatchObject({ cancelled: true });
    await stopped;
    expect(systemSpeak).not.toHaveBeenCalled();
  });
});


describe('pending speech request coalescing', () => {
  it('shares one synthesis and playback for identical requests from multiple surfaces', async () => {
    let resolve!: (audio: string) => void;
    synthesize.mockImplementation(() => new Promise<string>((done) => { resolve = done; }));
    const { speak } = await import('./speech');
    const first = speak('Hello.', Promise.resolve(settings));
    await vi.waitFor(() => expect(synthesize).toHaveBeenCalledOnce());
    const second = speak('Hello.', Promise.resolve(settings));
    const third = speak('Hello.', Promise.resolve(settings));
    await Promise.resolve();
    expect((synthesize.mock.calls[0]![2] as AbortSignal).aborted).toBe(false);
    resolve(btoa('audio'));
    expect(await Promise.all([first, second, third])).toEqual([
      expect.objectContaining({ provider: 'doubao' }),
      expect.objectContaining({ provider: 'doubao' }), expect.objectContaining({ provider: 'doubao' }),
    ]);
    expect(synthesize).toHaveBeenCalledOnce();
    expect(sendMessage.mock.calls.filter(([message]) => message.action === 'play')).toHaveLength(1);
  });

  it('does not reuse a pending request when the voice or rate changes', async () => {
    let resolve!: (audio: string) => void;
    synthesize.mockImplementationOnce(() => new Promise<string>((done) => { resolve = done; })).mockResolvedValueOnce(btoa('new voice'));
    const { speak } = await import('./speech');
    const first = speak('Hello.', settings);
    await vi.waitFor(() => expect(synthesize).toHaveBeenCalledOnce());
    const result = await speak('Hello.', { ...settings, speechRate: 0.75, doubaoVoice: 'en_male_tim_uranus_bigtts' });
    resolve(btoa('old voice'));
    expect(await first).toEqual({ cancelled: true });
    expect(result).toMatchObject({ provider: 'doubao' });
    expect(synthesize).toHaveBeenCalledTimes(2);
  });

  it('clears the pending latch on failure so preview can be retried', async () => {
    synthesize.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce(btoa('retry'));
    const { speak } = await import('./speech');
    await expect(speak('Hello.', settings, { preview: true })).rejects.toThrow('temporary failure');
    expect(await speak('Hello.', settings, { preview: true })).toMatchObject({ provider: 'doubao' });
    expect(synthesize).toHaveBeenCalledTimes(2);
  });
});

describe('slow speech guidance', () => {
  it('shows at 5000 ms on the third slow request while synthesis is still pending; coalesced clicks count once', async () => {
    vi.useFakeTimers();
    const { recordSlowSpeech } = await import('./speech-wait');
    await recordSlowSpeech(); await recordSlowSpeech();
    let resolve!: (audio: string) => void;
    synthesize.mockImplementation(() => new Promise<string>((done) => { resolve = done; }));
    const { speak } = await import('./speech');
    const notify = vi.fn(); const latestNotify = vi.fn();
    const first = speak('Hello.', settings, { onSlowPreparation: notify });
    await vi.advanceTimersByTimeAsync(0);
    const duplicate = speak('Hello.', settings, { onSlowPreparation: latestNotify });
    await vi.advanceTimersByTimeAsync(4999);
    expect(latestNotify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(latestNotify).toHaveBeenCalledExactlyOnceWith({ type: 'SPEECH_WAIT_TIP', count: 3 });
    expect(notify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(6000);
    expect(latestNotify).toHaveBeenCalledOnce();
    expect(local.speechSlowWaitDaily).toMatchObject({ count: 3 });
    resolve(btoa('audio')); await Promise.all([first, duplicate]);
    expect(synthesize).toHaveBeenCalledOnce();
  });

  it('does not count fast playback, system speech, stopped work or superseded work', async () => {
    vi.useFakeTimers();
    synthesize.mockResolvedValue(btoa('audio'));
    const { speak, stopSpeech } = await import('./speech');
    const notify = vi.fn();
    await speak('fast', settings, { onSlowPreparation: notify });
    await speak('system', { ...settings, ttsProvider: 'system' }, { onSlowPreparation: notify });
    let resolve!: (audio: string) => void;
    synthesize.mockImplementationOnce(() => new Promise<string>((done) => { resolve = done; }));
    const stopped = speak('stop', settings, { onSlowPreparation: notify });
    await vi.advanceTimersByTimeAsync(4000); await stopSpeech();
    await vi.advanceTimersByTimeAsync(6000); resolve(btoa('stopped')); await stopped;
    synthesize.mockImplementationOnce(() => new Promise<string>((done) => { resolve = done; }));
    const old = speak('old', settings, { onSlowPreparation: notify });
    await vi.advanceTimersByTimeAsync(4000);
    await speak('replacement', settings, { onSlowPreparation: notify });
    await vi.advanceTimersByTimeAsync(6000); resolve(btoa('old')); await old;
    expect(notify).not.toHaveBeenCalled(); expect(local.speechSlowWaitDaily).toBeUndefined();
  });
});
