import { describe, expect, it } from 'vitest';
import {
  applyContactFake,
  compileData,
  checkItemUnlockStage,
  createRegistryPipeline,
  createState,
  ENTITY_KIND,
  ENTITY_STATE,
  evaluateTradeHubUnlock,
  insertRow,
  setOverride,
  step,
  view,
} from '../src';

const W10_FLAGS = new Set(['W00', 'W01', 'W02', 'W10']);

function makeTestPlanet() {
  const state = createState({
    planetId: 'p-trade-unlock',
    planetType: 'temperate',
    seed: 'w10-unlock',
    radius: 8,
  });
  state.colonies.push({
    index: 0,
    id: 'col-0',
    name: 'Colony 1',
    color: 0xff6b00,
    status: 'active',
    changedAt: 0,
    stage: 1,
    neighborContact: false,
    guildVisit: false,
  });
  return state;
}

describe('W10-03: Trade Hub unlock stage and TRADE_HUB_AT_S2 evaluation', () => {
  it('is locked at S1 when neighborContact and guildVisit are false', () => {
    const state = makeTestPlanet();
    const data = compileData(W10_FLAGS);

    const status = evaluateTradeHubUnlock(state, 0, data);
    expect(status).toEqual({
      unlocked: false,
      reason: 'stageLocked',
      hint: 'Requires Stage 2 + Neighbor Contact (or Stage 5)',
      stage: 1,
      neighborContact: false,
      guildVisit: false,
      tradeHubAtS2: true,
    });
  });

  it('infers stage 1 without an active Command Hub and stage 2 once Command Hub is active', () => {
    const state = createState({
      planetId: 'p-infer',
      planetType: 'temperate',
      seed: 'infer',
      radius: 8,
    });
    state.colonies.push({
      index: 0,
      id: 'col-0',
      name: 'Colony 1',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    const data = compileData(W10_FLAGS);

    expect(evaluateTradeHubUnlock(state, 0, data).stage).toBe(1);
    expect(evaluateTradeHubUnlock(state, 0, data).unlocked).toBe(false);

    const row = insertRow(state.entities, 1, 1);
    state.entities.cols.kind[row] = ENTITY_KIND.commandHub;
    state.entities.cols.owner[row] = 0;
    state.entities.cols.state[row] = ENTITY_STATE.constructing;
    state.entities.cols.hp[row] = 500;
    state.entities.cols.hpMax[row] = 500;
    expect(evaluateTradeHubUnlock(state, 0, data).stage).toBe(1);

    state.entities.cols.state[row] = ENTITY_STATE.active;
    const activeStatus = evaluateTradeHubUnlock(state, 0, data);
    expect(activeStatus.stage).toBe(2);
    expect(activeStatus.unlocked).toBe(true);
    expect(activeStatus.reason).toBe('tradeHubAtS2');

    const simView = view(state);
    expect(evaluateTradeHubUnlock(simView, 0, data)).toEqual(activeStatus);
  });

  it('is unlocked at S2 when tradeHubAtS2 is true (default) and locked at S2 when tradeHubAtS2 is false without contact', () => {
    const state = makeTestPlanet();
    state.colonies[0].stage = 2;
    const data = compileData(W10_FLAGS);

    const unlockedDefault = evaluateTradeHubUnlock(state, 0, data);
    expect(unlockedDefault).toEqual({
      unlocked: true,
      reason: 'tradeHubAtS2',
      hint: 'Unlocked at Stage 2 (TRADE_HUB_AT_S2)',
      stage: 2,
      neighborContact: false,
      guildVisit: false,
      tradeHubAtS2: true,
    });

    const lockedViaOpts = evaluateTradeHubUnlock(state, 0, data, { tradeHubAtS2: false });
    expect(lockedViaOpts).toEqual({
      unlocked: false,
      reason: 'contactRequired',
      hint: 'Requires Neighbor Contact, Guild Visit, or Stage 5',
      stage: 2,
      neighborContact: false,
      guildVisit: false,
      tradeHubAtS2: false,
    });

    const dataNoDemo = compileData(W10_FLAGS, setOverride({}, 'tradeHub.unlock.tradeHubAtS2', false));
    const lockedViaData = evaluateTradeHubUnlock(state, 0, dataNoDemo);
    expect(lockedViaData.unlocked).toBe(false);
    expect(lockedViaData.reason).toBe('contactRequired');
    expect(lockedViaData.tradeHubAtS2).toBe(false);
  });
});

describe('W10-03: Trade Hub contact.fake, guildVisit, and Stage 5 unlock', () => {
  it('unlocks after applyContactFake and via dev.contactFake sim command even when tradeHubAtS2 is false', () => {
    const state = makeTestPlanet();
    const dataNoDemo = compileData(W10_FLAGS, setOverride({}, 'tradeHub.unlock.tradeHubAtS2', false));

    expect(evaluateTradeHubUnlock(state, 0, dataNoDemo).unlocked).toBe(false);

    applyContactFake(state, 0, 5);
    const afterHelper = evaluateTradeHubUnlock(state, 0, dataNoDemo);
    expect(afterHelper).toEqual({
      unlocked: true,
      reason: 'neighborContact',
      hint: 'Unlocked by neighbor contact',
      stage: 2,
      neighborContact: true,
      guildVisit: false,
      tradeHubAtS2: false,
    });

    const state2 = makeTestPlanet();
    const pipeline = createRegistryPipeline({ flags: W10_FLAGS, data: dataNoDemo });
    const res = step(
      state2,
      [
        {
          commandId: 'cmd-contact-1',
          kind: 'dev.contactFake',
          source: 'dev',
          colonyIndex: 0,
          args: {},
        },
      ],
      1,
      pipeline,
    );
    expect(res.outcomes).toHaveLength(1);
    expect(res.outcomes[0].code).toBeUndefined();

    const afterCmd = evaluateTradeHubUnlock(state2, 0, dataNoDemo);
    expect(afterCmd.unlocked).toBe(true);
    expect(afterCmd.reason).toBe('neighborContact');
    expect(afterCmd.neighborContact).toBe(true);
    expect(afterCmd.stage).toBe(2);
  });

  it('unlocks by guildVisit or at Stage 5 (S5) even when tradeHubAtS2 is false and neighborContact is false', () => {
    const dataNoDemo = compileData(W10_FLAGS, setOverride({}, 'tradeHub.unlock.tradeHubAtS2', false));

    const guildState = makeTestPlanet();
    guildState.colonies[0].stage = 1;
    guildState.colonies[0].guildVisit = true;
    const guildStatus = evaluateTradeHubUnlock(guildState, 0, dataNoDemo);
    expect(guildStatus).toEqual({
      unlocked: true,
      reason: 'guildVisit',
      hint: 'Unlocked by Trade Guild visit',
      stage: 1,
      neighborContact: false,
      guildVisit: true,
      tradeHubAtS2: false,
    });

    const s5State = makeTestPlanet();
    s5State.colonies[0].stage = 5;
    const s5Status = evaluateTradeHubUnlock(s5State, 0, dataNoDemo);
    expect(s5Status).toEqual({
      unlocked: true,
      reason: 's5',
      hint: 'Unlocked at Stage 5',
      stage: 5,
      neighborContact: false,
      guildVisit: false,
      tradeHubAtS2: false,
    });
  });
});


describe('W08 / W10 merged unlock rules', () => {
  it('uses the W10 contact rule instead of the W08 S4 preview for Trade Hub commands', () => {
    const state = makeTestPlanet();
    const flags = new Set([...W10_FLAGS, 'W08']);
    const data = compileData(flags);
    expect(checkItemUnlockStage(state, 0, 'tradeHub', flags, data).ok).toBe(false);
    state.colonies[0].stage = 2;
    expect(checkItemUnlockStage(state, 0, 'tradeHub', flags, data).ok).toBe(true);
    state.colonies[0].tradeHubAtS2 = false;
    expect(checkItemUnlockStage(state, 0, 'tradeHub', flags, data).ok).toBe(false);
    state.colonies[0].neighborContact = true;
    expect(checkItemUnlockStage(state, 0, 'tradeHub', flags, data).ok).toBe(true);
  });
});
