/**
 * Colony economy (D-34): every resource change goes through {@link ColonyTreasury} `add` / `withdraw`. They validate
 * (whole major units, known resource, reason, no negative balance), update `col.stock` (the balance clients see) and
 * record one balanced double-entry posting with a reason, an actor and a ref. Postings leave the step in
 * `StepResult.postings`; the host keeps the full journal (`@terra/ledger`), clients never receive it.
 */
export * from './accounts';
export * from './caps';
export * from './reasons';
export { emptyStock, getColonyStock } from './store';
export * from './treasury';
