import type { MatchOutcome } from '../../matching/market-matcher.service.js';
import type { GuildFillNotice, RequoteReport } from './requote.js';

/** What the matcher and the offer accept path call after a guild fill commits. */
export const GUILD_FILL_SINK = Symbol('GUILD_FILL_SINK');

export interface GuildFillSink {
  onMatched(outcome: MatchOutcome): Promise<void>;
  onGuildFill(notice: GuildFillNotice): Promise<RequoteReport | null>;
}
