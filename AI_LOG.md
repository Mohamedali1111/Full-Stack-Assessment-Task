# AI Log

## Tools Used

- ChatGPT - architecture/orchestration/review
- Codex - repository inspection, implementation, tests, validation
- Claude - independent code review

## How AI Was Used

AI assistance was used to understand the existing monorepo, convert assessment requirements into incremental implementation steps, write TDD regression coverage, reason about authorization and concurrency, design frontend server-state behavior, incorporate independent review feedback, and draft this documentation package.

Generated changes were reviewed, tested, and validated before commits.

## Suggestions Rejected or Changed

1. Counter field default.
   An initial design used a schema-level `lastTaskNumber` default of `0`. Independent review identified that Mongoose hydration of legacy projects could materialize and persist zero during unrelated saves. The design was changed so legacy documents remain uninitialized, new projects explicitly initialize to `0`, and legacy task-number initialization derives from the existing maximum task number atomically.

2. Activity failure swallowing.
   A review idea considered catching activity insert failure and still returning success. That was rejected because activity recording is required behavior; silently reporting success would hide missing history. The implementation keeps synchronous visible failure and documents the non-atomic consistency limitation.

3. Hardcoded frontend role checks.
   The frontend initially duplicated the elevated organization-role check. It was changed to use the shared `isElevatedOrganizationRole` helper.

## AI-Generated Code Modified

AI-generated code was not accepted blindly. Review and validation led to concrete changes including simplifying the activity pagination DTO to reuse the repository's `PaginationQueryDto`, adding the deterministic `_id` tiebreaker and matching index for activity ordering, tagging Load More state by task/epoch to avoid stale cross-task loading state, and centralizing the frontend elevated-role check through the shared helper.
