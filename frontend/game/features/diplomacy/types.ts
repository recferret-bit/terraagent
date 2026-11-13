import type { Feature } from '../../core/registry/types';
import { formatCountdownSeconds } from '../shared/neighborMarkers';
import { applyDiplomacySimEventInternal } from './parts/diplomacyEvents';

export { formatCountdownSeconds };

export const TRUCE_DURATIONS_HOURS = [2, 6, 24, 72] as const;
export type TruceDurationHours = (typeof TRUCE_DURATIONS_HOURS)[number];
export type TruceStatus = 'active' | 'notice' | 'ended';
export type GameFeature = Feature;
export const TICKS_PER_SECOND = 5;

export interface DiplomacyBondSpec {
  readonly bondToken: string;
  readonly bondAmount: number;
}

export interface DiplomacyOfferView {
  offerId: string;
  fromColony: number;
  fromColonyId?: string;
  toColony: number;
  toColonyId?: string;
  hours: TruceDurationHours;
  offeredAtTick: number;
  expiresAtTick: number;
  status?: string;
  bondToken?: string;
  bondAmount?: number;
}

export interface DiplomacyTruceView {
  truceId: string;
  colonyA: number;
  colonyB: number;
  colonyAId?: string;
  colonyBId?: string;
  partnerColony: number;
  partnerColonyId?: string;
  hours: TruceDurationHours;
  signedAtTick: number;
  expiresAtTick: number;
  status: TruceStatus;
  noticeEndsAtTick?: number;
  cancelledBy?: number;
  bondToken?: string;
  bondAmount?: number;
}

export interface DiplomacyWarView {
  warId: string;
  attackerColony: number;
  defenderColony: number;
  partnerColony: number;
  role: 'attacker' | 'defender';
  bondToken: string;
  bondAmount: number;
  declaredAtTick: number;
  expiresAtTick: number;
  structuresDestroyed: number;
  resourcesSiphoned: number;
  status: 'active' | 'completed' | 'cancelled' | 'expired' | 'eliminated';
}

export interface DiplomacyColonyView {
  colonyIndex: number;
  colonyId?: string;
  currentTick: number;
  oathbreakerUntil: number | null;
  incomingOffers: DiplomacyOfferView[];
  outgoingOffers: DiplomacyOfferView[];
  truces: DiplomacyTruceView[];
  wars?: DiplomacyWarView[];
  contacts: number[];
}

export interface DiplomacyPanelActions {
  onRespondTruce(offerId: string, accept: boolean): void;
  onCancelTruce(truceId: string): void;
  onProposeTruce(targetColonyId: string | number, hours: TruceDurationHours, bond?: DiplomacyBondSpec): void;
  onDeclareWar?(targetColonyId: string | number, bond: DiplomacyBondSpec): void;
  onCancelWar?(warId: string): void;
}

export interface DiplomacyPanelOptions {
  actions?: Partial<DiplomacyPanelActions>;
  ownColonyIndex?: number;
  getOwnColonyIndex?: () => number;
  colonyId?: string;
  warsEnabled?: boolean;
}

export function formatTickRemaining(targetTick: number, currentTick: number): string {
  const remTicks = Math.max(0, targetTick - currentTick);
  const seconds = Math.ceil(remTicks / TICKS_PER_SECOND);
  return formatCountdownSeconds(seconds);
}

export function formatBondLabel(bondAmount?: number, bondToken?: string): string {
  if (!bondAmount || bondAmount <= 0) return 'Free (Unbonded)';
  const tok = bondToken === 'metals.t1' ? 'Metals' : bondToken === 'minerals.t1' ? 'Minerals' : (bondToken ?? 'NEAR');
  return `${bondAmount} ${tok} Bond`;
}

function normalizeHours(val: unknown): TruceDurationHours {
  if (val === 2 || val === 6 || val === 24 || val === 72) return val;
  const num = Number(val);
  if (num === 2 || num === 6 || num === 24 || num === 72) return num;
  return 6;
}

function resolveColonyAndTick(snapshot: unknown, ownColonyIdx: number, currentTick?: number): { col: any; tick: number; colId?: string } {
  const s = snapshot as any;
  let tick = typeof currentTick === 'number' && currentTick >= 0 ? currentTick : 0;
  if (typeof s?.tick === 'number') tick = s.tick;
  else if (typeof s?.meta?.tick === 'number') tick = s.meta.tick;

  let col: any = undefined;
  if (Array.isArray(s?.colonies)) {
    col = s.colonies.find((c: any) => c?.index === ownColonyIdx) ?? s.colonies[ownColonyIdx] ?? s.colonies[0];
  } else if (s && typeof s === 'object') {
    if (s.index !== undefined || s.diplomacy !== undefined || s.truces !== undefined) col = s;
    else if (s.colony && typeof s.colony === 'object') col = s.colony;
  }
  const colId = col?.id ? String(col.id) : undefined;
  return { col, tick, colId };
}

function extractOffers(col: any, ownColonyIdx: number, colId: string | undefined, tick: number): { incoming: DiplomacyOfferView[]; outgoing: DiplomacyOfferView[] } {
  const rawList: any[] = [];
  if (Array.isArray(col?.diplomacy?.incomingOffers)) rawList.push(...col.diplomacy.incomingOffers);
  if (Array.isArray(col?.diplomacy?.outgoingOffers)) rawList.push(...col.diplomacy.outgoingOffers);
  if (Array.isArray(col?.diplomacy?.offers)) rawList.push(...col.diplomacy.offers);
  if (Array.isArray(col?.offers)) rawList.push(...col.offers);

  const seen = new Set<string>();
  const incoming: DiplomacyOfferView[] = [];
  const outgoing: DiplomacyOfferView[] = [];

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const offerId = String(item.offerId || item.id || '');
    if (!offerId || seen.has(offerId)) continue;
    seen.add(offerId);

    const fromColony = Number(item.fromColony ?? item.fromColonyIndex ?? 0);
    const toColony = Number(item.toColony ?? item.toColonyIndex ?? 0);
    const fromColonyId = item.fromColonyId ? String(item.fromColonyId) : undefined;
    const toColonyId = item.toColonyId ? String(item.toColonyId) : undefined;
    const expiresAtTick = Number(item.expiresAtTick ?? 0);
    const status = String(item.status || 'pending');
    if (status !== 'pending' || expiresAtTick <= tick) continue;

    const bondAmount = typeof item.bondAmount === 'number' && item.bondAmount > 0 ? item.bondAmount : undefined;
    const offer: DiplomacyOfferView = {
      offerId,
      fromColony,
      fromColonyId,
      toColony,
      toColonyId,
      hours: normalizeHours(item.hours ?? item.durationHours),
      offeredAtTick: Number(item.offeredAtTick ?? 0),
      expiresAtTick,
      status,
      ...(bondAmount ? { bondAmount, bondToken: String(item.bondToken || 'NEAR') } : {}),
    };

    if (toColony === ownColonyIdx || (colId && toColonyId === colId)) incoming.push(offer);
    else if (fromColony === ownColonyIdx || (colId && fromColonyId === colId)) outgoing.push(offer);
  }
  return { incoming, outgoing };
}

function extractTruces(col: any, ownColonyIdx: number, colId: string | undefined, tick: number): DiplomacyTruceView[] {
  const rawTruces: any[] = [];
  if (Array.isArray(col?.diplomacy?.truces)) rawTruces.push(...col.diplomacy.truces);
  if (Array.isArray(col?.truces)) rawTruces.push(...col.truces);

  const seen = new Set<string>();
  const result: DiplomacyTruceView[] = [];

  for (const item of rawTruces) {
    if (!item || typeof item !== 'object') continue;
    const truceId = String(item.truceId || item.id || '');
    if (!truceId || seen.has(truceId)) continue;
    seen.add(truceId);

    const colA = Number(item.colonyA ?? item.colonyAIndex ?? 0);
    const colB = Number(item.colonyB ?? item.colonyBIndex ?? 0);
    const colAId = item.colonyAId ? String(item.colonyAId) : undefined;
    const colBId = item.colonyBId ? String(item.colonyBId) : undefined;
    const expiresAtTick = Number(item.expiresAtTick ?? 0);
    const status = (item.status as TruceStatus) || 'active';
    if (status === 'ended' || expiresAtTick <= tick) continue;

    const isA = colA === ownColonyIdx || (colId && colAId === colId);
    const isB = colB === ownColonyIdx || (colId && colBId === colId);
    if (!isA && !isB) continue;

    const bondAmount = typeof item.bondAmount === 'number' && item.bondAmount > 0 ? item.bondAmount : undefined;
    result.push({
      truceId,
      colonyA: colA,
      colonyB: colB,
      colonyAId: colAId,
      colonyBId: colBId,
      partnerColony: isA ? colB : colA,
      partnerColonyId: isA ? colBId : colAId,
      hours: normalizeHours(item.hours ?? item.durationHours),
      signedAtTick: Number(item.signedAtTick ?? 0),
      expiresAtTick,
      status,
      noticeEndsAtTick: typeof item.noticeEndsAtTick === 'number' ? item.noticeEndsAtTick : undefined,
      cancelledBy: typeof item.cancelledBy === 'number' ? item.cancelledBy : undefined,
      ...(bondAmount ? { bondAmount, bondToken: String(item.bondToken || 'NEAR') } : {}),
    });
  }
  return result;
}

function extractWars(col: any, ownColonyIdx: number, colId: string | undefined, tick: number): DiplomacyWarView[] {
  const rawWars: any[] = [];
  if (Array.isArray(col?.diplomacy?.wars)) rawWars.push(...col.diplomacy.wars);
  if (Array.isArray(col?.wars)) rawWars.push(...col.wars);

  const seen = new Set<string>();
  const result: DiplomacyWarView[] = [];
  for (const item of rawWars) {
    if (!item || typeof item !== 'object') continue;
    const warId = String(item.warId || item.id || '');
    if (!warId || seen.has(warId)) continue;
    seen.add(warId);

    const attacker = Number(item.attackerColonyIndex ?? item.attackerColony ?? 0);
    const defender = Number(item.defenderColonyIndex ?? item.defenderColony ?? 0);
    const attackerId = item.attackerColonyId ? String(item.attackerColonyId) : undefined;
    const defenderId = item.defenderColonyId ? String(item.defenderColonyId) : undefined;
    const expiresAtTick = Number(item.expiresAtTick ?? 0);
    const status = String(item.status || 'active');
    if (status !== 'active' || expiresAtTick <= tick) continue;

    const isAttacker = attacker === ownColonyIdx || (colId && attackerId === colId);
    const isDefender = defender === ownColonyIdx || (colId && defenderId === colId);
    if (!isAttacker && !isDefender) continue;

    result.push({
      warId,
      attackerColony: attacker,
      defenderColony: defender,
      partnerColony: isAttacker ? defender : attacker,
      role: isAttacker ? 'attacker' : 'defender',
      bondToken: String(item.bondToken || 'NEAR'),
      bondAmount: Number(item.bondAmount ?? 5),
      declaredAtTick: Number(item.declaredAtTick ?? 0),
      expiresAtTick,
      structuresDestroyed: Number(item.structuresDestroyed ?? 0),
      resourcesSiphoned: Number(item.resourcesSiphoned ?? 0),
      status: 'active',
    });
  }
  return result;
}

export function extractDiplomacyColonyView(
  snapshot: unknown,
  ownColonyIdx = 0,
  currentTick?: number,
): DiplomacyColonyView {
  const { col, tick, colId } = resolveColonyAndTick(snapshot, ownColonyIdx, currentTick);
  const { incoming, outgoing } = extractOffers(col, ownColonyIdx, colId, tick);
  const truces = extractTruces(col, ownColonyIdx, colId, tick);
  const wars = extractWars(col, ownColonyIdx, colId, tick);

  let rawOath = col?.diplomacy?.oathbreakerUntil ?? col?.oathbreakerUntil;
  if (rawOath === undefined && col?.diplomacy?.oathbreakerUntilByColony) {
    rawOath = col.diplomacy.oathbreakerUntilByColony[ownColonyIdx] ?? col.diplomacy.oathbreakerUntilByColony[String(ownColonyIdx)];
  }
  const oathbreakerUntil = typeof rawOath === 'number' && rawOath > tick ? rawOath : null;

  const rawContacts = col?.diplomacy?.contacts ?? col?.contacts ?? [];
  const contacts = Array.isArray(rawContacts) ? rawContacts.map((c: unknown) => Number(c)).filter(Number.isInteger) : [];

  return {
    colonyIndex: ownColonyIdx,
    colonyId: colId,
    currentTick: tick,
    oathbreakerUntil,
    incomingOffers: incoming,
    outgoingOffers: outgoing,
    truces,
    wars,
    contacts,
  };
}

export function applyDiplomacySimEvent(
  current: DiplomacyColonyView,
  event: { kind: string; data?: Record<string, unknown> },
  ownColonyIdx?: number,
  currentTick?: number,
): DiplomacyColonyView {
  return applyDiplomacySimEventInternal(current, event, ownColonyIdx, currentTick);
}
