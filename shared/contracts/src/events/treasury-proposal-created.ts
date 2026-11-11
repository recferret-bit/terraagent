import { TreasuryProposalCreatedData } from '../treasury';
import { defineEvent } from './define';

export const TreasuryProposalCreatedDataSchema = TreasuryProposalCreatedData;

export const event = defineEvent({
  kind: 'treasuryProposalCreated',
  wave: 'W22',
  severity: 'info',
  audience: 'player',
  data: TreasuryProposalCreatedData,
  summary: 'A colony opened a planet-council proposal (W22-01, NEAR-102).',
});
