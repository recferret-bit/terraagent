/**
 * Consent-gated analytics tracker for W18 PvP and Diplomacy events (W18-24, CLIENT §10).
 *
 * Emits the four core PvP funnel events:
 * - `raid_started`: when an offensive raid begins against another colony.
 * - `colony_eliminated`: when a colony falls to raid, timer, abandonment, or hub/hq loss.
 * - `truce_signed`: when a bilateral non-aggression pact is established.
 * - `truce_broken`: when a truce is cancelled prematurely with notice or ended.
 */

export const PVP_EVENTS = [
  'raid_started',
  'colony_eliminated',
  'truce_signed',
  'truce_broken',
] as const;

export type PvpEventName = (typeof PVP_EVENTS)[number];

export type TrackFn = (name: string, props?: Record<string, any>) => void;

export interface RaidStartedTrackProps {
  readonly colonyId: string;
  readonly planetId?: string;
  readonly attackerColonyId?: string;
  readonly targetColonyId: string;
  readonly unitCount: number;
}

export interface ColonyEliminatedTrackProps {
  readonly colonyId: string;
  readonly planetId?: string;
  readonly cause: 'both_lost' | 'critical_timeout' | 'abandoned' | 'hub_and_hq_destroyed';
  readonly killerColonyId?: string;
}

export interface TruceSignedTrackProps {
  readonly colonyId: string;
  readonly planetId?: string;
  readonly truceId?: string;
  readonly partnerColonyId: string;
  readonly durationHours: 2 | 6 | 24 | 72;
}

export interface TruceBrokenTrackProps {
  readonly colonyId: string;
  readonly planetId?: string;
  readonly truceId?: string;
  readonly byColonyId: string;
  readonly partnerColonyId?: string;
  readonly oathbreakerHours?: number;
}

export interface SimEventInput {
  readonly kind: string;
  readonly colonyIds?: readonly (string | number)[];
  readonly data?: Record<string, unknown>;
}

function isNonEmpty(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

function parseDurationHours(val: unknown): 2 | 6 | 24 | 72 {
  if (val === 2 || val === 6 || val === 24 || val === 72) return val;
  if (val === '2') return 2;
  if (val === '6') return 6;
  if (val === '24') return 24;
  if (val === '72') return 72;
  return 24;
}

function mapEliminationCause(
  raw: unknown,
): 'both_lost' | 'critical_timeout' | 'abandoned' | 'hub_and_hq_destroyed' {
  if (raw === 'both_lost') return 'both_lost';
  if (raw === 'critical_timeout' || raw === 'timer') return 'critical_timeout';
  if (raw === 'abandoned') return 'abandoned';
  if (raw === 'hub_and_hq_destroyed' || raw === 'hq_lost') return 'hub_and_hq_destroyed';
  return 'hub_and_hq_destroyed';
}

function resolvePartnerColonyId(data: Record<string, unknown>, ownColonyId: string): string {
  if (isNonEmpty(data.partnerColonyId)) return data.partnerColonyId.trim();
  const rawA = data.colonyAId ?? (data.colonyA !== undefined ? String(data.colonyA) : undefined);
  const rawB = data.colonyBId ?? (data.colonyB !== undefined ? String(data.colonyB) : undefined);
  if (rawA !== undefined && rawB !== undefined) {
    const aStr = String(rawA).trim();
    const bStr = String(rawB).trim();
    if (aStr === ownColonyId || `col_${aStr}` === ownColonyId) return bStr;
    return aStr;
  }
  if (isNonEmpty(data.colonyId) && data.colonyId.trim() !== ownColonyId) {
    return data.colonyId.trim();
  }
  return '';
}

function isColonyRelevant(
  colonyIds: readonly (string | number)[] | undefined,
  ownColonyId: string,
  data?: Record<string, unknown>,
): boolean {
  if (!colonyIds || colonyIds.length === 0) return true;
  const match = (val: unknown) => {
    if (val === undefined || val === null) return false;
    const s = String(val).trim();
    return s === ownColonyId || ownColonyId === `col_${s}` || s === `col_${ownColonyId}`;
  };
  if (colonyIds.some(match)) return true;
  if (!data) return false;
  return (
    match(data.colonyId) ||
    match(data.attackerColonyId) ||
    match(data.attackerColony) ||
    match(data.targetColonyId) ||
    match(data.targetColony) ||
    match(data.colonyAId) ||
    match(data.colonyA) ||
    match(data.colonyBId) ||
    match(data.colonyB) ||
    match(data.partnerColonyId) ||
    match(data.byColonyId) ||
    match(data.cancelledBy) ||
    match(data.cancelledByColonyId) ||
    match(data.killerColonyId)
  );
}

export class PvpTracker {
  private readonly seenRaids = new Set<string>();
  private readonly seenEliminations = new Set<string>();
  private readonly seenSignedTruces = new Set<string>();
  private readonly seenBrokenTruces = new Set<string>();

  constructor(private readonly track: TrackFn | undefined) {}

  raidStarted(props: RaidStartedTrackProps): void {
    if (!props || !isNonEmpty(props.colonyId) || !isNonEmpty(props.targetColonyId)) return;
    if (typeof props.unitCount !== 'number' || !Number.isFinite(props.unitCount) || props.unitCount < 0) return;

    this.track?.('raid_started', {
      colonyId: props.colonyId.trim(),
      targetColonyId: props.targetColonyId.trim(),
      unitCount: Math.round(props.unitCount),
      ...(isNonEmpty(props.planetId) ? { planetId: props.planetId.trim() } : {}),
      ...(isNonEmpty(props.attackerColonyId) ? { attackerColonyId: props.attackerColonyId.trim() } : {}),
    });
  }

  colonyEliminated(props: ColonyEliminatedTrackProps): void {
    if (!props || !isNonEmpty(props.colonyId) || !props.cause) return;

    this.track?.('colony_eliminated', {
      colonyId: props.colonyId.trim(),
      cause: props.cause,
      ...(isNonEmpty(props.planetId) ? { planetId: props.planetId.trim() } : {}),
      ...(isNonEmpty(props.killerColonyId) ? { killerColonyId: props.killerColonyId.trim() } : {}),
    });
  }

  truceSigned(props: TruceSignedTrackProps): void {
    if (!props || !isNonEmpty(props.colonyId) || !isNonEmpty(props.partnerColonyId)) return;

    this.track?.('truce_signed', {
      colonyId: props.colonyId.trim(),
      partnerColonyId: props.partnerColonyId.trim(),
      durationHours: props.durationHours,
      ...(isNonEmpty(props.planetId) ? { planetId: props.planetId.trim() } : {}),
      ...(isNonEmpty(props.truceId) ? { truceId: props.truceId.trim() } : {}),
    });
  }

  truceBroken(props: TruceBrokenTrackProps): void {
    if (!props || !isNonEmpty(props.colonyId) || !isNonEmpty(props.byColonyId)) return;

    this.track?.('truce_broken', {
      colonyId: props.colonyId.trim(),
      byColonyId: props.byColonyId.trim(),
      ...(isNonEmpty(props.planetId) ? { planetId: props.planetId.trim() } : {}),
      ...(isNonEmpty(props.truceId) ? { truceId: props.truceId.trim() } : {}),
      ...(isNonEmpty(props.partnerColonyId) ? { partnerColonyId: props.partnerColonyId.trim() } : {}),
      ...(typeof props.oathbreakerHours === 'number' && Number.isFinite(props.oathbreakerHours)
        ? { oathbreakerHours: props.oathbreakerHours }
        : {}),
    });
  }

  handleSimEvent(ev: SimEventInput, ownColonyId: string, planetId?: string): boolean {
    if (!ev || !isNonEmpty(ev.kind) || !isNonEmpty(ownColonyId)) return false;
    if (!isColonyRelevant(ev.colonyIds, ownColonyId.trim(), ev.data)) return false;

    switch (ev.kind) {
      case 'raidStarted':
        return this.handleRaidStarted(ev.data, ownColonyId.trim(), planetId);
      case 'colonyEliminated':
        return this.handleColonyEliminated(ev.data, ownColonyId.trim(), planetId);
      case 'truceSigned':
        return this.handleTruceSigned(ev.data, ownColonyId.trim(), planetId);
      case 'truceNotice':
        return this.handleTruceBroken(ev.data, ownColonyId.trim(), planetId);
      case 'truceEnded':
        if (ev.data?.reason !== 'cancelled') return false;
        return this.handleTruceBroken(ev.data, ownColonyId.trim(), planetId);
      default:
        return false;
    }
  }

  private handleRaidStarted(
    data: Record<string, unknown> | undefined,
    ownColonyId: string,
    planetId?: string,
  ): boolean {
    if (!data) return false;
    const raidId = isNonEmpty(data.raidId) ? data.raidId.trim() : undefined;
    if (raidId && this.seenRaids.has(raidId)) return false;

    const rawTarget = data.targetColonyId ?? data.targetColony ?? data.colonyId;
    const targetColonyId = rawTarget !== undefined ? String(rawTarget).trim() : '';
    if (!targetColonyId) return false;

    const rawCount = data.count ?? data.unitCount ?? (Array.isArray(data.unitIds) ? data.unitIds.length : undefined);
    const unitCount = typeof rawCount === 'number' ? rawCount : (Array.isArray(data.unitIds) ? data.unitIds.length : 0);
    if (!Number.isFinite(unitCount) || unitCount < 0) return false;

    const rawAttacker = data.attackerColonyId ?? data.attackerColony;
    const attackerColonyId = rawAttacker !== undefined ? String(rawAttacker).trim() : undefined;
    const pid = isNonEmpty(data.planetId) ? data.planetId.trim() : (isNonEmpty(planetId) ? planetId.trim() : undefined);

    if (raidId) this.seenRaids.add(raidId);
    this.raidStarted({
      colonyId: ownColonyId,
      targetColonyId,
      unitCount,
      ...(pid ? { planetId: pid } : {}),
      ...(attackerColonyId ? { attackerColonyId } : {}),
    });
    return true;
  }

  private handleColonyEliminated(
    data: Record<string, unknown> | undefined,
    ownColonyId: string,
    planetId?: string,
  ): boolean {
    const colonyId = isNonEmpty(data?.colonyId) ? data.colonyId.trim() : ownColonyId;
    if (!colonyId) return false;
    if (this.seenEliminations.has(colonyId)) return false;

    const pid = isNonEmpty(data?.planetId) ? data.planetId.trim() : (isNonEmpty(planetId) ? planetId.trim() : undefined);
    const cause = mapEliminationCause(data?.cause);
    const rawKiller = data?.killerColonyId ?? data?.killerColony;
    const killerColonyId = rawKiller !== undefined ? String(rawKiller).trim() : undefined;

    this.seenEliminations.add(colonyId);
    this.colonyEliminated({
      colonyId,
      cause,
      ...(pid ? { planetId: pid } : {}),
      ...(killerColonyId ? { killerColonyId } : {}),
    });
    return true;
  }

  private handleTruceSigned(
    data: Record<string, unknown> | undefined,
    ownColonyId: string,
    planetId?: string,
  ): boolean {
    if (!data) return false;
    const truceId = isNonEmpty(data.truceId) ? data.truceId.trim() : undefined;
    if (truceId && this.seenSignedTruces.has(truceId)) return false;

    const partnerColonyId = resolvePartnerColonyId(data, ownColonyId);
    if (!partnerColonyId) return false;

    const pid = isNonEmpty(data.planetId) ? data.planetId.trim() : (isNonEmpty(planetId) ? planetId.trim() : undefined);
    const durationHours = parseDurationHours(data.durationHours ?? data.hours);

    if (truceId) this.seenSignedTruces.add(truceId);
    this.truceSigned({
      colonyId: ownColonyId,
      partnerColonyId,
      durationHours,
      ...(pid ? { planetId: pid } : {}),
      ...(truceId ? { truceId } : {}),
    });
    return true;
  }

  private handleTruceBroken(
    data: Record<string, unknown> | undefined,
    ownColonyId: string,
    planetId?: string,
  ): boolean {
    if (!data) return false;
    const truceId = isNonEmpty(data.truceId) ? data.truceId.trim() : undefined;
    if (truceId && this.seenBrokenTruces.has(truceId)) return false;

    const rawBy = data.cancelledByColonyId ?? data.cancelledBy ?? data.byColonyId;
    const byColonyId = rawBy !== undefined ? String(rawBy).trim() : ownColonyId;
    if (!byColonyId) return false;

    const partnerColonyId = resolvePartnerColonyId(data, byColonyId);
    const pid = isNonEmpty(data.planetId) ? data.planetId.trim() : (isNonEmpty(planetId) ? planetId.trim() : undefined);
    const oathHours = typeof data.oathbreakerHours === 'number' && Number.isFinite(data.oathbreakerHours)
      ? data.oathbreakerHours
      : undefined;

    if (truceId) this.seenBrokenTruces.add(truceId);
    this.truceBroken({
      colonyId: ownColonyId,
      byColonyId,
      ...(partnerColonyId ? { partnerColonyId } : {}),
      ...(pid ? { planetId: pid } : {}),
      ...(truceId ? { truceId } : {}),
      ...(oathHours !== undefined ? { oathbreakerHours: oathHours } : {}),
    });
    return true;
  }
}

export function createPvpTracker(track: TrackFn | undefined): PvpTracker {
  return new PvpTracker(track);
}
