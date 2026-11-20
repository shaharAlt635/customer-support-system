import { z } from 'zod';
import { ROLES, TICKET_PRIORITIES, TICKET_SORTS, TICKET_STATUSES } from './constants';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid identifier');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .max(254, 'Email is too long')
  .pipe(z.email('Enter a valid email address'));

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/\d/, 'Password must contain at least one number');

export const nameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(80, 'Name must be at most 80 characters');

const pageSchema = z.coerce.number().int().min(1).default(1);
const pageSizeSchema = z.coerce.number().int().min(1).max(100).default(20);
const searchSchema = z.string().trim().max(200).optional();

/** Accepts `a,b,c` (query string) or `['a','b']` and validates each value against an enum. */
function csvEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .preprocess(
      (value) =>
        typeof value === 'string'
          ? value
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean)
          : value,
      z.array(z.enum(values)),
    )
    .optional();
}

// ---------------------------------------------------------------------------
// Auth & profile
// ---------------------------------------------------------------------------

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const updateProfileSchema = z.object({
  name: nameSchema,
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required').max(128),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    path: ['newPassword'],
    message: 'New password must be different from the current one',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ---------------------------------------------------------------------------
// Users (admin)
// ---------------------------------------------------------------------------

export const createUserSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(ROLES),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    name: nameSchema.optional(),
    role: z.enum(ROLES).optional(),
    isActive: z.boolean().optional(),
    password: passwordSchema.optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Provide at least one field to update',
  });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const userListQuerySchema = z.object({
  q: searchSchema,
  role: z.enum(ROLES).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  page: pageSchema,
  pageSize: pageSizeSchema,
});
export type UserListQuery = z.input<typeof userListQuerySchema>;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const categorySchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(50),
  description: z.string().trim().max(200, 'Description must be at most 200 characters').nullish(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a hex colour such as #6366f1'),
  isActive: z.boolean().optional(),
});
export type CategoryInput = z.infer<typeof categorySchema>;

export const updateCategorySchema = categorySchema.partial();
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

// ---------------------------------------------------------------------------
// Tickets & messages
// ---------------------------------------------------------------------------

export const ticketSubjectSchema = z
  .string()
  .trim()
  .min(5, 'Subject must be at least 5 characters')
  .max(150, 'Subject must be at most 150 characters');

export const createTicketSchema = z.object({
  subject: ticketSubjectSchema,
  description: z
    .string()
    .trim()
    .min(10, 'Please describe the issue in at least 10 characters')
    .max(10_000, 'Description must be at most 10,000 characters'),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  categoryId: objectIdSchema.nullish(),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const updateTicketSchema = z
  .object({
    subject: ticketSubjectSchema.optional(),
    status: z.enum(TICKET_STATUSES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    categoryId: objectIdSchema.nullable().optional(),
    assigneeId: objectIdSchema.nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Provide at least one field to update',
  });
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

export const createMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Message cannot be empty')
    .max(10_000, 'Message must be at most 10,000 characters'),
  isInternal: z.boolean().optional(),
  /** Staff can change the ticket status in the same action as replying. */
  status: z.enum(TICKET_STATUSES).optional(),
});
export type CreateMessageInput = z.infer<typeof createMessageSchema>;

export const ticketListQuerySchema = z.object({
  q: searchSchema,
  status: csvEnum(TICKET_STATUSES),
  priority: csvEnum(TICKET_PRIORITIES),
  categoryId: objectIdSchema.optional(),
  assigneeId: z.union([objectIdSchema, z.literal('me'), z.literal('unassigned')]).optional(),
  customerId: objectIdSchema.optional(),
  sort: z.enum(TICKET_SORTS).default('updated'),
  page: pageSchema,
  pageSize: pageSizeSchema,
});
export type TicketListQuery = z.output<typeof ticketListQuerySchema>;

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export const statsQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
});
