// Browser-native zero-dependency Keccak-256 + secp256k1 EIP-191/EIP-2098 address recovery
// (pure Uint8Array + DataView + BigInt, zero Node Buffer dependency).

const SECP_P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const SECP_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP_GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const SECP_GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
const MASK64 = 0xffffffffffffffffn;

const ROTC = [
  1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44,
] as const;
const PILN = [
  10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1,
] as const;

const RC: readonly bigint[] = (() => {
  const out: bigint[] = [];
  let r = 1;
  for (let round = 0; round < 24; round += 1) {
    let rc = 0n;
    for (let j = 0; j < 7; j += 1) {
      if (r & 1) rc ^= 1n << BigInt((1 << j) - 1);
      r = ((r << 1) ^ ((r >> 7) * 0x71)) & 0xff;
    }
    out.push(rc);
  }
  return out;
})();

const rotl64 = (x: bigint, n: number): bigint => ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK64;
const mod = (a: bigint, m: bigint): bigint => ((a % m) + m) % m;

function keccakF1600(s: bigint[]): void {
  const bc = new Array<bigint>(5);
  for (let round = 0; round < 24; round += 1) {
    for (let i = 0; i < 5; i += 1) bc[i] = s[i]! ^ s[i + 5]! ^ s[i + 10]! ^ s[i + 15]! ^ s[i + 20]!;
    for (let i = 0; i < 5; i += 1) {
      const t = bc[(i + 4) % 5]! ^ rotl64(bc[(i + 1) % 5]!, 1);
      for (let j = 0; j < 25; j += 5) s[j + i] = s[j + i]! ^ t;
    }
    let t = s[1]!;
    for (let i = 0; i < 24; i += 1) {
      const j = PILN[i]!;
      const next = s[j]!;
      s[j] = rotl64(t, ROTC[i]!);
      t = next;
    }
    for (let j = 0; j < 25; j += 5) {
      for (let i = 0; i < 5; i += 1) bc[i] = s[j + i]!;
      for (let i = 0; i < 5; i += 1) s[j + i] = bc[i]! ^ (~bc[(i + 1) % 5]! & bc[(i + 2) % 5]! & MASK64);
    }
    s[0] = s[0]! ^ RC[round]!;
  }
}

export function keccak256Bytes(data: Uint8Array): Uint8Array {
  const rate = 136;
  const paddedLen = Math.ceil((data.length + 1) / rate) * rate;
  const buf = new Uint8Array(paddedLen);
  buf.set(data);
  buf[data.length] = 0x01;
  buf[paddedLen - 1] = buf[paddedLen - 1]! | 0x80;
  const view = new DataView(buf.buffer);
  const state = new Array<bigint>(25).fill(0n);
  for (let off = 0; off < paddedLen; off += rate) {
    for (let i = 0; i < 17; i += 1) state[i] = state[i]! ^ view.getBigUint64(off + i * 8, true);
    keccakF1600(state);
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 4; i += 1) outView.setBigUint64(i * 8, state[i]!, true);
  return out;
}

export function hashEip191MessageBytes(text: string): Uint8Array {
  const enc = new TextEncoder();
  const msg = enc.encode(text);
  const prefix = enc.encode(`\x19Ethereum Signed Message:\n${msg.length}`);
  const combined = new Uint8Array(prefix.length + msg.length);
  combined.set(prefix, 0);
  combined.set(msg, prefix.length);
  return keccak256Bytes(combined);
}

function modPow(base: bigint, exp: bigint, m: bigint): bigint {
  let res = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) res = (res * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return res;
}

function modInv(a: bigint, m: bigint): bigint {
  let [t, newT] = [0n, 1n];
  let [r, newR] = [m, mod(a, m)];
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r > 1n) throw new Error('non-invertible');
  return mod(t, m);
}

type Point = { readonly x: bigint; readonly y: bigint } | null;

function pointAdd(p: Point, q: Point): Point {
  if (!p) return q;
  if (!q) return p;
  if (p.x === q.x) {
    if (mod(p.y + q.y, SECP_P) === 0n) return null;
    const lam = mod(3n * p.x * p.x * modInv(2n * p.y, SECP_P), SECP_P);
    const x3 = mod(lam * lam - 2n * p.x, SECP_P);
    return { x: x3, y: mod(lam * (p.x - x3) - p.y, SECP_P) };
  }
  const lam = mod((q.y - p.y) * modInv(q.x - p.x, SECP_P), SECP_P);
  const x3 = mod(lam * lam - p.x - q.x, SECP_P);
  return { x: x3, y: mod(lam * (p.x - x3) - p.y, SECP_P) };
}

function pointMul(p: Point, k: bigint): Point {
  let res: Point = null;
  let addend = p;
  let scalar = mod(k, SECP_N);
  while (scalar > 0n) {
    if (scalar & 1n) res = pointAdd(res, addend);
    addend = pointAdd(addend, addend);
    scalar >>= 1n;
  }
  return res;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function hexToBytes32(hex64: string): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) out[i] = Number.parseInt(hex64.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function normalizeEcdsaSig65(sig: Uint8Array): Uint8Array | null {
  if (sig.length === 65) return sig;
  if (sig.length === 64) {
    const out = new Uint8Array(65);
    out.set(sig.subarray(0, 64), 0);
    out[64] = (sig[32]! >> 7) & 1;
    out[32] = sig[32]! & 0x7f;
    return out;
  }
  return null;
}

export function recoverSecp256k1AddressBrowser(digest32: Uint8Array, rawSig: Uint8Array): string | null {
  const sig65 = normalizeEcdsaSig65(rawSig);
  if (!sig65 || digest32.length !== 32) return null;
  const r = BigInt(`0x${bytesToHex(sig65.subarray(0, 32))}`);
  const s = BigInt(`0x${bytesToHex(sig65.subarray(32, 64))}`);
  const rawV = sig65[64]!;
  const recId = rawV >= 27 ? rawV - 27 : rawV;
  if (recId < 0 || recId > 3 || r <= 0n || r >= SECP_N || s <= 0n || s >= SECP_N) return null;

  const x = r + BigInt(recId >> 1) * SECP_N;
  if (x >= SECP_P) return null;
  const ySq = mod(modPow(x, 3n, SECP_P) + 7n, SECP_P);
  let y = modPow(ySq, (SECP_P + 1n) / 4n, SECP_P);
  if (mod(y * y, SECP_P) !== ySq) return null;
  if (Number(y & 1n) !== (recId & 1)) y = SECP_P - y;

  const z = BigInt(`0x${bytesToHex(digest32)}`);
  const rInv = modInv(r, SECP_N);
  const sr = pointMul({ x, y }, mod(s * rInv, SECP_N));
  const zg = pointMul({ x: SECP_GX, y: SECP_GY }, mod((SECP_N - mod(z, SECP_N)) * rInv, SECP_N));
  const pub = pointAdd(sr, zg);
  if (!pub) return null;

  const uncompressed64 = new Uint8Array(64);
  uncompressed64.set(hexToBytes32(pub.x.toString(16).padStart(64, '0')), 0);
  uncompressed64.set(hexToBytes32(pub.y.toString(16).padStart(64, '0')), 32);
  return `0x${bytesToHex(keccak256Bytes(uncompressed64).subarray(12))}`;
}
