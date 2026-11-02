import { describe, expect, it } from 'vitest';
import { createPlanet, restore, snapshot } from '../../src';
import { defineEntityColumn, entityColumns } from '../../src/ecs/columns';
import { clientTileLayers, defineTileLayer, tileLayers } from '../../src/grid/layers';

// XC-18: the registries later waves extend (SIMULATION §5). Registering mutates module state: this file only.
describe('defineTileLayer / defineEntityColumn (wave extension points)', () => {
  it('a new tile layer is allocated and survives a snapshot; a hidden one never reaches clients', () => {
    defineTileLayer('testMoisture', 'u8', 'W02');
    defineTileLayer('testSecret', 'f32', 'W02', { hidden: true });
    defineTileLayer('testMoisture', 'u8', 'W02'); // same definition again: a no-op
    expect(tileLayers().filter((l) => l.name.startsWith('test')).map((l) => l.name)).toEqual(['testMoisture', 'testSecret']);
    expect(clientTileLayers().some((l) => l.name === 'testSecret')).toBe(false);
    expect(() => defineTileLayer('testMoisture', 'f32', 'W02')).toThrow('tile layer testMoisture already defined as u8');
    const s = createPlanet({ type: 'flat', seed: 'ext', radius: 4 });
    (s.grid.layers.testMoisture as Uint8Array)[3] = 7;
    expect((restore(snapshot(s)).grid.layers.testMoisture as Uint8Array)[3]).toBe(7);
  });

  it('a new entity column is allocated per entity store; redefining it with another dtype throws', () => {
    defineEntityColumn('testHeat', 'f32', 'W02');
    defineEntityColumn('testHeat', 'f32', 'W02');
    expect(entityColumns().filter((c) => c.name === 'testHeat')).toEqual([{ name: 'testHeat', dtype: 'f32', wave: 'W02' }]);
    expect(() => defineEntityColumn('testHeat', 'u8', 'W02')).toThrow('entity column testHeat already defined as f32');
    expect(createPlanet({ type: 'flat', seed: 'ext', radius: 4 }).entities.cols.testHeat).toBeInstanceOf(Float32Array);
  });
});
