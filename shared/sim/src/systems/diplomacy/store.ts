import type {
  DiplomacyBondToken,
  DiplomacyState,
  TruceDurationHours,
  TruceOffer,
  TruceRecord,
  WarRecord,
} from '@terra/contracts';
import { ensureColonyRecord } from '../../kernel/colonies';
import { setBlob, type PlanetState } from '../../kernel/state';

export const DIPLOMACY_BLOB = 'diplomacy';

export interface StoredTruceOffer extends TruceOffer {
  fromColonyIndex: number;
  toColonyIndex: number;
  fromColonyId: string;
  toColonyId: string;
  durationHours: TruceDurationHours;
  bondToken?: DiplomacyBondToken;
  bondAmount?: number;
}

export interface StoredTruceRecord extends TruceRecord {
  colonyAIndex: number;
  colonyBIndex: number;
  colonyAId: string;
  colonyBId: string;
  durationHours: TruceDurationHours;
  startedAtTick: number;
  cancelledById?: string;
  endReason?: 'expired' | 'cancelled' | 'settled' | 'eliminated';
  bondToken?: DiplomacyBondToken;
  bondAmount?: number;
}

export interface StoredWarRecord extends WarRecord {
  attackerColonyIndex: number;
  defenderColonyIndex: number;
  attackerColonyId: string;
  defenderColonyId: string;
  endReason?: 'objective_met' | 'cancelled' | 'expired' | 'eliminated';
}

export interface DiplomacyBlobValue {
  nextOfferSeq: number;
  nextTruceSeq: number;
  nextWarSeq: number;
  offers: Record<string, StoredTruceOffer>;
  truces: Record<string, StoredTruceRecord>;
  wars: Record<string, StoredWarRecord>;
  oathbreakerUntilByColony: Record<number, number>;
  lastHostilityByPair: Record<string, number>;
  contactsByColony: Record<number, number[]>;
  noContactByColony: Record<number, number[]>;
}

export function emptyDiplomacyBlob(): DiplomacyBlobValue {
  return {
    nextOfferSeq: 1,
    nextTruceSeq: 1,
    nextWarSeq: 1,
    offers: {},
    truces: {},
    wars: {},
    oathbreakerUntilByColony: {},
    lastHostilityByPair: {},
    contactsByColony: {},
    noContactByColony: {},
  };
}

export function readDiplomacyBlob(state: PlanetState): DiplomacyBlobValue {
  const raw = state.blobs[DIPLOMACY_BLOB]?.value as Partial<DiplomacyBlobValue> | undefined;
  if (!raw || typeof raw !== 'object') return emptyDiplomacyBlob();
  return {
    nextOfferSeq: typeof raw.nextOfferSeq === 'number' ? raw.nextOfferSeq : 1,
    nextTruceSeq: typeof raw.nextTruceSeq === 'number' ? raw.nextTruceSeq : 1,
    nextWarSeq: typeof raw.nextWarSeq === 'number' ? raw.nextWarSeq : 1,
    offers: raw.offers ? { ...raw.offers } : {},
    truces: raw.truces ? { ...raw.truces } : {},
    wars: raw.wars ? { ...raw.wars } : {},
    oathbreakerUntilByColony: raw.oathbreakerUntilByColony ? { ...raw.oathbreakerUntilByColony } : {},
    lastHostilityByPair: raw.lastHostilityByPair ? { ...raw.lastHostilityByPair } : {},
    contactsByColony: raw.contactsByColony ? { ...raw.contactsByColony } : {},
    noContactByColony: raw.noContactByColony ? { ...raw.noContactByColony } : {},
  };
}

export function resolveColonyIdStr(state: PlanetState, colonyIndex: number): string {
  const col = state.colonies.find((c) => c && c.index === colonyIndex) ?? state.colonies[colonyIndex];
  return col?.id || `col_${colonyIndex}`;
}

export function resolveColonyIndex(state: PlanetState, ref: number | string | undefined): number {
  if (typeof ref === 'number') {
    return Number.isInteger(ref) && ref >= 0 ? ref : -1;
  }
  if (typeof ref !== 'string') return -1;
  const trimmed = ref.trim();
  if (!trimmed) return -1;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const matchCol = /^col[-_](\d+)$/i.exec(trimmed);
  if (matchCol) {
    const parsed = Number(matchCol[1]);
    const byId = state.colonies.find((c) => c && (c.id === trimmed || c.name === trimmed));
    return byId ? byId.index : parsed;
  }
  const found = state.colonies.find(
    (c) =>
      c &&
      (c.id === trimmed ||
        c.name.toLowerCase() === trimmed.toLowerCase() ||
        c.name.toLowerCase() === `colony ${trimmed.toLowerCase()}`),
  );
  if (found) return found.index;
  if (/^[a-e]$/i.test(trimmed)) {
    const letterIdx = trimmed.toLowerCase().charCodeAt(0) - 97;
    if (state.colonies[letterIdx]) return letterIdx;
  }
  return -1;
}

export function pairKey(colA: number, colB: number): string {
  return colA <= colB ? `${colA}:${colB}` : `${colB}:${colA}`;
}

export function syncColonyDiplomacyViews(
  state: PlanetState,
  blob: DiplomacyBlobValue,
  tick: number,
): void {
  const indices = new Set<number>();
  for (const c of state.colonies) if (c && c.index >= 0) indices.add(c.index);
  for (const k of Object.keys(blob.oathbreakerUntilByColony)) indices.add(Number(k));
  for (const o of Object.values(blob.offers)) {
    indices.add(o.fromColonyIndex);
    indices.add(o.toColonyIndex);
  }
  for (const t of Object.values(blob.truces)) {
    indices.add(t.colonyAIndex);
    indices.add(t.colonyBIndex);
  }
  for (const w of Object.values(blob.wars)) {
    indices.add(w.attackerColonyIndex);
    indices.add(w.defenderColonyIndex);
  }

  for (const idx of indices) {
    if (!Number.isInteger(idx) || idx < 0) continue;
    const col = ensureColonyRecord(state, idx, tick);
    const colId = col.id || `col_${idx}`;
    const rawOath = blob.oathbreakerUntilByColony[idx] ?? (col.oathbreakerUntil as number | undefined);
    const oathbreakerUntil = typeof rawOath === 'number' && rawOath > tick ? rawOath : null;
    col.oathbreakerUntil = oathbreakerUntil;

    const truces = Object.values(blob.truces).filter(
      (t) =>
        (t.colonyAIndex === idx || t.colonyBIndex === idx || t.colonyAId === colId || t.colonyBId === colId) &&
        (t.status === 'active' || t.status === 'notice'),
    );
    const wars = Object.values(blob.wars).filter(
      (w) =>
        (w.attackerColonyIndex === idx ||
          w.defenderColonyIndex === idx ||
          w.attackerColonyId === colId ||
          w.defenderColonyId === colId) &&
        w.status === 'active' &&
        w.expiresAtTick > tick,
    );
    const incomingOffers = Object.values(blob.offers).filter(
      (o) => (o.toColonyIndex === idx || o.toColonyId === colId) && o.status === 'pending' && o.expiresAtTick > tick,
    );
    const outgoingOffers = Object.values(blob.offers).filter(
      (o) => (o.fromColonyIndex === idx || o.fromColonyId === colId) && o.status === 'pending' && o.expiresAtTick > tick,
    );

    const view: DiplomacyState & {
      oathbreakerUntil: number | null;
      incomingOffers: StoredTruceOffer[];
      outgoingOffers: StoredTruceOffer[];
      contacts: number[];
    } = {
      oathbreakerUntil,
      truces,
      wars,
      offers: [...incomingOffers, ...outgoingOffers],
      oathbreakerUntilByColony: Object.fromEntries(
        Object.entries(blob.oathbreakerUntilByColony).map(([k, v]) => [String(k), v]),
      ),
      lastHostilityAtByPair: { ...blob.lastHostilityByPair },
      incomingOffers,
      outgoingOffers,
      contacts: blob.contactsByColony[idx] ?? [],
    };
    col.diplomacy = view;
    col.changedAt = tick;
  }
}

export function writeDiplomacyBlob(state: PlanetState, blob: DiplomacyBlobValue, tick: number): void {
  setBlob(state, DIPLOMACY_BLOB, blob, tick);
  syncColonyDiplomacyViews(state, blob, tick);
}

/** Records a hostile action between `colA` and `colB` at `tick` (blocks truce proposals for 10 min, UO-DIP-01). */
export function recordHostilityBetween(
  state: PlanetState,
  colA: number,
  colB: number,
  tick: number = state.meta.tick,
): void {
  if (colA < 0 || colB < 0 || colA === colB) return;
  const blob = readDiplomacyBlob(state);
  const key = pairKey(colA, colB);
  const prev = blob.lastHostilityByPair[key];
  if (prev === undefined || tick >= prev) {
    blob.lastHostilityByPair[key] = tick;
    markColonyContact(state, colA, colB, tick, blob);
    writeDiplomacyBlob(state, blob, tick);
  }
}

export function getLastHostilityTick(state: PlanetState, colA: number, colB: number): number | undefined {
  if (colA < 0 || colB < 0 || colA === colB) return undefined;
  const blob = readDiplomacyBlob(state);
  return blob.lastHostilityByPair[pairKey(colA, colB)];
}

export function markColonyContact(
  state: PlanetState,
  colA: number,
  colB: number,
  tick: number = state.meta.tick,
  existingBlob?: DiplomacyBlobValue,
): void {
  if (colA < 0 || colB < 0 || colA === colB) return;
  const blob = existingBlob ?? readDiplomacyBlob(state);
  const listA = new Set(blob.contactsByColony[colA] ?? []);
  const listB = new Set(blob.contactsByColony[colB] ?? []);
  listA.add(colB);
  listB.add(colA);
  blob.contactsByColony[colA] = [...listA].sort((a, b) => a - b);
  blob.contactsByColony[colB] = [...listB].sort((a, b) => a - b);
  if (blob.noContactByColony[colA]) {
    blob.noContactByColony[colA] = blob.noContactByColony[colA].filter((x) => x !== colB);
  }
  if (blob.noContactByColony[colB]) {
    blob.noContactByColony[colB] = blob.noContactByColony[colB].filter((x) => x !== colA);
  }
  if (!existingBlob) writeDiplomacyBlob(state, blob, tick);
}

export function setColonyNoContact(
  state: PlanetState,
  colA: number,
  colB: number,
  tick: number = state.meta.tick,
): void {
  if (colA < 0 || colB < 0 || colA === colB) return;
  const blob = readDiplomacyBlob(state);
  blob.contactsByColony[colA] = (blob.contactsByColony[colA] ?? []).filter((x) => x !== colB);
  blob.contactsByColony[colB] = (blob.contactsByColony[colB] ?? []).filter((x) => x !== colA);
  const noA = new Set(blob.noContactByColony[colA] ?? []);
  const noB = new Set(blob.noContactByColony[colB] ?? []);
  noA.add(colB);
  noB.add(colA);
  blob.noContactByColony[colA] = [...noA];
  blob.noContactByColony[colB] = [...noB];
  writeDiplomacyBlob(state, blob, tick);
}

export function markColonyOathbreaker(
  state: PlanetState,
  colonyIndex: number,
  untilTick: number,
  tick: number = state.meta.tick,
): void {
  if (colonyIndex < 0) return;
  const blob = readDiplomacyBlob(state);
  blob.oathbreakerUntilByColony[colonyIndex] = untilTick;
  writeDiplomacyBlob(state, blob, tick);
}

export function getOathbreakerUntil(state: PlanetState, colonyIndex: number): number | null {
  if (colonyIndex < 0) return null;
  const blob = readDiplomacyBlob(state);
  const fromBlob = blob.oathbreakerUntilByColony[colonyIndex];
  const fromCol = state.colonies[colonyIndex]?.oathbreakerUntil as number | null | undefined;
  const val = typeof fromBlob === 'number' ? fromBlob : typeof fromCol === 'number' ? fromCol : null;
  return val;
}

export function isColonyOathbreaker(
  state: PlanetState,
  colonyIndex: number,
  tick: number = state.meta.tick,
): boolean {
  const until = getOathbreakerUntil(state, colonyIndex);
  return typeof until === 'number' && until > tick;
}

/**
 * Returns `true` when `colA` and `colB` currently have an active or 10-min cancel-notice truce (`UO-DIP-03`, `UO-DIP-04`).
 */
export function hasActiveTruce(
  state: PlanetState,
  colA: number,
  colB: number,
  tick: number = state.meta.tick,
): boolean {
  if (colA < 0 || colB < 0 || colA === colB) return false;
  const blob = readDiplomacyBlob(state);
  for (const t of Object.values(blob.truces)) {
    const matchesPair =
      (t.colonyAIndex === colA && t.colonyBIndex === colB) ||
      (t.colonyAIndex === colB && t.colonyBIndex === colA);
    if (!matchesPair) continue;
    if (t.status === 'active' && t.expiresAtTick > tick) return true;
    if (t.status === 'notice' && (t.noticeEndsAtTick ?? t.expiresAtTick) > tick) return true;
  }
  return false;
}

export function getActiveTrucesForColony(
  state: PlanetState,
  colonyIndex: number,
  tick: number = state.meta.tick,
): StoredTruceRecord[] {
  if (colonyIndex < 0) return [];
  const blob = readDiplomacyBlob(state);
  return Object.values(blob.truces).filter(
    (t) =>
      (t.colonyAIndex === colonyIndex || t.colonyBIndex === colonyIndex) &&
      ((t.status === 'active' && t.expiresAtTick > tick) ||
        (t.status === 'notice' && (t.noticeEndsAtTick ?? t.expiresAtTick) > tick)),
  );
}

export function isValidTruceDurationHours(hours: unknown): hours is TruceDurationHours {
  return hours === 2 || hours === 6 || hours === 24 || hours === 72;
}

/** Returns `true` when `attackerColony` currently has an active 6h Bonded War against `defenderColony`. */
export function hasActiveWar(
  state: PlanetState,
  attackerColony: number,
  defenderColony: number,
  tick: number = state.meta.tick,
): boolean {
  if (attackerColony < 0 || defenderColony < 0 || attackerColony === defenderColony) return false;
  const raw = state.blobs[DIPLOMACY_BLOB]?.value as Partial<DiplomacyBlobValue> | undefined;
  if (!raw?.wars) return false;
  for (const w of Object.values(raw.wars)) {
    if (
      w.status === 'active' &&
      w.expiresAtTick > tick &&
      w.attackerColonyIndex === attackerColony &&
      w.defenderColonyIndex === defenderColony
    ) {
      return true;
    }
  }
  return false;
}

/** Returns `true` when either colony currently has an active Bonded War against the other. */
export function hasAnyActiveWarBetween(
  state: PlanetState,
  colA: number,
  colB: number,
  tick: number = state.meta.tick,
): boolean {
  return hasActiveWar(state, colA, colB, tick) || hasActiveWar(state, colB, colA, tick);
}
