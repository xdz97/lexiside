import { afterEach, expect, it, vi } from 'vitest';
import { getStorageUsage } from './storage-usage';
afterEach(() => vi.unstubAllGlobals());
it('reports category counts and payload sizes without reading API key values', async () => {
  const get = vi.fn(async () => ({ library: [{}, {}], history: [{}], analysisCache: [{}, {}, {}] }));
  const sizes: Record<string, number> = { library: 120, history: 50, analysisCache: 80 };
  vi.stubGlobal('chrome', { storage: { local: { get, getBytesInUse: async (key: string | null) => key == null ? 300 : sizes[key] } } });
  const result = await getStorageUsage({ count: 4, bytes: 1000, expiredCount: 0, ttlDays: 30, maxEntries: 100000, maxBytes: 1024 ** 3 });
  expect(result).toEqual({ totalBytes: 1300, categories: [
    { id: 'library', label: '词库', count: 2, bytes: 120 },
    { id: 'audio', label: '音频缓存', count: 4, bytes: 1000 },
    { id: 'history', label: '查询历史', count: 1, bytes: 50 },
    { id: 'analysisCache', label: '学习分析缓存', count: 3, bytes: 80 },
    { id: 'other', label: '设置及其他', count: null, bytes: 50 },
  ] });
  expect(get).toHaveBeenCalledExactlyOnceWith(['library', 'history', 'analysisCache']);
});
