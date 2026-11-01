# Project LEAD

**Learning Enhancement through Artificial Intelligence and Digital Analytics.** An adaptive learning platform for **City College of Calapan**: LMS, adaptive pathways, a student AI assistant and teacher copilot grounded in approved course materials (RAG), learning analytics with explainable support indicators, MFA, audit logging and backups.

BSIT capstone, Mindoro State University – Calapan Campus. See [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) for scope and phases, and `reference/` for the approved title, Chapter 1 and the 81-screen wireframes.

## Repository

| Path                 | What                                                           |
| -------------------- | -------------------------------------------------------------- |
| `apps/api`           | NestJS REST API, Drizzle ORM, PostgreSQL + pgvector            |
| `apps/web`           | React + Vite web app                                           |
| `packages/schema`    | Shared Zod schemas and types (roles, navigation, audit events) |
| `packages/ui-tokens` | Design tokens for web (CSS variables) and mobile               |
| `infra`              | Docker Compose for Postgres, Redis and MinIO                   |

## Requirements

- Node.js 22+ and pnpm 12
- Docker Desktop (for Postgres, Redis, MinIO)

The project Postgres listens on **port 5433** so it does not clash with a PostgreSQL already installed on 5432.

**Without Docker:** an installed PostgreSQL 16 or newer works too. Run `powershell -ExecutionPolicy Bypass -File infra\local-postgres-setup.ps1` once (it asks for the `postgres` admin password and creates the role and databases from `.env`), then change the port in the four database URLs in `.env` to the installed server's port, usually 5432. Redis and MinIO still need Docker once later phases use them.

## Setup

```bash
pnpm install
cp .env.example .env   # then replace every change-me value
pnpm services:up
pnpm build
pnpm --filter @lead/api db:migrate   # also sets the lead_app role's password
pnpm --filter @lead/api db:seed      # optional: demo accounts using SEED_PASSWORD
```

The API connects as `lead_app`, a role with data access only: it cannot change tables, and it can only read and add audit events. Migrations run as the database owner (`MIGRATION_DATABASE_URL`).

## Daily use

```bash
pnpm dev          # API on http://127.0.0.1:3000/api, web on http://localhost:5173
pnpm test         # unit + integration tests (integration tests need pnpm services:up)
pnpm typecheck
pnpm format
```

The API has real sign-in (`POST /api/auth/sign-in`, `refresh`, `sign-out`, `GET /api/auth/me`), two-step verification (`/api/auth/mfa/*`), registration with email confirmation (`register`, `email/verify`) and password recovery (`password/forgot`, `password/reset`). In development, emails are written as `.eml` files to `storage/outbox` instead of being sent.

The web app uses the same sign-in. To try it locally, run `pnpm --filter @lead/api db:seed` once and sign in as `admin@lead.test`, `teacher01@lead.test` or `learner01@lead.test` with the `SEED_PASSWORD` from your `.env`. New accounts from **Request an account** need approval; until the admin screens exist (Phase 1, slice 4), approve one in the database by setting its `status` to `active`.

## Data and privacy

Development uses generated data only (`Learner 01`, placeholder courses). Real City College of Calapan records are used only with the college's written authorization, under the Data Privacy Act of 2012 (RA 10173). Never commit `.env` or real records.
