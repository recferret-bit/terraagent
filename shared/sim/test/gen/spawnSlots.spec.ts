import { describe, expect, it } from 'vitest';
import {
  buildHexRing,
  createPlanet,
  DEPOSIT,
  getSpawnSlots,
  hexDistance,
  hexIndex,
  PREP,
  restore,
  snapshot,
  TERRAIN,
  validateSpawnSlotGuarantee,
  type PlanetType,
} from '../../src';

describe('Spawn slots and UO-TF-09 guarantee (W01-07)', () => {
  it('builds the 192-tile hex ring of radius 32 with pure integer math', () => {
    const ring = buildHexRing(32);
    expect(ring).toHaveLength(192);
    for (let i = 0; i < ring.length; i++) {
      const cur = ring[i];
      const next = ring[(i + 1) % ring.length];
      expect(hexDistance(0, 0, cur.q, cur.r)).toBe(32);
      expect(hexDistance(cur.q, cur.r, next.q, next.r)).toBe(1);
    }
  });

  it('satisfies all UO-TF-09 spawn guarantee predicates across 100 seeds (500 slots)', () => {
    for (let i = 0; i < 100; i++) {
      const state = createPlanet({ id: 'pl_dev', seed: `seed-${i}`, type: 'temperate', radius: 56 });
      const slots = getSpawnSlots(state);
      expect(slots).toHaveLength(5);

      for (let k = 0; k < slots.length; k++) {
        const slot = slots[k];
        expect(slot.index).toBe(k);

        const distFromOrigin = hexDistance(0, 0, slot.q, slot.r);
        expect(distFromOrigin).toBeGreaterThanOrEqual(29);
        expect(distFromOrigin).toBeLessThanOrEqual(35);

        const nextSlot = slots[(k + 1) % slots.length];
        expect(hexDistance(slot.q, slot.r, nextSlot.q, nextSlot.r)).toBeGreaterThanOrEqual(20);

        const check = validateSpawnSlotGuarantee(state, slot);
        expect(check).toEqual({ ok: true, reasons: [] });
      }
    }
  });

  it('keeps the UO-TF-09 guarantees on every profile after the landing zones are levelled (WE-18)', () => {
    // e.g. desert g-18 slot 1 used to lose its metals 2x2 Flat footprint to the falloff-ring reclassification
    const runs: Array<[PlanetType, number]> = [['desert', 60], ['temperate', 15], ['ocean', 15]];
    for (const [planetType, seeds] of runs) {
      for (let i = 0; i < seeds; i++) {
        const state = createPlanet({ id: 'p', seed: `g-${i}`, type: 'temperate', planetType, radius: 56 });
        for (const slot of getSpawnSlots(state)) {
          expect(validateSpawnSlotGuarantee(state, slot), `${planetType} g-${i} slot ${slot.index}`).toEqual({ ok: true, reasons: [] });
        }
      }
    }
  });

  it('round-trips spawnSlots through snapshot and restore and supports custom capacity', () => {
    const state = createPlanet({ id: 'pl_custom', seed: 'custom-cap', type: 'temperate', radius: 56, capacity: 4 });
    const slots = getSpawnSlots(state);
    expect(slots).toHaveLength(4);
    for (const slot of slots) {
      expect(validateSpawnSlotGuarantee(state, slot)).toEqual({ ok: true, reasons: [] });
    }

    const restored = restore(snapshot(state));
    expect(getSpawnSlots(restored)).toEqual(slots);
  });

  it('detects guarantee violations when a slot is corrupted', () => {
    const state = createPlanet({ id: 'pl_dev', seed: 'corrupt-check', type: 'temperate', radius: 56 });
    const [slot] = getSpawnSlots(state);
    const hex = hexIndex(state.grid.radius);
    const centerIdx = hex.indexOf(slot.q, slot.r);

    // Corrupt center tile into Deep water
    (state.grid.layers.terrain as Uint8Array)[centerIdx] = TERRAIN.deep;
    (state.grid.layers.prep as Uint8Array)[centerIdx] = PREP.wild;

    // Strip all deposits within r<=12
    for (let dr = -12; dr <= 12; dr++) {
      for (let dq = -12; dq <= 12; dq++) {
        if (hexDistance(0, 0, dq, dr) > 12) continue;
        const idx = hex.indexOf(slot.q + dq, slot.r + dr);
        if (idx >= 0) {
          (state.grid.layers.deposit as Uint8Array)[idx] = DEPOSIT.none;
          (state.grid.layers.richness as Float32Array)[idx] = 0;
        }
      }
    }

    const res = validateSpawnSlotGuarantee(state, slot);
    expect(res.ok).toBe(false);
    expect(res.reasons.length).toBeGreaterThanOrEqual(4);
  });
});
