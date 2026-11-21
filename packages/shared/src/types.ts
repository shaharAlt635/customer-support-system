import type {
  InvitationStatus,
  NotificationType,
  Role,
  TicketEventType,
  TicketPriority,
  TicketStatus,
} from './constants';
import type { Permission } from './permissions';

/** Dates travel over the wire as ISO-8601 strings. */
export type ISODate = string;

export interface UserSummaryDTO {
  id: string;
  name: string;
  /** Null when hidden, e.g. the requester of an anonymous ticket as seen by staff. */
  email: string | null;
  role: Role;
}

export interface CompanySummaryDTO {
  id: string;
  name: string;
  slug: string;
}

/** What anyone may know about a company before signing in. */
/** How a company's public ticket page behaves. */
export interface PortalSettingsDTO {
  allowAccountTickets: boolean;
  allowGuestTickets: boolean;
  allowAnonymousTickets: boolean;
  portalTitle: string | null;
  portalMessage: string | null;
  brandColor: string;
}

/** What anyone may know about a company before signing in. */
export interface PublicCompanyDTO extends CompanySummaryDTO, PortalSettingsDTO {
  /** Visitors may create customer accounts (platform setting + company setting). */
  allowRegistration: boolean;
}

/** Returned after a guest submits a ticket: it waits for email confirmation. */
export interface SubmissionPendingDTO {
  email: string;
  expiresAt: ISODate;
}

export interface GroupSummaryDTO {
  id: string;
  name: string;
}

export interface UserDTO extends UserSummaryDTO {
  email: string;
  /** False for guest accounts that sign in with email links only. */
  hasPassword: boolean;
  /** Permission group (agents only). */
  group: GroupSummaryDTO | null;
  emailVerified: boolean;
  isActive: boolean;
  lastLoginAt: ISODate | null;
  createdAt: ISODate;
}

/** The signed-in user, with the permissions their role and group grant. */
export interface CurrentUserDTO extends UserDTO {
  permissions: Permission[];
}

export interface AuthResponse {
  user: CurrentUserDTO;
  company: CompanySummaryDTO;
  accessToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
}

export interface GroupDTO extends GroupSummaryDTO {
  description: string | null;
  permissions: Permission[];
  isDefault: boolean;
  memberCount: number;
  createdAt: ISODate;
}

/** A team invitation, as the company sees it. */
export interface InvitationDTO {
  id: string;
  email: string;
  group: GroupSummaryDTO;
  invitedBy: { id: string; name: string };
  status: InvitationStatus;
  /** Whether the email already has an account at the company. */
  hasAccount: boolean;
  createdAt: ISODate;
  expiresAt: ISODate;
}

/** A team invitation, as the invited user sees it. */
export interface MyInvitationDTO {
  id: string;
  company: CompanySummaryDTO;
  group: GroupSummaryDTO;
  invitedBy: { name: string };
  createdAt: ISODate;
  expiresAt: ISODate;
}

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  /** In-app path (relative to the company), e.g. `/tickets/abc`. */
  link: string | null;
  readAt: ISODate | null;
  createdAt: ISODate;
}

export interface NotificationListDTO {
  data: NotificationDTO[];
  unreadCount: number;
}

export interface CategorySummaryDTO {
  id: string;
  name: string;
  color: string;
}

export interface CategoryDTO extends CategorySummaryDTO {
  description: string | null;
  isActive: boolean;
  ticketCount: number;
  createdAt: ISODate;
}

export interface AttachmentDTO {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  messageId: string | null;
  uploadedBy: { id: string; name: string };
  createdAt: ISODate;
}

export interface MessageDTO {
  id: string;
  body: string;
  isInternal: boolean;
  author: UserSummaryDTO;
  attachments: AttachmentDTO[];
  createdAt: ISODate;
}

export interface TicketEventDTO {
  id: string;
  type: TicketEventType;
  fromValue: string | null;
  toValue: string | null;
  actor: UserSummaryDTO;
  createdAt: ISODate;
}

export interface TicketSummaryDTO {
  id: string;
  number: number;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: CategorySummaryDTO | null;
  customer: UserSummaryDTO;
  assignee: UserSummaryDTO | null;
  messageCount: number;
  /** The requester hid their identity from the company. */
  isAnonymous: boolean;
  lastActivityAt: ISODate;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface TicketDetailDTO extends TicketSummaryDTO {
  description: string;
  firstResponseAt: ISODate | null;
  resolvedAt: ISODate | null;
  closedAt: ISODate | null;
  /** Files attached when the ticket was created. Reply attachments live on each message. */
  attachments: AttachmentDTO[];
  messages: MessageDTO[];
  events: TicketEventDTO[];
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: ValidationIssue[];
  };
}

/** Returned by sign-up flows that require email confirmation before signing in. */
export interface VerificationPendingDTO {
  email: string;
  company: CompanySummaryDTO;
  verificationRequired: true;
}

export interface PublicConfigDTO {
  allowRegistration: boolean;
  allowCompanySignup: boolean;
  devMailbox: boolean;
  uploads: {
    maxFileSizeBytes: number;
    maxFiles: number;
    allowedExtensions: string[];
  };
}

export interface CountByKey<K extends string> {
  key: K;
  count: number;
}

export interface StatsOverviewDTO {
  scope: 'organization' | 'personal';
  periodDays: number;
  totals: {
    total: number;
    active: number;
    unassigned: number;
    urgentActive: number;
    createdInPeriod: number;
    resolvedInPeriod: number;
  };
  byStatus: CountByKey<TicketStatus>[];
  byPriority: CountByKey<TicketPriority>[];
  byCategory: { id: string | null; name: string; color: string; count: number }[];
  trend: { date: string; created: number; resolved: number }[];
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
  agentWorkload: { id: string; name: string; active: number; resolvedInPeriod: number }[];
}
