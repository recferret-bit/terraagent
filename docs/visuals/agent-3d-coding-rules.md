# AI Agent 3D Coding Rules & Reference Templates (`TerraAgent`)

**Purpose:** Mandatory rules and reference code patterns for any AI coding agent generating Three.js scenes, shaders, procedural 3D models, or asset loaders in this repository.

---

## 1. Strict Visual & Geometry Rules for Coding Agents

### 🚫 NEVER DO THIS
1. **No Raw Sharp Boxes:** Never use `new THREE.BoxGeometry()` for primary robot chassis or building hulls. Sharp 90-degree normals fail to catch specular edge highlights and look like debug placeholders. Always use `RoundedBoxGeometry` (`three/addons/geometries/RoundedBoxGeometry.js`) or beveled extrusions.
2. **No Pure RGB Hex Colors:** Never use `0xff0000`, `0x00ff00`, `0x0000ff`, `0xffffff`, or `0x000000`. Real materials never reflect 100% or 0% of light. Always pull from `COLONY_PALETTE`.
3. **No Single-Primitive Entities:** No unit or building may consist of fewer than **7 distinct geometric sub-parts** and **3 material zones** (`Armor`, `DarkFrame`, `EmissiveCore`).
4. **No Unlit / Environment-Less Metal:** Never use `metalness > 0.2` unless `scene.environment` is initialized via `PMREMGenerator` + `RoomEnvironment`.
5. **No Per-Unit `THREE.Mesh` Loops:** Never instantiate hundreds of individual `THREE.Mesh` objects for robots, resources, trees, or projectiles. Merge static sub-parts into a single `BufferGeometry` with Vertex Colors or material groups and render via `THREE.InstancedMesh`.
6. **No Floating Origins:** Every building, robot, rock, and resource deposit must have its local origin `(0, 0, 0)` at the **bottom-center (`minY = 0`)** of its bounding box so placing it at `(x, terrainHeight, z)` sits flush on the ground with a dark foundation plinth (`height: 0.15m`) that prevents floating on sloped terrain.

### ✅ ALWAYS DO THIS
1. **Follow the 60 / 30 / 10 Visual Rule on Every Model:**
   - **60% Primary Hull/Armor:** Matte/satin painted composite (`roughness: 0.45`, `metalness: 0.15`) using `RoundedBoxGeometry` or Lathe/Extrude profiles.
   - **30% Exposed Mechanical Frame & Greebles:** Dark gunmetal (`0x1e2229`, `roughness: 0.6`, `metalness: 0.75`) for joints, vents, undercarriages, treads, pipes, and sagging `TubeGeometry` cables.
   - **10% High-Contrast Accent & HDR Emissive:** Safety amber/ stripes + glowing cyan/amber status LEDs, plasma coils, or sensor visors (`emissiveIntensity: 3.5` to trigger selective bloom).
2. **Add Silhouette Breakers:** Every building and robot must have asymmetric or silhouette-breaking details (an angled solar wing, a communication antenna with a glowing tip, an external fluid tank connected by a curved pipe, or rotating radar vanes).
3. **Include a Ground Plinth / Skirt:** Every building must start with a slightly wider dark octagonal or chamfered base pad extending `-0.1m` below `Y = 0` so it never appears to float on uneven hex tiles.

---

## 2. Official `TerraAgent` Color & Material Palette

Agents must use these exact calibrated hex codes and PBR ranges:

```typescript
// src/visuals/Palette.ts
export const COLONY_PALETTE = {
  // Colony Faction & Structural Materials
  hullPrimary:      { color: 0xd8dee9, roughness: 0.42, metalness: 0.15 }, // Off-white ceramic titanium
  hullSecondary:    { color: 0xe59838, roughness: 0.48, metalness: 0.10 }, // Industrial safety amber
  frameGunmetal:    { color: 0x242933, roughness: 0.55, metalness: 0.80 }, // Dark mechanical skeleton
  solarCell:        { color: 0x162b4d, roughness: 0.20, metalness: 0.60 }, // Deep photovoltaic blue
  glassVisor:       { color: 0x0f172a, roughness: 0.10, metalness: 0.90 }, // Glossy cockpit/sensor glass

  // HDR Emissive Accents (Use with toneMapped: false or emissiveIntensity > 3.0)
  energyCyan:       { color: 0x00f0ff, intensity: 3.8 }, // Power active / nominal
  warningAmber:     { color: 0xffaa00, intensity: 3.2 }, // Mining laser / low resource
  dangerCrimson:    { color: 0xff2a55, intensity: 4.2 }, // Combat turret / alien threat
  terraformEmerald: { color: 0x10b981, intensity: 3.5 }, // Terraforming wave / bio-dome

  // Planet Biomes (Terrain + Ground Weathering Dust)
  planets: {
    temperate: {
      groundLow:  0x3b4d3b, // Mossy basin
      groundHigh: 0x6b705c, // Highland slate
      dustTint:   0x4a5546,
      skyColor:   0x8ecae6,
      fogColor:   0x9bbec7,
      sunColor:   0xfff5e4,
    },
    desert: {
      groundLow:  0xb5654d, // Iron-oxide sand
      groundHigh: 0xd48c6a, // Sun-bleached dune
      dustTint:   0xc27155,
      skyColor:   0xf4a261,
      fogColor:   0xe09f7d,
      sunColor:   0xfffae0,
    },
    ice: {
      groundLow:  0x779be7, // Glacial crevasse
      groundHigh: 0xdce8f7, // Packed snow
      dustTint:   0xc8ddf2,
      skyColor:   0xa2d2ff,
      fogColor:   0xbad7f2,
      sunColor:   0xe8f4ff,
    },
  },
} as const;
```

---

## 3. Reference Pattern #1: Diorama Viewport & Post-Processing Setup

Use this exact bootstrap so every model benefits from IBL reflections, ACES Filmic tone mapping, tight frustum shadows, and selective HDR bloom:

```typescript
// src/core/createColonyViewport.ts
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { COLONY_PALETTE } from '../visuals/Palette';

export function createColonyViewport(container: HTMLElement, planet: keyof typeof COLONY_PALETTE.planets = 'desert') {
  const biome = COLONY_PALETTE.planets[planet];

  // 1. Scene & Atmospheric Fog
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(biome.fogColor);
  scene.fog = new THREE.FogExp2(biome.fogColor, 0.007);

  // 2. Telephoto Isometric Camera (28° FOV eliminates perspective distortion)
  const camera = new THREE.PerspectiveCamera(28, window.innerWidth / window.innerHeight, 1, 400);
  camera.position.set(42, 46, 42);
  camera.lookAt(0, 0, 0);

  // 3. Renderer with Filmic Tone Mapping
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // 4. Mandatory IBL Environment (Makes metallic parts look like real metal)
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.75;

  // 5. Key Sun + Cool Sky Hemisphere Fill
  const hemiLight = new THREE.HemisphereLight(biome.skyColor, biome.groundLow, 0.85);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(biome.sunColor, 3.0);
  sunLight.position.set(35, 55, 25);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 5;
  sunLight.shadow.camera.far = 140;
  const d = 35;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  sunLight.shadow.bias = -0.0005;
  scene.add(sunLight);

  // 6. Selective HDR Bloom (Only glows where brightness > 1.1)
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.45, // strength
    0.35, // radius
    1.1   // threshold (>1.0 ensures only HDR emissives bloom!)
  );
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  return { scene, camera, renderer, composer, sunLight };
}
```

---

## 4. Reference Pattern #2: Procedural Hard-Surface Kitbashing Builder

When generating robots, turrets, or stations procedurally in code, use **Vertex Color Material Zones** and merge into a single `BufferGeometry` so 500 complex multi-part robots can still render in **1 `InstancedMesh` draw call**:

```typescript
// src/visuals/kitbash/KitbashBuilder.ts
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { COLONY_PALETTE } from '../Palette';

/**
 * Stamps vertex colors + roughness/metalness attributes onto a geometry part
 * so a single merged mesh can display Armor, Gunmetal Frame, and HDR Glow!
 */
function paintPart(
  geom: THREE.BufferGeometry,
  colorHex: number,
  emissiveIntensity = 0.0,
  matrix?: THREE.Matrix4
): THREE.BufferGeometry {
  const g = geom.index ? geom.toNonIndexed() : geom.clone();
  if (matrix) g.applyMatrix4(matrix);

  const count = g.attributes.position.count;
  const colors = new Float32Array(count * 4);
  const c = new THREE.Color(colorHex);
  // Multiply > 1.0 for HDR emissive parts so UnrealBloomPass catches them!
  const mult = emissiveIntensity > 0 ? emissiveIntensity : 1.0;

  for (let i = 0; i < count; i++) {
    colors[i * 4 + 0] = c.r * mult;
    colors[i * 4 + 1] = c.g * mult;
    colors[i * 4 + 2] = c.b * mult;
    colors[i * 4 + 3] = emissiveIntensity > 0 ? 1.0 : 0.0; // Alpha flags emissive zone
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  return g;
}

/**
 * Example: Procedurally kitbashes a high-detail Autonomous Miner Robot
 * ready for THREE.InstancedMesh (single geometry, rich multi-part silhouette).
 */
export function buildMinerRobotGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const mat = new THREE.Matrix4();

  // 1. Left & Right Tracked Treads (30% Dark Gunmetal Frame)
  for (const side of [-0.55, 0.55]) {
    const tread = new RoundedBoxGeometry(0.32, 0.36, 1.35, 3, 0.08);
    mat.makeTranslation(side, 0.18, 0);
    parts.push(paintPart(tread, COLONY_PALETTE.frameGunmetal.color, 0, mat));
  }

  // 2. Undercarriage Axle & Hydraulic Spine (Gunmetal)
  const undercarriage = new RoundedBoxGeometry(0.95, 0.22, 0.95, 2, 0.04);
  mat.makeTranslation(0, 0.28, 0);
  parts.push(paintPart(undercarriage, COLONY_PALETTE.frameGunmetal.color, 0, mat));

  // 3. Main Chamfered Hull (60% Primary Ceramic Titanium)
  const hull = new RoundedBoxGeometry(0.92, 0.52, 1.05, 4, 0.1);
  mat.makeTranslation(0, 0.62, -0.05);
  parts.push(paintPart(hull, COLONY_PALETTE.hullPrimary.color, 0, mat));

  // 4. Safety Amber Roll-Cage / Shoulder Plates (10% Accent)
  const bumper = new RoundedBoxGeometry(1.04, 0.24, 0.45, 3, 0.06);
  mat.makeTranslation(0, 0.68, -0.35);
  parts.push(paintPart(bumper, COLONY_PALETTE.hullSecondary.color, 0, mat));

  // 5. Recessed Visor + HDR Cyan Sensor Core (Triggers Selective Bloom!)
  const visor = new RoundedBoxGeometry(0.65, 0.14, 0.12, 2, 0.02);
  mat.makeTranslation(0, 0.68, 0.46);
  parts.push(paintPart(visor, COLONY_PALETTE.energyCyan.color, COLONY_PALETTE.energyCyan.intensity, mat));

  // 6. Articulated Mining Laser Arm + Emitter Tip
  const arm = new THREE.CylinderGeometry(0.08, 0.11, 0.75, 8);
  arm.rotateX(Math.PI * 0.42);
  mat.makeTranslation(0.32, 0.78, 0.55);
  parts.push(paintPart(arm, COLONY_PALETTE.frameGunmetal.color, 0, mat));

  const laserTip = new THREE.CylinderGeometry(0.03, 0.09, 0.18, 8);
  laserTip.rotateX(Math.PI * 0.42);
  mat.makeTranslation(0.32, 0.72, 0.92);
  parts.push(paintPart(laserTip, COLONY_PALETTE.warningAmber.color, COLONY_PALETTE.warningAmber.intensity, mat));

  // 7. Curved Power Cable connecting Hull to Laser Arm (Silhouette Breaker!)
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.25, 0.75, -0.2),
    new THREE.Vector3(0.52, 0.55, 0.15), // Natural downward slack
    new THREE.Vector3(0.32, 0.78, 0.45),
  ]);
  const cable = new THREE.TubeGeometry(curve, 12, 0.035, 6, false);
  parts.push(paintPart(cable, COLONY_PALETTE.frameGunmetal.color, 0));

  // 8. Telemetry Antenna + Blinking Beacon
  const antenna = new THREE.CylinderGeometry(0.015, 0.025, 0.55, 6);
  mat.makeTranslation(-0.32, 1.12, -0.38);
  parts.push(paintPart(antenna, COLONY_PALETTE.frameGunmetal.color, 0, mat));

  const beacon = new THREE.SphereGeometry(0.05, 8, 8);
  mat.makeTranslation(-0.32, 1.4, -0.38);
  parts.push(paintPart(beacon, COLONY_PALETTE.energyCyan.color, COLONY_PALETTE.energyCyan.intensity, mat));

  const merged = BufferGeometryUtils.mergeGeometries(parts, false);
  merged.computeVertexNormals();
  return merged;
}
```

---

## 5. Reference Pattern #3: Runtime AI `.glb` Normalizer & Material Unifier

If loading external AI-generated `.glb` models (from TRELLIS, Rodin, or Tripo), always pass them through this normalizer so their scale, bottom pivot, shadow casting, and material response match procedural kitbashed models 100%:

```typescript
// src/core/loadUnifiedModel.ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

export interface UnifiedModelOptions {
  targetSizeMeters?: number; // Normalizes largest horizontal/vertical dimension
  groundDustColor?: number;  // Blends planet dust onto bottom of model
}

export async function loadUnifiedModel(
  url: string,
  options: UnifiedModelOptions = {}
): Promise<THREE.Group> {
  const { targetSizeMeters = 2.0 } = options;
  const gltf = await loader.loadAsync(url);
  const root = gltf.scene;

  // 1. Compute bounding box & normalize scale to exact game grid meters
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = targetSizeMeters / (maxDim || 1);
  root.scale.setScalar(scale);

  // 2. Recompute bounds & snap bottom-center pivot to (0, 0, 0)
  root.updateMatrixWorld(true);
  const scaledBox = new THREE.Box3().setFromObject(root);
  const center = scaledBox.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= scaledBox.min.y; // Bottom sits flush on Y=0 terrain!

  // 3. Sanitize AI PBR Material properties & enable shadows
  root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) {
      const mesh = node as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat && mat.isMeshStandardMaterial) {
        // Fix overly glossy plastic look common in AI-generated PBR maps
        mat.roughness = Math.min(Math.max(mat.roughness, 0.42), 0.85);
        mat.metalness = Math.min(mat.metalness, 0.75);
        mat.envMapIntensity = 0.85;
        mat.needsUpdate = true;
      }
    }
  });

  const wrapper = new THREE.Group();
  wrapper.add(root);
  return wrapper;
}
```
