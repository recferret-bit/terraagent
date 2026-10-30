import { coreEnv, EnvError, parseEnv, readEnvSource } from '@terra/config';
import { fileURLToPath } from 'node:url';

// The one NestJS app (D-24). Boot fails on an invalid environment before anything else starts.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
try {
  parseEnv([coreEnv], readEnvSource(repoRoot));
} catch (e) {
  if (e instanceof EnvError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
