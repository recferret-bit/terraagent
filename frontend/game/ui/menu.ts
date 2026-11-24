import type { PlanetListV1, PlanetSummaryV1, SectorId } from '@terra/contracts';
import { onPerfConfigChange } from '@terra/render/core/perfConfig';
import { onShadowQualityChange } from '@terra/render/core/shadowQuality';
import type { OrbitalGlobeMarkerInput, OrbitalProjectedFrame } from '@terra/render/orbit/types';
import { PLANET_KINDS, PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import { mountPlanetThumbnails, type PlanetThumbnailsHandle } from '@terra/render/planets/PlanetThumbnails';
import { notePlanetPickerViewed, notePlanetSelected } from '../../design/analytics/play';
import { PilotAccess } from '../../design/pilot/PilotAccess';
import {
  canFoundAnotherColony,
  probePilotColonyRoster,
  rosterFromSingleActiveColony,
  type ActiveHomeColony,
  type PilotColonyRoster,
} from '../../design/pilot/activeHomeColony';
import { applyColonyRosterToMenuDom } from './lobby/activeColonyLock';
import { NEW_COLONY_SELECTION_ID, type OrbitalDeployAction } from './orbitalHud/arHudTemplates';
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
  readonly initialNewColony?: boolean;
  readonly initialColonyId?: string | null;
}

function buildMenuShellHtml(planetsByKind: Readonly<Record<PlanetKind, PlanetSummaryV1>>): string {
  const cards = PLANET_KINDS.map((k) => worldCardHtml(k, planetsByKind[k])).join('');
  return `
      <div class="menu-top">
        <div class="menu-brand">
          <h1 class="title">TERRA<b>AGENT</b></h1>
          <div class="subtitle">AUTONOMOUS COLONY BUILDER · SELECT A WORLD</div>
        </div>
        <div class="menu-top-actions"></div>
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
  private readonly explicitSeed: number | undefined;
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
  private readonly offFpsCap: () => void;
  private readonly offShadowQuality: () => void;
  private activeColony: ActiveHomeColony | null = null;
  private colonyRoster: PilotColonyRoster | null = null;
  private selectedColonyId: string | null = null;
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
    this.explicitSeed = seed;
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
    this.selectedColonyId = options?.initialNewColony
      ? NEW_COLONY_SELECTION_ID
      : (options?.initialColonyId ?? null);
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
        selectedColonyId: this.selectedColonyId,
      },
      {
        onSectorSelect: (intent) => this.setSectorIntent(intent, true),
        onColonySelect: (colonyId, sectorId) => { this.selectColony(colonyId, sectorId); },
        onDeploy: () => {
          if (!this.canDeploy()) return;
          this.cb.onDeploy(this.kind, this.seed, this.settings, this.getSectorIntent());
        },
      },
    );
    this.deployBtn = this.arHud.getDeployButton();
    this.errEl = this.arHud.getErrorElement();

    this.settingsModal = new SettingsModal(this.el, this.settings, (next) => {
      this.settings = next;
      this.cb.onSettings(next);
    });
    this.offFpsCap = onPerfConfigChange((opt, res, cap) => {
      if (this.settings.optimized === opt && this.settings.resolution === res && this.settings.fpsCap === cap) return;
      this.settings = { ...this.settings, optimized: opt, resolution: res, fpsCap: cap };
    });
    this.offShadowQuality = onShadowQualityChange((shadows) => {
      if (this.settings.shadows === shadows) return;
      this.settings = { ...this.settings, shadows };
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
    notePlanetPickerViewed('play');
  }

  private mountCardThumbnails(): void {
    const canvases = [...this.el.querySelectorAll<HTMLCanvasElement>('canvas[data-planet]')];
    this.thumbnails = mountPlanetThumbnails(canvases, { size: 160, spinMultiplier: 3, syncWithOrbitMenu: true });
  }

  private bindControls(): void {
    this.el.querySelectorAll<HTMLElement>('.world-card').forEach((c) => {
      c.onclick = () => this.select(c.dataset.k as PlanetKind, true);
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
      colonyRoster: this.colonyRoster,
      selectedColonyId: this.selectedColonyId,
    });
  }

  getGlobeMarkers(): readonly OrbitalGlobeMarkerInput[] {
    return this.arHud.getGlobeMarkers();
  }

  updateArProjection(frame: OrbitalProjectedFrame | null): void {
    this.arHud.syncProjection(frame);
  }

  private canSelectPlanet(k: PlanetKind): boolean {
    if (!this.colonyRoster || this.colonyRoster.colonies.length === 0) return true;
    if (canFoundAnotherColony(this.colonyRoster)) return true;
    return this.colonyRoster.colonies.some((c) => c.kind === k);
  }

  select(k: PlanetKind, notify: boolean): void {
    if (!this.canSelectPlanet(k)) return;
    const changed = k !== this.kind;
    this.kind = k;
    if (changed) {
      this.seed = this.explicitSeed ?? PLANET_SPECS[k].seed;
      this.sectorIntent = { mode: 'auto' };
      const onKind = this.colonyRoster?.colonies.filter((c) => c.kind === k) ?? [];
      this.selectedColonyId = onKind[0]?.colonyId ?? null;
      if (onKind[0]) this.activeColony = onKind[0];
    }
    this.el
      .querySelectorAll<HTMLElement>('.world-card')
      .forEach((c) => c.classList.toggle('sel', c.dataset.k === k));
    this.renderArHud();
    if (notify) {
      notePlanetSelected(k, 'play');
      this.cb.onPlanet(k);
    }
  }

  /** Id of the planet selected in the menu (the orbit stage shows its prestige), or null when unknown. */
  selectedPlanetId(): string | null { return this.planetsByKind[this.kind]?.id ?? null; }
  getActiveColony(): ActiveHomeColony | null { return this.activeColony; }
  getColonyRoster(): PilotColonyRoster | null { return this.colonyRoster; }
  getSelectedColonyId(): string | null { return this.selectedColonyId; }
  hasActiveColony(): boolean { return (this.colonyRoster?.colonies.length ?? 0) > 0 || this.activeColony !== null; }
  resolveDeployAction(): OrbitalDeployAction { return this.arHud.resolveDeployAction(); }
  canDeploy(): boolean { return !this.arHud.isForeignSectorSelected(); }

  selectColony(colonyId: string, sectorId?: string): ActiveHomeColony | null {
    if (colonyId === NEW_COLONY_SELECTION_ID) {
      this.selectedColonyId = NEW_COLONY_SELECTION_ID;
      const ownedSectors = this.arHud.resolveDeployAction().ownedSectorIds;
      if (this.sectorIntent.mode === 'chosen' && ownedSectors.includes(this.sectorIntent.sectorId)) {
        this.sectorIntent = { mode: 'auto' };
      }
      this.renderArHud();
      this.cb.onSector?.(this.getSectorIntent());
      return null;
    }
    const picked =
      this.colonyRoster?.colonies.find((c) => c.colonyId === colonyId) ??
      (this.activeColony?.colonyId === colonyId ? this.activeColony : null);
    if (picked) {
      this.activeColony = picked;
      if (picked.kind !== this.kind) this.select(picked.kind, true);
      this.selectedColonyId = picked.colonyId;
      const targetSector = sectorId ?? picked.foundingSectorId;
      if (targetSector) {
        const normalized = normalizeSectorIntent(targetSector);
        const sectors = this.planetsByKind[this.kind].sectors;
        const validLand =
          normalized.mode !== 'chosen' ||
          sectors.length === 0 ||
          sectors.some((s) => s.kind === 'land' && s.sectorId === normalized.sectorId);
        if (validLand) this.sectorIntent = normalized;
      }
      this.renderArHud();
      this.cb.onSector?.(this.getSectorIntent());
      return picked;
    }
    this.selectedColonyId = colonyId;
    this.renderArHud();
    return null;
  }

  setColonyRoster(roster: PilotColonyRoster | null): void {
    this.colonyRoster = roster;
    const preserveNew = this.selectedColonyId === NEW_COLONY_SELECTION_ID && canFoundAnotherColony(roster);
    const kept =
      preserveNew || !this.selectedColonyId
        ? null
        : roster?.colonies.find((c) => c.colonyId === this.selectedColonyId) ?? null;
    this.selectedColonyId = preserveNew ? NEW_COLONY_SELECTION_ID : (kept?.colonyId ?? null);
    this.activeColony = kept ?? roster?.primary ?? roster?.colonies[0] ?? null;
    applyColonyRosterToMenuDom(this.el, roster);
    if (roster && roster.colonies.length > 0 && (!this.canSelectPlanet(this.kind) || (kept && kept.kind !== this.kind))) {
      const targetKind = (kept ?? this.activeColony ?? roster.colonies[0]!).kind;
      this.select(targetKind, true);
      if (kept) this.selectedColonyId = kept.colonyId;
      applyColonyRosterToMenuDom(this.el, roster);
    } else {
      this.renderArHud();
    }
  }

  setActiveColony(active: ActiveHomeColony | null): void {
    this.setColonyRoster(rosterFromSingleActiveColony(active));
  }

  async probeActiveColony(): Promise<ActiveHomeColony | null> {
    const roster = await probePilotColonyRoster({ fetch: this.probeFetch });
    if (!this.disposed) this.setColonyRoster(roster);
    return roster?.primary ?? null;
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
      if (validLand && this.selectedColonyId !== NEW_COLONY_SELECTION_ID) {
        const matched = this.colonyRoster?.colonies.find(
          (c) => c.kind === this.kind && c.foundingSectorId === normalized.sectorId,
        );
        if (matched) this.selectedColonyId = matched.colonyId;
      }
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
    if (this.colonyRoster) applyColonyRosterToMenuDom(this.el, this.colonyRoster);
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
    this.arHud.syncLockState();
    this.errEl.textContent = msg;
    this.deployBtn.disabled = !this.canDeploy();
  }

  hide(): void {
    this.settingsModal.close();
    this.thumbnails?.setPaused(true);
    this.el.classList.add('hide');
    this.ownedFeed?.suspend();
  }

  show(): void {
    this.el.classList.remove('hide');
    this.errEl.textContent = '';
    this.arHud.syncLockState();
    this.thumbnails?.setPaused(false);
    this.ownedFeed?.resume();
  }

  hasLinkedPilot(): boolean { return this.pilotAccess.hasLinkedPilot(); }

  dispose(): void {
    this.disposed = true;
    this.offFpsCap();
    this.offShadowQuality();
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
