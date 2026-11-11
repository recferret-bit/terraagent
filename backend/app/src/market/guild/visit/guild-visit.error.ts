import { CoreException } from '../../../core/errors/index.js';

/** A visit the scheduler will not store. `zero_visit` is a dock of no length. */
export class GuildVisitError extends CoreException {
  constructor(code: 'zero_visit', message: string) {
    super(code, { status: 400, message });
  }
}
