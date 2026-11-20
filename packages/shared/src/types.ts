import type { Role, TicketEventType, TicketPriority, TicketStatus } from './constants';

/** Dates travel over the wire as ISO-8601 strings. */
export type ISODate = string;

export interface UserSummaryDTO {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface UserDTO extends UserSummaryDTO {
  isActive: boolean;
  lastLoginAt: ISODate | null;
  createdAt: ISODate;
}

export interface AuthResponse {
  user: UserDTO;
  accessToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
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

export interface PublicConfigDTO {
  allowRegistration: boolean;
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
