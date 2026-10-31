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

Phase 7 also prepares the Chapter 3–4 evaluation (functionality, usability, performance; ISO/IEC 25010 survey with CCC students, faculty and administrators).

## Status

**Phase 0 — done (2026-10-31).** Monorepo, Docker services, CI (format, lint, build, typecheck, test), shared `schema` and `ui-tokens` packages, NestJS API with health check and append-only audit module, React shell with per-role sidebars and a dev-only preview sign-in. The API integration tests (audit + health) need `pnpm services:up` and have not run locally yet.

**Phase 1 — in progress.**

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

Next slices:

2. MFA (TOTP setup and verification, recovery codes), registration with approval, password recovery (H02–H05).
3. Web: real sign-in screen, token refresh (one refresh at a time across tabs), sign-out synced across tabs, remove the preview role.
4. Admin: users, account details, roles and permissions, approval queue (A02–A04, A16); profile, preferences, sessions list, search (H07–H09); access denied (X04).

## Seed data

All development and demos use generated learners (`Learner 01…`) and placeholder courses until CCC gives written approval for real records. Confirm CCC's actual programs, department names and grading scheme during consultation and replace the IT 301–303 placeholders.
