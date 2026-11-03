import { mapScaleForRadius } from './rasterCache';

/**
 * Faint hex lattice drawn around the known planet so the global map reads as endless. It is a single cached
 * pattern tile (one period = 2 hexes) filled over the visible rectangle: constant cost at any zoom.
 * Placeholder for real neighbouring sectors (W27 planet atlas).
 */
const PAT_W = 64;
const PAT_H = Math.round(PAT_W * Math.sqrt(3));
let patternCanvas: HTMLCanvasElement | null = null;

function buildPatternCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = PAT_W;
  c.height = PAT_H;
  let g: CanvasRenderingContext2D | null = null;
  try {
    g = c.getContext('2d');
  } catch {
    g = null;
  }
  if (!g) return null;
  const rp = 1 / Math.sqrt(3);
  g.strokeStyle = 'rgba(150, 178, 224, 0.34)';
  g.lineWidth = 2.5;
  g.lineJoin = 'round';
  for (const [cx, cy] of [[0, 0], [0.5, 0.5]] as const) {
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 180) * (60 * k - 30);
          const x = (cx + ox + rp * Math.cos(a)) * PAT_W;
          const y = (cy + oy + (rp * Math.sin(a)) / Math.sqrt(3)) * PAT_H;
          if (k === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.closePath();
        g.stroke();
      }
    }
  }
  return c;
}

/**
 * `ctx` must carry the viewport transform and the translation to the planet square (side `size`, planet
 * centre at size/2). Skipped when hexes would be < 5 px (moiré).
 */
export function drawUnchartedLattice(
  ctx: CanvasRenderingContext2D,
  size: number,
  radius: number,
  zoom: number,
  canvasW: number,
  canvasH: number,
): void {
  if (typeof ctx.createPattern !== 'function' || typeof ctx.getTransform !== 'function') return;
  const scale = mapScaleForRadius(size, radius);
  if (scale * zoom < 5) return;
  patternCanvas ??= buildPatternCanvas();
  if (!patternCanvas) return;
  const pattern = ctx.createPattern(patternCanvas, 'repeat');
  if (!pattern || typeof pattern.setTransform !== 'function') return;
  pattern.setTransform(
    new DOMMatrix()
      .translate(size / 2, size / 2)
      .scale(scale / PAT_W, (scale * Math.sqrt(3)) / PAT_H),
  );
  const inv = ctx.getTransform().inverse();
  const pts = [
    inv.transformPoint({ x: 0, y: 0 }),
    inv.transformPoint({ x: canvasW, y: 0 }),
    inv.transformPoint({ x: 0, y: canvasH }),
    inv.transformPoint({ x: canvasW, y: canvasH }),
  ];
  const x0 = Math.min(...pts.map((p) => p.x));
  const x1 = Math.max(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y));
  const y1 = Math.max(...pts.map((p) => p.y));
  ctx.save();
  ctx.fillStyle = pattern;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}
