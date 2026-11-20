import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import type { DescentSequence, DescentTelemetry } from '@terra/render/descent/types';
import type { OrbitalStage } from '@terra/render/orbit/types';
import { applyPlanetLook } from '@terra/render/planets/applyPlanetLook';
import { createPlanetSurface } from '@terra/render/planets/surface';
import type { PlanetSpec } from '@terra/render/planets/PlanetSpec';
import type { PlanetSurface } from '@terra/render/planets/surface/types';
import { createDescentSequence } from '../descent/createDescent';
import type { DescentHud } from '../ui/hud';
import type { MenuSettings } from '../ui/menu';
import type { OnlineSession } from './online/OnlineSession';
import { POD_ENGINE_STOP_END_S, POD_TOUCHDOWN_DESCENT_S } from './online/PodTouchdownFx';
import { resolveOnlinePlanetLook } from './online/viewportHelper';
import { warmupScene } from './warmup';

export interface PreparedDescentSession {
  key: string;
  spec: PlanetSpec;
  surface: PlanetSurface;
  descent: DescentSequence;
  ready: boolean;
  whenReady: Promise<void>;
}

export function buildPreparedDescentSession(opts: {
  viewport: ColonyViewport;
  key: string;
  spec: PlanetSpec;
  quality: MenuSettings['quality'];
  resetScene: () => void;
  isStale: (p: PreparedDescentSession) => boolean;
}): PreparedDescentSession {
  const { viewport, key, spec, quality, resetScene, isStale } = opts;
  const exp = viewport.renderer.toneMappingExposure;
  const bloom = viewport.bloom.strength;
  let prep!: PreparedDescentSession;
  try {
    resetScene();
    viewport.camera.fov = 28;
    viewport.camera.updateProjectionMatrix();
    viewport.applySky(spec);
    const surface = createPlanetSurface(spec, { quality });
    viewport.scene.add(surface.group);
    try { applyPlanetLook(viewport, spec); } catch (e) { console.warn('applyPlanetLook failed', e); }
    const descent = createDescentSequence({ viewport, scene: viewport.scene, camera: viewport.camera, spec, surface, startAt: 9 });
    prep = { key, spec, surface, descent, ready: false, whenReady: Promise.resolve() };
  } finally {
    viewport.renderer.toneMappingExposure = exp;
    viewport.bloom.strength = bloom;
  }
  prep.whenReady = warmupScene(viewport, () => isStale(prep)).then(() => { prep.ready = true; });
  return prep;
}

export function disposePreparedDescentSession(opts: {
  viewport: ColonyViewport;
  prepared: PreparedDescentSession | null;
  resetScene: () => void;
}): void {
  const { viewport, prepared, resetScene } = opts;
  if (!prepared) return;
  const exp = viewport.renderer.toneMappingExposure;
  const bloom = viewport.bloom.strength;
  try {
    try { prepared.descent.dispose(); } catch (e) { console.warn(e); }
    viewport.scene.remove(prepared.surface.group);
    prepared.surface.dispose();
    resetScene();
  } finally {
    viewport.renderer.toneMappingExposure = exp;
    viewport.bloom.strength = bloom;
  }
}

/** Advances `OrbitalStage` during `deploying`, retargeting the solar entry corridor before pod release (`tn < 3.9`). */
export function stepDeployingStageFrame(opts: {
  dt: number;
  time: number;
  online: OnlineSession | null;
  descent: DescentSequence | null;
  stage: OrbitalStage | null;
  dHud: DescentHud | null;
  currentSpec: PlanetSpec;
}): PlanetSpec {
  const { dt, time, online, descent, stage, dHud, currentSpec } = opts;
  let nextSpec = currentSpec;
  if (stage && descent) {
    const latest = online?.store.latest;
    if (latest) {
      const resolved = resolveOnlinePlanetLook(latest.planet.type, currentSpec.kind, latest.planet.seed);
      if (resolved.kind !== currentSpec.kind || resolved.seed !== currentSpec.seed) {
        nextSpec = resolved;
        descent.syncPlanetSpec?.(resolved);
      }
    }
    const preRelease = stage.deployTn() < 3.95;
    if (descent.syncHandoffSolar?.({ updateEntryDir: preRelease, dtSec: dt })) {
      const align = stage.retargetDeploy?.(descent.handoff);
      if (align && preRelease) descent.alignGlobe(align.spinQuat, align.cloudRotY);
    }
  }
  stage?.update(dt, time);
  if (stage && descent) {
    const tel = descent.handoff.telAt(stage.deployTn());
    dHud?.update(tel);
    online?.setSpacePhase(tel.phase === 'touchdown' ? 'retro' : tel.phase, false);
  }
  return nextSpec;
}

/** Synchronizes authoritative server planet look & HexTerrain handoff while `DescentRunner` is airborne (`tn < 32`). */
export function syncOnlineSpaceDescentFrame(opts: {
  online: OnlineSession | null;
  descent: DescentSequence | null;
  surface: PlanetSurface | null;
  currentSpec: PlanetSpec;
  tel: DescentTelemetry;
}): PlanetSpec {
  const { online, descent, surface, currentSpec, tel } = opts;
  if (!online || !descent) return currentSpec;

  let nextSpec = currentSpec;
  const latest = online.store.latest;
  if (latest) {
    const resolved = resolveOnlinePlanetLook(latest.planet.type, currentSpec.kind, latest.planet.seed);
    if (resolved.kind !== currentSpec.kind || resolved.seed !== currentSpec.seed) {
      nextSpec = resolved;
      descent.syncPlanetSpec?.(resolved);
    }
  }

  const showGround = surface?.group.visible ?? false;
  const spacePhase = tel.phase === 'touchdown' ? 'retro' : tel.phase;
  const hasOnlineTerrain = online.setSpacePhase(spacePhase, showGround);
  descent.setExternalGround?.(hasOnlineTerrain);
  if (hasOnlineTerrain && surface) {
    surface.group.visible = false;
  }
  return nextSpec;
}

/**
 * Drives `DescentHud` smoothly across `OnlineSession`'s `1.75s` retro burn (`21 m -> 0 m`) and holds the
 * `TOUCHDOWN` (`LAND`) confirmation across engine spool-down (`1.75s -> 2.35s`) before fading out cleanly.
 * Returns `true` when `DescentHud` should be retired and disposed.
 */
export function stepOnlineRetroHud(opts: {
  dHud: DescentHud;
  online: OnlineSession;
  retroTelAt: ((tn: number) => DescentTelemetry) | null;
  skipOnlineLanding: boolean;
}): boolean {
  const { dHud, online, retroTelAt, skipOnlineLanding } = opts;
  if (skipOnlineLanding || !retroTelAt || online.bootPhase === 'splash') {
    return true;
  }

  const st = online.entities.podTouchdown.peekSurfaceState();
  if (st.settled) {
    return true;
  }

  if (st.touchedDown) {
    const postDur = Math.max(0.2, POD_ENGINE_STOP_END_S - POD_TOUCHDOWN_DESCENT_S);
    const postU = Math.min(1, Math.max(0, (st.elapsed - POD_TOUCHDOWN_DESCENT_S) / postDur));
    const tel = retroTelAt(34 + postU * 0.85);
    tel.altitudeKm = 0;
    tel.radarAltM = 0;
    tel.speedKmh = 0;
    tel.verticalSpeedMs = 0;
    dHud.update(tel);
    return st.elapsed >= POD_ENGINE_STOP_END_S;
  }

  const u = Math.min(1, Math.max(0, st.elapsed / POD_TOUCHDOWN_DESCENT_S));
  const tel = retroTelAt(32 + u * 2);
  tel.altitudeKm = st.podLift / 1000;
  tel.radarAltM = st.podLift;
  dHud.update(tel);
  return false;
}
