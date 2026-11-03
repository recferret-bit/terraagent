import type { CompiledDataLike } from '../../kernel/config';
import { TICK_MS } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { getPlanetTime } from '../time';
import { resolvePowerRow, type ColonyPowerSummary } from './index';

export interface PowerEventTracker {
  brownoutTicks: number;
  collapseEmitted: boolean;
  activeGroups: number[];
  lastGroupEmitTick: Record<number, number>;
  prevActivePylonIds?: number[];
  prevOnlineEntityIds?: number[];
  prevComponentShedIds?: Record<number, number[]>;
  prevPhase?: 'day' | 'night';
  nightShedBeyondGroup1?: boolean;
}

const BROWNOUT_DEBOUNCE_TICKS = 50; // 10 s debounce per shed group

function checkPowerSevered(
  state: PlanetState,
  colonyIndex: number,
  summary: ColonyPowerSummary,
  prevActivePylonIds: number[] | undefined,
  prevOnlineEntityIds: number[] | undefined,
  ctx: StepContext,
): { currentPylonIds: number[]; currentOnlineIds: number[] } {
  const e = state.entities, cols = e.cols;
  const currentPylonIds: number[] = [];
  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.hp[row] <= 0) continue;
    if (cols.kind[row] === ENTITY_KIND.pylon && cols.state[row] !== ENTITY_STATE.constructing) {
      currentPylonIds.push(cols.id[row]);
    }
  }

  const currentOnlineIds: number[] = [];
  if (summary.entityPower) {
    for (const [idStr, status] of Object.entries(summary.entityPower)) {
      if (status.state === 'online') currentOnlineIds.push(Number(idStr));
    }
  }

  if (prevActivePylonIds && prevOnlineEntityIds && prevOnlineEntityIds.length > 0) {
    const curPylonSet = new Set(currentPylonIds);
    const missingPylonIds = prevActivePylonIds.filter((id) => !curPylonSet.has(id));
    if (missingPylonIds.length > 0) {
      const unpoweredSet = new Set(summary.unpoweredEntityIds ?? []);
      const severedEntityIds = prevOnlineEntityIds.filter(
        (id) => unpoweredSet.has(id) && !missingPylonIds.includes(id),
      );
      if (severedEntityIds.length > 0) {
        for (const pylonId of missingPylonIds) {
          ctx.emit({
            kind: 'powerSevered',
            severity: 'warn',
            colonyIds: [colonyIndex],
            data: {
              colonyId: state.colonies[colonyIndex]?.id,
              pylonId,
              severedCount: severedEntityIds.length,
              severedEntityIds,
              componentCount: summary.components?.length ?? 1,
            },
          });
        }
      }
    }
  }
  return { currentPylonIds, currentOnlineIds };
}

function checkBrownoutShedEvents(
  state: PlanetState,
  colonyIndex: number,
  summary: ColonyPowerSummary,
  prevComponentShedIds: Record<number, number[]> | undefined,
  ctx: StepContext,
): Record<number, number[]> {
  const nextShedIds: Record<number, number[]> = {};
  if (!summary.components) return nextShedIds;

  for (const comp of summary.components) {
    const cId = comp.componentId;
    const currentShed = comp.shedEntityIds ?? [];
    nextShedIds[cId] = [...currentShed];

    const prevShed = prevComponentShedIds?.[cId] ?? [];
    const isDifferent =
      currentShed.length !== prevShed.length ||
      currentShed.some((id) => !prevShed.includes(id));

    if (currentShed.length > 0 && isDifferent) {
      ctx.emit({
        kind: 'brownoutShed',
        severity: 'warn',
        colonyIds: [colonyIndex],
        data: {
          colonyId: state.colonies[colonyIndex]?.id,
          componentId: comp.componentId,
          groups: comp.shedGroupsActive,
          shedEntityIds: currentShed,
          deficitPerS: comp.deficitPerS,
        },
      });
    }
  }
  return nextShedIds;
}

function checkNightSurvived(
  state: PlanetState,
  colonyIndex: number,
  summary: ColonyPowerSummary,
  prevPhase: 'day' | 'night' | undefined,
  nightShedBeyondGroup1: boolean,
  ctx: StepContext,
  data?: CompiledDataLike,
): boolean {
  let nextShedBeyond = nightShedBeyondGroup1;
  if (summary.phase === 'night') {
    if (summary.shedGroupsActive.some((g) => g > 1)) {
      nextShedBeyond = true;
    }
  }

  if (prevPhase === 'night' && summary.phase === 'day') {
    if (!nextShedBeyond && summary.hasHub) {
      const pTime = getPlanetTime(state, data, ctx.tick);
      ctx.emit({
        kind: 'nightSurvived',
        severity: 'info',
        colonyIds: [colonyIndex],
        data: {
          colonyId: state.colonies[colonyIndex]?.id,
          dayNumber: pTime.day,
          capacitorChargeRemainingE: Math.max(0, Number((summary.capacitorStoredE ?? 0).toFixed(2))),
        },
      });
    }
    nextShedBeyond = false;
  }
  return nextShedBeyond;
}

export function evaluatePowerEventsForColony(
  state: PlanetState,
  colonyIndex: number,
  summary: ColonyPowerSummary,
  tracker: PowerEventTracker | undefined,
  ctx: StepContext,
  data?: CompiledDataLike,
): PowerEventTracker {
  const dayCycleRow = resolvePowerRow(data, 'economyT1Basic', 'dayCycle');
  const collapseAfterTicks = Number(dayCycleRow.energyCollapseAfterS ?? 150);

  const next: PowerEventTracker = tracker
    ? {
        brownoutTicks: tracker.brownoutTicks,
        collapseEmitted: tracker.collapseEmitted,
        activeGroups: [...tracker.activeGroups],
        lastGroupEmitTick: { ...tracker.lastGroupEmitTick },
        prevActivePylonIds: tracker.prevActivePylonIds,
        prevOnlineEntityIds: tracker.prevOnlineEntityIds,
        prevComponentShedIds: tracker.prevComponentShedIds ? { ...tracker.prevComponentShedIds } : {},
        prevPhase: tracker.prevPhase ?? summary.phase,
        nightShedBeyondGroup1: tracker.nightShedBeyondGroup1 ?? false,
      }
    : {
        brownoutTicks: 0,
        collapseEmitted: false,
        activeGroups: [],
        lastGroupEmitTick: {},
        prevPhase: summary.phase,
        nightShedBeyondGroup1: false,
      };

  const { currentPylonIds, currentOnlineIds } = checkPowerSevered(
    state, colonyIndex, summary, tracker?.prevActivePylonIds, tracker?.prevOnlineEntityIds, ctx,
  );
  next.prevActivePylonIds = currentPylonIds;
  next.prevOnlineEntityIds = currentOnlineIds;

  next.prevComponentShedIds = checkBrownoutShedEvents(
    state, colonyIndex, summary, tracker?.prevComponentShedIds, ctx,
  );

  next.nightShedBeyondGroup1 = checkNightSurvived(
    state, colonyIndex, summary, tracker?.prevPhase, Boolean(next.nightShedBeyondGroup1), ctx, data,
  );
  next.prevPhase = summary.phase;

  if (!summary.brownout) {
    next.brownoutTicks = 0;
    next.collapseEmitted = false;
    next.activeGroups = [];
    return next;
  }

  const deficitPerS = Math.max(0, Number((summary.rawDemand - summary.supply).toFixed(4)));

  for (const group of summary.shedGroupsActive) {
    const wasActive = next.activeGroups.includes(group);
    const lastTick = next.lastGroupEmitTick[group] ?? -Infinity;
    if (!wasActive && ctx.tick - lastTick >= BROWNOUT_DEBOUNCE_TICKS) {
      ctx.emit({
        kind: 'brownout',
        severity: 'warn',
        colonyIds: [colonyIndex],
        data: {
          group,
          shedEntityIds: summary.shedEntityIds,
          deficitPerS,
        },
      });
      next.lastGroupEmitTick[group] = ctx.tick;
    }
  }
  next.activeGroups = [...summary.shedGroupsActive];

  next.brownoutTicks += ctx.dt;
  if (next.brownoutTicks >= collapseAfterTicks && !next.collapseEmitted) {
    const durationS = Math.round((next.brownoutTicks * TICK_MS) / 1000);
    ctx.emit({
      kind: 'energyCollapse',
      severity: 'critical',
      colonyIds: [colonyIndex],
      data: {
        durationS,
        deficitPerS,
        shedGroups: summary.shedGroupsActive,
      },
    });
    next.collapseEmitted = true;
  }

  const col = state.colonies[colonyIndex];
  if (col) {
    col.brownoutTicks = next.brownoutTicks;
    col.energyCollapsed = next.collapseEmitted;
  }

  return next;
}
