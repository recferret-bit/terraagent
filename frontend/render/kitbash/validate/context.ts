// Shared state of one validation run: the prepared parts, their pairwise relations and the issue list the check stages append to.
import { emptyBox, isWatertight } from './math';
import type { Box } from './math';
import { prepare, relate, type Rel } from './relation';
import type { RoleSummary } from './appearance';
import type { Issue, ModelInput, P, PairStat, Severity, ValidatorOptions } from './types';

export const fmt = (v: number) => (Math.abs(v) < 1 ? `${(v * 100).toFixed(1)} cm` : `${v.toFixed(2)} m`);
export const at = (b: Box): [number, number, number] => [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];

export class ValidationContext {
  readonly issues: Issue[] = [];
  readonly parts: P[];
  readonly triCount: number;
  /** Bounding box of the whole model. */
  readonly all: Box = emptyBox();
  readonly pairs: PairStat[] = [];
  roles?: RoleSummary[]; meanL?: number;
  private rel = new Map<string, Rel>();

  constructor(readonly model: ModelInput, readonly o: ValidatorOptions) {
    this.parts = model.parts.map((d) => { const p = prepare(d); p.closed = isWatertight(d.tris); return p; });
    let triCount = 0;
    for (const p of this.parts) {
      triCount += p.n;
      for (let a = 0; a < 3; a++) { this.all[a] = Math.min(this.all[a], p.box[a]); this.all[a + 3] = Math.max(this.all[a + 3], p.box[a + 3]); }
    }
    this.triCount = triCount;
  }
  get n() { return this.parts.length; }
  get minY() { return this.all[1]; }

  add = (severity: Severity, code: string, message: string, parts: number[], atPt?: [number, number, number], hint?: string) => {
    this.issues.push({ severity, code, message, parts, at: atPt, hint });
  };

  private key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  /** Computes the relation of every part pair (contact graph, crossings, z-fighting). */
  computeRelations() {
    const { parts: P_, n: N, o } = this;
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) this.rel.set(this.key(i, j), relate(P_[i], P_[j], o.nearMiss, o.grazeDist));
  }
  /** Relation of parts i and j (after computeRelations). */
  R = (i: number, j: number) => this.rel.get(this.key(i, j))!;
}

/** One stage of the validator: reads the context and appends issues. */
export type CheckStage = (ctx: ValidationContext) => void;
