import { describe, expect, it } from 'vitest';
import {
  createPlanet,
  createState,
  DEPOSIT,
  getSpawnSlots,
  hexDistance,
  hexIndex,
  isHexTile,
  PREP,
  TERRAIN,
  validateSpawnSlotGuarantee,
  type PlanetType,
} from '../../src';
import { buryWildDeposits } from '../../src/gen/depositGround';

const TYPES: PlanetType[] = ['desert', 'temperate', 'ocean'];
const layersOf = (s: ReturnType<typeof createState>) => ({ terrain: s.grid.layers.terrain, prep: s.grid.layers.prep, height: s.grid.layers.height });

describe('deposit ground rule: a visible deposit only lies on a hex tile (world generation)', () => {
  it('every visible deposit of every profile is on a hex tile, and every spawn slot keeps its guarantees (3 types × 8 seeds)', () => {
    for (const planetType of TYPES) {
      for (let k = 0; k < 8; k++) {
        const s = createPlanet({ id: 'p', seed: `hex-dep-${planetType}-${k}`, type: 'temperate', planetType, radius: 56 });
        const L = s.grid.layers;
        let visible = 0;
        for (let i = 0; i < s.grid.count; i++) {
          if (L.deposit[i] === DEPOSIT.none) continue;
          visible++;
          expect(isHexTile(s.grid.radius, i, layersOf(s)), `${planetType} ${k} tile ${i}`).toBe(true);
        }
        // the three starter kinds of every slot at least
        expect(visible).toBeGreaterThanOrEqual(3 * getSpawnSlots(s).length);
        for (const slot of getSpawnSlots(s)) expect(validateSpawnSlotGuarantee(s, slot), `${planetType} ${k} slot ${slot.index}`).toEqual({ ok: true, reasons: [] });
      }
    }
  });

  it('a slot with no free hex tile for a starter kind gets one made (S3: ocean g-41 slot 1, g-42 slot 4, g-66 slot 2, g-88 slot 3)', () => {
    for (const seed of ['g-41', 'g-42', 'g-66', 'g-88']) {
      const s = createPlanet({ id: 'p', seed, type: 'temperate', planetType: 'ocean', radius: 56 });
      for (let i = 0; i < s.grid.count; i++) if (s.grid.layers.deposit[i] !== DEPOSIT.none) expect(isHexTile(s.grid.radius, i, layersOf(s))).toBe(true);
      for (const slot of getSpawnSlots(s)) expect(validateSpawnSlotGuarantee(s, slot), `${seed} slot ${slot.index}`).toEqual({ ok: true, reasons: [] });
    }
  });

  it('a desert shows no deposit on its wild dunes: visible ore is only near the landing zones, the rest is buried', () => {
    const s = createPlanet({ id: 'p', seed: 'golden-1', type: 'temperate', planetType: 'desert', radius: 56 });
    const hx = hexIndex(s.grid.radius);
    const slots = getSpawnSlots(s);
    let buried = 0;
    for (let i = 0; i < s.grid.count; i++) {
      if (s.grid.layers.subDeposit[i] !== DEPOSIT.none) buried++;
      if (s.grid.layers.deposit[i] === DEPOSIT.none) continue;
      expect(Math.min(...slots.map((sl) => hexDistance(sl.q, sl.r, hx.q[i], hx.r[i])))).toBeLessThanOrEqual(12);
    }
    expect(buried).toBeGreaterThan(100);
  });

  it('the final step moves a visible deposit on wild ground to the hidden subsurface (kind and richness kept)', () => {
    const s = createState({ planetId: 'p', planetType: 'temperate', seed: 'bury', radius: 6 });
    const L = s.grid.layers;
    L.terrain.fill(TERRAIN.flat);
    L.prep.fill(PREP.flat);
    const hx = hexIndex(6);
    const open = hx.indexOf(0, 0), besideRock = hx.indexOf(3, 0), alreadyBuried = hx.indexOf(-3, 0);
    L.terrain[hx.indexOf(4, 0)] = TERRAIN.rock;
    L.terrain[hx.indexOf(-4, 0)] = TERRAIN.forest;
    for (const [i, kind] of [[open, DEPOSIT.metals], [besideRock, DEPOSIT.oil], [alreadyBuried, DEPOSIT.minerals]] as const) {
      L.deposit[i] = kind;
      L.richness[i] = 11000;
    }
    L.subDeposit[alreadyBuried] = DEPOSIT.metals;
    L.subRichness[alreadyBuried] = 9500;
    expect(buryWildDeposits(s)).toBe(2);
    expect([L.deposit[open], L.richness[open]]).toEqual([DEPOSIT.metals, 11000]);
    expect([L.deposit[besideRock], L.richness[besideRock], L.subDeposit[besideRock], L.subRichness[besideRock]]).toEqual([DEPOSIT.none, 0, DEPOSIT.oil, 11000]);
    // a tile that already holds a buried deposit keeps it; the visible one is dropped
    expect([L.deposit[alreadyBuried], L.subDeposit[alreadyBuried], L.subRichness[alreadyBuried]]).toEqual([DEPOSIT.none, DEPOSIT.metals, 9500]);
  });
});
