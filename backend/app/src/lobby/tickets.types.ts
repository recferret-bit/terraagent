import {
  BadRequestException,
  Catch,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type {
  EnqueueTicketRequestV1,
  HomeV1,
  LandingSlotId,
  MatchTicketV1,
  NormalizedTicketIntentV1,
  PlanetType,
  SectorId,
} from '@terra/contracts';
import type { AuthenticatedPlayer } from '../core/auth/bearer-auth.guard';
import { CoreException } from '../core/errors';
import { requestIdOf, type HttpReq, type HttpRes } from '../core/logging/request-id';
import { LobbyPersistenceConflictError } from './lobby-persistence.types';

export type MatchTicketErrorCode =
  | 'unsupported_mode'
  | 'same_planet_transfer'
  | 'validation_error'
  | 'already_has_colony'
  | 'queue_paused'
  | 'planet_paused'
  | 'planet_faulted'
  | 'planet_archived'
  | 'sector_not_land'
  | 'invalid_sector'
  | 'already_queued'
  | 'ticket_open'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'too_late'
  | 'unauthorized';

export type ActiveHomeV1 = Extract<HomeV1, { readonly state: 'ACTIVE' }>;

export interface MatchTicketErrorEnvelopeBody {
  readonly errorCode: string;
  readonly code: MatchTicketErrorCode;
  readonly message: string;
  readonly error: {
    readonly code: MatchTicketErrorCode;
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
  };
  readonly details?: Readonly<Record<string, unknown>>;
  readonly home?: ActiveHomeV1;
  readonly requestId?: string;
}

function buildErrorBody(
  code: MatchTicketErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
  home?: ActiveHomeV1,
): MatchTicketErrorEnvelopeBody {
  const mergedDetails =
    home !== undefined ? { ...(details ?? {}), home } : details;
  return {
    errorCode: code,
    code,
    message,
    error: {
      code,
      message,
      ...(mergedDetails !== undefined ? { details: mergedDetails } : {}),
    },
    ...(mergedDetails !== undefined ? { details: mergedDetails } : {}),
    ...(home !== undefined ? { home } : {}),
  };
}

export class MatchTicketBadRequestException extends BadRequestException {
  readonly code: MatchTicketErrorCode;
  readonly errorCode: MatchTicketErrorCode;
  readonly statusCode = 400 as const;
  readonly error: MatchTicketErrorEnvelopeBody['error'];
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: MatchTicketErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    const body = buildErrorBody(code, message, details);
    super(body);
    this.name = 'MatchTicketBadRequestException';
    this.code = code;
    this.errorCode = code;
    this.error = body.error;
    this.details = body.details;
  }
}

export class MatchTicketConflictException extends ConflictException {
  readonly code: MatchTicketErrorCode;
  readonly errorCode: MatchTicketErrorCode;
  readonly statusCode = 409 as const;
  readonly error: MatchTicketErrorEnvelopeBody['error'];
  readonly details?: Readonly<Record<string, unknown>>;
  readonly home?: ActiveHomeV1;

  constructor(
    code: MatchTicketErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
    home?: ActiveHomeV1,
  ) {
    const body = buildErrorBody(code, message, details, home);
    super(body);
    this.name = 'MatchTicketConflictException';
    this.code = code;
    this.errorCode = code;
    this.error = body.error;
    this.details = body.details;
    this.home = home;
  }
}

export class MatchTicketForbiddenException extends ForbiddenException {
  readonly code: MatchTicketErrorCode = 'forbidden';
  readonly errorCode: MatchTicketErrorCode = 'forbidden';
  readonly statusCode = 403 as const;
  readonly error: MatchTicketErrorEnvelopeBody['error'];
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    const body = buildErrorBody('forbidden', message, details);
    super(body);
    this.name = 'MatchTicketForbiddenException';
    this.error = body.error;
    this.details = body.details;
  }
}

export class MatchTicketNotFoundException extends NotFoundException {
  readonly code: MatchTicketErrorCode = 'not_found';
  readonly errorCode: MatchTicketErrorCode = 'not_found';
  readonly statusCode = 404 as const;
  readonly error: MatchTicketErrorEnvelopeBody['error'];
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    const body = buildErrorBody('not_found', message, details);
    super(body);
    this.name = 'MatchTicketNotFoundException';
    this.error = body.error;
    this.details = body.details;
  }
}

export interface EnqueueMatchTicketOptions {
  readonly idempotencyKey?: string;
  readonly priority?: number;
  readonly now?: Date;
}

export interface EnqueueMatchTicketServiceInput extends EnqueueMatchTicketOptions {
  readonly playerId?: string;
  readonly player?: AuthenticatedPlayer | { readonly id: string; readonly handle?: string };
  readonly request?: EnqueueTicketRequestV1 | NormalizedTicketIntentV1 | Record<string, unknown>;
  readonly body?: EnqueueTicketRequestV1 | NormalizedTicketIntentV1 | Record<string, unknown>;
  readonly mode?: string;
  readonly planetId?: string;
  readonly planetType?: PlanetType;
  readonly sectorId?: SectorId;
  readonly autoSector?: boolean;
  readonly partyId?: string;
  readonly sourcePlanetId?: string;
  readonly sourceColonyId?: string;
  readonly carryOver?: Record<string, unknown>;
}

export interface SeedActiveColonyInput {
  readonly id?: string;
  readonly playerId: string;
  readonly planetId?: string;
  readonly planetType?: PlanetType;
  readonly colonyIndex?: number;
  readonly name?: string;
  readonly color?: number;
  readonly foundingSectorId?: SectorId;
  readonly landingSlotId?: LandingSlotId;
  readonly spawnQ?: number;
  readonly spawnR?: number;
  readonly status?: 'ACTIVE' | 'ELIMINATED' | 'ENDED';
}

/**
 * Controller-level exception filter for `/v1/match/tickets` routes so domain/ticket errors
 * serialize with their exact `error.code` (`unsupported_mode`, `same_planet_transfer`,
 * `already_has_colony` + `home`, `queue_paused`, `sector_not_land`, `already_queued`, `forbidden`, etc.).
 */
@Catch()
export class MatchTicketsExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const http = host.switchToHttp();
    const req = http.getRequest<HttpReq>();
    const res = http.getResponse<HttpRes>();
    const requestId = requestIdOf(req);

    if (
      exception instanceof MatchTicketBadRequestException ||
      exception instanceof MatchTicketConflictException ||
      exception instanceof MatchTicketForbiddenException ||
      exception instanceof MatchTicketNotFoundException
    ) {
      const status = exception.getStatus();
      const body = exception.getResponse() as MatchTicketErrorEnvelopeBody;
      res.status(status).json({ ...body, requestId });
      return;
    }

    if (exception instanceof LobbyPersistenceConflictError) {
      const body = buildErrorBody(
        exception.code === 'ticket_open' ? 'already_queued' : (exception.code as MatchTicketErrorCode),
        exception.message,
        exception.details,
      );
      res.status(409).json({ ...body, requestId });
      return;
    }

    if (exception instanceof UnauthorizedException || (exception instanceof CoreException && exception.status === 401)) {
      const body = buildErrorBody('unauthorized', exception.message);
      res.status(401).json({ ...body, requestId });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code: MatchTicketErrorCode =
        status === 401
          ? 'unauthorized'
          : status === 403
            ? 'forbidden'
            : status === 404
              ? 'not_found'
              : status === 409
                ? 'conflict'
                : 'validation_error';
      const body = buildErrorBody(code, exception.message);
      res.status(status).json({ ...body, requestId });
      return;
    }

    const msg = exception instanceof Error ? exception.message : 'Internal server error';
    res.status(500).json({
      errorCode: 'INTERNAL',
      code: 'internal',
      message: msg,
      error: { code: 'internal', message: msg },
      requestId,
    });
  }
}

export type { MatchTicketV1 };
