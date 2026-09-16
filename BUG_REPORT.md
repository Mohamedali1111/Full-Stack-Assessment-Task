# Bug Report

## Summary

The task status update endpoint allowed an authenticated user to update the status of a task in a project they could not access if they knew the task id.

## Severity / Impact

Severity: high.

Authentication was required, but resource-level authorization was missing on the status mutation path. A user outside a project could modify that project's task status directly by calling the status endpoint with a known task id.

## Reproduction

The regression test reproduced the issue through the real API flow:

1. Create a project and task accessible to one authenticated user.
2. Authenticate a second user with no membership or access to that project.
3. Send `PATCH /tasks/:taskId/status` as the outsider.
4. Before the fix, the endpoint returned a successful response instead of `403`.
5. The task status persisted as changed from `TODO` to `IN_PROGRESS`.

## Root Cause

The controller/service path for task status updates did not enforce project-level resource authorization before mutating the task.

Authentication proved who the caller was, but the service did not verify that the caller could view or access the task's project.

## Fix

The status mutation flow now passes the authenticated user id into the service. `TasksService.updateStatus` loads the task, calls:

```text
ProjectAccessService.assertCanView(task.projectId, userId)
```

and only then mutates and saves the status.

`assertCanView` was used instead of `assertCanManage` to fix the cross-project authorization defect while preserving the existing product semantics: users who can access the project may update task status.

## Regression Coverage

The task e2e suite includes coverage that:

- an outsider cannot update another project's task status;
- an authorized project member can still update task status.

## Verification

The focused task e2e suite was used to reproduce the vulnerability before the fix and to verify the fixed behavior afterward:

```bash
pnpm --filter @projectflow/api test -- tasks.e2e.spec.ts
```
