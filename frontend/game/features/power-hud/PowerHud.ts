import { ENTITY_KIND, ENTITY_STATE } from '@terra/sim';
import type { Disposable, FeatureContext, GameView } from '../../core/registry/types';

const KIND_NAMES: Record<number, string> = {
  [ENTITY_KIND.metalsExtractor]: 'Metals Extractor',
  [ENTITY_KIND.solar]: 'Solar Array',
  [ENTITY_KIND.commandHub]: 'Command Hub',
  [ENTITY_KIND.hq]: 'Colony HQ',
  [ENTITY_KIND.dropPod]: 'Drop Pod',
  [ENTITY_KIND.harvester]: 'Harvester',
};

const BUILDING_KINDS: ReadonlySet<number> = new Set<number>([
  ENTITY_KIND.metalsExtractor,
  ENTITY_KIND.solar,
  ENTITY_KIND.commandHub,
  ENTITY_KIND.hq,
  ENTITY_KIND.dropPod,
]);

export interface EntitySummary {
  id: number;
  kind: number;
  hp: number;
  hpMax: number;
  state: number;
}

export function formatEntityState(state: number, explicitReason?: string): string {
  if (explicitReason) return explicitReason;
  switch (state) {
    case ENTITY_STATE.active: return 'online';
    case ENTITY_STATE.constructing: return 'constructing';
    case ENTITY_STATE.offlineBrownout: return 'offline: brownout';
    case ENTITY_STATE.offlineUnpowered: return 'offline: unpowered';
    case ENTITY_STATE.offlineCapped: return 'offline: capped';
    case ENTITY_STATE.idle: return 'idle';
    case ENTITY_STATE.working: return 'working';
    case ENTITY_STATE.harvesting: return 'harvesting';
    default: return 'online';
  }
}

export class PowerHud implements Disposable {
  readonly root: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly clockIcon: HTMLElement;
  private readonly clockText: HTMLElement;
  private readonly daylightText: HTMLElement;
  private readonly flowEl: HTMLElement;
  private readonly netEl: HTMLElement;
  private readonly brownoutBanner: HTMLElement;
  private readonly inspector: HTMLElement;
  private readonly inspectorTitle: HTMLElement;
  private readonly inspectorState: HTMLElement;
  private readonly inspectorHp: HTMLElement;
  private readonly inspectorReason: HTMLElement;
  selectedEntityId: number | null = null;

  constructor(
    private readonly parent: HTMLElement,
    _ctx?: FeatureContext,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'ta-power-hud';

    const bar = document.createElement('div');
    bar.className = 'ta-power-hud__bar plate-sm';

    this.clockEl = document.createElement('div');
    this.clockEl.className = 'ta-power-hud__clock';
    this.clockEl.setAttribute('data-phase', 'day');

    this.clockIcon = document.createElement('span');
    this.clockIcon.className = 'ta-power-hud__clock-icon';
    this.clockIcon.textContent = '☀';

    this.clockText = document.createElement('span');
    this.clockText.className = 'ta-power-hud__clock-text';
    this.clockText.textContent = '12:00';

    this.daylightText = document.createElement('span');
    this.daylightText.className = 'ta-power-hud__daylight';
    this.daylightText.textContent = '100%';

    this.clockEl.append(this.clockIcon, this.clockText, this.daylightText);

    const balance = document.createElement('div');
    balance.className = 'ta-power-hud__balance';

    this.flowEl = document.createElement('span');
    this.flowEl.className = 'ta-power-hud__flow';
    this.flowEl.textContent = '+0 / −0 E/s';

    this.netEl = document.createElement('span');
    this.netEl.className = 'ta-power-hud__net';
    this.netEl.textContent = '+0 E/s';

    balance.append(this.flowEl, this.netEl);
    bar.append(this.clockEl, balance);

    this.brownoutBanner = document.createElement('div');
    this.brownoutBanner.className = 'ta-power-hud__brownout plate-sm';
    this.brownoutBanner.setAttribute('data-brownout-banner', '');
    this.brownoutBanner.setAttribute('data-brownout', 'false');
    this.brownoutBanner.textContent = 'BROWNOUT — SHEDDING GROUP 3';

    this.inspector = document.createElement('div');
    this.inspector.className = 'ta-building-inspector plate-sm';
    this.inspector.style.display = 'none';

    const head = document.createElement('div');
    head.className = 'ta-building-inspector__head';

    this.inspectorTitle = document.createElement('span');
    this.inspectorTitle.className = 'ta-building-inspector__title';
    this.inspectorTitle.textContent = 'BUILDING';

    this.inspectorState = document.createElement('span');
    this.inspectorState.className = 'ta-building-inspector__state';
    this.inspectorState.textContent = 'ONLINE';
    head.append(this.inspectorTitle, this.inspectorState);

    const body = document.createElement('div');
    body.className = 'ta-building-inspector__body';

    this.inspectorHp = document.createElement('span');
    this.inspectorHp.className = 'ta-building-inspector__hp';
    this.inspectorHp.textContent = '0 / 0 HP';
    body.appendChild(this.inspectorHp);

    this.inspectorReason = document.createElement('div');
    this.inspectorReason.className = 'ta-building-inspector__reason';
    this.inspectorReason.style.display = 'none';

    this.inspector.append(head, body, this.inspectorReason);
    this.root.append(bar, this.brownoutBanner, this.inspector);
    this.parent.appendChild(this.root);
  }

  update(view: GameView): void {
    const v = (view ?? {}) as Record<string, unknown>;
    const colonies = Array.isArray(v.colonies) ? v.colonies : [];
    const col = (colonies[0] ?? v.colony ?? v) as Record<string, unknown>;
    const blobs = (v.blobs ?? {}) as Record<string, unknown>;
    const powerBlob = (blobs.power ?? {}) as Record<string, unknown>;
    const byColony = (powerBlob.byColony ?? {}) as Record<number, unknown>;
    const power = (col.power ?? byColony[0] ?? v.power) as Record<string, unknown> | undefined;
    const env = ((blobs.environment ?? power ?? {}) as Record<string, unknown>);

    this.updateClock(power, env);
    this.updatePowerReadout(power);
    this.updateBrownout(power);
    this.updateBuildingInspector(view, power);
  }

  private updateClock(power?: Record<string, unknown>, env?: Record<string, unknown>): void {
    const phase = (power?.phase ?? env?.phase ?? 'day') as 'day' | 'night';
    const clockText = String(power?.clockText ?? env?.clockText ?? '12:00');
    const daylight = typeof power?.daylight === 'number'
      ? power.daylight
      : typeof env?.daylight === 'number' ? env.daylight : (phase === 'night' ? 0 : 1);

    this.clockEl.setAttribute('data-phase', phase);
    this.clockIcon.textContent = phase === 'night' ? '☾' : '☀';
    this.clockText.textContent = clockText;
    this.daylightText.textContent = `${Math.round(daylight * 100)}%`;
  }

  private updatePowerReadout(power?: Record<string, unknown>): void {
    if (power && typeof power.supply === 'number') {
      const sup = Math.round(Number(power.supply));
      const dem = Math.round(Number(power.demand ?? 0));
      const net = Math.round(Number(power.net ?? (sup - dem)));
      this.flowEl.textContent = `+${sup} / −${dem} E/s`;
      this.netEl.textContent = `${net >= 0 ? '+' : ''}${net} E/s`;
      this.netEl.setAttribute('data-deficit', String(net < 0));
    } else {
      this.flowEl.textContent = '+0 / −0 E/s';
      this.netEl.textContent = '+0 E/s';
      this.netEl.setAttribute('data-deficit', 'false');
    }
  }

  private updateBrownout(power?: Record<string, unknown>): void {
    const isBrownout = Boolean(power?.brownout);
    this.brownoutBanner.setAttribute('data-brownout', String(isBrownout));
    const activeGroups = Array.isArray(power?.shedGroupsActive) && power.shedGroupsActive.length > 0
      ? (power.shedGroupsActive as number[]).join(', ')
      : '3';
    this.brownoutBanner.textContent = `BROWNOUT — SHEDDING GROUP ${activeGroups}`;
  }

  private updateBuildingInspector(view: GameView, power?: Record<string, unknown>): void {
    const targetId = this.selectedEntityId ?? (view as { selectedEntityId?: number }).selectedEntityId;
    const shedIds = (power?.shedEntityIds ?? []) as number[];
    const candidateId = targetId !== undefined && targetId !== null
      ? targetId
      : shedIds.length > 0 ? shedIds[0] : null;

    const entity = this.findTargetEntity((view as { entities?: unknown }).entities, candidateId);
    if (!entity) {
      this.inspector.style.display = 'none';
      return;
    }

    this.inspector.style.display = 'flex';
    const label = KIND_NAMES[entity.kind] ?? 'Building';
    this.inspectorTitle.textContent = label;
    this.inspectorHp.textContent = `${Math.round(entity.hp)} / ${Math.round(entity.hpMax)} HP`;

    const reasons = (power?.offlineReasons ?? {}) as Record<number, string>;
    const stateStr = formatEntityState(entity.state, reasons[entity.id]);
    this.inspectorState.textContent = stateStr.toUpperCase();
    this.inspector.setAttribute('data-state', stateStr);

    const isOffline = stateStr.startsWith('offline:') || stateStr === 'offline';
    this.inspector.setAttribute('data-offline', String(isOffline));
    this.inspectorState.setAttribute('data-offline', String(isOffline));

    if (isOffline) {
      this.inspectorReason.style.display = 'block';
      this.inspectorReason.textContent = reasons[entity.id] ?? stateStr;
    } else {
      this.inspectorReason.style.display = 'none';
    }
  }

  private findTargetEntity(entities: unknown, targetId: number | null): EntitySummary | null {
    if (!entities) return null;
    let fallbackBuilding: EntitySummary | null = null;

    if (entities instanceof Float32Array) {
      for (let i = 0; i < entities.length; i += 12) {
        const id = entities[i];
        const kind = entities[i + 1];
        const hp = entities[i + 8];
        const hpMax = entities[i + 9] || hp;
        const state = entities[i + 10];
        const summary: EntitySummary = { id, kind, hp, hpMax, state };
        if (targetId !== null && id === targetId) return summary;
        if (fallbackBuilding === null && BUILDING_KINDS.has(kind)) fallbackBuilding = summary;
      }
      return targetId === null ? fallbackBuilding : null;
    }

    if (Array.isArray(entities)) {
      for (const e of entities) {
        if (!e) continue;
        const id = Number(e.id ?? 0);
        const kind = Number(e.kind ?? 0);
        const hp = Number(e.hp ?? 0);
        const hpMax = Number(e.hpMax ?? hp);
        const state = Number(e.state ?? 0);
        const summary: EntitySummary = { id, kind, hp, hpMax, state };
        if (targetId !== null && id === targetId) return summary;
        if (fallbackBuilding === null && BUILDING_KINDS.has(kind)) fallbackBuilding = summary;
      }
      return targetId === null ? fallbackBuilding : null;
    }

    return null;
  }

  selectEntity(id: number | null): void {
    this.selectedEntityId = id;
  }

  dispose(): void {
    this.root.remove();
  }
}
