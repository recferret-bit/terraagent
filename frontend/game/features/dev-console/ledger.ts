import type { JournalEntry, Leg } from '@terra/ledger';
import { colonyAccount } from '@terra/sim';
import type { DevCommandDef, FeatureContext } from '../../core/registry/types';
import { intArg } from '../../dev/console/parse';
import { DevServerError, type LedgerReply } from '../../net/devServer';
import '../../net/services';

const DEFAULT_COUNT = 10;

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

export function formatLeg(leg: Leg): string {
  return `${leg.account} ${leg.asset} ${signed(leg.delta)}`;
}

/** One journal entry on one line: `#12 t=340 construction.spend player:p1 order:7  colony:0 metals.t1 -2 · …`. */
export function formatEntry(entry: JournalEntry): string {
  const head = [`#${entry.seq}`, `t=${entry.at}`, entry.reason, entry.actor, entry.ref].filter(Boolean).join(' ');
  return `${head}  ${entry.legs.map(formatLeg).join(' · ')}`;
}

export function formatBalances(balances: Readonly<Record<string, number>>, account: string): string {
  const parts = Object.keys(balances)
    .sort()
    .filter((asset) => balances[asset] !== 0)
    .map((asset) => `${asset} ${balances[asset]}`);
  return `balance ${account}: ${parts.length > 0 ? parts.join(' · ') : '(empty)'}`;
}

/** The host's last `count` entries touching the account (oldest first), then its balance line. */
export function ledgerLines(reply: LedgerReply, count: number): string[] {
  const shown = reply.entries.slice(-count);
  const lines = shown.length > 0 ? shown.map(formatEntry) : [`no entries for ${reply.account} in the host's journal`];
  return [...lines, formatBalances(reply.balances, reply.account)];
}

function ownerAccount(ctx: FeatureContext): string {
  return colonyAccount(ctx.services.landfall?.getOwnerColonyIndex() ?? ctx.services.colonyId ?? 0);
}

/**
 * `ledger [n] [account]`: the journal lives on the host only (server Postgres, or the browser host's memory), so this asks
 * the host (`services.ledgerQuery`: dev REST route online, a worker message on `?host=local`) instead of reading the view.
 */
export const ledgerCommand: DevCommandDef = {
  name: 'ledger',
  help: 'ledger [n] [account]  Last n (default 10) resource ledger entries touching account (default your colony:<i>), plus its balance (asks the host)',
  async run(a, ctx) {
    // `ledger colony:1` is accepted as a shorthand for `ledger 10 colony:1`.
    const accountFirst = a[0] !== undefined && a[0].includes(':');
    const count = accountFirst ? DEFAULT_COUNT : intArg(a, 0, 'n', DEFAULT_COUNT);
    if (count < 1) throw new Error('<n> must be at least 1');
    const account = (accountFirst ? a[0] : a[1]) ?? ownerAccount(ctx);
    const query = ctx.services.ledgerQuery;
    if (!query) throw new DevServerError('host_unavailable', 'no host ledger on this page (needs the online or local-host session)');
    return ledgerLines(await query(account, count), count).join('\n');
  },
};
