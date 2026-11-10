/**
 * Types and pure state transformations for Colony Status lifecycle HUD (W18-21).
 * Tracks Active, Critical (Hub lost, timer running), and Eliminated end states.
 */

export type ColonyLifecycleStatus = 'active' | 'critical' | 'eliminated';

export interface ColonyStatusView {
  colonyIndex: number;
  status: ColonyLifecycleStatus;
  hqDown: boolean;
  criticalDeadlineTick: number | null;
  criticalRemainingSeconds: number;
  eliminatedAtTick: number | null;
  eliminatedReason: string | null;
  eliminatedByColonyId: string | null;
  currentTick: number;
}

export interface ColonyStatusHudOptions {
  ownColonyIndex?: number;
  onPlaceHub?: () => void;
  onFoundNewColony?: () => void;
  navigate?: (url: string) => void;
}

/** Formats a duration in seconds as mm:ss (e.g. 600 -> '10:00', 59 -> '00:59', 0 -> '00:00'). */
export function formatCriticalCountdown(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '00:00';
  }
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/** Extracts ColonyStatusView from a raw view or PlanetState-like object. */
export function extractColonyStatusView(rawView: unknown, ownColonyIndex = 0): ColonyStatusView {
  const viewObj = rawView && typeof rawView === 'object' ? (rawView as Record<string, unknown>) : {};
  const currentTick =
    typeof viewObj.tick === 'number'
      ? viewObj.tick
      : typeof viewObj.currentTick === 'number'
        ? viewObj.currentTick
        : 0;

  const colony = resolveColonyRecord(viewObj, ownColonyIndex);
  const elimRecord = resolveEliminationRecord(viewObj, ownColonyIndex);

  const hqDown = Boolean(elimRecord?.hqDown ?? colony?.hqDown ?? false);

  const rawElimTick = elimRecord?.eliminatedAtTick ?? colony?.eliminatedAtTick;
  const eliminatedAtTick = typeof rawElimTick === 'number' ? rawElimTick : null;

  const rawReason = elimRecord?.eliminatedReason ?? elimRecord?.reason ?? colony?.eliminatedReason ?? colony?.reason;
  const eliminatedReason = typeof rawReason === 'string' ? rawReason : null;

  const rawKiller =
    elimRecord?.eliminatedByColonyId ??
    elimRecord?.killerColonyId ??
    elimRecord?.byColony ??
    colony?.eliminatedByColonyId ??
    colony?.killerColonyId;
  const eliminatedByColonyId = typeof rawKiller === 'string' ? rawKiller : null;

  const rawDeadline = elimRecord?.criticalDeadlineTick ?? colony?.criticalDeadlineTick;
  const criticalDeadlineTick = typeof rawDeadline === 'number' ? rawDeadline : null;

  const rawStatus = (colony?.status ?? elimRecord?.status) as string | undefined;

  let status: ColonyLifecycleStatus = 'active';
  if (rawStatus === 'eliminated' || eliminatedAtTick !== null) {
    status = 'eliminated';
  } else if (
    rawStatus === 'critical' ||
    (criticalDeadlineTick !== null && criticalDeadlineTick > currentTick) ||
    (typeof colony?.remainingSeconds === 'number' && (colony.remainingSeconds as number) > 0)
  ) {
    status = 'critical';
  }

  let criticalRemainingSeconds = 0;
  if (status === 'critical') {
    if (typeof colony?.remainingSeconds === 'number' && Number.isFinite(colony.remainingSeconds)) {
      criticalRemainingSeconds = Math.max(0, Math.floor(colony.remainingSeconds as number));
    } else if (criticalDeadlineTick !== null) {
      criticalRemainingSeconds = Math.max(0, Math.ceil((criticalDeadlineTick - currentTick) / 5));
    } else {
      criticalRemainingSeconds = 600;
    }
  }

  return {
    colonyIndex: ownColonyIndex,
    status,
    hqDown,
    criticalDeadlineTick,
    criticalRemainingSeconds,
    eliminatedAtTick,
    eliminatedReason: eliminatedReason ?? (status === 'eliminated' ? 'Hub lost — critical timer expired' : null),
    eliminatedByColonyId,
    currentTick,
  };
}

function resolveColonyRecord(viewObj: Record<string, unknown>, ownColonyIndex: number): Record<string, unknown> | undefined {
  const coloniesRaw = viewObj.colonies;
  if (Array.isArray(coloniesRaw)) {
    const found = coloniesRaw.find(
      (c) => c && typeof c === 'object' && (c.index === ownColonyIndex || c.colonyIndex === ownColonyIndex),
    );
    if (found) return found as Record<string, unknown>;
    const atPos = coloniesRaw[ownColonyIndex];
    if (atPos && typeof atPos === 'object') return atPos as Record<string, unknown>;
  } else if (coloniesRaw && typeof coloniesRaw === 'object') {
    const byKey =
      (coloniesRaw as Record<string, unknown>)[ownColonyIndex] ??
      (coloniesRaw as Record<string, unknown>)[String(ownColonyIndex)];
    if (byKey && typeof byKey === 'object') return byKey as Record<string, unknown>;
  }
  if (viewObj.status !== undefined || viewObj.colonyIndex !== undefined) {
    return viewObj;
  }
  return undefined;
}

function resolveEliminationRecord(
  viewObj: Record<string, unknown>,
  ownColonyIndex: number,
): Record<string, unknown> | undefined {
  const blobs = viewObj.blobs && typeof viewObj.blobs === 'object' ? (viewObj.blobs as Record<string, unknown>) : undefined;
  const elimBlob = (blobs?.elimination ?? viewObj.elimination) as Record<string, unknown> | undefined;
  const elimValue =
    elimBlob?.value && typeof elimBlob.value === 'object' ? (elimBlob.value as Record<string, unknown>) : elimBlob;
  const byColony =
    elimValue?.byColony && typeof elimValue.byColony === 'object'
      ? (elimValue.byColony as Record<string, unknown>)
      : undefined;
  return (byColony?.[ownColonyIndex] ?? byColony?.[String(ownColonyIndex)]) as Record<string, unknown> | undefined;
}

/** Pure state reducer applying a sim event to ColonyStatusView. */
export function applyColonyStatusSimEvent(state: ColonyStatusView, event: unknown): ColonyStatusView {
  if (!event || typeof event !== 'object') return state;
  const ev = event as Record<string, unknown>;
  const kind = (ev.kind ?? ev.type) as string | undefined;
  const data = (ev.data && typeof ev.data === 'object' ? ev.data : ev) as Record<string, unknown>;

  const evColonyIndex = data.colonyIndex ?? ev.colonyIndex;
  if (typeof evColonyIndex === 'number' && evColonyIndex !== state.colonyIndex) {
    return state;
  }

  if (kind === 'colonyCritical') {
    const atTick = typeof data.atTick === 'number' ? data.atTick : state.currentTick;
    const timerS = typeof data.timerS === 'number' ? data.timerS : (typeof data.remainingSeconds === 'number' ? data.remainingSeconds : 600);
    const deadline = typeof data.deadlineTick === 'number' ? data.deadlineTick : atTick + timerS * 5;
    const remainingSeconds = Math.max(0, Math.ceil((deadline - atTick) / 5));
    return {
      ...state,
      status: 'critical',
      currentTick: atTick,
      criticalDeadlineTick: deadline,
      criticalRemainingSeconds: remainingSeconds,
      hqDown: true,
    };
  }

  if (kind === 'colonyEliminated') {
    const atTick = typeof data.atTick === 'number' ? data.atTick : state.currentTick;
    const reason = typeof data.reason === 'string' ? data.reason : (typeof data.cause === 'string' ? data.cause : 'colony_eliminated');
    const killer =
      typeof data.byColony === 'string'
        ? data.byColony
        : typeof data.killerColonyId === 'string'
          ? data.killerColonyId
          : typeof data.eliminatedByColonyId === 'string'
            ? data.eliminatedByColonyId
            : null;
    return {
      ...state,
      status: 'eliminated',
      currentTick: atTick,
      criticalRemainingSeconds: 0,
      eliminatedAtTick: atTick,
      eliminatedReason: reason,
      eliminatedByColonyId: killer,
    };
  }

  if (
    kind === 'colonyActive' ||
    kind === 'hubRebuilt' ||
    (kind === 'buildingCompleted' && (data.buildingKind === 'commandHub' || data.kind === 'commandHub' || data.building === 'commandHub'))
  ) {
    if (state.status !== 'eliminated') {
      return {
        ...state,
        status: 'active',
        criticalDeadlineTick: null,
        criticalRemainingSeconds: 0,
        hqDown: false,
      };
    }
  }

  return state;
}
