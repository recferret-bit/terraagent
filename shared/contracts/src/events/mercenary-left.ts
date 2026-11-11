import { MercenaryLeftData } from '../bounty';
import { defineEvent } from './define';

export const MercenaryLeftDataSchema = MercenaryLeftData;

export const event = defineEvent({
  kind: 'mercenaryLeft',
  wave: 'W22',
  severity: 'info',
  audience: 'player',
  data: MercenaryLeftData,
  summary: 'A mercenary squad left: the contract ended, the squad was wiped, or the hire was cancelled (W22-02, NEAR-112).',
});
