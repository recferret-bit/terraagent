import { quoteGuild, type CompiledDataLike, type GuildQuoteFixture } from '@terra/sim';
import { parseGuildStrategy, type GuildStrategyRejectCode } from './port.js';

export interface AppliedGuildStrategy {
  readonly rejected: GuildStrategyRejectCode | null;
  readonly route: string | null;
  readonly quotes: ReturnType<typeof quoteGuild>;
}

/**
 * Route the visit keeps. A rejected payload, including `free_price`, leaves the data route in place.
 * A token already on the data route (the deterministic `loop-local`) does not grow a second copy.
 */
export function routeAfterStrategy(dataRoute: readonly string[], raw: unknown): readonly string[] {
  const read = readStrategyTargets(raw);
  if (!read.ok || dataRoute.includes(read.route)) return [...dataRoute];
  return [read.route, ...dataRoute];
}

/** Accepted stockpile goals, or `undefined` when `parseGuildStrategy` rejects the payload. */
export function stockpileTargets(raw: unknown): ReadonlyMap<string, bigint> | undefined {
  const read = readStrategyTargets(raw);
  return read.ok ? read.targets : undefined;
}

/**
 * Price one pair with `quoteGuild`. A rejected strategy does not set `stockpileTarget`,
 * so the guild-table target and the previous quote stay.
 */
export function priceGuildPair(data: CompiledDataLike, fixture: GuildQuoteFixture, raw: unknown): AppliedGuildStrategy {
  const read = readStrategyTargets(raw);
  const target = read.ok ? read.targets.get(fixture.resource) : undefined;
  const next = target === undefined ? fixture : { ...fixture, stockpileTarget: target };
  return {
    rejected: read.ok ? null : read.code,
    route: read.ok ? read.route : null,
    quotes: quoteGuild(data, next),
  };
}

function readStrategyTargets(
  raw: unknown,
):
  | { readonly ok: true; readonly route: string; readonly targets: ReadonlyMap<string, bigint> }
  | { readonly ok: false; readonly code: GuildStrategyRejectCode } {
  const parsed = parseGuildStrategy(raw);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    route: parsed.value.route,
    targets: new Map(parsed.value.stockpile.map((goal) => [goal.resource, BigInt(goal.target)])),
  };
}
