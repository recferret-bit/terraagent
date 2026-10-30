import * as THREE from 'three';

function canvasTex(draw: (g: CanvasRenderingContext2D, s: number) => void, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}


export function makeGlowTexture() {
  return canvasTex((g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.08, 'rgba(255,245,225,0.9)');
    gr.addColorStop(0.28, 'rgba(255,200,140,0.28)'); gr.addColorStop(0.6, 'rgba(255,150,90,0.06)'); gr.addColorStop(1, 'rgba(255,120,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
}

export function makeStreakTexture() {
  return canvasTex((g, s) => {
    const gr = g.createLinearGradient(0, 0, s, 0);
    gr.addColorStop(0, 'rgba(255,220,170,0)'); gr.addColorStop(0.5, 'rgba(255,240,215,1)'); gr.addColorStop(1, 'rgba(255,220,170,0)');
    g.fillStyle = gr; g.fillRect(0, s * 0.47, s, s * 0.06);
    const v = g.createLinearGradient(0, 0, 0, s); v.addColorStop(0, 'rgba(0,0,0,1)'); v.addColorStop(0.5, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,1)');
  });
}

/** Radial diffraction spikes (two layers counter-rotate for a shimmering star-burst). */
export function makeRaysTexture(seed: number, n: number) {
  return canvasTex((g, sz) => {
    const c = sz / 2; let r = seed;
    const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
    g.translate(c, c);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.12, len = c * (0.35 + rnd() * 0.65), w = 0.012 + rnd() * 0.02;
      const gr = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
      gr.addColorStop(0, 'rgba(255,240,215,0.85)'); gr.addColorStop(0.35, 'rgba(255,200,140,0.22)'); gr.addColorStop(1, 'rgba(255,160,90,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0);
      g.lineTo(Math.cos(a - w) * len, Math.sin(a - w) * len); g.lineTo(Math.cos(a + w) * len, Math.sin(a + w) * len); g.closePath(); g.fill();
    }
  }, 512);
}

export function makeRingTexture() {
  return canvasTex((g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, s * 0.28, s / 2, s / 2, s * 0.5);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(180,210,255,0.5)'); gr.addColorStop(0.9, 'rgba(255,190,150,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
}
