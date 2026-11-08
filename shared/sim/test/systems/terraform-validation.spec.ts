import { describe, expect, it } from 'vitest';
import { parseWaves, REJECT_CODES } from '@terra/contracts';
import {
  compileData,
  evaluateTerraform,
  getColonyTerraformOrders,
  hexIndex,
  PREP,
  setTileOwner,
  setTilePrep,
  setTileTerrain,
  spawnHqUnit,
  TERRAIN,
  terraformWorldFromState,
  type SimHost,
} from '../../src';
import { playerCmd, w01Host } from '../helpers/host';

/** Terraform input validation (owner request): typed reject reasons from the one shared rule, through the real handler. */
const send = (host: SimHost, args: unknown, colony: number | null = 0) => {
  const c = playerCmd('enqueueTask', args, colony, 'tv');
  host.submit(c);
  return host.step(1).outcomes.find((o) => o.commandId === c.commandId)!.code;
};

function rig() {
  // The W05 op rows (Irrigate, Seed) are compiled: under `..04` data they are `wave_disabled` (w05-terraform-gates.spec).
  const host = w01Host({ seed: 'terraform-validation', radius: 12, data: compileData(parseWaves('..05')) });
  spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
  const idx = hexIndex(host.state.grid.radius);
  return { host, at: (q: number, r: number) => idx.indexOf(q, r) };
}

const tf = (op: string, ...tiles: Array<[number, number]>) => ({ terraform: { op, tiles: tiles.map(([q, r]) => ({ q, r })) } });

describe('terraform reject reasons', () => {
  it('the new codes are in the contract list', () => {
    for (const c of ['already_terraformed', 'already_queued', 'already_at_target']) expect(REJECT_CODES).toContain(c);
  });

  it('a Living hex takes no order of any op: already_terraformed', () => {
    const { host, at } = rig();
    setTilePrep(host.state.grid, at(1, 0), PREP.living);
    for (const op of ['grade', 'irrigate', 'seed', 'clear']) expect(send(host, tf(op, [1, 0]))).toBe('already_terraformed');
    expect(getColonyTerraformOrders(host.state, 0)).toHaveLength(0);
  });

  it('a hex already in the op target state: already_at_target', () => {
    const { host, at } = rig();
    setTilePrep(host.state.grid, at(1, 0), PREP.prepared);
    setTilePrep(host.state.grid, at(2, 0), PREP.irrigated);
    expect(send(host, tf('grade', [1, 0]))).toBe('already_at_target');
    expect(send(host, tf('grade', [2, 0]))).toBe('already_at_target');
    expect(send(host, tf('irrigate', [2, 0]))).toBe('already_at_target');
    expect(getColonyTerraformOrders(host.state, 0)).toHaveLength(0);
  });

  it('a hex with a queued job, of any op, or listed twice in one stroke: already_queued', () => {
    const { host, at } = rig();
    setTileTerrain(host.state.grid, at(2, 0), TERRAIN.forest);
    expect(send(host, tf('clear', [2, 0]))).toBeUndefined();
    expect(send(host, tf('clear', [2, 0]))).toBe('already_queued');
    expect(send(host, tf('grade', [2, 0]))).toBe('already_queued');
    const world = terraformWorldFromState(host.state, 0);
    const plan = evaluateTerraform(world, { colonyId: 0, op: 'grade', tiles: [{ q: 1, r: 0 }, { q: 1, r: 0 }], auto: true });
    expect(plan.jobs).toHaveLength(1);
    expect(plan.skipped).toEqual([{ q: 1, r: 0, reason: 'already_queued' }]);
  });

  it('a stroke skips invalid hexes and still queues the rest', () => {
    const { host, at } = rig();
    setTilePrep(host.state.grid, at(1, 0), PREP.living);
    setTileOwner(host.state.grid, at(3, 0), 1);
    expect(send(host, tf('grade', [1, 0], [2, 0], [3, 0], [0, 1]))).toBeUndefined();
    const [order] = getColonyTerraformOrders(host.state, 0);
    expect(order.jobs.map((j) => `${j.q},${j.r}`)).toEqual(['2,0', '0,1']);
    expect(order.skippedCount).toBe(2);
  });

  it('strict input: out of map, foreign tile, unknown op, empty / oversized / fractional / extra fields', () => {
    const { host, at } = rig();
    setTileOwner(host.state.grid, at(3, 0), 1);
    expect(send(host, tf('grade', [99, 99]))).toBe('invalid_args');
    expect(send(host, tf('grade', [3, 0]))).toBe('not_own_territory');
    expect(send(host, tf('explode', [1, 0]))).toBe('invalid_args');
    expect(send(host, { terraform: { op: 'grade', tiles: [] } })).toBe('invalid_args');
    expect(send(host, { terraform: { op: 'grade', tiles: Array.from({ length: 257 }, () => ({ q: 1, r: 0 })) } })).toBe('invalid_args');
    expect(send(host, { terraform: { op: 'grade', tiles: [{ q: 1.5, r: 0 }] } })).toBe('invalid_args');
    expect(send(host, { terraform: { op: 'grade', tiles: [{ q: 1, r: 0 }], extra: 1 } })).toBe('invalid_args');
    expect(getColonyTerraformOrders(host.state, 0)).toHaveLength(0);
  });

  it('the manual order lane cap rejects with queue_full, never a silent drop', () => {
    const { host } = rig();
    const codes: Array<string | undefined> = [];
    for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) if ((q || r) && Math.abs(q + r) <= 3) codes.push(send(host, tf('grade', [q, r])));
    expect(codes).toContain('queue_full');
    expect(codes.filter((c) => c !== undefined && c !== 'queue_full' && c !== 'already_at_target')).toEqual([]);
  });
});
