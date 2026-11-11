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

const CLAIM_STATUS = { invalid_args: 400, queue_full: 409 } as const;
export type BountyClaimCode = keyof typeof CLAIM_STATUS;

/** Domain rejection of `bounty.claim`. `queue_full` is a second claimer on a one-claimer bounty. */
export class BountyClaimError extends CoreException {
  readonly code: BountyClaimCode;

  constructor(code: BountyClaimCode, detail: string) {
    super(code, { status: CLAIM_STATUS[code], message: detail, details: { code } });
    this.code = code;
  }
}
