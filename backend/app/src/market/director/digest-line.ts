/** Fields of `directorTrade` the sentence reads. Wave flags do not change it. */
export interface DirectorDigestEvent {
  readonly resource: string;
  readonly side: string;
  readonly amount: number;
  readonly counterparty: string;
}

/** Family display names. Bio uses the Tier-1 member, not the family key `bio`. */
const NAMES: Readonly<Record<string, string>> = {
  'metals.t1': 'metals',
  'metals.t2': 'metals',
  'metals.t3': 'metals',
  'minerals.t1': 'minerals',
  'minerals.t2': 'minerals',
  'minerals.t3': 'minerals',
  'bio.water': 'water',
  'bio.biomass': 'biomass',
};

function resourceName(resource: string): string | null {
  return NAMES[resource] ?? null;
}

/**
 * One director fill. `metals.t1` + sell + 300 + Guild → `Director sold 300 metals to the Guild.`
 * Amount 0, an unknown resource, or a blank counterparty is not a line.
 */
export function directorDigestLine(event: DirectorDigestEvent): string | null {
  const name = resourceName(event.resource);
  const who = event.counterparty.trim();
  if (!name || who.length === 0 || !Number.isInteger(event.amount) || event.amount <= 0) return null;
  if (event.side === 'sell') return `Director sold ${event.amount} ${name} to the ${who}.`;
  if (event.side === 'buy') return `Director bought ${event.amount} ${name} from the ${who}.`;
  return null;
}
