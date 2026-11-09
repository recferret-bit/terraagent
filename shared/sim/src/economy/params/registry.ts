import type { ParamEntry, ParamValue } from './types';
import { checkEntryShape } from './validate';

/** The parameter registry: path → entry. Duplicate paths and self-inconsistent entries throw at registration. */
export class ParamRegistry {
  private readonly entries = new Map<string, ParamEntry>();

  register(...entries: readonly ParamEntry[]): this {
    for (const e of entries) {
      if (this.entries.has(e.path)) throw new Error(`param registry: duplicate path ${e.path}`);
      const problem = checkEntryShape(e);
      if (problem) throw new Error(`param registry: ${e.path}: ${problem}`);
      this.entries.set(e.path, Object.freeze({ ...e }));
    }
    return this;
  }

  has(path: string): boolean { return this.entries.has(path); }
  get(path: string): ParamEntry | undefined { return this.entries.get(path); }
  /** Entries sorted by path (deterministic). */
  list(): readonly ParamEntry[] { return [...this.entries.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)); }
  get size(): number { return this.entries.size; }

  /** Defaults of every entry, path → value (what an empty profile resolves to). */
  defaults(): Record<string, ParamValue> {
    return Object.fromEntries(this.list().map((e) => [e.path, e.default]));
  }
}
