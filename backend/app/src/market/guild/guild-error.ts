import { CoreException } from '../../core/errors/index.js';

const STATUS = {
  unknown_npc: 404,
  not_provisioned: 409,
  bad_amount: 400,
  cash_on: 409,
  account_mismatch: 409,
} as const;

export type GuildProvisionCode = keyof typeof STATUS;

/** Stable refusal from Guild provisioning. `errorCode` is the key tests switch on. */
export class GuildProvisionError extends CoreException {
  constructor(code: GuildProvisionCode, message: string) {
    super(code, { status: STATUS[code], message });
  }
}
