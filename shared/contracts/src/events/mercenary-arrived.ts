import { MercenaryArrivedData } from '../bounty';
import { defineEvent } from './define';

export const MercenaryArrivedDataSchema = MercenaryArrivedData;

export const event = defineEvent({
  kind: 'mercenaryArrived',
  wave: 'W22',
  severity: 'info',
  audience: 'player',
  data: MercenaryArrivedData,
  summary: 'A hired mercenary squad spawned on the poster\'s territory (W22-02, NEAR-112).',
});
