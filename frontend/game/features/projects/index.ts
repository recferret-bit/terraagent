import { defineFeature, type DevCommandDef, type FeatureContext } from '../../core/registry/types';
import type { CommandResult } from '../../net/commandBus';
import '../../net/services';

/**
 * W13-43: select a prestige project at the Command Hub. The project is a `project` task of the order queue (the Hub's
 * Units lane): it shows in the queue panel like a unit order, is paid progressively, and cancelling refunds half of
 * what was paid. This is the minimal entry (the console); a Hub card belongs to the W13 market UI work.
 */
const PROJECTS = ['survey_array', 'monument'] as const;

async function send(ctx: FeatureContext, id: string): Promise<CommandResult> {
  const sendCommand = ctx.services.sendCommand;
  return sendCommand
    ? sendCommand('enqueueTask', { project: { project: `project.${id}` } })
    : { ok: false, code: 'not_connected', detail: 'no game server connection' };
}

export const projectCmd: DevCommandDef = {
  name: 'project',
  help: `project [${PROJECTS.join('|')}]  Queue a prestige project at the Hub (inputs are paid as it builds; no cash reward; repeat to build again)`,
  async run(a, ctx) {
    const id = (a[0] ?? '').trim().replace(/^project\./, '');
    if (!id) return `projects: ${PROJECTS.join(', ')} (run: project <id>)`;
    if (!(PROJECTS as readonly string[]).includes(id)) throw new Error(`unknown project "${id}" (${PROJECTS.join(', ')})`);
    const r = await send(ctx, id);
    if (r.ok) return `project.${id} queued, applied at tick ${r.appliedAtTick}`;
    throw new Error(`project rejected: ${r.code}${r.detail ? ` (${r.detail})` : ''}`);
  },
};

export default defineFeature({
  id: 'projects',
  wave: 'W13',
  consoleCommands: [projectCmd],
});
