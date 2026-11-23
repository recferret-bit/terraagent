import { ENTITY_KIND, ENTITY_STATE, type LandingPodState, type ViewEntity } from '@terra/sim';
import { forEachEntity } from '../../store/replica/viewCodec';

export interface PodDescentStatus {
  descending: boolean;
  hqLanded: boolean;
  progress: number;
  q: number;
  r: number;
  podEntityId: number | null;
  hqEntityId: number | null;
  ticksRemaining?: number;
  totalTicks?: number;
}

interface ScannedPodHq {
  podEntityId: number | null;
  podState: number;
  podProgress: number;
  podQ: number;
  podR: number;
  hqEntityId: number | null;
  hqQ: number;
  hqR: number;
}

function scanPodAndHqInEntities(
  ents: Float32Array | ViewEntity[] | undefined,
  count: number | undefined,
  colonyIndex: number,
  defQ: number,
  defR: number,
): ScannedPodHq {
  const res: ScannedPodHq = {
    podEntityId: null,
    podState: -1,
    podProgress: 0,
    podQ: defQ,
    podR: defR,
    hqEntityId: null,
    hqQ: defQ,
    hqR: defR,
  };
  forEachEntity(ents, count, (e) => {
    if (e.owner !== colonyIndex) return;
    if (e.kind === ENTITY_KIND.hq) {
      res.hqEntityId = e.id;
      res.hqQ = e.q;
      res.hqR = e.r;
    } else if (e.kind === ENTITY_KIND.pod) {
      res.podEntityId = e.id;
      res.podQ = e.q;
      res.podR = e.r;
      res.podState = e.state;
      res.podProgress = e.progress;
    }
  });
  return res;
}

/**
 * Inspects a `ClientView` or `SimView` to determine if the colony's drop pod is currently descending (`state === descending`
 * or `blobs.landingPods` undeployed) or if the HQ has already landed (`kind === ENTITY_KIND.hq` or pod deployed).
 */
export function extractPodDescentStatus(
  rawView: unknown,
  colonyIndex = 0,
  fallbackSpawn?: { q: number; r: number },
): PodDescentStatus {
  const defQ = fallbackSpawn?.q ?? 0;
  const defR = fallbackSpawn?.r ?? 0;
  if (!rawView || typeof rawView !== 'object') {
    return { descending: false, hqLanded: false, progress: 0, q: defQ, r: defR, podEntityId: null, hqEntityId: null };
  }
  const view = rawView as {
    entities?: Float32Array | ViewEntity[];
    count?: number;
    blobs?: Record<string, unknown>;
  };

  const { podEntityId, podState, podProgress, podQ, podR, hqEntityId, hqQ, hqR } = scanPodAndHqInEntities(
    view.entities,
    view.count,
    colonyIndex,
    defQ,
    defR,
  );

  const podsBlob = Array.isArray(view.blobs?.landingPods)
    ? (view.blobs.landingPods as LandingPodState[]).find((p) => p.colonyId === colonyIndex)
    : undefined;

  const q = hqEntityId !== null ? hqQ : podEntityId !== null ? podQ : (podsBlob?.q ?? defQ);
  const r = hqEntityId !== null ? hqR : podEntityId !== null ? podR : (podsBlob?.r ?? defR);

  if (
    hqEntityId !== null ||
    podsBlob?.deployed === true ||
    (podEntityId !== null && podState !== ENTITY_STATE.descending)
  ) {
    return {
      descending: false,
      hqLanded: true,
      progress: 1,
      q,
      r,
      podEntityId: podEntityId ?? podsBlob?.podEntityId ?? null,
      hqEntityId,
      ticksRemaining: 0,
      totalTicks: podsBlob?.totalTicks,
    };
  }

  if (
    (podEntityId !== null && podState === ENTITY_STATE.descending) ||
    (podsBlob !== undefined && !podsBlob.deployed && podsBlob.ticksRemaining > 0)
  ) {
    const progress =
      podEntityId !== null && Number.isFinite(podProgress) && podProgress > 0
        ? Math.min(1, Math.max(0, podProgress))
        : podsBlob && podsBlob.totalTicks > 0
          ? Math.min(1, Math.max(0, (podsBlob.totalTicks - podsBlob.ticksRemaining) / podsBlob.totalTicks))
          : 0;
    return {
      descending: true,
      hqLanded: false,
      progress,
      q,
      r,
      podEntityId: podEntityId ?? podsBlob?.podEntityId ?? null,
      hqEntityId: null,
      ticksRemaining: podsBlob?.ticksRemaining,
      totalTicks: podsBlob?.totalTicks,
    };
  }

  return { descending: false, hqLanded: false, progress: 1, q, r, podEntityId: null, hqEntityId: null };
}

interface RawLandingHistoryEntry {
  colony?: number;
  tick?: number;
}

function unwrapLandingHistory(blobs?: Record<string, unknown>): readonly RawLandingHistoryEntry[] | null {
  const raw = blobs?.landingHistory;
  if (Array.isArray(raw)) return raw as RawLandingHistoryEntry[];
  if (raw && typeof raw === 'object' && Array.isArray((raw as { value?: unknown }).value)) {
    return (raw as { value: RawLandingHistoryEntry[] }).value;
  }
  return null;
}

/**
 * Detects a freshly founded orbital colony whose `6.0s` (`30` ticks) server `podDescentS` timer already completed during
 * a slow HTTP/WebSocket handshake (`> 6s`), while still rejecting returning/developed colonies and HQ-only fixtures.
 */
export function isUnplayedFreshColonyLanding(
  rawView: unknown,
  colonyIndex: number,
  spawn: { readonly q: number; readonly r: number },
  firstObservedTick: number,
): boolean {
  if (!rawView || typeof rawView !== 'object') return false;
  const view = rawView as {
    entities?: Float32Array | ViewEntity[];
    count?: number;
    blobs?: Record<string, unknown>;
  };
  let hasPod = false;
  let podQ = spawn.q;
  let podR = spawn.r;
  let hasHq = false;
  let hqQ = 0;
  let hqR = 0;
  let hqState = ENTITY_STATE.idle as number;
  let ownStructuresOrExtraUnits = false;
  forEachEntity(view.entities, view.count, (e) => {
    if (e.owner !== colonyIndex) return;
    if (e.kind === ENTITY_KIND.pod) {
      hasPod = true;
      podQ = e.q;
      podR = e.r;
    } else if (e.kind === ENTITY_KIND.hq) {
      hasHq = true;
      hqQ = e.q;
      hqR = e.r;
      hqState = e.state;
    } else {
      ownStructuresOrExtraUnits = true;
    }
  });
  if (!hasPod || ownStructuresOrExtraUnits) return false;
  if (hasHq && (hqQ !== podQ || hqR !== podR || hqState !== ENTITY_STATE.idle)) {
    return false;
  }
  const history = unwrapLandingHistory(view.blobs);
  if (history) {
    const rec = [...history].reverse().find((r) => r.colony === colonyIndex && typeof r.tick === 'number');
    if (rec && typeof rec.tick === 'number' && firstObservedTick - rec.tick > 300) {
      return false;
    }
  }
  return true;
}
