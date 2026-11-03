export class AudioPlayer {
  private audio?: HTMLAudioElement;
  private url?: string;
  private timeout?: ReturnType<typeof setTimeout>;

  stop(): void {
    clearTimeout(this.timeout);
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.audio = undefined;
    this.url = undefined;
  }

  async play(base64: string): Promise<void> {
    this.stop();
    if (base64.length > 6 * 1024 * 1024) throw new Error('音频过大');
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    this.url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
    const audio = new Audio(this.url);
    this.audio = audio;
    audio.onended = audio.onerror = () => { if (this.audio === audio) this.stop(); };
    this.timeout = setTimeout(() => { if (this.audio === audio) this.stop(); }, 180_000);
    try { await audio.play(); } catch (error) {
      if (this.audio === audio) this.stop();
      throw error;
    }
  }
}
