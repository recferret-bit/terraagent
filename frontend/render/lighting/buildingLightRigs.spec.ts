import { beforeEach, describe, expect, it } from 'vitest';
import '../kitbash';
import { extractArchetype } from '../kitbash/validate/extract';
import { BUILDING_LIGHT_IDS, BUILDING_LIGHT_RIGS } from './buildingLightRigs';
import { getArchetypeLights, resetArchetypeLights } from './archetypeLights';

const EMISSIVE = new Set(['energyCyan', 'warningAmber', 'dangerCrimson', 'terraformEmerald']);

function centroid(tris: Float32Array): [number, number, number] {
  let x = 0, y = 0, z = 0, n = 0;
  for (let i = 0; i < tris.length; i += 3) { x += tris[i]; y += tris[i + 1]; z += tris[i + 2]; n++; }
  return [x / n, y / n, z / n];
}

function signature(id: string): string {
  return getArchetypeLights(id).map((l) => l.pos.map((n) => n.toFixed(2)).join(',')).sort().join('|');
}

describe('building night lights', () => {
  beforeEach(() => {
    for (const id of [...BUILDING_LIGHT_IDS, 'building.notARealBuilding', 'building.rocket', 'building.commandHub']) {
      resetArchetypeLights(id);
    }
  });

  it('gives every building its own short rig and does not copy one onto another', () => {
    expect(BUILDING_LIGHT_IDS).toHaveLength(17);
    const seen = new Map<string, string>();
    for (const id of BUILDING_LIGHT_IDS) {
      const lights = getArchetypeLights(id);
      expect(lights.length, id).toBeGreaterThan(0);
      expect(lights.length, id).toBeLessThanOrEqual(2);
      expect(lights.length, id).toBe(BUILDING_LIGHT_RIGS[id]!.length);
      const key = signature(id);
      expect(seen.has(key), `${id} repeats ${seen.get(key)}`).toBe(false);
      seen.set(key, id);
    }
    expect(getArchetypeLights('building.pylon')).toHaveLength(1);
    expect(signature('building.rocket')).not.toBe(signature('building.commandHub'));
    expect(getArchetypeLights('building.notARealBuilding')).toEqual([]);
  });

  it('puts each projector on an emissive bulb and keeps the helicopter mark off the hub', () => {
    for (const id of BUILDING_LIGHT_IDS) {
      const model = extractArchetype(id);
      const names = model.parts.map((p) => p.name);
      expect(names.some((n) => n === 'plinth corner light'), id).toBe(false);
      const bulbs = model.parts.filter((p) => EMISSIVE.has(p.zone) && /light|lamp|beacon|bulb/i.test(p.name));
      for (const light of getArchetypeLights(id)) {
        const near = bulbs.some((b) => {
          const c = centroid(b.tris);
          return Math.hypot(c[0] - light.pos[0], c[1] - light.pos[1], c[2] - light.pos[2]) <= 0.25;
        });
        expect(near, `${id} ${light.id}`).toBe(true);
      }
    }
    const hub = extractArchetype('building.commandHub').parts.map((p) => p.name).join(' | ');
    expect(hub).not.toMatch(/landing pad|pad H/);
  });
});
