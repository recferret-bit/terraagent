import type { RejectCode } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { isUnitKind } from '../../units/mobility';

/**
 * Who may be dismantled (owner bug W05 "my drone self-dismantled" / "dismantle of drones works remotely"). One pure
 * rule shared by the host (`executeDismantleAtTile`) and the client preview (`primaryOps.ts`): dismantle is a worker
 * action on a FINISHED OWN BUILDING, performed on site (`dismantleJob.ts`). Units never are a target: recycling a
 * drone would be instant and remote (SIM-M-01), and a drone dismantling itself is nonsense. The landed pod is the
 * only other target (scrapped once a Hub stands; `executeDismantleAtTile` also needs a worker next to it).
 */
export function dismantleTargetReject(kind: number, state: number, opts: { isSelf?: boolean } = {}): RejectCode | null {
  if (kind === ENTITY_KIND.hq || kind === ENTITY_KIND.commandHub) return 'cannot_dismantle_hq';
  if (opts.isSelf) return 'cannot_dismantle_self';
  if (kind === ENTITY_KIND.pod) return state === ENTITY_STATE.descending ? 'site_blocked' : null;
  if (isUnitKind(kind)) return 'cannot_dismantle_unit';
  if (state === ENTITY_STATE.constructing) return 'dismantle_unfinished';
  return null;
}

/** The `dismantleTargetReject` rule for an entity kind by name (the client reads `kindName`); unknown names pass as a building. */
export function dismantleTargetRejectByName(kindName: string, state: number | undefined, opts: { isSelf?: boolean } = {}): RejectCode | null {
  const kind = (ENTITY_KIND as Record<string, number>)[kindName];
  return dismantleTargetReject(kind ?? -1, state ?? ENTITY_STATE.active, opts);
}
