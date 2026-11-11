import {
  extractNeighborColonyMarkers,
  type NeighborColonyMarker,
} from '../shared/neighborMarkers';

export interface RaidTargetOption {
  readonly colonyIndex: number;
  readonly colonyId: string;
  readonly name: string;
  readonly colorToken: string;
  readonly q: number;
  readonly r: number;
  readonly disabled: boolean;
  readonly disabledReason: string | null;
  readonly shieldActive: boolean;
  readonly shieldRemainingSeconds: number;
  readonly shieldRemainingHours: number;
  readonly truceActive: boolean;
  readonly crossSectorDisabled: boolean;
}

export function formatShieldMmSs(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
  const rounded = Math.floor(seconds);
  const mm = Math.floor(rounded / 60);
  const ss = rounded % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function extractRaidTargets(
  rawView: unknown,
  ownColonyIndex = 0,
): RaidTargetOption[] {
  const markers: NeighborColonyMarker[] = extractNeighborColonyMarkers(rawView, ownColonyIndex);

  const root = (rawView && typeof rawView === 'object' ? rawView : {}) as Record<string, any>;
  const view = (root.sim?.view ?? root.view ?? root) as Record<string, any>;
  const rawCols = view.colonies ?? root.colonies ?? [];
  const coloniesList: Array<Record<string, any>> = Array.isArray(rawCols)
    ? rawCols.filter((c) => c && typeof c === 'object')
    : [];

  const colonyMap = new Map<number, Record<string, any>>();
  for (const c of coloniesList) {
    const idx = Number(c.index ?? c.colonyIndex);
    if (Number.isInteger(idx)) colonyMap.set(idx, c);
  }

  const options: RaidTargetOption[] = [];

  for (const marker of markers) {
    const col = colonyMap.get(marker.colonyIndex) ?? {};
    const shieldActive = Boolean(marker.shieldActive || col.shieldActive);
    const shieldRemainingSeconds =
      marker.shieldRemainingSeconds > 0
        ? marker.shieldRemainingSeconds
        : typeof col.shieldRemainingSeconds === 'number' && col.shieldRemainingSeconds > 0
          ? col.shieldRemainingSeconds
          : 0;
    const shieldRemainingHours = shieldActive ? Math.round(shieldRemainingSeconds / 3600) : 0;
    const truceActive = Boolean(marker.truceActive || col.truceActive);
    const crossSectorDisabled = Boolean(
      col.crossSectorDisabled ?? (marker as any).crossSectorDisabled ?? false,
    );

    let disabled: boolean;
    let disabledReason: string | null;

    if (shieldActive) {
      disabled = true;
      disabledReason = 'Protected ' + formatShieldMmSs(shieldRemainingSeconds);
    } else if (truceActive) {
      disabled = true;
      disabledReason = 'Truce active';
    } else if (crossSectorDisabled) {
      disabled = true;
      disabledReason = 'Cross-sector disabled';
    } else {
      disabled = false;
      disabledReason = null;
    }

    options.push({
      colonyIndex: marker.colonyIndex,
      colonyId: marker.colonyId,
      name: marker.name,
      colorToken: marker.colorToken,
      q: marker.q,
      r: marker.r,
      disabled,
      disabledReason,
      shieldActive,
      shieldRemainingSeconds,
      shieldRemainingHours,
      truceActive,
      crossSectorDisabled,
    });
  }

  return options;
}
