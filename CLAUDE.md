# Project LEAD — guide for Claude Code sessions

Read this first. It is the hand-over from the sessions that built Phase 0 and Phase 1. Deeper detail lives in
[docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) (phases, screen IDs, per-slice notes) and [README.md](README.md) (setup).

## 1. Project overview

**LEAD — Learning Enhancement through Artificial Intelligence and Digital Analytics.** A BSIT capstone (MinSU Calapan:
Paul Gerson Castillo, Bernie Laerin III, Hajji Pascual) building a full learning management system for the client
**City College of Calapan (CCC)**, Oriental Mindoro. Older documents in `reference/` still mention Holy Infant
Academy, Calapan Central School, DepEd SDO or "ShoreSync": all of that is obsolete — ignore it.

Confirmed scope (no MVP cut): full LMS, adaptive learning pathways, two RAG AI tools (student learning assistant,
teacher drafting copilot), learning analytics with explainable rule-based support indicators, MFA, audit logging,
backups, and all **81 wireframe screens** (IDs H01–H09 shared, S01–S19 student, T01–T28 teacher, A01–A19 admin,
X01–X06 system). **No parent portal. No DepEd involvement.** Web first, then a native mobile app (Expo).
Must stay free/open-source (no budget). Use generated data only until CCC authorizes real records (RA 10173).

CCC's real programs (from their career portal): BPA, BSED Math, BSED Science, BSHM, **BSIS** (not BSIT), BSNED, BSTM.
Use these instead of "IT 301"-style placeholders in seed/demo data.

## 2. Tech stack and architecture

pnpm 12 workspaces + Turborepo, TypeScript 5.9.3 everywhere (Node 24 in CI).

```
apps/api            NestJS 11 REST API (CommonJS), Drizzle ORM 0.45 + postgres-js, PostgreSQL 16 (+pgvector later)
apps/web            React 19 + Vite 8 + TanStack Router (code-based routes) + Tailwind 4 + shadcn/ui
packages/schema     Zod 4 schemas shared by API and web (roles, navigation, audit actions, auth/admin DTOs)
packages/ui-tokens  design tokens -> dist/tokens.css (--lead-*), also importable by the future mobile app
infra/              docker-compose (Postgres pgvector:pg16 on 5433, Redis, MinIO), local-postgres-setup.ps1
docs/BUILD_PLAN.md  phases 0–8, screen IDs per phase, status per slice
reference/          client documents and wireframes (gitignored, never commit)
```

- API dev server runs through `@swc-node/register` (decorator metadata), not tsx. Tests: Vitest 5 + unplugin-swc,
  Supertest; integration tests hit a real `*_test` database (guarded: name must end in `_test`).
- Web tests: Vitest + jsdom + Testing Library, with a fake fetch API (`apps/web/src/test/fake-api.ts`) and
  `renderApp(path)` (`src/test/render-app.tsx`, renders in StrictMode).
- Planned, not yet used: BullMQ on Redis, MinIO file storage, Ollama behind an `AiProvider` interface, Expo app.

### Request flow and security model

- Global guards in order: `ThrottlerGuard` (per-IP; generous because classrooms share a NAT IP) then `AuthGuard`
  (`apps/api/src/auth/auth.guard.ts`). Every route needs a Bearer access token unless `@Public()`; `@Roles(...)` limits
  by role. The guard re-reads the user row each request, so deactivation/role changes apply immediately.
- **Access token**: 15-min HS256 JWT (`jose`), in browser memory only. **Refresh token**: random 256-bit, SHA-256 stored,
  httpOnly SameSite=Strict cookie `lead_refresh` at path `/api/auth`; rotated on every refresh (7-day idle, 30-day
  absolute). Replaying an old token revokes the whole session family; a duplicate within 10 s gets **409** (another
  tab just rotated it). Origin check on cookie endpoints. Auth responses are `Cache-Control: no-store`.
- Lockout after 5 failed passwords/codes (15 min), one atomic UPDATE. Unknown-email events audited as a hash.
- **Database roles**: migrations run as the owner (`MIGRATION_DATABASE_URL`); the API runs as `lead_app`
  (`DATABASE_URL`), created by migration 0003 with DML only and `SELECT, INSERT` on `audit_events`. `db:migrate` sets
  `lead_app`'s password from `DATABASE_URL`.
- **Audit**: append-only `audit_events` (triggers block UPDATE/DELETE/TRUNCATE even for the owner). Actions are a
  closed list `KNOWN_ACTIONS` in `packages/schema/src/audit.ts`; `REASON_REQUIRED_ACTIONS` must carry a reason when
  successful. `AuditService.record(input, tx?)` — pass the transaction so change and audit commit together.
- Web session: `AuthStore` (`apps/web/src/auth/auth-store.ts`) — one refresh at a time per tab and across tabs
  (Web Locks), sign-in/out broadcast to all tabs (BroadcastChannel), generation counter so stale refreshes can't undo
  sign-in/out, sign-out only completes when the server confirms. `useApiData(path)` keeps data on screen while
  reloading and drops stale answers.

## 3. Database schema (Drizzle, `apps/api/src/database/schema.ts`)

| Table                  | Purpose                                                                                                                                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit_events`         | append-only trail: actor, action, target, outcome, reason, before/after JSON, IP, user agent                                                                                                                                                                                                                   |
| `users`                | email (lowercased, unique), display_name, role (`student`/`teacher`/`admin`), status (`pending`/`active`/`deactivated`/`rejected`), password_hash (Argon2id), email_verified_at, failed_sign_ins, locked_until, mfa_secret / mfa_pending_secret (AES-256-GCM, bound to user id), mfa_enabled_at, mfa_last_step |
| `sessions`             | one row per refresh token: family_id, family_started_at, token_hash, expires_at, revoked_at, rotated_at, ip, user agent                                                                                                                                                                                        |
| `recovery_codes`       | MFA one-time codes, SHA-256 hashes, used_at                                                                                                                                                                                                                                                                    |
| `account_tokens`       | emailed single-use links, purpose `password_reset` (30 min) or `email_verification` (24 h), hashed                                                                                                                                                                                                             |
| `programs`             | CCC degree programs: code (unique, case-insensitive), name, active; seven seeded by migration 0008                                                                                                                                                                                                             |
| `academic_terms`       | school_year (`2026-2027`), semester (`first`/`second`/`summer`), starts_on/ends_on, current (at most one: partial unique index + advisory lock 742_002)                                                                                                                                                        |
| `courses`              | code (uppercase, unique), title, description, units 1–6, program_id (null = general education), archived_at                                                                                                                                                                                                    |
| `sections`             | course_id + term_id (restrict), name (unique per course and term, case-insensitive), capacity 1–200 (check). Drizzle name `classSections`                                                                                                                                                                      |
| `teaching_assignments` | PK (section_id, teacher_id); cascade on section delete                                                                                                                                                                                                                                                         |
| `enrollments`          | PK (section_id, student_id), status `enrolled`/`dropped`, enrolled_at, dropped_at (dropped rows kept; re-enrolling flips the same row back)                                                                                                                                                                    |
| `learning_objectives`  | course_id, number (unique per course; shown as `O1`, `O2`…), description                                                                                                                                                                                                                                       |
| `course_modules`       | course_id, position, title, description, requires_previous, mastery_threshold (null or 50–100), status `draft`/`published`, published_at. Content belongs to the **course** (all its sections share it), per wireframe T04                                                                                     |
| `module_objectives`    | PK (module_id, objective_id): which objectives a module teaches                                                                                                                                                                                                                                                |
| `grading_periods`      | term_id, name (unique per term, case-insensitive), position, starts_on/ends_on (inside the term, non-overlapping)                                                                                                                                                                                              |
| `calendar_events`      | term_id, title, kind (`assessment_period`/`grade_release`/`holiday`/`class_event`), starts_on, ends_on (null = one day); `calendar_event_courses` limits an event to courses (none = whole term)                                                                                                               |
| `resources`            | course_id, module_id (optional), title, created_by; `resource_objectives` maps objectives                                                                                                                                                                                                                      |
| `resource_versions`    | resource_id, number, either a stored file (file_name for display, stored_name random hex on disk, content_type, size_bytes, sha256) or an http(s) url (CHECK), status `pending`/`approved`/`returned`/`withdrawn`/`superseded` (partial unique indexes: one pending, one approved), reviewer and note          |
| `lessons`              | module_id, position, title, objective_id (must be one of the module's), body (plain text ≤ 20k; render as text, never HTML), status, published_at; CHECK: published ⇒ objective set and body not blank                                                                                                         |

Migrations `apps/api/drizzle/0000`–`0013` (never edit a pushed migration; add a new one with
`pnpm --filter @lead/api db:generate`, custom SQL via `drizzle-kit generate --custom`).

## 4. API (all under `/api`)

| Area                                 | Endpoints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health                               | `GET /health` (public)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Sign-in                              | `POST /auth/sign-in` (session, or `{mfaRequired, challengeToken}`), `POST /auth/refresh`, `POST /auth/sign-out`, `GET /auth/me`                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| MFA                                  | `POST /auth/mfa/setup`, `/enable` (password + code), `/disable` (password + code), `/verify` (public: challenge + code or recovery code)                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Accounts (public)                    | `POST /auth/register` (name, email, role student/teacher; no password), `/email/verify` (token + password), `/password/forgot`, `/password/reset` — email-taking ones answer 202 at once and work in the background                                                                                                                                                                                                                                                                                                                                                              |
| Self                                 | `GET /me/sessions`, `POST /me/sessions/:id/revoke`, `POST /me/sessions/revoke-others`, `PATCH /me/profile`, `POST /me/password`                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Catalog (`@Roles('admin')`)          | `GET/POST /admin/programs`, `PATCH /admin/programs/:id`, `GET/POST /admin/terms`, `POST /admin/terms/:id/make-current`, `GET /admin/courses?q&program=<id or general>&archived&page`, `POST /admin/courses`, `PATCH /admin/courses/:id` (only fields sent), `POST /admin/courses/:id/archive` (reason) and `/restore`                                                                                                                                                                                                                                                            |
| Sections (`@Roles('admin')`)         | `GET /admin/sections?term&q&page` (current term by default; answer carries `termId`), `GET/PATCH /admin/sections/:id`, `POST /admin/sections`, `POST /admin/sections/:id/teachers` (email), `/teachers/:teacherId/remove`, `/enrollments` (emails, up to 100; returns added + skipped with reasons), `/enrollments/:studentId/drop` (reason)                                                                                                                                                                                                                                     |
| Course content (`@Roles('teacher')`) | `GET /teacher/content` (courses taught this term), `GET /teacher/content/:courseId` (objectives + modules + lesson summaries), `POST …/objectives`, `PATCH …/objectives/:id`, `POST …/modules`, `PATCH …/modules/:id`, `POST …/modules/:id/{move,publish,unpublish}`, `POST …/modules/:id/lessons`, `GET/PATCH …/lessons/:id`, `POST …/lessons/:id/{publish,unpublish}`. Only teachers of a current-term section of the course (404 otherwise); archived courses are read-only                                                                                                   |
| Calendar (`@Roles('admin')`)         | `GET /admin/terms/:termId/calendar` (term, grading periods, events, offerings), `PATCH /admin/terms/:termId` (start/end dates; refused while a period or event would fall outside), `PUT …/grading-periods` (whole list), `POST …/events`, `PUT …/events/:id`, `POST …/events/:id/remove`. Every change locks the term row                                                                                                                                                                                                                                                       |
| Resources                            | Teacher (`@Roles('teacher')`): `GET/POST /teacher/content/:courseId/resources` (multipart: title, moduleId, objectiveIds, and `file` or `url`), `POST …/:resourceId/versions`, `GET …/:resourceId/versions/:versionId/file`. Admin: `GET /admin/resources?q&status&page`, `GET /admin/resources/:id`, `POST …/versions/:versionId/{approve (confirmSource+confirmPermissions), return (note), withdraw (reason)}`, `GET …/file`. Uploads: 20 MB, PDF/PNG/JPEG/DOCX/PPTX/XLSX/TXT checked by magic bytes, `UPLOADS_PER_MINUTE` (default 10); downloads are `attachment` + nosniff |
| Classes                              | `GET /teacher/classes?term`, `GET /teacher/classes/:id` (`@Roles('teacher')`, own sections only, 404 otherwise, enrolled students only), `GET /teacher/classes/:id/calendar` (term-wide events and the class's course only); `GET /student/classes` (`@Roles('student')`, enrolled classes, newest term first)                                                                                                                                                                                                                                                                   |
| Admin (`@Roles('admin')`)            | `GET /admin/users?status&role&q&page`, `GET /admin/users/:id`, `POST /admin/users/:id/{approve,reject,deactivate,reactivate,role,mfa/reset}` — all but approve need `reason`; MFA reset also needs the admin's `password`; changes are advisory-locked, re-check the actor, protect the last active admin, forbid self-changes                                                                                                                                                                                                                                                   |

Request/response shapes live in `packages/schema/src/{auth,admin}.ts`. Development email is written as `.eml`
files to `apps/api/storage/outbox` (`MailModule`, `MAILER` token); there is no SMTP sender yet.

## 5. Web app (`apps/web/src`)

- Routes (`router.tsx`): public `/` (sign-in, `?redirect=` same-site only), `/register`, `/confirm-email`,
  `/forgot-password`, `/reset-password` (tokens read from `#token=` then removed from the URL). Signed-in layout
  (`shell/AppShell.tsx`, sidebar from `NAVIGATION` in `packages/schema/src/navigation.ts`): per-role pages
  (`BUILT_PAGES` map; everything else renders `PlaceholderPage` with its wireframe ID), `/admin/users/$userId`,
  `/access-denied` (X04), shared `/notifications` `/profile` `/security` `/search`.
- Built screens: H01–H05 (sign-in, MFA step, register, confirm email, forgot/reset), H07 profile, H08 security
  (MFA setup with QR, recovery codes, devices list), A02/A16 user management, A03 user details, A04 roles (read-only),
  A05 course management (Courses / Programs / Terms tabs in `pages/admin/catalog/`; `components/FormDialog.tsx` wraps
  the shadcn Dialog, `afterSave` moves focus to an announcement when the row disappears), A07 section management and
  section details (`pages/admin/sections/`, routes `/admin/sections` and `/admin/sections/$sectionId`), T02 My Classes
  and class list (`pages/teacher/`, `/teacher/classes/$sectionId`), S02 My Courses (`pages/student/`), shared
  `SeatsBar`/`RosterTable`/`ClassCard` in `pages/sections/shared.tsx`, T04 course outline (`/teacher/content`,
  `/teacher/content/$courseId`), T05 module editor (`…/modules/$moduleId`) and T06 lesson editor (`…/lessons/$lessonId`)
  in `pages/teacher/content/` (Publish is refused while the form has unsaved edits), T03 class overview
  (`pages/teacher/ClassOverviewPage.tsx` at `/teacher/classes/$sectionId`: details, upcoming events, course outline,
  class list), A08 academic calendar (`pages/admin/calendar/`, `/admin/courses/calendar?term=<id>`, linked from the
  Terms tab; the term is a search param because a path param remounts the page and drops focus), T07 course resources
  (`pages/teacher/content/ResourcesPage.tsx`, `/teacher/content/$courseId/resources`), A10 resource library and A11
  review (`pages/admin/resources/`, `/admin/courses/resources[/$resourceId]`), X04 access denied. `auth.request`
  sends a `FormData` body as multipart and takes `expect: 'blob'` for downloads (`components/download.ts`). Never put
  a `FormDialog` inside another `<form>`: React bubbles the dialog's submit through the portal into the outer form.
  `useApiData` keeps the last good data when a reload of the same path fails (`refreshError`).
- **Design** (decided by the user — keep it): wireframes decide each screen's elements and layout; look = white
  background only (no dark mode), accent `#f97316`, Poppins (self-hosted `@fontsource/poppins`), CCC seal
  (`public/ccc-logo.png`, favicon), rounded cards with soft shadows, transitions and big entrance animations
  (`animate-rise`, `animate-pop`, `animate-fade`, `animate-slide-in`, `animate-glow`, `stagger`, `card-interactive`,
  `link` in `styles.css`; all disabled under `prefers-reduced-motion`). Components are **shadcn/ui** in
  `src/components/ui` (button, card, input, label, alert, badge, table, separator, tabs, dialog, textarea), themed
  from `packages/ui-tokens`; `tw-animate-css` supplies their enter/exit animations.
  Add more with `pnpm dlx shadcn@4.22.1 add <name>` from `apps/web` (it imports `cn` from shadcn's `cn` package).
  Accessibility: text on orange is `#431407`, orange text is `#c2410c` (`text-brand-strong`) — white on `#f97316`
  fails WCAG AA; `packages/ui-tokens` tests enforce contrast.

## 6. Status

- **Phase 0** done. **Phase 1 (identity and access)** done except H09 search, moved to Phase 2.
- **Phase 2** in progress: slices 2a (course catalog, A05), 2b (sections, teaching assignments, enrollment; A07,
  T02, S02), 2c (course content: objectives, modules, lessons; T04–T06) and 2d (academic calendar A08, class
  overview T03) and 2e (resources with approval: T07, A10, A11) done; student views (S03–S06) next.
- Test counts after slice 2e: API 133, web 122, schema 50, tokens 5. Check `git log` for the latest commit.
- GitHub: https://github.com/Kodokunaa/lead (public — `reference/` must never be committed). CI runs format:check,
  build, lint, typecheck, test with a pgvector service.

## 7. Known issues and caveats

- **Docker Desktop is broken on the developer PC** (stale `sailor-ingest.sock`; "reset to factory defaults" was
  clicked twice). Local DB tests use the **native PostgreSQL 18 Windows service on port 5432** (set up with
  `infra/local-postgres-setup.ps1`; `.env` URLs point to 5432). The project targets PG16 and pgvector is not installed
  on that PG18 — needed before Phase 6 (RAG). Redis/MinIO unavailable locally until Docker works.
- No SMTP mailer yet (dev outbox only); no job to purge expired `sessions`/`account_tokens` (Phase 7);
  deployment security headers not set (CSP etc. listed in BUILD_PLAN Phase 7 checklist).
- Dashboards (S01, T01, A01) and most role pages are placeholders. H06 notifications and H09 search not built.
- A04 is read-only (three fixed roles; no custom permission model yet).
- Web bundle is ~647 KB (191 KB gzip), over Vite's 500 KB warning (a warning, not a failure) — add route-level code
  splitting (`lazyRouteComponent`) soon.
- The wireframe PDF's text can be extracted with pdf.js (`pdfjs-dist` in a scratch folder, `getTextContent()` per
  page): page N is the Nth screen in ID order (H01–H09, S01–S19, T01–T28, A01–A19, X01–X06), e.g. page 32 = T04.
- `ParseUUIDPipe({ version: '4' })` on admin/me routes: switching ids to UUIDv7 would break them.
- Testing quirk: the hidden Browser preview pane pauses CSS animations, so screenshots can show content mid-fade
  (it starts at opacity 0); inject `*{animation:none!important}` via the inspection tool to check layout.
- Dev database contains throwaway accounts: `e2e-teacher-1@lead.test` (promoted to **admin**, MFA on),
  `e2e-learner-2@lead.test` (active student; an MFA setup was started but not finished), and the seeded demo accounts
  (`admin@lead.test`, `teacher01@lead.test`, `learner01@lead.test`, `learner02@lead.test`, password `SEED_PASSWORD`
  in `.env`). Slice 2b's browser check added `e2e-sec-admin-4f6732@lead.test` (promoted to **admin**),
  `e2e-sec-teacher-4f6732@lead.test` and `e2e-sec-student-4f6732@lead.test` (generated password, not recorded here),
  a current term First Semester 2026-2027 and section IS 301 · BSIS 3-A (capacity 3). Secrets live only in `.env`
  (gitignored) — never print or commit them. Sessions may not read `.env` values directly; create throwaway accounts
  through register → outbox link → approve instead (a script reading `.env` itself is fine).
- Windows tooling: Python edits write CRLF (run Prettier; `.gitattributes` normalizes); long bash heredocs with
  backslashes or quotes sometimes fail to parse — put scripts in a file instead.

## 8. Working rules (from the user)

- **Verify everything locally before any push**: `pnpm format:check`, `pnpm build`, `pnpm lint`, `pnpm typecheck`,
  `pnpm test` (includes DB integration tests). Do not use CI to find failures. For anything hit by simultaneous
  requests, write a test that forces the overlap (hold a row/advisory lock in a test transaction) — the local PG18
  serializes jobs and hides races that CI catches.
- Each slice: implement with tests → review with the matching agents (`ecc:security-reviewer` for auth/input/admin,
  `ecc:typescript-reviewer` or `ecc:react-reviewer`) → fix findings → browser check against the real API → full local
  checks → commit (conventional message, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`) → push → confirm CI.
  The user has accepted committing and pushing at the end of a fully verified slice; ask if unsure.
- Keep `docs/BUILD_PLAN.md` status current. Use CCC programs, generated people, and wireframe screen IDs in names.
- Run dev servers through the Browser preview configs in `.claude/launch.json` (`api` on 3000, `web` on 5173).

## 9. Next steps (exact)

1. **Phase 2 — academic structure and content** (screens A05–A08, A10–A11, T02–T07, S02–S03, S05–S06; see
   BUILD_PLAN). Read each screen's wireframe text first (see "wireframe PDF's text" in section 7). Slice by slice:
   a. Done: catalog (programs with CCC's seven seeded, academic terms, courses) and A05 Course Management.
   a2. Done: sections, teaching assignments and enrollments; A07, T02, S02.
   b. Done (slice 2c): learning objectives, modules, lessons with draft/publish rules; T04–T06.
   b2. Done (slice 2d): A08 academic calendar (term dates, grading periods, events) and T03 class overview.
   Open: archiving a course with live sections should warn or refuse; unpublishing may need a reason once students
   have progress (consider adding `module.unpublished`/`lesson.unpublished` to `REASON_REQUIRED_ACTIONS`); moving a
   term that has started could require a reason too (`term.dates_changed`); A06 course offering record not built.
   c. Done (slice 2e): resources with approval (T07, A10, A11). Open: OOXML files are only checked for the zip
   header (verify `[Content_Types].xml` and cap extraction before Phase 6 parses them); downloads are not audited;
   teachers of a course see each other's drafts (by design); MinIO replaces local disk for deployment.
   c2. **Next:** student views S03–S06: enrolled students only; published modules/lessons only; approved resource
   versions only (404 otherwise); render lesson text as text, never HTML.
   d. Consider adding student ID and program to registration and the approval screen (the CCC alumni portal collects
   them) once programs exist — confirm the student ID format with the user.
   e. Permission-scoped search H09 once there is content.
2. Before Phase 6: get Docker working or install pgvector on the local Postgres.
3. Phase 7 items already recorded: SMTP mailer, session/token cleanup job, deployment headers, `log_statement` off
   while migrations set the role password.

## Commands

```bash
pnpm install
pnpm --filter @lead/api db:migrate      # owner URL migrates, sets lead_app password
pnpm --filter @lead/api db:seed         # demo accounts (dev only)
pnpm dev                                # API http://127.0.0.1:3000/api, web http://localhost:5173
pnpm format:check && pnpm build && pnpm lint && pnpm typecheck && pnpm test
```
