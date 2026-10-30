import * as THREE from 'three';
import { createColonyViewport, type ColonyViewport } from '@shared/engine/core/createColonyViewport';
import { PLANET_SPECS, type PlanetKind } from '@shared/engine/planets/PlanetSpec';
import { ArchetypeCatalog, type ArchetypeCategory } from '@shared/engine/kitbash';
import { validateArchetype } from '@shared/engine/kitbash/validate';
import { $ } from './dom';
import { createState, syncURL, type PgState, type ToggleKey, type View } from './state';
import { StageRig } from './stage/StageRig';
import { SpawnSet } from './content/SpawnSet';
import { SurfaceHost } from './content/SurfaceHost';
import { ValidationOverlay } from './content/Validation';
import { CameraRig, type ViewOpts } from './camera/CameraRig';
import { bindPicking } from './camera/Picking';
import { Sidebar } from './panels/Sidebar';
import { Toolbar } from './panels/Toolbar';
import { toast } from './panels/Toast';
import { updateInfo } from './panels/InfoPanel';
import { validationHtml } from './panels/validationHtml';
import { bindKeys } from './keyboard';
import { contactSheet, screenshot } from './capture';

/** Orchestrates the 3D model storybook: owns the state, wires panels, scene parts and camera together. */
export class PlaygroundApp {
  readonly state: PgState;
  private viewport: ColonyViewport;
  private rig: StageRig;
  private spawns = new SpawnSet();
  private surface: SurfaceHost;
  private validation = new ValidationOverlay();
  private cam: CameraRig;
  private sidebar: Sidebar;
  private toolbar: Toolbar;
  private hasFramedOnce = false;
  private clock = new THREE.Clock();
  private time = 0;

  constructor(private params: URLSearchParams) {
    this.state = createState(params);
    const vp = this.viewport = createColonyViewport($('#viewport'));
    this.surface = new SurfaceHost(vp.scene);
    this.rig = new StageRig(() => this.spawns.minX());
    this.cam = new CameraRig(vp.camera, vp.renderer.domElement, () => this.bounds(), () => !!this.state.row);
    vp.scene.add(this.rig.group, this.spawns.content, this.spawns.ring);
    this.sidebar = new Sidebar(this.state, { onSelect: (id) => this.select(id), onRow: (c) => this.toggleRow(c) });
    this.toolbar = new Toolbar(this.state, {
      onView: (v) => this.setView(v),
      onPlanet: (k) => { this.state.kind = k; this.applyPlanet(); syncURL(this.state); },
      onToggle: (k) => this.toggle(k),
      onShot: () => { screenshot(vp, this.cam, this.state); toast('Screenshot saved'); },
      onSheet: () => this.contactSheet(),
    });
    bindPicking(vp.renderer.domElement, vp.camera, {
      spawns: () => this.spawns.spawns, isRow: () => !!this.state.row, selectedId: () => this.state.id,
      select: (id) => this.select(id, { rebuild: false, frame: false }),
      focus: (target, radius) => this.setView(this.state.view, { target, radius }),
      ground: () => this.rig.top,
    });
    bindKeys({ cycle: (d) => this.cycle(d), view: (v) => this.setView(v), toggle: (k) => this.toggle(k), focus: () => this.focusSelected() });
  }

  start() {
    const { state, params } = this;
    this.sidebar.build();
    this.toolbar.build();
    const initial = params.get('inspect');
    state.id = initial && ArchetypeCatalog.has(initial) ? initial : (state.row ? ArchetypeCatalog.list(state.row)[0]?.id : ArchetypeCatalog.list()[0]?.id) ?? '';
    if (initial && !ArchetypeCatalog.has(initial)) toast(`Unknown archetype "${initial}"`);
    this.applyPlanet();
    if (state.id) this.select(state.id, { rebuild: false, frame: true }); else this.setView(state.view, { instant: true });
    this.sidebar.render();
    this.toolbar.syncToggles();
    this.setView(state.view, { instant: true });
    this.frame();
  }

  /** QA hooks (`window.__pg`). */
  get debug() {
    const vp = this.viewport;
    return {
      state: this.state, select: (id: string) => this.select(id), validate: (id = this.state.id) => validateArchetype(id), setView: (v: View) => this.setView(v),
      setPlanet: (k: PlanetKind) => { this.state.kind = k; this.applyPlanet(); }, toggle: (k: ToggleKey) => this.toggle(k), contactSheet: () => this.contactSheet(),
      viewport: vp, camera: vp.camera, controls: this.cam.controls, spawns: () => this.spawns.spawns,
    };
  }

  private bounds() { return this.spawns.bounds(this.state.id, this.state.row); }

  // ---------------------------------------------------------------- planet / content
  private applyPlanet() {
    const { state } = this;
    this.viewport.applySky(PLANET_SPECS[state.kind]);
    this.buildStage();
    this.rebuildContent();
    this.syncSurface();
    this.toolbar.setPlanet(state.kind);
  }

  private buildStage() { this.rig.build(this.state.kind, this.state); }

  private syncSurface() {
    if (this.surface.sync(this.state.kind, this.state.surface)) this.rig.hidePedestal();
  }

  private rebuildContent() {
    const { state, spawns } = this;
    spawns.rebuild(spawns.idsFor(state.row, state.id), PLANET_SPECS[state.kind].biomeKey, state.wire);
    spawns.updateRing(state.id, state.row);
    this.rig.placeHuman();
    this.applyValidation();
  }

  private applyValidation() {
    this.validation.apply(this.validation.report(this.state.id, this.state.validate), this.spawns.find(this.state.id));
  }

  private refreshInfo() {
    const { state } = this;
    updateInfo(state.id, state.row ? this.spawns.spawns.length : 1, validationHtml(this.validation.report(state.id, state.validate), state.id));
  }

  // ---------------------------------------------------------------- selection / view
  private select(id: string, opts: { rebuild?: boolean; frame?: boolean } = {}) {
    const { state } = this;
    const { rebuild = !state.row, frame = true } = opts;
    if (!ArchetypeCatalog.has(id)) { toast(`Unknown archetype: ${id}`); return; }
    state.id = id;
    if (state.row && ArchetypeCatalog.get(id).category !== state.row) state.row = ArchetypeCatalog.get(id).category;
    if (rebuild) this.rebuildContent();
    this.spawns.updateRing(state.id, state.row);
    this.refreshInfo();
    this.sidebar.mark();
    if (frame) this.setView(state.view, { instant: !this.hasFramedOnce });
    this.hasFramedOnce = true;
    syncURL(state);
  }

  private setView(view: View, opts: ViewOpts = {}) {
    this.state.view = view;
    this.toolbar.setView(view);
    this.cam.setView(view, opts);
    syncURL(this.state);
  }

  private focusSelected() { this.setView(this.state.view, { target: this.bounds().getCenter(new THREE.Vector3()) }); }

  private cycle(d: number) {
    const ids = this.sidebar.visibleIds(); if (!ids.length) return;
    const i = ids.indexOf(this.state.id);
    this.select(ids[(i + d + ids.length) % ids.length]);
  }

  private toggleRow(cat?: ArchetypeCategory) {
    const { state } = this;
    const c = cat ?? (state.id ? ArchetypeCatalog.get(state.id).category : null);
    state.row = state.row === c || !c ? null : c;
    if (state.row && (!state.id || ArchetypeCatalog.get(state.id).category !== state.row)) state.id = ArchetypeCatalog.list(state.row)[0]?.id ?? state.id;
    this.rebuildContent(); this.refreshInfo(); this.sidebar.render(); this.toolbar.clearBar();
    this.toolbar.syncToggles();
    this.setView(state.view);
    syncURL(state);
  }

  // ---------------------------------------------------------------- toggles
  private toggle(k: ToggleKey) {
    const { state, viewport: vp } = this;
    if (k === 'row') { this.toggleRow(); return; }
    state[k] = !state[k];
    switch (k) {
      case 'bloom': vp.bloom.enabled = state.bloom; break;
      case 'wire': this.spawns.applyWire(state.wire); break;
      case 'grid': this.rig.grid.visible = state.grid; break;
      case 'ruler': this.rig.ruler.visible = state.ruler; break;
      case 'human': this.rig.human.visible = state.human; break;
      case 'shadows': this.applyShadows(); break;
      case 'hex': { this.buildStage(); if (state.surface) this.syncSurface(); break; }
      case 'surface': this.syncSurface(); break;
      case 'validate': this.applyValidation(); this.refreshInfo(); break;
    }
    this.toolbar.syncToggles(); syncURL(state);
  }

  private applyShadows() {
    const vp = this.viewport, on = this.state.shadows;
    vp.sun.castShadow = on; vp.renderer.shadowMap.enabled = on;
    vp.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
  }

  private contactSheet(): string {
    const url = contactSheet(this.viewport, this.cam, this.state, this.bounds());
    toast('4-view contact sheet saved');
    return url;
  }

  // ---------------------------------------------------------------- loop
  private frame = () => {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    this.cam.step(dt);
    this.spawns.tick(this.time, dt, this.state.turntable, !!this.state.row);
    this.cam.controls.update();
    this.surface.update(dt, this.time);
    this.viewport.followShadow(this.cam.controls.target);
    this.viewport.render();
    requestAnimationFrame(this.frame);
  };
}
