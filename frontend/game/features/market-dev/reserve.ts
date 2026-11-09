import { ENTITY_KIND } from '@terra/sim';
import type { DevCommandDef, FeatureContext } from '../../core/registry/types';
import type { CommandResult } from '../../net/commandBus';
import '../../net/services';
import { E, ENTITY_STRIDE } from '../../store/replica/viewCodec';
import { ownColonyIndex } from '../shared/colony';

const USAGE = 'reserve on|off [all|<id,id,…>]';
const MAX_IDS = 64; // `unitReserve` takes at most 64 ids per command
/** Entity kinds with a `logistics` unit row (`data/logistics.ts`): the units that load the supply window. */
const LOGISTICS_KINDS: ReadonlySet<number> = new Set([ENTITY_KIND.worker]);

/** Ids of the colony's own units with a logistics row in the latest view. */
function ownLogisticsUnits(ctx: FeatureContext): number[] {
  const view = ctx.services.store?.latest;
  if (!view) throw new Error('no world view yet');
  const own = ownColonyIndex(ctx.services);
  const ids: number[] = [];
  for (let i = 0; i < view.count; i++) {
    const o = i * ENTITY_STRIDE;
    if (view.entities[o + E.owner] === own && LOGISTICS_KINDS.has(view.entities[o + E.kind])) ids.push(view.entities[o + E.id]);
  }
  return ids;
}

function parseIds(raw: string): number[] {
  const ids = raw.split(',').filter(Boolean).map(Number);
  if (ids.length === 0 || ids.some((n) => !Number.isInteger(n) || n <= 0)) throw new Error(`usage: ${USAGE}`);
  return ids;
}

export const reserveCommand: DevCommandDef = {
  name: 'reserve',
  help: `${USAGE}  W13: put own units in reserve (no supply bill) or deploy them again (activation cost and delay); default all = every own Builder/Harvester`,
  async run(a, ctx) {
    const mode = a[0]?.toLowerCase();
    if ((mode !== 'on' && mode !== 'off') || a.length > 2) throw new Error(`usage: ${USAGE}`);
    const ids = !a[1] || a[1].toLowerCase() === 'all' ? ownLogisticsUnits(ctx) : parseIds(a[1]);
    if (ids.length === 0) throw new Error('no own units with a logistics row');
    const send = ctx.services.sendCommand;
    if (!send) throw new Error('reserve rejected: not_connected (no game server connection)');
    let last: CommandResult | undefined;
    for (let i = 0; i < ids.length; i += MAX_IDS) {
      last = await send('unitReserve', { entityIds: ids.slice(i, i + MAX_IDS), reserve: mode === 'on' });
      if (!last.ok) throw new Error(`reserve rejected: ${last.code}${last.detail ? ` (${last.detail})` : ''}`);
    }
    return `reserve ${mode}: ${ids.length} unit(s), applied at tick ${last!.ok ? last!.appliedAtTick : '?'}`;
  },
};
