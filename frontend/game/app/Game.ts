import * as THREE from 'three';
import { createColonyViewport, type ColonyViewport } from '@terra/render/core/createColonyViewport';
import { enqueueDeferredDispose, flushDeferredDispose } from '@terra/render/core/deferredDispose';
import { createFramePacer } from '@terra/render/core/framePacer';
import { getFpsCap, getViewportPreset, isShaderOptimized, onPerfConfigChange } from '@terra/render/core/perfConfig';
import { getShadowQuality } from '@terra/render/core/shadowQuality';
import { LANDING_PREWARM_ARCHETYPES } from '@terra/render/kitbash';
import { stepMenuStageFrame } from './menuStageStep';
import { MenuPrestige } from './prestige/OrbitPrestige';
import { PLANET_KINDS, PLANET_SPECS, type PlanetKind, type PlanetSpec } from '@terra/render/planets/PlanetSpec';
import { getSharedTerrainPrep } from '@terra/render/planets/prep';
import type { PlanetSurface } from '@terra/render/planets/surface/types';
import type { OrbitalStage } from '@terra/render/orbit/types';
import type { DescentSequence, DescentTelemetry } from '@terra/render/descent/types';
import { createOrbitalStage } from '@terra/render/orbit/OrbitalStage';
import { Gameplay } from './Gameplay';
import {
  applyColonyViewportSettings, buildForwardedOnlineSearch, finishReturningColonyEntry, mountBootOnlineSession,
  mountPrototypeHudRig, parseInitialMenuColonyOptions, prepareOnlineGuestState, resetOrbitalScene,
  resolveColonyLoadMode, resolveEnteringDeployTarget, startReturningColonyEntry, stepEntryBloomFlash, stepReturningColonyEntry,
  stripColonyIdFromSearch, syncOrbitSelectorUrl, type ColonyLoadMode,
} from './colonyEntryBridge';
import { OnlineSession } from './online/OnlineSession';
import { parseGroundSeedInput, writeStoredPlanetKind } from './online/viewportHelper';
import { noteBootFailure, noteColonyEntered, noteDescentStarted, notePlanetSelected, notePlayBooted } from '../../design/analytics/play';
import {
  buildPreparedDescentSession, disposePreparedDescentSession, preloadDescentSurfaceInWorker,
  retireDescentAndSurfaceDeferred, stepDeployingStageFrame, stepOnlineRetroHud, syncOnlineSpaceDescentFrame,
  type PreparedDescentSession,
} from './descentBridge';
import { MainMenu, type MenuSettings, type SectorIntentV1 } from '../ui/menu';
import { normalizeSectorIntent } from '../ui/lobby/orbitalPickerModel';
import { DescentHud, GameHud } from '../ui/hud';
import '../net/services';
import { isProductionBuild } from '../core/buildEnv';
import { createClientFlagsStore, type ClientFlagsStore } from '../core/flags';
import '../../design/css/tokens.css';
import '../../design/css/base.css';
import '../ui/ui.css';

type Phase = 'menu' | 'loading' | 'entering' | 'deploying' | 'descent' | 'gameplay';

export class Game {
  readonly viewport: ColonyViewport;
  private root: HTMLElement;
  private prototypeHud: { dispose(): void } | null = null;
  private flagsStore: ClientFlagsStore | null = null;
  private fade = document.createElement('div');
  private phase: Phase = 'menu';
  private menu!: MainMenu;
  private stage: OrbitalStage | null = null;
  private settings: MenuSettings = { bloom: true, quality: 'high', shadows: getShadowQuality(), skipCinematic: false, optimized: isShaderOptimized(), resolution: getViewportPreset(), fpsCap: getFpsCap() };
  private sectorIntent: SectorIntentV1 = { mode: 'auto' };
  private baseChildren = new Set<THREE.Object3D>();
  // per-session
  private spec!: PlanetSpec; private surface: PlanetSurface | null = null;
  private descent: DescentSequence | null = null; private dHud: DescentHud | null = null;
  private retroTelAt: ((tn: number) => DescentTelemetry) | null = null;
  private suppressDescentHud = false;
  private gHud: GameHud | null = null; private play: Gameplay | null = null;
  private online: OnlineSession | null = null;
  private skipOnlineLanding = false;
  private keepOnlineSession = false;
  private useOnlineGameplay = true;
  private loadMode: ColonyLoadMode | null = null;
  private isLocalHost: boolean; private sessionSearch: string;
  private time = 0; private raf = 0;
  private readonly pacer = createFramePacer({ maxDt: 0.05 });
  private readonly offFpsCap = onPerfConfigChange((opt, res, cap) => { if (this.settings.optimized !== opt || this.settings.resolution !== res || this.settings.fpsCap !== cap) this.settings = { ...this.settings, optimized: opt, resolution: res, fpsCap: cap }; });
  private readonly prewarmQueue: string[] = [...LANDING_PREWARM_ARCHETYPES]; private prepSeq = 0;
  private readonly prestige = new MenuPrestige({ isLocalHost: () => this.isLocalHost, flagOn: () => this.flagsStore?.set.has('W28') ?? true, activeColony: () => this.menu.getActiveColony() });
  private escListener = (e: KeyboardEvent) => this.onKey(e);
  private prepared: PreparedDescentSession | null = null; private prepTimer = 0;
  private deploySession: PreparedDescentSession | null = null;
  private cutFlash = 0; private baseBloom = 0.45; private entryHoldElapsed = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.viewport = createColonyViewport(root);
    this.viewport.scene.children.forEach((c) => this.baseChildren.add(c));
    this.fade.className = 'fade'; document.body.appendChild(this.fade);
    window.addEventListener('keydown', this.escListener);
    const q = new URLSearchParams(location.search);
    const devBuild = !isProductionBuild();
    this.sessionSearch = buildForwardedOnlineSearch(location.search);
    const kind = (PLANET_KINDS.includes(q.get('planet') as PlanetKind) ? q.get('planet') : 'dune') as PlanetKind;
    writeStoredPlanetKind(kind);
    if (devBuild && q.has('menutime')) this.time = parseFloat(q.get('menutime')!) || 0;
    const seed = parseGroundSeedInput(q.get('seed'), PLANET_SPECS[kind].seed);
    this.sectorIntent = normalizeSectorIntent(q.get('sector'));
    const store = this.flagsStore ??= createClientFlagsStore();
    this.isLocalHost = devBuild && q.get('host') === 'local';
    this.useOnlineGameplay = !devBuild || store.set.has('W01');

    this.menu = new MainMenu(document.body, {
      onPlanet: (k) => {
        this.sessionSearch = stripColonyIdFromSearch(this.sessionSearch);
        writeStoredPlanetKind(k);
        this.stage?.setPlanet(this.makeSpec(k, this.menu.seed));
        this.syncOrbitUrl();
        this.schedulePrepare();
      },
      onSector: (intent) => {
        this.sessionSearch = stripColonyIdFromSearch(this.sessionSearch);
        this.sectorIntent = intent;
        this.syncOrbitUrl();
      },
      onDeploy: (k, s, st, intent) => { this.settings = st; this.sectorIntent = intent; this.deploy(k, s); },
      onSettings: (st) => {
        const rebuildPrep = st.quality !== this.settings.quality;
        this.settings = st;
        this.applySettings();
        if (rebuildPrep) this.schedulePrepare();
      },
    }, kind, seed, { ...parseInitialMenuColonyOptions(location.search), explicitPlanet: q.has('planet'), sectorIntent: this.sectorIntent, feedOptions: this.isLocalHost ? undefined : { wsUrl: null }, autoProbeColony: this.useOnlineGameplay && !this.isLocalHost });
    this.settings = this.menu.settings;
    this.mountStage(this.makeSpec(kind, this.menu.seed));
    this.applySettings();
    this.loop();
    this.syncOrbitUrl();
    this.schedulePrepare(60);
  }

  private syncOrbitUrl() { syncOrbitSelectorUrl(this.menu.kind, this.menu.getSelectedColonyId() === '__new__'); }

  private makeSpec(kind: PlanetKind, seed: number): PlanetSpec { return { ...PLANET_SPECS[kind], seed }; }

  private applySettings() {
    applyColonyViewportSettings(this.viewport, this.settings);
  }

  private mountStage(spec: PlanetSpec) {
    this.stage = createOrbitalStage(this.viewport, spec);
    this.viewport.setView(this.stage.scene, this.stage.camera);
  }
  private resetScene() { resetOrbitalScene(this.viewport.scene, this.baseChildren); }

  private schedulePrepare(delay = 50) {
    clearTimeout(this.prepTimer);
    const seq = ++this.prepSeq;
    if (this.useOnlineGameplay && this.menu.resolveDeployAction().mode === 'enter') return;
    this.prepTimer = window.setTimeout(() => {
      if (this.phase !== 'menu' || seq !== this.prepSeq) return;
      const kind = this.menu.kind, seed = this.menu.seed, quality = this.settings.quality;
      void preloadDescentSurfaceInWorker(this.makeSpec(kind, seed), quality).then(() => {
        if (this.phase !== 'menu' || seq !== this.prepSeq) return;
        if (this.menu.kind !== kind || this.menu.seed !== seed || this.settings.quality !== quality) return;
        try { this.prepare(kind, seed); } catch (e) { console.warn('prepare failed', e); }
      });
    }, delay);
  }

  /** Builds surface + descent into viewport.scene (not rendered while the menu shows) and pre-compiles every shader. */
  private prepare(kind: PlanetKind, seed: number): PreparedDescentSession {
    const key = `${kind}:${seed}:${this.settings.quality}`;
    if (this.prepared?.key === key) return this.prepared;
    this.discardPrepared();
    this.prepared = buildPreparedDescentSession({
      viewport: this.viewport, key, spec: this.makeSpec(kind, seed), quality: this.settings.quality,
      resetScene: () => this.resetScene(), prestige: this.prestige.descent,
      isStale: (p) => this.prepared !== p && this.deploySession !== p && this.descent !== p.descent,
    });
    return this.prepared;
  }
  private discardPrepared() {
    const p = this.prepared; this.prepared = null;
    disposePreparedDescentSession({ viewport: this.viewport, prepared: p, resetScene: () => this.resetScene() });
  }

  private deploy(kind: PlanetKind, seed: number, instant = false) {
    if (this.phase !== 'menu' || !this.menu.canDeploy()) return;
    const deployAction = this.menu.resolveDeployAction();
    const target = resolveEnteringDeployTarget({
      kind, seed, sessionSearch: this.sessionSearch, mode: deployAction.mode,
      actionColony: deployAction.colony, roster: this.menu.getColonyRoster(),
    });
    this.sessionSearch = stripColonyIdFromSearch(this.sessionSearch);
    kind = target.kind;
    seed = target.seed;
    clearTimeout(this.prepTimer);
    this.prepSeq++;
    this.loadMode = resolveColonyLoadMode({ isReturning: this.useOnlineGameplay && Boolean(target.enteringColonyId), instant, skipCinematic: this.settings.skipCinematic });
    if (this.useOnlineGameplay && target.enteringColonyId) { this.enterExistingColony(kind, seed, instant, target.enteringColonyId, target.enteringPlanetId); return; }
    writeStoredPlanetKind(kind);
    notePlanetSelected(kind, 'play');
    notePlayBooted(kind, this.useOnlineGameplay && !this.isLocalHost ? 'online' : 'local');
    let p: PreparedDescentSession;
    try { p = this.prepare(kind, seed); }
    catch (err) {
      console.error('deploy failed', err);
      noteBootFailure(err instanceof Error ? err.message : 'deploy');
      this.discardPrepared();
      this.menu.setError('Deploy failed: ' + (err as Error).message);
      return;
    }
    this.prepared = null; this.deploySession = p;
    this.spec = p.spec; this.surface = p.surface; this.descent = p.descent;
    this.skipOnlineLanding = false;
    this.suppressDescentHud = false;
    if (this.useOnlineGameplay) {
      const hasExistingPilot = this.menu.hasLinkedPilot() || this.menu.hasActiveColony();
      this.keepOnlineSession = hasExistingPilot;
      prepareOnlineGuestState(hasExistingPilot);
      if (!this.settings.skipCinematic) {
        this.online = mountBootOnlineSession({
          root: this.root, viewport: this.viewport, planetKind: this.spec.kind, planetId: this.menu.selectedPlanetId() ?? undefined,
          newColony: this.menu.hasActiveColony(), sectorIntent: this.sectorIntent,
          loadMode: 'pod', skipDescent: false, fromSpaceDescent: true, freshDeployment: true, orbitalCameraDrop: false,
          deferReveal: false, tryRefresh: hasExistingPilot, search: this.sessionSearch, onReturnToOrbit: () => { void this.returnToOrbit(); },
        });
      }
    }
    this.dHud = new DescentHud(document.body);
    if (!this.useOnlineGameplay) {
      this.gHud = new GameHud(document.body, this.spec.name, this.spec.seed, { onResume: () => this.setPaused(false), onReturn: () => this.returnToOrbit() });
    }
    this.descent.onTelemetry((t) => {
      if (this.suppressDescentHud) return;
      if (this.useOnlineGameplay && (t.phase === 'retro' || t.phase === 'touchdown')) {
        this.handoffDescent(false);
        return;
      }
      this.dHud?.update(t);
      if (!this.useOnlineGameplay) return;
      this.spec = syncOnlineSpaceDescentFrame({
        online: this.online, descent: this.descent, surface: this.surface, currentSpec: this.spec, tel: t,
      });
    });
    this.descent.onComplete((hero) => this.startGameplay(hero));
    this.descent.syncHandoffSolar?.();
    this.dHud.update(this.descent.handoff.tel);

    if (instant || !this.stage || this.settings.skipCinematic) {
      this.menu.hide();
      this.cutToDescent(false);
      this.dHud.show();
      if (this.settings.skipCinematic) this.skipDescent();
      return;
    }
    this.phase = 'deploying';
    this.menu.hide();
    window.setTimeout(() => this.dHud?.show(), 450);
    const align = this.stage.beginDeploy(this.descent.handoff, { biomeKey: this.spec.biomeKey });
    this.descent.alignGlobe(align.spinQuat, align.cloudRotY);
  }

  private enterExistingColony(kind: PlanetKind, seed: number, instant: boolean, colonyId?: string, planetId?: string) {
    if (!this.menu.canDeploy()) return;
    this.discardPrepared();
    this.resetScene();
    this.spec = this.makeSpec(kind, seed);
    this.keepOnlineSession = true;
    this.entryHoldElapsed = 0;
    this.skipOnlineLanding = false;
    const skipCinematic = instant || this.settings.skipCinematic;
    this.online = startReturningColonyEntry({
      root: this.root, viewport: this.viewport, planetKind: kind, planetId, colonyId, sectorIntent: this.sectorIntent,
      skipCinematic, stage: this.stage, markers: this.menu.getGlobeMarkers(), search: this.sessionSearch,
      onReturnToOrbit: () => { void this.returnToOrbit(); },
    });
    this.menu.hide();
    if (skipCinematic || !this.stage) this.finishColonyEntry(true);
    else this.phase = 'entering';
  }

  private finishColonyEntry(skipDrop = false) {
    const res = finishReturningColonyEntry({ stage: this.stage, viewport: this.viewport, online: this.online, skipDrop });
    this.stage = null;
    this.phase = 'gameplay';
    this.baseBloom = res.baseBloom;
    this.cutFlash = res.cutFlash;
  }

  private cutToDescent(flash = true) {
    if (!this.descent) return;
    const vp = this.viewport;
    const st = this.stage; this.stage = null;
    vp.setView(vp.scene, vp.camera);
    noteDescentStarted(this.spec?.kind);
    this.descent.start();
    this.phase = 'descent';
    this.deploySession = null;
    this.cutFlash = flash ? 1 : 0;
    if (st) {
      if (st.disposeDeferred) st.disposeDeferred();
      else enqueueDeferredDispose(() => st.dispose());
    }
  }

  private handoffDescent(skipToColony: boolean) {
    if (!this.descent || this.phase !== 'descent') return;
    this.skipOnlineLanding = skipToColony;
    this.suppressDescentHud = this.useOnlineGameplay;
    this.descent.skip();
    if (this.phase === 'descent') this.descent.update(0);
    if (this.useOnlineGameplay && !skipToColony) this.syncOnlineRetroHud();
  }

  private skipDescent() {
    this.handoffDescent(true);
  }

  private startGameplay(hero: THREE.Object3D) {
    if (this.phase === 'gameplay' || !this.surface || !this.descent) return;
    this.phase = 'gameplay';
    const d = this.descent; this.descent = null;

    if (this.useOnlineGameplay) {
      const keepRetroHud = Boolean(this.online && !this.skipOnlineLanding && !this.settings.skipCinematic);
      this.retroTelAt = keepRetroHud ? d.handoff.telAt : null;
      if (!keepRetroHud) {
        this.dHud?.hide();
        this.dHud?.dispose();
        this.dHud = null;
      }
      hero.removeFromParent();
      const surf = this.surface;
      this.surface = null;
      retireDescentAndSurfaceDeferred(this.viewport, d, surf);
      this.viewport.camera.fov = 28;
      this.viewport.camera.updateProjectionMatrix();
      if (typeof history !== 'undefined' && typeof location !== 'undefined') {
        history.replaceState(null, '', location.pathname);
      }
      if (this.online) {
        if (this.skipOnlineLanding || this.settings.skipCinematic) this.online.skipLanding();
        else this.online.setSpacePhase(null);
      } else {
        this.resetScene();
        this.online = mountBootOnlineSession({
          root: this.root, viewport: this.viewport, planetKind: this.spec.kind, planetId: this.menu.selectedPlanetId() ?? undefined,
          newColony: this.menu.hasActiveColony(), sectorIntent: this.sectorIntent,
          loadMode: 'instant', skipDescent: true, fromSpaceDescent: false, freshDeployment: true, orbitalCameraDrop: false,
          deferReveal: false, tryRefresh: this.keepOnlineSession, search: this.sessionSearch, onReturnToOrbit: () => { void this.returnToOrbit(); },
        });
      }
      return;
    }

    this.dHud?.hide();
    const dh = this.dHud; this.dHud = null;
    const pose = d.finalPose;
    noteColonyEntered(this.spec.kind, 'local');
    this.viewport.camera.fov = 28; this.viewport.camera.updateProjectionMatrix();
    this.play = new Gameplay(this.viewport.scene, this.viewport.camera, this.viewport.renderer.domElement, this.surface, this.spec, hero, this.gHud!, { position: pose.position.clone(), target: pose.target.clone() });
    this.gHud!.show();
    this.mountFeatureHud();
    this.gHud!.setResources({ energy: 120, metal: 60, water: 40, bio: 10 });
    if (d.disposeDeferred) d.disposeDeferred(); else enqueueDeferredDispose(() => { try { d.dispose(); } catch (e) { console.warn(e); } });
    getSharedTerrainPrep().unloadLanded(true);
    setTimeout(() => dh?.dispose(), 900);
  }

  // ------------------------------------------------------------------ states
  private onKey(e: KeyboardEvent) {
    if (this.phase === 'entering' && (e.key === 'Escape' || e.key === ' ')) { e.preventDefault(); this.finishColonyEntry(true); }
    else if (this.phase === 'deploying' && (e.key === 'Escape' || e.key === ' ')) { e.preventDefault(); this.cutToDescent(false); this.skipDescent(); }
    else if (this.phase === 'descent' && (e.key === 'Escape' || e.key === ' ')) { e.preventDefault(); this.skipDescent(); }
    else if (this.phase === 'gameplay' && !this.online && e.key === 'Escape') this.setPaused(!(this.gHud?.paused));
  }
  private setPaused(p: boolean) {
    if (this.online) { this.online.setPaused(p); return; }
    this.gHud?.setPaused(p);
    if (this.play) { this.play.paused = p; this.play.cam.enabled = !p; }
  }

  private mountFeatureHud() {
    this.prototypeHud?.dispose();
    this.prototypeHud = mountPrototypeHudRig(this.flagsStore ??= createClientFlagsStore());
  }

  private teardownSession() {
    this.prototypeHud?.dispose(); this.prototypeHud = null;
    this.online?.dispose(); this.online = null;
    this.play?.dispose(); this.play = null;
    try { this.descent?.dispose(); } catch (e) { console.warn(e); } this.descent = null;
    this.retroTelAt = null;
    this.dHud?.dispose(); this.dHud = null; this.gHud?.dispose(); this.gHud = null;
    if (this.surface) { this.viewport.scene.remove(this.surface.group); this.surface.dispose(); this.surface = null; }
    this.resetScene();
    this.viewport.camera.fov = 28; this.viewport.camera.updateProjectionMatrix();
  }

  private async returnToOrbit() {
    if (this.phase !== 'gameplay' && this.phase !== 'entering' && this.phase !== 'deploying' && this.phase !== 'descent') return;
    this.phase = 'loading';
    this.cutFlash = 0; this.loadMode = null;
    this.fade.classList.add('on'); await new Promise((r) => setTimeout(r, 750));
    const kind = this.spec.kind, seed = this.spec.seed;
    this.stage?.dispose(); this.stage = null;
    this.teardownSession();
    this.mountStage(this.makeSpec(kind, seed));
    this.menu.select(kind, false);
    this.menu.show();
    this.sessionSearch = stripColonyIdFromSearch(this.sessionSearch);
    if (this.useOnlineGameplay && !this.isLocalHost) void this.menu.probeActiveColony();
    this.syncOrbitUrl();
    this.schedulePrepare(200);
    this.fade.classList.remove('on');
    this.phase = 'menu';
  }

  // ------------------------------------------------------------------ loop
  private loop = (now = performance.now()) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = this.pacer.next(now);
    if (dt === null) return;
    try { this.tick(dt, false, now); this.viewport.render(); } catch (e) { console.error('frame error', e); }
  };

  private tick(dt: number, forceReady = false, now?: number) {
    this.time += dt;
    const vp = this.viewport;
    if (this.phase === 'menu' && this.stage) {
      stepMenuStageFrame({ stage: this.stage, menu: this.menu, dt, time: this.time, prewarmQueue: this.prewarmQueue, prestige: this.prestige.orbit });
    } else if (this.phase === 'entering' && this.stage) {
      const step = stepReturningColonyEntry({ stage: this.stage, online: this.online, dt, time: this.time, holdElapsed: this.entryHoldElapsed });
      this.entryHoldElapsed = step.nextHoldElapsed;
      if (step.done) this.finishColonyEntry(false);
    } else if (this.phase === 'deploying') {
      this.spec = stepDeployingStageFrame({
        dt, time: this.time, online: this.online, descent: this.descent, stage: this.stage, dHud: this.dHud, currentSpec: this.spec,
      });
      if (this.stage && this.stage.deployProgress() >= 1 && (this.deploySession?.ready || forceReady)) this.cutToDescent();
    } else if (this.phase === 'descent') {
      this.descent?.update(dt); this.surface?.update(dt, this.time);
      if (this.cutFlash > 0) { vp.bloom.strength += 0.55 * this.cutFlash * this.cutFlash; this.cutFlash = Math.max(0, this.cutFlash - dt / 0.5); }
    } else if (this.phase === 'gameplay' && this.online) {
      if (this.cutFlash > 0) this.cutFlash = stepEntryBloomFlash(vp, this.baseBloom, this.cutFlash, dt);
      this.syncOnlineRetroHud();
    } else if (this.phase === 'gameplay' && !this.online) {
      this.play?.update(dt);
      this.surface?.update(dt, this.time);
      if (this.play) vp.followShadow(this.play.cam.target);
    }
    this.online?.stepFrame(dt, now);
  }

  private syncOnlineRetroHud() {
    if (!this.dHud || !this.online) return;
    const retire = stepOnlineRetroHud({ dHud: this.dHud, online: this.online, retroTelAt: this.retroTelAt, skipOnlineLanding: this.skipOnlineLanding });
    if (retire) {
      const dh = this.dHud; this.dHud = null; this.retroTelAt = null;
      dh.hide();
      window.setTimeout(() => dh.dispose(), 850);
    }
  }

  /** QA: deterministically advance the whole state machine by `seconds` in 1/30 s steps (headless frame capture). */
  qaAdvance(seconds: number) { for (let i = 0; i < Math.round(seconds * 30); i++) this.tick(1 / 30, true); }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.offFpsCap();
    window.removeEventListener('keydown', this.escListener);
    clearTimeout(this.prepTimer); this.prepSeq++; this.discardPrepared();
    this.teardownSession(); this.stage?.dispose(); this.menu.dispose(); this.fade.remove();
    flushDeferredDispose();
    getSharedTerrainPrep().unloadLanded(true);
    this.viewport.dispose();
  }
  /** QA */
  get debug() { return { phase: this.phase, play: this.play, online: this.online, surface: this.surface, descent: this.descent, stage: this.stage, skip: () => this.skipDescent() }; }
}
