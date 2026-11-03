import { z } from 'zod';
import type { AppSettings } from '@lexiside/shared';
import type { DoubaoStatus } from './doubao-voices';
import { audioToBase64, speechCache, speechCacheKey } from './speech-cache';

const KEY_STORAGE = 'doubaoApiKey';
const API_URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse';
const KeySchema = z.string().trim().max(512).refine((key) => !/\s/.test(key));
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

async function readKey(): Promise<string> {
  const stored = await chrome.storage.local.get(KEY_STORAGE);
  return KeySchema.parse(stored[KEY_STORAGE] ?? '');
}

export async function getDoubaoStatus(): Promise<DoubaoStatus> {
  return { configured: Boolean(await readKey()) };
}

export async function saveDoubaoKey(value: string): Promise<DoubaoStatus> {
  const parsed = KeySchema.safeParse(value);
  if (!parsed.success) throw new Error('豆包 API Key 格式不正确，请粘贴完整的 Key，不要包含空白字符。');
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.local.set({ [KEY_STORAGE]: parsed.data });
  return { configured: Boolean(parsed.data) };
}

function serviceError(code: number): Error {
  if (code === 401 || code === 45000010) return new Error('豆包 API Key 无效或鉴权失败，请确认使用火山语音服务的 Key，并在朗读设置中更新。');
  if (code === 402) return new Error('豆包语音余额或额度不足，请在火山引擎控制台检查。');
  if (code === 403 || code === 45000000) return new Error('豆包语音鉴权失败，请检查 Key、语音合成 2.0 服务及所选音色的权限或额度。');
  if (code === 429) return new Error('豆包语音请求过于频繁，请稍后重试。');
  if (code === 40402003) return new Error('朗读文本超过豆包语音的长度限制，请缩短后重试。');
  return new Error(`豆包语音请求失败（${code}），请检查服务、音色和账户额度后重试。`);
}

// Decode each base64 chunk independently: chunks can contain their own padding.
async function readAudio(response: Response): Promise<string> {
  if (!response.body) throw new Error('豆包语音没有返回音频。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let buffer = '';
  let size = 0;
  let finished = false;
  const consume = (line: string) => {
    if (!line.startsWith('data:')) return;
    let packet: { code?: unknown; data?: unknown };
    try { packet = JSON.parse(line.slice(5).trim()); } catch { throw new Error('豆包语音返回格式不正确。'); }
    if (packet.code !== 0 && packet.code !== 20000000) throw serviceError(typeof packet.code === 'number' ? packet.code : -1);
    if (typeof packet.data === 'string' && packet.data) {
      let bytes: string;
      try { bytes = atob(packet.data); } catch { throw new Error('豆包语音返回的音频无效。'); }
      size += bytes.length;
      if (size > MAX_AUDIO_BYTES) throw new Error('生成的音频过大，请缩短朗读文本。');
      chunks.push(bytes);
    }
    if (packet.code === 20000000) finished = true;
  };
  try {
    while (!finished) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > MAX_AUDIO_BYTES * 2) throw new Error('豆包语音响应过大。');
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        consume(buffer.slice(0, newline).replace(/\r$/, ''));
        buffer = buffer.slice(newline + 1);
        if (finished) break;
      }
      if (done) {
        if (buffer.trim()) consume(buffer.trim());
        break;
      }
    }
    if (!finished) throw new Error('豆包语音传输中断，请重新播放。');
    if (!size) throw new Error('豆包语音没有返回音频，请更换音色后重试。');
    return btoa(chunks.join(''));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function synthesizeDoubao(
  text: string,
  settings: Pick<AppSettings, 'doubaoVoice' | 'speechRate'>,
  signal: AbortSignal,
): Promise<string> {
  const normalized = z.string().trim().min(1).max(2000, '单次最多朗读 2000 个字符，请缩短选中内容。').parse(text);
  const voice = z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/).parse(settings.doubaoVoice);
  signal.throwIfAborted();
  const generation = speechCache.getGeneration();
  const cacheKey = await speechCacheKey(normalized, voice, settings.speechRate);
  const hit = await speechCache.get(cacheKey);
  signal.throwIfAborted();
  if (hit) return audioToBase64(hit);
  const apiKey = await readKey();
  if (!apiKey) throw new Error('请先在「设置 → 朗读」中填写豆包 API Key。');
  signal.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 25_000);
  // Keep the MV3 worker alive only for the duration of this request.
  const keepAlive = setInterval(() => { void chrome.runtime.getPlatformInfo().catch(() => undefined); }, 20_000);
  try {
    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': apiKey,
          'X-Api-Resource-Id': 'seed-tts-2.0',
          'X-Api-Request-Id': crypto.randomUUID(),
        },
        body: JSON.stringify({
          user: { uid: 'lexiside' },
          req_params: { text: normalized, speaker: voice, audio_params: {
            format: 'mp3', sample_rate: 24000, speech_rate: Math.round((settings.speechRate - 1) * 100),
          } },
        }),
        signal: controller.signal,
        credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      });
    } catch {
      throw new Error(controller.signal.aborted ? '豆包语音请求已取消或超时。' : '无法连接豆包语音，请检查网络后重试。');
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw serviceError(response.status);
    }
    let audio: string;
    try { audio = await readAudio(response); } catch (error) {
      if (controller.signal.aborted) throw new Error('豆包语音请求已取消或超时。');
      throw error;
    }
    signal.throwIfAborted();
    await speechCache.put(cacheKey, Uint8Array.from(atob(audio), (char) => char.charCodeAt(0)), generation);
    return audio;
  } finally {
    clearTimeout(timeout);
    clearInterval(keepAlive);
    signal.removeEventListener('abort', abort);
  }
}
