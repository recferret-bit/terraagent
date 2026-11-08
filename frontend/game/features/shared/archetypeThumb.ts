import type * as THREE from 'three';

const SIZE = 84;

/** Meshes the game already substitutes when the balance row names an archetype that is not registered. */
const THUMB_ALIAS: Record<string, string> = {
  'building.petroleumWell': 'building.mine',
  'robot.scout': 'robot.hero',
  'robot.engineer': 'robot.builder',
  'robot.hauler': 'robot.miner',
  'building.depot': 'building.supplyDepot',
  'building.outpostBeacon': 'building.claimBeacon',
  'building.quarry': 'building.mine',
};
let users = 0;
let failed = false;
let probedOk: boolean | null = null;
let queueChain: Promise<void> = Promise.resolve();
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
const images = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

type ThumbApi = {
  THREE: typeof import('three');
  createArchetypeMesh: typeof import('@terra/render/kitbash').createArchetypeMesh;
  has: (id: string) => boolean;
};

let apiPromise: Promise<ThumbApi | null> | null = null;

export function retainArchetypeThumbs(): void {
  users += 1;
}

export function releaseArchetypeThumbs(): void {
  users = Math.max(0, users - 1);
  if (users === 0) disposeArchetypeThumbs();
}

/** Drops the one offscreen renderer. Cached images are cleared with it. */
export function disposeArchetypeThumbs(): void {
  renderer?.dispose();
  renderer?.forceContextLoss();
  renderer = null;
  scene = null;
  camera = null;
  probedOk = null;
  images.clear();
  inflight.clear();
}

export function archetypeShortName(id: string): string {
  const part = id.split('.').pop() ?? id;
  return part.length > 10 ? part.slice(0, 10) : part;
}

function webglOk(): boolean {
  if (failed || typeof document === 'undefined') return false;
  if (probedOk !== null) return probedOk;
  if (typeof WebGLRenderingContext === 'undefined') {
    failed = true;
    probedOk = false;
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    const getContext = (canvas as HTMLCanvasElement).getContext?.bind(canvas);
    if (typeof getContext !== 'function') {
      probedOk = false;
      return false;
    }
    const gl = (getContext('webgl2') || getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) {
      probedOk = false;
      return false;
    }
    const dbg = gl.getExtension?.('WEBGL_debug_renderer_info');
    const unmasked = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '') : '';
    gl.getExtension?.('WEBGL_lose_context')?.loseContext();
    probedOk = !/swiftshader/i.test(unmasked);
    return probedOk;
  } catch {
    failed = true;
    probedOk = false;
    return false;
  }
}

function loadApi(): Promise<ThumbApi | null> {
  if (!apiPromise) {
    apiPromise = Promise.all([import('three'), import('@terra/render/kitbash')])
      .then(([THREE, kit]) => ({ THREE, createArchetypeMesh: kit.createArchetypeMesh, has: kit.ArchetypeCatalog.has }))
      .catch(() => {
        failed = true;
        return null;
      });
  }
  return apiPromise;
}

function ensureView(THREE: ThumbApi['THREE']): boolean {
  if (renderer && scene && camera) return true;
  const canvas = document.createElement('canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE);
  renderer.setClearColor(0x111318, 1);
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xf2f4f7, 0x222631, 1.15));
  const sun = new THREE.DirectionalLight(0xfff4e8, 1.35);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  camera = new THREE.PerspectiveCamera(28, 1, 0.05, 40);
  return true;
}

function frameCamera(THREE: ThumbApi['THREE'], mesh: THREE.Object3D): void {
  if (!camera) return;
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.2);
  camera.position.set(center.x + maxDim * 0.85, center.y + maxDim * 0.55, center.z + maxDim * 1.35);
  camera.near = maxDim / 50;
  camera.far = maxDim * 20;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

function disposeMesh(mesh: THREE.Mesh): void {
  mesh.geometry?.dispose();
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const mat of mats) mat?.dispose();
  const depth = mesh.customDepthMaterial;
  if (depth && !Array.isArray(depth)) depth.dispose();
}

function drawableId(api: ThumbApi, id: string): string | null {
  if (api.has(id)) return id;
  const alias = THUMB_ALIAS[id];
  return alias && api.has(alias) ? alias : null;
}

function drawOne(api: ThumbApi, id: string): string | null {
  const meshId = drawableId(api, id);
  if (!meshId || !ensureView(api.THREE) || !scene || !renderer || !camera) return null;
  const mesh = api.createArchetypeMesh(meshId, 'dune');
  scene.add(mesh);
  frameCamera(api.THREE, mesh);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(mesh);
  disposeMesh(mesh);
  return url;
}

function renderOnce(id: string): Promise<string | null> {
  const cached = images.get(id);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(id);
  if (pending) return pending;
  const job = new Promise<string | null>((resolve) => {
    queueChain = queueChain.then(async () => {
      await new Promise((r) => setTimeout(r, 16));
      const api = await loadApi();
      if (!api || users <= 0) {
        resolve(null);
        return;
      }
      const url = drawOne(api, id);
      if (url) images.set(id, url);
      resolve(url);
    }).catch(() => {
      failed = true;
      disposeArchetypeThumbs();
      resolve(null);
    });
  }).finally(() => inflight.delete(id));
  inflight.set(id, job);
  return job;
}

function imageEl(url: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'ta-thumb__img';
  img.alt = '';
  img.src = url;
  return img;
}

function fallbackEl(id: string): HTMLElement {
  const plate = document.createElement('span');
  plate.className = 'ta-thumb__fallback';
  plate.textContent = archetypeShortName(id);
  return plate;
}

/** Puts a cached sneak-peek in `host`, or a short-name plate when WebGL or the archetype is missing. */
export function fillArchetypeThumb(host: HTMLElement, archetypeId: string): void {
  host.className = 'ta-thumb';
  host.replaceChildren();
  const known = images.get(archetypeId);
  if (known) {
    host.appendChild(imageEl(known));
    return;
  }
  host.appendChild(fallbackEl(archetypeId));
  if (!webglOk()) return;
  void renderOnce(archetypeId).then((url) => {
    if (!url || !host.isConnected) return;
    host.replaceChildren(imageEl(url));
  });
}
