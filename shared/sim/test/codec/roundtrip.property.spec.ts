import { describe, expect, it } from 'vitest';
import {
  createState, insertRow, nextFloat, nextInt, nextU32, removeRow, restore, seedRng, snapshot, tileLayers, setBlob, DTYPES,
  type PlanetState,
} from '../../src';

/** Deterministic random planet from a seeded engine stream (no Math.random). */
function randomState(seed: string): PlanetState {
  const g = seedRng(seed).misc;
  const s = createState({ planetId: `pl_${seed}`, planetType: (['desert', 'ocean', 'temperate'] as const)[nextInt(g, 0, 2)], seed, radius: nextInt(g, 1, 20) });
  s.meta.tick = nextInt(g, 0, 100000);
  s.meta.ended = nextInt(g, 0, 1) === 1;
  for (const l of tileLayers()) {
    const a = s.grid.layers[l.name];
    for (let i = 0; i < a.length; i++) if (nextInt(g, 0, 3) === 0) a[i] = l.dtype === 'f32' || l.dtype === 'f64' ? nextFloat(g) * 100 : nextInt(g, 0, 100);
  }
  for (const name of Object.keys(s.rng) as (keyof typeof s.rng)[]) for (let i = 0; i < nextInt(g, 0, 50); i++) nextU32(s.rng[name]);
  const n = [0, 1, 5, 64, 65, 130, 300][nextInt(g, 0, 6)] + nextInt(g, 0, 10);
  for (let i = 0; i < n; i++) {
    const row = insertRow(s.entities, s.meta.nextEntityId++, s.meta.tick);
    const c = s.entities.cols;
    c.q[row] = nextInt(g, -20, 20); c.r[row] = nextInt(g, -20, 20); c.x[row] = nextFloat(g) * 40; c.hp[row] = nextFloat(g);
    c.owner[row] = nextInt(g, -1, 3); c.kind[row] = nextInt(g, 0, 255);
  }
  const removals = nextInt(g, 0, 5);
  for (let i = 0; i < removals && s.entities.count > 0; i++) removeRow(s.entities, s.entities.cols.id[nextInt(g, 0, s.entities.count - 1)], s.meta.tick);
  const nc = nextInt(g, 0, 4);
  for (let i = 0; i < nc; i++) {
    s.colonies.push({ index: i, id: `col_${i}`, name: `C${nextU32(g)}`, color: nextU32(g) & 0xffffff, status: (['founding', 'active', 'eliminated', 'settled'] as const)[nextInt(g, 0, 3)],
      changedAt: nextInt(g, 0, 999), stock: { ore: nextInt(g, 0, 1e6), water: nextFloat(g) }, tags: ['a', 'b'].slice(0, nextInt(g, 0, 2)), note: nextInt(g, 0, 1) ? null : 'x' });
  }
  const nb = nextInt(g, 0, 4);
  const names = Object.keys(DTYPES) as (keyof typeof DTYPES)[];
  for (let i = 0; i < nb; i++) {
    const d = names[nextInt(g, 0, names.length - 1)];
    const arr = new DTYPES[d](nextInt(g, 0, 9));
    for (let k = 0; k < arr.length; k++) arr[k] = d === 'f32' || d === 'f64' ? nextFloat(g) : nextInt(g, 0, 100);
    setBlob(s, `blob${i}`, { list: [arr, { deep: new Uint32Array([nextU32(g), 1]) }], n: nextFloat(g), s: 'é✓', flag: true, big: 2 ** 40 }, nextInt(g, 0, 999));
  }
  return s;
}

describe('snapshot round trip (SIM-S-01)', () => {
  it('1000 random states round-trip deep-equal', () => {
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      const s = randomState(`prop-${i}`);
      const r = restore(snapshot(s));
      expect(r).toEqual(s);
      expect(r.grid.layers.f32 ?? r.grid.layers.richness).toBeInstanceOf(Float32Array);
      expect(r.entities.cols.id).toBeInstanceOf(Uint32Array);
    }
    console.log(`1000 states round-tripped in ${Math.round(performance.now() - t0)} ms`);
  }, 120000);
});
