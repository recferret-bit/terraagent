import { decode, encode } from '@msgpack/msgpack';

/**
 * Wire format. JSON text frames for every message (WS-01), except messages that carry engine bytes (`welcome`,
 * `delta`, D-31): those go as one binary frame holding the MessagePack encoding of the whole envelope, so the bytes
 * travel without base64. Both ends decode with `decodeWire`, then validate with the zod schemas.
 */
export type WireFrame = string | Uint8Array;

const carriesBytes = (v: unknown, depth = 0): boolean => {
  if (v instanceof Uint8Array) return true;
  if (depth > 3 || v === null || typeof v !== 'object') return false;
  return Object.values(v as Record<string, unknown>).some((x) => carriesBytes(x, depth + 1));
};

export function encodeWire(msg: object): WireFrame {
  return carriesBytes(msg) ? encode(msg, { ignoreUndefined: true }) : JSON.stringify(msg);
}

export function decodeWire(frame: string | ArrayBuffer | ArrayBufferView): unknown {
  if (typeof frame === 'string') return JSON.parse(frame);
  const bytes = frame instanceof ArrayBuffer ? new Uint8Array(frame) : new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
  return decode(bytes);
}
