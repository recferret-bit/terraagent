import { RESOURCE_KEYS, type ResourceKey, type ScenarioManifest } from '@terra/contracts';
import { ENTITY_KIND } from '../../../ecs/columns';
import type { SimHost } from '../../../host/SimHost';
import { ensureColonyLedger, zeroResource } from '../../../systems/economy/ledger';

/**
 * Scripted adversarial shocks of a region scenario (`ScenarioManifest.shocks`), applied by tick before the behaviour acts:
 *  - `depotLoss`     destroys every Supply Depot (route/capacity shock) or `params.count` of them;
 *  - `hubLoss`       destroys the Command Hubs (total supply cut: K = 0);
 *  - `supplyCut`     zeroes the colonies' stock of `params.resources` (default: everything), a dev revoke in the journal;
 *  - `reserveToggle` puts every builder into reserve and out again every `params.everyTicks` (the cycling exploit probe).
 * Every shock fires once at `atTick` (reserveToggle: from `atTick` on). Returns the number of shocks applied this call.
 */
export function applyShocks(host: SimHost, shocks: ScenarioManifest['shocks'], fromTick: number, toTick: number, nextId: () => string): number {
  let applied = 0;
  for (const s of shocks) {
    if (s.kind === 'reserveToggle') {
      const every = Math.max(1, Number(s.params.everyTicks ?? 60));
      const phase = (t: number): number => Math.floor((t - s.atTick) / every);
      if (toTick >= s.atTick && phase(toTick) !== phase(fromTick)) { toggleReserve(host, phase(toTick) % 2 === 0, nextId); applied++; }
      continue;
    }
    if (s.atTick <= fromTick || s.atTick > toTick) continue;
    if (s.kind === 'depotLoss') destroy(host, ENTITY_KIND.supplyDepot, Number(s.params.count ?? Infinity));
    else if (s.kind === 'hubLoss') destroy(host, ENTITY_KIND.commandHub, Infinity);
    else if (s.kind === 'supplyCut') cutSupply(host, s.params.resources as string[] | undefined);
    else continue;
    applied++;
  }
  return applied;
}

function destroy(host: SimHost, kind: number, count: number): void {
  const cols = host.state.entities.cols;
  let left = count;
  for (let r = 0; r < host.state.entities.count && left > 0; r++) {
    if (cols.kind[r] === kind && cols.hp[r] > 0) { cols.hp[r] = 0; left--; }
  }
}

function cutSupply(host: SimHost, only?: string[]): void {
  const keys = (only ?? RESOURCE_KEYS) as ResourceKey[];
  for (const c of host.state.colonies) {
    if (!c) continue;
    ensureColonyLedger(c);
    for (const k of keys) zeroResource(c, k, host.tick);
  }
}

function toggleReserve(host: SimHost, on: boolean, nextId: () => string): void {
  const cols = host.state.entities.cols;
  for (const c of host.state.colonies) {
    if (!c) continue;
    const ids: number[] = [];
    for (let r = 0; r < host.state.entities.count; r++) if (cols.owner[r] === c.index && cols.kind[r] === ENTITY_KIND.worker && cols.hp[r] > 0) ids.push(cols.id[r]!);
    if (ids.length > 0) host.submit({ colonyIndex: c.index, source: 'player', commandId: nextId(), kind: 'unitReserve', args: { entityIds: ids.slice(0, 64), reserve: on } });
  }
}
