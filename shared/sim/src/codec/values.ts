import { decode, encode, ExtensionCodec } from '@msgpack/msgpack';
import { DTYPES, type DType, type TypedArray } from '../kernel/types';

/**
 * MessagePack value encoding shared by the snapshot and the delta builder. Typed arrays travel as MessagePack
 * extension values (one type tag per dtype, raw little-endian bytes), so they survive anywhere in the data, including
 * inside blobs. Everything else is plain MessagePack. Compression is NOT done here: the host gzips snapshots
 * (Node: `zlib.gzipSync`, browser: `CompressionStream('gzip')`) so the engine stays pure and isomorphic.
 *
 * Rules: `undefined` object fields are dropped (as `toEqual` treats them); `undefined` array items and NaN-keyed
 * oddities are not supported; typed arrays assume a little-endian host (all supported targets).
 */
const TAG_BASE = 0x10; // ext types 0x10 + dtype index; MessagePack reserves negative types
const DTYPE_NAMES = Object.keys(DTYPES) as DType[];

export const typedArrayTag = (dtype: DType): number => TAG_BASE + DTYPE_NAMES.indexOf(dtype);

export const extensionCodec = new ExtensionCodec();
DTYPE_NAMES.forEach((name, i) => {
  const Ctor = DTYPES[name];
  extensionCodec.register({
    type: TAG_BASE + i,
    // Exact-constructor check: a Buffer/subclass or other view is not silently treated as this dtype.
    encode: (v: unknown) => (v !== null && typeof v === 'object' && (v as object).constructor === Ctor
      ? new Uint8Array((v as TypedArray).buffer, (v as TypedArray).byteOffset, (v as TypedArray).byteLength)
      : null),
    // `slice` copies into a fresh, aligned buffer (the input is a view into the message).
    decode: (data: Uint8Array) => new Ctor(data.slice().buffer as ArrayBuffer),
  });
});

/** Encodes any plain data (objects, arrays, scalars, typed arrays). */
export const encodeValue = (v: unknown): Uint8Array => encode(v, { extensionCodec, ignoreUndefined: true });

/** Decodes what `encodeValue` produced. Typed arrays come back with their exact type and length. */
export const decodeValue = (bytes: Uint8Array): unknown => decode(bytes, { extensionCodec });
