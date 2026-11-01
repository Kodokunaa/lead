import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  RESOURCE_PAGE_SIZE,
  type ApproveRequest,
  type AuditAction,
  type ResourceDetails,
  type ResourceInput,
  type ResourceListQuery,
  type ResourceListResponse,
  type ResourceSummary,
  type ResourceVersion,
  type ReturnRequest,
  type VersionInput,
} from '@lead/schema';
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { ReadStream } from 'node:fs';
import { AuditService } from '../audit/audit.service';
import type { ClientInfo } from '../auth/auth.service';
import { ContentService } from '../content/content.service';
import { DATABASE, type Database, type DbExecutor } from '../database/database.module';
import {
  courseModules,
  courses,
  learningObjectives,
  resourceObjectives,
  resources,
  resourceVersions,
  users,
  type ResourceRow,
  type ResourceVersionRow,
  type UserRow,
} from '../database/schema';
import { checkUpload, ResourceStorage, type UploadedResourceFile } from './resource-files';

/** Who is acting, for the audit trail; `reason` only for withdrawals. */
export interface ResourceActor {
  readonly user: UserRow;
  readonly client: ClientInfo;
  readonly reason?: string | null;
}

export interface OpenedFile {
  readonly stream: ReadStream;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

/**
 * Course resources and their review (wireframes T07, A10, A11). Teachers of a current-term section
 * submit; administrators approve, return or withdraw. Changes to a resource's versions lock the
 * resource row, so two submissions or reviews cannot both act on the same "latest" version.
 */
@Injectable()
export class ResourcesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly content: ContentService,
    private readonly storage: ResourceStorage,
  ) {}

  // ---------- Teachers

  async teacherList(teacher: UserRow, courseId: string): Promise<ResourceSummary[]> {
    await this.content.teachableCourse(this.db, teacher, courseId);
    const rows = await this.db
      .select({ id: resources.id })
      .from(resources)
      .where(eq(resources.courseId, courseId))
      .orderBy(asc(resources.title));
    return this.summaries(
      this.db,
      rows.map((row) => row.id),
    );
  }

  async submit(
    courseId: string,
    input: ResourceInput,
    file: UploadedResourceFile | undefined,
    actor: ResourceActor,
  ): Promise<ResourceDetails> {
    // Everything that can be refused cheaply is checked before the file is stored, so only the
    // course's teachers, with a valid request, can put files on disk. (Checked again below.)
    await this.content.teachableCourse(this.db, actor.user, courseId);
    await this.checkPlacement(this.db, courseId, input.moduleId, input.objectiveIds);
    const content = await this.prepareContent(input.url, file);
    const id = await this.withStoredFile(content, () =>
      this.db.transaction(async (tx) => {
        await this.content.teachableCourse(tx, actor.user, courseId, true);
        await this.checkPlacement(tx, courseId, input.moduleId, input.objectiveIds);
        const [created] = await tx
          .insert(resources)
          .values({
            courseId,
            moduleId: input.moduleId ?? null,
            title: input.title,
            createdBy: actor.user.id,
          })
          .returning();
        if (!created) throw new ConflictException('The resource could not be added.');
        if (input.objectiveIds.length > 0) {
          await tx
            .insert(resourceObjectives)
            .values(
              input.objectiveIds.map((objectiveId) => ({ resourceId: created.id, objectiveId })),
            );
        }
        const version = await this.insertVersion(tx, created.id, 1, content, actor.user);
        await this.record(tx, actor, 'resource.submitted', created.id, null, {
          title: created.title,
          moduleId: created.moduleId,
          objectiveIds: input.objectiveIds,
          ...versionFacts(version),
        });
        return created.id;
      }),
    );
    return this.details(this.db, id);
  }

  /** A new version, e.g. after a return or to replace the approved one. One pending at a time. */
  async addVersion(
    courseId: string,
    resourceId: string,
    input: VersionInput,
    file: UploadedResourceFile | undefined,
    actor: ResourceActor,
  ): Promise<ResourceDetails> {
    await this.content.teachableCourse(this.db, actor.user, courseId);
    const existing = await this.versionsOf(this.db, resourceId);
    if (existing.some((version) => version.status === 'pending')) {
      throw new ConflictException('A version is already waiting for review.');
    }
    const content = await this.prepareContent(input.url, file);
    await this.withStoredFile(content, () =>
      this.db.transaction(async (tx) => {
        await this.content.teachableCourse(tx, actor.user, courseId, true);
        const resource = await this.lockResource(tx, resourceId);
        if (resource.courseId !== courseId) throw new NotFoundException('No such resource.');
        const versions = await this.versionsOf(tx, resourceId);
        if (versions.some((version) => version.status === 'pending')) {
          throw new ConflictException('A version is already waiting for review.');
        }
        const number = Math.max(0, ...versions.map((version) => version.number)) + 1;
        const version = await this.insertVersion(tx, resourceId, number, content, actor.user);
        await this.record(tx, actor, 'resource.submitted', resourceId, null, versionFacts(version));
      }),
    );
    return this.details(this.db, resourceId);
  }

  async teacherFile(
    teacher: UserRow,
    courseId: string,
    resourceId: string,
    versionId: string,
  ): Promise<OpenedFile> {
    await this.content.teachableCourse(this.db, teacher, courseId);
    const { resource, version } = await this.findVersion(this.db, resourceId, versionId);
    if (resource.courseId !== courseId) throw new NotFoundException('No such resource.');
    return this.openVersion(version);
  }

  // ---------- Administrators

  async adminList(query: ResourceListQuery): Promise<ResourceListResponse> {
    const conditions: SQL[] = [];
    if (query.q) {
      const pattern = likePattern(query.q);
      const match = or(ilike(resources.title, pattern), ilike(courses.code, pattern));
      if (match) conditions.push(match);
    }
    if (query.status) {
      // A resource "is" the status of its latest version.
      conditions.push(sql`${query.status} = (
        select v.status from ${resourceVersions} v
        where v.resource_id = ${resources.id} order by v.number desc limit 1
      )`);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [rows, [totals]] = await Promise.all([
      this.db
        .select({ id: resources.id })
        .from(resources)
        .innerJoin(courses, eq(courses.id, resources.courseId))
        .where(where)
        .orderBy(desc(resources.updatedAt), asc(resources.title))
        .limit(RESOURCE_PAGE_SIZE)
        .offset((query.page - 1) * RESOURCE_PAGE_SIZE),
      this.db
        .select({ total: count() })
        .from(resources)
        .innerJoin(courses, eq(courses.id, resources.courseId))
        .where(where),
    ]);
    return {
      items: await this.summaries(
        this.db,
        rows.map((row) => row.id),
      ),
      total: totals?.total ?? 0,
      page: query.page,
      pageSize: RESOURCE_PAGE_SIZE,
    };
  }

  async adminDetails(resourceId: string): Promise<ResourceDetails> {
    return this.details(this.db, resourceId);
  }

  /** Approves a pending version; the previously approved one (if any) is superseded. */
  async approve(
    resourceId: string,
    versionId: string,
    request: ApproveRequest,
    actor: ResourceActor,
  ): Promise<ResourceDetails> {
    await this.review(resourceId, versionId, async (tx, version, versions) => {
      if (version.status !== 'pending') {
        throw new ConflictException('Only a version waiting for review can be approved.');
      }
      const previous = versions.find((item) => item.status === 'approved');
      if (previous) {
        await this.setStatus(tx, previous.id, 'superseded', actor.user, null);
      }
      await this.setStatus(tx, version.id, 'approved', actor.user, request.note || null);
      await this.record(
        tx,
        actor,
        'resource.approved',
        resourceId,
        { approvedVersion: previous?.number ?? null },
        { approvedVersion: version.number, note: request.note || null },
      );
    });
    return this.details(this.db, resourceId);
  }

  async returnForRevision(
    resourceId: string,
    versionId: string,
    request: ReturnRequest,
    actor: ResourceActor,
  ): Promise<ResourceDetails> {
    await this.review(resourceId, versionId, async (tx, version) => {
      if (version.status !== 'pending') {
        throw new ConflictException('Only a version waiting for review can be returned.');
      }
      await this.setStatus(tx, version.id, 'returned', actor.user, request.note);
      await this.record(
        tx,
        actor,
        'resource.returned',
        resourceId,
        { version: version.number, status: 'pending' },
        { version: version.number, status: 'returned', note: request.note },
      );
    });
    return this.details(this.db, resourceId);
  }

  /** Takes the approved version away from learners (and, later, from AI retrieval). */
  async withdraw(
    resourceId: string,
    versionId: string,
    actor: ResourceActor,
  ): Promise<ResourceDetails> {
    await this.review(resourceId, versionId, async (tx, version) => {
      if (version.status !== 'approved') {
        throw new ConflictException('Only the approved version can be withdrawn.');
      }
      await this.setStatus(tx, version.id, 'withdrawn', actor.user, actor.reason ?? null);
      await this.record(
        tx,
        actor,
        'resource.withdrawn',
        resourceId,
        { version: version.number, status: 'approved' },
        { version: version.number, status: 'withdrawn' },
      );
    });
    return this.details(this.db, resourceId);
  }

  async adminFile(resourceId: string, versionId: string): Promise<OpenedFile> {
    const { version } = await this.findVersion(this.db, resourceId, versionId);
    return this.openVersion(version);
  }

  // ---------- Helpers

  /** Checks the upload (or link) before any transaction, and stores the file. */
  private async prepareContent(
    url: string | undefined,
    file: UploadedResourceFile | undefined,
  ): Promise<VersionContent> {
    if (file && url) throw new BadRequestException('Upload a file or give a link, not both.');
    if (url) return { kind: 'link', url };
    if (!file) throw new BadRequestException('Upload a file or give a link.');
    const checked = checkUpload(file);
    // Written before the database row, so a committed row always has its file; withStoredFile
    // removes it again if the row is not saved.
    const storedName = await this.storage.save(checked.buffer);
    return { kind: 'file', ...checked, storedName };
  }

  private async withStoredFile<T>(content: VersionContent, save: () => Promise<T>): Promise<T> {
    try {
      return await save();
    } catch (error) {
      if (content.kind === 'file') await this.storage.remove(content.storedName);
      throw error;
    }
  }

  private async insertVersion(
    tx: DbExecutor,
    resourceId: string,
    number: number,
    content: VersionContent,
    submitter: UserRow,
  ): Promise<ResourceVersionRow> {
    const [version] = await tx
      .insert(resourceVersions)
      .values({
        resourceId,
        number,
        submittedBy: submitter.id,
        ...(content.kind === 'link'
          ? { url: content.url }
          : {
              fileName: content.fileName,
              storedName: content.storedName,
              contentType: content.contentType,
              sizeBytes: content.sizeBytes,
              sha256: content.sha256,
            }),
      })
      .returning();
    if (!version) throw new ConflictException('The version could not be saved.');
    await tx.update(resources).set({ updatedAt: new Date() }).where(eq(resources.id, resourceId));
    return version;
  }

  private async review(
    resourceId: string,
    versionId: string,
    work: (
      tx: DbExecutor,
      version: ResourceVersionRow,
      versions: ResourceVersionRow[],
    ) => Promise<void>,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockResource(tx, resourceId);
      const versions = await this.versionsOf(tx, resourceId);
      const version = versions.find((item) => item.id === versionId);
      if (!version) throw new NotFoundException('No such version of this resource.');
      await work(tx, version, versions);
      await tx.update(resources).set({ updatedAt: new Date() }).where(eq(resources.id, resourceId));
    });
  }

  private async setStatus(
    tx: DbExecutor,
    versionId: string,
    status: ResourceVersionRow['status'],
    reviewer: UserRow,
    note: string | null,
  ): Promise<void> {
    await tx
      .update(resourceVersions)
      .set({ status, reviewedBy: reviewer.id, reviewedAt: new Date(), note })
      .where(eq(resourceVersions.id, versionId));
  }

  private async checkPlacement(
    executor: DbExecutor,
    courseId: string,
    moduleId: string | undefined,
    objectiveIds: readonly string[],
  ): Promise<void> {
    if (moduleId) {
      const [module] = await executor
        .select({ id: courseModules.id })
        .from(courseModules)
        .where(and(eq(courseModules.id, moduleId), eq(courseModules.courseId, courseId)));
      if (!module) throw new ConflictException('Choose a module of this course.');
    }
    if (objectiveIds.length > 0) {
      const found = await executor
        .select({ id: learningObjectives.id })
        .from(learningObjectives)
        .where(
          and(
            eq(learningObjectives.courseId, courseId),
            inArray(learningObjectives.id, [...objectiveIds]),
          ),
        );
      if (found.length !== objectiveIds.length) {
        throw new ConflictException('Choose objectives of this course only.');
      }
    }
  }

  private async lockResource(executor: DbExecutor, resourceId: string): Promise<ResourceRow> {
    const [resource] = await executor
      .select()
      .from(resources)
      .where(eq(resources.id, resourceId))
      .for('update');
    if (!resource) throw new NotFoundException('No such resource.');
    return resource;
  }

  private async versionsOf(
    executor: DbExecutor,
    resourceId: string,
  ): Promise<ResourceVersionRow[]> {
    return executor
      .select()
      .from(resourceVersions)
      .where(eq(resourceVersions.resourceId, resourceId))
      .orderBy(desc(resourceVersions.number));
  }

  private async findVersion(executor: DbExecutor, resourceId: string, versionId: string) {
    const [row] = await executor
      .select({ resource: resources, version: resourceVersions })
      .from(resourceVersions)
      .innerJoin(resources, eq(resources.id, resourceVersions.resourceId))
      .where(and(eq(resourceVersions.id, versionId), eq(resources.id, resourceId)));
    if (!row) throw new NotFoundException('No such version of this resource.');
    return row;
  }

  private async openVersion(version: ResourceVersionRow): Promise<OpenedFile> {
    if (!version.storedName || !version.fileName || !version.contentType) {
      throw new NotFoundException('This version is a link, not a file.');
    }
    return {
      stream: await this.storage.open(version.storedName),
      fileName: version.fileName,
      contentType: version.contentType,
      sizeBytes: version.sizeBytes ?? 0,
    };
  }

  private async details(executor: DbExecutor, resourceId: string): Promise<ResourceDetails> {
    const [summary] = await this.summaries(executor, [resourceId]);
    if (!summary) throw new NotFoundException('No such resource.');
    const versions = await this.versionsOf(executor, resourceId);
    const names = await this.namesOf(executor, versions);
    return { ...summary, versions: versions.map((version) => toVersion(version, names)) };
  }

  /** Summaries in the order given. */
  private async summaries(executor: DbExecutor, ids: string[]): Promise<ResourceSummary[]> {
    if (ids.length === 0) return [];
    const [rows, objectiveRows, versionRows] = await Promise.all([
      executor
        .select({ resource: resources, course: courses, module: courseModules })
        .from(resources)
        .innerJoin(courses, eq(courses.id, resources.courseId))
        .leftJoin(courseModules, eq(courseModules.id, resources.moduleId))
        .where(inArray(resources.id, ids)),
      executor
        .select({
          resourceId: resourceObjectives.resourceId,
          id: learningObjectives.id,
          number: learningObjectives.number,
        })
        .from(resourceObjectives)
        .innerJoin(learningObjectives, eq(learningObjectives.id, resourceObjectives.objectiveId))
        .where(inArray(resourceObjectives.resourceId, ids))
        .orderBy(asc(learningObjectives.number)),
      executor
        .select()
        .from(resourceVersions)
        .where(inArray(resourceVersions.resourceId, ids))
        .orderBy(desc(resourceVersions.number)),
    ]);
    const names = await this.namesOf(executor, versionRows);
    const byId = new Map(rows.map((row) => [row.resource.id, row]));

    return ids.flatMap((id) => {
      const row = byId.get(id);
      const versions = versionRows.filter((version) => version.resourceId === id);
      const latest = versions[0];
      if (!row || !latest) return [];
      const approved = versions.find((version) => version.status === 'approved');
      return [
        {
          id,
          title: row.resource.title,
          course: { id: row.course.id, code: row.course.code, title: row.course.title },
          module: row.module ? { id: row.module.id, title: row.module.title } : null,
          objectives: objectiveRows
            .filter((objective) => objective.resourceId === id)
            .map((objective) => ({ id: objective.id, code: `O${objective.number}` })),
          latest: toVersion(latest, names),
          approvedVersion: approved?.number ?? null,
          // Withdrawn material must never be retrieved; anything else waits for Phase 6 indexing.
          ragStatus: !approved && latest.status === 'withdrawn' ? 'excluded' : 'not_indexed',
        },
      ];
    });
  }

  private async namesOf(
    executor: DbExecutor,
    versions: readonly ResourceVersionRow[],
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        versions.flatMap((version) =>
          version.reviewedBy ? [version.submittedBy, version.reviewedBy] : [version.submittedBy],
        ),
      ),
    ];
    if (ids.length === 0) return new Map();
    const rows = await executor
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, ids));
    return new Map(rows.map((row) => [row.id, row.displayName]));
  }

  private async record(
    tx: DbExecutor,
    actor: ResourceActor,
    action: AuditAction,
    resourceId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ): Promise<void> {
    await this.audit.record(
      {
        actorId: actor.user.id,
        actorRole: actor.user.role,
        action,
        targetType: 'resource',
        targetId: resourceId,
        outcome: 'success',
        reason: actor.reason ?? null,
        before,
        after,
        ipAddress: actor.client.ipAddress,
        userAgent: actor.client.userAgent,
      },
      tx,
    );
  }
}

type VersionContent =
  | { readonly kind: 'link'; readonly url: string }
  | {
      readonly kind: 'file';
      readonly fileName: string;
      readonly storedName: string;
      readonly contentType: string;
      readonly sizeBytes: number;
      readonly sha256: string;
    };

function versionFacts(version: ResourceVersionRow): Record<string, unknown> {
  return version.url
    ? { version: version.number, url: version.url }
    : {
        version: version.number,
        fileName: version.fileName,
        sizeBytes: version.sizeBytes,
        sha256: version.sha256,
      };
}

function toVersion(version: ResourceVersionRow, names: Map<string, string>): ResourceVersion {
  return {
    id: version.id,
    number: version.number,
    kind: version.url ? 'link' : 'file',
    fileName: version.fileName,
    contentType: version.contentType,
    sizeBytes: version.sizeBytes,
    url: version.url,
    status: version.status,
    submittedBy: names.get(version.submittedBy) ?? 'Unknown',
    submittedAt: version.submittedAt.toISOString(),
    reviewedBy: version.reviewedBy ? (names.get(version.reviewedBy) ?? 'Unknown') : null,
    reviewedAt: version.reviewedAt?.toISOString() ?? null,
    note: version.note,
  };
}
