import type { RuntimeRequest, RuntimeResponse } from '@lexiside/shared';

export async function sendRuntime<T>(request: RuntimeRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(request)) as RuntimeResponse<T> | undefined;
  if (!response) throw new Error('扩展后台没有响应');
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

export const runtimeErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

