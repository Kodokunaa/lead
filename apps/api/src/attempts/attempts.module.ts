import { Module } from '@nestjs/common';
import { StudentAttemptsController } from './attempts.controller';
import { AttemptsService } from './attempts.service';

@Module({
  controllers: [StudentAttemptsController],
  providers: [AttemptsService],
})
export class AttemptsModule {}
