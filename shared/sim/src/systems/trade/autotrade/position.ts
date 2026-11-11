import { potentialBuy } from '../../../economy/flows/calculators';
import { shoppingBasket, type BasketDemand } from '../../../economy/flows/shopping';
import type { AutoTradeStock } from './types';

const whole = (n: number | undefined): number => (n !== undefined && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

function demands(p: AutoTradeStock): BasketDemand[] {
  const out: BasketDemand[] = [];
  if (whole(p.queued) > 0) out.push({ reason: 'job', resource: p.resource, qty: p.queued });
  if (whole(p.serviceWindow) > 0) out.push({ reason: 'logistics', resource: p.resource, qty: p.serviceWindow });
  return out;
}

/** Leftover whole units after queues, open reservations and the service window. The reserve floor is not removed here. */
export function committedSurplus(p: AutoTradeStock): number {
  const basket = shoppingBasket({
    holdings: { [p.resource]: p.stock },
    reservedByOrders: { [p.resource]: p.reserved },
    demands: demands(p),
    safety: {},
  });
  return basket.sell.find((line) => line.resource === p.resource)?.qty ?? 0;
}

/** `potentialBuy` of planned queues plus the service window, against the reserve floor, horizon and own production. */
export function reserveShortage(p: AutoTradeStock): number {
  const available = whole(Math.max(0, p.stock - whole(p.reserved)));
  return Number(potentialBuy({
    planned: BigInt(whole(p.queued) + whole(p.serviceWindow)),
    reserve: BigInt(whole(p.reserveFloor) + whole(p.reserveHorizon)),
    available: BigInt(available),
    expectedOwn: BigInt(whole(p.expectedOwn)),
  }));
}
