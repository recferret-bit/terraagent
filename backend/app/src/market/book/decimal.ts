/** Prisma `Decimal` (numeric(78,0)) to/from bigint and decimal strings. Never goes through `number`. */
interface DecimalLike {
  toFixed(dp?: number): string;
}

export const decimalToBigint = (d: DecimalLike | string | bigint): bigint =>
  typeof d === 'bigint' ? d : BigInt(typeof d === 'string' ? d : d.toFixed(0));

export const decimalToString = (d: DecimalLike | string | bigint): string => decimalToBigint(d).toString();

/** Prisma accepts a decimal string for a `Decimal` column. Rejects anything that is not a non-negative integer. */
export function toDecimalInput(v: bigint | string): string {
  const s = v.toString();
  if (!/^(0|[1-9]\d{0,77})$/.test(s)) throw new RangeError(`not a non-negative atomic amount: ${s}`);
  return s;
}
