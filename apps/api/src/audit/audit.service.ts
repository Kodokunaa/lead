import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { auditEventInputSchema, type AuditEventInput } from '@lead/schema';
import { desc } from 'drizzle-orm';
import { DATABASE, type Database } from '../database/database.module';
import { auditEvents, type AuditEventRow } from '../database/schema';

const MAX_PAGE_SIZE = 100;

@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Validates and appends one event. Throws if a reason-required action has no reason,
   * so callers cannot silently skip the audit trail for consequential changes.
   */
  async record(input: AuditEventInput): Promise<AuditEventRow> {
    const parsed = auditEventInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid audit event',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const [row] = await this.db.insert(auditEvents).values(parsed.data).returning();
    if (!row) throw new Error('Audit insert returned no row');
    return row;
  }

  async listRecent(limit: number): Promise<AuditEventRow[]> {
    const requested = Number.isFinite(limit) ? Math.trunc(limit) : MAX_PAGE_SIZE;
    const pageSize = Math.min(Math.max(requested, 1), MAX_PAGE_SIZE);
    return this.db
      .select()
      .from(auditEvents)
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(pageSize);
  }
}
