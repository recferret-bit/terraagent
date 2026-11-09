import { RESOURCE_FAMILIES, type ResourceFamily, type ResourceKey } from '@terra/contracts';
import type { ColonyState } from '../../kernel/state';
import {
  ensureColonyCargoCapState,
  type ColonyCargoCapState,
} from './caps';

export interface PendingCargoMint {
  ref: string;
  exportSeq: number;
  resource: ResourceKey;
  amount: number;
  atTick: number;
}

export interface PendingCargoImport {
  ref: string;
  importSeq: number;
  resource: ResourceKey;
  amount: number;
  requestedAmount?: number;
  debitedInOrbit?: boolean;
  atTick: number;
}

export interface ColonyCargoEvent {
  kind: 'exported' | 'imported' | 'refunded';
  direction: 'export' | 'import';
  ref: string;
  resource: ResourceKey;
  amount: number;
  atTick: number;
}

export interface ColonyCargoState extends ColonyCargoCapState {
  exportSeq: number;
  importSeq: number;
  pendingMint: Record<string, PendingCargoMint>;
  pendingImport: Record<string, PendingCargoImport>;
  reservedByFamily: Record<ResourceFamily, number>;
  inOrbit: Partial<Record<ResourceKey, number>>;
  /** W13 transport service inputs held per operation ref (withdrawn to `sys:transport`); dropped when charged, returned on failure. */
  transportReserve: Record<string, Partial<Record<ResourceKey, number>>>;
  lastEvent?: ColonyCargoEvent;
}

/**
 * Ensures `colony.cargo` (and `colony.cargoCaps`) is initialized as a single shared `ColonyCargoState`
 * holding both the cap window/daily fields (`windowEntries`, `mintedToday`, `utcDay`, `currentUtcDay`, `dailyCapOverride`)
 * and the export/import tracking fields (`exportSeq`, `importSeq`, `pendingMint`, `pendingImport`, `reservedByFamily`, `inOrbit`).
 */
export function ensureColonyCargoState(
  colony: ColonyState,
  currentUtcDay?: number | string,
): ColonyCargoState {
  const capState = ensureColonyCargoCapState(colony, currentUtcDay);
  const raw = capState as unknown as Record<string, unknown>;

  if (typeof raw.exportSeq !== 'number' || !Number.isFinite(raw.exportSeq) || raw.exportSeq < 0) {
    raw.exportSeq = 0;
  } else {
    raw.exportSeq = Math.floor(raw.exportSeq);
  }

  if (typeof raw.importSeq !== 'number' || !Number.isFinite(raw.importSeq) || raw.importSeq < 0) {
    raw.importSeq = 0;
  } else {
    raw.importSeq = Math.floor(raw.importSeq);
  }

  if (!raw.pendingMint || typeof raw.pendingMint !== 'object' || Array.isArray(raw.pendingMint)) {
    raw.pendingMint = {};
  }

  if (!raw.pendingImport || typeof raw.pendingImport !== 'object' || Array.isArray(raw.pendingImport)) {
    raw.pendingImport = {};
  }

  const rawReserved = (raw.reservedByFamily ?? {}) as Partial<Record<ResourceFamily, number>>;
  const reservedByFamily: Record<ResourceFamily, number> = { metals: 0, minerals: 0, bio: 0 };
  for (const fam of RESOURCE_FAMILIES) {
    const val = rawReserved[fam];
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
      reservedByFamily[fam] = val;
    }
  }
  raw.reservedByFamily = reservedByFamily;

  if (!raw.transportReserve || typeof raw.transportReserve !== 'object' || Array.isArray(raw.transportReserve)) {
    raw.transportReserve = {};
  }

  if (!raw.inOrbit || typeof raw.inOrbit !== 'object' || Array.isArray(raw.inOrbit)) {
    raw.inOrbit = {};
  }

  const cargoState = raw as unknown as ColonyCargoState;
  colony.cargo = cargoState;
  colony.cargoCaps = cargoState;
  return cargoState;
}
