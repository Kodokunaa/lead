# Project LEAD — Build Plan

Client: **City College of Calapan**. Scope: full LMS, adaptive pathways, two RAG tools (student assistant, teacher copilot), learning analytics and support indicators, MFA, audit logging, backups — all 81 wireframe screens (`reference/Wireframe.pdf`). Web first; native mobile after.

## Stack (locked 2026-10-31)

| Layer          | Choice                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------- |
| Monorepo       | pnpm workspaces + Turborepo, TypeScript everywhere                                              |
| API            | NestJS (REST, OpenAPI), BullMQ jobs on Redis                                                    |
| Database       | PostgreSQL 16 + pgvector, Drizzle ORM + migrations                                              |
| Web            | React + Vite, TanStack Router/Query, Tailwind                                                   |
| Mobile (later) | React Native / Expo, same API and shared packages                                               |
| Shared         | `packages/schema` (Zod: validation + types), `packages/api-client`, `packages/ui-tokens`        |
| AI             | Ollama (local, free) behind an `AiProvider` interface; hosted provider optional, off by default |
| Auth           | Argon2 passwords, JWT access + rotating refresh tokens, TOTP MFA, RBAC + course-scoped guards   |
| Files          | Local disk in dev, S3-compatible (MinIO) for deployment                                         |
| Tests          | Vitest (unit), Supertest (API integration), Playwright (E2E)                                    |

Local dev runs Postgres, Redis and MinIO in Docker. Ollama runs natively for GPU use (RTX 3050 6 GB: a 7–8B model at Q4 for chat, `nomic-embed-text` for embeddings).

## Design

The wireframes decide each screen's elements and layout; the look follows CCC: white background, orange accent `#f97316` (from the college seal), Poppins (self-hosted), the CCC seal as logo, rounded cards with soft shadows, and lively transitions and entrance animations that switch off when the device asks for reduced motion. Components are [shadcn/ui](https://ui.shadcn.com) (source in `apps/web/src/components/ui`), themed from `packages/ui-tokens` so the mobile app can share the same values. Text on orange is dark brown and orange text uses `#c2410c`, because white on `#f97316` fails WCAG AA contrast; the token tests check this.

## Repository layout

```
apps/api        NestJS
apps/web        React + Vite
apps/mobile     Expo (phase 8)
packages/schema       Zod schemas, enums, shared types
packages/api-client   typed client generated from OpenAPI
packages/ui-tokens    colors, spacing shared by web and mobile
infra/          docker-compose, backup scripts
docs/           this plan, ERD, test plan
```

## Core data model

- **Identity:** User, Role, Permission, Session, MfaSecret, AuditEvent (append-only)
- **Academic:** Program, AcademicTerm, CalendarEvent, Course, Section, Enrollment, TeachingAssignment
- **Content:** Module, Lesson, LearningObjective, Resource, ResourceVersion (approval state), ResourceChunk (embedding + permission tags)
- **Assessment:** Assessment, Question, Choice, Rubric, RubricCriterion, Attempt, Answer, Submission, Grade, GradeChange (reason required)
- **Adaptive:** MasteryRecord (per student × objective, with evidence links), Recommendation, PathwayOverride
- **Support:** IndicatorRule (versioned), Indicator, IndicatorReview, Intervention, InterventionFollowUp
- **AI:** AiPolicy, Conversation, Message, Citation, AiDraft (teacher review state)
- **Ops:** Notification, Backup, SystemSetting, GradingPolicy (versioned)

Rules from the wireframes and Chapter 1 that the code must enforce:

- Retrieval only returns chunks from **approved, non-withdrawn** resources in courses the requester can access; otherwise no content.
- AI drafts never publish or release grades on their own; a teacher accepts them into a draft.
- Support indicators are rule-based and explainable; no failure probability is stored or shown. Insufficient evidence never produces a flag.
- Grade changes after release, rule changes, role changes and resource withdrawals require a reason and write an AuditEvent.
- AI is disabled during assessment attempts unless policy allows it.

## Phases

Each phase ends with passing tests, a review, and a demo of its screens.

| #   | Phase                                                                                                                                                           | Screens                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 0   | Foundation: monorepo, Docker services, CI, app shell, sidebar per role, design tokens, audit-event module                                                       | layout for all                                              |
| 1   | Identity and access: sign-in, registration with approval, MFA, password recovery, profile, preferences, sessions, RBAC, permission-scoped search                | H01–H05, H07–H09, A02–A04, A16, X04                         |
| 2   | Academic structure and content: catalog, sections, enrollment, calendar, modules, lessons, objectives, resource upload and approval                             | A05–A08, A10–A11, T02–T07, S02–S03, S05–S06                 |
| 3   | Assessments and grading: builder, questions, rubrics, publishing, attempts, submissions, grading queue, gradebook, grading policy, notifications                | T08–T15, S07–S13, A19, H06, X02, X05                        |
| 4   | Mastery and adaptive pathways: mastery calculation, recommendations, follow-up practice, teacher override, indicator rules                                      | S04, S14–S16, T21, T28                                      |
| 5   | Analytics and interventions: dashboards, roster profiles, indicator queue, evidence review, interventions, reports and export                                   | S01, S18–S19, T01, T16–T20, T22–T24, T27, A01, A13–A14, X01 |
| 6   | RAG and AI tools: extraction, chunking, embedding, permission-tagged index, retrieval validation, student assistant with citations, teacher copilot with review | A09, A12, S17, T25–T26, X03                                 |
| 7   | Operations and hardening: backups and restore review, platform health, system settings, audit-log viewer, security review, load test, mobile-browser pass       | A15, A17–A18, X06                                           |
| 8   | Native mobile (Expo): student screens first, push notifications                                                                                                 | mobile S-screens                                            |

Deployment checklist for Phase 7 (from the slice 3 security review): serve the web app with a Content-Security-Policy (`default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`; keep the web app and API on one origin (if they ever move to sibling subdomains, require `Content-Type: application/json` on the cookie endpoints, since SameSite=Strict no longer separates them).

Phase 7 also prepares the Chapter 3–4 evaluation (functionality, usability, performance; ISO/IEC 25010 survey with CCC students, faculty and administrators).

## Status

**Phase 0 — done (2026-10-31).** Monorepo, Docker services, CI (format, lint, build, typecheck, test), shared `schema` and `ui-tokens` packages, NestJS API with health check and append-only audit module, React shell with per-role sidebars and a dev-only preview sign-in. The API integration tests (audit + health) need `pnpm services:up` and have not run locally yet.

**Phase 1 — identity and access.**

Slice 1 (API sign-in core) — done:

- Separate database roles: migrations run as the owner; the API runs as `lead_app`, which owns nothing and has only `SELECT, INSERT` on `audit_events`.
- `AuditService.record(input, tx?)` with `AuditValidationError`, and a closed `KNOWN_ACTIONS` list.
- `users` and `sessions` tables; Argon2id passwords; sign-in, refresh, sign-out and `me` endpoints.
- 15-minute access tokens (JWT) checked against a live session on every request, so sign-out and deactivation take effect at once.
- Refresh tokens in an httpOnly, SameSite=Strict cookie: rotated on each use, 7 days idle and 30 days absolute. Replaying an old token ends the whole session; a duplicate within 10 seconds (two tabs, a retry) gets 409 and changes nothing.
- Account lockout after 5 failed sign-ins (15 minutes), counted in one atomic statement; the same error for unknown email, wrong password and lockout. Unknown emails are audited as a hash, not the typed text.
- Per-IP rate limits sized for classrooms behind one campus IP; `TRUST_PROXY_HOPS` for deployment behind a reverse proxy; 100 kB JSON body limit; Origin check on cookie endpoints.
- `db:seed` for generated demo accounts (refuses to run in production).
- Reviewed by the security and TypeScript reviewers; all findings fixed. Open: a job to purge expired session rows (Phase 7), and keeping Postgres `log_statement` off while migrations set the role password.

Slice 2 (MFA, registration, recovery; API for H02–H05) — done:

- TOTP two-step verification: setup returns an otpauth URI; enabling needs the password and a working code, signs out other devices and emails a notice. Secrets are AES-256-GCM encrypted, bound to the user. Ten one-time recovery codes (hashed). Each code works once; a replayed code is refused without counting towards lockout, wrong codes do count.
- Sign-in for MFA accounts returns a 5-minute challenge (its own JWT audience, void once the password changes); the factor is consumed in the same transaction that opens the session.
- Registration takes name, email and role (student or teacher only). The password is chosen from an emailed confirmation link, so only the inbox owner can complete an account; it then waits for administrator approval.
- Password recovery by emailed link: single use, 30 minutes, newest only, signs out every session.
- Email-taking endpoints answer at once and work in the background, so timing cannot reveal which emails exist; at most one email per account per minute. Development email goes to `.eml` files (`MAIL_OUTBOX_DIR`); SMTP comes with deployment (Phase 7).

Slice 3 (web sign-in, H01–H05 and the H08 security page) — done:

- The preview role picker is gone. Sign-in (with the MFA code or recovery-code step), account request, email confirmation, forgot and reset password screens, and two-step setup on the security page (QR code drawn in the browser, recovery codes shown once).
- The access token lives only in memory; the session is restored from the refresh cookie on load. Refreshes run one at a time per tab and across tabs (Web Locks), with a retry after the API's 409. Sign-in and sign-out reach every open tab (BroadcastChannel); a refresh that started earlier cannot undo either.
- Sign-out only completes once the server confirms; otherwise the user stays signed in and is told. If the API is down at load, the app offers a retry instead of signing out.
- Deep links survive sign-in (same-site paths only, checked where the redirect happens). Emailed link tokens are removed from the address bar once read; a reset also ends this browser's session.
- Focus moves to each new step and to error messages; busy buttons stay focusable.
- Auth API responses are sent with `Cache-Control: no-store`.
- Checked end to end in the browser against the real API and PostgreSQL: request account, confirm by email link, approve, sign in, set up MFA, sign out, sign in with a code.

Slice 4 (account administration and self-service: A02–A04, A16, H07–H08, X04) — done:

- User Management (A02): filter by status (the "Waiting for approval" filter is the A16 queue, with its count), search by name or email (wildcards escaped), paging. User details (A03): facts, recent activity, and the changes an administrator can make: approve (confirmed email and password required; the person is emailed), reject (its own `rejected` status, which cannot be reactivated), deactivate and reactivate, change role, reset two-step verification (also needs the administrator's own password). Every change except approval needs a reason; all are audited with before and after values (MFA secrets recorded only as present or absent), and deactivation, role change and MFA reset sign the person out everywhere and email them.
- Administrator changes run one at a time (advisory lock), re-check that the acting administrator still is one, and refuse to remove the last active administrator; administrators cannot change their own account. A test holds the lock to force two administrators removing each other at once.
- Roles & Permissions (A04): a read-only table of what each role can do, until custom permissions are needed.
- Profile (H07): change name; change password (current password required, counts towards lockout, refused if the password changed meanwhile, signs out other devices, emails a notice).
- Security page (H08): signed-in devices, one per session, with sign-out for each device or all others.
- Access denied (X04): another role's page shows an explanation instead of a silent redirect.
- Data on screen stays in place while it refreshes; stale answers are dropped.
- Not built yet: permission-scoped search (H09) waits for courses and content (Phase 2); the account menu's notifications (H06) arrive with Phase 3.

**Phase 1 — done** apart from H09 search, moved to Phase 2.

**Phase 2 — academic structure and content (in progress).**

Slice 2a (course catalog, A05) — done:

- Programs (CCC's seven seeded by migration: BPA, BSED Math, BSED Science, BSHM, BSIS, BSNED, BSTM), academic terms (school year + semester, exactly one current: partial unique index plus an advisory lock so two admins switching at once cannot collide), and courses (code normalized to capitals, 1–6 units, a program or general education).
- Admin API under `/api/admin/{programs,terms,courses}`: add/edit, deactivate programs, make a term current, archive courses (reason required) and restore. Edits change only the fields sent and record nothing when nothing differs; duplicate codes answer 409; a course cannot be placed under a program that is no longer offered (row lock against a concurrent deactivation).
- A05 Course Management screen: Courses, Programs and Terms tabs with shadcn dialogs; Add/Edit wait for the program list; archive/restore announce the result and take focus; an emptied last page steps back.

Slice 2b (sections and enrollment: A07, T02, S02) — done:

- Sections (a course + a term + a name such as "BSIS 3-A", capacity 1–200; names unique per course and term), teaching assignments (active teacher accounts only) and enrollments (enrolled or dropped; a dropped row is kept for the record and can be enrolled again).
- Admin API under `/api/admin/sections`: list a term (the current one by default) with search and paging, details with the class list, add/edit (capacity never below the students enrolled), assign/remove teachers, bulk enroll up to 100 emails (each skipped email says why: no account, not a student, not active, already enrolled, section full) and drop with a reason. Every change is audited in the same transaction.
- Concurrency: enrollment, edit and drop lock the section row, so two enrollments cannot overfill it; enrollment and assignment take a shared lock on the accounts, so a student or teacher being deactivated at the same moment is refused; a section cannot be added to a course being archived. Tests force each overlap.
- Teacher API `/api/teacher/classes` (own classes only; another section answers 404, the same as a missing one; the class list shows enrolled students only). Student API `/api/student/classes` (own enrolled classes, newest term first, without seat counts).
- Screens: A07 Section Management (term filter, search, add, seats bar) and section details (seats, teachers, enroll, drop with reason, edit); T02 My Classes (class cards, read-only class list); S02 My Courses (cards grouped by term, current term first).
- Not done yet: archiving a course does not yet warn about its sections; the student ID and program on registration (item d below) are still open.

Slice 2c (course content: T04–T06) — done:

- Content belongs to the course (wireframe T04 "Course outline and content / IS 301"), so every section follows the same outline. Learning objectives are numbered O1, O2, … per course; modules have an order, objectives, an optional "finish the previous module first" rule and an optional mastery score (50–100%); lessons belong to a module and teach one of its objectives.
- Draft/publish: a module needs at least one objective to be published; a lesson needs one of its module's objectives and written content. While published they must stay publishable (an objective a lesson teaches cannot be taken off its module). A database CHECK backs the lesson rule.
- Teacher API under `/api/teacher/content`. Only teachers of a current-term section of the course can see or change it (others get 404); archived courses are read-only. Every change locks the course row, so module positions and objective numbers never collide (tests force both overlaps and fail without the lock). Audit records each change; lesson text is recorded as its length and SHA-256.
- Screens: T04 course outline (objectives, modules with their lessons, move up/down, add module/lesson), T05 module editor, T06 lesson editor with the module outline. Publish is refused while the form has unsaved edits; a failed refresh keeps the editor and says so.
- Moved to the next slice: A08 calendar and T03 class overview. Later: resources (T07, A10, A11) and student views (S03–S06).

Slice 2d (academic calendar A08, class overview T03) — done:

- A term's start and end dates can be moved; grading periods (e.g. Prelim, Midterm, Finals: in date order, inside the term, no overlaps, no repeated names) are saved as one list; calendar events (assessment period, grade release, holiday, class event; one day or a range) apply to the whole term or to chosen courses offered that term.
- Every change locks the term row, so new dates and a new event cannot both pass against each other's old values (a test forces the overlap and fails without the lock). Term dates cannot move past an existing period or event. Dates before 1900 are refused.
- A08 page at `/admin/courses/calendar?term=…` (linked from the Terms tab, under Course Management as in the wireframe): Academic structure (term dates, offerings count), Grading periods (editable rows), Calendar table (term start, events, term end).
- T03 class overview replaces the bare class list: course details, the current grading period and upcoming events (Manila date), the course's objectives and modules, and the class list. Teachers see an event's scope only as far as their own course.

Slice 2e (course resources with approval: T07, A10, A11) — done:

- Teachers of a course this term upload a file (PDF, PNG/JPEG, Word, PowerPoint, Excel, text; up to 20 MB; the type comes from the extension and is checked against the file's first bytes) or submit a web link (http/https, no user name in it), mapped to a module and objectives. Files are stored under random names on local disk (MinIO later) and served only as downloads (attachment, nosniff, no-store) to the course's teachers and administrators.
- Every resource keeps all its versions: pending, approved, returned for revision, withdrawn or superseded. At most one pending and one approved version (database indexes), and new versions and reviews lock the resource row (a test forces two submissions at once and fails without the lock). Approving needs both reviewer checks; returning needs a note; withdrawing needs a reason. Everything is audited; refused uploads leave no file behind; uploads are limited to 10 a minute per address.
- Screens: T07 resources page (upload form, list with status and reviewer notes, new version), A10 resource library (search, status filter, RAG status shown as "not indexed yet" until Phase 6), A11 review page (details, versions, approve/return/withdraw).

Slice 2f (student views S03, S05, S06) — done:

- A student enrolled (not dropped) in a section opens it from My Courses: S03 shows the course details, the objectives that published modules teach, published modules with their published lessons, the approved references and the class's upcoming events; S05 shows a lesson as plain text with its objective, module outline, related approved sources and previous/next links; S06 shows an approved resource and downloads it (or opens its link in a new tab, with the site's name shown).
- Students never see drafts, lessons of draft modules, resources tied to a draft module, or any resource version other than the approved one; a withdrawn resource disappears at once. Anyone not enrolled, or dropped, gets the same 404 as a missing class.
- Each page's heading takes focus when it loads; loading and error states keep a heading and a way back.
- S04 (adaptive pathway: locks, recommendations, mastery evidence) needs progress data and moves to Phase 4.

H09 permission-scoped search — done:

- One search box (top bar or `/search?q=`) for every role, finding only what that person may open: students their classes, published lessons (by title or text) and approved resources; teachers their current-term classes and those courses' modules, lessons and resources (drafts included, archived courses left out); administrators accounts, courses, sections and resources. Each result says where it sits and why it is visible, and opens the right screen.
- Wildcards are searched as plain text, at most 10 results per kind (with a note when there are more), 30 searches a minute per address.

Route-level code splitting — done: each signed-in page is its own chunk, loaded when its route first opens (main bundle 667 KB → 443 KB, under Vite's 500 KB warning). A page that cannot load is tried once more, then offers a reload.

A06 course offering and curriculum record — done:

- From the course list, an administrator opens a course's record: its details (edited in place, same rules as the A05 dialog), status with archive/restore (the archive dialog says how many sections this term keep running), who edits its content, how many objectives, modules and lessons exist and are published, how many resources are approved or waiting, and every term's sections with their teachers and seats, newest term first.

Slice 3a (assessment builder T08–T12) — done:

- Teachers create quizzes, examinations, assignments and projects for one of their classes this term. Settings (T09): title, instructions, opening and due date in Philippine time, time limit (quizzes and examinations), allowed attempts, and the course objectives measured. Quizzes and examinations get multiple-choice (exactly one correct answer) and written questions, each with points, difficulty and one of the assessment's objectives (T10); assignments and projects get a rubric of criteria and levels (T11).
- T12 lists every publication check (objectives, questions or rubric, dates in the future, AI off during attempts) with a link to fix it; publishing is refused with the first failing check. Published assessments are read-only until unpublished. Every change is audited and locks the assessment row (tests force two questions added at once, and an administrator removing the teacher while an assessment is created, which deadlocked before the section was locked first).

Slice 3b (quiz and examination attempts S07–S11) — done:

- Students see the published quizzes and examinations of the classes they are enrolled in, with what they can do next (scheduled, available, in progress, submitted, missed). The instructions page shows the objectives, questions, points, time limit, window and attempts used, and says why an attempt cannot begin.
- An attempt has a deadline fixed when it begins (the time limit or the due date, whichever comes first). Answers save as they are given, through one queue so an older answer never overwrites a newer one; a failed save shows the X02 message with a retry, and leaving the page saves what was being typed. The countdown runs on the server's clock and submits at zero; the server also submits an expired attempt with the answers saved by then the next time it is touched, and refuses answers 15 seconds after the deadline.
- On submission multiple-choice answers are scored and written answers wait for the teacher. The result shows the score, the points awaiting grading and the evidence per objective, and says it is not the official grade. The answer key never reaches the student.
- One attempt in progress per student (enrollment row lock plus a partial unique index; a test forces two starts at once and another drops the student while starting). Teachers can no longer unpublish an assessment once an attempt exists.

Next: slice 3c (assignment submissions S12, grading queue and review T13–T14, reasoned grade changes X05).

## Seed data

All development and demos use generated learners (`Learner 01…`) and placeholder courses until CCC gives written approval for real records. Confirm CCC's actual programs, department names and grading scheme during consultation and replace the IT 301–303 placeholders.
