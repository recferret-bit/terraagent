import type { PlanetListV1, PlanetSummaryV1, SectorId } from '@terra/contracts';
import type { OrbitalGlobeMarkerInput, OrbitalProjectedFrame } from '@terra/render/orbit/types';
import { PLANET_KINDS, PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import { mountPlanetThumbnails, type PlanetThumbnailsHandle } from '@terra/render/planets/PlanetThumbnails';
import { PilotAccess } from '../../design/pilot/PilotAccess';
import { probeActiveHomeColony, type ActiveHomeColony } from '../../design/pilot/activeHomeColony';
import { applyActiveColonyToMenuDom } from './lobby/activeColonyLock';
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
import { OrbitalArHud } from './orbitalHud/OrbitalArHud';
import './orbitalHud/orbitalArHud.css';
import {
  SettingsModal,
  createInitialMenuSettings,
  type MenuSettings,
} from './parts/settingsModal';
import { updateWorldCardElement, worldCardHtml } from './worldCard';

export type { MenuSettings } from './parts/settingsModal';
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

export interface MenuCallbacks {
  onPlanet(kind: PlanetKind): void;
  onDeploy(
    kind: PlanetKind,
    seed: number,
    settings: MenuSettings,
    sectorIntent: SectorIntentV1,
  ): void;
  onSettings(s: MenuSettings): void;
  /** Optional legacy seed hook (seed input removed from UI; `?seed=` URL param still supported). */
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
  readonly autoProbeColony?: boolean;
  readonly probeFetch?: typeof fetch;
}

function buildMenuShellHtml(planetsByKind: Readonly<Record<PlanetKind, PlanetSummaryV1>>): string {
  const cards = PLANET_KINDS.map((k) => worldCardHtml(k, planetsByKind[k])).join('');
  const landingHref =
    typeof location !== 'undefined' && location.hostname === 'play.terraagent.fun'
      ? 'https://terraagent.fun/'
      : '/landing.html';
  return `
      <div class="menu-top">
        <div>
          <h1 class="title">TERRA<b>AGENT</b></h1>
          <div class="subtitle">AUTONOMOUS COLONY BUILDER · SELECT A WORLD</div>
        </div>
        <div class="menu-top-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="settings-trigger" data-testid="settings-trigger">ESC · SETTINGS</button>
          <a class="btn btn-ghost btn-sm" href="${landingHref}">◂ TERRAAGENT.FUN</a>
        </div>
      </div>
      <div class="menu-bottom">
        <div class="cards">${cards}</div>
      </div>`;
}

export class MainMenu {
  readonly el = document.createElement('div');
  kind: PlanetKind;
  seed: number;
  settings: MenuSettings = createInitialMenuSettings();
  private planetsByKind: Record<PlanetKind, PlanetSummaryV1>;
  private sectorIntent: SectorIntentV1;
  private queuePaused = false;
  private pilotAccess: PilotAccess;
  private arHud: OrbitalArHud;
  private settingsModal: SettingsModal;
  private thumbnails: PlanetThumbnailsHandle | null = null;
  private deployBtn: HTMLButtonElement;
  private errEl: HTMLElement;
  private ownedFeed: LobbyPlanetFeed | null = null;
  private unsubscribeFeed: (() => void) | null = null;
  private activeColony: ActiveHomeColony | null = null;
  private disposed = false;
  private readonly autoProbeColony: boolean;
  private readonly probeFetch?: typeof fetch;

  constructor(
    parent: HTMLElement,
    private cb: MenuCallbacks,
    kind: PlanetKind = 'dune',
    seed?: number,
    options?: MainMenuOptions,
  ) {
    this.kind = kind;
    this.seed = seed ?? PLANET_SPECS[kind].seed;
    this.autoProbeColony = Boolean(options?.autoProbeColony);
    this.probeFetch = options?.probeFetch;
    this.planetsByKind = options?.planetList
      ? mergePlanetListIntoCanonicalMap(options.planetList)
      : createDefaultCanonicalPlanetMap();
    if (options?.planetList && !Array.isArray(options.planetList)) {
      this.queuePaused = Boolean((options.planetList as PlanetListV1).queuePaused);
    }
    this.sectorIntent = normalizeSectorIntent(options?.sectorIntent);
    this.el.id = 'menu';
    this.el.className = 'ui-layer';
    this.el.innerHTML = buildMenuShellHtml(this.planetsByKind);
    parent.appendChild(this.el);

    this.pilotAccess = new PilotAccess(this.el.querySelector<HTMLElement>('.menu-top-actions')!, {
      onAuthChange: () => {
        if (this.autoProbeColony) void this.probeActiveColony();
      },
    });

    this.arHud = new OrbitalArHud(
      this.el,
      {
        kind: this.kind,
        summary: this.planetsByKind[this.kind],
        intent: this.sectorIntent,
        queuePaused: this.queuePaused,
        activeColony: this.activeColony,
      },
      {
        onSectorSelect: (intent) => this.setSectorIntent(intent, true),
        onDeploy: () => this.cb.onDeploy(this.kind, this.seed, this.settings, this.getSectorIntent()),
      },
    );
    this.deployBtn = this.arHud.getDeployButton();
    this.errEl = this.arHud.getErrorElement();

    this.settingsModal = new SettingsModal(this.el, this.settings, (next) => {
      this.settings = next;
      this.cb.onSettings(next);
    });

    this.bindControls();
    this.select(kind, false);
    this.mountCardThumbnails();
    window.addEventListener('keydown', this.onKeyCapture, true);

    if (options?.feed) {
      this.attachFeed(options.feed);
      if (options.autoStartFeed !== false) options.feed.start();
    } else if (options?.feedOptions) {
      this.connectLobbyFeed(options.feedOptions, options.autoStartFeed !== false);
    }
    if (this.autoProbeColony) {
      void this.probeActiveColony();
    }
  }

  private mountCardThumbnails(): void {
    const canvases = [...this.el.querySelectorAll<HTMLCanvasElement>('canvas[data-planet]')];
    this.thumbnails = mountPlanetThumbnails(canvases, { size: 220, spinMultiplier: 6 });
  }

  private bindControls(): void {
    this.el.querySelectorAll<HTMLElement>('.world-card').forEach((c) => {
      c.onclick = () => this.select(c.dataset.k as PlanetKind, true);
    });
    this.el.querySelector<HTMLButtonElement>('#settings-trigger')?.addEventListener('click', () => {
      this.openSettings();
    });
  }

  private onKeyCapture = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || this.disposed || this.el.classList.contains('hide')) return;
    if (this.handleEscape()) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  handleEscape(): boolean {
    if (this.settingsModal.isOpen()) {
      this.settingsModal.close();
      return true;
    }
    if (typeof document !== 'undefined' && document.querySelector('dialog[open]')) {
      return false;
    }
    this.settingsModal.open();
    return true;
  }

  openSettings(): void { this.settingsModal.open(); }
  closeSettings(): void { this.settingsModal.close(); }
  isSettingsOpen(): boolean { return this.settingsModal.isOpen(); }

  private renderArHud(): void {
    const summary = this.planetsByKind[this.kind];
    if (this.sectorIntent.mode === 'chosen') {
      const chosenId = this.sectorIntent.sectorId;
      const existsInLand = summary.sectors.some((s) => s.kind === 'land' && s.sectorId === chosenId);
      if (!existsInLand) this.sectorIntent = { mode: 'auto' };
    }
    this.arHud.update({
      kind: this.kind,
      summary,
      intent: this.sectorIntent,
      queuePaused: this.queuePaused,
      activeColony: this.activeColony,
    });
  }

  getGlobeMarkers(): readonly OrbitalGlobeMarkerInput[] {
    return this.arHud.getGlobeMarkers();
  }

  updateArProjection(frame: OrbitalProjectedFrame | null): void {
    this.arHud.syncProjection(frame);
  }

  select(k: PlanetKind, notify: boolean): void {
    if (this.activeColony && k !== this.activeColony.kind) return;
    const changed = k !== this.kind;
    this.kind = k;
    if (changed) this.seed = PLANET_SPECS[k].seed;
    this.el
      .querySelectorAll<HTMLElement>('.world-card')
      .forEach((c) => c.classList.toggle('sel', c.dataset.k === k));
    this.renderArHud();
    if (notify) this.cb.onPlanet(k);
  }

  getActiveColony(): ActiveHomeColony | null { return this.activeColony; }
  hasActiveColony(): boolean { return this.activeColony !== null; }

  setActiveColony(active: ActiveHomeColony | null): void {
    this.activeColony = active;
    applyActiveColonyToMenuDom(this.el, active);
    if (active && this.kind !== active.kind) {
      this.select(active.kind, true);
      applyActiveColonyToMenuDom(this.el, active);
    } else {
      this.renderArHud();
    }
  }

  async probeActiveColony(): Promise<ActiveHomeColony | null> {
    const found = await probeActiveHomeColony({ fetch: this.probeFetch });
    if (!this.disposed) this.setActiveColony(found);
    return found;
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
    this.renderArHud();
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

  isQueuePaused(): boolean { return this.queuePaused; }

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
    if (this.activeColony) applyActiveColonyToMenuDom(this.el, this.activeColony);
    this.renderArHud();
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
    this.settingsModal.close();
    this.thumbnails?.setPaused(true);
    this.el.classList.add('hide');
  }

  show(): void {
    this.el.classList.remove('hide');
    this.deployBtn.disabled = false;
    this.errEl.textContent = '';
    this.thumbnails?.setPaused(false);
  }

  hasLinkedPilot(): boolean { return this.pilotAccess.hasLinkedPilot(); }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('keydown', this.onKeyCapture, true);
    this.unsubscribeFeed?.();
    this.unsubscribeFeed = null;
    this.ownedFeed?.dispose();
    this.ownedFeed = null;
    this.thumbnails?.dispose();
    this.thumbnails = null;
    this.arHud.dispose();
    this.settingsModal.dispose();
    this.pilotAccess.dispose();
    this.el.remove();
  }
}
