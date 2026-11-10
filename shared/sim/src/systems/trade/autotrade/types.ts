import type { AutoTradeLimit, ResourceKey } from '@terra/contracts';
import type { RemedyInput } from '../../../economy/flows/remedies';
import type { Ratio } from '../../../economy/flows/ratio';

export type AutoTradeSupplyKind = 'produce' | 'buy' | 'haul' | 'depot' | 'reserve';

export type AutoTradeRefuse = 'tier' | 'partner' | 'truce_disabled' | 'no_limit' | 'limit' | 'no_surplus';

/** Numbers the caller already measured. This module does not read the world. */
export interface AutoTradeStock {
  readonly resource: ResourceKey;
  readonly stock: number;
  readonly queued: number;
  readonly reserved: number;
  readonly serviceWindow: number;
  readonly reserveFloor: number;
  readonly reserveHorizon: number;
  readonly expectedOwn?: number;
}

/** Remedy inputs for one shortage. Haul is a route, not a `compareRemedies` kind. */
export interface AutoTradeRemedies {
  readonly ask: RemedyInput['ask'];
  readonly localMinutesPerUnit: Ratio | null;
  readonly haulMinutesPerUnit?: Ratio | null;
  readonly depot: RemedyInput['depot'];
  readonly logistics?: RemedyInput['logistics'];
  readonly reserveLoadRelief?: number;
}

export interface AutoTradeForecastInput extends AutoTradeStock {
  readonly storageCap: number;
  readonly limit?: AutoTradeLimit;
  readonly sessionSpent: number;
  readonly partner: string;
  readonly side: 'sell' | 'buy';
  readonly quantity: number;
  readonly truceEnabled?: boolean;
  /** Default true. `false` allows a T2/T3 key through the forecast. */
  readonly tier1Only?: boolean;
  readonly remedies?: AutoTradeRemedies;
}

export interface AutoTradeRemedyRow {
  readonly kind: AutoTradeSupplyKind;
  readonly available: boolean;
  /** Buy is authorized only when `withinAutoTrade` accepts that quantity. Local remedies are not partner trades. */
  readonly authorized: boolean;
  readonly note?: string;
  readonly minutes: Ratio | null;
}

export interface AutoTradeForecast {
  readonly resource: ResourceKey;
  /** Echoed so a refusal cannot be mistaken for a rewritten partner. */
  readonly partner: string;
  /** Whole units after queues, open reservations and the service window. Not reduced by the reserve floor. */
  readonly surplus: number;
  /** Whole units short of the reserve floor plus horizon. */
  readonly shortage: number;
  readonly storagePct: number;
  readonly authorized: boolean;
  readonly reason?: AutoTradeRefuse;
  readonly remedies: readonly AutoTradeRemedyRow[];
  readonly preference?: AutoTradeSupplyKind;
}
