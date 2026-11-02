import { restore, type PlanetState } from '@terra/sim';

type TypedArray = Float32Array | Float64Array | Int8Array | Int16Array | Int32Array | Uint8Array | Uint16Array | Uint32Array;

export interface CompareOptions {
  /** Max |Δ| of a float column value (positions, rotation, hp, progress; tiles) before it counts as a difference (D-31: parity, not bit-exactness). */
  readonly posTolerance?: number;
  /** Max differences listed in the report. */
  readonly maxDiffs?: number;
}

export interface CompareResult {
  readonly ok: boolean;
  readonly tick: number;
  readonly entities: number;
  /** Largest float-column difference seen (also when within tolerance). */
  readonly maxPosDelta: number;
  readonly diffs: readonly string[];
}

const isFloat = (a: TypedArray): boolean => a instanceof Float32Array || a instanceof Float64Array;

class Differ {
  readonly diffs: string[] = [];
  maxPosDelta = 0;
  constructor(readonly tol: number, readonly limit: number) {}

  add(msg: string): void { if (this.diffs.length < this.limit) this.diffs.push(msg); else if (this.diffs.length === this.limit) this.diffs.push('... more differences omitted'); }

  scalar(path: string, a: unknown, b: unknown): void { if (!Object.is(a, b) && a !== b) this.add(`${path}: ${String(a)} != ${String(b)}`); }

  /** Typed columns: floats within the tolerance, everything else exactly. `n` limits the compared prefix (entity rows). */
  column(path: string, a: TypedArray, b: TypedArray, n = Math.min(a.length, b.length)): void {
    const float = isFloat(a);
    for (let i = 0; i < n; i++) {
      const d = Math.abs(a[i] - b[i]);
      if (float) this.maxPosDelta = Math.max(this.maxPosDelta, d);
      if (float ? d > this.tol : a[i] !== b[i]) this.add(`${path}[${i}]: ${a[i]} != ${b[i]}${float ? ` (|Δ| ${d.toFixed(4)} > ${this.tol})` : ''}`);
    }
  }

  /** Plain data (colonies, blobs): structural, exact. */
  deep(path: string, a: unknown, b: unknown): void {
    if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) return this.column(path, a as unknown as TypedArray, b as unknown as TypedArray);
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return this.scalar(path, a, b);
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.join('\0') !== kb.join('\0')) return this.add(`${path}: keys [${ka}] != [${kb}]`);
    for (const k of ka) this.deep(`${path}.${k}`, (a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]);
  }
}

function compareStates(a: PlanetState, b: PlanetState, d: Differ): void {
  // Everything but the planet id (each host mints its own) is discrete state that must match.
  for (const k of ['simVersion', 'planetType', 'seed', 'tick', 'nextEntityId', 'ended'] as const) d.scalar(`meta.${k}`, a.meta[k], b.meta[k]);
  for (const s of Object.keys(a.rng) as (keyof PlanetState['rng'])[]) d.column(`rng.${s}`, a.rng[s], b.rng[s]);
  d.scalar('grid.radius', a.grid.radius, b.grid.radius);
  d.scalar('grid.count', a.grid.count, b.grid.count);
  for (const name of new Set([...Object.keys(a.grid.layers), ...Object.keys(b.grid.layers)])) {
    const la = a.grid.layers[name], lb = b.grid.layers[name];
    if (!la || !lb) d.add(`grid.layers.${name}: missing on one side`); else d.column(`grid.layers.${name}`, la, lb);
  }
  d.deep('colonies', a.colonies, b.colonies);
  d.deep('blobs', a.blobs, b.blobs);
  d.scalar('entities.count', a.entities.count, b.entities.count);
  const n = Math.min(a.entities.count, b.entities.count);
  for (const name of new Set([...Object.keys(a.entities.cols), ...Object.keys(b.entities.cols)])) {
    const ca = a.entities.cols[name], cb = b.entities.cols[name];
    if (!ca || !cb) d.add(`entities.${name}: missing on one side`); else d.column(`entities.${name}`, ca, cb, n);
  }
}

/** Compares two snapshots (server host vs local host): discrete state equal, float columns within `posTolerance` (default 0.01 tile). */
export function compareSnapshots(a: Uint8Array, b: Uint8Array, o: CompareOptions = {}): CompareResult {
  const d = new Differ(o.posTolerance ?? 0.01, o.maxDiffs ?? 30);
  const sa = restore(a), sb = restore(b);
  compareStates(sa, sb, d);
  return { ok: d.diffs.length === 0, tick: sa.meta.tick, entities: sa.entities.count, maxPosDelta: d.maxPosDelta, diffs: d.diffs };
}
