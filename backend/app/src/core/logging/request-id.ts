import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Minimal structural request/response types (no `@types/express` dependency). */
export type HttpReq = IncomingMessage & { id?: string; originalUrl: string; method: string };
export interface HttpRes extends ServerResponse {
  status(code: number): HttpRes;
  json(body: unknown): void;
}

const SAFE = /^[A-Za-z0-9._-]{1,128}$/;

/** Express middleware: `x-request-id` header (if sane) or a fresh UUID; stored on `req.id`, echoed in the response header. */
export function requestIdMiddleware(req: HttpReq, res: HttpRes, next: () => void): void {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && SAFE.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader('x-request-id', id);
  next();
}

export const requestIdOf = (req: HttpReq): string => req.id ?? 'unknown';
