import * as THREE from 'three';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import { enqueueDeferredDispose } from '@terra/render/core/deferredDispose';
import { clearTransientWeather } from '@terra/render/core/weatherConfig';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import { getSharedTerrainPrep } from '@terra/render/planets/prep';
import type { OrbitalGlobeMarkerInput, OrbitalStage } from '@terra/render/orbit/types';
import { track } from '../core/analytics';
import type { ClientFlagsStore } from '../core/flags';
import { HudRoot } from '../core/hud/HudRoot';
import { loadFeatures } from '../core/registry';
import type { FeatureContext } from '../core/registry/types';
import { mountDevConsole } from '../dev/console';
import { notConnectedSend } from '../net/commandBus';
import { httpDevServer } from '../net/devServer';
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

export async function resolveAutoDeployPlanetKind(opts: {
  readonly requestedKind: PlanetKind;
  readonly probeOnline: boolean;
  readonly probeActiveColony: () => Promise<unknown>;
  readonly getActiveColonyKind: () => PlanetKind | null;
}): Promise<PlanetKind> {
  if (opts.probeOnline) {
    await Promise.race([
      opts.probeActiveColony(),
      new Promise<null>((r) => setTimeout(() => r(null), 1500)),
    ]);
  } else {
    await new Promise((r) => setTimeout(r, 50));
  }
  return opts.getActiveColonyKind() ?? opts.requestedKind;
}

export function resolveHomeBaseDiveAngles(markers: readonly OrbitalGlobeMarkerInput[]): { yaw: number; pitch: number } {
  const home = markers.find((m) => m.isHomeBase);
  return home ? { yaw: home.yaw, pitch: home.pitch } : { yaw: 0, pitch: 0.08 };
}

const FORWARDED_ONLINE_QUERY_KEYS = [
  'host',
  'seed',
  'waves',
  'lag',
  'predict',
  'as',
  'daynight',
  'shadow',
  'colonyId',
] as const;

/**
 * Extracts session/runtime query parameters (`?host=local`, `?seed=<number|hash>`, `?waves=`, etc.)
 * from the initial `/play.html` URL while stripping orbital one-shot flags (`planet`, `skip`, `deploy`, `t`).
 */
export function buildForwardedOnlineSearch(rawSearch: string): string {
  if (!rawSearch) return '';
  const src = new URLSearchParams(rawSearch);
  const out = new URLSearchParams();
  for (const key of FORWARDED_ONLINE_QUERY_KEYS) {
    const val = src.get(key);
    if (val !== null && val.trim() !== '') out.set(key, val.trim());
  }
  const str = out.toString();
  return str ? `?${str}` : '';
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
  readonly search?: string;
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
    externalFrameLoop: true,
    search: opts.search ?? '',
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
  readonly search?: string;
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
    search: opts.search,
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
    if (st.disposeDeferred) st.disposeDeferred();
    else enqueueDeferredDispose(() => st.dispose());
  }
  getSharedTerrainPrep().unloadLanded(true);
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

/** Keeps `?planet=<kind>` in the URL while the orbital planet selector is open so F5 refreshes back to orbit. */
export function syncOrbitSelectorUrl(kind: PlanetKind): void {
  if (typeof history === 'undefined' || typeof location === 'undefined') return;
  const q = new URLSearchParams(location.search);
  q.set('planet', kind);
  q.delete('skip');
  q.delete('deploy');
  q.delete('t');
  history.replaceState(null, '', `${location.pathname}?${q.toString()}`);
}

export function mountPrototypeHudRig(store: ClientFlagsStore): {
  dispose(): void;
} {
  let featureHud: HudRoot | null = null;
  let devConsole: { dispose(): void } | null = null;
  const mount = () => {
    featureHud?.dispose();
    devConsole?.dispose();
    const { source } = store.current;
    const set = store.set;
    const ctx: FeatureContext = {
      flags: set,
      host: 'server',
      services: { track, flagsSource: source, sendCommand: notConnectedSend, devServer: httpDevServer() },
    };
    const features = loadFeatures({ flags: set, host: 'server' });
    featureHud = new HudRoot(document.body, features, ctx);
    if (ctx.services.awayDigest) {
      ctx.services.awayDigest.preserveWhile(() => featureHud?.closeAll());
    } else {
      featureHud.closeAll();
    }
    devConsole = mountDevConsole({ parent: document.body, features, ctx });
  };
  const offFlags = store.onChange(mount);
  mount();
  return {
    dispose() {
      offFlags();
      featureHud?.dispose();
      devConsole?.dispose();
    },
  };
}
