import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  USER_PAGE_SIZE,
  type AuditAction,
  type Role,
  type UserDetails,
  type UserListQuery,
  type UserListResponse,
  type UserSummary,
} from '@lead/schema';
import {
  aliasedTable,
  and,
  count,
  desc,
  eq,
  gt,
  ilike,
  isNotNull,
  isNull,
  max,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AuthError, AuthService, type ClientInfo } from '../auth/auth.service';
import { verifyPassword } from '../auth/password';
import { DATABASE, type Database, type Transaction } from '../database/database.module';
import { auditEvents, recoveryCodes, sessions, users, type UserRow } from '../database/schema';
import { MAILER, type Mailer } from '../mail/mail.module';

const ACTIVITY_LIMIT = 20;
/** Advisory lock key that serializes administrator changes to accounts. */
const ADMIN_CHANGES_LOCK = 742_001;

/** Would this change leave the account without administrator access? */
function removesAdminAccess(user: UserRow, patch: Partial<typeof users.$inferInsert>): boolean {
  if (user.role !== 'admin' || user.status !== 'active') return false;
  return (
    (patch.role !== undefined && patch.role !== 'admin') ||
    (patch.status !== undefined && patch.status !== 'active')
  );
}

/** A consequential change by an administrator: who, from where, and why. */
export interface AdminChange {
  readonly admin: UserRow;
  readonly client: ClientInfo;
  readonly reason: string | null;
}

function toSummary(user: UserRow): UserSummary {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerifiedAt !== null,
    mfaEnabled: user.mfaEnabledAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

/** LIKE treats % and _ as wildcards; a search for "a_b" should find the text "a_b". */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

/**
 * User management for administrators (wireframes A02, A03, A16). Every change locks the row,
 * checks the current state, records the reason in the audit trail and, when access shrinks,
 * signs the user out everywhere.
 */
@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  async list(query: UserListQuery): Promise<UserListResponse> {
    const conditions: SQL[] = [];
    if (query.status) conditions.push(eq(users.status, query.status));
    if (query.role) conditions.push(eq(users.role, query.role));
    if (query.q) {
      const pattern = likePattern(query.q);
      const match = or(ilike(users.email, pattern), ilike(users.displayName, pattern));
      if (match) conditions.push(match);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [totals], [queue]] = await Promise.all([
      this.db
        .select()
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt), users.id)
        .limit(USER_PAGE_SIZE)
        .offset((query.page - 1) * USER_PAGE_SIZE),
      this.db.select({ total: count() }).from(users).where(where),
      this.db
        .select({ total: count() })
        .from(users)
        .where(and(eq(users.status, 'pending'), isNotNull(users.emailVerifiedAt))),
    ]);

    return {
      items: rows.map(toSummary),
      total: totals?.total ?? 0,
      page: query.page,
      pageSize: USER_PAGE_SIZE,
      awaitingApproval: queue?.total ?? 0,
    };
  }

  async details(userId: string): Promise<UserDetails> {
    const user = await this.find(userId);
    const actor = aliasedTable(users, 'actor');
    const [[sessionStats], activity, activeSessions] = await Promise.all([
      this.db
        .select({ lastSignInAt: max(sessions.familyStartedAt) })
        .from(sessions)
        .where(eq(sessions.userId, userId)),
      this.db
        .select({
          id: auditEvents.id,
          occurredAt: auditEvents.occurredAt,
          action: auditEvents.action,
          outcome: auditEvents.outcome,
          reason: auditEvents.reason,
          actorName: actor.displayName,
        })
        .from(auditEvents)
        .leftJoin(actor, eq(actor.id, auditEvents.actorId))
        .where(
          or(
            and(eq(auditEvents.targetType, 'user'), eq(auditEvents.targetId, userId)),
            eq(auditEvents.actorId, userId),
          ),
        )
        .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
        .limit(ACTIVITY_LIMIT),
      this.countLiveFamilies(userId),
    ]);

    return {
      ...toSummary(user),
      lockedUntil:
        user.lockedUntil && user.lockedUntil > new Date() ? user.lockedUntil.toISOString() : null,
      // Each live family is one signed-in device; rows per family are rotated tokens.
      activeSessions,
      lastSignInAt: sessionStats?.lastSignInAt
        ? new Date(sessionStats.lastSignInAt).toISOString()
        : null,
      activity: activity.map((event) => ({
        ...event,
        occurredAt: event.occurredAt.toISOString(),
      })),
    };
  }

  /** Lets a confirmed registration sign in, and tells the person by email. */
  async approve(userId: string, change: AdminChange): Promise<UserSummary> {
    const updated = await this.changeUser(userId, change, 'account.approved', (user) => {
      if (user.status !== 'pending')
        throw new ConflictException('Only pending accounts can be approved.');
      if (!user.emailVerifiedAt || !user.passwordHash) {
        throw new ConflictException('This person has not confirmed their email address yet.');
      }
      return { status: 'active' };
    });
    this.mailer
      .send({
        to: updated.email,
        subject: 'Your LEAD account is ready',
        text: [
          `Hello ${updated.displayName},`,
          '',
          'An administrator approved your LEAD account. You can sign in now with the password you chose.',
          '',
          'LEAD, City College of Calapan',
        ].join('\n'),
      })
      .catch((error: unknown) => {
        this.logger.error(
          'Could not send approval email',
          error instanceof Error ? error.stack : String(error),
        );
      });
    return updated;
  }

  async reject(userId: string, change: AdminChange): Promise<UserSummary> {
    return this.changeUser(userId, change, 'account.rejected', (user) => {
      if (user.status !== 'pending')
        throw new ConflictException('Only pending accounts can be rejected.');
      return { status: 'rejected' };
    });
  }

  async deactivate(userId: string, change: AdminChange): Promise<UserSummary> {
    const updated = await this.changeUser(
      userId,
      change,
      'account.deactivated',
      (user) => {
        if (user.status !== 'active')
          throw new ConflictException('Only active accounts can be deactivated.');
        return { status: 'deactivated' };
      },
      { signOut: true },
    );
    this.notify(updated, 'Your LEAD account was deactivated', [
      'An administrator deactivated your LEAD account and signed you out.',
      'If you think this is a mistake, contact the registrar.',
    ]);
    return updated;
  }

  /** Only accounts that were active before; a rejected registration needs a new request. */
  async reactivate(userId: string, change: AdminChange): Promise<UserSummary> {
    return this.changeUser(userId, change, 'account.reactivated', (user) => {
      if (user.status !== 'deactivated') {
        throw new ConflictException('Only deactivated accounts can be reactivated.');
      }
      return { status: 'active', failedSignIns: 0, lockedUntil: null };
    });
  }

  /** The role is in every access token, so the user is signed out to pick up the new one. */
  async changeRole(userId: string, role: Role, change: AdminChange): Promise<UserSummary> {
    const updated = await this.changeUser(
      userId,
      change,
      'account.role_changed',
      (user) => {
        if (user.role === role) throw new ConflictException('The account already has this role.');
        return { role };
      },
      { signOut: true },
    );
    this.notify(updated, 'Your LEAD role changed', [
      `An administrator changed your role to ${role}. Sign in again to continue.`,
    ]);
    return updated;
  }

  /**
   * For someone who lost their phone and recovery codes: they sign in with the password only.
   * The administrator confirms their own password first, so a stolen session cannot do this.
   */
  async resetMfa(userId: string, password: string, change: AdminChange): Promise<UserSummary> {
    if (!(await verifyPassword(change.admin.passwordHash, password))) {
      await this.auth.recordFailedAttempt(change.admin, change.client);
      throw new AuthError('invalid_credentials');
    }
    const updated = await this.changeUser(
      userId,
      change,
      'account.mfa_reset',
      (user) => {
        if (!user.mfaEnabledAt)
          throw new ConflictException('Two-step verification is already off.');
        return { mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastStep: null };
      },
      {
        signOut: true,
        afterUpdate: (tx) => tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId)),
      },
    );
    this.notify(updated, 'Two-step verification was reset', [
      'An administrator turned off two-step verification on your LEAD account and signed you out.',
      'Sign in with your password and set it up again on the security page.',
    ]);
    return updated;
  }

  private async changeUser(
    userId: string,
    change: AdminChange,
    action: AuditAction,
    decide: (user: UserRow) => Partial<typeof users.$inferInsert>,
    options: { signOut?: boolean; afterUpdate?: (tx: Transaction) => Promise<unknown> } = {},
  ): Promise<UserSummary> {
    // Administrators cannot lock themselves out, so at least one administrator always remains.
    if (userId === change.admin.id) {
      throw new ForbiddenException('You cannot change your own account here.');
    }

    return this.db.transaction(async (tx) => {
      // Administrator changes run one at a time. Two admins removing each other at the same
      // moment would otherwise each pass the checks below and leave nobody in charge.
      await tx.execute(sql`select pg_advisory_xact_lock(${ADMIN_CHANGES_LOCK})`);

      const [actor] = await tx.select().from(users).where(eq(users.id, change.admin.id));
      if (actor?.role !== 'admin' || actor.status !== 'active') {
        throw new ForbiddenException('You no longer have administrator access.');
      }

      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
      if (!user) throw new NotFoundException('No such user.');

      const patch = decide(user);
      if (
        removesAdminAccess(user, patch) &&
        (await this.countOtherActiveAdmins(tx, userId)) === 0
      ) {
        throw new ConflictException('LEAD needs at least one active administrator.');
      }
      const [updated] = await tx
        .update(users)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();
      if (!updated) throw new NotFoundException('No such user.');

      await options.afterUpdate?.(tx);
      if (options.signOut) await this.auth.revokeAllSessions(tx, userId);
      await this.audit.record(
        {
          actorId: change.admin.id,
          actorRole: change.admin.role,
          action,
          targetType: 'user',
          targetId: userId,
          outcome: 'success',
          reason: change.reason,
          before: pick(user, patch),
          after: pick(updated, patch),
          ipAddress: change.client.ipAddress,
          userAgent: change.client.userAgent,
        },
        tx,
      );
      return toSummary(updated);
    });
  }

  private async countOtherActiveAdmins(tx: Transaction, exceptUserId: string): Promise<number> {
    const [row] = await tx
      .select({ total: count() })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.status, 'active'), ne(users.id, exceptUserId)));
    return row?.total ?? 0;
  }

  private notify(user: UserSummary, subject: string, lines: string[]): void {
    this.mailer
      .send({
        to: user.email,
        subject,
        text: [
          `Hello ${user.displayName},`,
          '',
          ...lines,
          '',
          'LEAD, City College of Calapan',
        ].join('\n'),
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Could not send "${subject}" email`,
          error instanceof Error ? error.stack : String(error),
        );
      });
  }

  private async find(userId: string): Promise<UserRow> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new NotFoundException('No such user.');
    return user;
  }

  private async countLiveFamilies(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ families: sql<number>`count(distinct ${sessions.familyId})::int` })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, sql`now()`),
        ),
      );
    return row?.families ?? 0;
  }
}

/**
 * The changed fields only, for the audit row's before/after. Secrets (MFA seeds) are recorded
 * as present or absent, never their value.
 */
function pick(user: UserRow, patch: Partial<typeof users.$inferInsert>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as (keyof UserRow)[]) {
    const value = user[key];
    if (key === 'mfaSecret' || key === 'mfaPendingSecret') result[key] = value !== null;
    else result[key] = value instanceof Date ? value.toISOString() : value;
  }
  return result;
}
