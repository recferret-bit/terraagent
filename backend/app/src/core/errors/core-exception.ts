/**
 * Framework-free domain error (NEAR §1a rule 4): no Nest import, so domain code, mocks and sim adapters can throw it.
 * `errorCode` is a stable UPPER_SNAKE string clients may switch on; `status` is the HTTP status used by the REST filter.
 */
export interface CoreExceptionOptions {
  readonly status?: number;
  readonly message?: string;
  readonly details?: unknown;
  readonly cause?: unknown;
}

export class CoreException extends Error {
  readonly errorCode: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(errorCode: string, opts: CoreExceptionOptions = {}) {
    super(opts.message ?? errorCode, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = new.target.name;
    this.errorCode = errorCode;
    this.status = opts.status ?? 400;
    this.details = opts.details;
  }
}

export class CoreNotFound extends CoreException {
  constructor(errorCode = 'NOT_FOUND', opts: Omit<CoreExceptionOptions, 'status'> = {}) {
    super(errorCode, { ...opts, status: 404 });
  }
}

export class CoreConflict extends CoreException {
  constructor(errorCode = 'CONFLICT', opts: Omit<CoreExceptionOptions, 'status'> = {}) {
    super(errorCode, { ...opts, status: 409 });
  }
}

export class CoreUnauthorized extends CoreException {
  constructor(errorCode = 'UNAUTHORIZED', opts: Omit<CoreExceptionOptions, 'status'> = {}) {
    super(errorCode, { ...opts, status: 401 });
  }
}

export class CoreForbidden extends CoreException {
  constructor(errorCode = 'FORBIDDEN', opts: Omit<CoreExceptionOptions, 'status'> = {}) {
    super(errorCode, { ...opts, status: 403 });
  }
}
