# Assessment Notes

## Architecture Overview

ProjectFlow is a pnpm/Turborepo monorepo:

- `apps/api`: NestJS API
- `apps/web`: Next.js App Router frontend
- `packages/shared`: shared TypeScript enums, constants, and API contracts

The backend follows a controller -> service -> Mongoose model shape. JWT authentication is registered globally, and project resource authorization is centralized in `ProjectAccessService`. The task changes in this assessment extend that structure rather than introducing a separate authorization or data-access layer.

The frontend keeps routes thin and places product logic in feature modules. Server state is managed with TanStack Query, API calls use the shared API client, and cache keys are centralized in `apps/web/src/lib/query-keys.ts`. The frontend uses shared API contracts instead of separate local response hierarchies.

## Assumptions

1. A regular project `MEMBER` may assign only themselves.
2. A regular project `MEMBER` may not unassign, including themselves.
3. `OWNER`, `ADMIN`, and `PROJECT_MANAGER` may assign explicit project members and unassign.
4. Organization membership alone does not make a user an assignable project member.
5. Task sequence numbers are monotonic per project and are not reused after deletion.
6. Gaps in task numbers are acceptable if a number is reserved and a later task insert fails.

## Key Technical Decisions

### Task Assignment

Assignment uses a dedicated endpoint:

```text
PATCH /tasks/:taskId/assignee
```

The endpoint accepts a nullable `assigneeId`, which keeps assignment semantics explicit and avoids hiding permission-sensitive behavior inside generic task update. `createdBy` remains the immutable creator concept; `assigneeId` is a separate nullable task reference.

The backend checks the actor's project access, validates the target assignee is an explicit project member, and applies the role rules server-side. The frontend mirrors those rules for UX, but the backend remains authoritative.

### Activity History

Assignment history is stored in a separate `TaskActivity` collection rather than an embedded growing array on the task document.

The assessment tracks one activity type:

```text
TASK_ASSIGNEE_CHANGED
```

Each record stores the task, project, actor, type, metadata `{ from, to }`, and `createdAt`. Activity is recorded synchronously after a real assignment change. Assigning the same assignee again is a true no-op: the task is not saved and no activity is written.

### Activity Query

Activity reads are task-scoped and authorize through the task's project before returning history.

The endpoint uses the repository pagination convention:

```text
GET /tasks/:taskId/activity?page=1&pageSize=20
```

Results are newest first with deterministic ordering:

```text
{ createdAt: -1, _id: -1 }
```

The supporting index is:

```text
{ taskId: 1, createdAt: -1, _id: -1 }
```

Activity serialization resolves actor/from/to users in batches to avoid an N+1 lookup pattern. Genuine `null` values remain unassigned; unresolved historical user ids use the repository's deleted-user placeholder while preserving raw metadata ids.

### Task Number Concurrency

The original task creation logic used:

```text
countDocuments({ projectId }) + 1
```

That races when multiple requests create tasks in the same project concurrently.

The implemented design makes the project own its sequence:

- `Project.lastTaskNumber` stores the last reserved task number.
- New application-created projects explicitly initialize it to `0`.
- Task creation reserves the next number with an atomic MongoDB update.
- Legacy projects with no stored counter initialize from the current maximum task number.
- The legacy path is database-side and concurrency-safe, so concurrent initializers cannot reset or reuse the sequence.
- `{ projectId, number }` is unique as defense in depth.

The schema intentionally does not use a Mongoose default for `lastTaskNumber`; a schema default could hydrate a legacy document with `0` and persist that value during an unrelated save, destroying the "missing means uninitialized" signal.

No process-local mutex, transaction, or separate counter collection was introduced.

### Frontend State Strategy

The assignee mutation snapshots both the task-detail cache and the project task-list cache, applies an optimistic assignee update, rolls both caches back on error, and reconciles the task detail from the authoritative server response on success.

Project task lists are invalidated after mutation settlement for server truth. Task activity pages are invalidated only after a successful real assignment change; the frontend never fabricates optimistic activity rows.

The activity timeline uses explicit page state over `useQuery`. Loaded pages are accumulated locally, de-duplicated by activity id, and reset around a fresh page-1 data epoch after assignment invalidation. Load-more state and stale requests are tagged by task/epoch so activity state from one task does not leak into another mounted task view.

## Risks / Weaknesses Identified

1. Resource-level authorization was inconsistent across task mutation paths.
   The status endpoint was affected and fixed; the risk was authenticated cross-project mutation.

2. Task numbering relied on count-plus-one without an atomic invariant.
   This was fixed with a project-owned atomic counter and a unique database index. A rollout risk remains if an existing production database already contains duplicate project task numbers.

3. Task assignment and activity insertion are two separate writes.
   An activity insert failure can occur after the task mutation persists. No transaction was introduced for assessment simplicity; stronger audit durability would require revisiting the consistency boundary.

4. The web development script uses Unix shell default-variable syntax.
   This is not fully portable to Windows PowerShell without running the direct Next command documented in the README.

## Production Rollout Considerations

Before enabling the unique `{ projectId, number }` index in an existing production database:

1. Detect duplicate task numbers within each project.
2. Resolve duplicates according to product policy.
3. Backfill each project's `lastTaskNumber` to at least the maximum existing task number.
4. Build the unique index only after duplicates and counters are corrected.

The repository does not include a migration framework, so this would need a controlled operational script or migration step before deployment.

## Manual Verification

Manual browser verification observed:

- On `ENG`, `OWNER` assignment options were limited to `Unassigned`, `Ahmed Hassan`, and `Magd Ali`.
- Ammar Yaser was not an assignable target because he was not an explicit `ENG` project member.
- Assignment updated the UI immediately and persisted across refresh.
- Assignment generated activity.
- Reassign and unassign generated human-readable newest-first records.
- Regular `MEMBER` self-assignment was available, but assigning another user and unassigning were not offered.
- The outsider account saw no projects, and direct project/task access was denied.
- Activity Load More worked with 16 records.
- After a new assignment, the 17-record timeline reset to a fresh first page with Load More available again.
- Mobile/narrow layout showed the assignee field and activity timeline without obvious overflow.

The in-flight task-navigation race was reasoned about and covered in code review, but it was not claimed as manually observed.

## Testing Strategy

Backend development used focused e2e regression tests against the real NestJS HTTP layer and mongodb-memory-server.

Covered scenarios include:

- regular member self-assigns;
- elevated role assigns another project member;
- `PROJECT_MANAGER` assigns and unassigns;
- regular member cannot assign another user;
- outsider/non-project user cannot be assigned;
- malformed assignee id is rejected;
- rejected assignment leaves persisted assignee unchanged;
- unassigned -> assigned activity;
- assigned -> different user activity;
- assigned -> unassigned activity;
- same-assignee no-op creates no extra activity;
- unauthorized activity access is forbidden;
- activity pagination is newest first;
- unresolved current task assignee returns the repository's deleted-user convention;
- cross-project task status update is forbidden;
- authorized project member can update task status;
- concurrent task creation keeps task numbers and keys unique;
- deleted task numbers are not reused.

The frontend has no existing automated test framework. Frontend validation used typecheck, lint, build, independent review, and manual browser verification within the repository's current tooling.

## Code Review

The assessment included an intentionally insecure `assignTask` implementation concept. The important review findings are below.

### Correctness

The assignment semantics were incomplete. A correct implementation needs nullable assignment for unassign, defined same-assignee no-op behavior, and a clear distinction between assigning, reassigning, and unassigning.

### Security / Authorization

Authentication alone is insufficient. The service must load the task, derive the project context, and apply project authorization through `ProjectAccessService`.

Target existence is also insufficient. The target must be an explicit member of the task's project, and the actor's role must be enforced server-side: regular members may self-assign only, while elevated organization roles and project managers may manage assignment.

### Business Rules

`createdBy` and `assignee` are separate concepts. The creator is not automatically the assignee, and assignment changes must not alter creator semantics.

Unassign requires an explicit permission rule. In this implementation, managers may unassign and regular members may not.

### Data Consistency

Assignment changes and required activity history are related writes. The current implementation records activity synchronously after a real change and does not create history for no-ops. The non-transactional failure boundary is acknowledged rather than hidden.

### Maintainability

The controller should remain thin. Business rules belong in a dedicated service method and DTO, reusing `ProjectAccessService` and project-member services instead of duplicating role logic throughout the codebase.

### Error Handling

The implementation should distinguish malformed ids, missing tasks, non-member assignment targets, and unauthorized actors. It should avoid leaking unnecessary project data to outsiders.

### Performance

Activity serialization should resolve users in batches rather than one query per activity record. The task activity endpoint should use an index aligned with task-scoped newest-first pagination.

### Architecture

The assignment endpoint should use shared API contracts and repository conventions rather than a parallel type system or generic event framework.

## Scaling Activity History to ~500k Users

### Current Query Pattern

The current activity query is task-scoped. It filters by `taskId` and sorts by `createdAt` and `_id` descending. This matches the product UI, which displays a timeline for one task at a time.

### Indexes

The current compound index is:

```text
{ taskId: 1, createdAt: -1, _id: -1 }
```

This supports filtering to one task and walking the newest-first ordering without adding speculative global indexes.

### Offset vs Cursor Pagination

The current `page` / `pageSize` approach is sufficient for the assessment and small-to-moderate task histories.

For very deep histories, cursor pagination should replace offset pagination. A cursor based on `(createdAt, _id)` would avoid growing `skip` cost, preserve stable page boundaries under new inserts, and align with the deterministic sort already used by the API.

### Write Growth / Retention

Activity history is append-only. Retention or archival should depend on product and compliance requirements. If assignment history becomes audit-sensitive, retention should be conservative and explicit.

### Async Processing

The required primary activity record should not be moved to fire-and-forget casually. If future scale adds notifications, analytics, or search projections, those secondary workflows can become asynchronous while the durable primary activity write remains part of the user-facing mutation semantics.

### Queues

A queue is justified when measured write load or downstream fanout requires it. It is not necessary for the current single activity record written during assignment.

### Realtime

WebSocket or SSE updates could be added if collaborative realtime history becomes a product requirement. The current assessment UI does not require realtime delivery.

### Caching

Task history is write-sensitive and project-authorized. It should not be cached broadly. Short-lived caching may be useful for hot read-heavy task histories after measuring latency and invalidation behavior.

### Observability

Useful production signals include:

- activity write failures;
- activity query latency;
- examined documents vs returned documents and index usage;
- pagination depth;
- API error rates;
- downstream queue lag if async projections are later introduced.

### Data Lifecycle

Partitioning or archival should be driven by actual dataset size, query latency, and retention rules rather than added preemptively.

## If I Had Two More Days

1. Harden assignment and activity consistency.
   Evaluate transaction support, replica-set deployment assumptions, or another durable strategy for guaranteed history when audit correctness becomes a product requirement.

2. Add production migration/backfill checks.
   Add a controlled script or rollout check for duplicate task numbers and `lastTaskNumber` initialization before deploying the unique index.

3. Add frontend automated tests.
   Introduce focused component/integration coverage for assignment permissions, optimistic rollback, activity Load More, and assignment-triggered invalidation behavior.

4. Revisit cursor pagination if activity depth justifies it.
   Keep the current page/pageSize contract until measured history depth or latency makes cursor pagination worthwhile.

5. Normalize cross-platform developer workflow.
   Update local scripts so Windows, macOS, and Linux can run the same commands without shell-specific port syntax.
