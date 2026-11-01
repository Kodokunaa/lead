import { z } from 'zod';
import { reasonSchema } from './admin';

/**
 * Course resources with approval (wireframes T07, A10, A11). A resource keeps every version it
 * ever had; at most one is pending review and at most one is approved (the one learners get).
 */
export const RESOURCE_STATUSES = [
  'pending',
  'approved',
  'returned',
  'withdrawn',
  'superseded',
] as const;
export type ResourceStatus = (typeof RESOURCE_STATUSES)[number];

export const RESOURCE_STATUS_LABELS: Readonly<Record<ResourceStatus, string>> = {
  pending: 'Pending review',
  approved: 'Approved',
  returned: 'Returned for revision',
  withdrawn: 'Withdrawn',
  superseded: 'Replaced by a newer version',
};

/** Upload limits. The type is decided by the file's extension and checked against its bytes. */
export const MAX_RESOURCE_BYTES = 20 * 1024 * 1024;
export const RESOURCE_FILE_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain; charset=utf-8',
} as const;
export type ResourceFileExtension = keyof typeof RESOURCE_FILE_TYPES;

export const RESOURCE_PAGE_SIZE = 25;

const titleSchema = z
  .string()
  .trim()
  .min(1, 'Enter a title.')
  .max(160)
  .refine((value) => !value.includes('\u0000'), 'Remove the invalid character.');

/** Web links only; anything else (javascript:, data:, file:) could run or leak in a browser. */
export const resourceUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .pipe(z.url({ protocol: /^https?$/, hostname: z.regexes.domain }))
  // "https://ccc.edu.ph@evil.example/" goes to evil.example; refuse names and passwords.
  .refine(
    // The part between "//" and the first "/", "?" or "#" may not hold "name@" or "name:pass@".
    (value) => !(value.split('//')[1] ?? '').split(/[/?#]/)[0]?.includes('@'),
    'Remove the user name or password from the link.',
  );

/** Multipart form fields: arrays arrive as one string or a repeated field. */
const idList = z.preprocess(
  (value: unknown): unknown[] =>
    value === undefined || value === ''
      ? []
      : Array.isArray(value)
        ? (value as unknown[])
        : [value],
  z
    .array(z.uuid())
    .max(20)
    .transform((ids) => [...new Set(ids)]),
);

/** The non-file fields of a new resource. Exactly one of a file or `url` must come with it. */
export const resourceInputSchema = z.object({
  title: titleSchema,
  moduleId: z.preprocess((value) => (value === '' ? undefined : value), z.uuid().optional()),
  objectiveIds: idList,
  url: z.preprocess((value) => (value === '' ? undefined : value), resourceUrlSchema.optional()),
});
export type ResourceInput = z.infer<typeof resourceInputSchema>;

export const versionInputSchema = z.object({
  url: z.preprocess((value) => (value === '' ? undefined : value), resourceUrlSchema.optional()),
});
export type VersionInput = z.infer<typeof versionInputSchema>;

/** Approval needs the reviewer to confirm both checks on wireframe A11. */
export const approveRequestSchema = z.object({
  confirmSource: z.literal(true, 'Confirm that the source is approved.'),
  confirmPermissions: z.literal(true, 'Confirm that permissions and details are checked.'),
  note: z.string().trim().max(500).default(''),
});
export type ApproveRequest = z.infer<typeof approveRequestSchema>;

export const returnRequestSchema = z.object({
  note: z.string().trim().min(5, 'Tell the teacher what to change.').max(500),
});
export type ReturnRequest = z.infer<typeof returnRequestSchema>;

export const withdrawRequestSchema = z.object({ reason: reasonSchema });
export type WithdrawRequest = z.infer<typeof withdrawRequestSchema>;

export const resourceListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(RESOURCE_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type ResourceListQuery = z.infer<typeof resourceListQuerySchema>;

// ---------- Responses

export const resourceVersionSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  kind: z.enum(['file', 'link']),
  fileName: z.string().nullable(),
  contentType: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  url: z.string().nullable(),
  status: z.enum(RESOURCE_STATUSES),
  submittedBy: z.string(),
  submittedAt: z.string(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  note: z.string().nullable(),
});
export type ResourceVersion = z.infer<typeof resourceVersionSchema>;

/**
 * Whether the AI tools may draw on it. Phase 6 does the indexing, so nothing is indexed yet;
 * a withdrawn resource is excluded for good.
 */
export const RAG_STATUSES = ['not_indexed', 'excluded'] as const;
export type RagStatus = (typeof RAG_STATUSES)[number];

export const resourceSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  course: z.object({ id: z.uuid(), code: z.string(), title: z.string() }),
  module: z.object({ id: z.uuid(), title: z.string() }).nullable(),
  objectives: z.array(z.object({ id: z.uuid(), code: z.string() })),
  latest: resourceVersionSchema,
  /** The version learners get, if any. */
  approvedVersion: z.number().int().nullable(),
  ragStatus: z.enum(RAG_STATUSES),
});
export type ResourceSummary = z.infer<typeof resourceSummarySchema>;

export const resourceDetailsSchema = resourceSummarySchema.extend({
  versions: z.array(resourceVersionSchema),
});
export type ResourceDetails = z.infer<typeof resourceDetailsSchema>;

export const resourceListResponseSchema = z.object({
  items: z.array(resourceSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type ResourceListResponse = z.infer<typeof resourceListResponseSchema>;
