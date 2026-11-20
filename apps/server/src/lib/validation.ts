import { objectIdSchema, type ValidationIssue } from '@support-desk/shared';
import { z } from 'zod';
import { Errors } from './errors';

export function formatZodIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/** Validate untrusted input against a schema, throwing a 400 with field-level details. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw Errors.validation(formatZodIssues(result.error));
  return result.data;
}

const idParamsSchema = z.object({ id: z.string() });

/**
 * Extract `:id` from route params. Malformed ids are reported as "not found" rather than
 * a validation error so the API never distinguishes "bad id" from "no such record".
 */
export function parseIdParam(params: unknown, resource: string): string {
  const { id } = parse(idParamsSchema, params);
  if (!objectIdSchema.safeParse(id).success) throw Errors.notFound(resource);
  return id;
}
