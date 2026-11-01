/** Splits a console line on whitespace; "double" or 'single' quotes group words (no escapes). Throws on an unterminated quote. */
export function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  let has = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null; else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch; has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) { out.push(cur); cur = ''; has = false; }
    } else cur += ch;
  }
  if (quote) throw new Error(`unterminated ${quote} quote`);
  if (has || cur) out.push(cur);
  return out;
}

/** Reads `args[i]` as a number; `fallback` when it is missing, an error naming the argument when it is not numeric. */
export function numArg(args: readonly string[], i: number, name: string, fallback?: number): number {
  const raw = args[i];
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing <${name}>`);
  }
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(n)) throw new Error(`<${name}> must be a number, got "${raw}"`);
  return n;
}

/** Reads `args[i]` as a whole number (see {@link numArg}); an error naming the argument when it has a fraction. */
export function intArg(args: readonly string[], i: number, name: string, fallback?: number): number {
  const n = numArg(args, i, name, fallback);
  if (!Number.isInteger(n)) throw new Error(`<${name}> must be a whole number, got "${args[i]}"`);
  return n;
}
