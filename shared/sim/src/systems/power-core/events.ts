import type { CompiledDataLike } from '../../kernel/config';
import { TICK_MS } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { resolvePowerRow, type ColonyPowerSummary } from './index';

export interface PowerEventTracker {
  brownoutTicks: number;
  collapseEmitted: boolean;
  activeGroups: number[];
  lastGroupEmitTick: Record<number, number>;
}

const BROWNOUT_DEBOUNCE_TICKS = 50; // 10 s debounce per shed group

export function evaluatePowerEventsForColony(
  state: PlanetState,
  colonyIndex: number,
  summary: ColonyPowerSummary,
  tracker: PowerEventTracker | undefined,
  ctx: StepContext,
  data?: CompiledDataLike,
): PowerEventTracker {
  const dayCycleRow = resolvePowerRow(data, 'economyT1Basic', 'dayCycle');
  const collapseAfterTicks = Number(dayCycleRow.energyCollapseAfterS ?? 150); // 30 s = 150 ticks

  const next: PowerEventTracker = tracker
    ? {
        brownoutTicks: tracker.brownoutTicks,
        collapseEmitted: tracker.collapseEmitted,
        activeGroups: [...tracker.activeGroups],
        lastGroupEmitTick: { ...tracker.lastGroupEmitTick },
      }
    : {
        brownoutTicks: 0,
        collapseEmitted: false,
        activeGroups: [],
        lastGroupEmitTick: {},
      };

  if (!summary.brownout) {
    next.brownoutTicks = 0;
    next.collapseEmitted = false;
    next.activeGroups = [];
    return next;
  }

  const deficitPerS = Math.max(0, Number((summary.rawDemand - summary.supply).toFixed(4)));

  // Emit debounced brownout {group} for newly shed groups
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

  // Track continuous brownout duration for energyCollapse (>= 30s = 150 ticks)
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

  // Expose tracker on colony for inspection
  const col = state.colonies[colonyIndex];
  if (col) {
    col.brownoutTicks = next.brownoutTicks;
    col.energyCollapsed = next.collapseEmitted;
  }

  return next;
}
