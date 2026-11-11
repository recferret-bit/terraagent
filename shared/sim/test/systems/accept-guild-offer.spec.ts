import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData, createRegistryPipeline, createState, step, type PlanetState, type SimCommand } from '../../src';

function colony(): PlanetState {
  const state = createState({ planetId: 'p-guild', planetType: 'temperate', seed: 'w15-11', radius: 8 });
  state.colonies[0] = { index: 0, id: 'col_0', name: 'Port', color: 1, status: 'active', changedAt: 0, playerId: 'pr_a' };
  return state;
}

const offer = { offerId: 'gof:mo_x:0' };
let n = 0;
const cmd = (): SimCommand => ({
  commandId: `g_${n++}`, kind: 'market.acceptGuildOffer', colonyIndex: 0, source: 'player', playerId: 'pr_a', args: offer,
}) as SimCommand;

describe('market.acceptGuildOffer (W15-11)', () => {
  it('W15 off rejects wave_disabled and does not emit', () => {
    const flags = parseWaves('..14');
    const res = step(colony(), [cmd()], 1, createRegistryPipeline({ flags, data: compileData(flags) }));
    expect(res.outcomes[0]?.code).toBe('wave_disabled');
    expect(res.events.some((event) => event.kind === 'guildOfferAcceptRequested')).toBe(false);
  });

  it('W15 on acks and asks the market module to cross the offer', () => {
    const flags = parseWaves('..15');
    const res = step(colony(), [cmd()], 1, createRegistryPipeline({ flags, data: compileData(flags) }));
    expect(res.outcomes[0]?.code).toBeUndefined();
    expect(res.events.find((event) => event.kind === 'guildOfferAcceptRequested')?.data).toMatchObject({
      offerId: offer.offerId, colonyId: 'col_0', colonyIndex: 0, playerId: 'pr_a',
    });
  });
});
