import * as THREE from 'three';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import { clearTransientWeather } from '@terra/render/core/weatherConfig';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import type { OrbitalGlobeMarkerInput, OrbitalStage } from '@terra/render/orbit/types';
import type { SectorIntentV1 } from '../ui/menu';
import { OnlineSession } from './online/OnlineSession';
import type { ColonyLoadMode } from './online/PodTouchdownFx';
import { resetDeviceSecret } from './online/bootOnline';
import { clearPendingJoinIntent } from './online/joinQueueFlow';
import { writeStoredPlanetKind } from './online/viewportHelper';

export type { ColonyLoadMode } from './online/PodTouchdownFx';

export function resolveColonyLoadMode(opts: {
  readonly isReturning: boolean;
  readonly instant: boolean;
  readonly skipCinematic: boolean;
}): ColonyLoadMode {
  if (opts.instant || opts.skipCinematic) return 'instant';
  return opts.isReturning ? 'direct' : 'pod';
}

export function resolveHomeBaseDiveAngles(markers: readonly OrbitalGlobeMarkerInput[]): { yaw: number; pitch: number } {
  const home = markers.find((m) => m.isHomeBase);
  return home ? { yaw: home.yaw, pitch: home.pitch } : { yaw: 0, pitch: 0.08 };
}

export interface BootOnlineSessionOpts {
  readonly root: HTMLElement;
  readonly viewport: ColonyViewport;
  readonly planetKind: PlanetKind;
  readonly sectorIntent: SectorIntentV1;
  readonly loadMode?: ColonyLoadMode;
  readonly skipDescent: boolean;
  readonly fromSpaceDescent: boolean;
  readonly freshDeployment: boolean;
  readonly orbitalCameraDrop: boolean;
  readonly deferReveal: boolean;
  readonly tryRefresh: boolean;
  readonly onReturnToOrbit: () => void;
}

export function mountBootOnlineSession(opts: BootOnlineSessionOpts): OnlineSession {
  const session = new OnlineSession(opts.root, 'boot', {
    viewport: opts.viewport,
    planetKind: opts.planetKind,
    sectorIntent: opts.sectorIntent,
    loadMode: opts.loadMode,
    skipDescent: opts.skipDescent,
    fromSpaceDescent: opts.fromSpaceDescent,
    freshDeployment: opts.freshDeployment,
    orbitalCameraDrop: opts.orbitalCameraDrop,
    deferReveal: opts.deferReveal,
    tryRefresh: opts.tryRefresh,
    search: '',
    onReturnToOrbit: opts.onReturnToOrbit,
  });
  (window as unknown as { __online?: OnlineSession }).__online = session;
  return session;
}

/**
 * Starts a pod-free returning-colony entry: preserves pilot session, connects `OnlineSession` silently,
 * and dives the orbital camera directly toward the player's home base sector on the 3D globe.
 */
export function startReturningColonyEntry(opts: {
  readonly root: HTMLElement;
  readonly viewport: ColonyViewport;
  readonly planetKind: PlanetKind;
  readonly sectorIntent: SectorIntentV1;
  readonly skipCinematic: boolean;
  readonly stage: OrbitalStage | null;
  readonly markers: readonly OrbitalGlobeMarkerInput[];
  readonly onReturnToOrbit: () => void;
}): OnlineSession {
  writeStoredPlanetKind(opts.planetKind);
  if (typeof localStorage !== 'undefined') clearPendingJoinIntent(localStorage);

  const session = mountBootOnlineSession({
    root: opts.root,
    viewport: opts.viewport,
    planetKind: opts.planetKind,
    sectorIntent: opts.sectorIntent,
    loadMode: opts.skipCinematic ? 'instant' : 'direct',
    skipDescent: opts.skipCinematic,
    fromSpaceDescent: false,
    freshDeployment: false,
    orbitalCameraDrop: !opts.skipCinematic,
    deferReveal: !opts.skipCinematic && Boolean(opts.stage),
    tryRefresh: true,
    onReturnToOrbit: opts.onReturnToOrbit,
  });

  if (!opts.skipCinematic && opts.stage) {
    const { yaw, pitch } = resolveHomeBaseDiveAngles(opts.markers);
    opts.stage.beginCameraDive?.({ yaw, pitch, duration: 1.55 });
  }
  return session;
}

/**
 * Steps `OrbitalStage` during `'entering'`; returns `true` once the cloud plunge has completed and
 * either the online colony is ready or the `0.45s` network grace window has elapsed.
 */
export function stepReturningColonyEntry(opts: {
  readonly stage: OrbitalStage;
  readonly online: OnlineSession | null;
  readonly dt: number;
  readonly time: number;
  readonly holdElapsed: number;
}): { readonly done: boolean; readonly nextHoldElapsed: number } {
  opts.stage.update(opts.dt, opts.time);
  const progress = opts.stage.cameraDiveProgress?.() ?? 1;
  if (progress < 1) return { done: false, nextHoldElapsed: opts.holdElapsed };
  const nextHoldElapsed = opts.holdElapsed + opts.dt;
  const done = Boolean(opts.online?.isColonyReady()) || nextHoldElapsed >= 0.45;
  return { done, nextHoldElapsed };
}

export function prepareOnlineGuestState(keepSession: boolean): void {
  if (!keepSession) resetDeviceSecret();
  if (typeof localStorage !== 'undefined') clearPendingJoinIntent(localStorage);
}

/** Decays the transition bloom flash cleanly toward `baseBloom` without drifting upward. */
export function stepEntryBloomFlash(
  viewport: { readonly bloom: { strength: number } },
  baseBloom: number,
  cutFlash: number,
  dt: number,
): number {
  if (cutFlash <= 0) return 0;
  const next = Math.max(0, cutFlash - dt / 0.4);
  viewport.bloom.strength = baseBloom + 0.55 * next * next;
  return next;
}

export function clearEntrySceneChildren(scene: THREE.Scene, baseChildren: ReadonlySet<THREE.Object3D>): void {
  for (const c of [...scene.children]) if (!baseChildren.has(c)) scene.remove(c);
}

export function resetOrbitalScene(scene: THREE.Scene, baseChildren: ReadonlySet<THREE.Object3D>): void {
  clearTransientWeather();
  clearEntrySceneChildren(scene, baseChildren);
  scene.background = new THREE.Color(0x03060c);
  if (scene.fog instanceof THREE.FogExp2) scene.fog.color.setHex(0x03060c);
}

export function finishReturningColonyEntry(opts: {
  readonly stage: OrbitalStage | null;
  readonly viewport: ColonyViewport;
  readonly online: OnlineSession | null;
  readonly skipDrop: boolean;
}): { readonly baseBloom: number; readonly cutFlash: number } {
  if (opts.stage) {
    const st = opts.stage;
    window.setTimeout(() => st.dispose(), 0);
  }
  opts.viewport.setView(opts.viewport.scene, opts.viewport.camera);
  if (typeof history !== 'undefined' && typeof location !== 'undefined') {
    history.replaceState(null, '', location.pathname);
  }
  opts.online?.revealFromOrbitalDive(opts.skipDrop);
  return {
    baseBloom: opts.viewport.bloom.strength,
    cutFlash: opts.skipDrop ? 0 : 0.55,
  };
}
