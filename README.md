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

## Setup

```bash
pnpm install
cp .env.example .env   # then replace every change-me value
pnpm services:up
pnpm build
pnpm --filter @lead/api db:migrate
```

## Daily use

```bash
pnpm dev          # API on http://127.0.0.1:3000/api, web on http://localhost:5173
pnpm test         # unit + integration tests (integration tests need pnpm services:up)
pnpm typecheck
pnpm format
```

Until Phase 1 adds real sign-in, the web app opens a **preview sign-in** that lets you enter as Student, Teacher or Administrator to view each role's layout.

## Data and privacy

Development uses generated data only (`Learner 01`, placeholder courses). Real City College of Calapan records are used only with the college's written authorization, under the Data Privacy Act of 2012 (RA 10173). Never commit `.env` or real records.
