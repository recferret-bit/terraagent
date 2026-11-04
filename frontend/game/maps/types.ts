import type { MapLayerId, WaveId } from '@terra/contracts';
import type { ClientTiles, ClientView } from '../store/replica/viewCodec';
import type { CompositeMapRenderResult } from './builtinLayers';
import type { TrapezoidCorner } from './cameraTrapezoid';

export interface AxialToPixelFn {
  (q: number, r: number): { x: number; y: number };
}

export interface PixelToAxialFn {
  (x: number, y: number): { q: number; r: number };
}

export interface MapViewportTransform {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

export interface MapLayerDrawView {
  readonly width: number;
  readonly height: number;
  readonly planetId?: string;
  readonly radius: number;
  readonly tiles: ClientTiles | null;
  readonly clientView: ClientView | null;
  readonly ownColonySlot?: number;
  readonly colonyColors?: Record<number, number>;
  readonly axialToPixel: AxialToPixelFn;
  readonly pixelToAxial: PixelToAxialFn;
  readonly tilePixelRadius: number;
  readonly transform?: MapViewportTransform;
  readonly rasterCanvas?: HTMLCanvasElement | OffscreenCanvas | null;
}

export interface MapLayer {
  readonly id: MapLayerId;
  readonly label: string;
  readonly wave: WaveId;
  readonly defaultOn?: boolean;
  readonly order?: number;
  draw(ctx: CanvasRenderingContext2D, view: MapLayerDrawView): void;
}

export interface MinimapStats {
  dirtyTiles: number;
  totalRepaints: number;
  lastRadius: number;
  lastPlanetId: string | null;
  minimapRedraws: number;
  globalMapRedraws: number;
  minimapHz: number;
  globalMapHz: number;
  entityDotCount: number;
  globalMapOpen: boolean;
  activeLayers: MapLayerId[];
  registeredLayers: MapLayerId[];
  visibleLayers?: MapLayerId[];
  trapezoid?: TrapezoidCorner[];
  zoom?: number;
  panX?: number;
  panY?: number;
  lastComposite?: CompositeMapRenderResult | null;
}
