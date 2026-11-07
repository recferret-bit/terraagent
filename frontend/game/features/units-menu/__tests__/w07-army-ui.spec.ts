// @vitest-environment jsdom
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  creditResource,
  enqueueQueueTask,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  insertRow,
  placeSpawnedEntity,
  setFactoryRallyPoint,
  step,
  view,
} from '@terra/sim';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext, GameView } from '../../../core/registry/types';
import { buildConstructionCatalog } from '../../construction-menu/catalog';
import { buildUnitsCatalog } from '../catalog';
import { UnitsMenu } from '../UnitsMenu';

function setupW07Colony() {
  const state = createState({ planetId: 'p-w07-ui', planetType: 'temperate', seed: 'w07-ui', radius: 12 });
  const colony = ensureColonyLedger({
    index: 0,
    id: 'col-0',
    name: 'Colony Alpha',
    color: 0xff6b00,
    status: 'active',
    unlockStage: 3,
    stage: 3,
    changedAt: 0,
  });
  state.colonies.push(colony);

  creditResource(colony, 'metals.t1', 500, 0);
  creditResource(colony, 'minerals.t1', 500, 0);
  creditResource(colony, 'bio.biomass', 200, 0);
  creditResource(colony, 'bio.water', 200, 0);

  // Command Hub (+10 supply, +9 E/s net)
  const hubRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
  state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
  state.entities.cols.owner[hubRow] = 0;
  placeSpawnedEntity(state.entities, hubRow, -5, 0, 0);
  state.entities.cols.footprintW[hubRow] = 3;
  state.entities.cols.footprintD[hubRow] = 3;
  state.entities.cols.hp[hubRow] = 1500;
  state.entities.cols.hpMax[hubRow] = 1500;
  state.entities.cols.state[hubRow] = ENTITY_STATE.active;

  // Solar Collector Array (+13 E/s net so Robotics Factory stays powered)
  const solarRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
  state.entities.cols.kind[solarRow] = ENTITY_KIND.solar;
  state.entities.cols.owner[solarRow] = 0;
  placeSpawnedEntity(state.entities, solarRow, -2, -3, 0);
  state.entities.cols.footprintW[solarRow] = 2;
  state.entities.cols.footprintD[solarRow] = 2;
  state.entities.cols.hp[solarRow] = 300;
  state.entities.cols.hpMax[solarRow] = 300;
  state.entities.cols.state[solarRow] = ENTITY_STATE.active;
  colony.powerSupplyOverride = 40;

  // Robotics Factory (3x3)
  const factoryId = state.meta.nextEntityId++;
  const facRow = insertRow(state.entities, factoryId, 0);
  state.entities.cols.kind[facRow] = ENTITY_KIND.roboticsFactory;
  state.entities.cols.owner[facRow] = 0;
  placeSpawnedEntity(state.entities, facRow, 0, 0, 0);
  state.entities.cols.footprintW[facRow] = 3;
  state.entities.cols.footprintD[facRow] = 3;
  state.entities.cols.hp[facRow] = 800;
  state.entities.cols.hpMax[facRow] = 800;
  state.entities.cols.state[facRow] = ENTITY_STATE.active;

  return { state, colony, factoryId };
}

describe('W07-18 Army UI: Units & Construction Catalogs', () => {
  it('includes Recon Armored Scout in Army section when W07 is active and hides dev-only units', () => {
    const w07Flags = parseWaves('..07');
    const unitCards = buildUnitsCatalog(w07Flags);
    const units = unitCards.map((c) => c.unit);

    expect(units).toContain('harvester');
    expect(units).toContain('builder');
    expect(units).toContain('recon');
    expect(units).not.toContain('demoTank');
    expect(units).not.toContain('demoArtillery');

    const reconCard = unitCards.find((c) => c.unit === 'recon')!;
    expect(reconCard.label).toBe('Recon Armored Scout');
    expect(reconCard.section).toBe('army');
    expect(reconCard.category).toBe('Army');
    expect(reconCard.producer).toBe('roboticsFactory');
    expect(reconCard.unlockStage).toBe(3);
    expect(reconCard.powerDrainPerS).toBe(2);
    expect(reconCard.powerText).toBe('−2 E/s');
    expect(reconCard.buildS).toBeGreaterThanOrEqual(10);
    expect(reconCard.supply).toBeGreaterThanOrEqual(1);
  });

  it('includes W07 buildings in Construction catalog when W07 is active and omits all W07 items under ..06', () => {
    const w06Flags = parseWaves('..06');
    expect(buildUnitsCatalog(w06Flags).some((c) => c.unit === 'recon')).toBe(false);
    const w06Buildings = buildConstructionCatalog(w06Flags).map((c) => c.building);
    expect(w06Buildings).not.toContain('roboticsFactory');
    expect(w06Buildings).not.toContain('droneControlArray');
    expect(w06Buildings).not.toContain('autocannon');
    expect(w06Buildings).not.toContain('laserTower');

    const w07Buildings = buildConstructionCatalog(parseWaves('..07'));
    const byId = Object.fromEntries(w07Buildings.map((c) => [c.building, c]));
    expect(byId.roboticsFactory?.label).toBe('Robotics Factory');
    expect(byId.roboticsFactory?.footprintText).toBe('3×3');
    expect(byId.droneControlArray?.label).toBe('Drone Control Array');
    expect(byId.droneControlArray?.footprintText).toBe('1×1');
    expect(byId.autocannon?.label).toBe('Autocannon Turret');
    expect(byId.autocannon?.footprintText).toBe('1×1');
    expect(byId.laserTower?.label).toBe('Laser Tower');
    expect(byId.laserTower?.footprintText).toBe('1×1');
  });
});

describe('W07-18 Army UI: Ordering 2 Recon, Factory Queue Progress, Supply 2/10 & DCA +8', () => {
  it('orders 2 Recon -> shows them in the Factory queue with progress bars and reads supply 2 / 10 (and 18 with DCA)', () => {
    const { state } = setupW07Colony();
    const flags = parseWaves('..07');
    const pipeline = createRegistryPipeline({ flags });

    const host = document.createElement('div');
    const sendCommand = vi.fn((kind: string, rawArgs?: unknown) => {
      const args = (rawArgs ?? {}) as Record<string, unknown>;
      if (kind === 'enqueueTask') {
        const task = args.task as { kind: 'buildUnit'; unit: string; count?: number; repeat?: boolean };
        enqueueQueueTask(state, { colonyIndex: 0, task, data: pipeline.config.data });
      }
      return Promise.resolve({ ok: true as const, appliedAtTick: 1 });
    });

    const ctx: FeatureContext = {
      flags: new Set(flags.list),
      host: 'server',
      services: { sendCommand, track: vi.fn() },
    };

    const menu = new UnitsMenu(host, ctx);
    step(state, [], 1, pipeline);
    menu.update(view(state) as unknown as GameView);

    const supplyEl = host.querySelector('[data-supply]')!;
    expect(supplyEl.textContent).toBe('0 / 10');
    expect(supplyEl.getAttribute('title')).toContain('+8 per Drone Control Array');

    // Army section contains the Recon card
    const armySection = host.querySelector('[data-section="army"]');
    expect(armySection).not.toBeNull();
    const reconCard = armySection?.querySelector('[data-unit="recon"]');
    expect(reconCard).not.toBeNull();

    // Order 2 Recon: increment count to 2, then click QUEUE on Recon card
    const incBtn = reconCard?.querySelector<HTMLButtonElement>('[data-count-inc]');
    incBtn?.click();
    expect(reconCard?.querySelector('[data-count]')?.textContent).toBe('2');

    const queueBtn = reconCard?.querySelector<HTMLButtonElement>('[data-queue-unit="recon"]');
    queueBtn?.click();

    expect(sendCommand).toHaveBeenCalledWith('enqueueTask', {
      task: { kind: 'buildUnit', unit: 'recon', count: 2, repeat: false },
    });

    // Advance 20 ticks (40% of 1st Recon) so progress bar is at 40%, then 35 ticks so 1st Recon spawns and 2nd is at 10%
    step(state, [], 20, pipeline);
    menu.update(view(state) as unknown as GameView);

    const factoryQueue = host.querySelector('[data-factory-queue]')!;
    expect(factoryQueue).not.toBeNull();
    const barsAt20 = factoryQueue.querySelectorAll('[data-progress-bar]');
    expect(barsAt20.length).toBe(2);
    expect(barsAt20[0].getAttribute('data-progress-pct')).toBe('40');
    expect(barsAt20[0].getAttribute('style')).toContain('width: 40%');
    expect(barsAt20[1].getAttribute('data-progress-pct')).toBe('0');

    // Step 30 ticks to finish 1st Recon, then 5 more ticks so 1st Recon is alive (1 supply) and 2nd Recon is in_progress at 10% (1 reserved supply) -> 2 / 10
    step(state, [], 30, pipeline);
    step(state, [], 5, pipeline);
    menu.update(view(state) as unknown as GameView);
    expect(supplyEl.textContent).toBe('2 / 10');
    expect(factoryQueue.querySelector('[data-progress-bar]')?.getAttribute('data-progress-pct')).toBe('10');

    // Complete a Drone Control Array within the Command Hub power grid -> cap increases from 10 to 18
    const dcaRow = insertRow(state.entities, state.meta.nextEntityId++, state.meta.tick);
    state.entities.cols.kind[dcaRow] = ENTITY_KIND.droneControlArray;
    state.entities.cols.owner[dcaRow] = 0;
    placeSpawnedEntity(state.entities, dcaRow, -2, 0, state.meta.tick);
    state.entities.cols.footprintW[dcaRow] = 1;
    state.entities.cols.footprintD[dcaRow] = 1;
    state.entities.cols.hp[dcaRow] = 350;
    state.entities.cols.hpMax[dcaRow] = 350;
    state.entities.cols.state[dcaRow] = ENTITY_STATE.active;

    step(state, [], 1, pipeline);
    menu.update(view(state) as unknown as GameView);
    expect(supplyEl.textContent).toBe('2 / 18');

    menu.dispose();
  });
});

describe('W07-18 Army UI: Rally-flag placement', () => {
  it('toggles rally mode via SET RALLY button and dispatches setRally on terrain click or setRally call', () => {
    const { state, factoryId } = setupW07Colony();
    const flags = parseWaves('..07');
    const surface = document.createElement('div');
    const host = document.createElement('div');
    const sendCommand = vi.fn((kind: string, rawArgs?: unknown) => {
      const args = (rawArgs ?? {}) as { q: number; r: number };
      if (kind === 'setRally') {
        setFactoryRallyPoint(state, 0, args.q, args.r, factoryId, state.meta.tick);
      }
      return Promise.resolve({ ok: true as const, appliedAtTick: 1 });
    });

    const ctx: FeatureContext = {
      flags: new Set(flags.list),
      host: 'server',
      services: {
        sendCommand,
        track: vi.fn(),
        surface,
        pickTile: () => ({ q: 6, r: -3 }),
      },
    };

    const menu = new UnitsMenu(host, ctx, view(state) as unknown as GameView);
    const rallyBtn = host.querySelector<HTMLButtonElement>('[data-set-rally]')!;
    const rallyReadout = host.querySelector('[data-rally-readout]')!;
    expect(rallyBtn).not.toBeNull();
    expect(rallyReadout.textContent).toBe('Rally: default');
    expect(menu.isRallyMode()).toBe(false);

    // Click SET RALLY -> arms rally placement mode
    rallyBtn.click();
    expect(menu.isRallyMode()).toBe(true);
    expect(rallyBtn.getAttribute('data-active')).toBe('true');

    // Click on terrain surface -> resolves (6, -3), sends setRally, exits rally mode
    surface.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }));
    surface.dispatchEvent(new MouseEvent('pointerup', { button: 0, bubbles: true }));

    expect(menu.isRallyMode()).toBe(false);
    expect(sendCommand).toHaveBeenCalledWith('setRally', { q: 6, r: -3 });
    expect(rallyReadout.textContent).toBe('Rally: (6, -3)');

    // Direct programmatic setRally also updates readout and sends command
    menu.setRally(9, 2);
    expect(sendCommand).toHaveBeenCalledWith('setRally', { q: 9, r: 2 });
    expect(rallyReadout.textContent).toBe('Rally: (9, 2)');

    menu.dispose();
  });
});
