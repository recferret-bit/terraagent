import { z } from 'zod';
import { ulid } from 'ulid';

/** PR-02: every id is a prefixed ULID (`pr_01J…`). */
export const ID_PREFIXES = {
  player: 'pr', colony: 'co', planet: 'pl', matchTicket: 'mt', party: 'pt', command: 'cm',
  trade: 'tr', marketOrder: 'or', bounty: 'bt', truce: 'tc',
} as const;
export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

const ULID_BODY = '[0-9A-HJKMNP-TV-Z]{26}';
export const idPattern = (prefix: IdPrefix) => new RegExp(`^${prefix}_${ULID_BODY}$`);

/** zod schema for one id kind. */
export const prefixedId = (prefix: IdPrefix) => z.string().regex(idPattern(prefix), `expected a ${prefix}_ ULID`);

/** A fresh id: `newId('cm')` → `cm_01J…`. Uses crypto randomness, so it works in Node and browsers (not in the sim). */
export const newId = (prefix: IdPrefix) => `${prefix}_${ulid()}`;

export const PlayerId = prefixedId('pr');
export const ColonyId = prefixedId('co');
export const PlanetId = prefixedId('pl');
export const CmdId = prefixedId('cm');
