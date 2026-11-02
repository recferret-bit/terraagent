/** Typed-array element types the engine stores. Every column and tile layer is described by one of these. */
export const DTYPES = {
  u8: Uint8Array, i8: Int8Array, u16: Uint16Array, i16: Int16Array,
  u32: Uint32Array, i32: Int32Array, f32: Float32Array, f64: Float64Array,
} as const;
export type DType = keyof typeof DTYPES;
export type TypedArray = InstanceType<(typeof DTYPES)[DType]>;

/** Wave flag id (`W00`…); mirrors `WaveId` in `@terra/contracts`. */
export type WaveId = string;

/** A named column/layer: its dtype and the wave that registered it. */
export interface FieldDef {
  readonly name: string;
  readonly dtype: DType;
  readonly wave: WaveId;
  /**
   * Server-only: kept in persisted snapshots, but zero-filled / omitted in everything sent to a client
   * (`snapshot(s, { forClient: true })`, `diffSince(s, t, { forClient: true })`). Used for ground that is only
   * discovered by terraforming (D-38), so a client cannot read it from its replica.
   */
  readonly hidden?: boolean;
}

export const allocate = (dtype: DType, length: number): TypedArray => new DTYPES[dtype](length);
