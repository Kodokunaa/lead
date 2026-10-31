import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Global so every feature module can record events. The admin viewer endpoint (A15)
 * is added in Phase 7 once authentication and RBAC guards exist (Phase 1).
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
