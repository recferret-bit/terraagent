import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Logger } from 'pino';
import { requestIdOf, type HttpReq, type HttpRes } from '../logging/request-id';
import { mapError, restCodeFor } from './map-error';

/** The single global filter: maps every error (core, zod, prisma, http, fallback), logs exactly one line, writes the envelope. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly log: Logger, private readonly production: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const http = host.switchToHttp();
    const req = http.getRequest<HttpReq>();
    const res = http.getResponse<HttpRes>();
    const requestId = requestIdOf(req);
    const m = mapError(exception, this.production);
    const fields = { errorCode: m.errorCode, status: m.status, requestId, method: req.method, path: req.originalUrl.split('?')[0] };
    if (m.status >= 500) this.log.error({ ...fields, err: exception }, m.message);
    else this.log.warn(fields, m.message);
    const retryMs = (m.details as { retryAfterMs?: unknown } | undefined)?.retryAfterMs;
    if (m.status === 503 && typeof retryMs === 'number') res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryMs / 1000))));
    const error = { code: restCodeFor(m.status, m.errorCode), message: m.message, ...(m.details === undefined ? {} : { details: m.details }) };
    res.status(m.status).json({ errorCode: m.errorCode, error, requestId });
  }
}
