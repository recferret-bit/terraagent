// @vitest-environment jsdom
import { parseWaves } from '@terra/contracts';
import {
  createPlanet,
  hexIndex,
  PREP,
  setColonyStock,
  setTileOwner,
  setTilePrep,
  setTileTerrain,
  SimHost,
  spawnHqUnit,
  syncColonyTerraformStats,
  TERRAIN,
} from '@terra/sim';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClientView } from '../../store/replica/viewCodec';
import { TileOverlay } from '../terraform-basic/TileOverlay';
import { MinimalHud, mountMinimalHud } from './index';

function freshBody(): HTMLElement {
  document.body.replaceChildren();
  return document.body;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('W05-22: Terraform HUD meter rendering and live updates', () => {
  it('renders Terraform n / m (x %) from colony.terraform and updates immediately when a tile becomes Living', () => {
    const parent = freshBody();
    const hud = new MinimalHud(parent);

    hud.update({
      tick: 10,
      colonies: [
        {
          index: 0,
          id: 'col_0',
          name: 'Alpha',
          color: 0xff8800,
          status: 'active',
          terraform: { livingTiles: 10, eligibleOwnedTiles: 412, percent: 2.4 },
        },
      ],
    } as unknown as ClientView);

    const tfEl = parent.querySelector<HTMLElement>('[data-testid="hud-terraform"]')!;
    const tfVal = parent.querySelector<HTMLElement>('[data-testid="hud-terraform-val"]')!;
    expect(tfEl).not.toBeNull();
    expect(tfEl.hidden).toBe(false);
    expect(tfVal.textContent).toBe('Terraform 10 / 412 (2.4 %)');
    expect(tfEl.getAttribute('data-living')).toBe('10');
    expect(tfEl.getAttribute('data-eligible')).toBe('412');
    expect(tfEl.getAttribute('data-percent')).toBe('2.4');

    // Live-compute from view.tiles when a tile is seeded (excluding Deep Water and Ridge/Moat from eligible owned tiles)
    const count = 6;
    const owner = new Int8Array([0, 0, 0, 0, 0, 1]);
    const terrain = new Uint8Array([TERRAIN.flat, TERRAIN.flat, TERRAIN.flat, TERRAIN.deep, TERRAIN.flat, TERRAIN.flat]);
    const prep = new Uint8Array([PREP.prepared, PREP.irrigated, PREP.wild, PREP.wild, PREP.ridge, PREP.living]);

    hud.update({
      tick: 15,
      colonies: [{ index: 0, id: 'col_0', name: 'Alpha', color: 0xff8800, status: 'active' }],
      tiles: { count, owner, terrain, prep },
    } as unknown as ClientView);

    expect(tfVal.textContent).toBe('Terraform 0 / 3 (0.0 %)');
    expect(tfEl.getAttribute('data-living')).toBe('0');
    expect(tfEl.getAttribute('data-eligible')).toBe('3');
    expect(tfEl.getAttribute('data-percent')).toBe('0.0');

    prep[1] = PREP.living;
    hud.update({
      tick: 16,
      colonies: [{ index: 0, id: 'col_0', name: 'Alpha', color: 0xff8800, status: 'active' }],
      tiles: { count, owner, terrain, prep },
    } as unknown as ClientView);

    expect(tfVal.textContent).toBe('Terraform 1 / 3 (33.3 %)');
    expect(tfEl.getAttribute('data-living')).toBe('1');
    expect(tfEl.getAttribute('data-eligible')).toBe('3');
    expect(tfEl.getAttribute('data-percent')).toBe('33.3');

    hud.dispose();
  });
});

describe('W05-22: SimHost acceptance for Terraform HUD meter', () => {
  it('acceptance: seeding a tile in SimHost updates the Terraform HUD meter within 1 s', () => {
    const parent = freshBody();
    const host = new SimHost({ flags: parseWaves('..05') });
    host.load(createPlanet({ type: 'flat', seed: 'w05-22-seed', radius: 8 }));
    const state = host.state;
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    setColonyStock(state, 0, { 'bio.biomass': 200, 'bio.water': 200, 'metals.t1': 200, 'minerals.t1': 200 });

    const idx = hexIndex(state.grid.radius);
    for (let q = 0; q < 5; q++) {
      for (let r = 0; r < 5; r++) {
        const ti = idx.indexOf(q, r);
        setTileOwner(state.grid, ti, 0);
        setTileTerrain(state.grid, ti, TERRAIN.flat);
        setTilePrep(state.grid, ti, PREP.prepared);
      }
    }
    const seedTileIdx = idx.indexOf(1, 0);
    setTilePrep(state.grid, seedTileIdx, PREP.irrigated);
    syncColonyTerraformStats(state, 0, state.meta.tick);

    const hud = new MinimalHud(parent);
    hud.update(host.view() as unknown as ClientView);

    const tfVal = parent.querySelector<HTMLElement>('[data-testid="hud-terraform-val"]')!;
    expect(tfVal.textContent).toBe('Terraform 0 / 25 (0.0 %)');

    host.submit({
      source: 'player',
      commandId: 'seed-1',
      colonyIndex: 0,
      kind: 'enqueueTask',
      args: { terraform: { op: 'seed', tiles: [{ q: 1, r: 0 }] } },
    });
    for (let i = 0; i < 60 && state.grid.layers.prep[seedTileIdx] !== PREP.living; i++) {
      host.step(1);
    }
    expect(state.grid.layers.prep[seedTileIdx]).toBe(PREP.living);

    hud.update(host.view() as unknown as ClientView);
    expect(tfVal.textContent).toBe('Terraform 1 / 25 (4.0 %)');

    hud.dispose();
  });
});

describe('W05-22: Wave gating, hover hints, and Living overlay mode (L)', () => {
  it('hides hud-terraform when W05 is off and shows it when W05 is enabled', () => {
    const flags = new Set(['W00', 'W01', 'W02']);
    const mounted = mountMinimalHud({ el: freshBody(), ownerColonyIndex: 0, flags });
    const view = {
      tick: 10,
      colonies: [{ index: 0, terraform: { livingTiles: 1, eligibleOwnedTiles: 25, percent: 4.0 } }],
    } as unknown as ClientView;

    mounted.update(view);
    const tfEl = document.querySelector<HTMLElement>('[data-testid="hud-terraform"]')!;
    expect(tfEl.hidden).toBe(true);

    flags.add('W05');
    mounted.update(view);
    expect(tfEl.hidden).toBe(false);
    expect(tfEl.textContent).toContain('Terraform 1 / 25 (4.0 %)');

    mounted.dispose();
  });

  it('shows the +10 % Living move-speed hint and tier gates on hud-terraform hover', () => {
    const parent = freshBody();
    const hud = new MinimalHud(parent);
    hud.update({
      tick: 5,
      colonies: [{ index: 0, terraform: { livingTiles: 3, eligibleOwnedTiles: 10, percent: 30.0 } }],
    } as unknown as ClientView);

    const tfEl = parent.querySelector<HTMLElement>('[data-testid="hud-terraform"]')!;
    tfEl.dispatchEvent(new MouseEvent('mouseenter'));
    expect(tfEl.getAttribute('data-open')).toBe('true');
    expect(tfEl.title).toContain('Living ground: +10 % ground move speed · +5 % adjacent extractor output');
    expect(tfEl.title).toContain('T2 at 30 % · T3 at 70 %');

    const breakdown = tfEl.querySelector<HTMLElement>('[data-testid="res-breakdown-terraform"]')!;
    expect(breakdown.textContent).toContain('Living ground: +10 % ground move speed · +5 % adjacent extractor output');
    expect(breakdown.textContent).toContain('T2 at 30 % · T3 at 70 %');

    tfEl.dispatchEvent(new MouseEvent('mouseleave'));
    expect(tfEl.getAttribute('data-open')).toBeNull();

    hud.dispose();
  });

  it('toggles Living mode of TileOverlay on pressing L and shows the +10 % ground move speed hint', () => {
    const parent = freshBody();
    const overlay = new TileOverlay(parent, () => 0);

    const planet = createPlanet({ type: 'flat', seed: 'overlay-l', radius: 6 });
    const idx = hexIndex(planet.grid.radius);
    const L = planet.grid.layers;
    L.prep[idx.indexOf(1, 0)] = PREP.living;
    L.prep[idx.indexOf(2, 0)] = PREP.irrigated;

    overlay.update({
      planet: { id: 'p', type: 'flat', radius: planet.grid.radius },
      tiles: {
        count: planet.grid.count,
        terrain: L.terrain as Uint8Array,
        prep: L.prep as Uint8Array,
        owner: L.owner as Int16Array,
      },
    });

    expect(overlay.isVisible()).toBe(false);
    expect(overlay.getMode()).toBe('all');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
    expect(overlay.isVisible()).toBe(true);
    expect(overlay.getMode()).toBe('living');
    expect(overlay.el.dataset.mode).toBe('living');
    expect(overlay.el.title).toBe('Living ground: +10 % ground move speed');
    expect(overlay.el.dataset.livingHint).toBe('+10 % ground move speed');

    const summary = overlay.el.querySelector<HTMLElement>('[data-testid="tf-overlay-summary"]')!;
    expect(summary.textContent).toBe('LIVING 1 · IRRIGATED 1 · +10 % ground move speed on Living tiles');

    const livingChip = overlay.el.querySelector<HTMLElement>('[data-q="1"][data-r="0"]')!;
    expect(livingChip).not.toBeNull();
    expect(livingChip.dataset.state).toBe('living');
    expect(livingChip.title).toBe('Living ground: +10 % ground move speed');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', bubbles: true }));
    expect(overlay.isVisible()).toBe(false);
    expect(overlay.getMode()).toBe('all');

    overlay.dispose();
  });
});

describe('W05-36 tier gate line reads the host gates', () => {
  it('shows the thresholds, the colony Terraform % against the next gate and which tier is open', async () => {
    const { tierGateHint } = await import('./terraformMeter');
    const gate = (open: boolean, minTerraformPct: number) => ({ open, minTerraformPct }) as never;
    const col = { tierGates: { enabled: true, colonyTerraformPct: 24.4, tier2: gate(false, 30), tier3: gate(false, 70) } } as never;
    expect(tierGateHint(col)).toBe('T2 at 30 % · T3 at 70 % · Terraform 24 % / 30 % · locked');
    const open2 = { tierGates: { enabled: true, colonyTerraformPct: 41, tier2: gate(true, 30), tier3: gate(false, 70) } } as never;
    expect(tierGateHint(open2)).toBe('T2 at 30 % · T3 at 70 % · Terraform 41 % / 70 % · T2 open');
    expect(tierGateHint(undefined)).toBe('T2 at 30 % · T3 at 70 %');
  });
});
