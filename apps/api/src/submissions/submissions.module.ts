import { Module } from '@nestjs/common';
import { AttemptsModule } from '../attempts/attempts.module';
import { ResourcesModule } from '../resources/resources.module';
import { GradingService } from './grading.service';
import { QuizGradingService } from './quiz-grading.service';
import { StudentSubmissionsController, TeacherGradingController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';

@Module({
  imports: [ResourcesModule, AttemptsModule],
  controllers: [StudentSubmissionsController, TeacherGradingController],
  providers: [SubmissionsService, GradingService, QuizGradingService],
})
export class SubmissionsModule {}
