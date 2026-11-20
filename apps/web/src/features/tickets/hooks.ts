import type { CreateMessageInput, UpdateTicketInput } from '@support-desk/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getErrorMessage } from '../../api/client';
import { ticketsApi } from '../../api/endpoints';
import { queryKeys } from '../../api/queries';

/** Lists and dashboard numbers depend on every ticket change. */
function useInvalidateTicketViews() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['tickets', 'list'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
  };
}

export function useUpdateTicket(id: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateTicketViews();
  return useMutation({
    mutationFn: (input: UpdateTicketInput) => ticketsApi.update(id, input),
    onSuccess: (ticket) => {
      queryClient.setQueryData(queryKeys.ticket(id), ticket);
      invalidate();
    },
    onError: (error) => toast.error(getErrorMessage(error, 'Could not update the ticket')),
  });
}

export function useReplyToTicket(id: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateTicketViews();
  return useMutation({
    mutationFn: ({ input, files }: { input: CreateMessageInput; files: File[] }) =>
      ticketsApi.reply(id, input, files),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.ticket(id) });
      invalidate();
    },
  });
}

export function useDeleteTicket(id: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateTicketViews();
  return useMutation({
    mutationFn: () => ticketsApi.remove(id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.ticket(id) });
      invalidate();
    },
    onError: (error) => toast.error(getErrorMessage(error, 'Could not delete the ticket')),
  });
}
