import * as THREE from 'three';
import { createColonyViewport, type ColonyViewport } from '@terra/render/core/createColonyViewport';
import { getPresetDimensions, getViewportPreset, isShaderOptimized, setShaderOptimized, setViewportPreset } from '@terra/render/core/perfConfig';
import { PLANET_KINDS, PLANET_SPECS, type PlanetKind, type PlanetSpec } from '@terra/render/planets/PlanetSpec';
import type { PlanetSurface } from '@terra/render/planets/surface/types';
import type { OrbitalStage } from '@terra/render/orbit/types';
import type { DescentSequence } from '@terra/render/descent/types';
import { createPlanetSurface } from '@terra/render/planets/surface';
import { createOrbitalStage } from '@terra/render/orbit/OrbitalStage';
import { applyPlanetLook } from '@terra/render/planets/applyPlanetLook';
import { createDescentSequence } from '../descent/createDescent';
import { warmupScene } from './warmup';
import { Gameplay } from './Gameplay';
import { resetDeviceSecret } from './online/bootOnline';
import { clearPendingJoinIntent } from './online/joinQueueFlow';
import { OnlineSession } from './online/OnlineSession';
import { writeStoredPlanetKind } from './online/viewportHelper';
import { track } from '../core/analytics';
import { MainMenu, type MenuSettings, type SectorIntentV1 } from '../ui/menu';
import { normalizeSectorIntent } from '../ui/lobby/orbitalPickerModel';
import { DescentHud, GameHud } from '../ui/hud';
import { HudRoot } from '../core/hud/HudRoot';
import { loadFeatures } from '../core/registry';
import { mountDevConsole } from '../dev/console';
import { notConnectedSend } from '../net/commandBus';
import { httpDevServer } from '../net/devServer';
import '../net/services';
import { createClientFlagsStore, type ClientFlagsStore } from '../core/flags';
import '@terra/render/kitbash';
import '../../design/css/tokens.css';
import '../../design/css/base.css';
import '../ui/ui.css';

type Phase = 'menu' | 'loading' | 'deploying' | 'descent' | 'gameplay';

/** A descent session built ahead of time (while the menu idles) so DEPLOY never shows a loading gap. */
interface Prepared {
  key: string; spec: PlanetSpec; surface: PlanetSurface; descent: DescentSequence;
  ready: boolean; whenReady: Promise<void>;
}

export class Game {
  readonly viewport: ColonyViewport;
  private root: HTMLElement;
  private featureHud: HudRoot | null = null;
  private devConsole: { dispose(): void } | null = null;
  private flagsStore: ClientFlagsStore | null = null;
  private offFlags: (() => void) | null = null;
  private fade = document.createElement('div');
  private phase: Phase = 'menu';
  private menu!: MainMenu;
  private stage: OrbitalStage | null = null;
  private settings: MenuSettings = { bloom: true, quality: 'high', skipCinematic: false, optimized: isShaderOptimized(), resolution: getViewportPreset() };
  private sectorIntent: SectorIntentV1 = { mode: 'auto' };
  private baseChildren = new Set<THREE.Object3D>();
  // per-session
  private spec!: PlanetSpec; private surface: PlanetSurface | null = null;
  private descent: DescentSequence | null = null; private dHud: DescentHud | null = null;
  private gHud: GameHud | null = null; private play: Gameplay | null = null;
  private online: OnlineSession | null = null;
  private skipOnlineLanding = false;
  private useOnlineGameplay = true;
  private fastForward = 0; private time = 0; private last = performance.now(); private raf = 0;
  private escListener = (e: KeyboardEvent) => this.onKey(e);
  private prepared: Prepared | null = null; private prepTimer = 0;
  private deploySession: Prepared | null = null;
  private cutFlash = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.viewport = createColonyViewport(root);
    this.viewport.scene.children.forEach((c) => this.baseChildren.add(c));
    this.fade.className = 'fade'; document.body.appendChild(this.fade);
    window.addEventListener('keydown', this.escListener);
    const q = new URLSearchParams(location.search);
    const kind = (PLANET_KINDS.includes(q.get('planet') as PlanetKind) ? q.get('planet') : 'dune') as PlanetKind;
    writeStoredPlanetKind(kind);
    if (q.has('menutime')) this.time = parseFloat(q.get('menutime')!) || 0;
    const seed = q.get('seed') ? parseInt(q.get('seed')!, 10) : undefined;
    this.sectorIntent = normalizeSectorIntent(q.get('sector'));
    const store = this.flagsStore ??= createClientFlagsStore();
    const isLegacyQa = q.has('autodeploy') || q.has('qat') || q.has('t') || (q.has('seed') && q.get('skip') === '1');
    this.useOnlineGameplay = store.set.has('W01') && !isLegacyQa;

    this.menu = new MainMenu(document.body, {
      onPlanet: (k) => {
        writeStoredPlanetKind(k);
        this.stage?.setPlanet(this.makeSpec(k, PLANET_SPECS[k].seed));
        this.syncOrbitUrl();
        this.schedulePrepare();
      },
      onSeed: () => this.schedulePrepare(),
      onSector: (intent) => { this.sectorIntent = intent; },
      onDeploy: (k, s, st, intent) => { this.settings = st; this.sectorIntent = intent; this.deploy(k, s); },
      onSettings: (st) => { this.settings = st; this.applySettings(); this.schedulePrepare(); },
    }, kind, seed, { sectorIntent: this.sectorIntent });
    this.settings = this.menu.settings;
    this.mountStage(this.makeSpec(kind, this.menu.seed));
    this.applySettings();
    this.loop();
    if (q.has('planet') && (q.get('skip') === '1' || q.has('t') || q.get('deploy') === '1')) {
      this.settings.skipCinematic = q.get('skip') === '1';
      this.fastForward = Math.max(0, parseFloat(q.get('t') ?? '0') || 0);
      setTimeout(() => this.deploy(kind, this.menu.seed, true), 50);
    } else {
      this.syncOrbitUrl();
      this.schedulePrepare(900);
      if (q.has('autodeploy')) setTimeout(() => {
        this.deploy(this.menu.kind, this.menu.seed);
        if (q.has('qat')) this.qaAdvance(parseFloat(q.get('qat')!) || 0);
      }, parseInt(q.get('autodeploy')!, 10) || 1500);
    }
  }

  /** Keeps `?planet=<kind>` in the URL while the orbital planet selector is open so F5 refreshes back to orbit. */
  private syncOrbitUrl() {
    if (typeof history === 'undefined' || typeof location === 'undefined') return;
    const q = new URLSearchParams(location.search);
    q.set('planet', this.menu.kind);
    q.delete('skip');
    q.delete('deploy');
    q.delete('t');
    history.replaceState(null, '', `${location.pathname}?${q.toString()}`);
  }

  private makeSpec(kind: PlanetKind, seed: number): PlanetSpec { return { ...PLANET_SPECS[kind], seed }; }

  private applySettings() {
    setShaderOptimized(this.settings.optimized);
    setViewportPreset(this.settings.resolution);
    this.viewport.bloom.enabled = this.settings.bloom;
    const dpr = this.settings.quality === 'low' ? 1 : Math.min(window.devicePixelRatio, 2);
    this.viewport.setResolution(getPresetDimensions(this.settings.resolution), dpr);
  }

  private mountStage(spec: PlanetSpec) {
    this.stage = createOrbitalStage(this.viewport, spec);
    this.viewport.setView(this.stage.scene, this.stage.camera);
  }

  private resetScene() {
    const sc = this.viewport.scene;
    for (const c of [...sc.children]) if (!this.baseChildren.has(c)) sc.remove(c);
    sc.background = new THREE.Color(0xb9dcef);
  }

  // ------------------------------------------------------------------ session pre-build (no loading gap on DEPLOY)
  private withMenuGlobals<T>(fn: () => T): T {
    const vp = this.viewport, exp = vp.renderer.toneMappingExposure, bloom = vp.bloom.strength;
    try { return fn(); } finally { vp.renderer.toneMappingExposure = exp; vp.bloom.strength = bloom; }
  }

  private schedulePrepare(delay = 1400) {
    clearTimeout(this.prepTimer);
    this.prepTimer = window.setTimeout(() => {
      if (this.phase !== 'menu') return;
      try { this.prepare(this.menu.kind, this.menu.seed); } catch (e) { console.warn('prepare failed', e); }
    }, delay);
  }

  /** Builds surface + descent into viewport.scene (not rendered while the menu shows) and pre-compiles every shader. */
  private prepare(kind: PlanetKind, seed: number): Prepared {
    const key = `${kind}:${seed}:${this.settings.quality}`;
    if (this.prepared?.key === key) return this.prepared;
    this.discardPrepared();
    const vp = this.viewport, scene = vp.scene, camera = vp.camera;
    const p = this.withMenuGlobals(() => {
      this.resetScene();
      camera.fov = 28; camera.updateProjectionMatrix();
      const spec = this.makeSpec(kind, seed);
      vp.applySky(spec);
      const surface = createPlanetSurface(spec, { quality: this.settings.quality });
      scene.add(surface.group);
      this.callLook(spec);
      const descent = createDescentSequence({ viewport: vp, scene, camera, spec, surface, startAt: 9 });
      const prep: Prepared = { key, spec, surface, descent, ready: false, whenReady: Promise.resolve() };
      return prep;
    });
    p.whenReady = warmupScene(vp, () => this.prepared !== p && this.deploySession !== p).then(() => { p.ready = true; });
    this.prepared = p;
    return p;
  }

  private discardPrepared() {
    const p = this.prepared; this.prepared = null;
    if (!p) return;
    this.withMenuGlobals(() => {
      try { p.descent.dispose(); } catch (e) { console.warn(e); }
      this.viewport.scene.remove(p.surface.group); p.surface.dispose();
      this.resetScene();
    });
  }

  // ------------------------------------------------------------------ deploy
  private deploy(kind: PlanetKind, seed: number, instant = false) {
    if (this.phase !== 'menu') return;
    clearTimeout(this.prepTimer);
    writeStoredPlanetKind(kind);
    let p: Prepared;
    try { p = this.prepare(kind, seed); }
    catch (err) {
      console.error('deploy failed', err);
      this.discardPrepared();
      this.menu.setError('Deploy failed: ' + (err as Error).message);
      return;
    }
    this.prepared = null; this.deploySession = p;
    this.spec = p.spec; this.surface = p.surface; this.descent = p.descent;
    this.skipOnlineLanding = false;
    if (this.useOnlineGameplay) {
      // Every explicit DEPLOY from the orbital planet selector starts a fresh guest on the selected planet family
      // (`dune` -> desert, `oceanForest` -> ocean, `forestRock` -> temperate), ignoring any stale refresh cookie.
      resetDeviceSecret();
      if (typeof localStorage !== 'undefined') clearPendingJoinIntent(localStorage);
      if (!this.settings.skipCinematic) {
        this.online = new OnlineSession(this.root, 'boot', {
          viewport: this.viewport,
          planetKind: this.spec.kind,
          sectorIntent: this.sectorIntent,
          skipDescent: false,
          fromSpaceDescent: true,
          tryRefresh: false,
          search: '',
          onReturnToOrbit: () => { void this.returnToOrbit(); },
        });
        (window as unknown as { __online?: OnlineSession }).__online = this.online;
      }
    }
    this.dHud = new DescentHud(document.body);
    if (!this.useOnlineGameplay) {
      this.gHud = new GameHud(document.body, this.spec.name, this.spec.seed, { onResume: () => this.setPaused(false), onReturn: () => this.returnToOrbit() });
    }
    this.descent.onTelemetry((t) => {
      this.dHud?.update(t);
      if (!this.useOnlineGameplay) return;
      if (t.phase === 'retro' || t.phase === 'touchdown') {
        this.handoffDescent(false);
      } else if (this.online?.setSpacePhase(t.phase, this.surface?.group.visible ?? false) && this.surface) {
        this.surface.group.visible = false;
      }
    });
    this.descent.onComplete((hero) => this.startGameplay(hero));
    this.dHud.update(this.descent.handoff.tel);

    if (instant || !this.stage || this.settings.skipCinematic) {
      this.menu.hide();
      this.cutToDescent(false);
      this.dHud.show();
      if (this.settings.skipCinematic) this.skipDescent();
      else if (this.fastForward > 0) {
        const steps = Math.floor(Math.max(0, this.fastForward - this.descent.handoff.startAt) * 30);
        for (let i = 0; i < steps && (this.phase as Phase) === 'descent'; i++) this.descent!.update(1 / 30);
      }
      return;
    }
    this.phase = 'deploying';
    this.menu.hide();
    window.setTimeout(() => this.dHud?.show(), 450);
    const align = this.stage.beginDeploy(this.descent.handoff, { biomeKey: this.spec.biomeKey });
    this.descent.alignGlobe(align.spinQuat, align.cloudRotY);
  }

  private cutToDescent(flash = true) {
    if (!this.descent) return;
    const vp = this.viewport;
    const st = this.stage; this.stage = null;
    vp.setView(vp.scene, vp.camera);
    this.descent.start();
    this.phase = 'descent';
    this.deploySession = null;
    this.cutFlash = flash ? 1 : 0;
    if (st) window.setTimeout(() => st.dispose(), 0);
  }

  private callLook(spec: PlanetSpec = this.spec) {
    const vp = this.viewport;
    try { applyPlanetLook(vp, spec); } catch (e) { console.warn('applyPlanetLook failed', e); }
  }

  private handoffDescent(skipToColony: boolean) {
    if (!this.descent || this.phase !== 'descent') return;
    this.skipOnlineLanding = skipToColony;
    this.descent.skip();
    if (this.phase === 'descent') this.descent.update(0);
  }

  private skipDescent() {
    this.handoffDescent(true);
  }

  private startGameplay(hero: THREE.Object3D) {
    if (this.phase === 'gameplay' || !this.surface || !this.descent) return;
    this.phase = 'gameplay';
    this.dHud?.hide();
    const d = this.descent; this.descent = null;
    const dh = this.dHud; this.dHud = null;

    if (this.useOnlineGameplay) {
      hero.removeFromParent();
      try { d.dispose(); } catch (e) { console.warn(e); }
      dh?.dispose();
      if (this.surface) {
        this.viewport.scene.remove(this.surface.group);
        this.surface.dispose();
        this.surface = null;
      }
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
        this.online = new OnlineSession(this.root, 'boot', {
          viewport: this.viewport,
          planetKind: this.spec.kind,
          sectorIntent: this.sectorIntent,
          skipDescent: true,
          fromSpaceDescent: false,
          tryRefresh: false,
          search: '',
          onReturnToOrbit: () => { void this.returnToOrbit(); },
        });
        (window as unknown as { __online?: OnlineSession }).__online = this.online;
      }
      return;
    }

    const pose = d.finalPose;
    this.viewport.camera.fov = 28; this.viewport.camera.updateProjectionMatrix();
    this.play = new Gameplay(this.viewport.scene, this.viewport.camera, this.viewport.renderer.domElement, this.surface, this.spec, hero, this.gHud!, { position: pose.position.clone(), target: pose.target.clone() });
    this.gHud!.show();
    this.mountFeatureHud();
    this.gHud!.setResources({ energy: 120, metal: 60, water: 40, bio: 10 });
    setTimeout(() => { try { d.dispose(); } catch (e) { console.warn(e); } dh?.dispose(); }, 900);
  }

  // ------------------------------------------------------------------ states
  private onKey(e: KeyboardEvent) {
    if (this.phase === 'deploying' && (e.key === 'Escape' || e.key === ' ')) { e.preventDefault(); this.cutToDescent(false); this.skipDescent(); }
    else if (this.phase === 'descent' && (e.key === 'Escape' || e.key === ' ')) { e.preventDefault(); this.skipDescent(); }
    else if (this.phase === 'gameplay' && !this.online && e.key === 'Escape') this.setPaused(!(this.gHud?.paused));
  }
  private setPaused(p: boolean) {
    if (this.online) { this.online.setPaused(p); return; }
    this.gHud?.setPaused(p);
    if (this.play) { this.play.paused = p; this.play.cam.enabled = !p; }
  }

  private mountFeatureHud() {
    const store = this.flagsStore ??= createClientFlagsStore();
    const mount = () => {
      this.featureHud?.dispose(); this.devConsole?.dispose();
      const { source } = store.current;
      const set = store.set;
      const ctx = { flags: set, host: 'server' as const, services: { track, flagsSource: source, sendCommand: notConnectedSend, devServer: httpDevServer() } };
      const features = loadFeatures({ flags: set, host: 'server' });
      this.featureHud = new HudRoot(document.body, features, ctx);
      this.devConsole = mountDevConsole({ parent: document.body, features, ctx });
    };
    this.offFlags?.(); this.offFlags = store.onChange(mount);
    mount();
  }

  private teardownSession() {
    this.offFlags?.(); this.offFlags = null;
    this.featureHud?.dispose(); this.featureHud = null;
    this.devConsole?.dispose(); this.devConsole = null;
    this.online?.dispose(); this.online = null;
    this.play?.dispose(); this.play = null;
    try { this.descent?.dispose(); } catch (e) { console.warn(e); } this.descent = null;
    this.dHud?.dispose(); this.dHud = null; this.gHud?.dispose(); this.gHud = null;
    if (this.surface) { this.viewport.scene.remove(this.surface.group); this.surface.dispose(); this.surface = null; }
    this.resetScene();
    this.viewport.camera.fov = 28; this.viewport.camera.updateProjectionMatrix();
  }

  private async returnToOrbit() {
    if (this.phase !== 'gameplay' && this.phase !== 'deploying' && this.phase !== 'descent') return;
    this.phase = 'loading';
    this.fade.classList.add('on'); await new Promise((r) => setTimeout(r, 750));
    const kind = this.spec.kind, seed = this.spec.seed;
    this.teardownSession();
    this.mountStage(this.makeSpec(kind, seed));
    this.menu.select(kind, false);
    this.menu.show();
    this.syncOrbitUrl();
    this.schedulePrepare(1200);
    this.fade.classList.remove('on');
    this.phase = 'menu';
  }

  // ------------------------------------------------------------------ loop
  private loop = () => {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.05); this.last = now;
    try { this.tick(dt); this.viewport.render(); } catch (e) { console.error('frame error', e); }
    this.raf = requestAnimationFrame(this.loop);
  };

  private tick(dt: number, forceReady = false) {
    this.time += dt;
    const vp = this.viewport;
    if (this.phase === 'menu') this.stage?.update(dt, this.time);
    else if (this.phase === 'deploying') {
      this.stage?.update(dt, this.time);
      if (this.stage && this.descent) {
        const tel = this.descent.handoff.telAt(this.stage.deployTn());
        this.dHud?.update(tel);
        this.online?.setSpacePhase(tel.phase === 'touchdown' ? 'retro' : tel.phase, false);
      }
      if (this.stage && this.stage.deployProgress() >= 1 && (this.deploySession?.ready || forceReady)) this.cutToDescent();
    } else if (this.phase === 'descent') {
      this.descent?.update(dt); this.surface?.update(dt, this.time);
      if (this.cutFlash > 0) { vp.bloom.strength += 0.55 * this.cutFlash * this.cutFlash; this.cutFlash = Math.max(0, this.cutFlash - dt / 0.5); }
    } else if (this.phase === 'gameplay' && !this.online) {
      this.play?.update(dt);
      this.surface?.update(dt, this.time);
      if (this.play) vp.followShadow(this.play.cam.target);
    }
  }

  /** QA: deterministically advance the whole state machine by `seconds` in 1/30 s steps (headless frame capture). */
  qaAdvance(seconds: number) { for (let i = 0; i < Math.round(seconds * 30); i++) this.tick(1 / 30, true); }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.escListener);
    clearTimeout(this.prepTimer); this.discardPrepared();
    this.teardownSession(); this.stage?.dispose(); this.menu.dispose(); this.fade.remove(); this.viewport.dispose();
  }
  /** QA */
  get debug() { return { phase: this.phase, play: this.play, online: this.online, surface: this.surface, descent: this.descent, stage: this.stage, skip: () => this.skipDescent() }; }
}
