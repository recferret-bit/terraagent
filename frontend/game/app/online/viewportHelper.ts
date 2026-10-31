import * as THREE from 'three';
import { createColonyViewport, type ColonyViewport } from '@terra/render/core/createColonyViewport';
import { PLANET_KINDS, PLANET_SPECS, type PlanetKind, type PlanetSpec } from '@terra/render/planets/PlanetSpec';
import { specForPlanetType, tileXZ, type HexPick, type HexTerrain, type SimPlanetType } from '@terra/render/planets/hex';
import type { LocalTransport } from '../../net/LocalTransport';
import type { ClientTiles } from '../../store/replica/viewCodec';

export const PLANET_KIND_SESSION_KEY = 'terra.planetKind';

export function bindLocalSaveListeners(local: LocalTransport): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const save = () => local.saveNow();
  const onVis = () => {
    if (document.visibilityState === 'hidden') save();
  };
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', onVis);
  return () => {
    window.removeEventListener('pagehide', save);
    document.removeEventListener('visibilitychange', onVis);
  };
}

export function isEscapeBlockedByHudOverlay(): boolean {
  if (typeof document === 'undefined') return false;
  const ghost = document.querySelector<HTMLElement>('[data-testid="hub-placement-ghost"]');
  if (ghost && ghost.dataset.active === 'true' && !ghost.hidden) return true;
  const devCon = document.querySelector<HTMLElement>('[data-testid="dev-console"]');
  if (devCon && !devCon.hidden && devCon.style.display !== 'none') return true;
  return false;
}

export function readStoredPlanetKind(): PlanetKind | null {
  try {
    if (typeof sessionStorage !== 'undefined' && typeof sessionStorage.getItem === 'function') {
      const v = sessionStorage.getItem(PLANET_KIND_SESSION_KEY);
      if (v && PLANET_KINDS.includes(v as PlanetKind)) return v as PlanetKind;
    }
    if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
      const v = localStorage.getItem(PLANET_KIND_SESSION_KEY);
      if (v && PLANET_KINDS.includes(v as PlanetKind)) return v as PlanetKind;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

export function writeStoredPlanetKind(kind: PlanetKind): void {
  try {
    if (typeof sessionStorage !== 'undefined' && typeof sessionStorage.setItem === 'function') {
      sessionStorage.setItem(PLANET_KIND_SESSION_KEY, kind);
    }
    if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
      localStorage.setItem(PLANET_KIND_SESSION_KEY, kind);
    }
  } catch {
    // ignore storage errors
  }
}

export function resolveSessionPlanetKind(q: URLSearchParams, explicit?: PlanetKind): PlanetKind | null {
  const raw = q.get('planet');
  const urlKind: PlanetKind | null =
    raw === 'dune' || raw === 'oceanForest' || raw === 'forestRock' ? raw : null;
  const resolved = explicit ?? urlKind ?? readStoredPlanetKind();
  if (explicit ?? urlKind) writeStoredPlanetKind((explicit ?? urlKind)!);
  return resolved;
}

export function pickTerrainAt(terrain: HexTerrain | null, vp: ColonyViewport, clientX: number, clientY: number): HexPick | null {
  if (!terrain) return null;
  const r = vp.renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  const pick = terrain.pick(ndc, vp.camera);
  console.log('[pick]', pick ? `q=${pick.q} r=${pick.r} i=${pick.i}` : 'off-planet');
  return pick;
}

export function projectTileToScreen(terrain: HexTerrain | null, vp: ColonyViewport, q: number, r: number): { x: number; y: number } | null {
  if (!terrain) return null;
  const [x, z] = tileXZ(q, r);
  const p = new THREE.Vector3(x, terrain.heightAt(x, z), z).project(vp.camera);
  const rect = vp.renderer.domElement.getBoundingClientRect();
  return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
}

export function syncSpaceTerrainOffset(
  terrain: HexTerrain | null,
  inSpace: boolean,
  showTerrain: boolean,
  targetTile: { q: number; r: number },
): void {
  if (!terrain) return;
  if (inSpace) {
    const [tx, tz] = tileXZ(targetTile.q, targetTile.r);
    const ty = terrain.heightAt(tx, tz);
    terrain.group.position.set(-tx, -ty, -tz);
    terrain.group.visible = showTerrain;
  } else {
    terrain.group.position.set(0, 0, 0);
    terrain.group.visible = true;
  }
}

export function listSceneEntities(scene: THREE.Scene): Array<{ id: number; x: number; y: number; z: number }> {
  const g = scene.getObjectByName('entities');
  return (g?.children ?? []).map((m) => ({ id: Number(m.userData.entityId), x: m.position.x, y: m.position.y, z: m.position.z }));
}

export function resolveOnlinePlanetLook(planetType: SimPlanetType | string, preferredKind?: PlanetKind | null): PlanetSpec {
  if (preferredKind && PLANET_KINDS.includes(preferredKind)) {
    return PLANET_SPECS[preferredKind];
  }
  const st: SimPlanetType = planetType === 'desert' || planetType === 'ocean' ? planetType : 'temperate';
  return specForPlanetType(st);
}

/** Tile indices whose height, terrain, prep, deposit or owner differs between two tile snapshots. */
export function changedTiles(a: ClientTiles, b: ClientTiles): number[] {
  const out: number[] = [];
  for (let i = 0; i < b.count; i++) {
    if (
      a.height[i] !== b.height[i] ||
      a.terrain[i] !== b.terrain[i] ||
      a.prep[i] !== b.prep[i] ||
      a.deposit?.[i] !== b.deposit?.[i] ||
      a.owner?.[i] !== b.owner?.[i]
    ) {
      out.push(i);
    }
  }
  return out;
}

export function createSafeViewport(root: HTMLElement, provided?: ColonyViewport): ColonyViewport {
  if (provided) return provided;
  if (typeof WebGLRenderingContext !== 'undefined') {
    try {
      return createColonyViewport(root);
    } catch {
      /* Headless fallback */
    }
  }
  const domElement = document.createElement('canvas');
  root.appendChild(domElement);
  const noop = () => {};
  return {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(28, 16 / 9, 0.1, 1000),
    renderer: { domElement, setPixelRatio: noop } as unknown as THREE.WebGLRenderer,
    composer: {} as unknown as ColonyViewport['composer'],
    bloom: { enabled: true, strength: 0.45 } as unknown as ColonyViewport['bloom'],
    pixelArt: { enabled: false } as unknown as ColonyViewport['pixelArt'],
    sun: new THREE.DirectionalLight(),
    hemi: new THREE.HemisphereLight(),
    environment: new THREE.Texture(),
    setView: noop,
    applySky: noop,
    followShadow: noop,
    setResolution: noop,
    resize: noop,
    render: noop,
    dispose() {
      domElement.remove();
    },
  };
}
