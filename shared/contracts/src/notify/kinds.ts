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

/** Channels a subscription can bind (CT-35). Email is out of scope. */
export const NOTIFICATION_CHANNELS = ['webpush', 'telegram'] as const;
export const NotificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;
