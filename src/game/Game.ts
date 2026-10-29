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

type Phase = 'menu' | 'loading' | 'descent' | 'gameplay';

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
      onPlanet: (k) => this.stage?.setPlanet(this.makeSpec(k, PLANET_SPECS[k].seed)),
      onDeploy: (k, s, st) => { this.settings = st; this.deploy(k, s); },
      onSettings: (st) => { this.settings = st; this.applySettings(); },
    }, kind, seed);
    this.mountStage(this.makeSpec(kind, this.menu.seed));
    this.applySettings();
    this.loop();
    if (q.has('planet') && (q.get('skip') === '1' || q.has('t') || q.get('deploy') === '1')) {
      this.settings.skipCinematic = q.get('skip') === '1';
      this.fastForward = Math.max(0, parseFloat(q.get('t') ?? '0') || 0);
      setTimeout(() => this.deploy(kind, this.menu.seed, true), 50);
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

  // ------------------------------------------------------------------ deploy
  private async deploy(kind: PlanetKind, seed: number, instant = false) {
    if (this.phase !== 'menu') return;
    this.phase = 'loading';
    const missing = [!createPlanetSurface && 'createPlanetSurface', !createDescentSequence && 'createDescentSequence'].filter(Boolean);
    if (missing.length) { this.phase = 'menu'; this.menu.setError('Missing modules: ' + missing.join(', ')); return; }
    this.menu.hide();
    if (!instant) { this.fade.classList.add('on'); await new Promise((r) => setTimeout(r, 750)); }
    try {
      this.stage?.dispose(); this.stage = null;
      this.resetScene();
      const vp = this.viewport; const scene = vp.scene, camera = vp.camera;
      camera.fov = 28; camera.updateProjectionMatrix();
      this.spec = this.makeSpec(kind, seed);
      vp.applySky(this.spec);
      this.surface = createPlanetSurface!(this.spec, { quality: this.settings.quality });
      scene.add(this.surface.group);
      this.callLook();
      vp.setView(scene, camera);
      this.descent = createDescentSequence!({ viewport: vp, scene, camera, spec: this.spec, surface: this.surface });
      this.dHud = new DescentHud(document.body);
      this.gHud = new GameHud(document.body, this.spec.name, this.spec.seed, { onResume: () => this.setPaused(false), onReturn: () => this.returnToOrbit() });
      this.descent.onTelemetry((t) => this.dHud?.update(t));
      this.descent.onComplete((hero) => this.startGameplay(hero));
      this.descent.start();
      this.phase = 'descent';
      this.dHud.show();
      this.fade.classList.remove('on');
      if (this.settings.skipCinematic) this.skipDescent();
      else if (this.fastForward > 0) {
        const steps = Math.floor(this.fastForward * 30);
        for (let i = 0; i < steps && this.phase === 'descent'; i++) this.descent.update(1 / 30);
      }
    } catch (err) {
      console.error('deploy failed', err);
      this.teardownSession();
      this.mountStage(this.makeSpec(kind, seed));
      this.menu.show(); this.menu.setError('Deploy failed: ' + (err as Error).message);
      this.fade.classList.remove('on'); this.phase = 'menu';
    }
  }

  private callLook() {
    const vp = this.viewport;
    try { (applyPlanetLook as any)?.(vp, this.spec); } catch (e) { console.warn('applyPlanetLook failed', e); }
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
    if (this.phase === 'descent' && (e.key === 'Escape' || e.key === ' ')) { e.preventDefault(); this.skipDescent(); }
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
    history.replaceState(null, '', location.pathname);
    this.fade.classList.remove('on');
    this.phase = 'menu';
  }

  // ------------------------------------------------------------------ loop
  private loop = () => {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.05); this.last = now; this.time += dt;
    const vp = this.viewport;
    try {
      if (this.phase === 'menu') this.stage?.update(dt, this.time);
      else if (this.phase === 'descent') { this.descent?.update(dt); this.surface?.update(dt, this.time); }
      else if (this.phase === 'gameplay') {
        this.play?.update(dt);
        this.surface?.update(dt, this.time);
        if (this.play) vp.followShadow(this.play.cam.target);
      }
      vp.render();
    } catch (e) { console.error('frame error', e); }
    this.raf = requestAnimationFrame(this.loop);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.escListener);
    this.teardownSession(); this.stage?.dispose(); this.menu.dispose(); this.fade.remove(); this.viewport.dispose();
  }
  /** QA */
  get debug() { return { phase: this.phase, play: this.play, surface: this.surface, descent: this.descent, stage: this.stage, skip: () => this.skipDescent() }; }
}
