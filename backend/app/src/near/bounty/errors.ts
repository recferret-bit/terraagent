import { CoreException } from '../../core/errors/core-exception.js';
import type { BountyRejectCode, BountyScreen } from './validate.js';

const STATUS: Readonly<Record<BountyRejectCode, number>> = {
  invalid_target: 400,
  invalid_args: 400,
  insufficient_cargo: 409,
  queue_full: 409,
  not_own_territory: 400,
};

/** Domain rejection of a bounty post. `errorCode` is the stable code (`invalid_target`, `queue_full`, …). */
export class BountyPostError extends CoreException {
  readonly code: BountyRejectCode;

  constructor(screen: BountyScreen) {
    super(screen.code, { status: STATUS[screen.code], message: screen.detail, details: { code: screen.code } });
    this.code = screen.code;
  }
}
