// Registers the merged Prisma schema with the code generation runner (`npm run gen:check` fails when it is stale).
import { mergeSchema } from '../../shared/db/scripts/merge-schema.mjs';

export async function generate() {
  return [{ path: 'shared/db/prisma/schema.prisma', content: mergeSchema() }];
}
