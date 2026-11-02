import { PLANET_KINDS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import { isPixelArtOn } from '@terra/render/core/pixelArtPass';
import type { ArchetypeCategory } from '@terra/render/kitbash';

export type View = 'iso' | 'front' | 'side' | 'top';
export const VIEWS: View[] = ['iso', 'front', 'side', 'top'];
export const CATS: ArchetypeCategory[] = ['robot', 'building', 'ship', 'resource', 'fauna', 'prop'];
export const PLANET_LABEL: Record<PlanetKind, string> = { dune: 'Dune', oceanForest: 'Ocean', forestRock: 'Forest' };
export type ToggleKey = 'turntable' | 'bloom' | 'pixel' | 'wire' | 'grid' | 'shadows' | 'hex' | 'human' | 'ruler' | 'surface' | 'hexTerrain' | 'hatch' | 'work' | 'row' | 'validate';
export const TOGGLES: ToggleKey[] = ['turntable', 'bloom', 'pixel', 'wire', 'grid', 'shadows', 'hex', 'human', 'ruler', 'surface', 'hexTerrain', 'hatch', 'work', 'row', 'validate'];
/** Construction scaffold stages the `build` button cycles through (`&build=0|33|66|100`). */
export const BUILD_STAGES = [1, 0, 0.33, 0.66] as const;
export type BuildStage = (typeof BUILD_STAGES)[number];
const parseBuild = (v: string | null): BuildStage => ({ '0': 0, '33': 0.33, '66': 0.66 } as Record<string, BuildStage>)[v ?? ''] ?? 1;

export interface PgState {
  id: string; kind: PlanetKind; view: View;
  turntable: boolean; bloom: boolean; pixel: boolean; wire: boolean; grid: boolean; shadows: boolean; hex: boolean; human: boolean; ruler: boolean; surface: boolean; validate: boolean;
  /** Hex terrain sample scene, its colour-blind border hatch, and the biped work pose (`uWorkWeight` 1). */
  hexTerrain: boolean; hatch: boolean; work: boolean;
  /** Construction scaffold stage of the shown archetypes (1 = complete). */
  build: BuildStage;
  row: ArchetypeCategory | null; filter: string;
}

/** Initial state from the URL parameters documented in README.md. */
export function createState(params: URLSearchParams): PgState {
  const row = params.get('row') as ArchetypeCategory;
  return {
    id: '',
    kind: (PLANET_KINDS.includes(params.get('biome') as PlanetKind) ? params.get('biome') : 'dune') as PlanetKind,
    view: (VIEWS.includes(params.get('view') as View) ? params.get('view') : 'iso') as View,
    turntable: params.get('turntable') === '1',
    bloom: true, pixel: params.has('pixel') ? params.get('pixel') === '1' : isPixelArtOn(), wire: false, grid: true, shadows: true, hex: false, human: false, ruler: true, surface: params.get('surface') === '1', validate: params.get('validate') === '1',
    hexTerrain: params.get('hexterrain') === '1', hatch: params.get('hatch') === '1', work: params.get('work') === '1',
    build: parseBuild(params.get('build')),
    row: row && CATS.includes(row) ? row : null,
    filter: '',
  };
}

export function syncURL(state: PgState) {
  const q = new URLSearchParams();
  if (state.id) q.set('inspect', state.id);
  q.set('biome', state.kind); q.set('view', state.view);
  if (state.row) q.set('row', state.row);
  if (state.surface) q.set('surface', '1');
  if (state.hexTerrain) q.set('hexterrain', '1');
  if (state.hatch) q.set('hatch', '1');
  if (state.work) q.set('work', '1');
  if (state.build !== 1) q.set('build', String(Math.round(state.build * 100)));
  if (state.turntable) q.set('turntable', '1');
  if (state.pixel) q.set('pixel', '1');
  if (state.validate) q.set('validate', '1');
  history.replaceState(null, '', `${location.pathname}?${q}`);
}
