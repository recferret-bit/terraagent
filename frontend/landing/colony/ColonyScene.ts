// Canvas2D isometric hex colony: tiles, power grid, structures, robots, lightning strike + repair, night tint, event log.
import { DEPOSIT, DEPOSIT2, DIRS, FOE, HUB, PYLONS, R, buildMap, hash, key, lerp, type Tile } from './hexMap';
import { type Ctx, drawBot, hexPath } from './primitives';
import { type Frame, STRIKE_TARGET, makeFrame, proj } from './frame';
import { drawStructures } from './structures';

const TAU = Math.PI * 2;
const BORDER_ANGLE_STEP = [0, 5, 4, 3, 2, 1]; // neighbour direction -> hex corner index

export class ColonyScene {
  private readonly c: Ctx;
  private readonly tiles: Tile[];
  private readonly map: Record<string, Tile>;
  private readonly sorted: Tile[];

  constructor(private readonly cv: HTMLCanvasElement) {
    this.c = cv.getContext('2d')!;
    const { tiles, map } = buildMap();
    this.tiles = tiles; this.map = map;
    this.sorted = tiles.slice().sort((a, b) => (a.r - b.r) || (a.q - b.q));
  }

  private fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.cv.clientWidth * dpr)), h = Math.max(1, Math.round(this.cv.clientHeight * dpr));
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    return { w, h, dpr };
  }

  draw(t: number) {
    const { w, h, dpr } = this.fit(), c = this.c;
    const f = makeFrame(w, h, dpr, t, R);
    c.setTransform(1, 0, 0, 1, 0, 0);
    const bg = c.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#05070C'); bg.addColorStop(1, '#0B0E15');
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    this.sorted.forEach((tl) => this.drawTile(f, tl));
    this.drawPowerLines(f);
    drawStructures(c, f);
    this.drawRobots(f);
    this.drawLightning(f);
    const day = 0.5 + 0.5 * Math.sin(t * 0.12);
    c.fillStyle = `rgba(5,8,20,${0.35 * (1 - day)})`; c.fillRect(0, 0, w, h);
    this.drawEventLog(f);
  }

  private drawTile(f: Frame, tl: Tile) {
    const { s, dpr } = f, c = this.c, p = proj(f, tl.q, tl.r);
    const ht = tl.h * s * 0.16, y = p.y - ht * 0.2;
    let top = tl.h === 0 ? '#3A2414' : tl.h === 1 ? '#4A2D18' : '#5A371D';
    if (tl.dep) top = '#6B4A22';
    c.fillStyle = '#140D08';
    hexPath(c, p.x, p.y + s * 0.18, s * 0.98); c.fill();
    c.fillStyle = top; hexPath(c, p.x, y, s * 0.98); c.fill();
    if (tl.owner) {
      c.fillStyle = tl.owner === 'A' ? 'rgba(255,106,19,0.16)' : 'rgba(30,91,255,0.2)';
      hexPath(c, p.x, y, s * 0.98); c.fill();
    }
    if (tl.dep) {
      c.fillStyle = '#FFB35C';
      for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(p.x + (hash(tl.q + i, tl.r) - 0.5) * s, p.y + (hash(tl.q, tl.r + i) - 0.5) * s * 0.5, s * 0.07, 0, TAU); c.fill(); }
    }
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1 * dpr; hexPath(c, p.x, y, s * 0.98); c.stroke();
    if (tl.owner) this.drawFrozenBorders(f, tl, p.x, y);
  }

  private drawFrozenBorders(f: Frame, tl: Tile, x: number, y: number) {
    const { s, dpr } = f, c = this.c;
    for (let i = 0; i < 6; i++) {
      const nb = this.map[key(tl.q + DIRS[i][0], tl.r + DIRS[i][1])];
      if (!nb || !nb.owner || nb.owner === tl.owner) continue;
      c.strokeStyle = '#F2F4F7'; c.lineWidth = 2 * dpr; c.setLineDash([4 * dpr, 4 * dpr]);
      const a0 = Math.PI / 180 * (60 * BORDER_ANGLE_STEP[i] - 30), a1 = a0 + Math.PI / 3;
      c.beginPath(); c.moveTo(x + s * Math.cos(a0), y + s * Math.sin(a0) * 0.58); c.lineTo(x + s * Math.cos(a1), y + s * Math.sin(a1) * 0.58); c.stroke();
      c.setLineDash([]);
    }
  }

  private drawPowerLines(f: Frame) {
    const { s, dpr, t } = f, c = this.c;
    const pp = PYLONS.map((p) => { const o = proj(f, p.q, p.r); return { x: o.x, y: o.y - s * 1.1 }; });
    const links = [[0, 1], [1, 2], [0, 3]];
    links.forEach(([a, b]) => {
      const dead = f.severed && (b === STRIKE_TARGET || a === STRIKE_TARGET) && f.repairK < 1;
      c.strokeStyle = dead ? 'rgba(255,59,59,0.5)' : 'rgba(57,208,255,0.85)';
      c.lineWidth = 2 * dpr; c.setLineDash(dead ? [3 * dpr, 6 * dpr] : [10 * dpr, 8 * dpr]);
      c.lineDashOffset = dead ? 0 : -t * 40 * dpr;
      c.beginPath(); c.moveTo(pp[a].x, pp[a].y);
      c.quadraticCurveTo((pp[a].x + pp[b].x) / 2, (pp[a].y + pp[b].y) / 2 + s * 0.35, pp[b].x, pp[b].y); c.stroke();
    });
    c.setLineDash([]);
  }

  /** Miners shuttle hub <-> deposit, a builder runs to the struck pylon, a foe patrols. */
  private drawRobots(f: Frame) {
    const { s, dpr, t, ct } = f, c = this.c;
    const hp = proj(f, HUB.q, HUB.r), dp = proj(f, DEPOSIT.q, DEPOSIT.r), d2 = proj(f, DEPOSIT2.q, DEPOSIT2.r);
    for (let i = 0; i < 4; i++) {
      const k = (t * 0.12 + i * 0.25) % 1, tri = k < 0.5 ? k * 2 : 2 - k * 2;
      const ease = tri * tri * (3 - 2 * tri), target = i % 2 ? dp : d2;
      drawBot(c, lerp(hp.x + s * 0.6, target.x, ease), lerp(hp.y + s * 0.3, target.y, ease), s * 0.95, '#F2F4F7', k < 0.5 ? '#FF6A13' : '#FFB35C', t, i);
    }
    const tp = proj(f, PYLONS[STRIKE_TARGET].q, PYLONS[STRIKE_TARGET].r);
    if (f.severed) {
      const k = Math.min(1, Math.max(0, (ct - 3.6) / 1.6));
      const bx = lerp(hp.x - s * 0.5, tp.x - s * 0.5, k), by = lerp(hp.y + s * 0.5, tp.y + s * 0.3, k);
      drawBot(c, bx, by, s * 1.05, '#FF6A13', '#07080A', t, 9);
      if (k >= 1 && f.repairK < 1) {
        c.strokeStyle = `rgba(57,208,255,${0.5 + 0.5 * Math.sin(t * 30)})`; c.lineWidth = 2 * dpr;
        c.beginPath(); c.moveTo(bx + s * 0.2, by - s * 0.5); c.lineTo(tp.x, tp.y - s * 0.6); c.stroke();
      }
    }
    const fp = proj(f, FOE.q, FOE.r), fq = proj(f, 2, 0), fk = 0.5 + 0.5 * Math.sin(t * 0.5);
    drawBot(c, lerp(fp.x, fq.x, fk), lerp(fp.y + s * 0.4, fq.y, fk), s * 0.9, '#C9CFDA', '#1E5BFF', t, 3);
  }

  private drawLightning(f: Frame) {
    const { s, dpr, t, ct, w, h } = f, c = this.c;
    if (!(ct > 3 && ct < 3.45)) return;
    const tp = proj(f, PYLONS[STRIKE_TARGET].q, PYLONS[STRIKE_TARGET].r);
    const top = { x: tp.x + s * 2, y: 0 }, end = { x: tp.x, y: tp.y - s * 1.1 };
    const seed = Math.floor(t * 20), n = 10, pts = [top];
    for (let i = 1; i < n; i++) { const k = i / n; pts.push({ x: lerp(top.x, end.x, k) + (hash(seed, i) - 0.5) * s * 1.6, y: lerp(top.y, end.y, k) }); }
    pts.push(end);
    c.save(); c.shadowColor = '#9FE7FF'; c.shadowBlur = 24 * dpr;
    c.strokeStyle = '#E9FBFF'; c.lineWidth = 3 * dpr; c.beginPath(); pts.forEach((pt, i) => i ? c.lineTo(pt.x, pt.y) : c.moveTo(pt.x, pt.y)); c.stroke();
    c.restore();
    c.fillStyle = `rgba(200,240,255,${0.22 * (1 - (ct - 3) / 0.45)})`; c.fillRect(0, 0, w, h);
  }

  private drawEventLog(f: Frame) {
    const { dpr, t, ct, h } = f, c = this.c, P = 'P' + (STRIKE_TARGET + 1);
    const log: [string, string][] = [['TICK ' + String(Math.floor(t * 10)).padStart(6, '0'), '#8A93A6']];
    if (ct > 3) log.push([`LIGHTNING STRIKE · PYLON ${P} SEVERED`, '#FF3B3B']);
    if (ct > 3.6) log.push(['BUILDER B1 DISPATCHED', '#FF8A3D']);
    if (ct > 7.4) log.push([`${P} RESTORED · GRID ONLINE`, '#3DDC84']);
    if (ct <= 3) log.push(['GRID ONLINE · 4 MINERS WORKING', '#3DDC84']);
    const fs = Math.round(12 * dpr);
    c.font = `500 ${fs}px "IBM Plex Mono", monospace`;
    const lh = fs * 1.6, bx0 = 16 * dpr, by0 = h - 16 * dpr - lh * log.length;
    c.fillStyle = 'rgba(7,8,10,0.75)'; c.fillRect(bx0 - 8 * dpr, by0 - fs, 330 * dpr, lh * log.length + 10 * dpr);
    log.forEach(([txt, col], i) => { c.fillStyle = col; c.fillText(txt, bx0, by0 + i * lh + fs * 0.4); });
  }
}
