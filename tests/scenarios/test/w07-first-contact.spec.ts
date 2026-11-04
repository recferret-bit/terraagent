import { ENTITY_KIND, evaluatePlacement, getFaunaHivesState, hexDistance, placementWorldFromState, snapshot } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { createScenarioPlanet, getScenario } from '../_loader';
import { getParityCase } from '../parity';
import { compareSnapshots } from '../parity/compare';

describe('W07 scenarios: w07-first-contact and w07-stress', () => {
  it('discovers w07 (w07-first-contact) with S3 colony, 7/10 supply, and 3 passive species hives >= 30 tiles away', () => {
    expect(getScenario('w07')).toBeDefined();
    expect(getScenario('w07-first-contact')).toBe(getScenario('w07'));
    const { host } = createScenarioPlanet('w07', { planetId: 'pl_W07' });
    const col = host.state.colonies[0];
    expect(col?.stage).toBe(3);
    expect(col?.unlockStage).toBe(3);
    expect(col?.threatStage).toBe(2);
    expect(col?.supply).toMatchObject({ used: 7, units: 7, cap: 10 });

    const world = placementWorldFromState(host.state);
    expect(evaluatePlacement(world, { colonyId: 0, building: 'roboticsFactory', q: 4, r: -3 })).toMatchObject({ ok: true });
    expect(evaluatePlacement(world, { colonyId: 0, building: 'droneControlArray', q: 2, r: -3 })).toMatchObject({ ok: true });
    expect(evaluatePlacement(world, { colonyId: 0, building: 'autocannon', q: 6, r: -1 })).toMatchObject({ ok: true });
    expect(evaluatePlacement(world, { colonyId: 0, building: 'laserTower', q: 6, r: -2 })).toMatchObject({ ok: true });

    const fauna = getFaunaHivesState(host.state);
    const hives = Object.values(fauna.hivesById);
    expect(hives).toHaveLength(3);
    expect(new Set(hives.map((h) => h.species))).toEqual(new Set(['blackAnt', 'blueBeetle', 'greenSpitter']));
    for (const h of hives) {
      expect(h.mode).toBe('passive');
      expect(hexDistance(0, 0, h.q, h.r)).toBeGreaterThanOrEqual(30);
      expect(h.residentIds.length).toBeGreaterThan(0);
    }
  });

  it('discovers w07-stress with 6 species hives (2 per species), 42 residents, and armed colony defenses', () => {
    expect(getScenario('w07-stress')).toBeDefined();
    const { host } = createScenarioPlanet('w07-stress', { planetId: 'pl_W07_stress' });
    const fauna = getFaunaHivesState(host.state);
    const hives = Object.values(fauna.hivesById);
    expect(hives).toHaveLength(6);
    expect(Object.keys(fauna.bugsById).length).toBe(42);

    const cols = host.state.entities.cols;
    let recons = 0;
    let turrets = 0;
    for (let r = 0; r < host.state.entities.count; r++) {
      if (cols.kind[r] === ENTITY_KIND.recon) recons++;
      if (cols.kind[r] === ENTITY_KIND.autocannon || cols.kind[r] === ENTITY_KIND.laserTower) turrets++;
    }
    expect(recons).toBe(12);
    expect(turrets).toBe(8);
  });

  it('registers w07-first-contact parity case and produces identical snapshots across two hosts', () => {
    const p = getParityCase('w07-first-contact');
    expect(p).toBeDefined();
    const a = createScenarioPlanet('w07', { planetId: 'pl_A' }).host;
    const b = createScenarioPlanet('w07', { planetId: 'pl_B' }).host;
    a.step(60);
    b.step(60);
    const cmp = compareSnapshots(snapshot(a.state), snapshot(b.state));
    expect(cmp.ok).toBe(true);
  });
});
