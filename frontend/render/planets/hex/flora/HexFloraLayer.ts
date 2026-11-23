import * as THREE from 'three';
import { buildBiomeOrchestratorConfig } from '../../../orchestrators/BiomeConfig';
import { buildFloraView } from '../../../orchestrators/biomeViews';
import { GroundObjectsOrchestrator } from '../../../orchestrators/GroundObjectsOrchestrator';
import { TreesOrchestrator } from '../../../orchestrators/TreesOrchestrator';
import type { PlanetSpec } from '../../PlanetSpec';
import type { HexTileLayers } from '../chunkMesh';
import { GROUND_FLORA_KINDS, type GroundFloraKind } from './floraPlacementPipeline';

export { GROUND_FLORA_KINDS, type GroundFloraKind };

export interface HexFloraCounts {
  grassTuft: number;
  wildflower: number;
  bush: number;
  saguaro: number;
  barrelCactus: number;
  reeds: number;
  duneTree: number;
}

export interface HexFloraLayer {
  readonly group: THREE.Group;
  readonly timeU: THREE.IUniform<number>;
  readonly meshes: Readonly<Record<GroundFloraKind, readonly THREE.InstancedMesh[]>>;
  counts(): HexFloraCounts;
  update(layers: HexTileLayers, heightAt: (x: number, z: number) => number, changed?: ArrayLike<number>): void;
  cullToFocus(): void;
  dispose(): void;
}

/**
 * Pooled ground-flora layer backed by `GroundObjectsOrchestrator` and `TreesOrchestrator`.
 */
export function createHexFloraLayer(radius: number, look: PlanetSpec): HexFloraLayer {
  const group = new THREE.Group();
  group.name = 'hexFlora';
  const propSink = new THREE.Group();
  const timeU: THREE.IUniform<number> = { value: 0 };
  const cfg = buildBiomeOrchestratorConfig(look, radius);
  const trees = new TreesOrchestrator(cfg, propSink, group, timeU);
  const groundObjects = new GroundObjectsOrchestrator(cfg, look, propSink, group, timeU);
  const view = buildFloraView(group, timeU, trees, groundObjects);

  return {
    ...view,
    dispose() {
      view.dispose();
      trees.dispose();
      groundObjects.dispose();
      group.removeFromParent();
    },
  };
}
