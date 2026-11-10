import { z } from 'zod';

/**
 * The eight player-configurable notification kinds (CONTINUITY CT-36).
 * All are on by default. `under_attack` is debounced 10 minutes by the router (W09-21).
 */
export const NOTIFICATION_KINDS = [
  'under_attack',
  'colony_critical',
  'colony_eliminated',
  'energy_collapse',
  'rocket_ready',
  'truce_offered',
  'trade_offer',
  'away_budget_exhausted',
] as const;

export const NotificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

/**
 * `NotifierPort.send` kinds that are not player toggles. `deed_settled` is W20's one-shot
 * push when a Colony Deed seals. It stays out of `NOTIFICATION_KINDS` (CT-36 is eight).
 */
export const NOTIFIER_EXTRA_KINDS = ['deed_settled'] as const;
export const NotifierKindSchema = z.union([NotificationKindSchema, z.enum(NOTIFIER_EXTRA_KINDS)]);
export type NotifierKind = z.infer<typeof NotifierKindSchema>;

/** Channels a subscription can bind (CT-35). Email is out of scope. */
export const NOTIFICATION_CHANNELS = ['webpush', 'telegram'] as const;
export const NotificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;
