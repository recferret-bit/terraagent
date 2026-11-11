import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { systemActor, treasury, treasuryCtx } from '../../economy';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { colonyIsAway, resolveColonyAwayRaids } from '../away/gate';
import { proposeTruce, respondTruce } from '../diplomacy/operations';
import { hasActiveTruce, readDiplomacyBlob } from '../diplomacy/store';
import { evaluateAggressionSkillProposal } from '../director/w18-pvp-adapter';
import { stepColonyGoalsBreakdown } from '../goals/breakdown';
import { getOpenColonyGoals, queueColonyGoal } from '../goals/index';
import { computeEffectivePowerNetPerS } from '../goals/parts/breakdownParts';
import { enqueueQueueTask } from '../queue';
import { selectDeterministicBuildSite } from '../rule-engine/site';
import { colonyTerraformStats } from '../terraform-basic/rules';
import {
  getRivalColonyMeta,
  isPlanetGovernorEnabled,
  isRivalAiColony,
  readRivalAiBlob,
  writeRivalAiBlob,
} from './store';

export const GOVERNOR_INTERVAL_TICKS = 40;

export interface GovernorStepDecision {
  colonyIndex: number;
  action:
    | 'idle'
    | 'accept_truce'
    | 'decline_truce'
    | 'propose_truce'
    | 'raid_target'
    | 'terraform_zone'
    | 'defend_colony'
    | 'secure_power'
    | 'expand_pylon'
    | 'grow_economy';
  detail: string;
  targetColonyIndex?: number;
}

function countColonyEntities(state: PlanetState, colonyIndex: number): {
  combatUnits: number;
  turrets: number;
  pylons: number;
  buildingHpRatio: number;
} {
  const { count, cols } = state.entities;
  let combatUnits = 0;
  let turrets = 0;
  let pylons = 0;
  let hpSum = 0;
  let hpMaxSum = 0;
  for (let r = 0; r < count; r++) {
    if (cols.owner[r] !== colonyIndex || cols.hp[r]! <= 0) continue;
    const st = cols.state[r]!;
    if (st === ENTITY_STATE.inert || st === ENTITY_STATE.descending) continue;
    const k = cols.kind[r]!;
    if (k === ENTITY_KIND.recon || k === ENTITY_KIND.demoTank || k === ENTITY_KIND.demoArtillery) combatUnits++;
    if (k === ENTITY_KIND.autocannon || k === ENTITY_KIND.laserTower) turrets++;
    if (k === ENTITY_KIND.pylon) pylons++;
    if (k === ENTITY_KIND.commandHub || k === ENTITY_KIND.tradeHub || k === ENTITY_KIND.supplyDepot) {
      hpSum += cols.hp[r]!;
      hpMaxSum += Math.max(1, cols.hpMax[r]!);
    }
  }
  return {
    combatUnits,
    turrets,
    pylons,
    buildingHpRatio: hpMaxSum > 0 ? hpSum / hpMaxSum : 1,
  };
}

/**
 * True ONLY when the AI is authorized to rule `colonyIndex`:
 * - Seeded Rival AI colony (`isRivalAiColony`), OR
 * - Player explicitly turned ON `AI AUTOPILOT` (`col.aiEnabled === true`), OR
 * - Player is offline (`colonyIsAway`).
 * Online human players with `AI AUTOPILOT: OFF` return `false` (100% manual control).
 */
export function shouldAiGovernColony(state: PlanetState, colonyIndex: number): boolean {
  const col = state.colonies[colonyIndex];
  if (!col || col.status === 'eliminated') return false;
  if (isRivalAiColony(state, colonyIndex)) return true;
  if (col.aiEnabled === true) return true;
  return colonyIsAway(state, colonyIndex);
}

function tryDiplomacyAction(
  state: PlanetState,
  colonyIndex: number,
  hpRatio: number,
  tick: number,
  ctx?: StepContext,
): GovernorStepDecision | null {
  if (ctx && !ctx.flags.has('W18')) return null;
  const meta = getRivalColonyMeta(state, colonyIndex);
  const warAllowed = Boolean(meta?.allowWarDiplomacy || resolveColonyAwayRaids(state, colonyIndex));
  const dip = readDiplomacyBlob(state);

  // 1. Respond to incoming pending truce offers (NEVER calls cancelTruce — AW-13 hard block)
  const pendingOffer = Object.values(dip.offers).find(
    (o) => o.status === 'pending' && o.toColonyIndex === colonyIndex && o.expiresAtTick > tick,
  );
  if (pendingOffer) {
    const accept = meta?.persona === 'trader' || hpRatio < 0.7 || !warAllowed;
    const res = respondTruce(state, colonyIndex, pendingOffer.offerId, accept, tick, ctx);
    if (res.ok) {
      return {
        colonyIndex,
        action: accept ? 'accept_truce' : 'decline_truce',
        targetColonyIndex: pendingOffer.fromColonyIndex,
        detail: `${accept ? 'Accepted' : 'Declined'} ${pendingOffer.durationHours}h truce from col_${pendingOffer.fromColonyIndex}`,
      };
    }
  }

  // 2. Propose peace truce when Trader persona or damaged (< 65% HP)
  if ((meta?.persona === 'trader' || (warAllowed && hpRatio < 0.65)) && !pendingOffer) {
    for (const other of state.colonies) {
      if (!other || other.index === colonyIndex || other.status === 'eliminated') continue;
      if (hasActiveTruce(state, colonyIndex, other.index, tick)) continue;
      const alreadyOffered = Object.values(dip.offers).some(
        (o) => o.status === 'pending' && o.fromColonyIndex === colonyIndex && o.toColonyIndex === other.index,
      );
      if (alreadyOffered) continue;
      const res = proposeTruce(state, colonyIndex, other.index, 6, tick, ctx);
      if (res.ok) {
        return {
          colonyIndex,
          action: 'propose_truce',
          targetColonyIndex: other.index,
          detail: `Proposed 6h peace truce to ${other.name || `col_${other.index}`}`,
        };
      }
    }
  }
  return null;
}

/**
 * Evaluates and applies one autonomous AI governor turn for `colonyIndex` (war, peace, terraforming, defense, expansion, economy).
 */
export function stepColonyAutonomousGovernor(
  state: PlanetState,
  colonyIndex: number,
  tick = state.meta.tick,
  ctx?: StepContext,
): GovernorStepDecision {
  if (!shouldAiGovernColony(state, colonyIndex)) {
    return { colonyIndex, action: 'idle', detail: 'Manual human control active' };
  }

  const counts = countColonyEntities(state, colonyIndex);
  const dipDecision = tryDiplomacyAction(state, colonyIndex, counts.buildingHpRatio, tick, ctx);
  if (dipDecision) return dipDecision;

  // Ensure open goals progress even when governed because of offline `away` while `aiEnabled` was false
  const openGoals = getOpenColonyGoals(state, colonyIndex);
  if (openGoals.length > 0) {
    if (!state.colonies[colonyIndex]?.aiEnabled) {
      stepColonyGoalsBreakdown(state, colonyIndex, ctx, true);
    }
    return { colonyIndex, action: 'idle', detail: `Executing active goal ${openGoals[0]!.goal}` };
  }

  const col = state.colonies[colonyIndex]!;
  const stage = Math.max(Number(col.stage ?? 0), Number(col.unlockStage ?? 0));
  const stock = (col as { stock?: Record<string, number> }).stock ?? {};
  const power = computeEffectivePowerNetPerS(state, colonyIndex, ctx?.data);

  if (stage >= 2 && (power.brownout || power.netPerS < 3)) {
    const q = queueColonyGoal(state, colonyIndex, { goal: 'secure_power', params: { targetNetEnergyPerS: 10 } }, tick, ctx);
    if (q.ok) return { colonyIndex, action: 'secure_power', detail: 'Queued secure_power to prevent brownout' };
  }

  if (stage >= 3 && counts.turrets + counts.combatUnits < 2) {
    const q = queueColonyGoal(state, colonyIndex, { goal: 'defend_colony' }, tick, ctx);
    if (q.ok) return { colonyIndex, action: 'defend_colony', detail: 'Queued defend_colony for perimeter security' };
  }

  const stage4Choice = tryStage4WarTerraformOrExpand(state, colonyIndex, stage, stock, counts, tick, ctx);
  if (stage4Choice) return stage4Choice;

  const q = queueColonyGoal(
    state,
    colonyIndex,
    { goal: 'grow_economy', params: { resource: 'metals.t1', targetRatePerMin: 24 } },
    tick,
    ctx,
  );
  if (q.ok) return { colonyIndex, action: 'grow_economy', detail: 'Queued grow_economy (metals.t1)' };
  return { colonyIndex, action: 'idle', detail: 'Standing by' };
}

function tryStage4WarTerraformOrExpand(
  state: PlanetState,
  colonyIndex: number,
  stage: number,
  stock: Record<string, number>,
  counts: { combatUnits: number; pylons: number },
  tick: number,
  ctx?: StepContext,
): GovernorStepDecision | null {
  if (stage < 4) return null;
  const meta = getRivalColonyMeta(state, colonyIndex);
  const raidsAllowed = Boolean(meta?.persona === 'warlord' || resolveColonyAwayRaids(state, colonyIndex));
  if (raidsAllowed && counts.combatUnits >= 2) {
    const agg = evaluateAggressionSkillProposal(state, colonyIndex, {
      away: true,
      awayRaids: true,
      waves: ctx?.flags,
      tick,
      data: ctx?.data,
    });
    if (agg.ok && agg.recommendedTargetColony !== null) {
      const q = queueColonyGoal(
        state,
        colonyIndex,
        { goal: 'raid_target', params: { targetColonyId: agg.recommendedTargetColony } },
        tick,
        ctx,
      );
      if (q.ok) {
        return {
          colonyIndex,
          action: 'raid_target',
          targetColonyIndex: agg.recommendedTargetColony,
          detail: `Launched raid_target against unshielded col_${agg.recommendedTargetColony}`,
        };
      }
    }
  }

  const tfStats = colonyTerraformStats(state, colonyIndex);
  if (
    tfStats.livingTiles < 6 &&
    Number(stock['metals.t1'] ?? 0) >= 260 &&
    (Number(stock['bio.water'] ?? 0) < 35 || Number(stock['minerals.t1'] ?? 0) < 20)
  ) {
    const t = treasury(state, treasuryCtx(tick, ctx));
    const sub = t.withdraw({
      colony: colonyIndex,
      amounts: { 'metals.t1': 40 },
      reason: 'trade',
      actor: systemActor('rival-ai'),
    });
    if (sub.ok) {
      t.add({
        colony: colonyIndex,
        amounts: { 'bio.water': 40, 'minerals.t1': 25 },
        reason: 'trade',
        actor: systemActor('rival-ai'),
        clampToCap: true,
      });
    }
  }
  if (Number(stock['bio.water'] ?? 0) >= 35 && Number(stock['minerals.t1'] ?? 0) >= 20 && tfStats.livingTiles < 6) {
    const q = queueColonyGoal(state, colonyIndex, { goal: 'terraform_zone', params: { target: tfStats.livingTiles + 2 } }, tick, ctx);
    if (q.ok) return { colonyIndex, action: 'terraform_zone', detail: `Queued terraform_zone → ${tfStats.livingTiles + 2} Living hexes` };
  }

  if (counts.pylons < 1 && Number(stock['metals.t1'] ?? 0) >= 80) {
    const site = selectDeterministicBuildSite(state, colonyIndex, 'pylon');
    if (site) {
      const enq = enqueueQueueTask(
        state,
        { colonyIndex, precedence: 'hq', task: { kind: 'build', building: 'pylon', q: site.q, r: site.r }, tick, data: ctx?.data },
        ctx,
      );
      if (enq.ok) return { colonyIndex, action: 'expand_pylon', detail: `Ordered Outpost Pylon expansion at (${site.q},${site.r})` };
    }
  }
  return null;
}

export function runPlanetGovernorTick(state: PlanetState, ctx: StepContext): void {
  if (!isPlanetGovernorEnabled(state) && !state.colonies.some((c) => c && colonyIsAway(state, c.index))) return;
  const blob = readRivalAiBlob(state);
  let changed = false;
  for (const col of state.colonies) {
    if (!col || col.status === 'eliminated') continue;
    const last = blob.lastGovernorTickByColony[col.index] ?? -GOVERNOR_INTERVAL_TICKS;
    if (ctx.tick - last < GOVERNOR_INTERVAL_TICKS) continue;
    if (!shouldAiGovernColony(state, col.index)) continue;
    const decision = stepColonyAutonomousGovernor(state, col.index, ctx.tick, ctx);
    blob.lastGovernorTickByColony[col.index] = ctx.tick;
    if (decision.action !== 'idle') {
      blob.lastActionByColony[col.index] = decision.detail;
    }
    changed = true;
  }
  if (changed) writeRivalAiBlob(state, blob, ctx.tick);
}
