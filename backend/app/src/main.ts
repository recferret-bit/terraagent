import { appPort, EnvError } from '@terra/config';
import { createApp } from './app';

// The one NestJS app (D-24). Boot fails on an invalid environment before anything else starts.
try {
  const { app, env, modules } = await createApp();
  const host = String(env.TA_HOST ?? '127.0.0.1');
  const port = appPort(env);
  await app.listen(port, host);
  console.log(`terra app listening on http://${host}:${port}/v1 (modules: ${modules.join(', ')})`);
} catch (e) {
  if (e instanceof EnvError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
