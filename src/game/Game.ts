import * as THREE from 'three';
import { createColonyViewport, type ColonyViewport } from '../core/createColonyViewport';
import { PLANET_KINDS, PLANET_SPECS, type PlanetKind, type PlanetSpec } from '../planets/PlanetSpec';
import type { PlanetSurface } from '../planets/surface/types';
import type { OrbitalStage } from '../orbit/types';
import type { DescentSequence } from '../descent/types';
import { createPlanetSurface, createOrbitalStage, createDescentSequence, applyPlanetLook } from './modules';
import { Gameplay } from './Gameplay';
import { MainMenu, type MenuSettings } from '../ui/menu';
import { DescentHud, GameHud } from '../ui/hud';
import '../kitbash';
import '../../frontend/design/css/tokens.css';
import '../../frontend/design/css/base.css';
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
  private fade = document.createElement('div');
  private phase: Phase = 'menu';
  private menu!: MainMenu;
  private stage: OrbitalStage | null = null;
  private settings: MenuSettings = { bloom: true, quality: 'high', skipCinematic: false };
  private baseChildren = new Set<THREE.Object3D>();
  // per-session
  private spec!: PlanetSpec; private surface: PlanetSurface | null = null;
  private descent: DescentSequence | null = null; private dHud: DescentHud | null = null;
  private gHud: GameHud | null = null; private play: Gameplay | null = null;
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
    if (q.has('menutime')) this.time = parseFloat(q.get('menutime')!) || 0; // QA: start the menu clock late to test long-run stability
    const seed = q.get('seed') ? parseInt(q.get('seed')!, 10) : undefined;
    this.menu = new MainMenu(document.body, {
      onPlanet: (k) => { this.stage?.setPlanet(this.makeSpec(k, PLANET_SPECS[k].seed)); this.schedulePrepare(); },
      onSeed: () => this.schedulePrepare(),
      onDeploy: (k, s, st) => { this.settings = st; this.deploy(k, s); },
      onSettings: (st) => { this.settings = st; this.applySettings(); this.schedulePrepare(); },
    }, kind, seed);
    this.mountStage(this.makeSpec(kind, this.menu.seed));
    this.applySettings();
    this.loop();
    if (q.has('planet') && (q.get('skip') === '1' || q.has('t') || q.get('deploy') === '1')) {
      this.settings.skipCinematic = q.get('skip') === '1';
      this.fastForward = Math.max(0, parseFloat(q.get('t') ?? '0') || 0);
      setTimeout(() => this.deploy(kind, this.menu.seed, true), 50);
    } else {
      this.schedulePrepare(900);
      // QA: ?autodeploy=<ms> clicks DEPLOY after that delay (cinematic path), for headless frame captures
      if (q.has('autodeploy')) setTimeout(() => {
        this.deploy(this.menu.kind, this.menu.seed);
        if (q.has('qat')) this.qaAdvance(parseFloat(q.get('qat')!) || 0); // ?qat=<s>: jump the deploy/descent clock
      }, parseInt(q.get('autodeploy')!, 10) || 1500);
    }
  }

  private makeSpec(kind: PlanetKind, seed: number): PlanetSpec { return { ...PLANET_SPECS[kind], seed }; }

  private applySettings() {
    this.viewport.bloom.enabled = this.settings.bloom;
    this.viewport.renderer.setPixelRatio(this.settings.quality === 'low' ? 1 : Math.min(window.devicePixelRatio, 2));
    this.viewport.resize();
  }

  private mountStage(spec: PlanetSpec) {
    if (!createOrbitalStage) { this.menu.setError('Orbital stage module not available yet'); return; }
    this.stage = createOrbitalStage(this.viewport, spec);
    this.viewport.setView(this.stage.scene, this.stage.camera);
  }

  private resetScene() {
    const sc = this.viewport.scene;
    for (const c of [...sc.children]) if (!this.baseChildren.has(c)) sc.remove(c);
    sc.background = new THREE.Color(0xb9dcef);
  }

  // ------------------------------------------------------------------ session pre-build (no loading gap on DEPLOY)
  /** Renderer-global values the menu stage owns; building a session must not disturb them. */
  private withMenuGlobals<T>(fn: () => T): T {
    const vp = this.viewport, exp = vp.renderer.toneMappingExposure, bloom = vp.bloom.strength;
    try { return fn(); } finally { vp.renderer.toneMappingExposure = exp; vp.bloom.strength = bloom; }
  }

  private schedulePrepare(delay = 1400) {
    clearTimeout(this.prepTimer);
    this.prepTimer = window.setTimeout(() => {
      if (this.phase !== 'menu' || !createPlanetSurface || !createDescentSequence) return;
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
      const surface = createPlanetSurface!(spec, { quality: this.settings.quality });
      scene.add(surface.group);
      this.callLook(spec);
      const descent = createDescentSequence!({ viewport: vp, scene, camera, spec, surface, startAt: 9 });
      const prep: Prepared = { key, spec, surface, descent, ready: false, whenReady: Promise.resolve() };
      return prep;
    });
    p.whenReady = this.warmup(p).then(() => { p.ready = true; });
    this.prepared = p;
    return p;
  }

  /**
   * Compile every program the descent will ever use (objects that only appear mid-dive are force-shown) against an
   * off-screen target — the same tone-mapping/colour-space variant the composer uses — then draw once so geometry and
   * textures are uploaded. Removes every mid-descent shader-compile hitch, not just the first-frame one.
   */
  private async warmup(p: Prepared) {
    const vp = this.viewport, r = vp.renderer, scene = vp.scene, camera = vp.camera;
    const reveal = () => {
      const hidden: THREE.Object3D[] = [], culled: THREE.Object3D[] = [];
      scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } });
      return () => { hidden.forEach((o) => (o.visible = false)); culled.forEach((o) => (o.frustumCulled = true)); };
    };
    const rt = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType });
    const prev = r.getRenderTarget();
    let restore = reveal();
    let pending: Promise<unknown>;
    try { r.setRenderTarget(rt); pending = r.compileAsync(scene, camera); } finally { r.setRenderTarget(prev); restore(); }
    try { await pending; } catch (e) { console.warn('compileAsync', e); }
    await new Promise((res) => requestAnimationFrame(res));
    if (this.prepared !== p && this.deploySession !== p) { rt.dispose(); return; }
    restore = reveal();
    try { r.setRenderTarget(rt); r.render(scene, camera); } finally { r.setRenderTarget(prev); restore(); rt.dispose(); }
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
    const missing = [!createPlanetSurface && 'createPlanetSurface', !createDescentSequence && 'createDescentSequence'].filter(Boolean);
    if (missing.length) { this.menu.setError('Missing modules: ' + missing.join(', ')); return; }
    clearTimeout(this.prepTimer);
    let p: Prepared;
    try { p = this.prepare(kind, seed); }
    catch (err) {
      console.error('deploy failed', err);
      this.discardPrepared();
      this.menu.setError('Deploy failed: ' + (err as Error).message);
      return;
    }
    // the prepared session becomes the live one
    this.prepared = null; this.deploySession = p;
    this.spec = p.spec; this.surface = p.surface; this.descent = p.descent;
    this.dHud = new DescentHud(document.body);
    this.gHud = new GameHud(document.body, this.spec.name, this.spec.seed, { onResume: () => this.setPaused(false), onReturn: () => this.returnToOrbit() });
    this.descent.onTelemetry((t) => this.dHud?.update(t));
    this.descent.onComplete((hero) => this.startGameplay(hero));
    this.dHud.update(this.descent.handoff.tel);

    if (instant || !this.stage || this.settings.skipCinematic) {
      this.menu.hide();
      this.cutToDescent(false);
      this.dHud.show();
      if (this.settings.skipCinematic) this.skipDescent();
      else if (this.fastForward > 0) {
        const steps = Math.floor(Math.max(0, this.fastForward - this.descent.handoff.startAt) * 30); // ?t= is the authored second
        for (let i = 0; i < steps && (this.phase as Phase) === 'descent'; i++) this.descent!.update(1 / 30);
      }
      return;
    }
    // cinematic hand-off: UI tweens away, the orbital camera dollies into the carrier while the pod lowers into the
    // bay; the cut to the descent happens on an identical carrier-local frame once the dolly lands and shaders are warm.
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
    try { (applyPlanetLook as any)?.(vp, spec); } catch (e) { console.warn('applyPlanetLook failed', e); }
  }

  private skipDescent() {
    if (!this.descent || this.phase !== 'descent') return;
    this.descent.skip();
    if (this.phase === 'descent') this.descent.update(0);
  }

  private startGameplay(hero: THREE.Object3D) {
    if (this.phase === 'gameplay' || !this.surface || !this.descent) return;
    this.phase = 'gameplay';
    this.dHud?.hide();
    const pose = this.descent.finalPose;
    this.viewport.camera.fov = 28; this.viewport.camera.updateProjectionMatrix();
    this.play = new Gameplay(this.viewport.scene, this.viewport.camera, this.viewport.renderer.domElement, this.surface, this.spec, hero, this.gHud!, { position: pose.position.clone(), target: pose.target.clone() });
    this.gHud!.show();
    this.gHud!.setResources({ energy: 120, metal: 60, water: 40, bio: 10 });
    const d = this.descent; this.descent = null;
    setTimeout(() => { try { d.dispose(); } catch (e) { console.warn(e); } this.dHud?.dispose(); this.dHud = null; }, 900);
  }

  // ------------------------------------------------------------------ states
  private onKey(e: KeyboardEvent) {
    if (this.phase === 'deploying' && (e.key === 'Escape' || e.key === ' ')) { e.preventDefault(); this.cutToDescent(false); this.skipDescent(); }
    else if (this.phase === 'descent' && (e.key === 'Escape' || e.key === ' ')) { e.preventDefault(); this.skipDescent(); }
    else if (this.phase === 'gameplay' && e.key === 'Escape') this.setPaused(!(this.gHud?.paused));
  }
  private setPaused(p: boolean) { this.gHud?.setPaused(p); if (this.play) { this.play.paused = p; this.play.cam.enabled = !p; } }

  private teardownSession() {
    this.play?.dispose(); this.play = null;
    try { this.descent?.dispose(); } catch (e) { console.warn(e); } this.descent = null;
    this.dHud?.dispose(); this.dHud = null; this.gHud?.dispose(); this.gHud = null;
    if (this.surface) { this.viewport.scene.remove(this.surface.group); this.surface.dispose(); this.surface = null; }
    this.resetScene();
    this.viewport.camera.fov = 28; this.viewport.camera.updateProjectionMatrix();
  }

  private async returnToOrbit() {
    if (this.phase !== 'gameplay') return;
    this.phase = 'loading';
    this.fade.classList.add('on'); await new Promise((r) => setTimeout(r, 750));
    const kind = this.spec.kind, seed = this.spec.seed;
    this.teardownSession();
    this.mountStage(this.makeSpec(kind, seed));
    this.menu.show();
    this.schedulePrepare(1200);
    history.replaceState(null, '', location.pathname);
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
      if (this.stage && this.descent) this.dHud?.update(this.descent.handoff.telAt(this.stage.deployTn()));
      if (this.stage && this.stage.deployProgress() >= 1 && (this.deploySession?.ready || forceReady)) this.cutToDescent();
    } else if (this.phase === 'descent') {
      this.descent?.update(dt); this.surface?.update(dt, this.time);
      if (this.cutFlash > 0) { vp.bloom.strength += 0.55 * this.cutFlash * this.cutFlash; this.cutFlash = Math.max(0, this.cutFlash - dt / 0.5); }
    } else if (this.phase === 'gameplay') {
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
  get debug() { return { phase: this.phase, play: this.play, surface: this.surface, descent: this.descent, stage: this.stage, skip: () => this.skipDescent() }; }
}
