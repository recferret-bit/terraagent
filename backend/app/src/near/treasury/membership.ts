import { opId } from '../application/outbox/op-id.js';

/** One add per colony (`dao-member:{planetId}:{colonyId}`), so a replay does not insert a second member. */
export function daoMemberOpId(planetId: string, colonyId: string): string {
  return opId('dao-member', planetId, colonyId);
}

/** One removal per colony. A second elimination is the same op and does not throw. */
export function daoMemberRemoveOpId(planetId: string, colonyId: string): string {
  return opId('dao-member-remove', planetId, colonyId);
}

/** Separate from the founding add, so settling can clear `canPropose` after the member exists. */
export function daoMemberSettledOpId(planetId: string, colonyId: string): string {
  return opId('dao-member-settled', planetId, colonyId);
}
