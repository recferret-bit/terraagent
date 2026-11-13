import type { PlanetListV1, PlanetSummaryV1, SectorId } from '@terra/contracts';
import { getViewportPreset, isShaderOptimized, type ViewportPreset } from '@terra/render/core/perfConfig';
import { PLANET_KINDS, PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import { PilotAccess } from '../../design/pilot/PilotAccess';
import {
  LobbyPlanetFeed,
  type LobbyPlanetFeedOptions,
} from './lobby/lobbyPlanetFeed';
import {
  createDefaultCanonicalPlanetMap,
  mergePlanetListIntoCanonicalMap,
  normalizeSectorIntent,
  type SectorIntentInput,
  type SectorIntentV1,
} from './lobby/orbitalPickerModel';
import {
  bindSectorChooserEvents,
  renderSectorChooserHtml,
} from './lobby/sectorChooser';
import { updateWorldCardElement, worldCardHtml } from './worldCard';

export type { SectorIntentV1, SectorIntentInput } from './lobby/orbitalPickerModel';
export {
  LobbyPlanetFeed,
  type LobbyFeedMode,
  type LobbyFetchLike,
  type LobbyPlanetFeedOptions,
  type LobbyTimerApi,
  type LobbyWsFactory,
  type LobbyWsLike,
} from './lobby/lobbyPlanetFeed';

export interface MenuSettings {
  bloom: boolean;
  quality: 'low' | 'high';
  skipCinematic: boolean;
  optimized: boolean;
  resolution: ViewportPreset;
}

export interface MenuCallbacks {
  onPlanet(kind: PlanetKind): void;
  onDeploy(
    kind: PlanetKind,
    seed: number,
    settings: MenuSettings,
    sectorIntent: SectorIntentV1,
  ): void;
  onSettings(s: MenuSettings): void;
  /** Seed edited or randomised. */
  onSeed?(seed: number): void;
  /** Sector placement intent changed (`{ mode: 'auto' }` or `{ mode: 'chosen', sectorId }`). */
  onSector?(sectorIntent: SectorIntentV1): void;
}

export interface MainMenuOptions {
  readonly planetList?: PlanetListV1 | readonly PlanetSummaryV1[];
  readonly sectorIntent?: SectorIntentInput;
  readonly feed?: LobbyPlanetFeed;
  readonly feedOptions?: LobbyPlanetFeedOptions;
  readonly autoStartFeed?: boolean;
}

function buildMenuInnerHtml(
  planetsByKind: Readonly<Record<PlanetKind, PlanetSummaryV1>>,
  selectedKind: PlanetKind,
  sectorIntent: SectorIntentV1,
  queuePaused: boolean,
  settings: MenuSettings,
): string {
  const cards = PLANET_KINDS.map((k) => worldCardHtml(k, planetsByKind[k])).join('');
  const { optimized, resolution } = settings;
  const resOpts: [ViewportPreset, string][] = [
    ['auto', 'AUTO'],
    ['2560x1440', '2560×1440'],
    ['1920x1080', '1920×1080'],
    ['1280x720', '1280×720'],
  ];
  const resRadios = resOpts
    .map(
      ([v, lbl]) =>
        `<label><input type="radio" name="s-res" value="${v}" ${resolution === v ? 'checked' : ''} /><span>${lbl}</span></label>`,
    )
    .join('');
  const sectorChooser = renderSectorChooserHtml(
    selectedKind,
    planetsByKind[selectedKind],
    sectorIntent,
    queuePaused,
  );
  return `
      <div class="menu-top"><div><h1 class="title">TERRA<b>AGENT</b></h1><div class="subtitle">AUTONOMOUS COLONY BUILDER · SELECT A WORLD</div></div><a class="btn btn-ghost btn-sm" href="/landing.html">◂ TERRAAGENT.COM</a></div>
      <div class="menu-bottom">
        <div class="cards">${cards}</div>
        <div class="deploy-box plate">
          <div id="sector-picker-host">${sectorChooser}</div>
          <div class="field-label">WORLD SEED</div>
          <div class="row"><input class="input" id="seed" inputmode="numeric" title="World seed" /><button class="btn btn-icon" id="dice" title="Randomise seed">🎲</button></div>
          <div class="settings">
            <label><input type="checkbox" id="s-bloom" checked /> bloom</label>
            <label>quality <select id="s-q"><option value="high">high</option><option value="low">low</option></select></label>
            <label><input type="checkbox" id="s-skip" /> skip cinematic</label>
          </div>
          <div class="radio-group">
            <div class="field-label">OPTIMIZATIONS</div>
            <div class="radios">
              <label><input type="radio" name="s-opt" value="1" ${optimized ? 'checked' : ''} /><span>ON</span></label>
              <label><input type="radio" name="s-opt" value="0" ${!optimized ? 'checked' : ''} /><span>OFF</span></label>
            </div>
          </div>
          <div class="radio-group">
            <div class="field-label">VIEWPORT W×H</div>
            <div class="radios">${resRadios}</div>
          </div>
          <div id="menu-err"></div>
          <button class="btn btn-primary btn-lg" id="deploy">DEPLOY</button>
        </div>
      </div>`;
}

export class MainMenu {
  readonly el = document.createElement('div');
  kind: PlanetKind;
  seed: number;
  settings: MenuSettings = {
    bloom: true,
    quality: 'high',
    skipCinematic: false,
    optimized: isShaderOptimized(),
    resolution: getViewportPreset(),
  };
  private planetsByKind: Record<PlanetKind, PlanetSummaryV1>;
  private sectorIntent: SectorIntentV1;
  private queuePaused = false;
  private pilotAccess: PilotAccess;
  private deployBtn!: HTMLButtonElement;
  private seedInput!: HTMLInputElement;
  private errEl!: HTMLElement;
  private sectorHostEl!: HTMLElement;
  private ownedFeed: LobbyPlanetFeed | null = null;
  private unsubscribeFeed: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    private cb: MenuCallbacks,
    kind: PlanetKind = 'dune',
    seed?: number,
    options?: MainMenuOptions,
  ) {
    this.kind = kind;
    this.seed = seed ?? PLANET_SPECS[kind].seed;
    this.planetsByKind = options?.planetList
      ? mergePlanetListIntoCanonicalMap(options.planetList)
      : createDefaultCanonicalPlanetMap();
    if (options?.planetList && !Array.isArray(options.planetList)) {
      this.queuePaused = Boolean((options.planetList as PlanetListV1).queuePaused);
    }
    this.sectorIntent = normalizeSectorIntent(options?.sectorIntent);
    this.el.id = 'menu';
    this.el.className = 'ui-layer';
    this.el.innerHTML = buildMenuInnerHtml(
      this.planetsByKind,
      this.kind,
      this.sectorIntent,
      this.queuePaused,
      this.settings,
    );
    parent.appendChild(this.el);

    this.pilotAccess = new PilotAccess(this.el.querySelector<HTMLElement>('.menu-top')!);
    this.deployBtn = this.el.querySelector('#deploy')!;
    this.seedInput = this.el.querySelector('#seed')!;
    this.errEl = this.el.querySelector('#menu-err')!;
    this.sectorHostEl = this.el.querySelector('#sector-picker-host')!;

    this.bindControls();
    this.bindSectorHost();
    this.select(kind, false);

    if (options?.feed) {
      this.attachFeed(options.feed);
      if (options.autoStartFeed !== false) options.feed.start();
    } else if (options?.feedOptions) {
      this.connectLobbyFeed(options.feedOptions, options.autoStartFeed !== false);
    }
  }

  private bindControls(): void {
    this.el.querySelectorAll<HTMLElement>('.world-card').forEach((c) => {
      c.onclick = () => this.select(c.dataset.k as PlanetKind, true);
    });
    this.seedInput.oninput = () => {
      const n = parseInt(this.seedInput.value, 10);
      if (Number.isFinite(n)) {
        this.seed = n >>> 0;
        this.cb.onSeed?.(this.seed);
      }
    };
    (this.el.querySelector('#dice') as HTMLElement).onclick = () => {
      this.seed = (Math.random() * 99999) | 0;
      this.seedInput.value = String(this.seed);
      this.cb.onSeed?.(this.seed);
    };
    const sb = this.el.querySelector('#s-bloom') as HTMLInputElement;
    const sq = this.el.querySelector('#s-q') as HTMLSelectElement;
    const ss = this.el.querySelector('#s-skip') as HTMLInputElement;
    const push = () => {
      const optEl = this.el.querySelector<HTMLInputElement>('input[name="s-opt"]:checked');
      const resEl = this.el.querySelector<HTMLInputElement>('input[name="s-res"]:checked');
      this.settings = {
        bloom: sb.checked,
        quality: sq.value as 'low' | 'high',
        skipCinematic: ss.checked,
        optimized: optEl ? optEl.value === '1' : true,
        resolution: (resEl?.value as ViewportPreset) ?? 'auto',
      };
      this.cb.onSettings(this.settings);
    };
    sb.onchange = sq.onchange = ss.onchange = push;
    this.el
      .querySelectorAll<HTMLInputElement>('input[name="s-opt"], input[name="s-res"]')
      .forEach((r) => (r.onchange = push));
    this.deployBtn.onclick = () => {
      this.deployBtn.disabled = true;
      this.cb.onDeploy(this.kind, this.seed, this.settings, this.getSectorIntent());
    };
  }

  private bindSectorHost(): void {
    bindSectorChooserEvents(this.sectorHostEl, (intent) => {
      this.setSectorIntent(intent, true);
    });
  }

  private renderSectorChooser(): void {
    const summary = this.planetsByKind[this.kind];
    if (this.sectorIntent.mode === 'chosen') {
      const chosenId = this.sectorIntent.sectorId;
      const existsInLand = summary.sectors.some(
        (s) => s.kind === 'land' && s.sectorId === chosenId,
      );
      if (!existsInLand) {
        this.sectorIntent = { mode: 'auto' };
      }
    }
    this.sectorHostEl.innerHTML = renderSectorChooserHtml(
      this.kind,
      summary,
      this.sectorIntent,
      this.queuePaused,
    );
    this.bindSectorHost();
  }

  select(k: PlanetKind, notify: boolean): void {
    const changed = k !== this.kind;
    this.kind = k;
    if (changed) this.seed = PLANET_SPECS[k].seed;
    this.seedInput.value = String(this.seed);
    this.el
      .querySelectorAll<HTMLElement>('.world-card')
      .forEach((c) => c.classList.toggle('sel', c.dataset.k === k));
    this.renderSectorChooser();
    if (notify) this.cb.onPlanet(k);
  }

  getSectorIntent(): SectorIntentV1 {
    return this.sectorIntent.mode === 'chosen'
      ? { mode: 'chosen', sectorId: this.sectorIntent.sectorId }
      : { mode: 'auto' };
  }

  setSectorIntent(intent: SectorIntentInput, notify = false): void {
    const normalized = normalizeSectorIntent(intent);
    const summary = this.planetsByKind[this.kind];
    if (normalized.mode === 'chosen') {
      const validLand = summary.sectors.some(
        (s) => s.kind === 'land' && s.sectorId === normalized.sectorId,
      );
      this.sectorIntent = validLand ? normalized : { mode: 'auto' };
    } else {
      this.sectorIntent = { mode: 'auto' };
    }
    this.renderSectorChooser();
    if (notify) this.cb.onSector?.(this.getSectorIntent());
  }

  selectSector(sectorIdOrAuto: 'auto' | SectorId, notify = true): void {
    this.setSectorIntent(sectorIdOrAuto, notify);
  }

  getPlanetSummary(kind: PlanetKind = this.kind): PlanetSummaryV1 {
    return this.planetsByKind[kind];
  }

  getPlanetSummaries(): Readonly<Record<PlanetKind, PlanetSummaryV1>> {
    return this.planetsByKind;
  }

  isQueuePaused(): boolean {
    return this.queuePaused;
  }

  setPlanetList(list: PlanetListV1 | readonly PlanetSummaryV1[], queuePaused?: boolean): void {
    this.planetsByKind = mergePlanetListIntoCanonicalMap(list, this.planetsByKind);
    if (queuePaused !== undefined) {
      this.queuePaused = queuePaused;
    } else if (!Array.isArray(list) && 'queuePaused' in list) {
      this.queuePaused = Boolean((list as PlanetListV1).queuePaused);
    }
    this.el.querySelectorAll<HTMLElement>('.world-card').forEach((cardEl) => {
      const k = cardEl.dataset.k as PlanetKind | undefined;
      if (k && k in this.planetsByKind) {
        updateWorldCardElement(cardEl, this.planetsByKind[k]);
      }
    });
    this.renderSectorChooser();
  }

  updatePlanets(list: PlanetListV1 | readonly PlanetSummaryV1[], queuePaused?: boolean): void {
    this.setPlanetList(list, queuePaused);
  }

  attachFeed(feed: LobbyPlanetFeed): () => void {
    this.unsubscribeFeed?.();
    const unsub = feed.subscribe((list) => this.setPlanetList(list));
    this.unsubscribeFeed = unsub;
    return unsub;
  }

  connectLobbyFeed(options: LobbyPlanetFeedOptions = {}, startImmediately = true): LobbyPlanetFeed {
    this.ownedFeed?.dispose();
    const feed = new LobbyPlanetFeed(options);
    this.ownedFeed = feed;
    this.attachFeed(feed);
    if (startImmediately) feed.start();
    return feed;
  }

  setError(msg: string): void {
    this.errEl.textContent = msg;
    this.deployBtn.disabled = false;
  }

  hide(): void {
    this.el.classList.add('hide');
  }

  show(): void {
    this.el.classList.remove('hide');
    this.deployBtn.disabled = false;
    this.errEl.textContent = '';
  }

  hasLinkedPilot(): boolean {
    return this.pilotAccess.hasLinkedPilot();
  }

  dispose(): void {
    this.unsubscribeFeed?.();
    this.unsubscribeFeed = null;
    this.ownedFeed?.dispose();
    this.ownedFeed = null;
    this.pilotAccess.dispose();
    this.el.remove();
  }
}
