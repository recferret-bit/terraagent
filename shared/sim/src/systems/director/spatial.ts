export interface ObservedRoute {
  id: string;
  sectorIds: string[];
}

export interface ProtectedArea {
  sectorId: string;
}

function listedOnRoute(sectorId: string, routes: ObservedRoute[]): boolean {
  return routes.some((route) => route.sectorIds.includes(sectorId));
}

function listedProtected(sectorId: string, protectedAreas: ProtectedArea[]): boolean {
  return protectedAreas.some((area) => area.sectorId === sectorId);
}

/** Flank, frontier and reclaim stay on an observed route. Reclaim also avoids protected sectors. */
export function spatialAllowed(
  action: {
    skill: 'defence' | 'scouting' | 'expansion' | 'terraforming';
    sectorId: string;
    variant: 'hold' | 'flank' | 'frontier' | 'reclaim';
  },
  routes: ObservedRoute[],
  protectedAreas: ProtectedArea[],
): { ok: true } | { ok: false; reason: 'unobserved' | 'protected' } {
  if (action.variant === 'hold') return { ok: true };
  if (!listedOnRoute(action.sectorId, routes)) return { ok: false, reason: 'unobserved' };
  if (action.variant === 'reclaim' && listedProtected(action.sectorId, protectedAreas)) {
    return { ok: false, reason: 'protected' };
  }
  return { ok: true };
}
