import { Module } from '@nestjs/common';
import { CalendarModule } from '../calendar/calendar.module';
import { ResourcesModule } from '../resources/resources.module';
import { SectionsModule } from '../sections/sections.module';
import { StudentLearningController } from './learning.controller';
import { LearningService } from './learning.service';

@Module({
  imports: [SectionsModule, CalendarModule, ResourcesModule],
  controllers: [StudentLearningController],
  providers: [LearningService],
})
export class LearningModule {}
