import { Module } from '@nestjs/common';
import { TeacherContentController } from './content.controller';
import { ContentService } from './content.service';

@Module({
  controllers: [TeacherContentController],
  providers: [ContentService],
})
export class ContentModule {}
