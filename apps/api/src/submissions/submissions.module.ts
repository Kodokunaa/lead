import { Module } from '@nestjs/common';
import { ResourcesModule } from '../resources/resources.module';
import { GradingService } from './grading.service';
import { StudentSubmissionsController, TeacherGradingController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';

@Module({
  imports: [ResourcesModule],
  controllers: [StudentSubmissionsController, TeacherGradingController],
  providers: [SubmissionsService, GradingService],
})
export class SubmissionsModule {}
