import { Module } from '@nestjs/common';
import {
  AdminSectionsController,
  StudentClassesController,
  TeacherClassesController,
} from './sections.controller';
import { SectionsService } from './sections.service';

@Module({
  controllers: [AdminSectionsController, TeacherClassesController, StudentClassesController],
  providers: [SectionsService],
  exports: [SectionsService],
})
export class SectionsModule {}
