import { defineSimModule } from '../define';

export * from './needs';

export const ruleEngine = defineSimModule({
  id: 'rule-engine',
  wave: 'W08',
  systems: [],
});

export default ruleEngine;
