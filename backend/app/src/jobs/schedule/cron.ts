/**
 * Minimal UTC cron matcher for the in-memory adapter (pg-boss evaluates cron itself). Five fields
 * (`min hour dom mon dow`) or six with a leading seconds field; each field takes `*`, `n`, `a-b`, `*\/s`, `a-b/s` and
 * comma lists. Day-of-month and day-of-week combine with AND (no `L`, `W`, `#` or names).
 */

interface CronFields {
  readonly sec: ReadonlySet<number>;
  readonly min: ReadonlySet<number>;
  readonly hour: ReadonlySet<number>;
  readonly dom: ReadonlySet<number>;
  readonly mon: ReadonlySet<number>;
  readonly dow: ReadonlySet<number>;
}

const RANGES: readonly (readonly [number, number])[] = [[0, 59], [0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
const MINUTE_MS = 60_000;
/** Search horizon: one leap year of minutes. */
const MAX_MINUTES = 366 * 24 * 60;

function parseField(text: string, [lo, hi]: readonly [number, number]): Set<number> {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const [range, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    let from = lo;
    let to = hi;
    if (range !== '*') {
      const [a, b] = (range ?? '').split('-');
      from = Number(a);
      to = b === undefined ? (stepText === undefined ? from : hi) : Number(b);
    }
    if (![from, to, step].every(Number.isInteger) || step < 1 || from < lo || to > hi || from > to) {
      throw new Error(`bad cron field "${text}"`);
    }
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) throw new Error(`cron "${expr}" needs 5 or 6 fields`);
  const full = parts.length === 6 ? parts : ['0', ...parts];
  const [sec, min, hour, dom, mon, dow] = full.map((f, i) => parseField(f, RANGES[i] as readonly [number, number]));
  return { sec: sec!, min: min!, hour: hour!, dom: dom!, mon: mon!, dow: dow! };
}

function minuteMatches(f: CronFields, d: Date): boolean {
  return f.min.has(d.getUTCMinutes()) && f.hour.has(d.getUTCHours()) && f.dom.has(d.getUTCDate())
    && f.mon.has(d.getUTCMonth() + 1) && f.dow.has(d.getUTCDay());
}

/** First occurrence strictly after `fromMs`, or `null` inside a year. */
export function nextCronMs(expr: string | CronFields, fromMs: number): number | null {
  const f = typeof expr === 'string' ? parseCron(expr) : expr;
  const seconds = [...f.sec].sort((a, b) => a - b);
  let minute = Math.floor(fromMs / MINUTE_MS) * MINUTE_MS;
  for (let i = 0; i <= MAX_MINUTES; i++, minute += MINUTE_MS) {
    if (!minuteMatches(f, new Date(minute))) continue;
    for (const s of seconds) if (minute + s * 1000 > fromMs) return minute + s * 1000;
  }
  return null;
}
