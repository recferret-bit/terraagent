// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { hexCount, hexDistance, hexIndex } from '@terra/sim/grid/hex';
import { createHexTerrain, HEX_PREP, HEX_TERRAIN, specForPlanetType } from '@terra/render/planets/hex';
import type { FeatureContext } from '../../core/registry/types';
import {
  BORDER_HATCH_STORAGE_KEY,
  mountTerritoryBorder,
  setTerritoryColorBlindMode,
  territoryBorderDevCommands,
} from './index';

describe('W01-30: territory-border client feature', () => {
  it('wires the border pattern toggle and dev command to the session HexTerrain; update() never redraws the ground', () => {
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

    // Hub completion: the session redraws the terrain from the view's owner layer (FF-28)
    for (let i = 0; i < count; i++) {
      if (hexDistance(0, 0, hx.q[i]!, hx.r[i]!) <= 10) ownerArr[i] = 0;
    }
    // update() with a view (here one without heights) never redraws the terrain: the old sync path redrew it flat
    handle.update({
      tiles: { count, terrain: terrainArr, prep: prepArr, owner: ownerArr },
    });
    expect(terrain.getTerritoryBorderStats().ownedTileCount).toBe(0);
    terrain.updateTiles({ terrain: terrainArr, prep: prepArr, height: heightArr, owner: ownerArr }, []);
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

  it('remembers the hatch choice per browser and applies it on the next mount', () => {
    localStorage.removeItem(BORDER_HATCH_STORAGE_KEY);
    setTerritoryColorBlindMode(false);
    const first = mountTerritoryBorder({ el: document.body });
    first.toggleColorBlindMode(true);
    expect(localStorage.getItem(BORDER_HATCH_STORAGE_KEY)).toBe('1');
    first.dispose();
    setTerritoryColorBlindMode(false);
    localStorage.setItem(BORDER_HATCH_STORAGE_KEY, '1');
    const second = mountTerritoryBorder({ el: document.body });
    expect(second.isColorBlindMode()).toBe(true);
    expect(second.el?.getAttribute('aria-pressed')).toBe('true');
    second.dispose();
    setTerritoryColorBlindMode(false);
  });
});
