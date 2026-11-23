import { isProductionBuild } from '../buildEnv';
import { resolveClientFlags } from './resolve';
import { ClientFlagsStore } from './store';

export * from './resolve';
export * from './store';
export { clientDataFor } from './data';

/** Store for the page: dev builds honour `?waves=`; no server welcome yet. */
export const createClientFlagsStore = (search: string = location.search) =>
  new ClientFlagsStore(
    resolveClientFlags({
      search,
      dev: !isProductionBuild() && Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV),
    }),
  );
