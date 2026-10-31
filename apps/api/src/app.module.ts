import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [ConfigModule, DatabaseModule, AuditModule],
  controllers: [HealthController],
})
export class AppModule {}
