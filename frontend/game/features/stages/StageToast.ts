import type { StageReachedData } from '@terra/contracts';
import { compileData, getStageSpec } from '@terra/sim';
import type { Disposable } from '../../core/registry/types';

export interface StageToastOptions {
  title?: string;
  replay?: boolean;
  guide?: string;
  teaches?: string;
  units?: readonly string[];
  buildings?: readonly string[];
  orders?: readonly string[];
  override?: string;
  autoDismissMs?: number;
  onDismiss?: () => void;
}

const ITEM_LABELS: Record<string, string> = {
  // Units
  hq: 'HQ',
  worker: 'Worker Drone',
  worker_t1: 'Worker Drone T1',
  worker_t2: 'Worker Drone T2',
  worker_t3: 'Worker Drone T3',
  scout: 'Scout',
  guard: 'Guard',
  combatEngineer: 'Combat Engineer',
  hauler: 'Hauler',
  striker: 'Striker',
  sapper: 'Sapper',
  envirobot: 'Envirobot',
  tank: 'Tank',
  artillery: 'Artillery',
  warden: 'Warden',
  surveyDrone: 'Survey Drone',
  goliath: 'Goliath',
  valkyrie: 'Valkyrie',
  archon: 'Archon',
  terraformingRig: 'Terraforming Rig',
  hq_t3: 'HQ T3',
  hauler_t3: 'Hauler T3',
  ascendantSkin: 'Ascendant Skin',

  // Buildings
  commandHub: 'Command Hub',
  commandHub_t2: 'Command Hub T2',
  commandHub_t3: 'Command Hub T3',
  metalsExtractor: 'Metals Extractor',
  mineralsExtractor: 'Minerals Extractor',
  waterExtractor: 'Water Extractor',
  biomassExtractor: 'Biomass Extractor',
  solar: 'Solar Collector',
  wind: 'Wind Turbine',
  thermal: 'Thermal Plant',
  petroleumWell: 'Petroleum Well',
  supplyDepot: 'Supply Depot',
  pylon: 'Pylon',
  depot: 'Depot',
  storageDepot: 'Storage Depot',
  capacitor: 'Capacitor',
  capacitor_t2: 'Capacitor T2',
  roboticsFactory: 'Robotics Factory',
  robotics_factory: 'Robotics Factory',
  turret: 'Turret',
  pulseTurret: 'Pulse Turret',
  wall: 'Wall',
  radar: 'Radar',
  outpostBeacon: 'Outpost Beacon',
  tradeHub: 'Trade Hub',
  road: 'Road',
  smelter: 'Smelter',
  chemicalPlant: 'Chemical Plant',
  thermalGenerator: 'Thermal Generator',
  shieldDome: 'Shield Dome',
  missileBattery: 'Missile Battery',
  researchLab: 'Research Lab',
  heavyFoundry: 'Heavy Foundry',
  fusionReactor: 'Fusion Reactor',
  shieldGenerator_t2: 'Shield Generator T2',
  arcTower: 'Arc Tower',
  apexBay: 'Apex Bay',
  orbitalUplink: 'Orbital Uplink',
  planetaryShield: 'Planetary Shield',
  launchPad: 'Launch Pad',
  fuelSynthesizer: 'Fuel Synthesizer',
  telemetryArray: 'Telemetry Array',
  monument: 'Monument',

  // Orders
  grade: 'Grade',
  clear: 'Clear',
  break: 'Break',
  harvest: 'Harvest',
  fill: 'Fill',
  bridge: 'Bridge',
  dismantle: 'Dismantle',
  patrol: 'Patrol',
  hold: 'Hold',
  claimSector: 'Claim Sector',
  clearCorridor: 'Clear Corridor',
  upgrade: 'Upgrade',
  prioritySliders: 'Priority Sliders',
  tunnel: 'Tunnel',
  drain: 'Drain',
  irrigate: 'Irrigate',
  stabilize: 'Stabilize',
  tradeContract: 'Trade Contract',
  siegeMode: 'Siege Mode',
  artilleryBarrage: 'Artillery Barrage',
  airRecon: 'Air Recon',
  raiseMountain: 'Raise Mountain',
  carveCanyon: 'Carve Canyon',
  seedForest: 'Seed Forest',
  purifyStep: 'Purify Step',
  rocketStage1: 'Rocket Stage 1',
  rocketStage2: 'Rocket Stage 2',
  rocketStage3: 'Rocket Stage 3',
  allOrders: 'All Orders',
};

/**
 * Returns a human-readable display label for a unit, building, or order ID.
 */
const UNIT_TABLES = ['unitsWorkersBasic', 'grid', 'terraform'] as const;
let unitLabelCache: Record<string, string> | null = null;

/** Row label for a unit id (`t1`/`t2`/`t3` or the row's `unit`), so toasts follow the balance table. */
function unitLabelFromBalance(id: string): string | undefined {
  if (!unitLabelCache) {
    unitLabelCache = {};
    const data = compileData(new Set(['W00', 'W01', 'W02', 'W03', 'W05']));
    for (const name of UNIT_TABLES) {
      const table = data.tables[name] as Record<string, { id?: string; kind?: string; unit?: string; label?: string; tier?: number }> | undefined;
      if (!table) continue;
      for (const row of Object.values(table)) {
        if (row.kind !== 'unit' || typeof row.label !== 'string') continue;
        if (typeof row.id === 'string') unitLabelCache[row.id] = row.label;
        if (row.unit === 'worker' && (row.tier === 1 || row.tier === 2 || row.tier === 3)) {
          unitLabelCache[`worker_t${row.tier}`] = row.label;
          unitLabelCache[`t${row.tier}`] = row.label;
        } else if (typeof row.unit === 'string') unitLabelCache[row.unit] = row.label;
      }
    }
  }
  return unitLabelCache[id];
}

export function formatItemLabel(id: string): string {
  if (ITEM_LABELS[id]) return ITEM_LABELS[id];
  const fromRow = unitLabelFromBalance(id);
  if (fromRow) return fromRow;
  const spaced = id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Formats a list of item IDs into deduplicated human-readable labels.
 */
export function formatItemList(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const res: string[] = [];
  for (const id of ids) {
    const label = formatItemLabel(id);
    if (!seen.has(label)) {
      seen.add(label);
      res.push(label);
    }
  }
  return res;
}

/**
 * Parses a transport message into StageReachedData if it matches an event schema.
 */
export function extractStageReachedData(m: unknown): StageReachedData | null {
  if (!m || typeof m !== 'object') return null;
  const raw = m as Record<string, unknown>;

  if (raw.t === 'event' && raw.d && typeof raw.d === 'object') {
    const event = raw.d as Record<string, unknown>;
    if (event.kind === 'stageReached') {
      const data = (event.data && typeof event.data === 'object' ? event.data : event) as Record<string, unknown>;
      if (typeof data.stage === 'number') return data as unknown as StageReachedData;
    }
  }

  if (raw.kind === 'stageReached' || raw.type === 'stageReached') {
    const data = (raw.data && typeof raw.data === 'object' ? raw.data : raw) as Record<string, unknown>;
    if (typeof data.stage === 'number') return data as unknown as StageReachedData;
  }

  return null;
}

/**
 * Faction Plate Stage-Reached Toast + Unlock Reveal Panel (W08-13).
 */
export class StageToast implements Disposable {
  private element: HTMLElement | null = null;
  private autoDismissTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private readonly host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  show(stage: number, opts?: StageToastOptions): HTMLElement {
    this.dismiss();

    const spec = getStageSpec(stage);
    const title = opts?.title ?? spec?.label ?? `S${stage}`;
    const teaches = opts?.teaches ?? spec?.teaches ?? '';
    const units = opts?.units ?? spec?.units ?? [];
    const buildings = opts?.buildings ?? spec?.buildings ?? [];
    const orders = opts?.orders ?? spec?.orders ?? [];
    const override = opts?.override;

    const el = document.createElement('div');
    el.className = 'ta-stage-reached-toast plate-sm';
    el.setAttribute('data-testid', 'stage-reached-toast');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

    const header = document.createElement('div');
    header.className = 'ta-stage-toast__header';

    const eyebrow = document.createElement('div');
    eyebrow.className = 'ta-stage-toast__eyebrow';
    eyebrow.textContent = opts?.replay ? 'STAGE GUIDE' : 'STAGE REACHED';

    const titleRow = document.createElement('div');
    titleRow.className = 'ta-stage-toast__title-row';

    const titleEl = document.createElement('h3');
    titleEl.className = 'ta-stage-toast__title';
    titleEl.setAttribute('data-testid', 'stage-toast-title');
    titleEl.textContent = title;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-ghost btn-sm ta-stage-toast__close';
    closeBtn.setAttribute('data-testid', 'stage-toast-close');
    closeBtn.setAttribute('aria-label', 'Close stage notification');
    closeBtn.textContent = '×';
    closeBtn.onclick = () => {
      this.dismiss();
      opts?.onDismiss?.();
    };
    titleRow.appendChild(closeBtn);

    if (override && override.trim() !== '') {
      const overrideEl = document.createElement('span');
      overrideEl.className = 'ta-stage-toast__override';
      overrideEl.setAttribute('data-testid', 'stage-toast-override');
      const clean = override.trim();
      overrideEl.textContent = clean.toLowerCase().startsWith('safety override')
        ? clean
        : `Safety Override: ${clean}`;
      titleRow.appendChild(overrideEl);
    }

    const teachesEl = document.createElement('div');
    teachesEl.className = 'ta-stage-toast__teaches';
    teachesEl.setAttribute('data-testid', 'stage-toast-teaches');
    teachesEl.textContent = teaches;

    header.append(eyebrow, titleRow, teachesEl);

    const reveal = document.createElement('div');
    reveal.className = 'ta-stage-unlock-reveal plate-sm';
    reveal.setAttribute('data-testid', 'stage-unlock-reveal');

    const revealHeader = document.createElement('div');
    revealHeader.className = 'ta-stage-unlock__header';
    revealHeader.textContent = opts?.replay ? 'STAGE CONTENT' : 'UNLOCKED';
    reveal.appendChild(revealHeader);

    const unitsSection = this.createUnlockSection('Units', units, 'stage-unlock-units');
    const buildingsSection = this.createUnlockSection('Buildings', buildings, 'stage-unlock-buildings');
    const ordersSection = this.createUnlockSection('Orders', orders, 'stage-unlock-orders');

    reveal.append(unitsSection, buildingsSection, ordersSection);

    const actions = document.createElement('div');
    actions.className = 'ta-stage-toast__actions';

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'btn btn-ghost btn-sm ta-stage-toast__dismiss';
    dismissBtn.setAttribute('data-testid', 'stage-toast-dismiss');
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.onclick = () => {
      this.dismiss();
      opts?.onDismiss?.();
    };
    actions.appendChild(dismissBtn);

    const guide = document.createElement('p');
    guide.className = 'ta-stage-toast__teaches';
    guide.dataset.testid = 'stage-guide-text';
    guide.textContent = opts?.guide ?? '';
    el.append(header, guide, reveal, actions);
    this.host.appendChild(el);
    this.element = el;

    this.startCountdown(actions, opts);

    return el;
  }

  private startCountdown(actions: HTMLElement, opts?: StageToastOptions): void {
    const timeoutMs = opts?.autoDismissMs ?? 30_000;
    if (timeoutMs <= 0 || !Number.isFinite(timeoutMs)) return;
    const countdown = document.createElement('span');
    countdown.dataset.testid = 'stage-toast-countdown';
    const deadline = Date.now() + timeoutMs;
    const update = () => { countdown.textContent = `Closes in ${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))}s`; };
    update();
    actions.prepend(countdown);
    this.countdownTimer = setInterval(update, 250);
    this.autoDismissTimer = setTimeout(() => {
      this.dismiss();
      opts?.onDismiss?.();
    }, timeoutMs);
  }

  private createUnlockSection(category: string, ids: readonly string[], testId: string): HTMLElement {
    const group = document.createElement('div');
    group.className = 'ta-stage-unlock__group';

    const label = document.createElement('span');
    label.className = 'ta-stage-unlock__label';
    label.textContent = category;

    const list = document.createElement('div');
    list.className = 'ta-stage-unlock__items';
    list.setAttribute('data-testid', testId);

    const formatted = formatItemList(ids);
    for (let i = 0; i < formatted.length; i++) {
      const span = document.createElement('span');
      span.className = 'ta-stage-unlock__item';
      span.textContent = formatted[i];
      list.appendChild(span);
      if (i < formatted.length - 1) {
        list.appendChild(document.createTextNode(' '));
      }
    }

    group.append(label, list);
    return group;
  }

  dismiss(): void {
    if (this.countdownTimer !== null) clearInterval(this.countdownTimer);
    this.countdownTimer = null;
    if (this.autoDismissTimer !== null) {
      clearTimeout(this.autoDismissTimer);
      this.autoDismissTimer = null;
    }
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }

  getElement(): HTMLElement | null {
    return this.element;
  }

  dispose(): void {
    this.dismiss();
  }
}
