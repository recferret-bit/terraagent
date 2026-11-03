import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.contactFake',
  wave: 'W10',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    colonyIndex: z.number().int().nonnegative().optional(),
    enabled: z.boolean().optional(),
  }),
  summary: 'Dev console (`contact.fake`): fakes neighbour/Guild contact on the colony so Trade Hub unlock can be tested below Stage 5 (W10-03).',
});
