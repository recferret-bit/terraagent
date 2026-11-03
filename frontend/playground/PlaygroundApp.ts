import * as THREE from 'three';
import { createColonyViewport, type ColonyViewport } from '@terra/render/core/createColonyViewport';
import { setDayNightExternalSync } from '@terra/render/core/dayNightConfig';
import { onPixelArtChange, setPixelArt } from '@terra/render/core/pixelArtPass';
import { onShadowChange, setShadow } from '@terra/render/core/shadowConfig';
import {
  addArchetypeLight,
  exportArchetypeLightsCode,
  getArchetypeLights,
  onArchetypeLightsChange,
  removeArchetypeLight,
  resetArchetypeLights,
  updateArchetypeLight,
  type ArchetypeLightSource,
} from '@terra/render/lighting/archetypeLights';
import { initPixelDialog } from '@terra/render/ui/pixelDialog';
import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import { ArchetypeCatalog, setDepositPreviewStage, type ArchetypeCategory, type DepositVisualStage } from '@terra/render/kitbash';
import { validateArchetype } from '@terra/render/kitbash/validate';
import { ParticlePresetRegistry, validateParticlePreset, type InteractionTargetKind } from '@terra/render/particles';
import { $ } from './dom';
import { BUILD_STAGES, WORK_TARGETS, createState, syncURL, type BuildStage, type PgState, type ToggleKey, type View } from './state';
import { StageRig } from './stage/StageRig';
import { SpawnSet } from './content/SpawnSet';
import { SurfaceHost } from './content/SurfaceHost';
import { HexSampleHost } from './content/HexSampleHost';
import { ValidationOverlay } from './content/Validation';
import { CameraRig, type ViewOpts } from './camera/CameraRig';
import { bindPicking } from './camera/Picking';
import { Sidebar } from './panels/Sidebar';
import { Toolbar } from './panels/Toolbar';
import { LightsPanel } from './panels/LightsPanel';
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
  private hexSample: HexSampleHost;
  private validation = new ValidationOverlay();
  private cam: CameraRig;
  private sidebar: Sidebar;
  private toolbar: Toolbar;
  private lightsPanel: LightsPanel;
  private hasFramedOnce = false;
  private clock = new THREE.Clock();
  private time = 0;

  constructor(private params: URLSearchParams) {
    this.state = createState(params);
    setDayNightExternalSync(true);
    const vp = this.viewport = createColonyViewport($('#viewport'));
    this.surface = new SurfaceHost(vp.scene);
    this.hexSample = new HexSampleHost(vp.scene);
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
      onBuild: () => this.setBuild(BUILD_STAGES[(BUILD_STAGES.indexOf(this.state.build) + 1) % BUILD_STAGES.length]!),
      onWorkTarget: () => {
        const next = WORK_TARGETS[(WORK_TARGETS.indexOf(this.state.workTarget) + 1) % WORK_TARGETS.length]!;
        this.setWorkTarget(next, true);
      },
      onDepositStage: (s) => this.setDepositStage(s),
    });
    this.lightsPanel = new LightsPanel(this.state, {
      onNightToggle: () => this.syncStageLighting(),
      onClose: () => { if (this.state.lights) this.toggle('lights'); },
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
    setDepositPreviewStage(state.depositStage);
    this.sidebar.build();
    this.toolbar.build();
    this.lightsPanel.build();
    onArchetypeLightsChange((changedId) => {
      this.spawns.refreshLights(changedId);
      this.lightsPanel.onExternalChange(changedId);
    });
    const initial = params.get('inspect');
    state.id = initial && ArchetypeCatalog.has(initial) ? initial : (state.row ? ArchetypeCatalog.list(state.row)[0]?.id : ArchetypeCatalog.list()[0]?.id) ?? '';
    if (initial && !ArchetypeCatalog.has(initial)) toast(`Unknown archetype "${initial}"`);
    this.applyPlanet();
    if (state.id) this.select(state.id, { rebuild: false, frame: true }); else this.setView(state.view, { instant: true });
    this.sidebar.render();
    this.toolbar.syncToggles();
    this.lightsPanel.render();
    this.syncStageLighting();
    initPixelDialog();
    onPixelArtChange((on) => { this.state.pixel = on; this.toolbar.syncToggles(); syncURL(this.state); });
    onShadowChange((on) => { this.state.shadows = on; this.toolbar.syncToggles(); syncURL(this.state); });
    this.setView(state.view, { instant: true });
    this.frame();
  }

  /** QA hooks (`window.__pg`). */
  get debug() {
    const vp = this.viewport;
    return {
      state: this.state, select: (id: string) => this.select(id), validate: (id = this.state.id) => validateArchetype(id), setView: (v: View) => this.setView(v),
      setPlanet: (k: PlanetKind) => { this.state.kind = k; this.applyPlanet(); }, toggle: (k: ToggleKey) => this.toggle(k), contactSheet: () => this.contactSheet(),
      viewport: vp, camera: vp.camera, controls: this.cam.controls, spawns: () => this.spawns.spawns, setBuild: (s: BuildStage) => this.setBuild(s),
      setWorkTarget: (t: InteractionTargetKind, enableWork = true) => this.setWorkTarget(t, enableWork),
      validateParticles: (targetOrId: string = this.state.workTarget) => {
        const preset = ParticlePresetRegistry.get(targetOrId) ?? ParticlePresetRegistry.getByTargetKind(targetOrId as InteractionTargetKind);
        return validateParticlePreset(preset);
      },
      setDepositStage: (s: DepositVisualStage) => this.setDepositStage(s),
      getLights: (id = this.state.id) => getArchetypeLights(id),
      addLight: (patch?: Partial<ArchetypeLightSource>, id = this.state.id) => addArchetypeLight(id, patch),
      removeLight: (idx: number | string, id = this.state.id) => removeArchetypeLight(id, idx),
      updateLight: (idx: number, patch: Partial<ArchetypeLightSource>, id = this.state.id) => updateArchetypeLight(id, idx, patch),
      resetLights: (id = this.state.id) => resetArchetypeLights(id),
      exportLightsCode: (id = this.state.id) => exportArchetypeLightsCode(id),
    };
  }

  private bounds() { return this.spawns.bounds(this.state.id, this.state.row); }

  // ---------------------------------------------------------------- planet / content
  private applyPlanet() {
    const { state } = this;
    this.viewport.applySky(PLANET_SPECS[state.kind]);
    this.syncStageLighting();
    this.buildStage();
    this.rebuildContent();
    this.syncSurface();
    this.toolbar.setPlanet(state.kind);
  }

  private syncStageLighting() {
    const vp = this.viewport;
    if (this.lightsPanel?.isNightPreview) {
      vp.sun.color.setHex(0x4cc9f0);
      vp.sun.intensity = 0.22;
      vp.hemi.color.setHex(0x162844);
      vp.hemi.groundColor.setHex(0x050811);
      vp.hemi.intensity = 0.14;
      vp.scene.environmentIntensity = 0.16;
      if (vp.scene.background instanceof THREE.Color) vp.scene.background.setHex(0x060a14);
      if (vp.scene.fog instanceof THREE.FogExp2) vp.scene.fog.color.setHex(0x060a14);
    } else {
      vp.applySky(PLANET_SPECS[this.state.kind]);
    }
  }

  private buildStage() { this.rig.build(this.state.kind, this.state); }

  private syncSurface() {
    const { kind, surface, hexTerrain, hatch, depositStage } = this.state;
    const onSurface = this.surface.sync(kind, surface); // both always run: each disposes what it showed before
    const onHex = this.hexSample.sync(kind, hexTerrain, hatch, depositStage);
    if (onSurface || onHex) this.rig.hidePedestal();
  }

  private setBuild(stage: BuildStage) {
    this.state.build = stage;
    this.spawns.applyBuild(stage);
    this.toolbar.syncToggles(); syncURL(this.state);
  }

  private setWorkTarget(target: InteractionTargetKind, enableWork = false) {
    if (!WORK_TARGETS.includes(target)) return;
    this.state.workTarget = target;
    if (enableWork) this.state.work = true;
    this.toolbar.syncToggles();
    syncURL(this.state);
  }

  private setDepositStage(stage: DepositVisualStage) {
    this.state.depositStage = stage;
    setDepositPreviewStage(stage);
    this.rebuildContent();
    this.hexSample.setDepositStage(stage);
    this.refreshInfo();
    this.toolbar.syncToggles();
    syncURL(this.state);
  }

  private rebuildContent() {
    const { state, spawns } = this;
    spawns.rebuild(spawns.idsFor(state.row, state.id), PLANET_SPECS[state.kind].biomeKey, state.wire, state.depositStage);
    spawns.applyBuild(state.build);
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
    this.lightsPanel?.render();
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
    this.lightsPanel.render();
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
      case 'pixel': setPixelArt(state.pixel, false); break;
      case 'wire': this.spawns.applyWire(state.wire); break;
      case 'grid': this.rig.grid.visible = state.grid; break;
      case 'ruler': this.rig.ruler.visible = state.ruler; break;
      case 'human': this.rig.human.visible = state.human; break;
      case 'shadows': this.applyShadows(); break;
      case 'hex': { this.buildStage(); if (state.surface) this.syncSurface(); break; }
      case 'surface': if (state.surface) state.hexTerrain = false; this.buildStage(); this.syncSurface(); break;
      case 'hexTerrain': if (state.hexTerrain) state.surface = false; this.buildStage(); this.syncSurface(); break;
      case 'hatch': this.hexSample.setHatch(state.hatch); break;
      case 'validate': this.applyValidation(); this.refreshInfo(); break;
      case 'lights': this.lightsPanel.render(); this.syncStageLighting(); break;
    }
    this.toolbar.syncToggles(); syncURL(state);
  }

  private applyShadows() {
    setShadow(this.state.shadows);
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
    this.spawns.tick(this.time, dt, this.state.turntable, !!this.state.row, this.state.work ? 1 : 0, this.state.id, this.state.lights, this.lightsPanel.isNightPreview, this.state.workTarget);
    this.cam.controls.update();
    this.surface.update(dt, this.time);
    this.hexSample.update(dt);
    this.viewport.followShadow(this.cam.controls.target);
    this.viewport.render();
    requestAnimationFrame(this.frame);
  };
}
