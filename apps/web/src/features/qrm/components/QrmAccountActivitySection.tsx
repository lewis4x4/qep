import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { QrmActivityComposer } from "./QrmActivityComposer";
import { QrmActivityTimeline, type QrmActivityEmptyStateCue } from "./QrmActivityTimeline";
import { DeckSurface } from "./command-deck";
import { useCrmActivityBodyMutation } from "../hooks/useCrmActivityBodyMutation";
import { useCrmActivityDeliveryMutation } from "../hooks/useCrmActivityDeliveryMutation";
import { useCrmActivityOccurredAtMutation } from "../hooks/useCrmActivityOccurredAtMutation";
import { useCrmActivityTaskMutation } from "../hooks/useCrmActivityTaskMutation";
import { createCrmActivity, listCompanyActivities } from "../lib/qrm-api";
import type { QrmActivityItem, QrmActivityType, QrmTaskMetadata } from "../lib/types";

interface QrmAccountActivitySectionProps {
  accountId: string;
  accountName: string;
  currentUserId: string | null;
  queryKey: QueryKey;
  limit?: number;
  title: string;
  description: string;
  secondaryAction?: {
    label: string;
    href: string;
  };
  emptyStateCue?: QrmActivityEmptyStateCue;
}

interface CreateActivityInput {
  activityType: QrmActivityType;
  body: string;
  occurredAt: string;
  sendNow?: boolean;
  task?: QrmTaskMetadata;
}

function dedupeQueryKeys(keys: QueryKey[]): QueryKey[] {
  const seen = new Set<string>();
  return keys.filter((key) => {
    const signature = JSON.stringify(key);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

export function QrmAccountActivitySection({
  accountId,
  accountName,
  currentUserId,
  queryKey,
  limit,
  title,
  description,
  secondaryAction,
  emptyStateCue,
}: QrmAccountActivitySectionProps) {
  const queryClient = useQueryClient();
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerInitialActivityType, setComposerInitialActivityType] = useState<QrmActivityType>("call");
  const [createError, setCreateError] = useState<string | null>(null);

  const extraInvalidateKeys = useMemo(
    () =>
      dedupeQueryKeys([
        ["crm", "company", accountId, "activities"],
        ["account-command", accountId, "activities"],
        ["account-timeline", accountId, "activities"],
      ]),
    [accountId],
  );

  const activitiesQuery = useQuery({
    queryKey,
    queryFn: () => listCompanyActivities(accountId),
    enabled: Boolean(accountId),
    staleTime: 30_000,
  });

  const createActivityMutation = useMutation({
    mutationFn: async (input: CreateActivityInput) => {
      if (!currentUserId) {
        throw new Error("You must be signed in to log account activity.");
      }
      return createCrmActivity({ ...input, companyId: accountId }, currentUserId);
    },
    onMutate: async (input) => {
      setCreateError(null);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<QrmActivityItem[]>(queryKey) ?? [];
      const optimistic: QrmActivityItem = {
        id: `optimistic-${Date.now()}`,
        workspaceId: "default",
        activityType: input.activityType,
        body: input.body,
        occurredAt: input.occurredAt,
        contactId: null,
        companyId: accountId,
        dealId: null,
        createdBy: currentUserId,
        metadata: input.task ? { task: input.task } : {},
        createdAt: input.occurredAt,
        updatedAt: input.occurredAt,
        isOptimistic: true,
      };
      queryClient.setQueryData<QrmActivityItem[]>(queryKey, [optimistic, ...previous]);
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      setCreateError(error instanceof Error ? error.message : "Unable to log account activity.");
    },
    onSuccess: () => {
      setComposerOpen(false);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        ...extraInvalidateKeys.map((key) => queryClient.invalidateQueries({ queryKey: key })),
      ]);
    },
  });

  const { pendingBodyId, patchBody } = useCrmActivityBodyMutation(queryKey, { extraInvalidateKeys });
  const { pendingOccurredAtId, patchOccurredAt } = useCrmActivityOccurredAtMutation(queryKey, { extraInvalidateKeys });
  const { pendingTaskId, patchTask } = useCrmActivityTaskMutation(queryKey, { extraInvalidateKeys });
  const { pendingDeliveryId, deliverActivity } = useCrmActivityDeliveryMutation(queryKey, { extraInvalidateKeys });

  const activities = limit ? (activitiesQuery.data ?? []).slice(0, limit) : activitiesQuery.data ?? [];
  const timelineEmptyStateCue = emptyStateCue
    ? { ...emptyStateCue, seeTimelineHref: emptyStateCue.seeTimelineHref ?? secondaryAction?.href }
    : secondaryAction?.href
      ? { seeTimelineHref: secondaryAction.href, suggestion: "QEP cue: capture the first operator touchpoint so this account has a trustworthy handoff trail." }
      : undefined;

  function openComposer(initialActivityType: QrmActivityType = "call"): void {
    setCreateError(null);
    setComposerInitialActivityType(initialActivityType);
    setComposerOpen(true);
  }

  return (
    <DeckSurface>
      <div className="flex items-start justify-between gap-3 border-b border-qep-deck-rule/60 pb-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          {secondaryAction ? (
            <Button asChild size="sm" variant="ghost">
              <Link to={secondaryAction.href}>{secondaryAction.label}</Link>
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => openComposer("call")}
            disabled={activitiesQuery.isError}
            title={activitiesQuery.isError ? "Retry recent activity before logging against this account." : undefined}
          >
            Log activity
          </Button>
        </div>
      </div>

      {createError ? <p className="mt-3 text-sm text-destructive">{createError}</p> : null}

      {activitiesQuery.isLoading ? (
        <div className="mt-4 space-y-3" role="status" aria-label="Loading activities">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="rounded-xl border border-qep-deck-rule bg-qep-deck-elevated/35 p-3"
            >
              <div className="flex animate-pulse gap-3">
                <div className="h-7 w-7 rounded-full bg-muted/70" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-20 rounded bg-muted/70" />
                    <div className="h-3 w-16 rounded bg-muted/50" />
                  </div>
                  <div className="h-3 w-full rounded bg-muted/60" />
                  <div className="h-3 w-2/3 rounded bg-muted/50" />
                  <div className="h-2.5 w-28 rounded bg-muted/40" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : activitiesQuery.isError ? (
        <div className="mt-4 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Couldn&apos;t load recent activity for {accountName}.</p>
          <p className="mt-1">The account record is still available; retry this panel before logging against stale context.</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => activitiesQuery.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="mt-4">
          <QrmActivityTimeline
            activities={activities}
            onLogActivity={openComposer}
            entityLabel={accountName}
            showEntityLabel={false}
            emptyStateCue={timelineEmptyStateCue}
            pendingBodyId={pendingBodyId}
            pendingOccurredAtId={pendingOccurredAtId}
            pendingTaskId={pendingTaskId}
            pendingDeliveryId={pendingDeliveryId}
            onPatchBody={async (activity, body, updatedAt) => {
              await patchBody({ activityId: activity.id, body, updatedAt });
            }}
            onPatchOccurredAt={async (activity, occurredAt, updatedAt) => {
              await patchOccurredAt({ activityId: activity.id, occurredAt, updatedAt });
            }}
            onPatchTask={async (activity, task, updatedAt) => {
              await patchTask({ activityId: activity.id, task, updatedAt });
            }}
            onDeliverCommunication={async (activity) => {
              await deliverActivity({ activityId: activity.id, updatedAt: activity.updatedAt });
            }}
          />
        </div>
      )}

      <QrmActivityComposer
        open={composerOpen}
        onOpenChange={setComposerOpen}
        onSubmit={async (input) => {
          if (!currentUserId) {
            const message = "You must be signed in to log account activity.";
            setCreateError(message);
            throw new Error(message);
          }
          await createActivityMutation.mutateAsync(input);
        }}
        isPending={createActivityMutation.isPending}
        subjectLabel={accountName}
        initialActivityType={composerInitialActivityType}
      />
    </DeckSurface>
  );
}
