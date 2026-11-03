import { NativeResponseSchema, type NativeRequest, type NativeResponse } from '@lexiside/shared';

const HOST_NAME = 'com.lexiside.companion';
const REQUEST_TIMEOUT_MS: Record<NativeRequest['type'], number> = {
  ping: 20_000,
  translate: 75_000,
  analyze: 120_000,
};

interface PendingRequest {
  resolve: (response: NativeResponse) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

class NativeBridge {
  private port: chrome.runtime.Port | null = null;
  private pending = new Map<string, PendingRequest>();

  async request<T>(message: NativeRequest): Promise<T> {
    const port = this.ensurePort();
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.resetPort(port, new Error(message.type === 'analyze'
          ? '学习分析等待 Companion 超时，请重试。'
          : 'DeepSeek Companion 响应超时，请重试。'), true);
      }, REQUEST_TIMEOUT_MS[message.type]);
      this.pending.set(message.requestId, {
        resolve: (response) => {
          if (!response.ok) reject(new Error(response.error ?? 'DeepSeek Companion 请求失败'));
          else resolve(response.result as T);
        },
        reject,
        timeoutId,
      });
      try {
        port.postMessage(message);
      } catch (error) {
        this.resetPort(port, error instanceof Error ? error : new Error(String(error)), true);
      }
    });
  }

  private ensurePort(): chrome.runtime.Port {
    if (this.port) return this.port;
    const port = chrome.runtime.connectNative(HOST_NAME);
    port.onMessage.addListener((raw: unknown) => {
      if (this.port !== port) return;
      const parsed = NativeResponseSchema.safeParse(raw);
      if (!parsed.success) return;
      const pending = this.pending.get(parsed.data.requestId);
      if (!pending) return;
      clearTimeout(pending.timeoutId);
      this.pending.delete(parsed.data.requestId);
      pending.resolve(parsed.data);
    });
    port.onDisconnect.addListener(() => {
      if (this.port !== port) return;
      const message = chrome.runtime.lastError?.message ?? 'DeepSeek Companion 已断开';
      this.resetPort(port, new Error(message), false);
    });
    this.port = port;
    return port;
  }

  private resetPort(port: chrome.runtime.Port, error: Error, disconnect: boolean): void {
    if (this.port !== port) return;
    this.port = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
    }
    this.pending.clear();
    if (disconnect) port.disconnect();
  }
}

export const nativeBridge = new NativeBridge();
