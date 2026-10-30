import type { CreateDescentSequence } from './types';
import { DescentRunner } from './DescentRunner';

export const createDescentSequence: CreateDescentSequence = (opts) => new DescentRunner(opts);
