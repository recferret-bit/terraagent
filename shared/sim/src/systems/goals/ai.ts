import { ensureColonyRecord } from '../../kernel/colonies';
import { defineCommandHandler } from '../../kernel/commands';
import type { PlanetState } from '../../kernel/state';
import { commandColony, parseArgs } from '../command';
import { enablePlanetGovernor } from '../rival-ai/store';

/**
 * Colony AI switch. The AI is the autonomous part of the colony: HQ goal breakdown (`goals.manager`) and the rule-engine
 * autopilot (`rule-engine.autopilot`). It is OFF by default so bots only run explicit player commands. Explicit input
 * (placeBuilding, enqueueTask, unit commands, `dev.autopilot`) is never gated.
 */
export function isColonyAiEnabled(state: PlanetState, colonyIndex = 0): boolean {
  return state.colonies[colonyIndex]?.aiEnabled === true;
}

/** Sets the switch and bumps `changedAt` so `diffSince` ships it to clients. */
export function setColonyAiEnabled(
  state: PlanetState,
  colonyIndex: number,
  enabled: boolean,
  tick: number = state.meta.tick,
): boolean {
  const colony = ensureColonyRecord(state, colonyIndex, tick);
  if (colony.aiEnabled !== enabled) {
    colony.aiEnabled = enabled;
    colony.changedAt = tick;
  }
  return enabled;
}

export const setAiEnabledHandler = defineCommandHandler({
  kind: 'setAiEnabled',
  wave: 'W08',
  handle(state, cmd, ctx) {
    const colIdx = commandColony(cmd);
    if (typeof colIdx === 'string') return colIdx;
    const parsed = parseArgs('setAiEnabled', cmd.args);
    if (!parsed) return 'invalid_args';
    setColonyAiEnabled(state, colIdx, parsed.enabled, ctx.tick);
    if (parsed.enabled && ctx.flags.has('W18')) {
      enablePlanetGovernor(state, true, ctx.tick);
    }
  },
});
