import { AudioPlayer } from '../../lib/audio-player';

const player = new AudioPlayer();
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'lexiside-audio') return false;
  if (sender.id !== chrome.runtime.id || sender.tab) return false;
  if (message.action === 'stop') {
    player.stop();
    sendResponse({ ok: true, data: null });
    return false;
  }
  if (message.action !== 'play' || typeof message.audio !== 'string') return false;
  void player.play(message.audio)
    .then(() => sendResponse({ ok: true, data: null }))
    .catch(() => sendResponse({ ok: false, error: '音频播放失败，请重试或切换系统语音。' }));
  return true;
});
