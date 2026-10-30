import { PLANET_KINDS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import { isPixelArtOn } from '@terra/render/core/pixelArtPass';
import type { ArchetypeCategory } from '@terra/render/kitbash';

export type View = 'iso' | 'front' | 'side' | 'top';
export const VIEWS: View[] = ['iso', 'front', 'side', 'top'];
export const CATS: ArchetypeCategory[] = ['robot', 'building', 'ship', 'resource', 'fauna', 'prop'];
export const PLANET_LABEL: Record<PlanetKind, string> = { dune: 'Dune', oceanForest: 'Ocean', forestRock: 'Forest' };
export type ToggleKey = 'turntable' | 'bloom' | 'pixel' | 'wire' | 'grid' | 'shadows' | 'hex' | 'human' | 'ruler' | 'surface' | 'row' | 'validate';
export const TOGGLES: ToggleKey[] = ['turntable', 'bloom', 'pixel', 'wire', 'grid', 'shadows', 'hex', 'human', 'ruler', 'surface', 'row', 'validate'];

export interface PgState {
  id: string; kind: PlanetKind; view: View;
  turntable: boolean; bloom: boolean; pixel: boolean; wire: boolean; grid: boolean; shadows: boolean; hex: boolean; human: boolean; ruler: boolean; surface: boolean; validate: boolean;
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
  if (state.turntable) q.set('turntable', '1');
  if (state.pixel) q.set('pixel', '1');
  if (state.validate) q.set('validate', '1');
  history.replaceState(null, '', `${location.pathname}?${q}`);
}
