import type { FeatureContext, GameView } from '../../core/registry/types';
import { viewColony } from '../shared/colony';
import { bindExclusivePointer, resolvePointerTile } from '../shared/pointer';

export interface QueueItemLike {
  taskId?: string;
  unit?: string;
  tier?: number;
  count?: number;
  remainingCount?: number;
  repeat?: boolean;
  producerId?: number;
  state?: string;
  waitReason?: string;
  waitDetail?: string;
  progress?: number;
  lane?: string;
  colonyIndex?: number;
  task?: {
    kind?: string;
    unit?: string;
    tier?: number;
    count?: number;
    repeat?: boolean;
    producerId?: number;
  };
}

export function entryUnit(entry: QueueItemLike): string {
  const unit = entry.unit ?? entry.task?.unit ?? 'worker';
  const tier = entry.tier ?? entry.task?.tier;
  const shown = tier === 2 || tier === 3 ? tier : 1;
  return unit === 'worker' ? `Worker Drone T${shown}` : unit;
}

export function entryCount(entry: QueueItemLike): number {
  return entry.remainingCount ?? entry.count ?? entry.task?.count ?? 1;
}

export function entryRepeat(entry: QueueItemLike): boolean {
  return Boolean(entry.repeat ?? entry.task?.repeat);
}

export function isArmyQueueItem(entry: QueueItemLike): boolean {
  const u = entryUnit(entry);
  return u === 'recon' || u === 'guard' || u === 'combatEngineer' || (entry.producerId ?? entry.task?.producerId) !== undefined;
}

export function formatBufferItem(entry: QueueItemLike): string {
  const unit = entryUnit(entry);
  const cnt = entryCount(entry);
  const repeatIcon = entryRepeat(entry) ? ' ↻' : '';
  let status = entry.state ?? 'queued';

  if (entry.state === 'in_progress') {
    const pct = Math.round((entry.progress ?? 0) * 100);
    status = `in_progress ${pct}%`;
  } else if (entry.state === 'waiting') {
    status = entry.waitDetail ?? (entry.waitReason ? `waiting(${entry.waitReason})` : 'waiting(supply)');
  }

  return `${unit} ×${cnt}${repeatIcon} · ${status}`;
}

export function createProgressBarElement(pct: number): HTMLElement {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const wrap = document.createElement('div');
  wrap.className = 'ta-units__progress';
  wrap.setAttribute('data-progress', '');
  const bar = document.createElement('div');
  bar.className = 'ta-units__progress-bar';
  bar.setAttribute('data-progress-bar', '');
  bar.setAttribute('data-progress-pct', String(clamped));
  bar.setAttribute('style', `width: ${clamped}%`);
  if ((bar as { style?: { width?: string } }).style) {
    bar.style.width = `${clamped}%`;
  }
  wrap.appendChild(bar);
  return wrap;
}

function extractBlobEntries(blob: unknown): QueueItemLike[] {
  if (!blob || typeof blob !== 'object') return [];
  const b = blob as { entries?: unknown; value?: { entries?: unknown } };
  if (Array.isArray(b.entries)) return b.entries as QueueItemLike[];
  if (b.value && Array.isArray(b.value.entries)) return b.value.entries as QueueItemLike[];
  return [];
}

export function resolveUnitQueueEntries(view: GameView | undefined, own: number): QueueItemLike[] {
  if (!view) return [];
  const col = viewColony(view, own) as { unitQueue?: QueueItemLike[]; queue?: QueueItemLike[] } | undefined;
  const v = view as {
    unitQueue?: QueueItemLike[];
    blobs?: {
      queue?: unknown;
      orderQueues?: unknown;
      roboticsProduction?: unknown;
      hubProduction?: unknown;
    };
  };

  const sources: QueueItemLike[][] = [];
  if (Array.isArray(col?.unitQueue)) sources.push(col.unitQueue);
  if (Array.isArray(col?.queue)) {
    sources.push(col.queue.filter((e) => e.lane === 'units' || e.task?.kind === 'buildUnit'));
  }
  if (Array.isArray(v.unitQueue)) sources.push(v.unitQueue);
  sources.push(
    extractBlobEntries(v.blobs?.queue).filter((e) => (e.colonyIndex ?? own) === own && (e.lane === 'units' || e.task?.kind === 'buildUnit')),
  );
  sources.push(
    extractBlobEntries(v.blobs?.orderQueues).filter((e) => (e.colonyIndex ?? own) === own && (e.lane === 'units' || e.task?.kind === 'buildUnit' || e.unit !== undefined)),
  );
  sources.push(extractBlobEntries(v.blobs?.roboticsProduction).filter((e) => (e.colonyIndex ?? own) === own));
  sources.push(extractBlobEntries(v.blobs?.hubProduction).filter((e) => (e.colonyIndex ?? own) === own));

  const out: QueueItemLike[] = [];
  const seenIds = new Set<string>();
  for (const list of sources) {
    for (const item of list) {
      if (!item || item.state === 'done' || item.state === 'cancelled') continue;
      if (item.taskId) {
        if (seenIds.has(item.taskId)) continue;
        seenIds.add(item.taskId);
      } else if (out.includes(item)) {
        continue;
      }
      out.push(item);
    }
  }
  return out;
}

export function resolveRallyPoint(view: GameView | undefined, own: number): { q: number; r: number } | null {
  if (!view) return null;
  const col = viewColony(view, own) as { rallyPoint?: { q?: number; r?: number } } | undefined;
  if (col?.rallyPoint && typeof col.rallyPoint.q === 'number' && typeof col.rallyPoint.r === 'number') {
    return { q: col.rallyPoint.q, r: col.rallyPoint.r };
  }
  const v = view as {
    rallyPoint?: { q?: number; r?: number };
    blobs?: {
      rallyPoints?: {
        byColony?: Record<number, { q: number; r: number }>;
        byEntityId?: Record<number, { q: number; r: number }>;
        value?: {
          byColony?: Record<number, { q: number; r: number }>;
          byEntityId?: Record<number, { q: number; r: number }>;
        };
      };
    };
  };
  if (v.rallyPoint && typeof v.rallyPoint.q === 'number' && typeof v.rallyPoint.r === 'number') {
    return { q: v.rallyPoint.q, r: v.rallyPoint.r };
  }
  const blob = v.blobs?.rallyPoints?.value ?? v.blobs?.rallyPoints;
  if (blob?.byColony?.[own]) return blob.byColony[own];
  const byEnt = blob?.byEntityId ? Object.values(blob.byEntityId)[0] : undefined;
  return byEnt ?? null;
}

export class ArmySectionController {
  readonly sectionEl: HTMLElement;
  readonly cardsEl: HTMLElement;
  readonly factorySectionEl: HTMLElement;
  readonly factoryQueueEl: HTMLElement;
  readonly rallyBtn: HTMLButtonElement;
  readonly rallyReadoutEl: HTMLElement;
  private rallyMode = false;
  private localRally: { q: number; r: number } | null = null;
  private lastFactoryKey: string | null = null;
  private readonly unbindSurface?: () => void;

  constructor(
    private readonly root: HTMLElement,
    cardsContainer: HTMLElement,
    body: HTMLElement,
    private readonly ctx: FeatureContext,
  ) {
    this.sectionEl = document.createElement('div');
    this.sectionEl.className = 'ta-units__army-section';
    this.sectionEl.setAttribute('data-section', 'army');

    const head = document.createElement('div');
    head.className = 'ta-units__section-header';
    head.setAttribute('data-army-header', '');

    const title = document.createElement('span');
    title.className = 'ta-units__section-title';
    title.textContent = 'Army';

    this.rallyReadoutEl = document.createElement('span');
    this.rallyReadoutEl.className = 'ta-units__rally-readout';
    this.rallyReadoutEl.setAttribute('data-rally-readout', '');
    this.rallyReadoutEl.textContent = 'Rally: default';

    this.rallyBtn = document.createElement('button');
    this.rallyBtn.type = 'button';
    this.rallyBtn.className = 'ta-units__rally-btn';
    this.rallyBtn.setAttribute('data-set-rally', '');
    this.rallyBtn.setAttribute('data-active', 'false');
    this.rallyBtn.textContent = 'SET RALLY';
    this.rallyBtn.onclick = () => this.setRallyMode(!this.rallyMode);

    head.append(title, this.rallyReadoutEl, this.rallyBtn);

    this.cardsEl = document.createElement('div');
    this.cardsEl.className = 'ta-units__army-cards';
    this.cardsEl.setAttribute('data-army-cards', '');

    this.sectionEl.append(head, this.cardsEl);
    cardsContainer.appendChild(this.sectionEl);

    this.factorySectionEl = document.createElement('div');
    this.factorySectionEl.className = 'ta-units__factory-section';
    this.factorySectionEl.setAttribute('data-factory-section', '');

    const facHead = document.createElement('div');
    facHead.className = 'ta-units__buffer-header';
    const facTitle = document.createElement('span');
    facTitle.className = 'ta-units__buffer-title';
    facTitle.textContent = 'Factory Queue';
    facHead.appendChild(facTitle);

    this.factoryQueueEl = document.createElement('div');
    this.factoryQueueEl.className = 'ta-units__factory-queue';
    this.factoryQueueEl.setAttribute('data-factory-queue', '');

    this.factorySectionEl.append(facHead, this.factoryQueueEl);
    body.appendChild(this.factorySectionEl);

    this.unbindSurface = this.bindCanvasSurface();
  }

  isRallyMode(): boolean {
    return this.rallyMode;
  }

  setRallyMode(active: boolean): void {
    this.rallyMode = active;
    this.rallyBtn.setAttribute('data-active', String(active));
    this.root.setAttribute('data-rally-mode', String(active));
  }

  setRally(q: number, r: number, producerId?: number): void {
    this.localRally = { q, r };
    this.setRallyMode(false);
    this.syncRallyReadout(this.localRally);
    const args = producerId !== undefined ? { q, r, producerId } : { q, r };
    this.ctx.services.sendCommand?.('setRally', args);
    const s = this.ctx.services as unknown as {
      onSetRally?: (opts: { q: number; r: number; producerId?: number }) => void;
    };
    s.onSetRally?.({ q, r, producerId });
  }

  private syncRallyReadout(pt: { q: number; r: number } | null): void {
    if (pt) {
      this.rallyReadoutEl.textContent = `Rally: (${pt.q}, ${pt.r})`;
      this.rallyReadoutEl.setAttribute('data-rally', `${pt.q},${pt.r}`);
      this.rallyBtn.setAttribute('data-rally', `${pt.q},${pt.r}`);
    } else {
      this.rallyReadoutEl.textContent = 'Rally: default';
    }
  }

  render(entries: readonly QueueItemLike[], view: GameView | undefined, own: number): void {
    const rally = resolveRallyPoint(view, own) ?? this.localRally;
    this.syncRallyReadout(rally);

    const armyEntries = entries.filter(isArmyQueueItem);
    const nextKey = armyEntries.map((en) => `${en.taskId ?? ''}:${formatBufferItem(en)}`).join('|');
    if (this.lastFactoryKey === nextKey) return;
    this.lastFactoryKey = nextKey;

    this.factoryQueueEl.replaceChildren();
    if (armyEntries.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'ta-units__buffer-empty';
      empty.textContent = 'Factory idle';
      this.factoryQueueEl.appendChild(empty);
      return;
    }

    for (const entry of armyEntries) {
      const pct = entry.state === 'in_progress' ? Math.round((entry.progress ?? 0) * 100) : 0;
      const itemEl = document.createElement('div');
      itemEl.className = 'ta-units__factory-item';
      itemEl.setAttribute('data-factory-item', entryUnit(entry));
      if (entry.taskId) itemEl.setAttribute('data-task-id', entry.taskId);
      itemEl.textContent = formatBufferItem(entry);
      itemEl.appendChild(createProgressBarElement(pct));
      this.factoryQueueEl.appendChild(itemEl);

      const cnt = entryCount(entry);
      if (armyEntries.length === 1 && cnt > 1) {
        for (let slot = 2; slot <= Math.min(5, cnt); slot++) {
          const slotEl = document.createElement('div');
          slotEl.className = 'ta-units__factory-item';
          slotEl.setAttribute('data-factory-item', entryUnit(entry));
          slotEl.setAttribute('data-slot', String(slot));
          slotEl.textContent = `${entryUnit(entry)} #${slot} · queued 0%`;
          slotEl.appendChild(createProgressBarElement(0));
          this.factoryQueueEl.appendChild(slotEl);
        }
      }
    }
  }

  private bindCanvasSurface(): (() => void) | undefined {
    const surface = (this.ctx.services.surface ?? this.ctx.services.canvas) as HTMLElement | undefined;
    if (!surface || typeof surface.addEventListener !== 'function') return undefined;
    return bindExclusivePointer(surface, () => this.rallyMode, {
      up: (e) => {
        if (e.button === 2) {
          this.setRallyMode(false);
          return;
        }
        if (e.button === 0 && this.rallyMode) {
          const coord = resolvePointerTile(e, this.ctx.services.pickTile);
          if (coord) this.setRally(coord.q, coord.r);
        }
      },
      context: () => this.setRallyMode(false),
    });
  }

  dispose(): void {
    this.unbindSurface?.();
  }
}
