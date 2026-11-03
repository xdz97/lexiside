import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const notFound = (error: unknown) => {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new DOMException('Test file does not exist', 'NotFoundError');
  throw error;
};

// Test adapter only. Actual writes go to the isolated on-disk directory; this
// does not emulate Chrome's native permission picker or handle serialization.
export class DiskBackupDirectory {
  readonly name: string;
  constructor(readonly path: string) { this.name = basename(path); }
  async queryPermission(): Promise<PermissionState> { return 'granted'; }
  asHandle(): FileSystemDirectoryHandle { return this as unknown as FileSystemDirectoryHandle; }
  private child(name: string): string {
    if (!name || name === '.' || name === '..' || /[/\\]/.test(name)) throw new Error('Invalid test file name');
    return join(this.path, name);
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    const path = this.child(name);
    if (options?.create) {
      try { await writeFile(path, '', { flag: 'wx' }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    const info = await lstat(path).catch(notFound);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Expected a regular test file');
    return {
      getFile: async () => new File([await readFile(path)], name),
      createWritable: async () => {
        const temporary = join(this.path, `.${name}.${randomUUID()}.tmp`);
        return {
          write: async (contents: string | ArrayBuffer) => writeFile(temporary, typeof contents === 'string' ? contents : new Uint8Array(contents)),
          close: async () => rename(temporary, path),
          abort: async () => rm(temporary, { force: true }),
        };
      },
    };
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DiskBackupDirectory> {
    const path = this.child(name);
    if (options?.create) await mkdir(path, { recursive: true });
    const info = await lstat(path).catch(notFound);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Expected a regular test directory');
    return new DiskBackupDirectory(path);
  }
  async removeEntry(name: string): Promise<void> { await unlink(this.child(name)).catch(notFound); }
}

export async function diskChromeStorage(path: string) {
  let tail: Promise<unknown> = Promise.resolve();
  const read = async (): Promise<Record<string, unknown>> => {
    try { return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  };
  return {
    get: async (keys: string | string[] | null) => {
      await tail;
      const data = await read();
      return keys == null ? data : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, data[key]]));
    },
    set: async (values: Record<string, unknown>) => {
      const result = tail.then(async () => {
        const data = { ...await read(), ...structuredClone(values) };
        const temporary = `${path}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(data));
        await rename(temporary, path);
      });
      tail = result.catch(() => undefined);
      return result;
    },
    setAccessLevel: async () => undefined,
  };
}
