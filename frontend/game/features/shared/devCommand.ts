import type { FeatureContext } from '../../core/registry/types';
import { DevServerError } from '../../net/devServer';
import '../../net/services';

export function serverFor(ctx: FeatureContext, name: string): NonNullable<FeatureContext['services']['devServer']> {
  const server = ctx.services.devServer;
  if (!server) throw new DevServerError('host_unavailable', `${name} needs the game server; not available on this host`);
  return server;
}

export function usage(line: string): never {
  throw new Error(`usage: ${line}`);
}
