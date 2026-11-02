import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'landPod',
  wave: 'W01',
  origin: 'client',
  args: z.strictObject({}),
  summary:
    "Opens the caller colony's descending pod as soon as it has descended `hq.startingKit.podLandMinS` (the client's touchdown animation); `already_landed` once it is open.",
});
