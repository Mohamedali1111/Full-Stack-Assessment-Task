# ProjectFlow

## Overview

ProjectFlow is a lightweight project and task tracker for software teams. Organizations own projects, projects own tasks, and tasks carry status, priority, creator, assignee, comments, and assignment activity history.

This assessment extension adds task assignment, assignee-change activity history, concurrency-safe project task numbering, and a fix for a task status authorization bug while staying inside the existing architecture.

## Deployment

- GitHub Repository: [https://github.com/Mohamedali1111/Full-Stack-Assessment-Task](https://github.com/Mohamedali1111/Full-Stack-Assessment-Task)
- Live Demo: [https://full-stack-assessment-task-api-rust.vercel.app/](https://full-stack-assessment-task-api-rust.vercel.app/)

Deployment architecture:

- Frontend: Vercel
- API: Render
- Database: MongoDB Atlas

Local development continues to support `API_PORT`. Hosted platforms may provide `PORT`; when present, `PORT` takes precedence over `API_PORT`.

## Tech Stack

- pnpm workspaces and Turborepo monorepo
- NestJS API
- MongoDB with Mongoose
- Next.js App Router
- React
- TanStack Query
- Shared TypeScript package for API contracts and domain enums
- Jest, Supertest, and mongodb-memory-server for API tests

## Prerequisites

- Node.js `>=20.19` as declared in the root `package.json`
- pnpm `10.33.0` as declared by `packageManager`
- MongoDB reachable through `MONGODB_URI` for local development and seeding

The API e2e tests use `mongodb-memory-server`; they do not require a separately running local MongoDB.

## Setup

From a clean checkout:

```bash
pnpm install
cp .env.example .env
pnpm build
pnpm seed
```

The seed command runs the API seed script through Turborepo and depends on the API build output.

On Windows PowerShell, the current web dev script uses Unix shell default-variable syntax:

```bash
next dev --port ${WEB_PORT:-3742}
```

If that does not execute correctly in PowerShell, run the web app directly with an explicit port:

```bash
pnpm --filter @projectflow/web exec next dev --port 3742
```

This is an existing development-script portability limitation, not part of the assessment feature work.

## Environment Variables

Create `.env` from `.env.example`. Do not commit real secrets.

| Variable | Purpose | Example from `.env.example` |
| --- | --- | --- |
| `MONGODB_URI` | MongoDB connection string | `mongodb://127.0.0.1:27017/projectflow` |
| `JWT_SECRET` | JWT signing secret | development/local environments may use a placeholder; non-local environments must provide a real strong secret |
| `JWT_EXPIRES_IN` | JWT lifetime | `7d` |
| `API_PORT` | API port | `4732` |
| `WEB_ORIGIN` | CORS origin for the web app | `http://localhost:3742` |
| `NEXT_PUBLIC_API_URL` | Browser API base URL | `http://localhost:4732` |

## Running the App

Run both apps with the normal workspace command:

```bash
pnpm dev
```

Expected local URLs with the checked-in example environment:

- Web: <http://localhost:3742>
- API: <http://localhost:4732>

You can also run apps separately:

```bash
pnpm --filter @projectflow/api dev
pnpm --filter @projectflow/web dev
```

On Windows PowerShell, prefer the explicit web command shown in Setup if the default web script cannot parse the port expression.

## Seed Accounts

The development seed defines fixture/demo accounts. All seeded accounts use:

```text
Password123!
```

| Name | Email | Role / access |
| --- | --- | --- |
| Ammar Yaser | `ammar@example.com` | Organization `OWNER` |
| Sarah Ahmed | `sarah@example.com` | Organization `ADMIN`; project manager on `WEB` |
| Ahmed Hassan | `ahmed@example.com` | Organization `MEMBER`; `PROJECT_MANAGER` on `ENG` |
| Magd Ali | `magd@example.com` | Organization `MEMBER`; member of `ENG` and `WEB` |
| Outside User | `outside@example.com` | No organization/project access |

Seeded projects include `Internal Platform` (`ENG`) and `Customer Portal` (`WEB`) with tasks such as `ENG-1` and `WEB-1`.

## Running Tests

Workspace commands:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Focused API commands used during the assessment:

```bash
pnpm --filter @projectflow/api test
pnpm --filter @projectflow/api test -- tasks.e2e.spec.ts
pnpm --filter @projectflow/api typecheck
pnpm --filter @projectflow/shared typecheck
pnpm --filter @projectflow/web typecheck
pnpm --filter @projectflow/web lint
pnpm --filter @projectflow/web build
```

There is no existing frontend automated test framework in this repository.

## Technical Decisions

- Task assignment uses a dedicated `PATCH /tasks/:taskId/assignee` endpoint rather than overloading generic task update.
- Assignable users must be explicit members of the task's project; organization membership alone is not enough.
- The frontend assignment control uses optimistic TanStack Query updates with rollback and server reconciliation.
- Assignment history is stored in a separate `TaskActivity` collection rather than an embedded task array.
- Activity pagination uses the repository-standard `page` / `pageSize` contract.
- Activity ordering is deterministic with `createdAt` plus `_id` descending.
- Project task numbers are allocated through a project-owned atomic counter.
- `{ projectId, number }` has a unique index as database defense in depth.

## Known Limitations

- Task assignment update and activity insertion are two separate writes. If the activity insert fails after the task save, the request can fail while the task mutation has already persisted.
- Activity pagination currently uses offset pagination. Cursor pagination would be a better fit if individual task histories become very deep.
- The repository does not currently include a frontend automated test framework.
- The assignee selector is not searchable. A new combobox dependency was not introduced because the repository already has a native Radix Select pattern and seeded project sizes are small.
- Existing production data may contain duplicate task numbers from the old race. Those duplicates must be detected and resolved, and project counters backfilled, before deploying the unique `{ projectId, number }` index.
- The web dev script uses Unix shell default-variable syntax and may need the documented direct Next command on Windows PowerShell.
