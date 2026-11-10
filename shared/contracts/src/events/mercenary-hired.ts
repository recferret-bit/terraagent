import { MercenaryHiredData } from '../bounty';
import { defineEvent } from './define';

export const MercenaryHiredDataSchema = MercenaryHiredData;

export const event = defineEvent({
  kind: 'mercenaryHired',
  wave: 'W22',
  severity: 'info',
  audience: 'player',
  data: MercenaryHiredData,
  summary: 'A mercenary squad was reserved on a defend-area bounty (W22-02, NEAR-112).',
});
