const DB_NAME = 'lexiside-local-backup';
const STORE = 'settings';

async function access<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('本机备份目录配置被占用，请重新加载扩展。')); };
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('无法保存备份目录授权'));
    });
  } finally { db.close(); }
}

export async function getBackupDirectory(candidate = false): Promise<FileSystemDirectoryHandle | undefined> {
  return access('readonly', (store) => store.get(candidate ? 'candidate' : 'active'));
}
// Called directly in the side panel: Chrome runtime messages cannot serialize handles.
export async function saveBackupCandidate(handle: FileSystemDirectoryHandle): Promise<void> {
  await access('readwrite', (store) => store.put(handle, 'candidate'));
}
export async function activateBackupCandidate(): Promise<void> {
  const handle = await getBackupDirectory(true);
  if (!handle) throw new Error('请先选择备份目录');
  await access('readwrite', (store) => store.put(handle, 'active'));
  await access('readwrite', (store) => store.delete('candidate'));
}
export async function forgetBackupDirectory(): Promise<void> {
  await access('readwrite', (store) => store.clear());
}
