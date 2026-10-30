import type { DevCommandDef, Feature, FeatureContext } from '../../core/registry/types';
import { parseLine } from './parse';

export type RunResult =
  | { kind: 'text'; text: string; error?: boolean }
  | { kind: 'clear' };

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Command table of the console: every enabled feature's `devCommands` plus the built-ins `help` and `clear`.
 * Features arrive already filtered by flags and host (`loadFeatures`), so a disabled wave's commands do not exist.
 */
export class CommandRunner {
  private readonly table = new Map<string, DevCommandDef>();

  constructor(features: readonly Feature[], private readonly ctx: FeatureContext) {
    for (const f of features) {
      for (const c of f.devCommands ?? []) {
        if (this.table.has(c.name)) { console.warn(`dev command "${c.name}" from ${f.id} ignored: already registered`); continue; }
        this.table.set(c.name, c);
      }
    }
    this.table.set('help', { name: 'help', help: 'List the available commands (help <name> for one)', run: (a) => this.help(a[0]) });
    this.table.set('clear', { name: 'clear', help: 'Clear the output', run: () => '' });
  }

  names(): string[] {
    return [...this.table.keys()].sort();
  }

  private help(name?: string): string {
    if (name) {
      const c = this.table.get(name);
      if (!c) throw new Error(`unknown command "${name}"`);
      return `${c.name}  ${c.help}`;
    }
    const names = this.names();
    const w = Math.max(...names.map((n) => n.length));
    return names.map((n) => `${n.padEnd(w)}  ${this.table.get(n)!.help}`).join('\n');
  }

  /** Never throws: unknown commands, bad arguments and failed async work all come back as an error text. */
  async run(line: string): Promise<RunResult | null> {
    let words: string[];
    try { words = parseLine(line); } catch (e) { return { kind: 'text', text: `error: ${messageOf(e)}`, error: true }; }
    if (words.length === 0) return null;
    const [name, ...args] = words;
    if (name === 'clear') return { kind: 'clear' };
    const cmd = this.table.get(name);
    if (!cmd) return { kind: 'text', text: `unknown command "${name}". Type help for the list.`, error: true };
    try {
      return { kind: 'text', text: await cmd.run(args, this.ctx) };
    } catch (e) {
      return { kind: 'text', text: `error: ${messageOf(e)}`, error: true };
    }
  }
}
