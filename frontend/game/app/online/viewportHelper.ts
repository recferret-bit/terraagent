import * as THREE from 'three';
import { createColonyViewport, type ColonyViewport } from '@terra/render/core/createColonyViewport';
import { enqueueDeferredDispose } from '@terra/render/core/deferredDispose';
import { getPresetDimensions, getViewportPreset, onPerfConfigChange } from '@terra/render/core/perfConfig';
import { setShadow } from '@terra/render/core/shadowConfig';
import { getShadowQuality, onShadowQualityChange } from '@terra/render/core/shadowQuality';
import type {
  BiomeGeneratedPayload,
  BugsOrchestrator,
  BuildingsOrchestrator,
  UnitsOrchestrator,
} from '@terra/render/orchestrators';
import { applyPlanetLook } from '@terra/render/planets/applyPlanetLook';
import { PLANET_KINDS, PLANET_SPECS, type PlanetKind, type PlanetSpec } from '@terra/render/planets/PlanetSpec';
import { createHexTerrain, getDepositVisualStage, hashGroundSeed, parseGroundSeedInput, specForPlanetType, tileXZ, type HexPick, type HexTerrain, type HexTiles, type PrecomputedHexTerrainData, type SimPlanetType } from '@terra/render/planets/hex';

export { parseGroundSeedInput };
import type { LocalTransport } from '../../net/LocalTransport';
import { isGameInputBlocked } from '../../core/input/gameInputBlock';
import type { ClientTiles, ClientView } from '../../store/replica/viewCodec';
import { getSavedGraphicsQuality } from '../../ui/parts/settingsModal';
import { FINAL_POS } from '../../descent/constants';
import { RTSCamera } from '../RTSCamera';
import { hexSurface } from './hexSurface';

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

function isOpenModalEl(el: HTMLElement | null): boolean {
  return Boolean(el && el.dataset.open === 'true' && !el.hidden && el.style.display !== 'none' && !el.closest('[hidden]'));
}

function isVisibleOverlayEl(el: HTMLElement | null): boolean {
  return Boolean(el && !el.hidden && el.style.display !== 'none' && !el.closest('[hidden]'));
}

export function isEscapeBlockedByHudOverlay(): boolean {
  if (typeof document === 'undefined') return false;
  const ghost = document.querySelector<HTMLElement>('[data-testid="hub-placement-ghost"]');
  if (ghost && ghost.dataset.active === 'true' && !ghost.hidden) return true;
  if (isVisibleOverlayEl(document.querySelector<HTMLElement>('.ta-placement-ghost'))) return true;
  if (isVisibleOverlayEl(document.querySelector<HTMLElement>('[data-testid="dev-console"]'))) return true;
  if (isOpenModalEl(document.querySelector<HTMLElement>('[data-testid="global-map-overlay"]'))) return true;
  if (isVisibleOverlayEl(document.querySelector<HTMLElement>('[data-testid="away-digest"]'))) return true;
  if (isOpenModalEl(document.querySelector<HTMLElement>('[data-testid="pilot-dialog"]'))) return true;
  if (isOpenModalEl(document.querySelector<HTMLElement>('[data-testid="trade-hub-panel"]'))) return true;
  if (isOpenModalEl(document.querySelector<HTMLElement>('[data-testid="deed-panel"]'))) return true;
  if (isVisibleOverlayEl(document.querySelector<HTMLElement>('[data-testid="stage-track-hud"]'))) return true;
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
  return terrain.pick(ndc, vp.camera); // the session keeps the last one as `__online.lastPick` (no per-move console line)
}

export function pickSessionAt(
  terrain: HexTerrain | null,
  vp: ColonyViewport,
  entities: { pickAtViewport(vp: ColonyViewport, terrain: HexTerrain | null, cx: number, cy: number): (HexPick & { entityId?: number }) | null },
  hud: { isMounted: boolean; activeServices: { hubPlacement?: { isPlacementActive?(): boolean }; getPlacementGhostState?(): unknown; terraform?: { isArmed?(): boolean } } | null },
  clientX: number,
  clientY: number,
): (HexPick & { entityId?: number }) | null {
  const svc = hud.isMounted ? hud.activeServices : null;
  const preferGround = Boolean(
    isGameInputBlocked() ||
    svc?.hubPlacement?.isPlacementActive?.() === true ||
    (svc?.getPlacementGhostState?.() ?? null) !== null ||
    svc?.terraform?.isArmed?.() === true,
  );
  if (!preferGround) {
    const entityHit = entities.pickAtViewport(vp, terrain, clientX, clientY);
    if (entityHit) return entityHit;
  }
  return pickTerrainAt(terrain, vp, clientX, clientY);
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
  const g = scene.getObjectByName('online-entities'); // EntityMeshes (XC-07: the only entity renderer)
  return (g?.children ?? [])
    .filter((m) => typeof m.userData.entityId === 'number')
    .map((m) => ({ id: Number(m.userData.entityId), x: m.position.x, y: m.position.y, z: m.position.z }));
}

/**
 * The look of the planet the session is on. The sim's real planet type wins (D-38: the ground is generated per type, a
 * sand palette on temperate ground would lie); the orbit pick (`preferredKind`) is only used when the type is unknown.
 * When `planetSeed` is provided (from `SimView.planet.seed` or HTTP boot), `look.seed` is hashed deterministically so
 * every player joining the planet generates identical ground relief detail, rocks, forest stands, and flora.
 */
export function resolveOnlinePlanetLook(
  planetType: SimPlanetType | string,
  preferredKind?: PlanetKind | null,
  planetSeed?: string | number | null,
): PlanetSpec {
  const base =
    planetType === 'desert' || planetType === 'ocean' || planetType === 'temperate'
      ? specForPlanetType(planetType)
      : preferredKind && PLANET_KINDS.includes(preferredKind)
        ? PLANET_SPECS[preferredKind]
        : specForPlanetType('temperate');
  if (planetSeed === undefined || planetSeed === null || planetSeed === '') return base;
  return { ...base, seed: hashGroundSeed(planetSeed, base.seed) };
}

/**
 * Tile indices whose height, terrain, prep, deposit (kind or tier), deposit stage or owner differs between two tile
 * snapshots. Richness counts only when it crosses a visual stage (`getDepositVisualStage`): a worker drains it every
 * tick, and nothing else the terrain draws depends on it.
 */
export function changedTiles(a: ClientTiles, b: ClientTiles): number[] {
  const out: number[] = [];
  for (let i = 0; i < b.count; i++) {
    if (
      a.height[i] !== b.height[i] ||
      a.terrain[i] !== b.terrain[i] ||
      a.prep[i] !== b.prep[i] ||
      a.deposit?.[i] !== b.deposit?.[i] ||
      (a.depositTier?.[i] ?? 0) !== (b.depositTier?.[i] ?? 0) ||
      getDepositVisualStage(a.richness?.[i]) !== getDepositVisualStage(b.richness?.[i]) ||
      a.owner?.[i] !== b.owner?.[i]
    ) {
      out.push(i);
    }
  }
  return out;
}

export interface TileChangePatchItem {
  q: number;
  r: number;
  terrain?: number;
  prep?: number;
  height?: number;
  deposit?: number;
  richness?: number;
}

export function applyChangedTileList(terrain: HexTerrain, list: readonly TileChangePatchItem[]): void {
  for (const c of list) {
    terrain.setTileState(c.q, c.r, c.terrain, c.prep, c.height, c.deposit, c.richness);
  }
}

export function applyTerrainTileChanges(
  terrain: HexTerrain,
  prevTiles: ClientTiles,
  nextTiles: ClientTiles,
  _radius?: number,
): void {
  // One incremental update from the new snapshot. No per-tile `setTileState`: it writes into the terrain's current
  // layers (the previous replica snapshot) and rebuilds the planet once per tile.
  const changed = changedTiles(prevTiles, nextTiles);
  if (!changed.length) return;
  terrain.updateTiles(nextTiles as HexTiles, changed);
}

export function applySpaceVoidBackground(scene: THREE.Scene): void {
  if (scene.background instanceof THREE.Color) scene.background.setHex(0x03060c);
  else scene.background = new THREE.Color(0x03060c);
  if (scene.fog instanceof THREE.FogExp2) scene.fog.color.setHex(0x03060c);
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

export function needsSessionTerrainRebuild(
  prevTerrain: HexTerrain | null,
  radius: number,
  prevBiomeKey: string,
  look: PlanetSpec,
): boolean {
  const targetSeed = hashGroundSeed(look.seed, 17);
  return (
    !prevTerrain ||
    prevTerrain.radius !== radius ||
    prevBiomeKey !== look.biomeKey ||
    (prevTerrain.seed !== undefined && prevTerrain.seed !== targetSeed)
  );
}

export function syncOrRebuildSessionTerrain(params: {
  viewport: ColonyViewport;
  prevTerrain: HexTerrain | null;
  prevTiles: ClientTiles | null;
  prevCam: RTSCamera | null;
  prevBiomeKey: string;
  view: ClientView;
  tiles: ClientTiles;
  planetKind: PlanetKind | null;
  planetSeed?: string | number | null;
  inSpace: boolean;
  showSpaceTerrain: boolean;
  deferLook?: boolean;
  cameraTargetTile: { q: number; r: number };
  bugsOrchestrator?: BugsOrchestrator;
  buildingsOrchestrator?: BuildingsOrchestrator;
  unitsOrchestrator?: UnitsOrchestrator;
  onBiomePrewarm?: (biomeKey: string) => void;
  pregenerated?: BiomeGeneratedPayload;
  precomputed?: PrecomputedHexTerrainData;
  progressive?: boolean;
}): { terrain: HexTerrain; cam: RTSCamera | null; biomeKey: string; rebuilt: boolean } {
  const {
    viewport, prevTerrain, prevTiles, prevCam, prevBiomeKey,
    view, tiles, planetKind, inSpace, showSpaceTerrain, deferLook,
    cameraTargetTile, precomputed, progressive,
  } = params;
  const look = resolveOnlinePlanetLook(view.planet.type, planetKind, view.planet.seed ?? params.planetSeed);
  if (!prevTerrain || needsSessionTerrainRebuild(prevTerrain, view.planet.radius, prevBiomeKey, look)) {
    if (prevTerrain) {
      const oldTerrain = prevTerrain;
      viewport.scene.remove(oldTerrain.group);
      if (oldTerrain.disposeDeferred) oldTerrain.disposeDeferred();
      else enqueueDeferredDispose(() => oldTerrain.dispose());
    }
    if (!inSpace && !deferLook) {
      try {
        applyPlanetLook(viewport, look);
      } catch {
        /* Ignore in headless tests */
      }
    }
    params.onBiomePrewarm?.(look.biomeKey);
    params.buildingsOrchestrator?.prewarmForBiome(look.biomeKey);
    params.unitsOrchestrator?.prewarmForBiome(look.biomeKey);
    const terrain = createHexTerrain({
      radius: view.planet.radius,
      tiles: tiles as HexTiles,
      look,
      bugsOrchestrator: params.bugsOrchestrator,
      pregenerated: params.pregenerated,
      precomputed,
      progressive,
      priorityTile: cameraTargetTile,
    });
    viewport.scene.add(terrain.group);
    prevCam?.dispose();
    const [tx, tz] = tileXZ(cameraTargetTile.q, cameraTargetTile.r);
    const ty = terrain.heightAt(tx, tz);
    const savedPos = viewport.camera.position.clone();
    const savedQuat = viewport.camera.quaternion.clone();
    const cam = new RTSCamera(
      viewport.camera,
      viewport.renderer.domElement,
      hexSurface(terrain, look),
      new THREE.Vector3(tx + FINAL_POS.x, ty + FINAL_POS.y, tz + FINAL_POS.z),
      new THREE.Vector3(tx, ty, tz),
    );
    if (inSpace) {
      viewport.camera.position.copy(savedPos);
      viewport.camera.quaternion.copy(savedQuat);
      syncSpaceTerrainOffset(terrain, true, showSpaceTerrain, cameraTargetTile);
    }
    return { terrain, cam, biomeKey: look.biomeKey, rebuilt: true };
  }
  if (prevTiles) {
    applyTerrainTileChanges(prevTerrain, prevTiles, tiles, view.planet.radius);
  }
  return { terrain: prevTerrain, cam: prevCam, biomeKey: prevBiomeKey, rebuilt: false };
}

/** Acquires a safe session viewport and, when owned locally, applies space backdrop and saved quality/shadow settings. */
export function acquireSessionViewport(
  root: HTMLElement,
  provided: ColonyViewport | undefined,
  cleanups: Array<() => void>,
): { viewport: ColonyViewport; ownsViewport: boolean } {
  const ownsViewport = !provided;
  const viewport = createSafeViewport(root, provided);
  if (ownsViewport) {
    applySpaceVoidBackground(viewport.scene);
    cleanups.push(bindSavedViewportSettings(viewport));
  }
  return { viewport, ownsViewport };
}

/** Applies saved graphics quality, viewport resolution, and shadow quality settings to a standalone session viewport. */
export function bindSavedViewportSettings(vp: ColonyViewport): () => void {
  const apply = () => {
    const rawDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const maxDpr = getSavedGraphicsQuality() === 'low' ? 1 : Math.min(rawDpr, 2);
    vp.setResolution(getPresetDimensions(getViewportPreset()), maxDpr);
    setShadow(getShadowQuality() !== 'off');
  };
  apply();
  const offPerf = onPerfConfigChange(() => apply());
  const offShadow = onShadowQualityChange(() => apply());
  return () => {
    offPerf();
    offShadow();
  };
}
