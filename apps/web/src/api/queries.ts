import { PERMISSIONS } from '@support-desk/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import {
  type TicketListParams,
  type UserListParams,
  categoriesApi,
  configApi,
  statsApi,
  ticketsApi,
  usersApi,
} from './endpoints';

export const queryKeys = {
  config: ['config'] as const,
  tickets: ['tickets'] as const,
  ticketList: (params: TicketListParams) => ['tickets', 'list', params] as const,
  ticket: (id: string) => ['tickets', 'detail', id] as const,
  categories: (includeInactive: boolean) => ['categories', { includeInactive }] as const,
  assignable: ['users', 'assignable'] as const,
  users: (params: UserListParams) => ['users', 'list', params] as const,
  stats: (days: number) => ['stats', days] as const,
};

export function usePublicConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: configApi.get,
    staleTime: Infinity,
  });
}

export function useTickets(params: TicketListParams) {
  return useQuery({
    queryKey: queryKeys.ticketList(params),
    queryFn: ({ signal }) => ticketsApi.list(params, signal),
    placeholderData: keepPreviousData,
  });
}

export function useTicket(id: string) {
  return useQuery({
    queryKey: queryKeys.ticket(id),
    queryFn: () => ticketsApi.get(id),
    // Keep the conversation fresh while someone has it open.
    refetchInterval: 20_000,
  });
}

export function useCategories(includeInactive = false) {
  return useQuery({
    queryKey: queryKeys.categories(includeInactive),
    queryFn: async () => (await categoriesApi.list(includeInactive)).data,
    staleTime: 5 * 60_000,
  });
}

export function useAssignableUsers() {
  const { can } = useAuth();
  return useQuery({
    queryKey: queryKeys.assignable,
    queryFn: async () => (await usersApi.assignable()).data,
    enabled: can(PERMISSIONS.TICKET_ASSIGN),
    staleTime: 5 * 60_000,
  });
}

export function useUsers(params: UserListParams) {
  return useQuery({
    queryKey: queryKeys.users(params),
    queryFn: () => usersApi.list(params),
    placeholderData: keepPreviousData,
  });
}

export function useStats(days: number) {
  return useQuery({
    queryKey: queryKeys.stats(days),
    queryFn: () => statsApi.overview(days),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}
