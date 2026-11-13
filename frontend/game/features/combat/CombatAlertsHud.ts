import type { FeatureContext, GameView } from '../../core/registry/types';
import { pushNotification } from '../notifications/notificationStore';
import { ownColonyIndex } from '../shared/colony';
import {
  ALERT_PING_DURATION_MS,
  buildCombatHudDom,
  COMBAT_LOG_KINDS,
  computeCameraFocusTile,
  formatCombatLogLabel,
  MAX_COMBAT_LOG_ENTRIES,
  normalizeCombatEventData,
  OFF_SCREEN_TILE_RADIUS,
  renderCombatLogRows,
  renderEdgePingButtons,
  resolveScreenEdge,
} from './parts/combatHudParts';
import {
  createThreatsMapLayer,
  type CombatAlertPing,
  type ScreenEdge,
} from './threatsLayer';

export { ALERT_PING_DURATION_MS, OFF_SCREEN_TILE_RADIUS, resolveScreenEdge, type ScreenEdge };

export type CombatLogEventKind =
  | 'underAttack'
  | 'raidStarted'
  | 'raidRepelled'
  | 'buildingDestroyed'
  | 'unitDestroyed'
  | 'nestDestroyed';

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

export class CombatAlertsHud {
  readonly el: HTMLElement;
  readonly edgeContainerEl: HTMLElement;
  readonly logEl: HTMLElement;
  readonly logListEl: HTMLElement;
  /** Muted "no threats" line; shown only inside the Colony book's Combat tab while the log is empty (combat.css). */
  readonly emptyEl: HTMLElement;

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
    const dom = buildCombatHudDom(parent, ctx);
    this.el = dom.el;
    this.edgeContainerEl = dom.edgeContainerEl;
    this.logEl = dom.logEl;
    this.logListEl = dom.logListEl;
    this.emptyEl = dom.emptyEl;

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
    return computeCameraFocusTile(this.focusOverride, this.ctx);
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
    const data = normalizeCombatEventData(ev);

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
    pushNotification({
      category: 'combat',
      title: 'Combat Alert',
      message: entry.label,
      onSelect: () => {
        if (q !== undefined && r !== undefined) this.jumpToTile(q, r);
      },
    });
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

  /** Live alert count on the Combat tab spine (every active ping, on- or off-screen); cleared when none. */
  private syncTabBadge(): void {
    this.ctx.services?.setHudTabBadge?.(this.el, this.pings.length > 0 ? this.pings.length : null);
  }

  private renderEdgePings(): void {
    this.syncTabBadge();
    renderEdgePingButtons(this.edgeContainerEl, this.pings, (q, r) => this.jumpToTile(q, r));
  }

  private renderLog(): void {
    renderCombatLogRows(this.logEl, this.emptyEl, this.logListEl, this.logEntries, (q, r) => this.jumpToTile(q, r));
  }

  dispose(): void {
    for (const off of this.cleanups) off();
    this.cleanups.length = 0;
    this.unregisterThreatsLayer?.();
    this.unregisterThreatsLayer = null;
    this.registeredRegistry = null;
    this.pings.length = 0;
    this.logEntries.length = 0;
    this.syncTabBadge();
    this.edgeContainerEl.remove();
    this.el.remove();
  }
}
