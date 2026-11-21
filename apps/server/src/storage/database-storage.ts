import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { PrismaClient } from '@prisma/client';
import type { FileStorage } from './file-storage';

/**
 * Keeps attachments in MongoDB, for serverless hosts whose disk doesn't survive between
 * requests. Uploads are already size-limited, so buffering one file in memory is fine.
 */
export class DatabaseFileStorage implements FileStorage {
  constructor(private readonly prisma: PrismaClient) {}

  createKey(extension: string): string {
    return `${randomUUID()}${extension}`;
  }

  async save(key: string, stream: Readable): Promise<number> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
    const data = Buffer.concat(chunks);
    await this.prisma.storedFile.create({ data: { key, data, size: data.length } });
    return data.length;
  }

  read(key: string): Readable {
    const { prisma } = this;
    return Readable.from(
      (async function* () {
        const file = await prisma.storedFile.findUnique({ where: { key }, select: { data: true } });
        if (!file) throw Object.assign(new Error(`File not found: ${key}`), { code: 'ENOENT' });
        yield Buffer.from(file.data);
      })(),
    );
  }

  async exists(key: string): Promise<boolean> {
    return (await this.prisma.storedFile.count({ where: { key } })) > 0;
  }

  async remove(key: string): Promise<void> {
    await this.prisma.storedFile.deleteMany({ where: { key } });
  }
}
