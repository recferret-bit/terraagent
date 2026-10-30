import { z } from 'zod';

/** A wave flag id, `W00` … `W99` (PRODUCT_WAVES §3). Parsing of `TA_WAVES` / `?waves=` lives next to this. */
export const WaveId = z.string().regex(/^W\d{2}$/, 'expected a wave id like W07');
export type WaveId = `W${number}${number}`;
