// Shared state of one appearance run: measured parts, their touching neighbours and the issue list the rules append to.
import { measure, type Stat } from './measure';
import type { Issue, P, ValidatorOptions } from '../types';

export const dirName = (n: number[]) => {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  if (ay >= ax && ay >= az) return n[1] > 0 ? 'top' : 'bottom';
  if (ax >= az) return n[0] > 0 ? '+X (right)' : '-X (left)';
  return n[2] > 0 ? '+Z (front)' : '-Z (back)';
};
export const at = (c: number[]): [number, number, number] => [c[0], c[1], c[2]];
export const needFor = (area: number, o: ValidatorOptions) => (area >= o.flatFace * 10 ? 4 : area >= o.flatFace * 5 ? 3 : area >= o.flatFace * 2.5 ? 2 : area >= o.flatFace ? 1 : 0);

export class AppearanceContext {
  readonly issues: Issue[] = [];
  readonly S: Stat[];
  readonly total: number;
  /** Options with the area thresholds scaled to the model size. */
  readonly o: ValidatorOptions;
  readonly near: Stat[][];
  /** Parts already reported by a role rule (the generic flat-surface check skips them). */
  readonly flagged = new Set<number>();

  constructor(parts: P[], touching: (a: number, b: number) => boolean, opts: ValidatorOptions) {
    this.S = parts.map(measure);
    this.total = this.S.reduce((s, x) => s + x.area, 0) || 1;
    // area thresholds are relative to the model's longest side squared, so a carrier and a robot are judged alike
    const bb = parts.reduce((m, p) => [Math.min(m[0], p.box[0]), Math.min(m[1], p.box[1]), Math.min(m[2], p.box[2]), Math.max(m[3], p.box[3]), Math.max(m[4], p.box[4]), Math.max(m[5], p.box[5])], [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
    const sc = Math.max(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]) ** 2;
    this.o = { ...opts, flatFace: opts.flatFace * sc, insetMin: opts.insetMin * sc, cellMaxFace: opts.cellMaxFace * sc };
    this.near = this.S.map((x) => this.S.filter((y) => y !== x && touching(x.i, y.i)));
  }

  add = (severity: Issue['severity'], code: string, message: string, ps: number[], where?: [number, number, number], hint?: string) => {
    this.issues.push({ severity, code, message, parts: ps, at: where, hint });
  };
  /** Touching neighbours of a part. */
  nearOf(s: Stat): Stat[] { return this.near[this.S.indexOf(s)]; }
}
