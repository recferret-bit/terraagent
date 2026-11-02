import { describe, expect, it } from 'vitest';
import { glslFloat, injectAll, replaceOrThrow } from './shaderInject';

describe('shader injection helpers (RN-10)', () => {
  it('replaces the first marker only', () => {
    expect(replaceOrThrow('a #m b #m', '#m', 'X')).toBe('a X b #m');
  });

  it('throws when a marker is missing instead of returning the source unchanged', () => {
    expect(() => replaceOrThrow('void main(){}', 'vLP = position;', 'x', 'hex terrain')).toThrow(
      "hex terrain: injection marker 'vLP = position;' not found",
    );
    expect(() => injectAll('#a', [['#a', '1'], ['#b', '2']])).toThrow("marker '#b' not found");
  });

  it('applies pairs in order, so a later marker may come from an earlier chunk', () => {
    expect(injectAll('#a', [['#a', '#b!'], ['#b', 'ok']])).toBe('ok!');
  });

  it('prints GLSL float literals', () => {
    expect(glslFloat(2)).toBe('2.0');
    expect(glslFloat(0.4)).toBe('0.4');
    expect(glslFloat(-10)).toBe('-10.0');
    expect(() => glslFloat(Number.NaN)).toThrow();
  });
});
