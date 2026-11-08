// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CANONICAL_PLANETS,
  parseWaves,
  type MapLayerId,
  type PlanetType,
} from '@terra/contracts';
import {
  buildAtlasManifest,
  createAtlasPlanetState,
  generateSmallAtlas,
  globalTileToSector,
  setTileOwner,
  view,
} from '@terra/sim';
import { resetGameInputBlock } from '../core/input/gameInputBlock';
import type { FeatureContext, GameView } from '../core/registry/types';
import { mountMapsFeature } from '../features/maps';
import { packView, unpackView } from '../store/replica/viewCodec';
import { buildDefaultPlanetSummaryV1, type SectorIntentV1 } from '../ui/lobby';
import {
  createAtlasMapAdapter,
  createClientTilesFromAtlas,
  createNoop2dContext,
  createMapLayerRegistry,
  drawSectorsLayer,
  drawTerritoryLayer,
  PlanetRasterCache,
  renderCompositeMapLayers,
  resolveTileColorFromTokens,
  type MapLayerDrawView,
} from './index';

afterEach(() => {
  resetGameInputBlock();
  document.body.replaceChildren();
});

const PROFILES: readonly PlanetType[] = ['desert', 'ocean', 'temperate'] as const;

function createTemperateSeamFixture() {
  const state = createAtlasPlanetState({
    planetType: 'temperate',
    seed: CANONICAL_PLANETS.temperate.seed,
    sectorRadius: 8,
  });
  state.grid.layers.explored.fill(0xff);
  const atlas = generateSmallAtlas({
    planetType: 'temperate',
    seed: CANONICAL_PLANETS.temperate.seed,
    sectorRadius: 8,
  });
  const manifest = buildAtlasManifest(atlas);
  const seamPair = atlas.partition.seamTiles.find(
    (s) =>
      s.sectorId === 'sec_0_0' &&
      s.crossSectorNeighbors.some((nb) => nb.sectorId === 'sec_1_0'),
  )!;
  const across = seamPair.crossSectorNeighbors.find((nb) => nb.sectorId === 'sec_1_0')!;
  const adapter = createAtlasMapAdapter({
    w11Enabled: true,
    manifest,
    tileCount: state.grid.count,
  });
  return { state, atlas, manifest, seamPair, across, adapter };
}

describe('W11-42 · 1. Three-profile seven-sector atlas picking & painting across negative coords and seams', () => {
  it('picks and paints the exact same canonical (q, r) tile and sectorId across desert, ocean, and temperate fixtures', () => {
    for (const planetType of PROFILES) {
      const def = CANONICAL_PLANETS[planetType];
      const atlas = generateSmallAtlas({
        planetId: def.id,
        planetType,
        seed: def.seed,
        sectorRadius: 8,
      });
      const manifest = buildAtlasManifest(atlas);
      const tiles = createClientTilesFromAtlas(atlas);
      const adapter = createAtlasMapAdapter({
        w11Enabled: true,
        manifest,
        atlas,
        tileCount: tiles.count,
      });

      expect(adapter.isAtlas).toBe(true);
      expect(manifest.landSectors).toBe(7);
      expect(manifest.oceanSectors).toBe(12);

      const negativeLandTiles = atlas.partition.tiles.filter(
        (t) => t.kind === 'land' && (t.q < 0 || t.r < 0),
      );
      expect(negativeLandTiles.length).toBeGreaterThan(200);

      const canvasSize = 640;
      for (let i = 0; i < negativeLandTiles.length; i += 19) {
        const sample = negativeLandTiles[i]!;
        const px = adapter.axialToPixel(sample.q, sample.r, canvasSize);
        const picked = adapter.pickAtCanvasPixel(px.x, px.y, canvasSize, tiles.count);
        expect(picked.q).toBe(sample.q);
        expect(picked.r).toBe(sample.r);
        expect(picked.sectorId).toBe(sample.sectorId);
        expect(picked.sectorId).toBe(globalTileToSector(sample.q, sample.r, 8).sectorId);
        expect(picked.inAtlas).toBe(true);
        expect(picked.playable).toBe(true);
        expect(picked.bufferIndex).toBe(sample.atlasIndex);
      }

      const landSeams = atlas.partition.seamTiles.filter(
        (s) => atlas.partition.sectorById.get(s.sectorId)?.kind === 'land',
      );
      expect(landSeams.length).toBeGreaterThan(100);
      for (let i = 0; i < landSeams.length; i += 7) {
        const seam = landSeams[i]!;
        const pt = adapter.axialToPixel(seam.q, seam.r, canvasSize);
        const hit = adapter.pickAtCanvasPixel(pt.x, pt.y, canvasSize, tiles.count);
        expect(hit.q).toBe(seam.q);
        expect(hit.r).toBe(seam.r);
        expect(hit.sectorId).toBe(seam.sectorId);
        for (const nb of seam.crossSectorNeighbors) {
          if (!nb.inAtlas) continue;
          const nbPt = adapter.axialToPixel(nb.q, nb.r, canvasSize);
          const nbHit = adapter.pickAtCanvasPixel(nbPt.x, nbPt.y, canvasSize, tiles.count);
          expect(nbHit.q).toBe(nb.q);
          expect(nbHit.r).toBe(nb.r);
          expect(nbHit.sectorId).toBe(nb.sectorId);
          expect(nbHit.sectorId).not.toBe(seam.sectorId);
        }
      }
    }
  });

  it('never turns ocean halo cells or outside-atlas cells into playable land tiles', () => {
    const atlas = generateSmallAtlas({
      planetType: 'ocean',
      seed: CANONICAL_PLANETS.ocean.seed,
      sectorRadius: 8,
    });
    const manifest = buildAtlasManifest(atlas);
    const tiles = createClientTilesFromAtlas(atlas);
    const adapter = createAtlasMapAdapter({ w11Enabled: true, manifest, atlas, tileCount: tiles.count });

    const oceanSec = atlas.partition.sectorById.get('sec_2_0')!;
    expect(oceanSec.kind).toBe('ocean');
    const oceanPick = adapter.pickTile(oceanSec.centerQ, oceanSec.centerR, tiles.count);
    expect(oceanPick.inAtlas).toBe(true);
    expect(oceanPick.kind).toBe('ocean');
    expect(oceanPick.playable).toBe(false);
    expect(adapter.isPlayableLandTile(oceanSec.centerQ, oceanSec.centerR)).toBe(false);

    const outsidePick = adapter.pickTile(999, -999, tiles.count);
    expect(outsidePick.inAtlas).toBe(false);
    expect(outsidePick.playable).toBe(false);
    expect(outsidePick.sectorId).toBeNull();
    expect(outsidePick.bufferIndex).toBe(-1);
    expect(adapter.tileIndexOf(999, -999, tiles.count)).toBe(-1);
  });
});

describe('W11-42 · 2. Cross-sector territory continuity vs distinct sector borders, occupancy & HOME cue', () => {
  it('suppresses false internal territory borders across 2-sector seams and 3-sector corners', () => {
    const { state, atlas, manifest, seamPair, across, adapter } = createTemperateSeamFixture();
    const idxA = adapter.tileIndexOf(seamPair.q, seamPair.r, state.grid.count);
    const idxB = adapter.tileIndexOf(across.q, across.r, state.grid.count);
    setTileOwner(state.grid, idxA, 0, 1);
    setTileOwner(state.grid, idxB, 0, 1);

    const clientView = unpackView(packView(view(state), true).view);
    const size = 640;
    const ctx = createNoop2dContext(document.createElement('canvas'));
    const drawView: MapLayerDrawView = {
      width: size,
      height: size,
      planetId: state.meta.planetId,
      radius: adapter.projectionRadius,
      tiles: clientView.tiles ?? null,
      clientView,
      ownColonySlot: 0,
      axialToPixel: (q, r) => adapter.axialToPixel(q, r, size),
      pixelToAxial: (x, y) => adapter.pixelToAxial(x, y, size),
      tilePixelRadius: adapter.tilePixelRadius(size),
      atlasAdapter: adapter,
      atlasManifest: manifest,
    };

    const territory = drawTerritoryLayer(ctx, drawView);
    expect(territory.ownedTileCount).toBe(2);
    expect(territory.borderEdgeCount).toBe(10);

    const triple = atlas.partition.cornerTriples.find((c) =>
      c.tiles.every((t) => atlas.partition.sectorById.get(t.sectorId)?.kind === 'land'),
    )!;
    for (const cornerTile of triple.tiles) {
      const cIdx = adapter.tileIndexOf(cornerTile.q, cornerTile.r, state.grid.count);
      setTileOwner(state.grid, cIdx, 1, 2);
    }
    const clientView2 = unpackView(packView(view(state), true).view);
    const territory2 = drawTerritoryLayer(ctx, {
      ...drawView,
      tiles: clientView2.tiles ?? null,
      clientView: clientView2,
    });
    expect(territory2.ownedTileCount).toBe(5);
    expect(territory2.borderEdgeCount).toBe(22);
  });

  it('renders distinct dashed sector borders, occupancy badges, selected sector highlight, and HOME/LOC cues', () => {
    const { state, manifest, seamPair, across, adapter } = createTemperateSeamFixture();
    const clientView = unpackView(packView(view(state), true).view);
    const size = 640;
    const ctx = createNoop2dContext(document.createElement('canvas'));
    const setLineDashSpy = vi.spyOn(ctx, 'setLineDash');
    const fillTextSpy = vi.spyOn(ctx, 'fillText');

    const summary = buildDefaultPlanetSummaryV1('forestRock');
    const drawView: MapLayerDrawView = {
      width: size,
      height: size,
      planetId: state.meta.planetId,
      radius: adapter.projectionRadius,
      tiles: clientView.tiles ?? null,
      clientView,
      ownColonySlot: 0,
      axialToPixel: (q, r) => adapter.axialToPixel(q, r, size),
      pixelToAxial: (x, y) => adapter.pixelToAxial(x, y, size),
      tilePixelRadius: adapter.tilePixelRadius(size),
      atlasAdapter: adapter,
      atlasManifest: manifest,
      sectorSummaries: summary.sectors,
      selectedSectorId: 'sec_1_0',
      homeSectorId: 'sec_0_0',
      homeTile: { q: seamPair.q, r: seamPair.r },
      currentSectorId: 'sec_1_0',
      cameraTile: { q: across.q, r: across.r },
    };

    const secSummary = drawSectorsLayer(ctx, drawView);
    expect(secSummary.landSectorCount).toBe(7);
    expect(secSummary.selectedSectorId).toBe('sec_1_0');
    expect(secSummary.homeSectorId).toBe('sec_0_0');
    expect(secSummary.homeMarker?.label).toBe('HOME · sec_0_0');
    expect(secSummary.locationMarker?.label).toBe('LOC · sec_1_0');
    expect(secSummary.sectors.find((s) => s.sectorId === 'sec_0_0')?.occupancyText).toBe('4/4');
    expect(secSummary.sectors.find((s) => s.sectorId === 'sec_1_0')?.isSelected).toBe(true);
    expect(secSummary.sectors.find((s) => s.kind === 'ocean')?.occupancyText).toBe('OCEAN');
    expect(setLineDashSpy).toHaveBeenCalledWith([7, 2]);
    expect(fillTextSpy).toHaveBeenCalledWith('HOME · sec_0_0', expect.any(Number), expect.any(Number));

    const comp = renderCompositeMapLayers(
      ctx,
      drawView,
      new Set<MapLayerId>(['territory', 'sectors']),
    );
    expect(comp.drawnLayers).toEqual(['territory', 'sectors']);
    expect(comp.sectors?.selectedSectorId).toBe('sec_1_0');
  });
});

describe('W11-42 · 3. Sector selection, simple picker integration, and minimap pan isolation', () => {
  it('synchronizes map sector selection with the simple sector chooser while panToTile only focuses the camera', () => {
    const flags = new Set<string>(parseWaves('..11').list);
    const focusTile = vi.fn();
    const reserveSeatSpy = vi.fn();
    const moveUnitSpy = vi.fn();
    const ctx = {
      flags,
      host: 'server',
      services: { colonyId: 0, focusTile },
    } as unknown as FeatureContext;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const panel = mountMapsFeature(
      host,
      ctx,
      createMapLayerRegistry(),
      new PlanetRasterCache(resolveTileColorFromTokens),
    );
    const maps = ctx.services.maps!;

    const state = createAtlasPlanetState({
      planetType: 'desert',
      seed: CANONICAL_PLANETS.desert.seed,
      sectorRadius: 8,
    });
    const unpacked = unpackView(packView(view(state), true).view);
    const summary = buildDefaultPlanetSummaryV1('dune');
    maps.setPlanetSummary(summary);
    maps.setHomeContext({ homeSectorId: 'sec_0_0', homeTile: { q: 0, r: 0 } });
    panel.update?.(unpacked as unknown as GameView);

    const pickerEl = document.createElement('div');
    const intents: SectorIntentV1[] = [];
    const unbind = maps.bindSectorPicker(pickerEl, summary, (intent) => intents.push(intent));

    const secBtn = pickerEl.querySelector<HTMLButtonElement>('[data-sector-id="sec_-1_1"]')!;
    secBtn.click();
    expect(maps.getSelectedSectorId()).toBe('sec_-1_1');
    expect(maps.getSectorIntent()).toEqual({ mode: 'chosen', sectorId: 'sec_-1_1' });
    expect(secBtn.classList.contains('sel')).toBe(true);
    expect(focusTile).not.toHaveBeenCalled();

    maps.openGlobalMap();
    const negCenter = maps.controller.getActiveAdapter().sectorLocalToGlobal('sec_0_-1', 0, 0);
    const canvasPt = maps.controller.tileToGlobalCanvasPx(negCenter.q, negCenter.r);
    const picked = maps.controller.selectSectorAtCanvasPx(canvasPt.x, canvasPt.y);
    expect(picked).toEqual({ mode: 'chosen', sectorId: 'sec_0_-1' });
    expect(pickerEl.querySelector('[data-sector-id="sec_0_-1"]')?.classList.contains('sel')).toBe(true);
    expect(maps.controller.globalOverlay.readoutEl.textContent).toContain('SECTOR sec_0_-1');
    expect(maps.controller.globalOverlay.readoutEl.textContent).toContain('HOME sec_0_0');

    const oceanCenter = maps.controller.getActiveAdapter().sectorLocalToGlobal('sec_2_0', 0, 0);
    expect(maps.selectSectorAtTile(oceanCenter.q, oceanCenter.r)).toBeNull();
    expect(maps.selectSector('sec_2_0')).toEqual({ mode: 'chosen', sectorId: 'sec_0_-1' });

    maps.panToTile(-12, 8);
    expect(focusTile).toHaveBeenCalledWith(-12, 8, true);
    expect(maps.getSelectedSectorId()).toBe('sec_0_-1');
    expect(reserveSeatSpy).not.toHaveBeenCalled();
    expect(moveUnitSpy).not.toHaveBeenCalled();

    maps.controller.globalViewport.setZoom(2);
    maps.controller.globalViewport.panBy(30, -20);
    const zoomedPt = maps.controller.tileToGlobalCanvasPx(negCenter.q, negCenter.r);
    const roundTrip = maps.controller.globalCanvasPxToTile(zoomedPt.x, zoomedPt.y);
    expect(roundTrip.q).toBe(negCenter.q);
    expect(roundTrip.r).toBe(negCenter.r);
    expect(roundTrip.sectorId).toBe('sec_0_-1');

    unbind();
    panel.dispose();
  });
});

describe('W11-42 · 4. Cache invalidation and W11 flag-off behavior', () => {
  it('invalidates raster, fog, and selection state when switching planetId, atlasHash, viewerColony, or toggling W11 off', () => {
    const flags = new Set<string>(parseWaves('..11').list);
    const services: { colonyId: number; maps?: ReturnType<typeof mountMapsFeature> } = {
      colonyId: 0,
    };
    const ctx = { flags, host: 'server', services } as unknown as FeatureContext;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const panel = mountMapsFeature(
      host,
      ctx,
      createMapLayerRegistry(),
      new PlanetRasterCache(resolveTileColorFromTokens),
    );
    const maps = ctx.services.maps!;

    const desertState = createAtlasPlanetState({
      planetType: 'desert',
      seed: CANONICAL_PLANETS.desert.seed,
      sectorRadius: 8,
    });
    const desertView = unpackView(packView(view(desertState), true).view);
    panel.update?.(desertView as unknown as GameView);
    maps.selectSector('sec_1_0');

    const key1 = maps.stats.lastPlanetId;
    const repaints1 = maps.stats.totalRepaints;
    expect(key1).toContain('atlas=');
    expect(key1).toContain('col=0');
    expect(maps.getSelectedSectorId()).toBe('sec_1_0');
    expect(maps.getVisibleLayers().map((l) => l.id)).toContain('sectors');

    services.colonyId = 9;
    panel.update?.(desertView as unknown as GameView);
    const key2 = maps.stats.lastPlanetId;
    expect(key2).not.toBe(key1);
    expect(key2).toContain('col=9');
    expect(maps.stats.totalRepaints).toBeGreaterThan(repaints1);

    const repaints2 = maps.stats.totalRepaints;
    maps.setAtlasManifest({
      ...buildAtlasManifest(
        generateSmallAtlas({
          planetType: 'desert',
          seed: CANONICAL_PLANETS.desert.seed,
          sectorRadius: 8,
        }),
      ),
      atlasHash: 'w11-mutated-atlas-hash-v2',
    });
    panel.update?.(desertView as unknown as GameView);
    expect(maps.stats.lastPlanetId).toContain('atlas=w11-mutated-atlas-hash-v2');
    expect(maps.getSelectedSectorId()).toBeNull();
    expect(maps.stats.totalRepaints).toBeGreaterThan(repaints2);

    maps.selectSector('sec_0_0');
    maps.setAtlasManifest(null);
    const tempState = createAtlasPlanetState({
      planetType: 'temperate',
      seed: CANONICAL_PLANETS.temperate.seed,
      sectorRadius: 8,
    });
    const tempView = unpackView(packView(view(tempState), true).view);
    panel.update?.(tempView as unknown as GameView);
    expect(maps.getSelectedSectorId()).toBeNull();
    expect(maps.stats.lastPlanetId).toContain(tempState.meta.planetId);

    maps.selectSector('sec_1_-1');
    flags.delete('W11');
    panel.update?.(tempView as unknown as GameView);

    expect(maps.getVisibleLayers().map((l) => l.id)).not.toContain('sectors');
    expect(
      maps.controller.globalOverlay.chipBarEl.querySelector('[data-layer="sectors"]'),
    ).toBeNull();
    expect(maps.getSelectedSectorId()).toBeNull();
    expect(maps.getSectorIntent()).toEqual({ mode: 'auto' });
    expect(maps.controller.getActiveAdapter().isAtlas).toBe(false);

    panel.dispose();
  });
});
