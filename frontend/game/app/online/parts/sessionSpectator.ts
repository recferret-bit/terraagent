import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import { updateViewFocus } from '@terra/render/core/viewFocus';
import type { HexTerrain } from '@terra/render/planets/hex';
import { ENTITY_KIND } from '@terra/sim';
import type { LandfallController } from '../../../features/landfall';
import { forEachEntity, type ClientView } from '../../../store/replica/viewCodec';
import type { WorldStore } from '../../../store/WorldStore';
import type { RTSCamera } from '../../RTSCamera';
import type { EntityMeshes } from '../EntityMeshes';
import type { FeatureHud } from '../featureHud';
import type { ArrivalHud } from './sessionViewSync';
import type { SessionTerrainPreloader } from './terrainPreload';

export function findColonyFocusTile(view: ClientView | null, colonyIndex: number): { q: number; r: number } | null {
  if (!view) return null;
  const col = view.colonies.find((c) => c && c.index === colonyIndex);
  let fallback: { q: number; r: number } | null = null;
  forEachEntity(view.entities, view.count, (e) => {
    if (e.owner !== colonyIndex || e.hp <= 0) return;
    if (e.kind === ENTITY_KIND.commandHub) fallback = { q: e.q, r: e.r };
    else if (e.kind === ENTITY_KIND.hq && !fallback) fallback = { q: e.q, r: e.r };
    else if (!fallback) fallback = { q: e.q, r: e.r };
  });
  if (fallback) return fallback;
  const raw = col as { spawnQ?: number; spawnR?: number } | undefined;
  return typeof raw?.spawnQ === 'number' && typeof raw?.spawnR === 'number' ? { q: raw.spawnQ, r: raw.spawnR } : null;
}

export function pickInitialSpectatorColony(view: ClientView): number | null {
  const colonies = Array.isArray(view.colonies) ? view.colonies : [];
  const aliveBot = colonies.find((c) => c && c.isBot === true && c.status !== 'eliminated' && c.status !== 'settled' && c.status !== 'founding');
  if (aliveBot) return aliveBot.index;
  const alive = colonies.find((c) => c && c.status !== 'eliminated' && c.status !== 'settled' && c.status !== 'founding');
  if (alive) return alive.index;
  const anyReal = colonies.find((c) => Boolean(c) && c.status !== 'founding');
  if (anyReal) return anyReal.index;
  const anyCol = colonies.find((c) => Boolean(c));
  if (anyCol) return anyCol.index;
  let owner: number | null = null;
  forEachEntity(view.entities, view.count, (e) => {
    if (owner === null && e.owner >= 0 && e.hp > 0) owner = e.owner;
  });
  return owner;
}

export function applySpectatorViewSetup(opts: {
  view: ClientView;
  entities: EntityMeshes;
  landfall: LandfallController;
  spectatorVisionAll: boolean;
  colonyIndex: number;
  autoFocused: boolean;
  inspectColony: (colonyIndex: number, focusCamera: boolean) => void;
}): boolean {
  const { view, entities, landfall, spectatorVisionAll, colonyIndex, autoFocused, inspectColony } = opts;
  entities.podTouchdown.setEnabled(false);
  entities.podTouchdown.setSkipLocked(true);
  entities.setSpectatorAllVision(spectatorVisionAll);
  landfall.setSpectator(true);

  const hasCurrent = Array.isArray(view.colonies) && view.colonies.some((c) => c && c.index === colonyIndex);
  if (!autoFocused || !hasCurrent) {
    const initial = pickInitialSpectatorColony(view);
    if (initial !== null) {
      inspectColony(initial, true);
      return true;
    }
  }
  return autoFocused;
}

export function stepOnlineSessionFrame(opts: {
  dt: number;
  now: number;
  rawDt: number;
  animDt: number;
  skipDescent: boolean;
  loadMode: string;
  hqDeployedSynced: boolean;
  deferReveal: boolean;
  externalFrameLoop?: boolean;
  ownsViewport: boolean;
  viewport: ColonyViewport;
  terrain: HexTerrain | null;
  cam: RTSCamera | null;
  entities: EntityMeshes;
  preloader: SessionTerrainPreloader;
  store: WorldStore;
  arrival: ArrivalHud;
  landfall: LandfallController;
  hud: FeatureHud;
  ensureHud: () => void;
  syncDayNight: (now: number) => void;
  frameHud: (now: number, dt: number) => void;
  settleArrival: (arrival: ArrivalHud, cam: RTSCamera, landfall: LandfallController, hud: FeatureHud) => void;
}): void {
  const { dt, now, rawDt, animDt, viewport, terrain, cam, entities, preloader, store } = opts;
  if (entities.podTouchdown.isSpacePhaseActive()) {
    opts.syncDayNight(now);
    preloader.stepAirborneFrame(viewport, terrain, entities, opts.ensureHud);
  } else {
    const podOrDirectWarm =
      !opts.skipDescent && ((opts.loadMode === 'pod' && !opts.hqDeployedSynced) || (opts.loadMode === 'direct' && Boolean(cam?.isOrbitalDropping())));
    if (opts.deferReveal || podOrDirectWarm || (opts.externalFrameLoop && !preloader.isGpuReadyForGround(viewport))) {
      preloader.stepAirborneFrame(viewport, terrain, entities, opts.ensureHud);
    }
    if (!opts.deferReveal && cam) {
      cam.setShake(opts.loadMode === 'pod' ? entities.getCameraShake() : 0);
      cam.update(cam.isOrbitalDropping() ? Math.max(dt, Math.min(rawDt, 0.4)) : dt);
      updateViewFocus(viewport.camera);
    }
    entities.update(animDt, terrain, Math.min(rawDt, 0.4));
    terrain?.tick(animDt);
    if (!opts.deferReveal) {
      opts.frameHud(now, dt);
      if (cam) {
        viewport.followShadow(cam.target);
        opts.settleArrival(opts.arrival, cam, opts.landfall, opts.hud);
      }
    }
  }
    if (opts.ownsViewport && !store.isAwaitingPrediction(now)) viewport.render();
}

const softwareGlCache = new WeakMap<object, boolean>();

function isSoftwareOrAutomatedGl(vp: ColonyViewport, search: string): boolean {
  if (/[?&](fpsCap|maxFps)=/i.test(search)) return false;
  if (typeof navigator !== 'undefined' && navigator.webdriver) return true;
  const cached = softwareGlCache.get(vp);
  if (cached !== undefined) return cached;
  let soft = false;
  try {
    const gl = vp.renderer.getContext?.();
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
      soft = /swiftshader|llvmpipe|software|basic render/i.test(name);
    }
  } catch {
    /* mocked renderer in unit tests */
  }
  softwareGlCache.set(vp, soft);
  return soft;
}

/** Prevents software WebGL (SwiftShader/llvmpipe) from saturating Chromium's shared GPU/Viz command buffer. */
export function computeNextSessionLoopDelayMs(vp: ColonyViewport, search: string, elapsedMs: number): number {
  if (elapsedMs > 200) return Math.min(400, Math.round(elapsedMs * 0.5));
  if (isSoftwareOrAutomatedGl(vp, search)) return 180;
  return 0;
}
