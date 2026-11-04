export type SectorLifecycle = 'open' | 'full' | 'paused' | 'faulted';
export type SectorRelation = 'home' | 'occupied' | 'neighbor' | 'goal';

export interface W11Sector {
  readonly sectorId: string;
  readonly relation: SectorRelation;
  readonly lifecycle: SectorLifecycle;
}

export interface W11ContextInput {
  readonly w11: boolean;
  readonly worldId: string;
  readonly colonyId: string;
  readonly planetId: string;
  readonly sectors?: readonly W11Sector[];
}

export interface W11ContextView {
  readonly w11: boolean;
  readonly worldId: string;
  readonly colonyId: string;
  readonly planetId: string;
  readonly sectors: readonly W11Sector[];
  /** A full founding sector does not block expansion (AI §5). */
  readonly expansionBlocked: false;
  readonly compatibility: 'w11' | 'bounded-dev';
}

/** Projects W11 identity. Off worlds stay explicit and do not invent planets. */
export function projectW11Context(input: W11ContextInput): W11ContextView {
  return {
    w11: input.w11,
    worldId: input.worldId,
    colonyId: input.colonyId,
    planetId: input.planetId,
    sectors: input.w11 ? [...(input.sectors ?? [])] : [],
    expansionBlocked: false,
    compatibility: input.w11 ? 'w11' : 'bounded-dev',
  };
}

/** Round-trip the canonical ids. Restart keeps the same view. */
export function restoreW11Context(raw: string): W11ContextView {
  const parsed = JSON.parse(raw) as W11ContextView;
  return projectW11Context({
    w11: parsed.w11,
    worldId: parsed.worldId,
    colonyId: parsed.colonyId,
    planetId: parsed.planetId,
    sectors: parsed.sectors,
  });
}
