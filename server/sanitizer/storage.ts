import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fail, limits } from './policy.ts';
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function id(value: string) {
  if (!uuid.test(value)) fail('PATH_INVALID');
  return value;
}
export type Area = 'incoming' | 'working' | 'sanitized' | 'journal';
export class Store {
  readonly root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }
  static async create(parent: string) {
    const root = await fs.mkdtemp(path.join(parent, 'kitchencam-f-'));
    await fs.chmod(root, 0o700);
    for (const area of ['incoming', 'working', 'sanitized', 'journal'])
      await fs.mkdir(path.join(root, area), { mode: 0o700 });
    return new Store(root);
  }
  async directory(area?: Area) {
    // Reject symlinked ancestors as well as the final directory. Private directories
    // assume the host coordinator UID/operator is trusted; decoders have no directory mount.
    if ((await fs.realpath(this.root)) !== this.root) fail('PATH_INVALID');
    for (const folder of [this.root, ...(area ? [path.join(this.root, area)] : [])]) {
      const st = await fs.lstat(folder);
      if (
        !st.isDirectory() ||
        st.isSymbolicLink() ||
        st.uid !== process.getuid?.() ||
        (st.mode & 0o077) !== 0
      )
        fail('PATH_INVALID');
    }
    return area ? path.join(this.root, area) : this.root;
  }
  async target(area: Area, key: string) {
    return path.join(await this.directory(area), id(key));
  }
  async read(area: Area, key: string, max = limits.inputBytes) {
    const file = await fs.open(
      await this.target(area, key),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const st = await file.stat();
      if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid?.()) fail('PATH_INVALID');
      if (!st.size) fail('UNREADABLE');
      if (st.size > max) fail('IMAGE_TOO_LARGE');
      const bytes = Buffer.alloc(st.size);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== bytes.length) fail('UNREADABLE');
      return bytes;
    } finally {
      await file.close();
    }
  }
  async write(area: Area, key: string, bytes: Buffer) {
    if (
      bytes.length >
      (area === 'incoming' ? limits.inputBytes : area === 'journal' ? 16384 : limits.outputBytes)
    )
      fail('IMAGE_TOO_LARGE');
    const file = await fs.open(await this.target(area, key), 'wx', 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    // The decoder UID can read only the single mounted file; host root stays private.
    if (area === 'working') await fs.chmod(await this.target(area, key), 0o444);
    const dir = await fs.open(await this.directory(area), 'r');
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  }
  async import(bytes: Buffer) {
    const unlock = await this.lock();
    try {
      if (
        (await fs.readdir(await this.directory('incoming'))).length >= 1 ||
        (await fs.readdir(await this.directory('journal'))).length >= 16
      )
        fail('BUSY');
      const key = randomUUID();
      await this.write('incoming', key, bytes);
      return key;
    } finally {
      await unlock();
    }
  }
  async record(key: string, value: unknown) {
    const data = Buffer.from(JSON.stringify(value));
    if (data.length > 16384) fail('INTERNAL');
    const temporary = randomUUID();
    await this.write('journal', temporary, data);
    await fs.rename(await this.target('journal', temporary), await this.target('journal', key));
    const dir = await fs.open(await this.directory('journal'), 'r');
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  }
  async remove(area: Area, key: string) {
    // unlink never follows symlinks or recurses through a user-controlled directory.
    try {
      await fs.unlink(await this.target(area, key));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  async lock() {
    const target = path.join(await this.directory(), 'lock');
    // Kernel lock survives neither process death nor a closed stdin pipe. Never
    // unlink the inode: doing so would let two coordinators lock different files.
    const handle = await fs.open(
      target,
      constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    const st = await handle.stat();
    if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid?.()) {
      await handle.close();
      fail('PATH_INVALID');
    }
    const child = spawn(
      'flock',
      ['--exclusive', '--nonblock', '/proc/self/fd/3', 'sh', '-c', 'printf READY; cat >/dev/null'],
      { stdio: ['pipe', 'pipe', 'ignore', handle.fd] },
    );
    const done = new Promise<void>((resolve) => child.once('close', () => resolve()));
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('error', () => reject(new Error('BUSY')));
        child.once('close', () => reject(new Error('BUSY')));
        child.stdout!.once('data', () => resolve());
      });
    } catch {
      child.stdin!.end();
      await handle.close();
      fail('BUSY');
    }
    await handle.close();
    return async () => {
      child.stdin!.end();
      await done;
    };
  }
}
