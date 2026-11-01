import { describe, expect, it } from 'vitest';
import { ArchetypeCatalog } from '../index';
import { extractArchetype, groundContact, type ModelInput } from './index';

const slab = (y0: number, y1: number, role?: 'plinth'): ModelInput['parts'][number] => ({
  index: 0, name: 'p', zone: 'hullPrimary', kind: 'BoxGeometry', animType: 0, pivot: [0, 0, 0], emissive: 0,
  ...(role ? { role } : {}), tris: new Float32Array([0, y0, 0, 1, y1, 0, 0, y1, 1]),
});
const model = (...parts: ModelInput['parts']): ModelInput => ({ id: 't', label: 't', source: 'builder', parts });

describe('ground contact rule (RN-18)', () => {
  it('flush, sunk plinth skirt, sunk non-plinth part, too deep, hovering', () => {
    expect(groundContact(model(slab(0, 1)))).toMatchObject({ ok: true, skirt: false });
    expect(groundContact(model(slab(-0.1, 0.2, 'plinth'), slab(0.2, 2)))).toMatchObject({ ok: true, skirt: true });
    expect(groundContact(model(slab(-0.1, 0.2), slab(0.2, 2))).ok).toBe(false);
    expect(groundContact(model(slab(-0.3, 0.2, 'plinth'), slab(0.2, 2))).ok).toBe(false);
    expect(groundContact(model(slab(0.05, 1))).ok).toBe(false);
  });

  it('every grounded building in the catalog makes contact (the -0.1 m skirt included)', () => {
    for (const e of ArchetypeCatalog.list('building')) {
      const c = groundContact(extractArchetype(e.id));
      expect(c.ok, `${e.id} minY ${c.minY}`).toBe(true);
    }
    expect(groundContact(extractArchetype('building.solar')).skirt).toBe(true);
    expect(groundContact(extractArchetype('building.commandHub')).skirt).toBe(false); // the hub plinth starts at 0
  });
});
