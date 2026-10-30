import { defineScenario } from './_define';

/** W00: the empty flat dev planet plus one test entity at the centre (the prediction demo nudges it). */
export default defineScenario({
  id: 'w00',
  title: 'W00 empty planet',
  waves: '..00',
  seed: 'w00-empty',
  planet: { type: 'flat', planetType: 'temperate', radius: 56 },
  build(_host, api) {
    api.command('dev.spawn', { q: 0, r: 0 });
  },
});
