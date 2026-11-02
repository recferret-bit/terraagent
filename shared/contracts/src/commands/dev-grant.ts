import { z } from 'zod';
import { ResourceKey } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.grant',
  wave: 'W01',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    resource: ResourceKey,
    amount: z.number().int(),
  }),
  summary: 'Dev console: adds (positive) or withdraws (negative) `amount` whole units of `resource` on the caller colony via the ledger (`dev.grant`); a withdrawal is clamped to the balance so stock stays >= 0.',
});
