import { DEPOSIT, FOE_B, PYLONS, SOLARS } from './hexMap';
import { type Ctx, drawPrism, hexPath } from './primitives';
import { type Frame, STRIKE_TARGET, proj } from './frame';

type Kind = 'solar' | 'hub' | 'pylon' | 'mine' | 'foehub' | 'foe';
interface Item { q: number; r: number; kind: Kind; i?: number }
type Painter = (c: Ctx, f: Frame, p: { x: number; y: number }, it: Item) => void;
const TAU = Math.PI * 2;

const hub: Painter = (c, f, p) => {
  const { s, t } = f;
  drawPrism(c, p.x, p.y, s * 1.3, s * 0.55, '#E9ECF2', '#9AA3B5');
  drawPrism(c, p.x, p.y - s * 0.55, s * 0.9, s * 0.45, '#FF6A13', '#B4470A');
  drawPrism(c, p.x, p.y - s * 1.0, s * 0.36, s * 0.5, '#F2F4F7', '#6B7385');
  c.fillStyle = '#39D0FF'; c.beginPath(); c.arc(p.x, p.y - s * 1.55, s * 0.08 * (1 + 0.3 * Math.sin(t * 4)), 0, TAU); c.fill();
};

const pylon: Painter = (c, f, p, it) => {
  const { s, dpr } = f, dead = f.severed && it.i === STRIKE_TARGET && f.repairK < 1;
  c.strokeStyle = '#C9CFDA'; c.lineWidth = 3 * dpr; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x, p.y - s * 1.1); c.stroke();
  c.lineWidth = 2 * dpr; c.beginPath(); c.moveTo(p.x - s * 0.25, p.y - s * 0.9); c.lineTo(p.x + s * 0.25, p.y - s * 0.9); c.stroke();
  c.fillStyle = dead ? '#FF3B3B' : '#39D0FF';
  c.beginPath(); c.arc(p.x, p.y - s * 1.1, s * 0.09, 0, TAU); c.fill();
  if (dead) { c.font = `600 ${Math.round(s * 0.28)}px "IBM Plex Mono", monospace`; c.fillStyle = '#FF3B3B'; c.fillText('OFFLINE', p.x + s * 0.2, p.y - s * 1.3); }
};

const solar: Painter = (c, f, p, it) => {
  const { s, dpr, t } = f, glint = 0.5 + 0.5 * Math.sin(t * 1.5 + it.q);
  c.fillStyle = '#0E2A80'; hexPath(c, p.x, p.y - s * 0.25, s * 0.62); c.fill();
  c.strokeStyle = `rgba(91,140,255,${0.5 + 0.5 * glint})`; c.lineWidth = 1.5 * dpr; hexPath(c, p.x, p.y - s * 0.25, s * 0.62); c.stroke();
  c.strokeStyle = 'rgba(91,140,255,0.45)'; c.beginPath(); c.moveTo(p.x - s * 0.5, p.y - s * 0.25); c.lineTo(p.x + s * 0.5, p.y - s * 0.25); c.stroke();
};

const mine: Painter = (c, f, p) => {
  const { s, dpr, t } = f;
  drawPrism(c, p.x, p.y, s * 0.8, s * 0.35, '#FF8A3D', '#8A3F14');
  c.strokeStyle = '#F2F4F7'; c.lineWidth = 2 * dpr; c.beginPath(); c.moveTo(p.x, p.y - s * 0.35); c.lineTo(p.x + Math.cos(t * 3) * s * 0.3, p.y - s * 0.7); c.stroke();
};

const foehub: Painter = (c, f, p) => {
  drawPrism(c, p.x, p.y, f.s * 1.2, f.s * 0.5, '#E9ECF2', '#9AA3B5');
  drawPrism(c, p.x, p.y - f.s * 0.5, f.s * 0.8, f.s * 0.5, '#1E5BFF', '#0E2A80');
};

const foe: Painter = (c, f, p) => drawPrism(c, p.x, p.y, f.s * 0.6, f.s * 0.4, '#5B8CFF', '#1E3F99');

const PAINTERS: Record<Kind, Painter> = { hub, pylon, solar, mine, foehub, foe };

/** All structures, painter's order by r. */
export function drawStructures(c: Ctx, f: Frame) {
  const items: Item[] = [];
  SOLARS.forEach((o) => items.push({ q: o.q, r: o.r, kind: 'solar' }));
  PYLONS.forEach((o, i) => items.push({ q: o.q, r: o.r, kind: i === 0 ? 'hub' : 'pylon', i }));
  FOE_B.forEach((o, i) => items.push({ q: o.q, r: o.r, kind: i === 0 ? 'foehub' : 'foe' }));
  items.push({ q: DEPOSIT.q, r: DEPOSIT.r, kind: 'mine' });
  items.sort((a, b) => a.r - b.r);
  for (const it of items) PAINTERS[it.kind](c, f, proj(f, it.q, it.r), it);
}
