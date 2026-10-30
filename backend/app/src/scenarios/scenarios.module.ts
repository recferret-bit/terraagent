import { Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { defineDevCommand, DevCommandRegistry } from '../dev/dev-command.registry';
import { GameModule } from '../game/game.module';
import { ScenariosController } from './scenarios.controller';
import { ScenariosService } from './scenarios.service';

/** Dev command `scenario { id }` → `{ planetId }` (same call as `POST /v1/dev/scenarios/:id`). */
@Injectable()
class ScenarioDevCommand implements OnModuleInit {
  constructor(@Inject(DevCommandRegistry) private readonly registry: DevCommandRegistry, private readonly scenarios: ScenariosService) {}

  onModuleInit(): void {
    this.registry.register(defineDevCommand({
      name: 'scenario',
      help: 'Create a fresh dev planet from a seed scenario: { id: "w00" } -> { planetId }',
      args: z.object({ id: z.string().min(1).max(64) }).strict(),
      run: async ({ id }) => ({ planetId: (await this.scenarios.create(id)).planetId }),
    }));
  }
}

/** Seed scenarios (W00): fresh dev planets from `scenarios/*.ts` through the thread's snapshot load. */
@Module({
  imports: [GameModule],
  controllers: [ScenariosController],
  providers: [ScenariosService, ScenarioDevCommand],
})
export class ScenariosModule {}
