import type { CreateDescentSequence } from '@terra/render/descent/types';
import { DescentRunner } from './DescentRunner';

export const createDescentSequence: CreateDescentSequence = (opts) => new DescentRunner(opts);
