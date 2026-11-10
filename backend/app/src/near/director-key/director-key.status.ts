import { DirectorKeyStatusPayload } from '@terra/contracts';
import type { KeyStatus } from '../application/ports/agent-wallet.port.js';

export interface DirectorStatusBusEvent {
  readonly planetId: string;
  readonly playerId: string;
  readonly colonyId: string;
  readonly payload: DirectorKeyStatusPayload;
}

declare module '../../bus/channels.js' {
  interface BusChannels {
    'director.status': DirectorStatusBusEvent;
  }
}

/** `active` or `revoked` from the wallet. `missing` is not pushed by add or revoke. */
export function directorStatusFromKey(colonyId: string, status: KeyStatus): DirectorKeyStatusPayload {
  return DirectorKeyStatusPayload.parse({
    colonyId,
    state: status.revoked ? 'revoked' : 'active',
    tokens: status.tokens,
    gasAllowance: status.gasAllowance,
    gasSpent: status.gasSpent,
  });
}
