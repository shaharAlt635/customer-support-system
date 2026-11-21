import type { NotificationDTO, NotificationType } from '@support-desk/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AtSign,
  Bell,
  CheckCheck,
  Lock,
  type LucideIcon,
  MessageSquare,
  UserPlus,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { notificationsApi } from '../../api/endpoints';
import { queryKeys, useNotifications } from '../../api/queries';
import { useCompanyPath } from '../../company/company-context';
import { cn } from '../../lib/cn';
import { formatRelative } from '../../lib/format';

const ICONS: Record<NotificationType, LucideIcon> = {
  INVITATION: UserPlus,
  TICKET_ASSIGNED: AtSign,
  TICKET_REPLY: MessageSquare,
  TICKET_NOTE: Lock,
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const companyPath = useCompanyPath();
  const queryClient = useQueryClient();
  const { data } = useNotifications();
  const unread = data?.unreadCount ?? 0;

  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
  const markRead = useMutation({ mutationFn: notificationsApi.markRead, onSuccess: refresh });
  const markAll = useMutation({ mutationFn: notificationsApi.markAllRead, onSuccess: refresh });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const openNotification = (notification: NotificationDTO) => {
    if (!notification.readAt) markRead.mutate(notification.id);
    setOpen(false);
    if (notification.link) navigate(companyPath(notification.link));
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative flex size-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
      >
        <Bell className="size-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] leading-4 font-semibold text-white ring-2 ring-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markAll.mutate()}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-800"
              >
                <CheckCheck className="size-3.5" aria-hidden /> Mark all as read
              </button>
            )}
          </div>
          {!data?.data.length ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">
              You&apos;re all caught up.
            </p>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {data.data.map((notification) => {
                const Icon = ICONS[notification.type];
                return (
                  <li key={notification.id}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => openNotification(notification)}
                      className={cn(
                        'flex w-full gap-3 px-4 py-3 text-left transition hover:bg-slate-50',
                        !notification.readAt && 'bg-brand-50/50',
                      )}
                    >
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100">
                        <Icon className="size-4 text-slate-500" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            'block text-sm text-slate-800',
                            !notification.readAt && 'font-medium text-slate-900',
                          )}
                        >
                          {notification.title}
                        </span>
                        {notification.body && (
                          <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">
                            {notification.body}
                          </span>
                        )}
                        <span className="mt-1 block text-[11px] text-slate-400">
                          {formatRelative(notification.createdAt)}
                        </span>
                      </span>
                      {!notification.readAt && (
                        <span
                          className="mt-2 size-2 shrink-0 rounded-full bg-brand-500"
                          aria-label="Unread"
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
