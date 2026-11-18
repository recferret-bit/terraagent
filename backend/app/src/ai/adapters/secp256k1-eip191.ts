// Pure zero-dependency Keccak-256 (0x01 pad) + secp256k1 EIP-191 address recovery
// for verifying NEAR AI Cloud / Intel TDX TEE ECDSA (`signing_algo=ecdsa`) attestations.

const SECP_P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const SECP_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP_GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const SECP_GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

const ROTC = [
  1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44,
] as const;
const PILN = [
  10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1,
] as const;
const MASK64 = 0xffffffffffffffffn;

const RC: readonly bigint[] = (() => {
  const out: bigint[] = [];
  let r = 1;
  for (let round = 0; round < 24; round++) {
    let rc = 0n;
    for (let j = 0; j < 7; j++) {
      if (r & 1) rc ^= 1n << BigInt((1 << j) - 1);
      r = ((r << 1) ^ ((r >> 7) * 0x71)) & 0xff;
    }
    out.push(rc);
  }
  return out;
})();

const rotl64 = (x: bigint, n: number): bigint => ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK64;

function keccakF1600(s: bigint[]): void {
  const bc = new Array<bigint>(5);
  for (let round = 0; round < 24; round++) {
    for (let i = 0; i < 5; i++) {
      bc[i] = s[i]! ^ s[i + 5]! ^ s[i + 10]! ^ s[i + 15]! ^ s[i + 20]!;
    }
    for (let i = 0; i < 5; i++) {
      const t = bc[(i + 4) % 5]! ^ rotl64(bc[(i + 1) % 5]!, 1);
      for (let j = 0; j < 25; j += 5) s[j + i] = s[j + i]! ^ t;
    }
    let t = s[1]!;
    for (let i = 0; i < 24; i++) {
      const j = PILN[i]!;
      const next = s[j]!;
      s[j] = rotl64(t, ROTC[i]!);
      t = next;
    }
    for (let j = 0; j < 25; j += 5) {
      for (let i = 0; i < 5; i++) bc[i] = s[j + i]!;
      for (let i = 0; i < 5; i++) {
        s[j + i] = bc[i]! ^ (~bc[(i + 1) % 5]! & bc[(i + 2) % 5]! & MASK64);
      }
    }
    s[0] = s[0]! ^ RC[round]!;
  }
}

/** Ethereum Keccak-256 (`0x01` domain padding, 136-byte rate). */
export function keccak256(data: Uint8Array): Buffer {
  const rate = 136;
  const paddedLen = Math.ceil((data.length + 1) / rate) * rate;
  const buf = Buffer.alloc(paddedLen);
  buf.set(data);
  buf[data.length] = 0x01;
  buf[paddedLen - 1] = buf[paddedLen - 1]! | 0x80;

  const state = new Array<bigint>(25).fill(0n);
  for (let off = 0; off < paddedLen; off += rate) {
    for (let i = 0; i < 17; i++) {
      state[i] = state[i]! ^ buf.readBigUInt64LE(off + i * 8);
    }
    keccakF1600(state);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(state[i]!, i * 8);
  return out;
}

export function hashEip191PersonalMessage(text: string): Buffer {
  const msg = Buffer.from(text, 'utf8');
  const prefix = Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`, 'utf8');
  return keccak256(Buffer.concat([prefix, msg]));
}

const mod = (a: bigint, m: bigint): bigint => ((a % m) + m) % m;

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

/** Recovers lowercase `0x`-prefixed 20-byte Ethereum address from a 32-byte digest and 65-byte `(r, s, v)` signature. */
export function recoverSecp256k1Address(digest32: Uint8Array, sig65: Uint8Array): string | null {
  if (digest32.length !== 32 || sig65.length !== 65) return null;
  const r = BigInt(`0x${Buffer.from(sig65.subarray(0, 32)).toString('hex')}`);
  const s = BigInt(`0x${Buffer.from(sig65.subarray(32, 64)).toString('hex')}`);
  const rawV = sig65[64]!;
  const recId = rawV >= 27 ? rawV - 27 : rawV;
  if (recId < 0 || recId > 3 || r <= 0n || r >= SECP_N || s <= 0n || s >= SECP_N) return null;

  const x = r + BigInt(recId >> 1) * SECP_N;
  if (x >= SECP_P) return null;
  const ySq = mod(modPow(x, 3n, SECP_P) + 7n, SECP_P);
  let y = modPow(ySq, (SECP_P + 1n) / 4n, SECP_P);
  if (mod(y * y, SECP_P) !== ySq) return null;
  if (Number(y & 1n) !== (recId & 1)) y = SECP_P - y;

  const z = BigInt(`0x${Buffer.from(digest32).toString('hex')}`);
  const rInv = modInv(r, SECP_N);
  const sr = pointMul({ x, y }, mod(s * rInv, SECP_N));
  const zg = pointMul({ x: SECP_GX, y: SECP_GY }, mod((SECP_N - mod(z, SECP_N)) * rInv, SECP_N));
  const pub = pointAdd(sr, zg);
  if (!pub) return null;

  const uncompressed64 = Buffer.concat([
    Buffer.from(pub.x.toString(16).padStart(64, '0'), 'hex'),
    Buffer.from(pub.y.toString(16).padStart(64, '0'), 'hex'),
  ]);
  return `0x${keccak256(uncompressed64).subarray(12).toString('hex')}`;
}
