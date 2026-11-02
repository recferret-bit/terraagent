import * as THREE from 'three';
import type { HexTileLayers } from './chunkMesh';
import {
  buildTerritoryBorderGeometry,
  createTerritoryBorderMaterial,
  type TerritoryBorderStats,
} from './territoryBorder';

/** Owns the territory border mesh of one hex terrain and rebuilds it from the current tiles and heights. */
export interface BorderController {
  readonly mesh: THREE.Mesh;
  rebuild(tiles: HexTileLayers, effHeights: ArrayLike<number>): void;
  getStats(): TerritoryBorderStats;
  setColorBlindMode(enabled: boolean, tiles: HexTileLayers, effHeights: ArrayLike<number>): void;
  setColonyColors(colors: Record<number, number>, tiles: HexTileLayers, effHeights: ArrayLike<number>): void;
  dispose(): void;
}

export function createBorderController(
  radius: number,
  initialTiles: HexTileLayers,
  initialEffHeights: ArrayLike<number>,
  initialColorBlind: boolean,
  initialColonyColors?: Record<number, number>,
): BorderController {
  let colorBlindMode = initialColorBlind;
  let colonyColors: Record<number, number> = { ...(initialColonyColors ?? {}) };
  const mat = createTerritoryBorderMaterial();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  mesh.name = 'territory-border';
  mesh.renderOrder = 2;
  let stats: TerritoryBorderStats = {
    ownedTileCount: 0,
    boundaryEdgeCount: 0,
    frozenEdgeCount: 0,
    hatchSegmentCount: 0,
    colorBlindMode,
  };

  const rebuild = (tiles: HexTileLayers, effHeights: ArrayLike<number>) => {
    const res = buildTerritoryBorderGeometry(radius, tiles, { effHeights, colorBlindMode, colonyColors });
    mesh.geometry.dispose();
    mesh.geometry = res.geometry;
    mesh.visible = res.stats.boundaryEdgeCount > 0;
    stats = res.stats;
  };

  rebuild(initialTiles, initialEffHeights);

  return {
    mesh,
    rebuild,
    getStats: () => ({ ...stats }),
    setColorBlindMode(enabled, tiles, effHeights) {
      colorBlindMode = Boolean(enabled);
      rebuild(tiles, effHeights);
    },
    setColonyColors(colors, tiles, effHeights) {
      colonyColors = { ...colors };
      rebuild(tiles, effHeights);
    },
    dispose() {
      mesh.geometry.dispose();
      mat.dispose();
      mesh.removeFromParent();
    },
  };
}
