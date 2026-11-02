import { setBlob, type SimState } from '../../kernel/state';

/**
 * The construction queue (`blobs.constructionQueue`): one shape, `{ orders: ConstructionOrder[] }` (GP-08). Open
 * orders only: a completed order leaves the queue (its result is the active building and the colony record, GP-10).
 * Order ids are made by the sim (GP-09); `taskId` is the client's command id.
 */

export type ConstructionStatus = 'waiting_site' | 'waiting_resources' | 'in_progress' | 'completed' | 'cancelled';

export interface ConstructionOrder {
  /** Sim-made, unique on the planet (`build#<n>`). */
  orderId: string;
  /** The client's id for the order (its command id), or the order id. */
  taskId: string;
  colonyId: number;
  building: string;
  tier: number;
  entityId: number;
  q: number;
  r: number;
  footprint: number;
  status: ConstructionStatus;
  /** Why the order waits (`waiting(site: 5/9)`, `waiting(resources: metals.t1 120/200)`, `blocked(…)`). */
  waitingReason?: string;
  /** What the panel shows: the waiting reason, the builder's progress state, or the status ({@link statusTextOf}). */
  statusText: string;
  /** While `waiting_resources` after the build started: the shortage it waits on (resumes once stock covers it). */
  waitingFor?: { resource: string; need: number };
  preparedCount: number;
  totalTiles: number;
  /** The linked site-prep terraform order (`<orderId>/prep`), while it exists. */
  linkedPrepOrderId?: string;
  progress: number;
  /** Nominal build time in seconds at work rate 1.0 (`hub.t1.buildS`). */
  buildTimeS: number;
  cost: Record<string, number>;
  /** Payment started (the start gate passed); the cost is then spent gradually into `paidAmounts`. */
  costPaid: boolean;
  paidAmounts?: Record<string, number>;
  createdAtTick: number;
}

/**
 * The one status → text rule (GP-12): a waiting order shows why, any other its status. (While the builder walks to a
 * running order, the `build` command shows `waiting(builder: HQ en route)` instead.)
 */
export function statusTextOf(order: Pick<ConstructionOrder, 'status' | 'waitingReason'>): string {
  if (order.status === 'waiting_site' || order.status === 'waiting_resources') return order.waitingReason ?? order.status;
  return order.status;
}

/** Sets `status` and its reason and derives `statusText` from them; returns whether anything changed. */
export function setOrderStatus(order: ConstructionOrder, status: ConstructionStatus, waitingReason?: string): boolean {
  const key = (): string => `${order.status}|${order.waitingReason ?? ''}|${order.statusText}|${order.waitingFor ? 1 : 0}`;
  const before = key();
  order.status = status;
  if (waitingReason === undefined) delete order.waitingReason;
  else order.waitingReason = waitingReason;
  if (status !== 'waiting_resources') delete order.waitingFor;
  order.statusText = statusTextOf(order);
  return before !== key();
}

/** The orders in a `constructionQueue` blob value (sim state or a client view), optionally of one colony. */
export function constructionOrdersOf(blobValue: unknown, colony?: number): readonly ConstructionOrder[] {
  const orders = (blobValue as { orders?: unknown } | null | undefined)?.orders;
  // Orders saved before `taskId` existed (SIM_VERSION 2 saves) answer to their order id.
  const list = Array.isArray(orders) ? (orders as ConstructionOrder[]).map((o) => (typeof o.taskId === 'string' ? o : { ...o, taskId: o.orderId })) : [];
  return colony === undefined ? list : list.filter((o) => o.colonyId === colony);
}

/** A mutable copy of every open construction order. */
export function readConstructionOrders(state: SimState): ConstructionOrder[] {
  return constructionOrdersOf(state.blobs.constructionQueue?.value).map((o) => ({ ...o }));
}

/** Writes the queue (completed and cancelled orders are dropped) and stamps it at `tick`. */
export function writeConstructionOrders(state: SimState, orders: readonly ConstructionOrder[], tick: number): void {
  setBlob(state, 'constructionQueue', { orders: orders.filter((o) => o.status !== 'completed' && o.status !== 'cancelled') }, tick);
}

/** Returns the open construction orders of `colonyId` (or of all colonies when omitted). */
export function getConstructionOrders(state: SimState, colonyId?: number): ConstructionOrder[] {
  const all = readConstructionOrders(state);
  return colonyId === undefined ? all : all.filter((o) => o.colonyId === colonyId);
}

/** The colony's open construction order named `id` (order id, the client's task id, or the building's entity id). */
export function findConstructionOrder(state: SimState, colonyId: number, id: string): ConstructionOrder | undefined {
  const own = constructionOrdersOf(state.blobs.constructionQueue?.value, colonyId);
  return own.find((o) => o.orderId === id) ?? own.find((o) => o.taskId === id) ?? own.find((o) => String(o.entityId) === id);
}
