import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** 384 bits of entropy, URL-safe. Only the SHA-256 hash is persisted. */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newTokenFamily(): string {
  return randomUUID();
}
