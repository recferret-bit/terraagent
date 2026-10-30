import { defineScenario } from './_define';

/**
 * W01 Landfall: temperate hex planet at the drop moment (pod descending at slot 0, cargo 600/350/200/200).
 */
export const w01LandfallScenario = defineScenario({
  id: 'w01',
  title: 'W01 Landfall',
  waves: '..01',
  seed: 'w01-landfall',
  planet: { type: 'temperate', planetType: 'temperate', radius: 56 },
  build(_host, api) {
    api.command('system.spawnColony', {
      colonyId: 'col_0',
      colonyIndex: 0,
      name: "Colonist's Colony",
      slotIndex: 0,
    });
  },
});

/**
 * Auto-placement variant for the 60 s idle step (deferred stretch W01-18): starts immediately after HQ landing.
 */
export const w01AutoPlaceScenario = defineScenario({
  id: 'w01-auto-place',
  title: 'W01 Landfall (HQ landed for auto-placement)',
  waves: '..01',
  seed: 'w01-landfall',
  planet: { type: 'temperate', planetType: 'temperate', radius: 56 },
  build(_host, api) {
    api.command('system.spawnColony', {
      colonyId: 'col_0',
      colonyIndex: 0,
      name: "Colonist's Colony",
      slotIndex: 0,
    });
    api.command('dev.land', { colonyId: 0 });
  },
});

export default w01LandfallScenario;
