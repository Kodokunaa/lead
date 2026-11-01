import { Module } from '@nestjs/common';
import { AdminCalendarController, TeacherCalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

@Module({
  controllers: [AdminCalendarController, TeacherCalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
