import { parseWaves, type SimCommandV1 } from '@terra/contracts';
import { createPlanet, createRegistryPipeline, seedRivalAiColonies, SimHost, snapshot } from '@terra/sim';
import type { GamePlanets } from '../../src/game/game-planets.service.js';

/** One temperate planet with the human `col_0` and two seeded Rival AI colonies, as a fake `GamePlanets`. */
export function createFakePlanetHarness() {
  const flags = parseWaves('..22').list;
  const host = new SimHost(createRegistryPipeline({ flags }));
  host.load(
    createPlanet({
      id: 'pl_loop',
      planetId: 'pl_loop',
      type: 'temperate',
      planetType: 'temperate',
      seed: 'loop-seed',
      radius: 26,
      capacity: 6,
    }),
  );
  host.submit({
    colonyIndex: 0,
    source: 'system',
    commandId: 'spawn_0',
    kind: 'system.spawnColony',
    args: { colonyId: 'col_0', colonyIndex: 0, name: 'Human Colony', unlockStage: 0 },
  });
  host.step(1);
  seedRivalAiColonies(host.state, { count: 2, capacity: 6, tick: host.tick });

  const submitted: SimCommandV1[] = [];
  const planets = {
    fullState: async () => ({
      planetId: 'pl_loop',
      tick: host.tick,
      bytes: snapshot(host.state),
      simVersion: 1,
      dataHash: 'h',
      planetType: 'temperate',
      warp: 1,
    }),
    submit: async (_planetId: string, cmd: SimCommandV1) => {
      submitted.push(cmd);
      host.submit(cmd);
      const out = host.step(1).outcomes[0];
      return out?.code
        ? { ok: false as const, commandId: cmd.commandId, code: out.code }
        : { ok: true as const, commandId: cmd.commandId, appliedAtTick: host.tick };
    },
  } as unknown as GamePlanets;

  return { host, planets, submitted };
}
