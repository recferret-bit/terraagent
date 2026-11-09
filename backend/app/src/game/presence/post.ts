import { newId, type SimCommandV1 } from '@terra/contracts';
import type { PresenceCommandPort, PresenceLog } from './types';

export function presenceCommand(input: { colonyId: string; away: boolean; colonyIndex?: number }): SimCommandV1 {
  return {
    colonyIndex: input.colonyIndex ?? null,
    source: 'system',
    commandId: newId('cm'),
    kind: 'system.presence',
    args: { colonyId: input.colonyId, away: input.away },
  };
}

/** Posts the command. `wave_disabled` (flag W09 off) is success for the socket: the caller already stamped last_seen. */
export async function postPresence(
  port: PresenceCommandPort,
  planetId: string,
  cmd: SimCommandV1,
  log?: PresenceLog,
): Promise<void> {
  try {
    const out = await port.submit(planetId, cmd);
    if (!out.ok && out.code !== 'wave_disabled') {
      log?.warn({ planetId, code: out.code, commandId: cmd.commandId }, 'presence command was not applied');
    }
  } catch (err) {
    log?.warn({ planetId, err: err instanceof Error ? err.message : String(err) }, 'presence command failed');
  }
}
