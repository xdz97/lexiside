// A fresh Chrome profile can leave Translator.create() pending without progress.
// Bound each lookup so the existing API fallback and retry UI remain reachable.
// Keep the shared translator promise: a language pack that finishes later can
// still be used by the next lookup without starting another download.
export async function withLocalTranslationTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Chrome 本地翻译等待超时')), 30_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
