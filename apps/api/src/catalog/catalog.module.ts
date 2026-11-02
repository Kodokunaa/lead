import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { CourseRecordService } from './course-record.service';

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, CourseRecordService],
  exports: [CatalogService],
})
export class CatalogModule {}
