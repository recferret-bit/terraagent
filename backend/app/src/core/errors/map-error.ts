import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import { CoreException } from './core-exception';

/**
 * Error mapping. Response body: `{ errorCode, error: { code, message, details? }, requestId }`.
 *  - `errorCode`: stable UPPER_SNAKE domain code (`TEST_CODE`, `VALIDATION_ERROR`, `NOT_FOUND`, `INTERNAL`).
 *  - `error.code`: lowercase REST code of PROTOCOL §8, derived from the status (see `restCodeFor`).
 */
export interface MappedError {
  readonly status: number;
  readonly errorCode: string;
  readonly message: string;
  readonly details?: unknown;
}

const REST_BY_STATUS: Readonly<Record<number, string>> = {
  400: 'validation_error',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'already_queued',
  503: 'near_unavailable',
};

/** Status to REST code. 409 maps to `already_queued` only as the closest PROTOCOL §8 code; other 4xx fall back to `validation_error`, 5xx to `internal`. */
export function restCodeFor(status: number): string {
  return REST_BY_STATUS[status] ?? (status >= 500 ? 'internal' : 'validation_error');
}

const HTTP_NAME_CODES: Readonly<Record<number, string>> = {
  400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 415: 'UNSUPPORTED_MEDIA_TYPE', 429: 'TOO_MANY_REQUESTS',
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const isZodError = (e: unknown): e is z.ZodError => e instanceof z.ZodError || (isRecord(e) && e.name === 'ZodError' && Array.isArray(e.issues));

/** Duck-typed so the app does not need the generated Prisma client. */
const isPrismaKnown = (e: unknown): e is { code: string; message: string; meta?: unknown } =>
  isRecord(e) && e.name === 'PrismaClientKnownRequestError' && typeof e.code === 'string';

const mapCore = (e: CoreException): MappedError => ({ status: e.status, errorCode: e.errorCode, message: e.message, details: e.details });

const mapZod = (e: z.ZodError): MappedError => ({
  status: 400, errorCode: 'VALIDATION_ERROR', message: 'Request validation failed', details: z.flattenError(e),
});

function mapPrisma(e: { code: string; meta?: unknown }): MappedError {
  if (e.code === 'P2002') return { status: 409, errorCode: 'CONFLICT', message: 'Resource already exists', details: e.meta };
  if (e.code === 'P2025') return { status: 404, errorCode: 'NOT_FOUND', message: 'Resource not found', details: e.meta };
  return { status: 500, errorCode: 'INTERNAL', message: 'Database error' };
}

function mapHttp(e: HttpException): MappedError {
  const status = e.getStatus();
  const body = e.getResponse();
  const message = isRecord(body) && typeof body.message === 'string' ? body.message : e.message;
  const details = isRecord(body) && Array.isArray(body.message) ? body.message : undefined;
  return { status, errorCode: HTTP_NAME_CODES[status] ?? (status >= 500 ? 'INTERNAL' : 'HTTP_ERROR'), message, details };
}

/** Core, zod, prisma, http, then the fallback (500 `INTERNAL`; the real message is only shown outside production). */
export function mapError(e: unknown, production: boolean): MappedError {
  if (e instanceof CoreException) return mapCore(e);
  if (isZodError(e)) return mapZod(e);
  if (isPrismaKnown(e)) return mapPrisma(e);
  if (e instanceof HttpException) return mapHttp(e);
  const message = production || !(e instanceof Error) ? 'Internal server error' : e.message;
  return { status: 500, errorCode: 'INTERNAL', message };
}
