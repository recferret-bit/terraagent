import { Module } from '@nestjs/common';
import { BusModule } from '../../bus/bus.module';
import { ProgressionEventsService } from './progression-events.service';

@Module({
  imports: [BusModule],
  providers: [ProgressionEventsService],
  exports: [ProgressionEventsService],
})
export class ProgressionEventsModule {}
