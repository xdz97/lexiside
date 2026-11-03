import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer } from './audio-player';

let audio: { pause: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn>; load: ReturnType<typeof vi.fn>; removeAttribute: ReturnType<typeof vi.fn>; onended: null | (() => void); onerror: null | (() => void) };
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.stubGlobal('Audio', class { constructor() {
    audio = { pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined), load: vi.fn(), removeAttribute: vi.fn(), onended: null, onerror: null };
    return audio;
  } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('offscreen audio lifecycle', () => {
  it('releases the blob and playback when stopped or ended', async () => {
    const player = new AudioPlayer();
    await player.play(btoa('audio'));
    expect(audio.play).toHaveBeenCalledOnce();
    audio.onended!();
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
    expect(vi.getTimerCount()).toBe(0);
    player.stop();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('stops previous playback before replacing it', async () => {
    const player = new AudioPlayer();
    await player.play(btoa('first'));
    const first = audio;
    await player.play(btoa('second'));
    expect(first.pause).toHaveBeenCalledOnce();
    expect(first.onended).toBeNull();
    expect(audio.play).toHaveBeenCalledOnce();
    player.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up a rejected play promise', async () => {
    vi.stubGlobal('Audio', class { play() { return Promise.reject(new Error('codec')); } pause() {} removeAttribute() {} load() {} });
    await expect(new AudioPlayer().play(btoa('invalid'))).rejects.toThrow('codec');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
