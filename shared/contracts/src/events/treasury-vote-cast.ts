import { TreasuryVoteCastData } from '../treasury';
import { defineEvent } from './define';

export const TreasuryVoteCastDataSchema = TreasuryVoteCastData;

export const event = defineEvent({
  kind: 'treasuryVoteCast',
  wave: 'W22',
  severity: 'info',
  audience: 'player',
  data: TreasuryVoteCastData,
  summary: 'A council member voted on an open treasury proposal (W22-01, NEAR-102).',
});
