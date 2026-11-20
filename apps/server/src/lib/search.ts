/**
 * Prisma's MongoDB connector turns `contains` / `startsWith` into a `$regex` without
 * escaping, so user input must be escaped to avoid broken queries and ReDoS patterns.
 */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive substring filter that is safe for arbitrary user input. */
export function containsInsensitive(value: string) {
  return { contains: escapeRegex(value), mode: 'insensitive' } as const;
}
