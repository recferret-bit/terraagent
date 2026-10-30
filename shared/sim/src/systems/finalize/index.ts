import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';

/** Slot 14. Placeholder proving registry discovery; the kernel itself advances the tick. */
export const finalize = defineSystem({ id: 'finalize', slot: 14, wave: 'W00', run() { /* no-op */ } });

export default defineSimModule({ id: 'finalize', wave: 'W00', systems: [finalize] });
