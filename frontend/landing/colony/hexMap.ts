// Hex map data for the landing colony scene: axial coordinates, ownership zones, deposits and structure positions.
export interface Hex { q: number; r: number }
export interface Tile extends Hex { h: number; owner: 'A' | 'B' | null; dep: number }

export const R = 7, S3 = Math.sqrt(3);
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export const HUB: Hex = { q: -3, r: 1 }, FOE: Hex = { q: 4, r: -2 };
export const DEPOSIT: Hex = { q: 0, r: 2 }, DEPOSIT2: Hex = { q: -5, r: 4 };
export const PYLONS: Hex[] = [{ q: -3, r: 1 }, { q: -1, r: 1 }, { q: 1, r: 0 }, { q: -2, r: -1 }];
export const SOLARS: Hex[] = [{ q: -4, r: 0 }, { q: -5, r: 1 }, { q: -4, r: 2 }];
export const FOE_B: Hex[] = [{ q: 4, r: -2 }, { q: 5, r: -3 }, { q: 3, r: -1 }];

export const key = (q: number, r: number) => q + ',' + r;
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const hash = (q: number, r: number) => { const s = Math.sin(q * 127.1 + r * 311.7) * 43758.5453; return s - Math.floor(s); };
const dist = (a: Hex, b: Hex) => (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;

export function buildMap() {
  const tiles: Tile[] = [];
  for (let q = -R; q <= R; q++) for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) {
    const dA = dist({ q, r }, HUB), dB = dist({ q, r }, FOE);
    const owner = dA <= 4 ? 'A' : (dB <= 3 ? 'B' : null);
    tiles.push({ q, r, h: Math.floor(hash(q, r) * 3), owner, dep: hash(q + 9, r - 4) > 0.9 && !owner ? 1 : 0 });
  }
  const map: Record<string, Tile> = {};
  tiles.forEach((t) => { map[key(t.q, t.r)] = t; });
  map[key(DEPOSIT.q, DEPOSIT.r)].dep = 1; map[key(DEPOSIT.q, DEPOSIT.r)].owner = null;
  const d2 = map[key(DEPOSIT2.q, DEPOSIT2.r)]; if (d2) d2.dep = 1;
  return { tiles, map };
}
