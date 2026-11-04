import { TILE_M } from '@terra/render/planets/hex';
import { axialToPlane, hexDistance } from '@terra/sim/grid/hex';
import type { FeatureContext, GameView } from '../../core/registry/types';
import { ownColonyIndex } from '../shared/colony';
import { makeDiv, makeSpan } from '../shared/dom';
import {
  createThreatsMapLayer,
  type CombatAlertPing,
  type ScreenEdge,
} from './threatsLayer';

export const ALERT_PING_DURATION_MS = 5000;
export const OFF_SCREEN_TILE_RADIUS = 8;
const MAX_COMBAT_LOG_ENTRIES = 12;

export type CombatLogEventKind =
  | 'underAttack'
  | 'raidStarted'
  | 'raidRepelled'
  | 'buildingDestroyed'
  | 'unitDestroyed'
  | 'nestDestroyed';

const COMBAT_LOG_KINDS: ReadonlySet<string> = new Set<CombatLogEventKind>([
  'underAttack',
  'raidStarted',
  'raidRepelled',
  'buildingDestroyed',
  'unitDestroyed',
  'nestDestroyed',
]);

export interface CombatEventInput {
  readonly id?: string;
  readonly kind: string;
  readonly tick?: number;
  readonly data?: Record<string, unknown>;
  readonly q?: number;
  readonly r?: number;
  readonly colonyIndex?: number;
  readonly unbreached?: boolean;
}

export interface CombatLogEntry {
  readonly id: string;
  readonly kind: CombatLogEventKind;
  readonly label: string;
  readonly q?: number;
  readonly r?: number;
  readonly unbreached?: boolean;
  readonly tick?: number;
}

export interface PushUnderAttackPingOptions {
  readonly q: number;
  readonly r: number;
  readonly colonyIndex?: number;
  readonly attackerId?: number;
  readonly victimId?: number;
  readonly kind?: 'underAttack' | 'raidStarted';
  readonly nowMs?: number;
}

export function resolveScreenEdge(focusQ: number, focusR: number, targetQ: number, targetR: number): ScreenEdge | null {
  const dist = hexDistance(Math.round(focusQ), Math.round(focusR), Math.round(targetQ), Math.round(targetR));
  if (dist <= OFF_SCREEN_TILE_RADIUS) return null;
  const dq = targetQ - focusQ;
  const dr = targetR - focusR;
  const [dx, dy] = axialToPlane(dq, dr);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

function formatCombatLogLabel(kind: CombatLogEventKind, data: Record<string, unknown>): string {
  if (kind === 'underAttack') return 'Colony under attack';
  if (kind === 'raidStarted') {
    const species = typeof data.species === 'string' && data.species ? ` (${data.species})` : '';
    return `Raid incoming${species}`;
  }
  if (kind === 'raidRepelled') {
    return data.unbreached === true ? 'Raid repelled (Unbreached)' : 'Raid repelled';
  }
  if (kind === 'buildingDestroyed') {
    const bldg = typeof data.building === 'string' && data.building ? `: ${data.building}` : '';
    return `Building lost${bldg}`;
  }
  if (kind === 'unitDestroyed') {
    const unit = typeof data.unit === 'string' && data.unit ? `: ${data.unit}` : '';
    return `Unit destroyed${unit}`;
  }
  return 'Fauna nest destroyed';
}

export class CombatAlertsHud {
  readonly el: HTMLElement;
  readonly edgeContainerEl: HTMLElement;
  readonly logEl: HTMLElement;
  readonly logListEl: HTMLElement;

  private readonly pings: CombatAlertPing[] = [];
  private readonly logEntries: CombatLogEntry[] = [];
  private readonly seenEventKeys = new Set<string>();
  private readonly cleanups: Array<() => void> = [];
  private unregisterThreatsLayer: (() => void) | null = null;
  private registeredRegistry: unknown = null;
  private focusOverride: { q: number; r: number } | null = null;
  private seq = 0;
  private readonly now: () => number;

  constructor(
    parent: HTMLElement,
    private readonly ctx: FeatureContext,
    opts?: { now?: () => number },
  ) {
    this.now = opts?.now ?? (() => Date.now());
    this.el = makeDiv('ta-combat-hud', 'combat-hud');
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'Combat alerts and event log');

    this.edgeContainerEl = makeDiv('ta-combat-edge-pings', 'combat-edge-pings');
    this.edgeContainerEl.setAttribute('aria-live', 'assertive');

    this.logEl = makeDiv('ta-combat-log plate-sm', 'combat-log');
    this.logEl.setAttribute('data-combat-log', 'true');
    this.logEl.setAttribute('data-empty', 'true');
    this.logEl.setAttribute('aria-live', 'polite');

    const header = makeDiv('ta-combat-log__header');
    header.appendChild(makeSpan('ta-combat-log__title', undefined, 'COMBAT LOG'));
    this.logListEl = makeDiv('ta-combat-log__list', 'combat-log-list');
    this.logEl.append(header, this.logListEl);

    this.el.append(this.edgeContainerEl, this.logEl);
    parent.appendChild(this.el);

    this.syncThreatsLayerRegistration();
    this.bindEventSources();
  }

  private bindEventSources(): void {
    const store = this.ctx.services.store as {
      onServerEvents?: (fn: (events: ReadonlyArray<CombatEventInput>) => void) => () => void;
    } | undefined;
    if (store?.onServerEvents) {
      this.cleanups.push(
        store.onServerEvents((events) => {
          for (const ev of events) this.ingestEvent(ev, true);
        }),
      );
      return;
    }
    const transport = this.ctx.services.transport;
    if (transport?.onMessage) {
      this.cleanups.push(
        transport.onMessage((m) => {
          if (m.t === 'event') this.ingestEvent(m.d as unknown as CombatEventInput, true);
          else if (m.t === 'delta' && Array.isArray(m.d.events)) {
            for (const ev of m.d.events) this.ingestEvent(ev as unknown as CombatEventInput, true);
          }
        }),
      );
    }
  }

  private syncThreatsLayerRegistration(): void {
    const maps = this.ctx.services.maps;
    const registry = maps?.layerRegistry;
    if (!registry || registry === this.registeredRegistry) return;
    this.unregisterThreatsLayer?.();
    this.registeredRegistry = registry;
    const layer = createThreatsMapLayer(() => this.getActivePings());
    this.unregisterThreatsLayer = registry.register(layer);
    maps?.controller?.syncOverlayChips?.();
  }

  setFocusTile(q: number, r: number): void {
    this.focusOverride = { q, r };
    this.refreshEdgePings();
  }

  getCameraFocusTile(): { q: number; r: number } {
    if (this.focusOverride) return this.focusOverride;
    const rts = this.ctx.services.rtsCamera;
    if (rts?.target) {
      const px = rts.target.x / TILE_M;
      const py = rts.target.z / TILE_M;
      const r = (2 * py) / Math.sqrt(3);
      const q = px - r * 0.5;
      if (Number.isFinite(q) && Number.isFinite(r)) return { q, r };
    }
    const cam = this.ctx.services.camera;
    if (cam?.position && (cam.position.x !== 0 || cam.position.z !== 0) && !rts) {
      const px = cam.position.x / TILE_M;
      const py = cam.position.z / TILE_M;
      const r = (2 * py) / Math.sqrt(3);
      const q = px - r * 0.5;
      if (Number.isFinite(q) && Number.isFinite(r)) return { q, r };
    }
    return { q: 0, r: 0 };
  }

  getActivePings(nowMs = this.now()): readonly CombatAlertPing[] {
    this.pruneExpiredPings(nowMs);
    return this.pings;
  }

  getLogEntries(): readonly CombatLogEntry[] {
    return this.logEntries;
  }

  pushUnderAttackPing(opts: PushUnderAttackPingOptions): CombatAlertPing | null {
    const ownColony = ownColonyIndex(this.ctx.services);
    if (opts.colonyIndex !== undefined && opts.colonyIndex !== ownColony) return null;
    const nowMs = opts.nowMs ?? this.now();
    this.pruneExpiredPings(nowMs);
    const focus = this.getCameraFocusTile();
    const edge = resolveScreenEdge(focus.q, focus.r, opts.q, opts.r);
    const ping: CombatAlertPing = {
      id: `ping-${++this.seq}`,
      kind: opts.kind ?? 'underAttack',
      q: opts.q,
      r: opts.r,
      colonyIndex: opts.colonyIndex ?? ownColony,
      attackerId: opts.attackerId,
      victimId: opts.victimId,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + ALERT_PING_DURATION_MS,
      edge,
    };
    this.pings.push(ping);
    this.renderEdgePings();
    this.ctx.services.maps?.controller?.scheduler?.markDirty({ minimap: true, globalMap: true });
    return ping;
  }

  triggerEvent(ev: CombatEventInput): void {
    this.ingestEvent(ev, false);
  }

  private ingestEvent(ev: CombatEventInput, deduplicate: boolean): void {
    if (!ev || typeof ev.kind !== 'string' || !COMBAT_LOG_KINDS.has(ev.kind)) return;
    const data: Record<string, unknown> = { ...(ev.data ?? {}) };
    if (ev.q !== undefined && data.q === undefined) data.q = ev.q;
    if (ev.r !== undefined && data.r === undefined) data.r = ev.r;
    if (ev.colonyIndex !== undefined && data.colonyIndex === undefined) data.colonyIndex = ev.colonyIndex;
    if (ev.unbreached !== undefined && data.unbreached === undefined) data.unbreached = ev.unbreached;

    const ownColony = ownColonyIndex(this.ctx.services);
    const evColony = typeof data.colonyIndex === 'number' ? data.colonyIndex : undefined;
    if (evColony !== undefined && evColony !== ownColony) return;

    if (deduplicate) {
      const key =
        ev.id ??
        `${ev.tick ?? 0}:${ev.kind}:${String(data.q ?? '')}:${String(data.r ?? '')}:${String(data.entityId ?? '')}:${String(data.hiveId ?? '')}:${String(data.unbreached ?? '')}`;
      if (this.seenEventKeys.has(key)) return;
      this.seenEventKeys.add(key);
    }

    const q = typeof data.q === 'number' && Number.isFinite(data.q) ? data.q : undefined;
    const r = typeof data.r === 'number' && Number.isFinite(data.r) ? data.r : undefined;
    const kind = ev.kind as CombatLogEventKind;

    if ((kind === 'underAttack' || kind === 'raidStarted') && q !== undefined && r !== undefined) {
      this.pushUnderAttackPing({
        q,
        r,
        colonyIndex: evColony ?? ownColony,
        attackerId: typeof data.attackerId === 'number' ? data.attackerId : undefined,
        victimId: typeof data.entityId === 'number' ? data.entityId : undefined,
        kind,
      });
    }

    const entry: CombatLogEntry = {
      id: `log-${++this.seq}`,
      kind,
      label: formatCombatLogLabel(kind, data),
      q,
      r,
      unbreached: typeof data.unbreached === 'boolean' ? data.unbreached : undefined,
      tick: ev.tick,
    };
    this.logEntries.unshift(entry);
    if (this.logEntries.length > MAX_COMBAT_LOG_ENTRIES) {
      this.logEntries.length = MAX_COMBAT_LOG_ENTRIES;
    }
    this.renderLog();
  }

  update(view: GameView): void {
    this.syncThreatsLayerRegistration();
    const raw = view as {
      tick?: number;
      events?: ReadonlyArray<CombatEventInput>;
      sim?: { view?: { tick?: number; events?: ReadonlyArray<CombatEventInput> } };
    };
    const events = raw.events ?? raw.sim?.view?.events;
    const fallbackTick = raw.tick ?? raw.sim?.view?.tick;
    if (Array.isArray(events)) {
      for (const ev of events) {
        this.ingestEvent(ev.tick !== undefined ? ev : { ...ev, tick: fallbackTick }, true);
      }
    }
    this.refreshEdgePings();
  }

  private pruneExpiredPings(nowMs = this.now()): void {
    for (let i = this.pings.length - 1; i >= 0; i--) {
      if (this.pings[i]!.expiresAtMs <= nowMs) {
        this.pings.splice(i, 1);
      }
    }
  }

  private refreshEdgePings(): void {
    this.pruneExpiredPings();
    const focus = this.getCameraFocusTile();
    for (let i = 0; i < this.pings.length; i++) {
      const p = this.pings[i]!;
      const edge = resolveScreenEdge(focus.q, focus.r, p.q, p.r);
      if (edge !== p.edge) {
        this.pings[i] = { ...p, edge };
      }
    }
    this.renderEdgePings();
  }

  private jumpToTile(q: number, r: number): void {
    this.focusOverride = { q, r };
    this.ctx.services.focusTile?.(q, r, true);
    this.ctx.services.maps?.panToTile(q, r);
    this.refreshEdgePings();
  }

  private renderEdgePings(): void {
    this.edgeContainerEl.replaceChildren();
    for (const ping of this.pings) {
      if (!ping.edge) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ta-combat-edge-ping plate-sm';
      btn.setAttribute('data-under-attack-ping', 'true');
      btn.setAttribute('data-testid', 'under-attack-ping');
      btn.setAttribute('data-edge', ping.edge);
      btn.setAttribute('data-q', String(ping.q));
      btn.setAttribute('data-r', String(ping.r));
      const label = ping.kind === 'raidStarted' ? 'RAID INCOMING' : 'UNDER ATTACK';
      btn.textContent = `⚠ ${label} (${ping.q}, ${ping.r})`;
      btn.onclick = () => this.jumpToTile(ping.q, ping.r);
      this.edgeContainerEl.appendChild(btn);
    }
  }

  private renderLog(): void {
    this.logListEl.replaceChildren();
    this.logEl.setAttribute('data-empty', String(this.logEntries.length === 0));
    for (const item of this.logEntries) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'ta-combat-log__entry';
      row.setAttribute('data-combat-log-entry', 'true');
      row.setAttribute('data-event-kind', item.kind);
      if (item.unbreached !== undefined) {
        row.setAttribute('data-unbreached', String(item.unbreached));
      }
      if (item.q !== undefined && item.r !== undefined) {
        row.setAttribute('data-q', String(item.q));
        row.setAttribute('data-r', String(item.r));
        row.onclick = () => this.jumpToTile(item.q!, item.r!);
      }
      const fullText =
        item.q !== undefined && item.r !== undefined
          ? `${item.label} [${item.q}, ${item.r}]`
          : item.label;
      row.textContent = fullText;
      this.logListEl.appendChild(row);
    }
  }

  dispose(): void {
    for (const off of this.cleanups) off();
    this.cleanups.length = 0;
    this.unregisterThreatsLayer?.();
    this.unregisterThreatsLayer = null;
    this.registeredRegistry = null;
    this.pings.length = 0;
    this.logEntries.length = 0;
    this.el.remove();
  }
}
