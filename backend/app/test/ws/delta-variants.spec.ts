import { decodeWire, ServerMessage } from '@terra/contracts';
import { packDeltaBundle } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { deltaVariants } from '../../src/ws/rooms';

const bytes = (...b: number[]) => new Uint8Array(b);
const base = bytes(0x81, 0xa1, 0x76, 0x03); // any engine-diff-shaped map: the room never decodes it
const own = [{ colony: 0, bytes: bytes(1, 1) }, { colony: 2, bytes: bytes(2, 2) }];
const parse = (f: string | Uint8Array) => {
  const m = ServerMessage.parse(decodeWire(f));
  if (m.t !== 'delta') throw new Error(m.t);
  return m.d;
};

describe('per-viewer delta variants (PlanetRooms fanout)', () => {
  it('gives each colony its own frames, a full viewer all of them, and encodes each variant once', () => {
    const frame = deltaVariants({ fromTick: 4, toTick: 5, diff: packDeltaBundle(base, own), events: [] });
    expect(parse(frame(0))).toMatchObject({ fromTick: 4, toTick: 5, diff: base, own: [own[0].bytes] });
    expect(parse(frame(2)).own).toEqual([own[1].bytes]);
    expect(parse(frame(undefined)).own).toEqual([own[0].bytes, own[1].bytes]);
    expect(parse(frame(1)).own).toBeUndefined(); // nothing of colony 1 changed: summary only
    expect(frame(0)).toBe(frame(0));
  });

  it('passes a plain diff through unchanged with no own frames', () => {
    const frame = deltaVariants({ fromTick: 1, toTick: 2, diff: base, events: [] });
    expect(parse(frame(3))).toMatchObject({ diff: base });
    expect(parse(frame(undefined)).own).toBeUndefined();
  });
});
