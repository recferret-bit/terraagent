import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import '../../frontend/design/css/tokens.css';
import '../../frontend/design/css/base.css';
import './playground.css';
import { createColonyViewport } from '../core/createColonyViewport';
import { PLANET_KINDS, PLANET_SPECS, type PlanetKind } from '../planets/PlanetSpec';
import '../kitbash';
import { ArchetypeCatalog, createArchetypeMesh, tickArchetypeMesh, type ArchetypeCategory, type ArchetypeMesh } from '../kitbash';
import { createPlanetSurface } from '../game/modules';
import type { PlanetSurface } from '../planets/surface/types';

type View = 'iso' | 'front' | 'side' | 'top';
const VIEWS: View[] = ['iso', 'front', 'side', 'top'];
const CATS: ArchetypeCategory[] = ['robot', 'building', 'ship', 'resource', 'fauna', 'prop'];
const PLANET_LABEL: Record<PlanetKind, string> = { dune: 'Dune', oceanForest: 'Ocean', forestRock: 'Forest' };
const PEDESTAL_R = 6.3;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------- state
const state = {
  id: '' as string,
  kind: (PLANET_KINDS.includes(params.get('biome') as PlanetKind) ? params.get('biome') : 'dune') as PlanetKind,
  view: (VIEWS.includes(params.get('view') as View) ? params.get('view') : 'iso') as View,
  turntable: params.get('turntable') === '1',
  bloom: true, wire: false, grid: true, shadows: true, hex: false, human: false, ruler: true, surface: params.get('surface') === '1',
  row: null as ArchetypeCategory | null,
  filter: '',
};

// ---------------------------------------------------------------- viewport
const viewport = createColonyViewport($('#viewport'));
const { scene, camera, renderer } = viewport;
camera.far = 600;
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.09;
controls.screenSpacePanning = false;
controls.maxPolarAngle = Math.PI / 2 - 0.015;
controls.minDistance = 1.2;
controls.maxDistance = 140;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

const stage = new THREE.Group();   // pedestal + grid + ruler + human
const content = new THREE.Group(); // spawned archetype meshes
scene.add(stage, content);
const ringGeo = new THREE.RingGeometry(0.97, 1.0, 64).rotateX(-Math.PI / 2);
const selRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff6a13, transparent: true, opacity: 0.9, depthWrite: false }));
selRing.position.y = 0.006;
scene.add(selRing);

// ---------------------------------------------------------------- pedestal
let pedestalMat: THREE.MeshStandardMaterial;
let gridGroup = new THREE.Group();
let rulerGroup = new THREE.Group();
let humanGroup = new THREE.Group();

function textSprite(txt: string, color = '#c9cfda') {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d')!; g.font = '600 38px "IBM Plex Mono", monospace'; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(txt, 64, 32);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  s.scale.set(0.8, 0.4, 1);
  return s;
}

function buildPedestal() {
  stage.clear();
  const spec = PLANET_SPECS[state.kind];
  pedestalMat = new THREE.MeshStandardMaterial({ color: spec.palette.rockDark, roughness: 0.75, metalness: 0.2 });
  const slab = new THREE.Mesh(new THREE.CylinderGeometry(PEDESTAL_R, PEDESTAL_R + 0.25, 0.5, 64), pedestalMat);
  slab.position.y = -0.5 - 0.002; slab.receiveShadow = true; slab.name = 'pedestal';
  const top = new THREE.Mesh(new THREE.CircleGeometry(PEDESTAL_R, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: spec.palette.groundLow, roughness: 0.85, metalness: 0.05 }));
  top.position.y = -0.002; top.receiveShadow = true; top.name = 'pedestal';
  const rim = new THREE.Mesh(new THREE.TorusGeometry(PEDESTAL_R, 0.05, 8, 96).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x1e5bff, emissive: 0x1e5bff, emissiveIntensity: 1.6 }));
  rim.position.y = 0;
  stage.add(slab, top, rim);

  // grid: 1m + 5m lines (square) or 1m hex tiles
  gridGroup = new THREE.Group();
  const R = PEDESTAL_R - 0.05;
  const minor: number[] = [], major: number[] = [];
  const push = (arr: number[], x1: number, z1: number, x2: number, z2: number) => {
    // clip to circle by skipping segments whose endpoints are outside
    if (x1 * x1 + z1 * z1 > R * R || x2 * x2 + z2 * z2 > R * R) return;
    arr.push(x1, 0, z1, x2, 0, z2);
  };
  if (!state.hex) {
    const N = 6;
    for (let i = -N; i <= N; i++) {
      const arr = i % 5 === 0 ? major : minor;
      for (let s = -N; s < N; s++) { push(arr, i, s, i, s + 1); push(arr, s, i, s + 1, i); }
    }
  } else {
    const s = 1 / Math.sqrt(3); // circumradius so flat-to-flat = 1m
    const w = 1, h = s * 1.5;
    for (let row = -9; row <= 9; row++) for (let col = -8; col <= 8; col++) {
      const cx = col * w + (row & 1 ? w / 2 : 0), cz = row * h;
      for (let k = 0; k < 6; k++) {
        const a1 = Math.PI / 6 + (k * Math.PI) / 3, a2 = a1 + Math.PI / 3;
        push(minor, cx + Math.cos(a1) * s, cz + Math.sin(a1) * s, cx + Math.cos(a2) * s, cz + Math.sin(a2) * s);
      }
    }
    for (let i = -5; i <= 5; i += 5) { push(major, i, -6, i, 6); push(major, -6, i, 6, i); }
  }
  const mk = (arr: number[], color: number, op: number) => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false }));
    l.position.y = 0.003; return l;
  };
  gridGroup.add(mk(minor, 0x8a93a6, 0.28), mk(major, 0x5b8cff, 0.85));
  // 1 m calibration ring at origin
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.985, 1.0, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff6a13, side: THREE.DoubleSide, depthWrite: false }));
  ring.position.y = 0.005; gridGroup.add(ring);
  stage.add(gridGroup);

  // ruler along +X edge at z=+5.4
  rulerGroup = new THREE.Group();
  const rp: number[] = [];
  for (let i = 0; i <= 5; i++) rp.push(i, 0, 0, i, 0.12 + (i % 5 === 0 ? 0.1 : 0));
  rp.push(0, 0.002, 0, 5, 0.002, 0);
  const rg = new THREE.BufferGeometry();
  const verts: number[] = [];
  for (let i = 0; i <= 5; i++) verts.push(i, 0.01, 0, i, 0.01 + 0.14 + (i === 5 ? 0.1 : 0), 0);
  verts.push(0, 0.01, 0, 5, 0.01, 0);
  rg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  rulerGroup.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xff8a3d })));
  for (let i = 0; i <= 5; i++) { const sp = textSprite(i + 'm', '#ff8a3d'); sp.position.set(i, 0.45, 0); rulerGroup.add(sp); }
  rulerGroup.position.set(-2.5, 0, 5.1);
  rulerGroup.visible = state.ruler;
  stage.add(rulerGroup);

  // human reference 1.8m
  humanGroup = new THREE.Group();
  const hm = new THREE.MeshStandardMaterial({ color: 0x39d0ff, transparent: true, opacity: 0.35, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.0, 4, 12), hm); body.position.y = 0.72 + 0.0;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), hm); head.position.y = 1.67;
  body.position.y = 0.72; // spans 0..1.44 (+caps)
  humanGroup.add(body, head);
  const lbl = textSprite('1.8m', '#39d0ff'); lbl.position.y = 2.1; humanGroup.add(lbl);
  humanGroup.visible = state.human;
  stage.add(humanGroup);
  gridGroup.visible = state.grid;
  placeHuman();
}

// ---------------------------------------------------------------- planet / surface
let surface: PlanetSurface | null = null;
function applyPlanet() {
  const spec = PLANET_SPECS[state.kind];
  viewport.applySky(spec);
  buildPedestal();
  rebuildContent();
  syncSurface();
  setBtn('#planet-btns', state.kind);
}
function syncSurface() {
  if (surface) { scene.remove(surface.group); surface.dispose(); surface = null; }
  const showSurf = state.surface;
  stage.visible = !showSurf || true;
  if (showSurf) {
    if (!createPlanetSurface) { toast('createPlanetSurface not available yet'); state.surface = false; return; }
    surface = createPlanetSurface(PLANET_SPECS[state.kind], { quality: 'low' });
    // sit surface just under the pedestal so the object stays visible: hide pedestal slab/top
    scene.add(surface.group);
    surface.group.position.y = -0.02;
    stage.children.forEach((c) => { if (c.name === 'pedestal') c.visible = false; });
  }
}

// ---------------------------------------------------------------- content
interface Spawn { id: string; mesh: ArchetypeMesh; box: THREE.Box3; }
let spawns: Spawn[] = [];
const statsCache = new Map<string, ReturnType<typeof computeStats>>();

function computeStats(id: string) {
  const g = ArchetypeCatalog.get(id).create();
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  const anim = new Set<number>();
  const a = g.getAttribute('aPartAnim');
  if (a) for (let i = 0; i < a.count; i++) anim.add(a.getX(i));
  const out = { tris: Math.round(tris), verts: g.attributes.position.count, size: bb.getSize(new THREE.Vector3()), minY: bb.min.y, anim: [...anim].sort(), attrs: Object.keys(g.attributes) };
  g.dispose();
  return out;
}
const ANIM_NAME: Record<number, string> = { 0: 'static', 1: 'spin', 2: 'bob', 3: 'recoil' };

function disposeSpawns() {
  for (const s of spawns) { content.remove(s.mesh); s.mesh.geometry.dispose(); (s.mesh.material as THREE.Material).dispose(); }
  spawns = [];
}

function rebuildContent() {
  disposeSpawns();
  const spec = PLANET_SPECS[state.kind];
  const ids = state.row ? ArchetypeCatalog.list(state.row).map((e) => e.id) : state.id ? [state.id] : [];
  let x = 0; const gap = 0.9;
  const widths: number[] = [];
  for (const id of ids) {
    let mesh: ArchetypeMesh;
    try { mesh = createArchetypeMesh(id, spec.biomeKey); } catch (e) { console.error('archetype build failed', id, e); continue; }
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!.clone();
    const w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 1);
    widths.push(w);
    spawns.push({ id, mesh, box });
    content.add(mesh);
  }
  const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, widths.length - 1);
  x = -total / 2;
  spawns.forEach((s, i) => {
    s.mesh.position.set(x + widths[i] / 2, 0, 0);
    x += widths[i] + gap;
  });
  applyWire();
  updateSelRing();
  placeHuman();
  content.rotation.y = 0;
}

function applyWire() {
  for (const s of spawns) (s.mesh.material as THREE.MeshStandardMaterial).wireframe = state.wire;
}

function placeHuman() {
  if (!humanGroup) return;
  const minX = spawns.length ? Math.min(...spawns.map((s) => s.mesh.position.x + s.box.min.x)) : 0;
  humanGroup.position.set(Math.max(-5, minX - 1.2), 0, 0.6);
}

function updateSelRing() {
  const s = spawns.find((s) => s.id === state.id);
  selRing.visible = !!s && state.row !== null;
  if (s) {
    const r = Math.max(s.box.max.x - s.box.min.x, s.box.max.z - s.box.min.z, 1) * 0.62;
    selRing.scale.setScalar(r);
    selRing.position.set(s.mesh.position.x, 0.006, s.mesh.position.z);
  }
}

// ---------------------------------------------------------------- selection / info
function select(id: string, opts: { rebuild?: boolean; frame?: boolean } = {}) {
  const { rebuild = !state.row, frame = true } = opts;
  if (!ArchetypeCatalog.has(id)) { toast(`Unknown archetype: ${id}`); return; }
  state.id = id;
  if (state.row && ArchetypeCatalog.get(id).category !== state.row) state.row = ArchetypeCatalog.get(id).category;
  if (rebuild) rebuildContent();
  updateSelRing();
  updateInfo();
  markList();
  if (frame) setView(state.view, { instant: !hasFramedOnce });
  hasFramedOnce = true;
  syncURL();
}
let hasFramedOnce = false;

function updateInfo() {
  const el = $('#info');
  if (!state.id) { el.innerHTML = '<h3>No selection</h3>'; return; }
  const e = ArchetypeCatalog.get(state.id);
  if (!statsCache.has(state.id)) statsCache.set(state.id, computeStats(state.id));
  const s = statsCache.get(state.id)!;
  const contact = Math.abs(s.minY) <= 0.02;
  const calls = state.row ? spawns.length : 1;
  el.innerHTML = `<h3>${e.label}<small>${e.id} · ${e.category}</small></h3><table>
    <tr><td>triangles</td><td>${s.tris.toLocaleString()}${s.tris > 3500 ? ' <span class="bad">(&gt;3.5k)</span>' : ''}</td></tr>
    <tr><td>vertices</td><td>${s.verts.toLocaleString()}</td></tr>
    <tr><td>bbox (m)</td><td>${s.size.x.toFixed(2)} × ${s.size.y.toFixed(2)} × ${s.size.z.toFixed(2)}</td></tr>
    <tr><td>ground contact</td><td class="${contact ? 'ok' : 'bad'}">${contact ? '✔' : '✖'} minY ${s.minY.toFixed(3)}</td></tr>
    <tr><td>footprint</td><td>${e.footprint ? e.footprint.join('×') + ' tiles' : '—'}</td></tr>
    <tr><td>part anims</td><td>${s.anim.length ? s.anim.map((a) => ANIM_NAME[a] ?? a).join(', ') : 'n/a'}</td></tr>
    <tr><td>draw calls</td><td>${calls} (merged)</td></tr>
    <tr><td>attributes</td><td>${s.attrs.filter((a) => a !== 'position' && a !== 'normal').join(', ')}</td></tr>
    ${e.notes ? `<tr><td>notes</td><td>${e.notes}</td></tr>` : ''}</table>`;
}

// ---------------------------------------------------------------- sidebar
function buildSidebar() {
  const side = $('#side');
  side.innerHTML = `<div class="brand"><div><div class="wm">TERRA<b>AGENT</b></div><small>3D PLAYGROUND · ${ArchetypeCatalog.list().length} ARCHETYPES</small></div><a class="pg-home" href="/">◂ HUB</a></div>
  <input id="search" placeholder="Search archetypes…  ( / )" autocomplete="off" />
  <div id="list"></div>
  <div class="side-foot"><kbd>[</kbd><kbd>]</kbd> cycle · <kbd>1</kbd>-<kbd>4</kbd> views · <kbd>T</kbd> turntable · <kbd>F</kbd> focus<br><kbd>G</kbd> grid · <kbd>W</kbd> wire · <kbd>B</kbd> bloom · <kbd>R</kbd> row · dbl-click refocus</div>`;
  ($('#search') as HTMLInputElement).addEventListener('input', (e) => { state.filter = (e.target as HTMLInputElement).value.toLowerCase(); renderList(); });
  renderList();
}
function visibleIds(): string[] {
  return ArchetypeCatalog.list().filter((e) => !state.filter || (e.id + ' ' + e.label + ' ' + e.category).toLowerCase().includes(state.filter)).map((e) => e.id);
}
function renderList() {
  const list = $('#list'); list.innerHTML = '';
  const vis = new Set(visibleIds());
  for (const cat of CATS) {
    const items = ArchetypeCatalog.list(cat).filter((e) => vis.has(e.id));
    if (!items.length) continue;
    const grp = document.createElement('div'); grp.className = 'grp';
    const gh = document.createElement('div'); gh.className = 'gh';
    gh.innerHTML = `<span>${cat} <span style="color:var(--ta-steel)">(${items.length})</span></span><button class="row-btn ${state.row === cat ? 'on' : ''}" title="Spawn row (R)">row</button>`;
    (gh.querySelector('button') as HTMLButtonElement).onclick = (ev) => { ev.stopPropagation(); toggleRow(cat); };
    grp.appendChild(gh);
    for (const e of items) {
      const b = document.createElement('button'); b.className = 'item'; b.dataset.id = e.id;
      b.innerHTML = `${e.label}<small>${e.id}</small>`;
      b.onclick = () => select(e.id);
      grp.appendChild(b);
    }
    list.appendChild(grp);
  }
  markList();
}
function markList() {
  document.querySelectorAll<HTMLElement>('.item').forEach((b) => b.classList.toggle('sel', b.dataset.id === state.id));
  document.querySelectorAll<HTMLElement>('.row-btn').forEach((b) => b.classList.toggle('on', (b.parentElement!.textContent ?? '').trim().startsWith(state.row ?? '\u0000')));
  const s = document.querySelector('.item.sel') as HTMLElement | null; s?.scrollIntoView({ block: 'nearest' });
}

function toggleRow(cat?: ArchetypeCategory) {
  const c = cat ?? (state.id ? ArchetypeCatalog.get(state.id).category : null);
  state.row = state.row === c || !c ? null : c;
  if (state.row && (!state.id || ArchetypeCatalog.get(state.id).category !== state.row)) state.id = ArchetypeCatalog.list(state.row)[0]?.id ?? state.id;
  rebuildContent(); updateInfo(); renderList(); setBtn('#bar', null);
  syncToggles();
  setView(state.view);
  syncURL();
}

// ---------------------------------------------------------------- camera
let tween: { t: number; dur: number; fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTgt: THREE.Vector3; toTgt: THREE.Vector3 } | null = null;

function contentBounds() {
  const box = new THREE.Box3();
  if (!spawns.length) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1.5, 1));
  const targets = state.row ? spawns : spawns.filter((s) => s.id === state.id);
  for (const s of targets) box.union(s.box.clone().translate(s.mesh.position));
  return box;
}
const DIRS: Record<View, THREE.Vector3> = {
  iso: new THREE.Vector3(0.75, 0.78, 0.75).normalize(),
  front: new THREE.Vector3(0, 0.22, 1).normalize(),
  side: new THREE.Vector3(1, 0.22, 0).normalize(),
  top: new THREE.Vector3(0.0008, 1, 0.0008).normalize(),
};
function setView(view: View, opts: { instant?: boolean; target?: THREE.Vector3; radius?: number } = {}) {
  state.view = view;
  setBtn('#views', view);
  const box = contentBounds();
  const size = box.getSize(new THREE.Vector3());
  const c = opts.target ?? box.getCenter(new THREE.Vector3());
  let r = opts.radius ?? Math.max(size.length() / 2, 0.9);
  if (state.row && !opts.radius) r = Math.max(size.x / 2 / Math.max(camera.aspect * 0.8, 0.8), size.y, 1.5);
  const dist = Math.min(controls.maxDistance, r / Math.sin(THREE.MathUtils.degToRad(14)) * 1.15);
  const toPos = c.clone().addScaledVector(DIRS[view], dist);
  if (opts.instant) {
    camera.position.copy(toPos); controls.target.copy(c); controls.update(); tween = null;
  } else {
    tween = { t: 0, dur: 0.65, fromPos: camera.position.clone(), toPos, fromTgt: controls.target.clone(), toTgt: c.clone() };
  }
  syncURL();
}
function focusSelected() {
  const box = contentBounds();
  setView(state.view, { target: box.getCenter(new THREE.Vector3()) });
}
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function stepTween(dt: number) {
  if (!tween) return;
  tween.t += dt / tween.dur;
  const k = ease(Math.min(1, tween.t));
  controls.target.lerpVectors(tween.fromTgt, tween.toTgt, k);
  // interpolate offset direction + length (arc-like) rather than straight line
  const a = tween.fromPos.clone().sub(tween.fromTgt), b = tween.toPos.clone().sub(tween.toTgt);
  const la = a.length(), lb = b.length();
  const dir = a.normalize().lerp(b.normalize(), k).normalize();
  camera.position.copy(controls.target).addScaledVector(dir, THREE.MathUtils.lerp(la, lb, k));
  if (tween.t >= 1) tween = null;
}
controls.addEventListener('start', () => { tween = null; });

// ---------------------------------------------------------------- picking
const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
function pick(ev: MouseEvent): Spawn | null {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(spawns.map((s) => s.mesh), false);
  return hits.length ? spawns.find((s) => s.mesh === hits[0].object) ?? null : null;
}
let downPos = { x: 0, y: 0 };
renderer.domElement.addEventListener('pointerdown', (e) => { downPos = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 4) return;
  if (!state.row) return;
  const s = pick(e); if (s && s.id !== state.id) select(s.id, { rebuild: false, frame: false });
});
renderer.domElement.addEventListener('dblclick', (e) => {
  const s = pick(e);
  if (s) {
    const bb = s.box.clone().translate(s.mesh.position);
    setView(state.view, { target: bb.getCenter(new THREE.Vector3()), radius: Math.max(bb.getSize(new THREE.Vector3()).length() / 2, 0.9) });
    if (s.id !== state.id) select(s.id, { rebuild: false, frame: false });
  } else {
    const rc = ray.intersectObject(stage.children[1], false);
    const p = rc[0]?.point; if (p) setView(state.view, { target: p, radius: 3 });
  }
});

// ---------------------------------------------------------------- toolbar
function setBtn(sel: string, val: string | null) {
  document.querySelectorAll<HTMLElement>(`${sel} [data-v]`).forEach((b) => b.classList.toggle('on', b.dataset.v === val));
}
function buildBar() {
  const ov = $('#overlay');
  ov.innerHTML = `
  <div id="tip">LMB rotate · wheel zoom · RMB pan · dbl-click refocus</div>
  <div class="panel" id="info"></div>
  <div class="panel" id="bar">
    <div id="views" style="display:flex;gap:4px">${VIEWS.map((v, i) => `<button class="pg-btn" data-v="${v}" title="${i + 1}">${v}</button>`).join('')}</div>
    <span class="sep"></span>
    <div id="planet-btns" class="planet">${PLANET_KINDS.map((k) => `<button class="pg-btn" data-v="${k}">${PLANET_LABEL[k]}</button>`).join('')}</div>
    <span class="sep"></span>
    ${(['turntable', 'bloom', 'wire', 'grid', 'shadows', 'hex', 'human', 'ruler', 'surface', 'row'] as const)
      .map((k) => `<button class="pg-btn tog" data-k="${k}">${k === 'wire' ? 'wireframe' : k === 'surface' ? 'planet surface' : k === 'row' ? 'spawn row' : k === 'hex' ? 'hex grid' : k === 'human' ? '1.8m human' : k}</button>`).join('')}
    <span class="sep"></span>
    <button class="pg-btn" id="shot">PNG</button><button class="pg-btn" id="sheet">4-view sheet</button>
  </div><div id="toast"></div>`;
  ov.querySelectorAll<HTMLElement>('#views [data-v]').forEach((b) => (b.onclick = () => setView(b.dataset.v as View)));
  ov.querySelectorAll<HTMLElement>('#planet-btns [data-v]').forEach((b) => (b.onclick = () => { state.kind = b.dataset.v as PlanetKind; applyPlanet(); syncURL(); }));
  ov.querySelectorAll<HTMLElement>('.tog').forEach((b) => (b.onclick = () => toggle(b.dataset.k as any)));
  $('#shot').onclick = () => screenshot();
  $('#sheet').onclick = () => contactSheet();
  syncToggles();
}
function toggle(k: 'turntable' | 'bloom' | 'wire' | 'grid' | 'shadows' | 'hex' | 'human' | 'ruler' | 'surface' | 'row') {
  if (k === 'row') { toggleRow(); return; }
  (state as any)[k] = !(state as any)[k];
  switch (k) {
    case 'bloom': viewport.bloom.enabled = state.bloom; break;
    case 'wire': applyWire(); break;
    case 'grid': gridGroup.visible = state.grid; break;
    case 'ruler': rulerGroup.visible = state.ruler; break;
    case 'human': humanGroup.visible = state.human; break;
    case 'shadows': viewport.sun.castShadow = state.shadows; renderer.shadowMap.enabled = state.shadows; scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; }); break;
    case 'hex': { const s = state.surface; buildPedestal(); placeHuman(); if (s) syncSurface(); break; }
    case 'surface': syncSurface(); break;
  }
  syncToggles(); syncURL();
}
function syncToggles() {
  document.querySelectorAll<HTMLElement>('.tog').forEach((b) => {
    const k = b.dataset.k!;
    b.classList.toggle('on', k === 'row' ? !!state.row : !!(state as any)[k]);
  });
}
let toastT = 0;
function toast(msg: string) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = window.setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------------------------------------------------------------- capture
function download(url: string, name: string) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
function renderNow() { controls.update(); viewport.render(); }
function screenshot() {
  renderNow();
  download(renderer.domElement.toDataURL('image/png'), `terra-${state.id || 'scene'}-${state.view}-${state.kind}.png`);
  toast('Screenshot saved');
}
function contactSheet(): string {
  const saved = { p: camera.position.clone(), t: controls.target.clone(), view: state.view };
  const w = renderer.domElement.width, h = renderer.domElement.height;
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const g = out.getContext('2d')!; g.fillStyle = '#07080A'; g.fillRect(0, 0, w, h);
  const box = contentBounds(); const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.9);
  const dist = r / Math.sin(THREE.MathUtils.degToRad(14)) * 1.2;
  VIEWS.forEach((v, i) => {
    camera.position.copy(c).addScaledVector(DIRS[v], dist); controls.target.copy(c); camera.lookAt(c);
    viewport.render();
    const x = (i % 2) * (w / 2), y = Math.floor(i / 2) * (h / 2);
    g.drawImage(renderer.domElement, x, y, w / 2, h / 2);
    g.fillStyle = '#F2F4F7'; g.font = `600 ${Math.round(h / 40)}px "IBM Plex Mono", monospace`; g.fillText(v.toUpperCase(), x + 12, y + h / 34 + 6);
  });
  g.fillStyle = '#FF8A3D'; g.fillText(`${state.id}  ·  ${state.kind}`, 12, h - 12);
  camera.position.copy(saved.p); controls.target.copy(saved.t); controls.update();
  const url = out.toDataURL('image/png');
  download(url, `terra-${state.id || 'scene'}-sheet-${state.kind}.png`);
  toast('4-view contact sheet saved');
  return url;
}

// ---------------------------------------------------------------- url + keys
function syncURL() {
  const q = new URLSearchParams();
  if (state.id) q.set('inspect', state.id);
  q.set('biome', state.kind); q.set('view', state.view);
  if (state.row) q.set('row', state.row);
  if (state.surface) q.set('surface', '1');
  if (state.turntable) q.set('turntable', '1');
  history.replaceState(null, '', `${location.pathname}?${q}`);
}
function cycle(d: number) {
  const ids = visibleIds(); if (!ids.length) return;
  const i = ids.indexOf(state.id);
  select(ids[(i + d + ids.length) % ids.length]);
}
window.addEventListener('keydown', (e) => {
  const typing = (e.target as HTMLElement)?.tagName === 'INPUT';
  if (e.key === 'Escape' && typing) { (e.target as HTMLElement).blur(); return; }
  if (e.key === '/' && !typing) { e.preventDefault(); $('#search').focus(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.key) {
    case ']': case 'ArrowRight': cycle(1); break;
    case '[': case 'ArrowLeft': cycle(-1); break;
    case '1': setView('iso'); break; case '2': setView('front'); break;
    case '3': setView('side'); break; case '4': setView('top'); break;
    case 't': case 'T': toggle('turntable'); break;
    case 'f': case 'F': focusSelected(); break;
    case 'g': case 'G': toggle('grid'); break;
    case 'w': case 'W': toggle('wire'); break;
    case 'b': case 'B': toggle('bloom'); break;
    case 'r': case 'R': toggle('row'); break;
    case 'h': case 'H': toggle('human'); break;
  }
});

// ---------------------------------------------------------------- boot + loop
buildSidebar();
buildBar();
const initial = params.get('inspect');
if (params.get('row') && CATS.includes(params.get('row') as ArchetypeCategory)) state.row = params.get('row') as ArchetypeCategory;
state.id = initial && ArchetypeCatalog.has(initial) ? initial : (state.row ? ArchetypeCatalog.list(state.row)[0]?.id : ArchetypeCatalog.list()[0]?.id) ?? '';
if (initial && !ArchetypeCatalog.has(initial)) toast(`Unknown archetype "${initial}"`);
applyPlanet();
if (state.id) select(state.id, { rebuild: false, frame: true }); else setView(state.view, { instant: true });
renderList();
syncToggles();
setView(state.view, { instant: true });

const clock = new THREE.Clock();
let time = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  stepTween(dt);
  if (state.turntable) content.rotation.y += dt * 0.5; // rotate object(s), grid stays calibrated
  if (state.turntable && state.row) content.rotation.y = 0; // rows stay readable
  controls.update();
  for (const s of spawns) tickArchetypeMesh(s.mesh, time);
  surface?.update(dt, time);
  viewport.followShadow(controls.target);
  viewport.render();
  requestAnimationFrame(frame);
}
frame();

// QA hooks
(window as any).__pg = { state, select, setView, setPlanet: (k: PlanetKind) => { state.kind = k; applyPlanet(); }, toggle, contactSheet, viewport, camera, controls, spawns: () => spawns };
