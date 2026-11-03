import { defineFeature, type DevCommandDef, type FeatureContext } from '../../core/registry/types';
import { DevServerError } from '../../net/devServer';
import '../../net/services';
import { nearPlayerText } from './copy';
import { NearErrorToasts } from './toast';
import './near-errors.css';

declare module '../../core/registry/types' {
  interface FeatureServices {
    /** Mounted with the near-errors plate. `near.error` toasts through it. */
    nearErrors?: NearErrorToasts;
  }
}

const USAGE = 'near.error <code>';

function serverFor(ctx: FeatureContext): NonNullable<FeatureContext['services']['devServer']> {
  const server = ctx.services.devServer;
  if (!server) {
    throw new DevServerError('host_unavailable', 'near.error needs the game server; not available on this host');
  }
  return server;
}

/** The player line when this failure is one of the four codes and the plate is mounted. */
function toastedLine(ctx: FeatureContext, error: unknown): string | undefined {
  if (!(error instanceof DevServerError) || !error.errorCode) return undefined;
  const line = nearPlayerText(error.errorCode);
  if (!line || !ctx.services.nearErrors?.show(error.errorCode)) return undefined;
  return line;
}

const nearError: DevCommandDef = {
  name: 'near.error',
  help: `${USAGE}  Server: force one player-facing NEAR error and toast its sentence`,
  async run(args, ctx) {
    if (args.length !== 1 || !args[0]) throw new Error(`usage: ${USAGE}`);
    const code = args[0];
    try {
      await serverFor(ctx)('near.error', { code });
    } catch (error) {
      const line = toastedLine(ctx, error);
      if (line) return line;
      throw error;
    }
    return `near.error ${code}: the server did not reject`;
  },
};

/** Player toasts for the four NEAR error codes. Both hosts load it; a missing server answers `host_unavailable`. */
export default defineFeature({
  id: 'near-errors',
  wave: 'W06',
  devCommands: [nearError],
  hud: [
    {
      id: 'near-toast',
      slot: 'bottom-left',
      order: 80,
      mount(el, ctx) {
        const toasts = new NearErrorToasts(el);
        ctx.services.nearErrors = toasts;
        return {
          dispose() {
            if (ctx.services.nearErrors === toasts) ctx.services.nearErrors = undefined;
            toasts.dispose();
          },
        };
      },
    },
  ],
});
