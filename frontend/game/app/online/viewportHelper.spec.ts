// @vitest-environment jsdom
import * as THREE from 'three';
import { flagsFromList } from '@terra/contracts';
import { allModules, compileData, createPlanet, SIM_VERSION, SimHost } from '@terra/sim';
import { PLANET_SPECS } from '@terra/render/planets/PlanetSpec';
import {
  computeEffectiveHeights,
  createHexTerrain,
  HEX_TERRAIN,
  isHexBeachSandAtPoint,
  makeHeightSampler,
  placeFloraByCellsWithExclusion,
  renderedFloraOuterRadius,
  specForPlanetType,
  tileAt,
  tileShoreFactor,
  tileXZ,
  type HexTerrain,
} from '@terra/render/planets/hex';
import { hexIndex } from '@terra/sim/grid/hex';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalTransport } from '../../net/LocalTransport';
import { ReplicaCore } from '../../store/replica/ReplicaCore';
import { packView, unpackView, type ClientTiles } from '../../store/replica/viewCodec';
import { MainMenu } from '../../ui/menu';
import { buildForwardedOnlineSearch } from '../colonyEntryBridge';
import { bootAuthAndHome } from './bootOnline';
import {
  applyTerrainTileChanges, bindLocalSaveListeners, changedTiles, createSafeViewport, isEscapeBlockedByHudOverlay, listSceneEntities,
  parseGroundSeedInput, PLANET_KIND_SESSION_KEY, pickTerrainAt, projectTileToScreen, readStoredPlanetKind, resolveOnlinePlanetLook,
  resolveSessionPlanetKind, syncOrRebuildSessionTerrain, syncSpaceTerrainOffset,
} from './viewportHelper';

const tiles = (n: number, patch: Partial<Record<'height' | 'terrain' | 'prep' | 'deposit' | 'owner', [number, number]>> = {}): ClientTiles => {
  const t = {
    count: n, height: new Float32Array(n), terrain: new Uint8Array(n), prep: new Uint8Array(n),
    deposit: new Uint8Array(n), owner: new Uint8Array(n),
  } as unknown as ClientTiles;
  for (const [k, [i, v]] of Object.entries(patch)) (t as unknown as Record<string, number[]>)[k][i] = v;
  return t;
};

/** A flat terrain stub: height 2 everywhere, `pick` records what it was asked. */
const flatTerrain = () => {
  const pick = vi.fn(() => ({ q: 1, r: 2 }));
  return { terrain: { group: new THREE.Group(), heightAt: () => 2, pick } as unknown as HexTerrain, pick };
};

/** A viewport whose canvas sits at (100, 50), 400 × 200, looking straight down at the origin. */
const viewportAt = () => {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 200, right: 500, bottom: 250, x: 100, y: 50, toJSON() {} });
  const camera = new THREE.PerspectiveCamera(28, 2, 0.1, 1000);
  camera.position.set(0, 50, 0.001);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return { renderer: { domElement: canvas }, camera } as unknown as ColonyViewport;
};

afterEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
  localStorage.clear();
});

describe('viewportHelper: tiles and planet look', () => {
  it('changedTiles lists exactly the indices whose height, terrain, prep, deposit or owner differ', () => {
    expect(changedTiles(tiles(6), tiles(6))).toEqual([]);
    const b = tiles(6, { height: [0, 1.5], terrain: [1, 2], prep: [2, 1], deposit: [3, 4], owner: [4, 1] });
    expect(changedTiles(tiles(6), b)).toEqual([0, 1, 2, 3, 4]);
    const noLayers = { ...tiles(2), deposit: undefined, owner: undefined } as unknown as ClientTiles;
    expect(changedTiles(noLayers, noLayers)).toEqual([]);
  });

  it('changedTiles sees a deposit tier change alone, and richness only when it crosses a visual stage', () => {
    const withLayers = (tier: number[], rich: number[]) =>
      ({ ...tiles(4), depositTier: Uint8Array.from(tier), richness: Float32Array.from(rich) }) as ClientTiles;
    const a = withLayers([0, 0, 0, 0], [10000, 10000, 4000, 100]);
    // tile 0: tier 0 -> 2; tile 1: drained but still `full`; tile 2: `half` -> still `half`; tile 3: `half` -> `depleted`
    const b = withLayers([2, 0, 0, 0], [10000, 9000, 3000, 0]);
    expect(changedTiles(a, b)).toEqual([0, 3]);
    const c = withLayers([0, 0, 0, 0], [5000, 10000, 4000, 100]); // tile 0: `full` -> `half`
    expect(changedTiles(a, c)).toEqual([0]);
  });

  it('applyTerrainTileChanges runs one incremental update and never writes into the previous snapshot', () => {
    const prev = tiles(6);
    const next = tiles(6, { terrain: [2, 1], prep: [2, 3] });
    const updateTiles = vi.fn();
    const setTileState = vi.fn();
    const terrain = { updateTiles, setTileState } as unknown as HexTerrain;
    applyTerrainTileChanges(terrain, prev, next, 6);
    expect(updateTiles).toHaveBeenCalledTimes(1);
    expect(updateTiles).toHaveBeenCalledWith(next, [2]);
    expect(setTileState).not.toHaveBeenCalled();
    expect(Array.from(prev.terrain)).toEqual([0, 0, 0, 0, 0, 0]);
    applyTerrainTileChanges(terrain, next, next, 6);
    expect(updateTiles).toHaveBeenCalledTimes(1); // nothing changed: no rebuild
  });

  it('the sim planet type decides the look; the orbit pick only fills in for an unknown type; else temperate', () => {
    expect(resolveOnlinePlanetLook('ocean', 'dune')).toBe(specForPlanetType('ocean'));
    expect(resolveOnlinePlanetLook('flat', 'dune')).toBe(PLANET_SPECS.dune);
    expect(resolveOnlinePlanetLook('flat', null)).toBe(specForPlanetType('temperate'));
    // Every player joining the same authoritative planet seed derives the exact same deterministic 32-bit look seed
    const playerA = resolveOnlinePlanetLook('ocean', 'dune', 'mp-seed-alpha');
    const playerB = resolveOnlinePlanetLook('ocean', 'forestRock', 'mp-seed-alpha');
    const otherPlanet = resolveOnlinePlanetLook('ocean', 'oceanForest', 'mp-seed-beta');
    expect(playerA.kind).toBe('oceanForest');
    expect(playerA.seed).toBe(playerB.seed);
    expect(playerA.seed).not.toBe(otherPlanet.seed);
  });
});

describe('viewportHelper: the session planet kind (orbit pick)', () => {
  it('?planet= wins over the stored pick and is stored in session and local storage', () => {
    sessionStorage.setItem(PLANET_KIND_SESSION_KEY, 'forestRock');
    expect(resolveSessionPlanetKind(new URLSearchParams('planet=dune'))).toBe('dune');
    expect([sessionStorage.getItem(PLANET_KIND_SESSION_KEY), localStorage.getItem(PLANET_KIND_SESSION_KEY)]).toEqual(['dune', 'dune']);
  });

  it('an explicit kind wins over the URL; without either the stored pick is used; junk is ignored', () => {
    expect(resolveSessionPlanetKind(new URLSearchParams('planet=dune'), 'oceanForest')).toBe('oceanForest');
    expect(resolveSessionPlanetKind(new URLSearchParams(''))).toBe('oceanForest');
    sessionStorage.setItem(PLANET_KIND_SESSION_KEY, 'mars');
    localStorage.setItem(PLANET_KIND_SESSION_KEY, 'forestRock');
    expect(readStoredPlanetKind()).toBe('forestRock'); // session junk falls through to local storage
    localStorage.setItem(PLANET_KIND_SESSION_KEY, 'venus');
    expect(resolveSessionPlanetKind(new URLSearchParams('planet=venus'))).toBeNull();
  });

  it('storage that throws reads as no pick', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(readStoredPlanetKind()).toBeNull();
    vi.restoreAllMocks();
  });
});

describe('viewportHelper: page events and overlays', () => {
  it('a local host saves on pagehide and when the page hides; the cleanup removes both listeners', () => {
    const saveNow = vi.fn();
    const off = bindLocalSaveListeners({ saveNow } as unknown as LocalTransport);
    window.dispatchEvent(new Event('pagehide'));
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(saveNow).toHaveBeenCalledTimes(1);
    vis.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(saveNow).toHaveBeenCalledTimes(2);
    off();
    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(saveNow).toHaveBeenCalledTimes(2);
    vis.mockRestore();
  });

  it('Escape is held back while the hub ghost is placing or the dev console is open, not by hidden ones', () => {
    expect(isEscapeBlockedByHudOverlay()).toBe(false);
    const ghost = Object.assign(document.createElement('div'), { hidden: false });
    ghost.dataset.testid = 'hub-placement-ghost';
    ghost.dataset.active = 'false';
    document.body.append(ghost);
    expect(isEscapeBlockedByHudOverlay()).toBe(false);
    ghost.dataset.active = 'true';
    expect(isEscapeBlockedByHudOverlay()).toBe(true);
    ghost.hidden = true;
    const con = document.createElement('div');
    con.dataset.testid = 'dev-console';
    con.style.display = 'none';
    document.body.append(con);
    expect(isEscapeBlockedByHudOverlay()).toBe(false);
    con.style.display = '';
    expect(isEscapeBlockedByHudOverlay()).toBe(true);
    con.style.display = 'none';

    for (const testid of ['pilot-dialog', 'trade-hub-panel', 'deed-panel']) {
      const modal = document.createElement('div');
      modal.dataset.testid = testid;
      modal.dataset.open = 'false';
      document.body.append(modal);
      expect(isEscapeBlockedByHudOverlay()).toBe(false);
      modal.dataset.open = 'true';
      expect(isEscapeBlockedByHudOverlay()).toBe(true);
      modal.dataset.open = 'false';
    }

    const stageHud = document.createElement('div');
    stageHud.dataset.testid = 'stage-track-hud';
    stageHud.hidden = true;
    document.body.append(stageHud);
    expect(isEscapeBlockedByHudOverlay()).toBe(false);
    stageHud.hidden = false;
    expect(isEscapeBlockedByHudOverlay()).toBe(true);
  });
});

describe('viewportHelper: terrain, picking and the scene', () => {
  it('in space the terrain is shifted so the target tile sits at the origin and shown only on request; on the ground it is reset', () => {
    const { terrain } = flatTerrain();
    syncSpaceTerrainOffset(null, true, true, { q: 1, r: 1 }); // no terrain yet: nothing to do
    const [x, z] = tileXZ(3, -1);
    syncSpaceTerrainOffset(terrain, true, false, { q: 3, r: -1 });
    expect([terrain.group.position.toArray(), terrain.group.visible]).toEqual([[-x, -2, -z], false]);
    syncSpaceTerrainOffset(terrain, false, false, { q: 3, r: -1 });
    expect([terrain.group.position.toArray(), terrain.group.visible]).toEqual([[0, 0, 0], true]);
  });

  it('pickTerrainAt turns a client point into NDC of the canvas; projectTileToScreen maps the centre tile to the canvas centre', () => {
    const vp = viewportAt();
    const { terrain, pick } = flatTerrain();
    expect(pickTerrainAt(null, vp, 0, 0)).toBeNull();
    expect(pickTerrainAt(terrain, vp, 300, 150)).toEqual({ q: 1, r: 2 });
    expect((pick.mock.calls[0] as unknown[])[0]).toEqual(new THREE.Vector2(0, 0));
    pickTerrainAt(terrain, vp, 100, 50);
    expect((pick.mock.calls[1] as unknown[])[0]).toEqual(new THREE.Vector2(-1, 1));
    expect(projectTileToScreen(null, vp, 0, 0)).toBeNull();
    const centre = projectTileToScreen(terrain, vp, 0, 0)!;
    expect([Math.round(centre.x), Math.round(centre.y)]).toEqual([300, 150]);
  });

  it('listSceneEntities reads the entity meshes (only children with an entity id)', () => {
    const scene = new THREE.Scene();
    expect(listSceneEntities(scene)).toEqual([]);
    const g = new THREE.Group();
    g.name = 'online-entities';
    const m = new THREE.Object3D();
    m.userData.entityId = 7;
    m.position.set(1, 2, 3);
    g.add(m, new THREE.Object3D());
    scene.add(g);
    expect(listSceneEntities(scene)).toEqual([{ id: 7, x: 1, y: 2, z: 3 }]);
  });

  it('createSafeViewport keeps a provided viewport; without WebGL it builds a headless one whose dispose removes its canvas', () => {
    const root = document.createElement('div');
    const provided = viewportAt();
    expect(createSafeViewport(root, provided)).toBe(provided);
    const vp = createSafeViewport(root);
    expect(root.querySelector('canvas')).toBe(vp.renderer.domElement);
    expect(vp.camera.fov).toBe(28);
    vp.render();
    vp.dispose();
    expect(root.querySelector('canvas')).toBeNull();
  });
});

describe('viewportHelper: multiplayer seeded ground parity', () => {
  it('reconstructs identical seeded ground, props, and coastal-sand-free flora for multiple players joining a server snapshot', () => {
    const flags = ['W00', 'W01'] as const;
    const data = compileData(flagsFromList(flags));
    const auth = new SimHost({ flags, data, modules: allModules() });
    auth.load(createPlanet({ id: 'pl_ocean_mp', type: 'ocean', planetType: 'ocean', seed: 'mp-room-seed-77', radius: 12 }));
    const welcomeBytes = auth.snapshot({ forClient: true });

    const joinAsPlayer = (preferredKind: 'dune' | 'forestRock') => {
      const rep = new ReplicaCore({ modules: allModules() });
      const res = rep.welcome({ state: welcomeBytes, tick: auth.tick, flags, dataHash: data.hash, simVersion: SIM_VERSION });
      expect(res.ok).toBe(true);
      const clientView = unpackView(packView(rep.view(), true).view);
      expect(clientView.planet.seed).toBe('mp-room-seed-77');
      const root = document.createElement('div');
      const vp = createSafeViewport(root);
      const synced = syncOrRebuildSessionTerrain({
        viewport: vp, prevTerrain: null, prevTiles: null, prevCam: null, prevBiomeKey: 'dune',
        view: clientView, tiles: clientView.tiles!, planetKind: preferredKind,
        inSpace: false, showSpaceTerrain: false, cameraTargetTile: { q: 0, r: 0 },
      });
      return { vp, clientView, ...synced };
    };

    const p1 = joinAsPlayer('dune');
    const p2 = joinAsPlayer('forestRock');
    expect(p1.terrain.seed).toBe(p2.terrain.seed);
    expect(p1.biomeKey).toBe('oceanForest');
    expect(p2.biomeKey).toBe('oceanForest');
    expect(p1.terrain.props.counts()).toEqual(p2.terrain.props.counts());
    expect(p1.terrain.flora.counts()).toEqual(p2.terrain.flora.counts());

    // Verify real @terra/sim ocean world places zero bushes, wildflowers, grass tufts, or reeds on dry coastal sand hexes
    const r = p1.clientView.planet.radius;
    const hx = hexIndex(r);
    const tLayers = { ...p1.clientView.tiles!, kind: 'oceanForest' as const, seed: p1.terrain.seed };
    const mat = new THREE.Matrix4();
    for (const restricted of ['bush', 'wildflower', 'grassTuft', 'reeds'] as const) {
      for (const im of p1.terrain.flora.meshes[restricted]) {
        for (let k = 0; k < im.count; k++) {
          im.getMatrixAt(k, mat);
          const x = mat.elements[12]!, z = mat.elements[14]!;
          const picked = tileAt(r, x, z);
          if (picked && restricted !== 'reeds') {
            expect(tileShoreFactor(hx, picked.i, tLayers)).toBe(0);
          }
        }
      }
    }

    p1.cam?.dispose(); p1.terrain.dispose(); p1.vp.dispose();
    p2.cam?.dispose(); p2.terrain.dispose(); p2.vp.dispose();
  });
});

describe('viewportHelper: createPlanet coastal sand exclusion & URL seed hashes', () => {
  it('keeps 100% of bush, wildflower, and grassTuft centers, footprints, and transformed mesh vertices off beach sand across 10 R=22 ocean/temperate createPlanet seeds', () => {
    const R = 22;
    const hx = hexIndex(R);
    const allTiles = Array.from({ length: hx.count }, (_, i) => i);
    const tileCell = Array.from({ length: hx.count }, () => '0,0');
    const seeds = ['golden-1', 'seed-2', 'seed-3', 'seed-4', 'seed-5'] as const;
    const mat = new THREE.Matrix4();
    const vPos = new THREE.Vector3();

    for (const pType of ['ocean', 'temperate'] as const) {
      for (const seed of seeds) {
        const state = createPlanet({ id: `pl_${pType}_${seed}`, type: pType, planetType: pType, seed, radius: R });
        const look = specForPlanetType(pType, seed);
        const gl = state.grid.layers;
        const layers = {
          height: gl.height,
          terrain: gl.terrain,
          prep: gl.prep,
          deposit: gl.deposit,
          kind: look.kind,
          seed: look.seed,
        };
        const effHeights = computeEffectiveHeights(R, layers);
        const heightAt = makeHeightSampler(R, () => effHeights);
        const byCell = placeFloraByCellsWithExclusion(allTiles, null, tileCell, hx, R, layers, heightAt, look);
        const placed = byCell.get('0,0')!;
        expect(placed.grassTuft.length + placed.wildflower.length + placed.bush.length).toBeGreaterThan(25);

        const shoreByTile = Float32Array.from({ length: hx.count }, (_, idx) => tileShoreFactor(hx, idx, layers));
        const isBeachSandAt = (px: number, pz: number): boolean =>
          isHexBeachSandAtPoint(hx, px, pz, heightAt(px, pz), layers, look.kind, shoreByTile);

        for (const kind of ['bush', 'wildflower', 'grassTuft'] as const) {
          for (const p of placed[kind]) {
            const fpR = renderedFloraOuterRadius(kind, p.s);
            const picked = tileAt(R, p.x, p.z);
            expect(picked).not.toBeNull();
            expect(tileShoreFactor(hx, picked!.i, layers)).toBe(0);
            expect(isBeachSandAt(p.x, p.z)).toBe(false);

            for (let a = 0; a < 16; a++) {
              const ang = (a / 16) * Math.PI * 2;
              const px = p.x + Math.cos(ang) * fpR;
              const pz = p.z + Math.sin(ang) * fpR;
              expect(isBeachSandAt(px, pz)).toBe(false);
              const pTile = tileAt(R, px, pz);
              expect(pTile).not.toBeNull();
              const tCode = layers.terrain[pTile!.i] ?? 0;
              expect(tCode === HEX_TERRAIN.shallow || tCode === HEX_TERRAIN.deep).toBe(false);
            }
          }
        }

        // Verify actual transformed InstancedMesh vertices on golden-1 for both ocean & temperate
        if (seed === 'golden-1') {
          const ht = createHexTerrain({ radius: R, tiles: layers, look, prewarmBugs: false });
          for (const kind of ['bush', 'wildflower', 'grassTuft'] as const) {
            for (const im of ht.flora.meshes[kind]) {
              const pos = im.geometry.getAttribute('position');
              for (let k = 0; k < im.count; k++) {
                im.getMatrixAt(k, mat);
                for (let vi = 0; vi < pos.count; vi++) {
                  vPos.fromBufferAttribute(pos, vi).applyMatrix4(mat);
                  expect(isHexBeachSandAtPoint(hx, vPos.x, vPos.z, vPos.y, layers, look.kind, shoreByTile)).toBe(false);
                }
              }
            }
          }
          ht.dispose();
        }
      }
    }
  }, 60_000);
});

describe('viewportHelper: URL ?seed=<hash> & ?host=local end-to-end forwarding', () => {
  it('threads URL ?seed=<hash> & ?host=local deterministically across colonyEntryBridge, MainMenu, local boot, and dev.seed updates', async () => {
    expect(parseGroundSeedInput('shared-colony-hash', 17)).toBe(parseGroundSeedInput('shared-colony-hash', 17));
    expect(parseGroundSeedInput('shared-colony-hash', 17)).not.toBe(parseGroundSeedInput('other-colony-hash', 17));
    expect(buildForwardedOnlineSearch('?planet=oceanForest&host=local&seed=custom-room-hash&deploy=1&skip=1'))
      .toBe('?host=local&seed=custom-room-hash');
    expect(buildForwardedOnlineSearch('?planet=dune&skip=1')).toBe('');

    // MainMenu preserves an explicit URL ?seed= across planet card switches while resetting default seeds
    const hostEl = document.createElement('div');
    const explicitSeed = parseGroundSeedInput('custom-room-hash', PLANET_SPECS.dune.seed)!;
    const menuExplicit = new MainMenu(
      hostEl,
      { onPlanet() {}, onDeploy() {}, onSettings() {} },
      'dune',
      explicitSeed,
      { autoStartFeed: false },
    );
    menuExplicit.select('oceanForest', true);
    expect(menuExplicit.seed).toBe(explicitSeed);
    menuExplicit.dispose();

    const menuDefault = new MainMenu(
      hostEl,
      { onPlanet() {}, onDeploy() {}, onSettings() {} },
      'dune',
      undefined,
      { autoStartFeed: false },
    );
    menuDefault.select('oceanForest', true);
    expect(menuDefault.seed).toBe(PLANET_SPECS.oceanForest.seed);
    menuDefault.dispose();

    const bootA = await bootAuthAndHome({ search: '?host=local&seed=custom-room-hash', planetType: 'ocean' });
    const bootB = await bootAuthAndHome({ search: '?host=local&seed=custom-room-hash', planetType: 'ocean' });
    expect(bootA.planet.seed).toBe('custom-room-hash');
    expect(bootB.planet.seed).toBe('custom-room-hash');
    const lookA = resolveOnlinePlanetLook(bootA.planet.type, null, bootA.planet.seed);
    const lookB = resolveOnlinePlanetLook(bootB.planet.type, null, bootB.planet.seed);
    expect(lookA.seed).toBe(lookB.seed);

    // Authoritative view.planet.seed (e.g. after runtime dev.seed) wins over stale boot fallback seed
    const root = document.createElement('div');
    const vp = createSafeViewport(root);
    const baseTiles = tiles(19);
    const initial = syncOrRebuildSessionTerrain({
      viewport: vp, prevTerrain: null, prevTiles: null, prevCam: null, prevBiomeKey: 'oceanForest',
      view: { tick: 1, planet: { id: 'p1', type: 'ocean', radius: 2, seed: 'seed-initial' }, entities: new Float32Array(0), count: 0, colonies: [] },
      tiles: baseTiles, planetKind: 'oceanForest', planetSeed: 'seed-initial',
      inSpace: false, showSpaceTerrain: false, cameraTargetTile: { q: 0, r: 0 },
    });
    const updated = syncOrRebuildSessionTerrain({
      viewport: vp, prevTerrain: initial.terrain, prevTiles: baseTiles, prevCam: initial.cam, prevBiomeKey: initial.biomeKey,
      view: { tick: 2, planet: { id: 'p1', type: 'ocean', radius: 2, seed: 'seed-after-dev-cmd' }, entities: new Float32Array(0), count: 0, colonies: [] },
      tiles: baseTiles, planetKind: 'oceanForest', planetSeed: 'seed-initial',
      inSpace: false, showSpaceTerrain: false, cameraTargetTile: { q: 0, r: 0 },
    });
    expect(updated.rebuilt).toBe(true);
    expect(updated.terrain.seed).toBe(resolveOnlinePlanetLook('ocean', null, 'seed-after-dev-cmd').seed);
    updated.cam?.dispose(); updated.terrain.dispose(); vp.dispose();
  });
});
