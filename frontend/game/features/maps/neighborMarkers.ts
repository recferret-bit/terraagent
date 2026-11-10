export interface NeighborColonyMarker {
  colonyIndex: number;
  colonyId: string;
  name: string;
  colorToken: string;
  q: number;
  r: number;
  discovered: boolean;
  shieldActive: boolean;
  shieldRemainingSeconds: number;
  truceActive: boolean;
  truceRemainingSeconds: number;
  oathbreaker: boolean;
  eliminated: boolean;
}

export const TICKS_PER_SECOND = 5;

export const COLONY_COLOR_TOKENS: readonly string[] = [
  'var(--ta-orange)',
  'var(--ta-blue)',
  'var(--ta-amber)',
  'var(--ta-green)',
  'var(--ta-cyan)',
];

export function getColonyColorToken(colonyIndex: number): string {
  const norm = Math.abs(colonyIndex) % COLONY_COLOR_TOKENS.length;
  return COLONY_COLOR_TOKENS[norm]!;
}

export function formatCountdownSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
  const rounded = Math.floor(seconds);
  if (rounded < 3600) {
    const mm = Math.floor(rounded / 60);
    const ss = rounded % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  const hh = Math.floor(rounded / 3600);
  const rem = rounded % 3600;
  const mm = Math.floor(rem / 60);
  const ss = rem % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

interface ResolvedViewContext {
  view: Record<string, any>;
  currentTick: number;
  ownColony: Record<string, any> | null;
  coloniesList: Array<Record<string, any>>;
}

function resolveViewContext(rawView: unknown, ownColonyIndex: number): ResolvedViewContext {
  const root = (rawView && typeof rawView === 'object' ? rawView : {}) as Record<string, any>;
  const view = (root.sim?.view ?? root.view ?? root) as Record<string, any>;
  const tickRaw = view.tick ?? view.meta?.tick ?? root.tick ?? root.meta?.tick ?? 0;
  const currentTick = typeof tickRaw === 'number' && Number.isFinite(tickRaw) ? tickRaw : 0;

  const rawCols = view.colonies ?? root.colonies ?? [];
  const coloniesList: Array<Record<string, any>> = Array.isArray(rawCols)
    ? rawCols.filter((c) => c && typeof c === 'object')
    : [];

  const ownColony =
    coloniesList.find((c) => Number(c.index ?? c.colonyIndex) === ownColonyIndex) ??
    (view.colony && typeof view.colony === 'object' ? view.colony : null);

  return { view, currentTick, ownColony, coloniesList };
}

function collectDiscoveredIndices(
  ctx: ResolvedViewContext,
  ownColonyIndex: number,
): Set<number> {
  const discovered = new Set<number>();
  const { view, ownColony, coloniesList } = ctx;

  const dipBlob = (view.blobs?.diplomacy?.value ?? view.blobs?.diplomacy ?? {}) as Record<string, any>;
  if (Array.isArray(dipBlob.contacts)) {
    for (const c of dipBlob.contacts) if (Number.isInteger(Number(c))) discovered.add(Number(c));
  }
  const byCol = dipBlob.contactsByColony;
  if (byCol && typeof byCol === 'object') {
    const list = byCol[ownColonyIndex] ?? byCol[String(ownColonyIndex)];
    if (Array.isArray(list)) {
      for (const c of list) if (Number.isInteger(Number(c))) discovered.add(Number(c));
    }
  }

  const ownContacts = ownColony?.diplomacy?.contacts ?? ownColony?.contacts;
  if (Array.isArray(ownContacts)) {
    for (const c of ownContacts) if (Number.isInteger(Number(c))) discovered.add(Number(c));
  }
  const ownDiscoveredCols = ownColony?.discoveredColonies;
  if (Array.isArray(ownDiscoveredCols)) {
    for (const c of ownDiscoveredCols) if (Number.isInteger(Number(c))) discovered.add(Number(c));
  }

  for (const col of coloniesList) {
    const idx = Number(col.index ?? col.colonyIndex);
    if (col.discovered === true) discovered.add(idx);
  }

  const entities = view.entities;
  if (Array.isArray(entities)) {
    for (const e of entities) {
      if (!e || typeof e !== 'object') continue;
      const cIdx = e.colony ?? e.owner ?? e.colonyIndex;
      if (typeof cIdx === 'number' && Number.isInteger(cIdx) && cIdx >= 0 && cIdx !== ownColonyIndex) {
        discovered.add(cIdx);
      }
    }
  } else if (entities && typeof entities === 'object') {
    const colArr = entities.colony ?? entities.owner;
    if (Array.isArray(colArr) || ArrayBuffer.isView(colArr)) {
      for (let i = 0; i < (entities.count ?? (colArr as any).length); i++) {
        const cIdx = (colArr as any)[i];
        if (typeof cIdx === 'number' && Number.isInteger(cIdx) && cIdx >= 0 && cIdx !== ownColonyIndex) {
          discovered.add(cIdx);
        }
      }
    }
  }

  return discovered;
}

function findColonyCoords(col: Record<string, any>, colIdx: number, view: Record<string, any>): { q: number; r: number } {
  if (typeof col.q === 'number' && typeof col.r === 'number') return { q: col.q, r: col.r };
  if (typeof col.hub?.q === 'number' && typeof col.hub?.r === 'number') return { q: col.hub.q, r: col.hub.r };
  if (typeof col.hq?.q === 'number' && typeof col.hq?.r === 'number') return { q: col.hq.q, r: col.hq.r };
  if (typeof col.position?.q === 'number' && typeof col.position?.r === 'number') {
    return { q: col.position.q, r: col.position.r };
  }

  const hqBlob = (view.blobs?.hq?.value ?? view.blobs?.hq ?? {}) as Record<string, any>;
  const hqByCol = hqBlob.byColony?.[colIdx] ?? hqBlob.byColony?.[String(colIdx)];
  if (hqByCol && typeof hqByCol.q === 'number' && typeof hqByCol.r === 'number') {
    return { q: hqByCol.q, r: hqByCol.r };
  }

  const entities = view.entities;
  if (Array.isArray(entities)) {
    let fallback: { q: number; r: number } | null = null;
    for (const e of entities) {
      if (!e || typeof e !== 'object') continue;
      const cIdx = e.colony ?? e.owner ?? e.colonyIndex;
      if (cIdx === colIdx && typeof e.q === 'number' && typeof e.r === 'number') {
        const isHub = e.kind === 'hub' || e.kind === 'hq' || e.archetype === 'hub' || e.archetype === 'hq';
        if (isHub) return { q: e.q, r: e.r };
        if (!fallback) fallback = { q: e.q, r: e.r };
      }
    }
    if (fallback) return fallback;
  }

  return { q: 0, r: 0 };
}

function resolveShieldState(
  col: Record<string, any>,
  colIdx: number,
  view: Record<string, any>,
  currentTick: number,
): { shieldActive: boolean; shieldRemainingSeconds: number } {
  const pvpBlob = (view.blobs?.pvp?.value ?? view.blobs?.pvp ?? {}) as Record<string, any>;
  const fromBlob =
    pvpBlob.raidProtectedUntilByColony?.[colIdx] ??
    pvpBlob.raidProtectedUntilByColony?.[String(colIdx)] ??
    pvpBlob[colIdx]?.raidProtectedUntil ??
    pvpBlob[String(colIdx)]?.raidProtectedUntil;

  const rawShield =
    col.raidProtectedUntil ??
    col.shieldUntil ??
    col.pvp?.raidProtectedUntil ??
    fromBlob;

  const shieldUntil = typeof rawShield === 'number' && Number.isFinite(rawShield) ? rawShield : 0;
  const shieldActive = shieldUntil > currentTick;
  const shieldRemainingSeconds = shieldActive
    ? Math.ceil((shieldUntil - currentTick) / TICKS_PER_SECOND)
    : 0;

  return { shieldActive, shieldRemainingSeconds };
}

function collectAllTruces(
  view: Record<string, any>,
  col: Record<string, any>,
  ownColony: Record<string, any> | null,
): Array<Record<string, any>> {
  const list: Array<Record<string, any>> = [];
  const addItems = (source: unknown) => {
    if (!source) return;
    if (Array.isArray(source)) {
      for (const t of source) if (t && typeof t === 'object') list.push(t);
    } else if (typeof source === 'object') {
      for (const t of Object.values(source)) if (t && typeof t === 'object') list.push(t as any);
    }
  };

  const dipBlob = (view.blobs?.diplomacy?.value ?? view.blobs?.diplomacy ?? {}) as Record<string, any>;
  addItems(dipBlob.truces);
  addItems(ownColony?.diplomacy?.truces);
  addItems(ownColony?.truces);
  addItems(col.diplomacy?.truces);
  addItems(col.truces);

  return list;
}

function resolveTruceState(
  col: Record<string, any>,
  colIdx: number,
  ownColonyIndex: number,
  ctx: ResolvedViewContext,
): { truceActive: boolean; truceRemainingSeconds: number } {
  const truces = collectAllTruces(ctx.view, col, ctx.ownColony);
  const ownColId = ctx.ownColony?.id ? String(ctx.ownColony.id) : `col_${ownColonyIndex}`;
  const targetColId = col.id ? String(col.id) : `col_${colIdx}`;

  let truceActive = false;
  let truceRemainingSeconds = 0;

  for (const t of truces) {
    const colA = Number(t.colonyA ?? t.colonyAIndex ?? -1);
    const colB = Number(t.colonyB ?? t.colonyBIndex ?? -1);
    const colAId = t.colonyAId ? String(t.colonyAId) : '';
    const colBId = t.colonyBId ? String(t.colonyBId) : '';
    const partner = Number(t.partnerColony ?? -1);

    const matches =
      (colA === ownColonyIndex && colB === colIdx) ||
      (colB === ownColonyIndex && colA === colIdx) ||
      (partner === colIdx && (colA === ownColonyIndex || colB === ownColonyIndex)) ||
      (colAId === ownColId && colBId === targetColId) ||
      (colBId === ownColId && colAId === targetColId);

    if (!matches) continue;

    const status = String(t.status || 'active');
    const isLive = status === 'active' || status === 'notice';
    if (!isLive) continue;

    const targetTick =
      status === 'notice' && typeof t.noticeEndsAtTick === 'number'
        ? t.noticeEndsAtTick
        : Number(t.expiresAtTick ?? 0);

    if (targetTick === 0 || targetTick > ctx.currentTick) {
      truceActive = true;
      const rem = targetTick > ctx.currentTick
        ? Math.ceil((targetTick - ctx.currentTick) / TICKS_PER_SECOND)
        : 0;
      if (rem > truceRemainingSeconds) truceRemainingSeconds = rem;
    }
  }

  return { truceActive, truceRemainingSeconds };
}

function resolveOathbreaker(
  col: Record<string, any>,
  colIdx: number,
  view: Record<string, any>,
  currentTick: number,
): boolean {
  const dipBlob = (view.blobs?.diplomacy?.value ?? view.blobs?.diplomacy ?? {}) as Record<string, any>;
  const fromBlob =
    dipBlob.oathbreakerUntilByColony?.[colIdx] ??
    dipBlob.oathbreakerUntilByColony?.[String(colIdx)];

  const rawOath = col.oathbreakerUntil ?? col.diplomacy?.oathbreakerUntil ?? fromBlob;
  const oathUntil = typeof rawOath === 'number' && Number.isFinite(rawOath) ? rawOath : 0;
  return oathUntil > currentTick || Boolean(col.oathbreaker);
}

export function extractNeighborColonyMarkers(
  rawView: unknown,
  ownColonyIndex = 0,
): NeighborColonyMarker[] {
  const ctx = resolveViewContext(rawView, ownColonyIndex);
  const discoveredIndices = collectDiscoveredIndices(ctx, ownColonyIndex);
  const markers: NeighborColonyMarker[] = [];

  const coloniesByIndex = new Map<number, Record<string, any>>();
  for (const c of ctx.coloniesList) {
    const idx = Number(c.index ?? c.colonyIndex);
    if (Number.isInteger(idx)) coloniesByIndex.set(idx, c);
  }

  for (const idx of discoveredIndices) {
    if (!coloniesByIndex.has(idx) && idx !== ownColonyIndex) {
      coloniesByIndex.set(idx, {
        index: idx,
        id: `col_${idx}`,
        name: `Colony ${idx + 1}`,
        status: 'active',
        discovered: true,
      });
    }
  }

  for (const [colIdx, col] of coloniesByIndex.entries()) {
    if (colIdx === ownColonyIndex) continue;

    const status = String(col.status || 'active');
    const eliminated = status === 'eliminated' || Boolean(col.eliminated);
    if (eliminated) continue;

    const isDiscovered = discoveredIndices.has(colIdx) || col.discovered === true;
    if (!isDiscovered) continue;

    const colonyId = String(col.id ?? `col_${colIdx}`);
    const name = String(col.name ?? `Colony ${colIdx + 1}`);
    const colorToken = getColonyColorToken(colIdx);
    const { q, r } = findColonyCoords(col, colIdx, ctx.view);
    const { shieldActive, shieldRemainingSeconds } = resolveShieldState(col, colIdx, ctx.view, ctx.currentTick);
    const { truceActive, truceRemainingSeconds } = resolveTruceState(col, colIdx, ownColonyIndex, ctx);
    const oathbreaker = resolveOathbreaker(col, colIdx, ctx.view, ctx.currentTick);

    markers.push({
      colonyIndex: colIdx,
      colonyId,
      name,
      colorToken,
      q,
      r,
      discovered: true,
      shieldActive,
      shieldRemainingSeconds,
      truceActive,
      truceRemainingSeconds,
      oathbreaker,
      eliminated: false,
    });
  }

  markers.sort((a, b) => a.colonyIndex - b.colonyIndex);
  return markers;
}
