import { DEV_PLANET_RADIUS } from '@terra/sim';
import { defineScenario } from './_define';

/**
 * W16 Player-directed AI Strategy (`docs/plan/waves/W16-ai-director.md`).
 * A landed colony with an explicit Conservative Resources policy. Priorities stay independent.
 * Risk does not turn on away raids.
 */
export const w16DirectorScenario = defineScenario({
  id: 'w16',
  title: 'W16 Player-directed AI Strategy',
  waves: '..16',
  seed: 'w16-director',
  planet: { type: 'flat', planetType: 'temperate', radius: DEV_PLANET_RADIUS },
  build(host, api) {
    api.command('system.spawnColony', {
      colonyId: 'col_0',
      colonyIndex: 0,
      name: 'Director Basin',
      slotIndex: 0,
    });
    api.command('dev.land', {}, 0);
    // `?waves=..15` runs this seed with W16 off. The policy command is that wave, so skip it and still land.
    if (![...host.pipeline.config.flags].includes('W16')) return;
    api.command('setDirectorPolicy', {
      risk: 'conservative',
      preset: 'resources',
      priorities: { economy: 70, expansion: 40, defense: 50, power: 60, terraform: 30 },
      note: 'w16 fixture',
    }, 0);
  },
});

export default w16DirectorScenario;
