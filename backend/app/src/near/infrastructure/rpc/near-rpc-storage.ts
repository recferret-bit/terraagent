import type { JsonRpcProvider } from 'near-api-js';

export const YOCTO_PER_STORAGE_BYTE = 10n ** 19n;
export const YOCTO_PER_NEAR = 10n ** 24n;
export const DEFAULT_LOW_STORAGE_NEAR = 0.25;

export interface AccountStorageReport {
  readonly accountId: string;
  readonly totalNear: number;
  readonly storageBytes: number;
  readonly storageLockedNear: number;
  readonly liquidHeadroomNear: number;
  readonly lowStorage: boolean;
}

export function computeStorageReport(
  accountId: string,
  totalYoctoRaw: string | bigint,
  storageUsageBytes: number,
  thresholdNear = DEFAULT_LOW_STORAGE_NEAR,
): AccountStorageReport {
  const totalYocto = typeof totalYoctoRaw === 'bigint' ? totalYoctoRaw : BigInt(totalYoctoRaw || '0');
  const bytes = Math.max(0, Math.floor(Number(storageUsageBytes || 0)));
  const lockedYocto = BigInt(bytes) * YOCTO_PER_STORAGE_BYTE;
  const headroomYocto = totalYocto > lockedYocto ? totalYocto - lockedYocto : 0n;
  const totalNear = Number(totalYocto / 10n ** 18n) / 1e6;
  const storageLockedNear = Number(lockedYocto / 10n ** 18n) / 1e6;
  const liquidHeadroomNear = Number(headroomYocto / 10n ** 18n) / 1e6;
  return {
    accountId,
    totalNear,
    storageBytes: bytes,
    storageLockedNear,
    liquidHeadroomNear,
    lowStorage: liquidHeadroomNear < thresholdNear,
  };
}

export async function fetchAccountStorageReport(
  withFailover: <T>(op: (p: JsonRpcProvider) => Promise<T>) => Promise<T>,
  accountId: string,
  thresholdNear = DEFAULT_LOW_STORAGE_NEAR,
): Promise<AccountStorageReport> {
  const view = (await withFailover((p) => p.viewAccount({ accountId }))) as {
    amount?: string | bigint;
    storage_usage?: number;
  };
  return computeStorageReport(accountId, view.amount ?? '0', view.storage_usage ?? 0, thresholdNear);
}
