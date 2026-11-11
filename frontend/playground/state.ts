import { PLANET_KINDS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import { isPixelArtOn } from '@terra/render/core/pixelArtPass';
import { DEPOSIT_STAGES, type ArchetypeCategory, type DepositVisualStage } from '@terra/render/kitbash';
import { reconFactionPalette } from '@terra/render/kitbash/archetypes/units/reconFaction';
import type { InteractionTargetKind } from '@terra/render/particles';
import { TILE_STATE_PRESETS, type TileStatePreset } from '@terra/render/planets/hex';

export type View = 'iso' | 'front' | 'side' | 'top';
export const VIEWS: View[] = ['iso', 'front', 'side', 'top'];
export const CATS: ArchetypeCategory[] = ['robot', 'building', 'ship', 'resource', 'fauna', 'prop'];
export const PLANET_LABEL: Record<PlanetKind, string> = { dune: 'Dune', oceanForest: 'Ocean', forestRock: 'Forest' };
export type ToggleKey = 'turntable' | 'bloom' | 'pixel' | 'wire' | 'shadows' | 'human' | 'surface' | 'hexTerrain' | 'work' | 'row' | 'validate' | 'lights' | 'ruin';
export const TOGGLES: ToggleKey[] = ['turntable', 'bloom', 'pixel', 'wire', 'shadows', 'human', 'surface', 'hexTerrain', 'work', 'row', 'validate', 'lights', 'ruin'];
/** Construction scaffold stages the `build` button cycles through (`&build=0|33|66|100`). */
export const BUILD_STAGES = [1, 0, 0.33, 0.66] as const;
export type BuildStage = (typeof BUILD_STAGES)[number];
export const WORK_TARGETS: InteractionTargetKind[] = ['tree', 'rock', 'dune', 'hole', 'flat', 'metals', 'minerals', 'oil', 'repair'];
export type FaunaSceneKind = 'blackAnt' | 'blueBeetle' | 'greenSpitter' | 'mixed';
export const FAUNA_SCENES: readonly FaunaSceneKind[] = ['blackAnt', 'blueBeetle', 'greenSpitter', 'mixed'] as const;
export type FaunaMode = 'passive' | 'aggressive' | 'gallery' | 'turrets' | 'units' | 'bugs' | 'robots';
export const FAUNA_MODES: readonly FaunaMode[] = ['passive', 'aggressive', 'gallery', 'turrets', 'units', 'bugs', 'robots'] as const;
export type MarchPace = 'own' | 'together';
export const MARCH_PACES: readonly MarchPace[] = ['own', 'together'] as const;

const parseBuild = (v: string | null): BuildStage => ({ '0': 0, '33': 0.33, '66': 0.66 } as Record<string, BuildStage>)[v ?? ''] ?? 1;
const parseDepositStage = (v: string | null): DepositVisualStage =>
  DEPOSIT_STAGES.includes(v as DepositVisualStage) ? (v as DepositVisualStage) : 'full';
const parseTileState = (v: string | null): TileStatePreset =>
  TILE_STATE_PRESETS.includes(v as TileStatePreset) ? (v as TileStatePreset) : 'prepared';
const parseWorkTarget = (v: string | null): InteractionTargetKind =>
  WORK_TARGETS.includes(v as InteractionTargetKind) ? (v as InteractionTargetKind) : 'tree';
const parseFaunaScene = (v: string | null): FaunaSceneKind | null =>
  FAUNA_SCENES.includes(v as FaunaSceneKind) ? (v as FaunaSceneKind) : null;
const parseFaunaMode = (v: string | null): FaunaMode =>
  v === 'turrets' || v === 'units' ? 'gallery' : FAUNA_MODES.includes(v as FaunaMode) ? (v as FaunaMode) : 'bugs';
const parseMarch = (v: string | null): MarchPace | null => (v === '1' || v === 'own' ? 'own' : v === 'together' ? 'together' : null);
/** `mercenary` selects that paint; a missing or unknown value stays the default recon. */
const parseFaction = (v: string | null): string | null => {
  const palette = reconFactionPalette(v);
  return palette.id === 'default' ? null : palette.id;
};
const parseFaunaSeed = (v: string | null): number => {
  if (v === null || v.trim() === '') return 42;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 42;
};

export interface PgState {
  id: string; kind: PlanetKind; view: View;
  turntable: boolean; bloom: boolean; pixel: boolean; wire: boolean; grid: boolean; shadows: boolean; hex: boolean; human: boolean; ruler: boolean; surface: boolean; validate: boolean; lights: boolean; ruin: boolean;
  /** Hex terrain sample scene (`hexterrain=1`) and the biped work pose (`uWorkWeight` 1). */
  hexTerrain: boolean; hatch: boolean; work: boolean;
  /** Target interaction object when `work` is enabled (`&workTarget=tree|rock|dune|...`). */
  workTarget: InteractionTargetKind;
  /** Construction scaffold stage of the shown archetypes (1 = complete). */
  build: BuildStage;
  /** Visual stage of resource deposits (`full` | `half` | `depleted`). */
  depositStage: DepositVisualStage;
  /** Tile preparation state preset (`prepared` | `irrigated` | `living` | `mixed`) on the sample hex terrain. */
  tileState: TileStatePreset;
  /** Active seeded hive-life playground scene (`blackAnt` | `blueBeetle` | `greenSpitter` | `mixed` | `null`). */
  faunaScene: FaunaSceneKind | null;
  /** Hive-life behavior mode (bug attack, robot attack, gallery or legacy ambient previews). */
  faunaMode: FaunaMode;
  /** Deterministic PRNG seed for the hive-life scene (`&faunaSeed=<int>`, default 42). */
  faunaSeed: number;
  /** Group march scene (`&march=own|together`). `1` is own pace. */
  march: MarchPace | null;
  /** Block the ordered hex with rock (`&marchRock=1`). */
  marchRock: boolean;
  /** Kitbash paint (`&faction=mercenary`). Null keeps the default palette. */
  faction: string | null;
  row: ArchetypeCategory | null; filter: string;
}

/** Initial state from the URL parameters documented in README.md. */
export function createState(params: URLSearchParams): PgState {
  const row = params.get('row') as ArchetypeCategory;
  const rawTileState = params.get('tileState') ?? params.get('tilestate');
  const surface = params.get('surface') === '1';
  const hexTerrain = params.get('hexterrain') === '1' || (Boolean(rawTileState) && !surface);
  const march = parseMarch(params.get('march'));
  return {
    id: '',
    kind: (PLANET_KINDS.includes(params.get('biome') as PlanetKind) ? params.get('biome') : 'dune') as PlanetKind,
    view: (VIEWS.includes(params.get('view') as View) ? params.get('view') : 'iso') as View,
    turntable: params.get('turntable') === '1',
    bloom: true, pixel: params.has('pixel') ? params.get('pixel') === '1' : isPixelArtOn(), wire: false, grid: true, shadows: true, hex: false, human: false, ruler: false, surface, validate: params.get('validate') === '1', lights: params.get('lights') === '1', ruin: params.get('ruin') === '1',
    hexTerrain, hatch: false, work: params.get('work') === '1',
    workTarget: parseWorkTarget(params.get('workTarget')),
    build: parseBuild(params.get('build')),
    depositStage: parseDepositStage(params.get('depositStage') ?? params.get('stage')), // `stage`: short alias
    tileState: parseTileState(rawTileState),
    faunaScene: march ? null : parseFaunaScene(params.get('faunaScene')),
    faunaMode: parseFaunaMode(params.get('faunaMode')),
    faunaSeed: parseFaunaSeed(params.get('faunaSeed')),
    march,
    marchRock: params.get('marchRock') === '1',
    faction: parseFaction(params.get('faction')),
    row: row && CATS.includes(row) ? row : null,
    filter: '',
  };
}

export function syncURL(state: PgState): URLSearchParams {
  const q = new URLSearchParams();
  if (state.id) q.set('inspect', state.id);
  q.set('biome', state.kind); q.set('view', state.view);
  if (state.row) q.set('row', state.row);
  if (state.surface) q.set('surface', '1');
  if (state.hexTerrain) q.set('hexterrain', '1');
  if (state.work) q.set('work', '1');
  if (state.workTarget !== 'tree') q.set('workTarget', state.workTarget);
  if (state.build !== 1) q.set('build', String(Math.round(state.build * 100)));
  if (state.depositStage !== 'full') q.set('depositStage', state.depositStage); // the documented name
  if (state.tileState !== 'prepared') q.set('tileState', state.tileState);
  if (state.turntable) q.set('turntable', '1');
  if (state.pixel) q.set('pixel', '1');
  if (state.validate) q.set('validate', '1');
  if (state.lights) q.set('lights', '1');
  if (state.ruin) q.set('ruin', '1');
  if (state.faunaScene !== null) {
    q.set('faunaScene', state.faunaScene);
    q.set('faunaMode', state.faunaMode);
    q.set('faunaSeed', String(Math.trunc(state.faunaSeed)));
  }
  if (state.march) q.set('march', state.march);
  if (state.marchRock) q.set('marchRock', '1');
  if (state.faction) q.set('faction', state.faction);
  if (typeof history !== 'undefined' && typeof location !== 'undefined') {
    history.replaceState(null, '', `${location.pathname}?${q}`);
  }
  return q;
}
