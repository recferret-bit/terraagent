import { Logger } from '@nestjs/common';
import type { TransferCargoInput } from '../application/ports/cargo-token.port.js';

/**
 * One watcher for a committed `CargoTokenPort.transfer`.
 * The mock adapter notifies after the receipt is stored. A repeated `opId` notifies again;
 * the delivery ledger ignores the second insert.
 */
export type CargoTransferObserver = (input: TransferCargoInput) => Promise<void>;

const log = new Logger('CargoTransferHook');
let observer: CargoTransferObserver | null = null;

export function setCargoTransferObserver(next: CargoTransferObserver | null): void {
  observer = next;
}

/** Clears the watcher only when it is still `current`, so a test cannot drop the app's. */
export function clearCargoTransferObserver(current: CargoTransferObserver): void {
  if (observer === current) observer = null;
}

export async function notifyCargoTransferred(input: TransferCargoInput): Promise<void> {
  if (!observer) return;
  try {
    await observer(input);
  } catch (err) {
    log.warn(`cargo transfer observer failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
