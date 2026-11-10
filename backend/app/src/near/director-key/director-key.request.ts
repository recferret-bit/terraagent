import { AutoTradeLimitsSchema } from '@terra/contracts';
import { z } from 'zod';
import { CoreException } from '../../core/errors/index.js';

export const DirectorKeyRequest = z.object({
  colonyId: z.string().min(1).max(64),
  limits: AutoTradeLimitsSchema.optional(),
});
export type DirectorKeyRequest = z.infer<typeof DirectorKeyRequest>;

export function parseDirectorKeyBody(raw: unknown): DirectorKeyRequest {
  const parsed = DirectorKeyRequest.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new CoreException('INVALID_REQUEST', { status: 400, message: 'Director key body is invalid' });
  }
  return parsed.data;
}
