import { TreasuryEffectStartedData } from '../treasury';
import { defineEvent } from './define';

export const TreasuryEffectStartedDataSchema = TreasuryEffectStartedData;

export const event = defineEvent({
  kind: 'treasuryEffectStarted',
  wave: 'W22',
  severity: 'info',
  audience: 'player',
  data: TreasuryEffectStartedData,
  summary: 'A passed council project is active on the planet until `untilTick` (W22-01, NEAR-102).',
});
