'use client';

import {
  isElevatedOrganizationRole,
  ProjectRole,
  type TaskDetail,
  type UserSummary,
} from '@projectflow/shared';
import { Avatar } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/features/auth/hooks';
import { useProject, useProjectMembers } from '@/features/projects/hooks';
import { useUpdateTaskAssignee } from '../hooks';

const UNASSIGNED_VALUE = '__unassigned__';

interface TaskAssigneeSelectProps {
  task: TaskDetail;
  projectId: string;
}

export function TaskAssigneeSelect({ task, projectId }: TaskAssigneeSelectProps) {
  const currentUser = useCurrentUser();
  const project = useProject(projectId);
  const members = useProjectMembers(projectId);
  const updateAssignee = useUpdateTaskAssignee(task.id, projectId);

  const currentMembership = members.data?.find((member) => member.user.id === currentUser.data?.id);
  const organizationRole = currentUser.data?.organizations.find(
    (organization) => organization.id === project.data?.organization.id,
  )?.role;

  const canManageAssignments =
    isElevatedOrganizationRole(organizationRole) ||
    currentMembership?.role === ProjectRole.PROJECT_MANAGER;

  const canSelfAssign =
    !canManageAssignments &&
    currentMembership?.role === ProjectRole.MEMBER &&
    task.assignee?.id !== currentUser.data?.id;

  const isPermissionLoading = currentUser.isPending || project.isPending || members.isPending;
  const isPermissionError = currentUser.isError || project.isError || members.isError;
  const options = getAssignmentOptions({
    canManageAssignments,
    canSelfAssign,
    currentUser: currentUser.data,
    members: members.data,
  });
  const canEdit =
    !isPermissionLoading &&
    !isPermissionError &&
    (options.length > 0 || canManageAssignments);
  const isDisabled = !canEdit || updateAssignee.isPending;

  return (
    <div className="space-y-1.5">
      <h2 className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">
        Assignee
      </h2>

      {canEdit ? (
        <Select
          value={task.assignee?.id ?? UNASSIGNED_VALUE}
          disabled={isDisabled}
          onValueChange={(value) => {
            const assigneeId = value === UNASSIGNED_VALUE ? null : value;
            if ((task.assignee?.id ?? null) === assigneeId) {
              return;
            }
            updateAssignee.mutate({ assigneeId });
          }}
        >
          <SelectTrigger aria-label="Task assignee">
            <AssigneeValue assignee={task.assignee} />
          </SelectTrigger>
          <SelectContent>
            {canManageAssignments ? (
              <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
            ) : null}
            {options.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className="flex h-8 items-center rounded-md border border-border bg-background px-2.5">
          <AssigneeValue assignee={task.assignee} />
        </div>
      )}

      {isPermissionLoading ? <Skeleton className="h-3 w-24" /> : null}
      {isPermissionError ? (
        <p className="text-[12px] text-danger" role="alert">
          Assignment unavailable.
        </p>
      ) : null}
    </div>
  );
}

interface AssignmentOptionsInput {
  canManageAssignments: boolean;
  canSelfAssign: boolean;
  currentUser: UserSummary | undefined;
  members: Array<{ user: UserSummary }> | undefined;
}

function getAssignmentOptions({
  canManageAssignments,
  canSelfAssign,
  currentUser,
  members,
}: AssignmentOptionsInput): UserSummary[] {
  if (canManageAssignments) {
    return members?.map((member) => member.user) ?? [];
  }

  if (canSelfAssign && currentUser) {
    return [currentUser];
  }

  return [];
}

function AssigneeValue({ assignee }: { assignee: UserSummary | null }) {
  if (!assignee) {
    return <span className="truncate text-[13px] text-subtle-foreground">Unassigned</span>;
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar user={assignee} size="sm" />
      <span className="truncate text-[13px] text-foreground">{assignee.name}</span>
    </span>
  );
}
