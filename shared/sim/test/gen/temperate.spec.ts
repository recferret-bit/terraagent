import { describe, expect, it } from 'vitest';
import { createPlanet, DEPOSIT, getDepositRichnessBp, PREP, snapshot, TERRAIN } from '../../src';

const TARGET_SHARE: Record<number, number> = {
  [TERRAIN.flat]: 0.45,
  [TERRAIN.forest]: 0.25,
  [TERRAIN.rock]: 0.08,
  [TERRAIN.slope]: 0.1,
  [TERRAIN.hole]: 0.02,
  [TERRAIN.shallow]: 0.06,
  [TERRAIN.deep]: 0.04,
};

describe('Temperate planet generator (W01-06)', () => {
  it('generates seed golden-1 twice with byte-identical grids and snapshot', () => {
    const a = createPlanet({ id: 'p1', seed: 'golden-1', type: 'temperate', radius: 56 });
    const b = createPlanet({ id: 'p1', seed: 'golden-1', type: 'temperate', radius: 56 });

    expect(a.grid.radius).toBe(56);
    expect(a.grid.count).toBe(9577);
    expect(a.grid.layers.terrain).toEqual(b.grid.layers.terrain);
    expect(a.grid.layers.prep).toEqual(b.grid.layers.prep);
    expect(a.grid.layers.height).toEqual(b.grid.layers.height);
    expect(a.grid.layers.deposit).toEqual(b.grid.layers.deposit);
    expect(a.grid.layers.richness).toEqual(b.grid.layers.richness);
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it('matches §4.5 Temperate class mix within ±2% across multiple seeds', () => {
    for (const seed of ['golden-1', 'seed-2', 'seed-3']) {
      const s = createPlanet({ id: 'p1', seed, type: 'temperate', radius: 56 });
      const terrain = s.grid.layers.terrain as Uint8Array;
      const prep = s.grid.layers.prep as Uint8Array;
      const counts = new Map<number, number>();

      for (let i = 0; i < s.grid.count; i++) {
        const t = terrain[i];
        counts.set(t, (counts.get(t) ?? 0) + 1);
        expect(prep[i]).toBe(t === TERRAIN.flat ? PREP.flat : PREP.wild);
      }

      for (const [codeStr, targetShare] of Object.entries(TARGET_SHARE)) {
        const code = Number(codeStr);
        const share = (counts.get(code) ?? 0) / s.grid.count;
        expect(Math.abs(share - targetShare)).toBeLessThanOrEqual(0.02);
      }
    }
  });

  it('spawns all 3 deposit kinds with +15% Minerals richness modifier on Temperate', () => {
    for (const seed of ['golden-1', 'seed-2', 'seed-3']) {
      const s = createPlanet({ id: 'p1', seed, type: 'temperate', radius: 56 });
      const terrain = s.grid.layers.terrain as Uint8Array;
      const deposit = s.grid.layers.deposit as Uint8Array;
      const richness = s.grid.layers.richness as Float32Array;

      let metalsCount = 0;
      let mineralsCount = 0;
      let oilCount = 0;

      for (let i = 0; i < s.grid.count; i++) {
        const d = deposit[i];
        if (d === DEPOSIT.none) {
          expect(richness[i]).toBe(0);
          continue;
        }
        // Deposits only spawn on non-rock, non-forest passable land tiles (flat or slope)
        expect([TERRAIN.flat, TERRAIN.slope]).toContain(terrain[i]);

        const bp = getDepositRichnessBp(seed, i, d, 'temperate');
        expect(richness[i]).toBe(bp);

        if (d === DEPOSIT.metals) {
          metalsCount++;
          expect(bp).toBeGreaterThanOrEqual(9000);
          expect(bp).toBeLessThanOrEqual(12000);
        } else if (d === DEPOSIT.minerals) {
          mineralsCount++;
          expect(bp).toBeGreaterThanOrEqual(10350);
          expect(bp).toBeLessThanOrEqual(13800);
        } else if (d === DEPOSIT.oil) {
          oilCount++;
          expect(bp).toBeGreaterThanOrEqual(9000);
          expect(bp).toBeLessThanOrEqual(12000);
        }
      }

      expect(metalsCount).toBeGreaterThan(20);
      expect(mineralsCount).toBeGreaterThan(20);
      expect(oilCount).toBeGreaterThan(20);
    }
  });
});
