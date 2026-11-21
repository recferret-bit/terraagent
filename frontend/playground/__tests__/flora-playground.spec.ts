// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { PLANET_KINDS } from '@terra/render/planets/PlanetSpec';
import { TREE_BREEDS } from '@terra/render/visuals/terrain/treeBreeds';
import {
  FLORA_ENTRIES,
  createFloraMesh,
  floraStats,
  getFloraEntry,
  isFloraId,
  listFloraEntries,
} from '../content/floraCatalog';
import { SpawnSet } from '../content/SpawnSet';
import { Sidebar } from '../panels/Sidebar';
import { PEDESTAL_R } from '../stage/grid';
import { createState, syncURL } from '../state';

describe('Playground Trees & Ground Objects block, dropdown, and floraCatalog', () => {
  it('registers all 11 tree breeds and 40 ground objects (8 families x 5 types) cleanly and builds wind/rock meshes across biomes', () => {
    const trees = listFloraEntries('tree');
    const ground = listFloraEntries('ground');
    expect(trees).toHaveLength(TREE_BREEDS.length);
    expect(ground).toHaveLength(40);
    expect(FLORA_ENTRIES).toHaveLength(TREE_BREEDS.length + 40);
    expect(isFloraId('flora.tree.alpinePine')).toBe(true);
    expect(isFloraId('flora.ground.boulder')).toBe(true);
    expect(isFloraId('flora.ground.saguaro.candelabra')).toBe(true);
    expect(isFloraId('robot.miner')).toBe(false);

    for (const biome of PLANET_KINDS) {
      for (const entry of FLORA_ENTRIES) {
        const built = createFloraMesh(entry.id, biome, 17);
        const stats = floraStats(entry, built.mesh);
        expect(stats.tris).toBeGreaterThan(0);
        expect(stats.verts).toBeGreaterThan(0);
        expect(stats.tris).toBeLessThan(3500);
        expect(stats.groundedOk).toBe(true);
        built.dispose();
      }
    }
  });

  it('mounts a dedicated TREES & GROUND block and dropdown in Sidebar Units pane and filters/selects items', () => {
    document.body.innerHTML = '<div id="pg"><aside id="side"></aside><main id="stage"><div id="overlay"></div></main></div>';
    const picked: string[] = [];
    const rows: string[] = [];
    const state = createState(new URLSearchParams(''));
    const side = new Sidebar(state, {
      onSelect: (id) => picked.push(id),
      onRow() {},
      onFloraRow: (g) => rows.push(g),
    });
    side.build();

    const block = document.querySelector<HTMLElement>('[data-testid="pg-nature-block"]');
    const select = document.querySelector<HTMLSelectElement>('#pg-flora-select');
    expect(block).toBeTruthy();
    expect(select).toBeTruthy();

    const options = [...select!.querySelectorAll('option')].filter((o) => o.value);
    expect(options).toHaveLength(FLORA_ENTRIES.length);

    // Filter to ground objects only via the block tab
    block!.querySelector<HTMLButtonElement>('[data-nb-filter="ground"]')!.click();
    const filteredGround = [...select!.querySelectorAll('option')].filter((o) => o.value);
    expect(filteredGround).toHaveLength(listFloraEntries('ground').length);
    expect(filteredGround.every((o) => o.value.startsWith('flora.ground.'))).toBe(true);

    // Pick a ground object via dropdown
    select!.value = 'flora.ground.saguaro';
    select!.dispatchEvent(new Event('change'));
    expect(picked).toEqual(['flora.ground.saguaro']);

    // Spawn trees row button
    block!.querySelector<HTMLButtonElement>('[data-nb-row="tree"]')!.click();
    expect(rows).toEqual(['tree']);

    // Search filter narrows the dropdown options as well
    state.filter = 'pine';
    block!.querySelector<HTMLButtonElement>('[data-nb-filter="all"]')!.click();
    const afterSearch = [...select!.querySelectorAll('option')].filter((o) => o.value);
    expect(afterSearch.map((o) => o.value)).toEqual(['flora.tree.alpinePine']);
  });

  it('round-trips flora inspect and floraRow state through URL params and Sidebar.visibleIds', () => {
    vi.stubGlobal('location', { pathname: '/playground.html' });
    vi.stubGlobal('history', { replaceState: vi.fn() });
    const parsed = createState(new URLSearchParams('inspect=flora.tree.oasisDatePalm&floraRow=tree&biome=dune'));
    expect(parsed.floraRow).toBe('tree');
    parsed.id = 'flora.tree.oasisDatePalm';
    const synced = syncURL(parsed);
    expect(synced.get('inspect')).toBe('flora.tree.oasisDatePalm');
    expect(synced.get('floraRow')).toBe('tree');
    expect(getFloraEntry('flora.tree.oasisDatePalm')?.biomeHint).toBe('dune');
    vi.unstubAllGlobals();
  });
});

describe('Playground Per-Type Grid Layout', () => {
  it('lays out all 40 ground objects in 8 per-type lines and all 11 trees in 3 biome lines inside PEDESTAL_R with proper gaps', () => {
    const spawns = new SpawnSet();

    spawns.rebuild(spawns.idsFor(null, '', 'ground'), 'dune', false);
    expect(spawns.spawns).toHaveLength(40);
    const groundRows = new Map<number, typeof spawns.spawns>();
    for (const s of spawns.spawns) {
      const z = Number(s.mesh.position.z.toFixed(3));
      const distFromEdge = Math.hypot(s.mesh.position.x, s.mesh.position.z) + Math.max(s.box.max.x - s.box.min.x, s.box.max.z - s.box.min.z) * 0.5;
      expect(distFromEdge).toBeLessThan(PEDESTAL_R);
      const bucket = groundRows.get(z) ?? [];
      bucket.push(s);
      groundRows.set(z, bucket);
    }
    expect(groundRows.size).toBe(8);
    for (const row of groundRows.values()) {
      expect(row).toHaveLength(5);
      const kinds = new Set(row.map((s) => getFloraEntry(s.id)?.groundKind));
      expect(kinds.size).toBe(1);
      const xs = row.map((s) => s.mesh.position.x).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(3.5);
      }
    }

    spawns.rebuild(spawns.idsFor(null, '', 'tree'), 'forestRock', false);
    expect(spawns.spawns).toHaveLength(11);
    const treeRows = new Map<number, typeof spawns.spawns>();
    for (const s of spawns.spawns) {
      const z = Number(s.mesh.position.z.toFixed(3));
      const distFromEdge = Math.hypot(s.mesh.position.x, s.mesh.position.z) + Math.max(s.box.max.x - s.box.min.x, s.box.max.z - s.box.min.z) * 0.5;
      expect(distFromEdge).toBeLessThan(PEDESTAL_R);
      const bucket = treeRows.get(z) ?? [];
      bucket.push(s);
      treeRows.set(z, bucket);
    }
    expect(treeRows.size).toBe(3);
    for (const row of treeRows.values()) {
      const biomes = new Set(row.map((s) => getFloraEntry(s.id)?.biomeHint));
      expect(biomes.size).toBe(1);
      const xs = row.map((s) => s.mesh.position.x).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(5.5);
      }
    }

    spawns.dispose();
  });
});
