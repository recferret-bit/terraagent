// Canvas2D drawing primitives for the isometric colony: hex outline, prism, robot.
export type Ctx = CanvasRenderingContext2D;
const ELLIPSE = Math.PI * 2;

export function hexPath(c: Ctx, x: number, y: number, s: number) {
  c.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 30), px = x + s * Math.cos(a), py = y + s * Math.sin(a) * 0.58;
    i ? c.lineTo(px, py) : c.moveTo(px, py);
  }
  c.closePath();
}

export function drawPrism(c: Ctx, x: number, y: number, s: number, hgt: number, top: string, side: string) {
  c.fillStyle = side; c.beginPath();
  c.moveTo(x - s * 0.5, y); c.lineTo(x - s * 0.5, y - hgt); c.lineTo(x + s * 0.5, y - hgt); c.lineTo(x + s * 0.5, y); c.closePath(); c.fill();
  c.fillStyle = top; c.beginPath(); c.ellipse(x, y - hgt, s * 0.5, s * 0.29, 0, 0, ELLIPSE); c.fill();
}

export function drawBot(c: Ctx, x: number, y: number, s: number, body: string, visor: string, t: number, ph: number) {
  const bob = Math.sin(t * 6 + ph) * s * 0.06;
  c.fillStyle = 'rgba(0,0,0,0.45)'; c.beginPath(); c.ellipse(x, y + s * 0.05, s * 0.34, s * 0.12, 0, 0, ELLIPSE); c.fill();
  const bx = x - s * 0.26, by = y - s * 0.62 + bob, bw = s * 0.52, bh = s * 0.44, k = s * 0.08;
  c.fillStyle = '#1A1D24'; c.fillRect(bx - s * 0.04, by + bh - s * 0.04, bw + s * 0.08, s * 0.12);
  c.fillStyle = body; c.beginPath();
  c.moveTo(bx + k, by); c.lineTo(bx + bw, by); c.lineTo(bx + bw, by + bh - k); c.lineTo(bx + bw - k, by + bh); c.lineTo(bx, by + bh); c.lineTo(bx, by + k); c.closePath(); c.fill();
  c.fillStyle = visor; c.fillRect(bx + bw * 0.18, by + bh * 0.3, bw * 0.64, bh * 0.22);
  c.strokeStyle = '#8A93A6'; c.lineWidth = Math.max(1, s * 0.03); c.beginPath(); c.moveTo(bx + bw * 0.8, by); c.lineTo(bx + bw * 0.95, by - s * 0.22); c.stroke();
  c.fillStyle = visor; c.beginPath(); c.arc(bx + bw * 0.95, by - s * 0.22, s * 0.035, 0, ELLIPSE); c.fill();
}
