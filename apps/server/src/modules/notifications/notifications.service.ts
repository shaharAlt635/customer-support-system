import type { NotificationType, PrismaClient } from '@prisma/client';
import type { NotificationListDTO } from '@support-desk/shared';
import type { FastifyBaseLogger } from 'fastify';
import { Errors } from '../../lib/errors';
import { toNotificationDTO } from '../../serializers';

export interface NewNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  /** Path inside the company app, e.g. `/tickets/<id>`. */
  link?: string | null;
}

const LIST_LIMIT = 30;

/** In-app notifications shown in the bell menu. */
export class NotificationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly log: FastifyBaseLogger,
  ) {}

  /**
   * Fire-and-forget from the caller's perspective: a failed notification must never fail
   * the action that triggered it (a reply, an assignment, …).
   */
  async notify(notifications: NewNotification[]): Promise<void> {
    const unique = new Map(notifications.map((n) => [`${n.userId}:${n.type}:${n.link}`, n]));
    if (unique.size === 0) return;
    try {
      await this.prisma.notification.createMany({
        data: [...unique.values()].map((n) => ({
          userId: n.userId,
          type: n.type,
          title: n.title.slice(0, 200),
          body: n.body?.slice(0, 300) ?? null,
          link: n.link ?? null,
          readAt: null,
        })),
      });
    } catch (error) {
      this.log.error({ err: error }, 'Failed to create notifications');
    }
  }

  async list(userId: string): Promise<NotificationListDTO> {
    const [notifications, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: LIST_LIMIT,
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { data: notifications.map(toNotificationDTO), unreadCount };
  }

  async markRead(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
    if (count === 0) throw Errors.notFound('Notification');
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
