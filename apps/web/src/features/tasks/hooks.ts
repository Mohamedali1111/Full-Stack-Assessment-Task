'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  Paginated,
  ProjectMemberEntry,
  TaskDetail,
  TaskStatus,
  TaskSummary,
} from '@projectflow/shared';
import { queryKeys } from '@/lib/query-keys';
import {
  createTask,
  type CreateTaskPayload,
  fetchProjectTasks,
  fetchTask,
  updateTaskAssignee,
  type UpdateTaskAssigneePayload,
  updateTaskStatus,
} from './api';

export function useProjectTasks(projectId: string) {
  return useQuery<Paginated<TaskSummary>>({
    queryKey: queryKeys.projectTasks(projectId),
    queryFn: () => fetchProjectTasks(projectId),
    enabled: projectId.length > 0,
  });
}

export function useTask(taskId: string) {
  return useQuery<TaskDetail>({
    queryKey: queryKeys.task(taskId),
    queryFn: () => fetchTask(taskId),
    enabled: taskId.length > 0,
  });
}

export function useCreateTask(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation<TaskDetail, Error, CreateTaskPayload>({
    mutationFn: (payload) => createTask(projectId, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
      ]);
    },
  });
}

export function useUpdateTaskStatus(taskId: string, projectId: string) {
  const queryClient = useQueryClient();

  return useMutation<TaskDetail, Error, TaskStatus>({
    mutationFn: (status) => updateTaskStatus(taskId, status),
    onSuccess: async (task) => {
      queryClient.setQueryData(queryKeys.task(taskId), task);
      await queryClient.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) });
    },
  });
}

interface UpdateTaskAssigneeContext {
  previousTask: TaskDetail | undefined;
  previousProjectTasks: Paginated<TaskSummary> | undefined;
}

export function useUpdateTaskAssignee(taskId: string, projectId: string) {
  const queryClient = useQueryClient();

  return useMutation<TaskDetail, Error, UpdateTaskAssigneePayload, UpdateTaskAssigneeContext>({
    mutationFn: (payload) => updateTaskAssignee(taskId, payload),
    onMutate: async (payload) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: queryKeys.task(taskId) }),
        queryClient.cancelQueries({ queryKey: queryKeys.projectTasks(projectId) }),
      ]);

      const previousTask = queryClient.getQueryData<TaskDetail>(queryKeys.task(taskId));
      const previousProjectTasks = queryClient.getQueryData<Paginated<TaskSummary>>(
        queryKeys.projectTasks(projectId),
      );
      const projectMembers = queryClient.getQueryData<ProjectMemberEntry[]>(
        queryKeys.projectMembers(projectId),
      );

      const optimisticAssignee =
        payload.assigneeId === null
          ? null
          : projectMembers?.find((member) => member.user.id === payload.assigneeId)?.user;

      if (payload.assigneeId === null || optimisticAssignee) {
        queryClient.setQueryData<TaskDetail>(queryKeys.task(taskId), (task) =>
          task ? { ...task, assignee: optimisticAssignee ?? null } : task,
        );

        queryClient.setQueryData<Paginated<TaskSummary>>(
          queryKeys.projectTasks(projectId),
          (tasks) =>
            tasks
              ? {
                  ...tasks,
                  items: tasks.items.map((task) =>
                    task.id === taskId ? { ...task, assignee: optimisticAssignee ?? null } : task,
                  ),
                }
              : tasks,
        );
      }

      return { previousTask, previousProjectTasks };
    },
    onError: (error, _payload, context) => {
      queryClient.setQueryData(queryKeys.task(taskId), context?.previousTask);
      queryClient.setQueryData(queryKeys.projectTasks(projectId), context?.previousProjectTasks);
      toast.error(error.message);
    },
    onSuccess: (task) => {
      queryClient.setQueryData(queryKeys.task(taskId), task);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) });
    },
  });
}
