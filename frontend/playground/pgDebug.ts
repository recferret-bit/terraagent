import type * as THREE from 'three';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import {
  addArchetypeLight,
  exportArchetypeLightsCode,
  getArchetypeLights,
  removeArchetypeLight,
  resetArchetypeLights,
  updateArchetypeLight,
  type ArchetypeLightSource,
} from '@terra/render/lighting/archetypeLights';
import { validateArchetype } from '@terra/render/kitbash/validate';
import { ParticlePresetRegistry, validateParticlePreset, type InteractionTargetKind } from '@terra/render/particles';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import type { DepositVisualStage } from '@terra/render/kitbash';
import type { HexTerrain, TileStatePreset } from '@terra/render/planets/hex';
import type { CameraRig } from './camera/CameraRig';
import type { FaunaSceneHost } from './content/FaunaSceneHost';
import type { MarchSceneHost, MarchPace } from './content/marchScene';
import type { Spawn } from './content/SpawnSet';
import type { WildlifeSceneHost } from './content/WildlifeSceneHost';
import type { BuildStage, FaunaMode, FaunaSceneKind, PgState, ToggleKey, VertebratePoseMode, View } from './state';

export interface PlaygroundDebugApiDeps {
  state: PgState;
  viewport: ColonyViewport;
  cam: CameraRig;
  spawns: () => Spawn[];
  hexTerrain: () => HexTerrain | null;
  faunaHost: FaunaSceneHost;
  wildlifeHost: WildlifeSceneHost;
  marchHost: MarchSceneHost;
  select: (id: string) => void;
  setView: (v: View) => void;
  setPlanet: (k: PlanetKind) => void;
  toggle: (k: ToggleKey) => void;
  contactSheet: () => string;
  setBuild: (s: BuildStage) => void;
  setWorkTarget: (t: InteractionTargetKind, enableWork?: boolean) => void;
  setDepositStage: (s: DepositVisualStage) => void;
  setTileState: (ts: TileStatePreset) => void;
  setFaunaScene: (scene: FaunaSceneKind | null, opts?: { mode?: FaunaMode; seed?: number }) => unknown;
  setFaunaMode: (mode: FaunaMode) => unknown;
  setFaunaSeed: (seed: number) => unknown;
  pauseFauna: (paused?: boolean) => unknown;
  stepFauna: (ticks?: number) => unknown;
  resetFauna: (seed?: number) => unknown;
  triggerAcidPreview: () => unknown;
  setVertebratePose: (pose: VertebratePoseMode) => VertebratePoseMode;
  setWildlifeScene: (k: PlanetKind | null, hour?: number) => unknown;
  setWildlifeHour: (hour: number) => unknown;
  setMarch: (pace: MarchPace | null) => unknown;
  setMarchRock: (rock: boolean) => unknown;
  stepMarch: (ticks?: number) => unknown;
  resetMarch: () => unknown;
}

export function createPlaygroundDebug(d: PlaygroundDebugApiDeps) {
  const { state, viewport } = d;
  return {
    state,
    select: (id: string) => d.select(id),
    validate: (id = state.id) => (id.startsWith('flora.') ? null : validateArchetype(id)),
    setView: (v: View) => d.setView(v),
    setPlanet: (k: PlanetKind) => d.setPlanet(k),
    toggle: (k: ToggleKey) => d.toggle(k),
    contactSheet: () => d.contactSheet(),
    viewport,
    camera: viewport.camera as THREE.PerspectiveCamera,
    controls: d.cam.controls,
    spawns: d.spawns,
    setBuild: (s: BuildStage) => d.setBuild(s),
    setRuin: (on: boolean) => { if (state.ruin !== on) d.toggle('ruin'); },
    setWorkTarget: (t: InteractionTargetKind, enableWork = true) => d.setWorkTarget(t, enableWork),
    validateParticles: (targetOrId: string = state.workTarget) =>
      validateParticlePreset(ParticlePresetRegistry.get(targetOrId) ?? ParticlePresetRegistry.getByTargetKind(targetOrId as InteractionTargetKind)),
    setDepositStage: (s: DepositVisualStage) => d.setDepositStage(s),
    setTileState: (ts: TileStatePreset) => d.setTileState(ts),
    getTileState: () => state.tileState,
    hexTerrain: d.hexTerrain,
    getLights: (id = state.id) => getArchetypeLights(id),
    addLight: (patch?: Partial<ArchetypeLightSource>, id = state.id) => addArchetypeLight(id, patch),
    removeLight: (idx: number | string, id = state.id) => removeArchetypeLight(id, idx),
    updateLight: (idx: number, patch: Partial<ArchetypeLightSource>, id = state.id) => updateArchetypeLight(id, idx, patch),
    resetLights: (id = state.id) => resetArchetypeLights(id),
    exportLightsCode: (id = state.id) => exportArchetypeLightsCode(id),
    faunaHost: d.faunaHost,
    setFaunaScene: (scene: FaunaSceneKind | null, opts?: { mode?: FaunaMode; seed?: number }) => d.setFaunaScene(scene, opts),
    setFaunaMode: (mode: FaunaMode) => d.setFaunaMode(mode),
    setFaunaSeed: (seed: number) => d.setFaunaSeed(seed),
    pauseFauna: (paused?: boolean) => d.pauseFauna(paused),
    stepFauna: (ticks = 1) => d.stepFauna(ticks),
    resetFauna: (seed?: number) => d.resetFauna(seed),
    triggerAcidPreview: () => d.triggerAcidPreview(),
    getFaunaStats: () => d.faunaHost.getStats(),
    setVertebratePose: (pose: VertebratePoseMode) => d.setVertebratePose(pose),
    wildlifeHost: d.wildlifeHost,
    setWildlifeScene: (k: PlanetKind | null, hour?: number) => d.setWildlifeScene(k, hour),
    setWildlifeHour: (hour: number) => d.setWildlifeHour(hour),
    scareWildlife: () => d.wildlifeHost.triggerScare(),
    stepWildlife: (s = 1) => d.wildlifeHost.step(s),
    getWildlifeStats: () => d.wildlifeHost.getStats(),
    setMarch: (pace: MarchPace | null) => d.setMarch(pace),
    setMarchRock: (rock: boolean) => d.setMarchRock(rock),
    orderMarch: () => d.marchHost.order(),
    stepMarch: (ticks = 1) => d.stepMarch(ticks),
    resetMarch: () => d.resetMarch(),
    getMarchStats: () => d.marchHost.getStats(),
  };
}
