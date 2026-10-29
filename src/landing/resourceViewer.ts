// Landing page, section 03: the five resource cards are tabs. Selecting one swaps the live 3D model (the same kitbash
// archetypes, Unifier material and diorama viewport as the game) and the technical sheet beside it. Metals is the default.
import * as THREE from 'three';
import { createColonyViewport } from '../core/createColonyViewport';
import { PLANET_SPECS, type PlanetKind } from '../planets/PlanetSpec';
import '../kitbash';
import { createArchetypeMesh, tickArchetypeMesh, type ArchetypeMesh } from '../kitbash';

interface ResourceInfo {
  archetype: string; biome: PlanetKind; symbol: string; name: string;
  science: string; specs: [string, string][]; game: string;
}

const RES: Record<string, ResourceInfo> = {
  metals: {
    archetype: 'resource.metalDeposit', biome: 'dune', symbol: 'Fe · Al · Cu', name: 'Metals',
    science: 'Metal-bearing rock: iron oxides such as hematite (Fe₂O₃) and magnetite (Fe₃O₄), plus aluminium and copper ores. A reducing furnace strips the oxygen out. Exposed veins weather rust-red because iron oxidises on contact with air.',
    specs: [['Key ores', 'Hematite · Magnetite · Bauxite'], ['Iron density', '7.87 g/cm³'], ['Iron melts at', '1,538 °C'], ['Processing', 'Reduction smelting']],
    game: 'Mined by the Mine (2×2). Spent on robots, buildings, rockets and ammo.',
  },
  minerals: {
    archetype: 'resource.crystalDeposit', biome: 'forestRock', symbol: 'SiO₂', name: 'Minerals',
    science: 'Crystalline silicates and oxides. Quartz (SiO₂) is the feedstock for silicon wafers, and its lattice is piezoelectric, so it also keeps time in oscillators. Rare-earth minerals supply the dopants electronics need. In the game, cyan glow marks a high-purity deposit.',
    specs: [['Key phases', 'Quartz · Feldspar · Monazite'], ['Quartz hardness', '7 Mohs'], ['Quartz density', '2.65 g/cm³'], ['Quartz melts at', '≈ 1,713 °C']],
    game: 'Refined into advanced parts and electronics.',
  },
  petroleum: {
    archetype: 'resource.oilDeposit', biome: 'dune', symbol: 'CₙH₂ₙ₊₂', name: 'Petroleum',
    science: 'Crude oil is a mixture of hydrocarbons, mostly alkanes, formed from buried organic matter. Fractional distillation separates it by boiling point into gases, gasoline, kerosene, diesel and heavy residue. Cracking breaks the same molecules into the building blocks of plastics.',
    specs: [['Composition', '83–87 % C · 10–14 % H'], ['Density', '0.80–0.95 g/cm³'], ['Boiling range', '30 °C to over 500 °C'], ['Energy content', '≈ 42–46 MJ/kg']],
    game: 'Burned as fuel, polymerised into plastics, and used for some power.',
  },
  water: {
    archetype: 'building.waterPump', biome: 'oceanForest', symbol: 'H₂O', name: 'Water',
    science: 'A polar molecule whose hydrogen bonds give it an unusually high heat capacity, which makes it the standard coolant. Density peaks at 4 °C, which is why ice floats. Electrolysis splits it into hydrogen and oxygen, and plants turn it into biomass.',
    specs: [['Density', '1.000 g/cm³ at 4 °C'], ['Specific heat', '4.18 J/(g·K)'], ['Boils at', '100 °C at 1 atm'], ['Latent heat', '2,257 kJ/kg (vaporisation)']],
    game: 'Drawn by the Water Pump (1×1). Used for cooling, terraforming and biology.',
  },
  energy: {
    archetype: 'building.solar', biome: 'dune', symbol: 'W = J/s', name: 'Energy',
    science: 'Electrical power, measured in watts. Sunlight delivers about 1,361 W/m² at 1 AU, and a silicon panel at roughly 20 % efficiency turns about 270 W/m² of that into current, less at night and in storms. Charge is stored in capacitors and cells.',
    specs: [['Solar constant', '1,361 W/m² at 1 AU'], ['Silicon PV efficiency', '≈ 20 %'], ['Coal energy content', '≈ 24 MJ/kg'], ['Unit', '1 W = 1 J per second']],
    game: 'Shown here: the Solar Array (2×2). Every building draws power, even storage silos.',
  },
};

const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-res]')];
const stage = document.getElementById('rv-stage');
const info = document.getElementById('rv-info');
const tag = document.getElementById('rv-tag');
if (tabs.length && stage && info) init(stage, info, tag);

function init(stageEl: HTMLElement, infoEl: HTMLElement, tagEl: HTMLElement | null) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let current = '';

  // ---- info sheet (works without WebGL)
  const renderInfo = (key: string) => {
    const r = RES[key];
    infoEl.innerHTML = `<p class="label rv-sym">${r.symbol}</p><h3 class="h3 rv-name">${r.name}</h3><p class="rv-sci">${r.science}</p>
      <dl class="rv-specs">${r.specs.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <p class="rv-game"><span class="label">IN THE GAME</span>${r.game}</p>`;
    infoEl.classList.remove('rv-swap'); void infoEl.offsetWidth; infoEl.classList.add('rv-swap');
  };

  const setTab = (key: string, focus = false) => {
    tabs.forEach((t) => { const on = t.dataset.res === key; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
    if (key === current) return;
    current = key; renderInfo(key); show(key);
  };
  tabs.forEach((t, i) => {
    t.onclick = () => setTab(t.dataset.res!);
    t.onkeydown = (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); setTab(tabs[(i + d + tabs.length) % tabs.length].dataset.res!, true); }
    };
  });

  // ---- 3D viewer
  let show: (key: string) => void = () => {};
  try {
    const vp = createColonyViewport(stageEl);
    const scene = vp.scene, camera = vp.camera;
    const BG = new THREE.Color(0x0b0d11);
    vp.sun.shadow.normalBias = 0.04; vp.sun.shadow.bias = -0.001;
    scene.background = BG; (scene.fog as THREE.FogExp2).color.copy(BG);

    // pedestal: slab + top + blue rim + faint grid, scaled per model
    const ped = new THREE.Group(); scene.add(ped);
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.8, metalness: 0.2 });
    const topMat = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.9 });
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.04, 0.3, 64), slabMat); slab.position.y = -0.152; slab.receiveShadow = true;
    const top = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), topMat); top.position.y = -0.002; top.receiveShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.025, 8, 96).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1e5bff, emissive: 0x1e5bff, emissiveIntensity: 3 }));
    const grid = new THREE.GridHelper(2, 8, 0x5b8cff, 0x2a2f3a); grid.position.y = 0.003; (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.5;
    ped.add(slab, top, rim, grid);

    let mesh: ArchetypeMesh | null = null;
    let born = 0, time = 0;
    let center = new THREE.Vector3(0, 0.6, 0), dist = 8, tDist = 8, tCenter = center.clone();

    show = (key) => {
      const r = RES[key];
      if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
      const spec = PLANET_SPECS[r.biome];
      mesh = createArchetypeMesh(r.archetype, spec.biomeKey);
      scene.add(mesh);
      topMat.color.setHex(spec.palette.groundLow).lerp(new THREE.Color(0x0b0d11), 0.8);
      vp.sun.color.set(spec.sky.sunColor); vp.sun.intensity = spec.sky.sunIntensity; // warm key per biome; sky/background stay HUD-dark
      (scene.fog as THREE.FogExp2).density = 0.004;
      const box = new THREE.Box3().setFromObject(mesh);
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.length() / 2, 0.9);
      const pr = Math.max(1.5, Math.hypot(size.x, size.z) * 0.5 + 0.3);
      ped.scale.set(pr, 1, pr);
      tCenter = new THREE.Vector3(0, size.y * 0.45, 0);
      tDist = (radius / Math.sin(THREE.MathUtils.degToRad(14))) * 1.35;
      born = time;
      if (tagEl) tagEl.textContent = `LIVE RENDER · ${r.archetype} · ${(mesh.geometry.index ? mesh.geometry.index.count / 3 : mesh.geometry.attributes.position.count / 3).toLocaleString('en-US')} TRIS`;
      if (reduced) frame(0);
    };

    const frame = (dt: number) => {
      time += dt;
      // ease the framing between models, then drift the camera around the pedestal
      const k = 1 - Math.exp(-dt * 5);
      center.lerp(tCenter, dt ? k : 1); dist += (tDist - dist) * (dt ? k : 1);
      const az = reduced ? 0.8 : 0.8 + time * 0.28, el = THREE.MathUtils.degToRad(26 + Math.sin(time * 0.35) * 3);
      camera.position.set(center.x + Math.cos(az) * Math.cos(el) * dist, center.y + Math.sin(el) * dist, center.z + Math.sin(az) * Math.cos(el) * dist);
      camera.lookAt(center);
      if (mesh) {
        const a = Math.min(1, (time - born) / 0.45), e = 1 - Math.pow(1 - a, 3);
        mesh.scale.setScalar(Math.max(0.001, e)); // grow-in on swap
        tickArchetypeMesh(mesh, time);
      }
      vp.followShadow(center);
      vp.render();
    };

    let visible = true, last = performance.now(), raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      if (visible) frame(dt);
    };
    new IntersectionObserver((es) => { visible = es[0].isIntersecting; last = performance.now(); }).observe(stageEl);
    if (!reduced) raf = requestAnimationFrame(loop);
    void raf;
    new ResizeObserver(() => vp.resize()).observe(stageEl);
    stageEl.classList.add('is-live');
  } catch (e) {
    console.warn('resource viewer: WebGL unavailable, showing the sheet only', e);
    stageEl.classList.add('is-fallback');
  }

  setTab('metals');
}
