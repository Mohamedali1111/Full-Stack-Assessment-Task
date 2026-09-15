'use client';

import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/dist/ssr';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Paginated, TaskActivityEntry, UserSummary } from '@projectflow/shared';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { queryKeys } from '@/lib/query-keys';
import { formatDateTime } from '@/lib/format';
import { fetchTaskActivity } from '../api';
import { TASK_ACTIVITY_PAGE_SIZE, useTaskActivity } from '../hooks';

export function TaskActivityList({ taskId }: { taskId: string }) {
  const queryClient = useQueryClient();
  const firstPage = useTaskActivity(taskId, 1, TASK_ACTIVITY_PAGE_SIZE);
  const [loadedPages, setLoadedPages] = useState<LoadedActivityPages | null>(null);
  const [loadingMore, setLoadingMore] = useState<LoadingMoreState | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<LoadMoreError | null>(null);

  const extraPages =
    loadedPages?.baseDataUpdatedAt === firstPage.dataUpdatedAt ? loadedPages.pages : [];
  const items = mergeActivity(
    firstPage.data?.items ?? [],
    extraPages.flatMap((page) => page.items),
  );
  const loadedPage = extraPages.length > 0 ? extraPages[extraPages.length - 1]!.page : 1;
  const total =
    loadedPages?.baseDataUpdatedAt === firstPage.dataUpdatedAt
      ? loadedPages.total
      : (firstPage.data?.total ?? 0);
  const currentLoadMoreError =
    loadMoreError?.baseDataUpdatedAt === firstPage.dataUpdatedAt ? loadMoreError.message : null;
  const isLoadingMore =
    loadingMore?.taskId === taskId && loadingMore.baseDataUpdatedAt === firstPage.dataUpdatedAt;
  const hasMore = items.length < total;

  async function loadMore() {
    if (!firstPage.data) {
      return;
    }
    const baseDataUpdatedAt = firstPage.dataUpdatedAt;
    const nextPage = loadedPage + 1;
    setLoadingMore({ taskId, baseDataUpdatedAt });
    setLoadMoreError(null);
    try {
      const page = await queryClient.fetchQuery<Paginated<TaskActivityEntry>>({
        queryKey: queryKeys.taskActivityPage(taskId, nextPage, TASK_ACTIVITY_PAGE_SIZE),
        queryFn: () => fetchTaskActivity(taskId, nextPage, TASK_ACTIVITY_PAGE_SIZE),
      });
      setLoadedPages((current) => ({
        baseDataUpdatedAt,
        pages:
          current?.baseDataUpdatedAt === baseDataUpdatedAt
            ? [...current.pages, { page: nextPage, items: page.items }]
            : [{ page: nextPage, items: page.items }],
        total: page.total,
      }));
    } catch (error) {
      setLoadMoreError({
        baseDataUpdatedAt,
        message: error instanceof Error ? error.message : 'Unable to load activity.',
      });
    } finally {
      setLoadingMore((current) =>
        current?.taskId === taskId && current.baseDataUpdatedAt === baseDataUpdatedAt
          ? null
          : current,
      );
    }
  }

  return (
    <section className="space-y-4" aria-label="Activity">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">Activity</h2>
        {firstPage.data ? (
          <span className="rounded-sm bg-surface-strong px-1.5 text-[11px] text-muted-foreground">
            {total}
          </span>
        ) : null}
      </div>

      {firstPage.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : firstPage.isError ? (
        <p className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-[13px] text-danger">
          {firstPage.error.message}
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={ClockCounterClockwiseIcon}
          title="No activity yet"
          description="Assignment changes will appear here."
        />
      ) : (
        <>
          <ul className="space-y-4">
            {items.map((activity) => (
              <li key={activity.id} className="flex gap-3">
                <Avatar user={activity.actor} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-5 text-muted-foreground">
                    <span className="font-medium text-foreground">{activity.actor.name}</span>{' '}
                    {renderActivityText(activity)}
                  </p>
                  <p className="mt-1 text-[12px] text-subtle-foreground">
                    {formatDateTime(activity.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          {currentLoadMoreError ? (
            <p className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-[13px] text-danger">
              {currentLoadMoreError}
            </p>
          ) : null}

          {hasMore ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={isLoadingMore}
              disabled={isLoadingMore}
              onClick={() => void loadMore()}
            >
              {currentLoadMoreError ? 'Retry' : 'Load more'}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}

interface LoadedActivityPages {
  baseDataUpdatedAt: number;
  pages: Array<{ page: number; items: TaskActivityEntry[] }>;
  total: number;
}

interface LoadMoreError {
  baseDataUpdatedAt: number;
  message: string;
}

interface LoadingMoreState {
  taskId: string;
  baseDataUpdatedAt: number;
}

function renderActivityText(activity: TaskActivityEntry) {
  if (activity.from === null && activity.to !== null) {
    return <>assigned <UserName user={activity.to} /></>;
  }

  if (activity.from !== null && activity.to !== null) {
    return (
      <>
        changed the assignee from <UserName user={activity.from} /> to{' '}
        <UserName user={activity.to} />
      </>
    );
  }

  if (activity.from !== null && activity.to === null) {
    return <>removed the assignee</>;
  }

  return <>updated the assignee</>;
}

function UserName({ user }: { user: UserSummary }) {
  return <span className="font-medium text-foreground">{user.name}</span>;
}

function mergeActivity(
  current: TaskActivityEntry[],
  next: TaskActivityEntry[],
): TaskActivityEntry[] {
  const seen = new Set(current.map((activity) => activity.id));
  return [...current, ...next.filter((activity) => !seen.has(activity.id))];
}
