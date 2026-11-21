import path from 'node:path';
import { ATTACHMENT_TYPES } from '@support-desk/shared';
import type { FastifyRequest } from 'fastify';
import type { FileStorage } from '../storage/file-storage';
import { AppError, Errors } from './errors';

export interface StoredFile {
  fileName: string;
  mimeType: string;
  size: number;
  storageKey: string;
}

export interface UploadLimits {
  maxFileSizeBytes: number;
  maxFiles: number;
}

interface ParsedBody {
  /** JSON body, or the text fields of a multipart form. */
  body: unknown;
  files: StoredFile[];
}

/** Strip directory components and control characters from a client-supplied file name. */
function sanitizeFileName(fileName: string): string {
  // eslint-disable-next-line no-control-regex
  const base = path.basename(fileName.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '');
  return base.slice(0, 200) || 'file';
}

/**
 * Read a request that may be JSON or `multipart/form-data`. Files are streamed straight to
 * storage (never buffered in memory), validated by extension and size, and removed again
 * if anything later in the request fails.
 */
export async function readBodyWithFiles(
  request: FastifyRequest,
  storage: FileStorage,
  limits: UploadLimits,
): Promise<ParsedBody> {
  if (!request.isMultipart()) return { body: request.body ?? {}, files: [] };

  const fields: Record<string, string> = {};
  const files: StoredFile[] = [];

  try {
    for await (const part of request.parts()) {
      if (part.type === 'field') {
        fields[part.fieldname] = String(part.value);
        continue;
      }

      // Browsers send an empty part for a file input with nothing selected.
      if (!part.filename) {
        part.file.resume();
        continue;
      }

      const fileName = sanitizeFileName(part.filename);
      const extension = path.extname(fileName).toLowerCase();
      const mimeType = ATTACHMENT_TYPES[extension];
      if (!mimeType) {
        part.file.resume();
        throw Errors.unsupportedMediaType(
          `"${fileName}" has an unsupported file type`,
          'UNSUPPORTED_FILE_TYPE',
        );
      }

      const storageKey = storage.createKey(extension);
      const size = await storage.save(storageKey, part.file);
      files.push({ fileName, mimeType, size, storageKey });

      if (part.file.truncated) {
        throw tooLarge(fileName, limits);
      }
      if (size === 0) {
        throw Errors.badRequest(`"${fileName}" is empty`, 'EMPTY_FILE');
      }
    }
  } catch (error) {
    await removeStoredFiles(storage, files);
    throw translateMultipartError(error, limits);
  }

  return { body: fields, files };
}

export async function removeStoredFiles(storage: FileStorage, files: StoredFile[]): Promise<void> {
  await Promise.allSettled(files.map((file) => storage.remove(file.storageKey)));
}

function tooLarge(fileName: string | undefined, limits: UploadLimits): AppError {
  const mb = Math.round((limits.maxFileSizeBytes / 1024 / 1024) * 10) / 10;
  return Errors.payloadTooLarge(
    `${fileName ? `"${fileName}"` : 'A file'} exceeds the ${mb} MB size limit`,
    'FILE_TOO_LARGE',
  );
}

function translateMultipartError(error: unknown, limits: UploadLimits): unknown {
  if (error instanceof AppError) return error;
  const code = (error as { code?: string } | null)?.code;
  switch (code) {
    case 'FST_REQ_FILE_TOO_LARGE':
      return tooLarge(undefined, limits);
    case 'FST_FILES_LIMIT':
      return Errors.payloadTooLarge(
        `You can attach at most ${limits.maxFiles} files at once`,
        'TOO_MANY_FILES',
      );
    case 'FST_PARTS_LIMIT':
    case 'FST_FIELDS_LIMIT':
      return Errors.payloadTooLarge('The form contains too many fields', 'TOO_MANY_FIELDS');
    default:
      return error;
  }
}

/** Run `fn`, deleting the already-stored uploads if it throws. */
export async function withUploadCleanup<T>(
  storage: FileStorage,
  files: StoredFile[],
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    await removeStoredFiles(storage, files);
    throw error;
  }
}

const BOOLEAN_FORM_FIELDS = new Set(['isInternal', 'isAnonymous']);

/** Multipart form fields arrive as strings; convert them to the JSON shapes the schemas expect. */
export function normalizeFormFields(body: unknown, isMultipart: boolean): unknown {
  if (!isMultipart || typeof body !== 'object' || body === null) return body;
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, string>)) {
    if (value === '') continue;
    fields[key] = BOOLEAN_FORM_FIELDS.has(key) ? value === 'true' : value;
  }
  return fields;
}
