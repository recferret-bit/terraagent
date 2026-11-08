import { rowOf } from '../../ecs/store';
import { fieldSeeds } from '../../grid/flowField';
import { hexDistance, hexIndex } from '../../grid/hex';
import { PREP, TERRAIN } from '../../grid/layers';
import { pathBlockersFor } from '../../grid/pathProfiles';
import { defineCommandHandler } from '../../kernel/commands';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { UnitBook } from '../../units/book';
import { mobileStats, movementProfile } from '../../units/mobility';
import { commitMarch, reservedSlotTiles, slotDistance, slowestSpeed, type MarchCommit } from '../../units/movement/groupMarch';
import { assignSlots, diskPath, seatingPath } from '../../units/movement/slots';
import { parseArgs } from '../command';
import { cancelWorkerJobs } from '../terraform-basic/workJobs';
import { ownUnitRow } from './handlers';
import { issueUnitCommand } from './registry';

/**
 * `moveGroup`: one player order sends several owned units to distinct standable tiles around `(q, r)`.
 * Each unit keeps its place in the group. One shared field builds the routes, and a member leaves it
 * on a clear line to its own tile. `pace: "together"` freezes every member at the slowest member's speed.
 */

interface Member {
  id: number;
  row: number;
  q: number;
  r: number;
}

function anchorBlock(state: PlanetState, q: number, r: number): string | null {
  const tile = hexIndex(state.grid.radius).indexOf(q, r);
  if (tile < 0) return 'invalid_args';
  const terrain = state.grid.layers.terrain[tile];
  const prep = state.grid.layers.prep[tile];
  if (terrain === TERRAIN.deep || prep === PREP.ridge || prep === PREP.moat) return 'site_blocked';
  return null;
}

function collectMembers(state: PlanetState, cmd: Parameters<typeof ownUnitRow>[1], ids: readonly number[], ctx: StepContext): Member[] | string {
  if (new Set(ids).size !== ids.length) return 'invalid_args';
  const members: Member[] = [];
  let profile: string | null = null;
  for (const id of ids) {
    const row = ownUnitRow(state, cmd, id);
    if (typeof row === 'string') return row;
    const kind = state.entities.cols.kind[row];
    if (state.entities.cols.hp[row] <= 0 || !mobileStats(kind, ctx.data)) return 'invalid_args';
    const next = movementProfile(kind, ctx.data);
    if (profile === null) profile = next;
    else if (profile !== next) return 'invalid_args';
    members.push({ id, row, q: state.entities.cols.q[row], r: state.entities.cols.r[row] });
  }
  return members;
}

function noteNoPath(state: PlanetState, id: number, tick: number): void {
  const book = new UnitBook(state);
  const rec = book.get(id);
  rec.lastFailure = { code: 'no_path', tick, kind: 'move', source: 'player' };
  book.touch();
  book.flush(tick);
}

function planMarch(state: PlanetState, members: readonly Member[], anchor: { q: number; r: number }, pace: 'own' | 'together', ctx: StepContext): MarchCommit | string {
  const profile = movementProfile(state.entities.cols.kind[members[0].row], ctx.data);
  const idx = hexIndex(state.grid.radius);
  const seeds = fieldSeeds(state, anchor.q, anchor.r, profile, ctx.data);
  if (seeds.length === 0) return 'site_blocked';
  const taken = reservedSlotTiles(state);
  const blockers = pathBlockersFor(state, profile, -1, ctx.data);
  const blocked = (i: number) => (blockers ? blockers.goalBlocked(i) : false);
  const seedTiles = seeds.map((i) => ({ q: idx.q[i], r: idx.r[i] }));
  const isFree = (q: number, r: number): boolean => {
    const tile = idx.indexOf(q, r);
    if (tile < 0 || taken.has(tile) || blocked(tile)) return false;
    const radius = Math.max(hexDistance(anchor.q, anchor.r, q, r), 1) + 2;
    return seedTiles.some((seed) => diskPath(idx, seed, { q, r }, anchor, radius, blocked) !== null);
  };
  const { slots, overflow } = assignSlots(anchor, members, isFree, {
    maxRing: state.grid.radius,
    inBounds: (q, r) => idx.indexOf(q, r) >= 0,
  });
  for (const id of overflow) noteNoPath(state, id, ctx.tick);
  if (slots.length === 0) return 'site_blocked';
  const diskRadius = Math.max(slotDistance(anchor, slots), 1);
  const byId = new Map(members.map((m) => [m.id, m]));
  const planned: MarchCommit['slots'] = {};
  const outside: Array<{ q: number; r: number }> = [];
  const reserved: number[] = [];
  for (const slot of slots) {
    const member = byId.get(slot.id)!;
    const tile = idx.indexOf(slot.q, slot.r);
    if (tile >= 0) reserved.push(tile);
    const inside = hexDistance(member.q, member.r, anchor.q, anchor.r) <= diskRadius;
    const local = inside ? seatingPath(idx, member, slot, anchor, diskRadius + 2, blocked) : null;
    planned[String(slot.id)] = { q: slot.q, r: slot.r, ...(local ? { local } : {}) };
    if (!local) outside.push({ q: member.q, r: member.r });
  }
  const speed = pace === 'together' ? slowestSpeed(state, slots.map((s) => s.id), ctx.data) : undefined;
  return {
    anchorQ: anchor.q,
    anchorR: anchor.r,
    pace,
    profile,
    diskRadius,
    ...(speed !== undefined ? { marchSpeed: speed } : {}),
    slots: planned,
    reserved,
    outside,
  };
}

export const moveGroup = defineCommandHandler({
  kind: 'moveGroup',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const args = parseArgs('moveGroup', cmd.args);
    if (!args) return 'invalid_args';
    const anchorCode = anchorBlock(state, args.q, args.r);
    if (anchorCode) return anchorCode;
    const members = collectMembers(state, cmd, args.entityIds, ctx);
    if (typeof members === 'string') return members;
    const plan = planMarch(state, members, { q: args.q, r: args.r }, args.pace ?? 'own', ctx);
    if (typeof plan === 'string') return plan;
    for (const key of Object.keys(plan.slots)) {
      const id = Number(key);
      const row = rowOf(state.entities, id);
      if (row < 0) continue;
      cancelWorkerJobs(state, id, ctx.tick);
      const slot = plan.slots[key];
      const code = issueUnitCommand(state, row, { kind: 'move', source: 'player', q: slot.q, r: slot.r }, ctx);
      if (code) delete plan.slots[key];
    }
    if (Object.keys(plan.slots).length === 0) return 'invalid_args';
    commitMarch(state, plan, ctx);
    return undefined;
  },
});
