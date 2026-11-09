import { snapshot } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { createScenarioPlanet, getScenario } from '../_loader';
import { compareSnapshots } from '../parity/compare';

describe('W20 scenario: w20-colony-deed', () => {
  it('discovers w20 (w20-colony-deed) with Aegis Spire landed at Stage 4 (unlockStage = 4)', () => {
    expect(getScenario('w20')).toBeDefined();
    expect(getScenario('w20-colony-deed')).toBe(getScenario('w20'));
    const { host } = createScenarioPlanet('w20', { planetId: 'pl_W20' });
    const col = host.state.colonies[0];
    expect(col?.name).toBe('Aegis Spire');
    expect(col?.stage).toBe(4);
    expect(col?.unlockStage).toBe(4);
    expect(col?.status).toBe('active');
  });

  it('produces identical snapshots across two hosts after 60 ticks', () => {
    const a = createScenarioPlanet('w20', { planetId: 'pl_A' }).host;
    const b = createScenarioPlanet('w20', { planetId: 'pl_B' }).host;
    a.step(60);
    b.step(60);
    expect(compareSnapshots(snapshot(a.state), snapshot(b.state)).ok).toBe(true);
  });
});
