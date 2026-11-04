import { ENTITY_KIND, ENTITY_STATE } from '@terra/sim';
import type { Disposable, FeatureContext, GameView } from '../../core/registry/types';
import { forEachEntity } from '../../store/replica/viewCodec';
import { ownColonyIndex } from '../shared/colony';
import { gridBalance, readColonyPower, readEntityPower, readPylonLoad } from '../shared/power';

const KIND_NAMES: Record<number, string> = {
  [ENTITY_KIND.metalsExtractor]: 'Resource Extractor',
  [ENTITY_KIND.solar]: 'Solar Array',
  [ENTITY_KIND.commandHub]: 'Command Hub',
  [ENTITY_KIND.tradeHub]: 'Inter-Colony Trade Hub',
  [ENTITY_KIND.hq]: 'Colony HQ',
  [ENTITY_KIND.dropPod]: 'Drop Pod',
  [ENTITY_KIND.harvester]: 'Harvester',
  [ENTITY_KIND.builder]: 'Builder Drone',
  [ENTITY_KIND.pylon]: 'Power Pylon',
  [ENTITY_KIND.capacitor]: 'Capacitor Bank',
  [ENTITY_KIND.wind]: 'Wind Turbine',
  [ENTITY_KIND.thermal]: 'Thermal Plant',
  [ENTITY_KIND.supplyDepot]: 'Supply Depot',
  [ENTITY_KIND.mineralsQuarry]: 'Minerals Quarry',
  [ENTITY_KIND.waterExtractor]: 'Water Extractor',
  [ENTITY_KIND.petroleumWell]: 'Petroleum Well',
};

const BUILDING_KINDS: ReadonlySet<number> = new Set<number>([
  ENTITY_KIND.metalsExtractor,
  ENTITY_KIND.solar,
  ENTITY_KIND.commandHub,
  ENTITY_KIND.tradeHub,
  ENTITY_KIND.hq,
  ENTITY_KIND.dropPod,
  ENTITY_KIND.pylon,
  ENTITY_KIND.capacitor,
  ENTITY_KIND.wind,
  ENTITY_KIND.thermal,
  ENTITY_KIND.supplyDepot,
  ENTITY_KIND.mineralsQuarry,
  ENTITY_KIND.waterExtractor,
  ENTITY_KIND.petroleumWell,
]);

/** A `SimView` entity as the inspector reads it (tests pass partial rows). */
type EntitySummaryRow = Partial<Record<'id' | 'kind' | 'owner' | 'hp' | 'hpMax' | 'state', number>>;

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
    case ENTITY_STATE.offlineNoFuel: return 'offline: no fuel';
    case ENTITY_STATE.offlineNoGrid: return 'offline: no grid';
    case ENTITY_STATE.offlineOverload: return 'offline: overload';
    case ENTITY_STATE.idle: return 'idle';
    case ENTITY_STATE.working: return 'working';
    case ENTITY_STATE.harvesting: return 'harvesting';
    case ENTITY_STATE.repairing: return 'repairing';
    default: return 'online';
  }
}

export class PowerHud implements Disposable {
  readonly root: HTMLElement;
  private readonly brownoutBanner: HTMLElement;
  private readonly inspector: HTMLElement;
  private readonly inspectorTitle: HTMLElement;
  private readonly inspectorState: HTMLElement;
  private readonly inspectorHp: HTMLElement;
  private readonly inspectorLoad: HTMLElement;
  private readonly inspectorReason: HTMLElement;
  selectedEntityId: number | null = null;
  private offSelection: (() => void) | null = null;

  constructor(
    private readonly parent: HTMLElement,
    private readonly ctx?: FeatureContext,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'ta-power-hud';

    this.brownoutBanner = document.createElement('div');
    this.brownoutBanner.className = 'ta-power-hud__brownout plate-sm';
    this.brownoutBanner.setAttribute('data-brownout-banner', '');
    this.brownoutBanner.setAttribute('data-brownout', 'false');
    this.brownoutBanner.setAttribute('data-overload', 'false');
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

    this.inspectorLoad = document.createElement('span');
    this.inspectorLoad.className = 'ta-building-inspector__load';
    this.inspectorLoad.style.display = 'none';
    body.append(this.inspectorHp, this.inspectorLoad);

    this.inspectorReason = document.createElement('div');
    this.inspectorReason.className = 'ta-building-inspector__reason';
    this.inspectorReason.style.display = 'none';

    this.inspector.append(head, body, this.inspectorReason);
    this.root.append(this.brownoutBanner, this.inspector);
    this.parent.appendChild(this.root);
  }

  /**
   * Follows the player's selection (FF-49): a selected own building is inspected, else the first shed one. Bound on
   * the first update that sees `services.landfall` (the landfall panel may mount after this one).
   */
  private bindSelection(): void {
    const landfall = this.ctx?.services.landfall;
    if (this.offSelection || typeof landfall?.onChange !== 'function') return;
    this.offSelection = landfall.onChange(({ selectedEntity }) => {
      this.selectEntity(selectedEntity && !selectedEntity.isUnit ? selectedEntity.entityId : null);
    });
  }

  update(view: GameView): void {
    this.bindSelection();
    const v = (view ?? {}) as Record<string, unknown>;
    const colonyIdx = ownColonyIndex(this.ctx?.services);
    const power = readColonyPower(view, colonyIdx) ?? ((v.colony as Record<string, unknown> | undefined)?.power as Record<string, unknown> | undefined);

    this.updateBrownout(power);
    this.updateBuildingInspector(view, power, colonyIdx);
  }

  private updateBrownout(power?: Record<string, unknown>): void {
    const isBrownout = Boolean(power?.brownout);
    const pylonLoads = (power?.pylonLoads ?? {}) as Record<string, { flow?: number; max?: number; overloaded?: boolean }>;
    const isOverload = Object.values(pylonLoads).some((p) => Boolean(p.overloaded));
    this.brownoutBanner.setAttribute('data-brownout', String(isBrownout || isOverload));
    this.brownoutBanner.setAttribute('data-overload', String(isOverload));
    const groups = Array.isArray(power?.shedGroupsActive) ? (power.shedGroupsActive as number[]) : [];
    const { shed } = gridBalance(power);
    let head = 'BROWNOUT — DEMAND OVER SUPPLY';
    if (isOverload) {
      head = 'POWER OVERLOAD — PYLON CAPACITY EXCEEDED';
    } else if (groups.length > 0) {
      head = `BROWNOUT — SHEDDING GROUP ${groups.join(', ')}`;
    }
    this.brownoutBanner.textContent = shed > 0 ? `${head} · ${shed} E/s OFFLINE` : head;
  }

  private updateBuildingInspector(view: GameView, power: Record<string, unknown> | undefined, colonyIdx: number): void {
    const targetId = this.selectedEntityId ?? (view as { selectedEntityId?: number }).selectedEntityId;
    const shedIds = (power?.shedEntityIds ?? []) as number[];
    const overloadedIds = (power?.overloadedEntityIds ?? []) as number[];
    const pylonLoads = (power?.pylonLoads ?? {}) as Record<string, { flow?: number; max?: number; overloaded?: boolean }>;
    const firstOverloadedPylonId = Object.entries(pylonLoads).find(([, pl]) => Boolean(pl?.overloaded))?.[0];

    let candidateId: number | null = null;
    if (targetId !== undefined && targetId !== null) {
      candidateId = targetId;
    } else if (overloadedIds.length > 0) {
      candidateId = overloadedIds[0];
    } else if (firstOverloadedPylonId !== undefined) {
      candidateId = Number(firstOverloadedPylonId);
    } else if (shedIds.length > 0) {
      candidateId = shedIds[0];
    }

    if (this.ctx && candidateId === null) {
      this.inspector.style.display = 'none';
      return;
    }

    const ents = view as { entities?: Float32Array | EntitySummaryRow[]; count?: number };
    const entity = this.findTargetEntity(ents.entities, ents.count, candidateId, colonyIdx);
    if (!entity) {
      this.inspector.style.display = 'none';
      return;
    }

    this.inspector.style.display = 'flex';
    const label = KIND_NAMES[entity.kind] ?? 'Building';
    this.inspectorTitle.textContent = label;
    this.inspectorHp.textContent = `${Math.round(entity.hp)} / ${Math.round(entity.hpMax)} HP`;

    const ep = readEntityPower(view, entity.id, colonyIdx);
    const pl = readPylonLoad(view, entity.id, colonyIdx);

    if (pl) {
      this.inspectorLoad.style.display = 'inline';
      this.inspectorLoad.textContent = `${Math.round(pl.flow)} / ${Math.round(pl.max)} E/s`;
      this.inspector.setAttribute('data-overload', String(Boolean(pl.overloaded)));
    } else {
      this.inspectorLoad.style.display = 'none';
      this.inspector.setAttribute('data-overload', 'false');
    }

    const reasons = (power?.offlineReasons ?? {}) as Record<number, string>;
    const explicitReason = ep?.reason ?? reasons[entity.id];
    let stateStr = formatEntityState(entity.state, explicitReason);
    if (pl?.overloaded) {
      stateStr = 'offline: overload';
      this.inspectorState.textContent = 'OVERLOAD';
    } else {
      this.inspectorState.textContent = stateStr.toUpperCase();
    }
    this.inspector.setAttribute('data-state', stateStr);

    const isOffline = stateStr.startsWith('offline:') || stateStr === 'offline' || Boolean(pl?.overloaded);
    this.inspector.setAttribute('data-offline', String(isOffline));
    this.inspectorState.setAttribute('data-offline', String(isOffline));

    if (isOffline) {
      this.inspectorReason.style.display = 'block';
      this.inspectorReason.textContent = explicitReason ?? (pl?.overloaded ? 'offline: overload' : stateStr);
    } else {
      this.inspectorReason.style.display = 'none';
    }
  }

  /** Entity `targetId`, or (none asked) the first building of colony `colonyIdx`; reads either entity form (`viewCodec`). */
  private findTargetEntity(
    entities: Float32Array | EntitySummaryRow[] | undefined,
    count: number | undefined,
    targetId: number | null,
    colonyIdx: number,
  ): EntitySummary | null {
    if (!entities || !(entities instanceof Float32Array || Array.isArray(entities))) return null;
    let target: EntitySummary | null = null;
    let fallbackBuilding: EntitySummary | null = null;
    const rows = Array.isArray(entities) ? (entities.filter(Boolean) as unknown as Parameters<typeof forEachEntity>[0]) : entities;
    forEachEntity(rows, count, (e) => {
      const summary: EntitySummary = { id: Number(e.id ?? 0), kind: Number(e.kind ?? 0), hp: Number(e.hp ?? 0), hpMax: Number(e.hpMax || e.hp || 0), state: Number(e.state ?? 0) };
      if (targetId !== null) {
        if (summary.id !== targetId) return;
        target = summary;
        return false;
      }
      const owned = typeof e.owner !== 'number' || e.owner === colonyIdx; // test rows may omit the owner
      if (fallbackBuilding === null && owned && BUILDING_KINDS.has(summary.kind)) fallbackBuilding = summary;
    });
    return targetId === null ? fallbackBuilding : target;
  }

  selectEntity(id: number | null): void {
    this.selectedEntityId = id;
  }

  dispose(): void {
    this.offSelection?.();
    this.offSelection = null;
    this.root.remove();
  }
}
