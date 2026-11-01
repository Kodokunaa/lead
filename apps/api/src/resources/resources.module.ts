import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module';
import { ResourceStorage } from './resource-files';
import { AdminResourcesController, TeacherResourcesController } from './resources.controller';
import { ResourcesService } from './resources.service';

@Module({
  imports: [ContentModule],
  controllers: [TeacherResourcesController, AdminResourcesController],
  providers: [ResourcesService, ResourceStorage],
  exports: [ResourcesService],
})
export class ResourcesModule {}
