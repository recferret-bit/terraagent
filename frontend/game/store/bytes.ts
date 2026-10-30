/** Bytes that exactly fill their buffer, so the buffer can be transferred without detaching unrelated data. */
export const ownBytes = (u: Uint8Array): Uint8Array<ArrayBuffer> =>
  u.byteOffset === 0 && u.byteLength === u.buffer.byteLength ? (u as Uint8Array<ArrayBuffer>) : u.slice();
