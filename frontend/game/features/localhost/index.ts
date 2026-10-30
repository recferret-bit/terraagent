import { defineFeature, type DevCommandDef } from '../../core/registry/types';
import { DevServerError } from '../../net/devServer';
import '../../net/services';

const reset: DevCommandDef = {
  name: 'local.reset',
  help: 'local.reset  Local host: discard the saved planet and start the scenario again from tick 0',
  async run(_a, ctx) {
    const server = ctx.services.devServer;
    if (!server) throw new DevServerError('host_unavailable', 'local.reset needs the local host');
    const r = (await server('local.reset')) as { planetId: string };
    return `fresh planet ${r.planetId} (saved snapshot replaced)`;
  },
};

/** Commands of the browser local host (`?host=local`); the game server host does not load this feature. */
export default defineFeature({ id: 'localhost', wave: 'W00', hostOnly: 'local', devCommands: [reset] });
