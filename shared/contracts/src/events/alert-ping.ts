import { z } from 'zod';
import { defineEvent } from './define';

export const ALERT_PING_KINDS = [
  'underAttack',
  'raidIncoming',
  'meteorWarning',
  'ping',
] as const;

export type AlertPingKind = (typeof ALERT_PING_KINDS)[number];

export const AlertPingKindSchema = z.enum(ALERT_PING_KINDS);

export const event = defineEvent({
  kind: 'alertPing',
  wave: 'W04',
  severity: 'warn',
  audience: 'player',
  data: z.strictObject({
    q: z.number().int(),
    r: z.number().int(),
    kind: AlertPingKindSchema,
    colonyId: z.string().optional(),
  }),
  summary: 'Emitted when an alert ping occurs at hex (q, r) to drive the minimap ping ring (W04-01, W04-08).',
});
