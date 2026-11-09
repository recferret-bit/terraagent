import type { DirectorRisk } from '@terra/contracts';
import { readDirectorView } from '@terra/sim';
import type { DevCommandDef, FeatureContext } from '../../core/registry/types';
import { ownColonyIndex } from '../shared/colony';
import type { DirectorActionRow } from './DirectorPanel';

let lastOutcome = 'proposed';

function rowsForRisk(risk: DirectorRisk): DirectorActionRow[] {
  if (risk === 'risky') {
    return [
      {
        actionId: 'grow-economy',
        state: 'applied',
        rationale: '35% commit · Commit grow_economy at the risky ceiling.',
      },
      {
        actionId: 'harvest-metals',
        state: 'applied',
        rationale: 'Weight metals 70 / minerals 20 / bio 10.',
      },
    ];
  }
  return [
    {
      actionId: 'grow-economy',
      state: 'applied',
      rationale: '15% commit · Hold one grow_economy goal at the conservative commitment.',
    },
  ];
}

function handleFault(fault: string, risk: DirectorRisk, intentRevision: number, ctx: FeatureContext): string {
  const panel = ctx.services.getDirectorPanel?.();
  if (fault === 'raid_proposal') {
    lastOutcome = 'unauthorized';
    panel?.renderPlan(
      [{ actionId: 'act-raid', state: 'rejected', reason: 'away_raids', rationale: 'Raid proposals are outside director authority.' }],
      intentRevision,
    );
    return `plan forced trigger=resource.shortage risk=${risk} fault=raid_proposal outcome=unauthorized queue=1 trace=mock`;
  }
  if (fault === 'locked_goal') {
    lastOutcome = 'rejected';
    panel?.renderPlan(
      [{ actionId: 'cancel-manual', state: 'rejected', reason: 'locked_goal', rationale: 'Player-locked goal preserved.' }],
      intentRevision,
    );
    return `plan forced trigger=resource.shortage risk=${risk} fault=locked_goal outcome=rejected queue=1 trace=mock`;
  }
  if (fault === 'stale_revision') {
    lastOutcome = 'superseded';
    panel?.renderPlan(
      [{ actionId: 'grow-economy', state: 'superseded', reason: 'stale_revision', rationale: 'Superseded by newer player intent.' }],
      intentRevision,
    );
    return `plan forced trigger=resource.shortage risk=${risk} fault=stale_revision outcome=superseded queue=1 trace=mock`;
  }
  lastOutcome = 'invalid';
  panel?.renderPlan(
    [{ actionId: 'fault-action', state: 'rejected', reason: fault, rationale: 'Rejected before command ingress.' }],
    intentRevision,
  );
  return `plan forced trigger=resource.shortage risk=${risk} fault=${fault} outcome=invalid queue=1 trace=mock`;
}

const plan: DevCommandDef = {
  name: 'director.plan',
  help: 'Force one mock director plan and print its trace and queue depth. Dev only.',
  run(args, ctx) {
    const view = ctx.services.store?.latest;
    const record = readDirectorView(view, ownColonyIndex(ctx.services));
    const liveRisk: DirectorRisk = record?.policy.risk ?? 'conservative';
    const intentRevision = record?.intentRevision ?? 0;
    const arg = args[0]?.trim();
    if (arg && arg !== 'conservative' && arg !== 'risky') {
      return handleFault(arg, liveRisk, intentRevision, ctx);
    }
    const risk: DirectorRisk = arg === 'risky' || arg === 'conservative' ? arg : liveRisk;
    lastOutcome = 'proposed';
    ctx.services.getDirectorPanel?.()?.renderPlan(rowsForRisk(risk), intentRevision);
    return `plan forced trigger=resource.shortage risk=${risk} queue=1 trace=mock`;
  },
};

const trace: DevCommandDef = {
  name: 'director.trace',
  help: 'Print the last mock director trace. Dev only.',
  run() {
    return `trace mock queue=1 outcome=${lastOutcome}`;
  },
};

/** Production builds omit these commands (AI §11). */
export function directorDevCommands(nodeEnv = 'development'): DevCommandDef[] {
  if (nodeEnv === 'production') return [];
  return [plan, trace];
}
