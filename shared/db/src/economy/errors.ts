import { economyError, type EconomyError, type EconomyErrorCode } from '@terra/contracts';

/** A repository failure carrying the structured W13-36 error (`version_conflict`, `invalid_manifest`, ...). */
export class EconomyRepoError extends Error {
  constructor(readonly error: EconomyError) {
    super(`${error.code}: ${error.message}`);
    this.name = 'EconomyRepoError';
  }
  get code(): EconomyErrorCode { return this.error.code; }
}

export const repoError = (code: EconomyErrorCode, message: string, path?: string, details?: Record<string, unknown>): EconomyRepoError =>
  new EconomyRepoError(economyError(code, message, path, details));
