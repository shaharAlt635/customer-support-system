/**
 * `$runCommandRaw` / `aggregateRaw` return MongoDB Extended JSON. Numbers may come back as
 * plain numbers or wrapped (`{ $numberLong: "42" }`), so normalise them here.
 */
export function ejsonNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const wrapped = value as Record<string, unknown>;
    for (const key of ['$numberInt', '$numberLong', '$numberDouble', '$numberDecimal']) {
      if (typeof wrapped[key] === 'string') {
        const parsed = Number(wrapped[key]);
        return Number.isFinite(parsed) ? parsed : null;
      }
    }
  }
  return null;
}

export const ejsonDate = (date: Date) => ({ $date: date.toISOString() });
export const ejsonObjectId = (id: string) => ({ $oid: id });
