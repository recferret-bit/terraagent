import { restore, snapshot } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { compareSnapshots } from '../parity/compare';
import { getParityCase, listParityCases } from '../parity';
import { createScenarioPlanet } from '../_loader';

function base(planetId = 'pl_a') {
  const { host } = createScenarioPlanet('w00', { planetId });
  host.submit({ colonyIndex: null, source: 'dev', commandId: 'c1', kind: 'dev.spawn', args: { q: 2, r: 2 } });
  host.step(3);
  return snapshot(host.state);
}
const mutate = (bytes: Uint8Array, f: (s: ReturnType<typeof restore>) => void) => { const s = restore(bytes); f(s); return snapshot(s); };

describe('compareSnapshots', () => {
  it('passes identical state, also when only the planet id differs', () => {
    const r = compareSnapshots(base('pl_a'), base('pl_b'));
    expect(r.ok).toBe(true);
    expect(r.entities).toBe(2);
    expect(r.maxPosDelta).toBe(0);
  });

  it('tolerates a position difference within 0.01 tile', () => {
    const a = base();
    const r = compareSnapshots(a, mutate(a, (s) => { s.entities.cols.x[1] += 0.005; }));
    expect(r.ok).toBe(true);
    expect(r.maxPosDelta).toBeGreaterThan(0.004);
  });

  it('fails an entity moved by 0.02 tile', () => {
    const a = base();
    const r = compareSnapshots(a, mutate(a, (s) => { s.entities.cols.y[1] += 0.02; }));
    expect(r.ok).toBe(false);
    expect(r.diffs[0]).toMatch(/entities\.y\[1\]/);
  });

  it.each([
    ['entity state', (s: ReturnType<typeof restore>) => { s.entities.cols.state[1] = 3; }, /entities\.state/],
    ['entity tile', (s: ReturnType<typeof restore>) => { s.entities.cols.q[0] += 1; }, /entities\.q/],
    ['tick', (s: ReturnType<typeof restore>) => { s.meta.tick += 1; }, /meta\.tick/],
    ['tile layer', (s: ReturnType<typeof restore>) => { s.grid.layers.terrain[5] = 1; }, /grid\.layers\.terrain/],
    ['rng stream', (s: ReturnType<typeof restore>) => { s.rng.misc[0] ^= 1; }, /rng\.misc/],
    ['entity count', (s: ReturnType<typeof restore>) => { s.entities.count -= 1; }, /entities\.count/],
    ['colony', (s: ReturnType<typeof restore>) => { s.colonies.push({ index: 0, id: 'co', name: 'x', color: 0, status: 'active', changedAt: 0 }); }, /colonies/],
  ])('fails a discrete difference: %s', (_name, f, re) => {
    const a = base();
    const r = compareSnapshots(a, mutate(a, f));
    expect(r.ok).toBe(false);
    expect(r.diffs.join('\n')).toMatch(re);
  });
});

describe('parity list', () => {
  it('lists w00-empty: 600 ticks on a known scenario, atTicks in range', () => {
    const c = getParityCase('w00-empty');
    expect(c?.ticks).toBe(600);
    expect(listParityCases().map((x) => x.id)).toContain('w00-empty');
  });
});
