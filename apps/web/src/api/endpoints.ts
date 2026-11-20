import type {
  AuthResponse,
  CategoryDTO,
  CategoryInput,
  ChangePasswordInput,
  CreateMessageInput,
  CreateTicketInput,
  CreateUserInput,
  LoginInput,
  MessageDTO,
  Paginated,
  PublicConfigDTO,
  RegisterInput,
  Role,
  StatsOverviewDTO,
  TicketDetailDTO,
  TicketPriority,
  TicketSort,
  TicketStatus,
  TicketSummaryDTO,
  UpdateCategoryInput,
  UpdateProfileInput,
  UpdateTicketInput,
  UpdateUserInput,
  UserDTO,
  UserSummaryDTO,
} from '@support-desk/shared';
import { request, requestBlob } from './client';

export interface TicketListParams {
  q?: string;
  status?: TicketStatus[];
  priority?: TicketPriority[];
  categoryId?: string;
  assigneeId?: string;
  sort?: TicketSort;
  page?: number;
  pageSize?: number;
}

export interface UserListParams {
  q?: string;
  role?: Role;
  status?: 'active' | 'inactive';
  page?: number;
  pageSize?: number;
}

/** Send JSON when there are no files, multipart otherwise. */
function withFiles(fields: Record<string, unknown>, files: File[]): unknown {
  if (files.length === 0) return fields;
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) form.append(key, String(value));
  }
  for (const file of files) form.append('files', file);
  return form;
}

export const authApi = {
  login: (input: LoginInput) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: input, auth: false }),
  register: (input: RegisterInput) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: input, auth: false }),
  logout: () => request<void>('/auth/logout', { method: 'POST', auth: false }),
  updateProfile: (input: UpdateProfileInput) =>
    request<{ user: UserDTO }>('/auth/me', { method: 'PATCH', body: input }),
  changePassword: (input: ChangePasswordInput) =>
    request<void>('/auth/change-password', { method: 'POST', body: input }),
};

export const configApi = {
  get: () => request<PublicConfigDTO>('/config', { auth: false }),
};

export const ticketsApi = {
  list: (params: TicketListParams, signal?: AbortSignal) =>
    request<Paginated<TicketSummaryDTO>>('/tickets', { query: { ...params }, signal }),
  get: (id: string) => request<TicketDetailDTO>(`/tickets/${id}`),
  create: (input: CreateTicketInput, files: File[]) =>
    request<TicketDetailDTO>('/tickets', { method: 'POST', body: withFiles({ ...input }, files) }),
  update: (id: string, input: UpdateTicketInput) =>
    request<TicketDetailDTO>(`/tickets/${id}`, { method: 'PATCH', body: input }),
  remove: (id: string) => request<void>(`/tickets/${id}`, { method: 'DELETE' }),
  reply: (id: string, input: CreateMessageInput, files: File[]) =>
    request<MessageDTO>(`/tickets/${id}/messages`, {
      method: 'POST',
      body: withFiles({ ...input }, files),
    }),
};

export const attachmentsApi = {
  download: (id: string) => requestBlob(`/attachments/${id}/download`),
};

export const usersApi = {
  list: (params: UserListParams) => request<Paginated<UserDTO>>('/users', { query: { ...params } }),
  assignable: () => request<{ data: UserSummaryDTO[] }>('/users/assignable'),
  create: (input: CreateUserInput) => request<UserDTO>('/users', { method: 'POST', body: input }),
  update: (id: string, input: UpdateUserInput) =>
    request<UserDTO>(`/users/${id}`, { method: 'PATCH', body: input }),
};

export const categoriesApi = {
  list: (includeInactive = false) =>
    request<{ data: CategoryDTO[] }>('/categories', { query: { includeInactive } }),
  create: (input: CategoryInput) =>
    request<CategoryDTO>('/categories', { method: 'POST', body: input }),
  update: (id: string, input: UpdateCategoryInput) =>
    request<CategoryDTO>(`/categories/${id}`, { method: 'PATCH', body: input }),
  remove: (id: string) => request<void>(`/categories/${id}`, { method: 'DELETE' }),
};

export const statsApi = {
  overview: (days: number) => request<StatsOverviewDTO>('/stats/overview', { query: { days } }),
};
