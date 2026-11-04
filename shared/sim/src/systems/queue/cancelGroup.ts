import type { PlanetState } from '../../kernel/state';
import { colonyTerraformOrders } from '../terraform-basic/orders';
import { getWorkJobsMap, isLeadJob } from '../terraform-basic/workJobs';
import { getAllQueueEntries } from './index';
import type { QueueEntry } from './types';

interface Candidate {
  /** What the one-order cancel takes. */
  id: string;
  /** Other ids that name the same candidate (the client's task id, a chain job id). */
  aliases: string[];
  kind: string;
}

const entryKind = (e: QueueEntry): string => {
  const t = e.task;
  if (t.kind === 'build') return `build:${t.building}`;
  if (t.kind === 'buildUnit') return `buildUnit:${t.unit}`;
  return t.kind;
};

/** Every open cancellable thing of `colonyIndex`, tagged with its kind (terraform orders and jobs all share `terraform`). */
function candidates(state: PlanetState, colonyIndex: number): Candidate[] {
  const out: Candidate[] = [];
  for (const o of colonyTerraformOrders(state, colonyIndex)) {
    if (!o.isLinkedPrep) out.push({ id: o.orderId, aliases: [o.taskId], kind: 'terraform' });
  }
  const chains = new Set<string>();
  for (const j of Object.values(getWorkJobsMap(state))) {
    if (j.colonyId !== colonyIndex || j.mode !== 'terraform' || !isLeadJob(j)) continue;
    const id = j.chainRootId ?? j.jobId;
    if (chains.has(id)) continue;
    chains.add(id);
    out.push({ id, aliases: [j.jobId], kind: 'terraform' });
  }
  for (const e of getAllQueueEntries(state)) {
    if (e.colonyIndex !== colonyIndex || e.goalId || e.state === 'done' || e.state === 'cancelled') continue;
    out.push({ id: e.taskId, aliases: [], kind: entryKind(e) });
  }
  return out;
}

/**
 * The ids a `cancelTask { scope: 'sameKind' }` on `taskId` cancels: `taskId` itself plus every other open order, work
 * job and queue entry of the colony of the same kind (all terraform work counts as one kind). A wildcard, a
 * `building:` / `unit:` id or an unknown id stays alone (a unit cancel already ends all of its work).
 */
export function sameKindTaskIds(state: PlanetState, taskId: string, colonyIndex: number): string[] {
  const all = candidates(state, colonyIndex);
  const hit = all.find((c) => c.id === taskId || c.aliases.includes(taskId));
  if (!hit) return [taskId];
  const ids = all.filter((c) => c.kind === hit.kind).map((c) => c.id);
  return [hit.id, ...ids.filter((id) => id !== hit.id)];
}
