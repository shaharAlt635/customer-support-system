import type { PrismaClient } from '@prisma/client';
import type { Readable } from 'node:stream';
import { Errors } from '../../lib/errors';
import type { FileStorage } from '../../storage/file-storage';
import type { AuthUser } from '../../types';
import { canSeeInternal, canViewTicket } from '../tickets/ticket.policy';

export interface AttachmentDownload {
  fileName: string;
  mimeType: string;
  size: number;
  stream: Readable;
}

export class AttachmentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: FileStorage,
  ) {}

  /**
   * Resolve an attachment the user is allowed to read. Missing, forbidden and internal-only
   * files all produce the same 404 so ids cannot be probed.
   */
  async openForDownload(user: AuthUser, id: string): Promise<AttachmentDownload> {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id },
      include: {
        ticket: { select: { customerId: true } },
        message: { select: { isInternal: true } },
      },
    });

    if (!attachment || !canViewTicket(user, attachment.ticket)) throw Errors.notFound('Attachment');
    if (attachment.message?.isInternal && !canSeeInternal(user)) {
      throw Errors.notFound('Attachment');
    }
    if (!(await this.storage.exists(attachment.storageKey))) {
      throw Errors.notFound('Attachment file');
    }

    return {
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      stream: this.storage.read(attachment.storageKey),
    };
  }
}
