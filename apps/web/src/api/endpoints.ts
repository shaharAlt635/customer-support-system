import type {
  AuthResponse,
  CategoryDTO,
  CategoryInput,
  CategorySummaryDTO,
  ChangePasswordInput,
  CompanyLoginInput,
  CompanySettingsInput,
  CompanyRegisterInput,
  CompanySummaryDTO,
  CreateCompanyInput,
  CreateMessageInput,
  CreateTicketInput,
  CurrentUserDTO,
  EmailRequestInput,
  GroupDTO,
  GroupInput,
  GuestTicketInput,
  InvitationDTO,
  InviteInput,
  MessageDTO,
  MyInvitationDTO,
  NotificationListDTO,
  Paginated,
  PublicCompanyDTO,
  PublicConfigDTO,
  ResetPasswordInput,
  StatsOverviewDTO,
  SubmissionPendingDTO,
  TicketDetailDTO,
  TicketPriority,
  TicketSort,
  TicketStatus,
  TicketSummaryDTO,
  UpdateCategoryInput,
  UpdateGroupInput,
  UpdateProfileInput,
  UpdateTicketInput,
  UserDTO,
  UserSummaryDTO,
  VerificationPendingDTO,
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

export interface CustomerListParams {
  q?: string;
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
  magicLink: (input: EmailRequestInput) =>
    request<void>('/auth/magic-link', { method: 'POST', body: input, auth: false }),
  magicLogin: (token: string) =>
    request<AuthResponse>('/auth/magic-login', { method: 'POST', body: { token }, auth: false }),
  setPassword: (password: string) =>
    request<void>('/auth/set-password', { method: 'POST', body: { password } }),
  login: (input: CompanyLoginInput) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: input, auth: false }),
  register: (input: CompanyRegisterInput) =>
    request<VerificationPendingDTO>('/auth/register', {
      method: 'POST',
      body: input,
      auth: false,
    }),
  verifyEmail: (token: string) =>
    request<AuthResponse>('/auth/verify-email', {
      method: 'POST',
      body: { token },
      auth: false,
    }),
  resendVerification: (input: EmailRequestInput) =>
    request<void>('/auth/resend-verification', { method: 'POST', body: input, auth: false }),
  forgotPassword: (input: EmailRequestInput) =>
    request<void>('/auth/forgot-password', { method: 'POST', body: input, auth: false }),
  resetPassword: (input: ResetPasswordInput) =>
    request<{ company: CompanySummaryDTO }>('/auth/reset-password', {
      method: 'POST',
      body: input,
      auth: false,
    }),
  logout: (companySlug: string) =>
    request<void>('/auth/logout', { method: 'POST', body: { companySlug }, auth: false }),
  me: () => request<{ user: CurrentUserDTO; company: CompanySummaryDTO }>('/auth/me'),
  updateProfile: (input: UpdateProfileInput) =>
    request<{ user: CurrentUserDTO }>('/auth/me', { method: 'PATCH', body: input }),
  changePassword: (input: ChangePasswordInput) =>
    request<void>('/auth/change-password', { method: 'POST', body: input }),
};

/** Public endpoints behind each company's ticket page. */
export const portalApi = {
  categories: (slug: string) =>
    request<{ data: CategorySummaryDTO[] }>(`/portal/${encodeURIComponent(slug)}/categories`, {
      auth: false,
    }),
  submit: (slug: string, input: GuestTicketInput, files: File[]) =>
    request<SubmissionPendingDTO>(`/portal/${encodeURIComponent(slug)}/tickets`, {
      method: 'POST',
      body: withFiles({ ...input }, files),
      auth: false,
    }),
  confirm: (token: string) =>
    request<AuthResponse & { ticketId: string }>('/portal/confirm', {
      method: 'POST',
      body: { token },
      auth: false,
    }),
};

export const configApi = {
  get: () => request<PublicConfigDTO>('/config', { auth: false }),
};

export interface SlugCheck {
  slug: string;
  available: boolean;
  reason?: string;
}

export const companiesApi = {
  create: (input: CreateCompanyInput) =>
    request<VerificationPendingDTO>('/companies', { method: 'POST', body: input, auth: false }),
  checkSlug: (slug: string, signal?: AbortSignal) =>
    request<SlugCheck>('/companies/check-slug', { query: { slug }, auth: false, signal }),
  getPublic: (slug: string) =>
    request<PublicCompanyDTO>(`/companies/${encodeURIComponent(slug)}`, { auth: false }),
};

export interface DevEmail {
  id: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  createdAt: string;
}

/** Development mailbox (only available when the API runs with EMAIL_TRANSPORT=dev). */
export const devApi = {
  emails: () => request<{ data: DevEmail[] }>('/dev/emails', { auth: false }),
  clear: () => request<void>('/dev/emails', { method: 'DELETE', auth: false }),
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

export const teamApi = {
  members: () => request<{ data: UserDTO[] }>('/team/members'),
  assignable: () => request<{ data: UserSummaryDTO[] }>('/team/assignable'),
  changeGroup: (id: string, groupId: string) =>
    request<UserDTO>(`/team/members/${id}`, { method: 'PATCH', body: { groupId } }),
  remove: (id: string) => request<void>(`/team/members/${id}`, { method: 'DELETE' }),
  invitations: () => request<{ data: InvitationDTO[] }>('/team/invitations'),
  invite: (input: InviteInput) =>
    request<InvitationDTO>('/team/invitations', { method: 'POST', body: input }),
  resend: (id: string) =>
    request<InvitationDTO>(`/team/invitations/${id}/resend`, { method: 'POST' }),
  revoke: (id: string) => request<void>(`/team/invitations/${id}`, { method: 'DELETE' }),
};

export const groupsApi = {
  list: () => request<{ data: GroupDTO[] }>('/groups'),
  create: (input: GroupInput) => request<GroupDTO>('/groups', { method: 'POST', body: input }),
  update: (id: string, input: UpdateGroupInput) =>
    request<GroupDTO>(`/groups/${id}`, { method: 'PATCH', body: input }),
  remove: (id: string) => request<void>(`/groups/${id}`, { method: 'DELETE' }),
};

export const customersApi = {
  list: (params: CustomerListParams) =>
    request<Paginated<UserDTO>>('/customers', { query: { ...params } }),
  setActive: (id: string, isActive: boolean) =>
    request<UserDTO>(`/customers/${id}`, { method: 'PATCH', body: { isActive } }),
};

export const meApi = {
  invitations: () => request<{ data: MyInvitationDTO[] }>('/me/invitations'),
  accept: (id: string) =>
    request<{ user: CurrentUserDTO; company: CompanySummaryDTO }>(`/me/invitations/${id}/accept`, {
      method: 'POST',
    }),
  decline: (id: string) => request<void>(`/me/invitations/${id}/decline`, { method: 'POST' }),
};

export const notificationsApi = {
  list: () => request<NotificationListDTO>('/notifications'),
  markRead: (id: string) => request<void>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => request<void>('/notifications/read-all', { method: 'POST' }),
};

export const companyApi = {
  update: (input: CompanySettingsInput) =>
    request<PublicCompanyDTO>('/company', { method: 'PATCH', body: input }),
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
