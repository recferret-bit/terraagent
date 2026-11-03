import { defineSimModule } from '../define';

export * from './needs';
export * from './site';
export * from './weight';

export const ruleEngine = defineSimModule({
  id: 'rule-engine',
  wave: 'W08',
  systems: [],
});

export default ruleEngine;
