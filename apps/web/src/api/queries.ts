import { PERMISSIONS } from '@support-desk/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import {
  type CustomerListParams,
  type TicketListParams,
  categoriesApi,
  configApi,
  customersApi,
  groupsApi,
  meApi,
  notificationsApi,
  statsApi,
  teamApi,
  ticketsApi,
} from './endpoints';

export const queryKeys = {
  config: ['config'] as const,
  tickets: ['tickets'] as const,
  ticketList: (params: TicketListParams) => ['tickets', 'list', params] as const,
  ticket: (id: string) => ['tickets', 'detail', id] as const,
  categories: (includeInactive: boolean) => ['categories', { includeInactive }] as const,
  assignable: ['team', 'assignable'] as const,
  members: ['team', 'members'] as const,
  invitations: ['team', 'invitations'] as const,
  groups: ['groups'] as const,
  customers: (params: CustomerListParams) => ['customers', params] as const,
  myInvitations: ['me', 'invitations'] as const,
  notifications: ['notifications'] as const,
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
    queryFn: async () => (await teamApi.assignable()).data,
    enabled: can(PERMISSIONS.TICKETS_ASSIGN_SELF) || can(PERMISSIONS.TICKETS_ASSIGN_OTHERS),
    staleTime: 5 * 60_000,
  });
}

export function useTeamMembers() {
  return useQuery({
    queryKey: queryKeys.members,
    queryFn: async () => (await teamApi.members()).data,
  });
}

export function useTeamInvitations() {
  return useQuery({
    queryKey: queryKeys.invitations,
    queryFn: async () => (await teamApi.invitations()).data,
  });
}

export function useGroups(enabled = true) {
  return useQuery({
    queryKey: queryKeys.groups,
    queryFn: async () => (await groupsApi.list()).data,
    enabled,
  });
}

export function useCustomers(params: CustomerListParams) {
  return useQuery({
    queryKey: queryKeys.customers(params),
    queryFn: () => customersApi.list(params),
    placeholderData: keepPreviousData,
  });
}

export function useMyInvitations() {
  const { status } = useAuth();
  return useQuery({
    queryKey: queryKeys.myInvitations,
    queryFn: async () => (await meApi.invitations()).data,
    enabled: status === 'authenticated',
    staleTime: 30_000,
  });
}

export function useNotifications() {
  const { status } = useAuth();
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: notificationsApi.list,
    enabled: status === 'authenticated',
    refetchInterval: 30_000,
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
