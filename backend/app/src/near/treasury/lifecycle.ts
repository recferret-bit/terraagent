import { opId } from '../application/outbox/op-id.js';

/** One outbox id per planet (`dao-create:{planetId}`), so a retry never opens a second DAO. */
export function daoCreateOpId(planetId: string): string {
  return opId('dao-create', planetId);
}
