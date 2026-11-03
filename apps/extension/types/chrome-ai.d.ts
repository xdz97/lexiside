interface TranslatorAvailabilityOptions {
  sourceLanguage: string;
  targetLanguage: string;
}

interface TranslatorMonitor {
  addEventListener(
    type: 'downloadprogress',
    listener: (event: { loaded: number }) => void,
  ): void;
}

interface TranslatorInstance {
  translate(text: string, options?: { signal?: AbortSignal }): Promise<string>;
  translateStreaming(text: string, options?: { signal?: AbortSignal }): ReadableStream<string>;
  destroy(): void;
}

interface TranslatorFactory {
  availability(options: TranslatorAvailabilityOptions): Promise<'available' | 'downloadable' | 'unavailable'>;
  create(
    options: TranslatorAvailabilityOptions & {
      monitor?: (monitor: TranslatorMonitor) => void;
      signal?: AbortSignal;
    },
  ): Promise<TranslatorInstance>;
}

declare const Translator: TranslatorFactory;

