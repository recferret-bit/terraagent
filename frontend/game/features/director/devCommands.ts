import type { DevCommandDef } from '../../core/registry/types';

const plan: DevCommandDef = {
  name: 'director.plan',
  help: 'Force one mock director plan and print its trace and queue depth. Dev only.',
  run() {
    return 'plan forced trigger=resource.shortage risk=conservative queue=1 trace=mock';
  },
};

const trace: DevCommandDef = {
  name: 'director.trace',
  help: 'Print the last mock director trace. Dev only.',
  run() {
    return 'trace mock queue=1 outcome=proposed';
  },
};

/** Production builds omit these commands (AI §11). */
export function directorDevCommands(nodeEnv = 'development'): DevCommandDef[] {
  if (nodeEnv === 'production') return [];
  return [plan, trace];
}
