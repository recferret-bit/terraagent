import { describe, expect, it } from 'vitest';
import { hexCount, hexDistance, hexIndex } from '@terra/sim/grid/hex';
import { createHexTerrain, HEX_PREP, HEX_TERRAIN, specForPlanetType } from '@terra/render/planets/hex';
import type { FeatureContext } from '../../core/registry/types';
import {
  mountTerritoryBorder,
  setTerritoryColorBlindMode,
  territoryBorderDevCommands,
} from './index';

describe('W01-30: territory-border client feature', () => {
  it('wires territory-border feature toggle, view sync, and dev command to active HexTerrain', () => {
    setTerritoryColorBlindMode(false);
    const radius = 12;
    const count = hexCount(radius);
    const hx = hexIndex(radius);
    const terrainArr = new Uint8Array(count).fill(HEX_TERRAIN.flat);
    const prepArr = new Uint8Array(count).fill(HEX_PREP.flat);
    const heightArr = new Float32Array(count);
    const ownerArr = new Int8Array(count).fill(-1);

    const terrain = createHexTerrain({
      radius,
      tiles: { terrain: terrainArr, prep: prepArr, height: heightArr, owner: ownerArr },
      look: specForPlanetType('temperate'),
    });

    const services = { hexTerrain: terrain } as FeatureContext['services'];
    const handle = mountTerritoryBorder({ terrain, services });
    expect(handle.isColorBlindMode()).toBe(false);
    expect(terrain.getTerritoryBorderStats().boundaryEdgeCount).toBe(0);

    // Simulate Hub completion updating owner layer in GameView
    for (let i = 0; i < count; i++) {
      if (hexDistance(0, 0, hx.q[i]!, hx.r[i]!) <= 10) ownerArr[i] = 0;
    }
    handle.update({
      tiles: {
        count,
        terrain: terrainArr,
        prep: prepArr,
        height: heightArr,
        owner: ownerArr,
      },
    });
    expect(terrain.getTerritoryBorderStats().ownedTileCount).toBe(331);
    expect(terrain.getTerritoryBorderStats().boundaryEdgeCount).toBe(126);

    handle.toggleColorBlindMode();
    expect(handle.isColorBlindMode()).toBe(true);
    expect(terrain.getTerritoryBorderStats().hatchSegmentCount).toBe(252);

    const cmd = territoryBorderDevCommands[0]!;
    const outOff = cmd.run(['off'], { flags: new Set(['W00', 'W01']), host: 'server', services });
    expect(outOff).toContain('off');
    expect(terrain.getTerritoryBorderStats().colorBlindMode).toBe(false);

    handle.dispose();
    terrain.dispose();
  });
});
