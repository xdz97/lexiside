import type { StorageUsage } from '@lexiside/shared';
import type { SpeechCacheStatus } from './doubao-voices';

export async function getStorageUsage(audio: SpeechCacheStatus): Promise<StorageUsage> {
  const keys = ['library', 'history', 'analysisCache'];
  const [values, totalLocal, sizes] = await Promise.all([
    chrome.storage.local.get(keys), chrome.storage.local.getBytesInUse(null),
    Promise.all(keys.map((key) => chrome.storage.local.getBytesInUse(key))),
  ]);
  const labels = ['词库', '查询历史', '学习分析缓存'];
  const categories = keys.map((key, i) => ({
    id: key, label: labels[i]!, count: Array.isArray(values[key]) ? values[key].length : 0, bytes: sizes[i]!,
  }));
  categories.splice(1, 0, { id: 'audio', label: '音频缓存', count: audio.count, bytes: audio.bytes });
  const other: StorageUsage['categories'][number] = {
    id: 'other', label: '设置及其他', count: null,
    bytes: Math.max(0, totalLocal - sizes.reduce((sum, bytes) => sum + bytes, 0)),
  };
  return { categories: [...categories, other], totalBytes: totalLocal + audio.bytes };
}
