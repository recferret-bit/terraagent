import { z } from 'zod';
import { ColonyId } from '../ids';

/**
 * Planet ids of the home flow: ULID `pl_…` ids (`PlanetId`) and the dev planet family ids (`pl_dev`, `pl_dev_ocean_2`).
 * Colony ids: new colonies get ULID `co_…` ids (`ColonyId`); rows written before 2026-11-01 keep `col_<base36>_<hex>`
 * (BE-21, owner question: drop the legacy pattern after a DB reset).
 * Lives outside `home.ts` so digest schemas can use it without a cycle back into `HomeResponse`.
 */
export const HomePlanetId = z.string().regex(/^pl_[A-Za-z0-9_-]{1,64}$/);
export const HomeColonyId = z.union([ColonyId, z.string().regex(/^col_[A-Za-z0-9_-]{1,64}$/)]);
