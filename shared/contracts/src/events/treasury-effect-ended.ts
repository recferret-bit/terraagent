import { TreasuryEffectEndedData } from '../treasury';
import { defineEvent } from './define';

export const TreasuryEffectEndedDataSchema = TreasuryEffectEndedData;

export const event = defineEvent({
  kind: 'treasuryEffectEnded',
  wave: 'W22',
  severity: 'info',
  audience: 'player',
  data: TreasuryEffectEndedData,
  summary: 'A planet treasury effect reached `untilTick` and stopped (W22-01, NEAR-102).',
});
