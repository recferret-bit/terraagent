import { TICKS_PER_SECOND } from '../../../kernel/constants';
import { setBlob, type PlanetState } from '../../../kernel/state';
import {
  DIPLOMACY_BLOB,
  peekDiplomacyBlob,
  type DiplomacyBlobValue,
  type StoredTruceOffer,
  type StoredTruceRecord,
  type StoredWarRecord,
} from '../store';

/** Closed records kept per kind (offers, truces, wars); open ones are always kept. */
export const CLOSED_DIPLOMACY_RECORDS_KEPT = 16;
/** An AI does not re-offer a truce to a colony that declined one within this window (10 game minutes). */
export const TRUCE_REOFFER_COOLDOWN_TICKS = 600 * TICKS_PER_SECOND;

const isOfferOpen = (o: StoredTruceOffer): boolean => o.status === undefined || o.status === 'pending';
const isTruceOpen = (t: StoredTruceRecord): boolean => t.status === 'active' || t.status === 'notice';
const isWarOpen = (w: StoredWarRecord): boolean => w.status === 'active';

function trailingSeq(id: string): number {
  const m = /(\d+)$/.exec(id);
  return m ? Number(m[1]) : -1;
}

/**
 * Returns a copy of `dict` without its oldest closed records beyond `keep`, or `null` when nothing is dropped.
 * "Oldest" is the lowest trailing sequence number of the record key (`of_12`, `tr_3`, `war_7`), then insertion order.
 */
export function pruneClosedRecords<T>(
  dict: Readonly<Record<string, T>>,
  isOpen: (rec: T) => boolean,
  keep: number = CLOSED_DIPLOMACY_RECORDS_KEPT,
): Record<string, T> | null {
  const closed: Array<{ key: string; seq: number; order: number }> = [];
  let order = 0;
  for (const key in dict) {
    const rec = dict[key];
    if (rec && !isOpen(rec)) closed.push({ key, seq: trailingSeq(key), order });
    order++;
  }
  if (closed.length <= keep) return null;
  closed.sort((a, b) => b.seq - a.seq || b.order - a.order);
  const next = { ...dict };
  for (let i = keep; i < closed.length; i++) delete next[closed[i]!.key];
  return next;
}

function pruneStaleDeclines(
  declined: Readonly<Record<string, number>> | undefined,
  tick: number,
): Record<string, number> | null {
  if (!declined) return null;
  let next: Record<string, number> | null = null;
  for (const key in declined) {
    if (tick - declined[key]! < TRUCE_REOFFER_COOLDOWN_TICKS) continue;
    next ??= { ...declined };
    delete next[key];
  }
  return next;
}

/**
 * Silent retention pass (no events): keeps pending offers, active/notice truces and active wars, plus only the
 * newest `CLOSED_DIPLOMACY_RECORDS_KEPT` closed records per kind; drops stale decline cooldowns.
 * Idempotent and allocation-free when nothing is over the cap. Colony views list open records only, so they
 * are unaffected and are not rewritten.
 */
export function enforceDiplomacyRetention(state: PlanetState, tick: number = state.meta.tick): boolean {
  const raw = state.blobs[DIPLOMACY_BLOB]?.value as Partial<DiplomacyBlobValue> | undefined;
  if (!raw || typeof raw !== 'object') return false;
  const offers = raw.offers ? pruneClosedRecords(raw.offers, isOfferOpen) : null;
  const truces = raw.truces ? pruneClosedRecords(raw.truces, isTruceOpen) : null;
  const wars = raw.wars ? pruneClosedRecords(raw.wars, isWarOpen) : null;
  const declinedAtByPair = pruneStaleDeclines(raw.declinedAtByPair, tick);
  if (!offers && !truces && !wars && !declinedAtByPair) return false;
  setBlob(
    state,
    DIPLOMACY_BLOB,
    {
      ...raw,
      ...(offers ? { offers } : {}),
      ...(truces ? { truces } : {}),
      ...(wars ? { wars } : {}),
      ...(declinedAtByPair ? { declinedAtByPair } : {}),
    },
    tick,
  );
  return true;
}

function declineKey(fromColony: number, toColony: number): string {
  return `${fromColony}>${toColony}`;
}

/** Records that `toColony` declined a truce offered by `fromColony` at `tick` (call on the writer's blob copy). */
export function recordTruceDecline(blob: DiplomacyBlobValue, fromColony: number, toColony: number, tick: number): void {
  blob.declinedAtByPair = { ...blob.declinedAtByPair, [declineKey(fromColony, toColony)]: tick };
}

/** True while `fromColony` must not re-offer a truce to `toColony` (declined within the last 10 game minutes). */
export function isTruceReofferCoolingDown(
  state: PlanetState,
  fromColony: number,
  toColony: number,
  tick: number = state.meta.tick,
): boolean {
  const at = peekDiplomacyBlob(state).declinedAtByPair?.[declineKey(fromColony, toColony)];
  return typeof at === 'number' && tick - at < TRUCE_REOFFER_COOLDOWN_TICKS;
}
