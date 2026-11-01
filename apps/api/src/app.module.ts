import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { CalendarModule } from './calendar/calendar.module';
import { CatalogModule } from './catalog/catalog.module';
import { SectionsModule } from './sections/sections.module';
import { ConfigModule } from './config/config.module';
import { ContentModule } from './content/content.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { MailModule } from './mail/mail.module';
import { MeModule } from './me/me.module';

/**
 * Default per-IP request budget, sized for a classroom behind one shared campus IP.
 * Sign-in has its own stricter limit.
 */
const DEFAULT_RATE_LIMIT = { limit: 1_200, ttl: 60_000 };

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuditModule,
    MailModule,
    AuthModule,
    AdminModule,
    MeModule,
    CatalogModule,
    SectionsModule,
    ContentModule,
    CalendarModule,
    ThrottlerModule.forRoot([{ name: 'default', ...DEFAULT_RATE_LIMIT }]),
  ],
  controllers: [HealthController],
  // Guards run in this order: rate limit first, then authentication and roles.
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: AuthGuard },
  ],
})
export class AppModule {}
