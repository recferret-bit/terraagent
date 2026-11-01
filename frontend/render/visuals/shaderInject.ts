/** Helpers for `onBeforeCompile` shader injection: fail loudly instead of silently compiling a half-patched shader. */

/** `src` with the first `marker` replaced by `chunk`; throws when `marker` is missing (the patch would be a no-op). */
export function replaceOrThrow(src: string, marker: string, chunk: string, what = 'shader'): string {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`${what}: injection marker '${marker}' not found (three.js chunk renamed or patch order changed)`);
  return src.slice(0, at) + chunk + src.slice(at + marker.length);
}

/** Applies `[marker, chunk]` pairs in order with `replaceOrThrow`. */
export function injectAll(src: string, pairs: ReadonlyArray<readonly [string, string]>, what = 'shader'): string {
  return pairs.reduce((s, [marker, chunk]) => replaceOrThrow(s, marker, chunk, what), src);
}

/** A TypeScript number as a GLSL float literal (`2` -> `2.0`, `0.4` -> `0.4`), so shader constants come from TS. */
export function glslFloat(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`glslFloat: ${n} is not finite`);
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}
