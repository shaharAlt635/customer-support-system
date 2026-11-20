import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Storage abstraction for attachment blobs. The local-disk driver is used by default;
 * an S3/GCS driver only needs to implement this interface.
 */
export interface FileStorage {
  /** Generate a new, unguessable storage key that keeps the original extension. */
  createKey(extension: string): string;
  /** Persist a stream and resolve with the number of bytes written. */
  save(key: string, stream: Readable): Promise<number>;
  read(key: string): Readable;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
}

export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  createKey(extension: string): string {
    const now = new Date();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${now.getUTCFullYear()}/${month}/${randomUUID()}${extension}`;
  }

  async save(key: string, stream: Readable): Promise<number> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await pipeline(stream, createWriteStream(target, { flags: 'wx' }));
    } catch (error) {
      await rm(target, { force: true });
      throw error;
    }
    return (await stat(target)).size;
  }

  read(key: string): Readable {
    return createReadStream(this.resolve(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  /** Keys are generated server-side, but guard against path traversal regardless. */
  private resolve(key: string): string {
    const target = path.resolve(this.root, key);
    if (!target.startsWith(this.root + path.sep)) {
      throw new Error(`Refusing to access a path outside the upload directory: ${key}`);
    }
    return target;
  }
}
