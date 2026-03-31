import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, GitMerge, Loader2, Plus } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { UserRole } from "@/lib/database.types";
import { CrmActivityComposer } from "../components/CrmActivityComposer";
import { CrmActivityTimeline } from "../components/CrmActivityTimeline";
import { CrmCompanyEquipmentSection } from "../components/CrmCompanyEquipmentSection";
import { CrmCompanyHierarchyCard } from "../components/CrmCompanyHierarchyCard";
import { CrmCustomFieldsCard } from "../components/CrmCustomFieldsCard";
import { CrmPageHeader } from "../components/CrmPageHeader";
import {
  createCrmActivity,
  getCrmCompany,
  getProfileDisplayName,
  listCrmCompanies,
  listCompanyActivities,
  patchCrmActivityTask,
} from "../lib/crm-api";
import { fetchCompanyHierarchy, updateCompanyParent } from "../lib/crm-router-api";
import type { CrmActivityItem } from "../lib/types";

interface CrmCompanyDetailPageProps {
  userId: string;
  userRole: UserRole;
}

export function CrmCompanyDetailPage({ userId, userRole }: CrmCompanyDetailPageProps) {
  const { companyId } = useParams<{ companyId: string }>();
  const queryClient = useQueryClient();
  const [composerOpen, setComposerOpen] = useState(false);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [hierarchyEditorOpen, setHierarchyEditorOpen] = useState(false);
  const [parentSearchInput, setParentSearchInput] = useState("");
  const [parentSearch, setParentSearch] = useState("");
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [hierarchyError, setHierarchyError] = useState<string | null>(null);

  if (!companyId) {
    return <Navigate to="/crm/companies" replace />;
  }

  const companyQuery = useQuery({
    queryKey: ["crm", "company", companyId],
    queryFn: () => getCrmCompany(companyId),
  });

  const hierarchyQuery = useQuery({
    queryKey: ["crm", "company", companyId, "hierarchy"],
    queryFn: () => fetchCompanyHierarchy(companyId),
    enabled: Boolean(companyQuery.data),
  });

  const activitiesQuery = useQuery({
    queryKey: ["crm", "company", companyId, "activities"],
    queryFn: () => listCompanyActivities(companyId),
    enabled: companyQuery.data !== null,
  });

  const parentOptionsQuery = useQuery({
    queryKey: ["crm", "companies", "parent-options", parentSearch],
    queryFn: () => listCrmCompanies(parentSearch),
    enabled: hierarchyEditorOpen,
    staleTime: 60_000,
  });

  const assignedRepQuery = useQuery({
    queryKey: ["crm", "profile", companyQuery.data?.assignedRepId],
    queryFn: () => getProfileDisplayName(companyQuery.data?.assignedRepId ?? ""),
    enabled: Boolean(companyQuery.data?.assignedRepId),
    staleTime: 60_000,
  });

  const createActivityMutation = useMutation({
    mutationFn: async (input: {
      activityType: "note" | "call" | "email" | "meeting" | "task" | "sms";
      body: string;
      occurredAt: string;
      sendNow?: boolean;
      task?: {
        dueAt?: string | null;
        status?: "open" | "completed";
      };
    }) => createCrmActivity({ ...input, companyId }, userId),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["crm", "company", companyId, "activities"] });
      const previous = queryClient.getQueryData<CrmActivityItem[]>(["crm", "company", companyId, "activities"]) ?? [];
      const optimistic: CrmActivityItem = {
        id: `optimistic-${Date.now()}`,
        workspaceId: "default",
        activityType: input.activityType,
        body: input.body,
        occurredAt: input.occurredAt,
        contactId: null,
        companyId,
        dealId: null,
        createdBy: userId,
        metadata: input.task ? { task: input.task } : {},
        createdAt: input.occurredAt,
        updatedAt: input.occurredAt,
        isOptimistic: true,
      };

      queryClient.setQueryData<CrmActivityItem[]>(["crm", "company", companyId, "activities"], [optimistic, ...previous]);
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["crm", "company", companyId, "activities"], context.previous);
      }
    },
    onSuccess: () => setComposerOpen(false),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["crm", "company", companyId, "activities"] });
    },
  });

  const patchTaskMutation = useMutation({
    mutationFn: async ({ activityId, status }: { activityId: string; status: "open" | "completed" }) =>
      patchCrmActivityTask(activityId, { task: { status } }),
    onMutate: async ({ activityId, status }) => {
      setPendingTaskId(activityId);
      await queryClient.cancelQueries({ queryKey: ["crm", "company", companyId, "activities"] });
      const previous = queryClient.getQueryData<CrmActivityItem[]>(["crm", "company", companyId, "activities"]) ?? [];
      queryClient.setQueryData<CrmActivityItem[]>(
        ["crm", "company", companyId, "activities"],
        previous.map((activity) =>
          activity.id === activityId
            ? {
                ...activity,
                metadata: {
                  ...activity.metadata,
                  task: {
                    ...((activity.metadata.task as Record<string, unknown> | undefined) ?? {}),
                    status,
                  },
                },
              }
            : activity
        )
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["crm", "company", companyId, "activities"], context.previous);
      }
    },
    onSettled: async () => {
      setPendingTaskId(null);
      await queryClient.invalidateQueries({ queryKey: ["crm", "company", companyId, "activities"] });
    },
  });

  const hierarchyMutation = useMutation({
    mutationFn: (nextParentId: string | null) => updateCompanyParent(companyId, nextParentId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["crm", "company", companyId] }),
        queryClient.invalidateQueries({ queryKey: ["crm", "company", companyId, "hierarchy"] }),
        queryClient.invalidateQueries({ queryKey: ["crm", "companies"] }),
      ]);
      setHierarchyError(null);
      setHierarchyEditorOpen(false);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Unable to update company hierarchy.";
      if (message.toLowerCase().includes("cycle")) {
        setHierarchyError("That parent creates a hierarchy loop. Pick a different parent company.");
        return;
      }
      setHierarchyError(message);
    },
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setParentSearch(parentSearchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [parentSearchInput]);

  useEffect(() => {
    if (!hierarchyEditorOpen || !companyQuery.data) return;
    setSelectedParentId(companyQuery.data.parentCompanyId);
    setParentSearchInput("");
    setParentSearch("");
    setHierarchyError(null);
  }, [hierarchyEditorOpen, companyQuery.data?.id, companyQuery.data?.parentCompanyId]);

  const currentParentNode = useMemo(() => {
    const ancestors = hierarchyQuery.data?.ancestors ?? [];
    return ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;
  }, [hierarchyQuery.data?.ancestors]);

  const availableParentOptions = useMemo(() => {
    const items = parentOptionsQuery.data?.items ?? [];
    const blockedIds = new Set(hierarchyQuery.data?.subtreeCompanyIds ?? [companyId]);
    const filtered = items.filter((item) => !blockedIds.has(item.id));

    if (
      currentParentNode &&
      !blockedIds.has(currentParentNode.id) &&
      !filtered.some((item) => item.id === currentParentNode.id)
    ) {
      filtered.unshift({
        id: currentParentNode.id,
        workspaceId: companyQuery.data?.workspaceId ?? "default",
        name: currentParentNode.name,
        parentCompanyId: null,
        assignedRepId: null,
        city: null,
        state: null,
        country: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      });
    }

    return filtered;
  }, [
    parentOptionsQuery.data?.items,
    hierarchyQuery.data?.subtreeCompanyIds,
    companyId,
    currentParentNode,
    companyQuery.data?.workspaceId,
  ]);

  const locationLabel = useMemo(() => {
    if (!companyQuery.data) {
      return "Company";
    }
    return [companyQuery.data.city, companyQuery.data.state, companyQuery.data.country].filter(Boolean).join(", ") ||
      "Company";
  }, [companyQuery.data]);

  const companyName = companyQuery.data?.name ?? "company";
  const canManageDefinitions = userRole === "admin" || userRole === "owner";
  const canManageHierarchy = userRole === "admin" || userRole === "manager" || userRole === "owner";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-28 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/crm/companies"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to companies
        </Link>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to="/crm/duplicates">
              <GitMerge className="mr-2 h-4 w-4" />
              Review Duplicates
            </Link>
          </Button>
          <Button className="hidden sm:inline-flex" onClick={() => setComposerOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Log Activity
          </Button>
        </div>
      </div>

      {companyQuery.isLoading && <div className="h-28 animate-pulse rounded-xl border border-[#E2E8F0] bg-white" />}

      {companyQuery.isError && (
        <Card className="p-6 text-center">
          <p className="text-sm text-[#334155]">Unable to load this company. Refresh the page or go back to your companies list.</p>
        </Card>
      )}

      {!companyQuery.isLoading && !companyQuery.isError && !companyQuery.data && (
        <Card className="p-6 text-center">
          <p className="text-sm text-[#334155]">This company isn&apos;t available. It may have been removed or you might not have access.</p>
        </Card>
      )}

      {companyQuery.data && (
        <>
          <CrmPageHeader title={companyQuery.data.name} subtitle={locationLabel} />

          <Card className="p-4 sm:p-5">
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[#475569]">Assigned rep</dt>
                <dd className="font-medium text-[#0F172A]">
                  {assignedRepQuery.data || (companyQuery.data.assignedRepId ? "Assigned representative" : "Unassigned")}
                </dd>
              </div>
              <div>
                <dt className="text-[#475569]">Last updated</dt>
                <dd className="font-medium text-[#0F172A]">
                  {new Date(companyQuery.data.updatedAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </dd>
              </div>
            </dl>
          </Card>

          {hierarchyQuery.isLoading && <div className="h-28 animate-pulse rounded-xl border border-[#E2E8F0] bg-white" />}
          {!hierarchyQuery.isLoading && hierarchyQuery.data && (
            <div className="space-y-3">
              <CrmCompanyHierarchyCard hierarchy={hierarchyQuery.data} />

              {canManageHierarchy && (
                <Card className="space-y-3 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[#0F172A]">Hierarchy controls</h3>
                      <p className="text-sm text-[#475569]">
                        Set the direct parent company for this account.
                      </p>
                    </div>
                    {!hierarchyEditorOpen ? (
                      <Button
                        variant="outline"
                        className="min-h-[44px]"
                        onClick={() => setHierarchyEditorOpen(true)}
                      >
                        Edit parent company
                      </Button>
                    ) : null}
                  </div>

                  {!hierarchyEditorOpen ? (
                    <p className="text-sm text-[#334155]">
                      Current parent:{" "}
                      <span className="font-medium text-[#0F172A]">
                        {currentParentNode?.name ?? "Top-level company"}
                      </span>
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <label className="block text-sm font-medium text-[#0F172A]" htmlFor="crm-parent-company-search">
                        Search parent company
                      </label>
                      <input
                        id="crm-parent-company-search"
                        value={parentSearchInput}
                        onChange={(event) => setParentSearchInput(event.target.value)}
                        placeholder="Search companies by name, city, or state"
                        className="h-11 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none"
                      />

                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => setSelectedParentId(null)}
                          className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                            selectedParentId === null
                              ? "border-[#E87722] bg-[#FFF7ED] text-[#9A3412]"
                              : "border-[#E2E8F0] bg-white text-[#0F172A] hover:border-[#E87722]/60"
                          }`}
                        >
                          Top-level company (no parent)
                        </button>

                        {parentOptionsQuery.isLoading ? (
                          <div className="h-12 animate-pulse rounded-md border border-[#E2E8F0] bg-[#F8FAFC]" />
                        ) : availableParentOptions.length === 0 ? (
                          <p className="text-sm text-[#475569]">No eligible parent companies found for this search.</p>
                        ) : (
                          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                            {availableParentOptions.map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => setSelectedParentId(option.id)}
                                className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                                  selectedParentId === option.id
                                    ? "border-[#E87722] bg-[#FFF7ED] text-[#9A3412]"
                                    : "border-[#E2E8F0] bg-white text-[#0F172A] hover:border-[#E87722]/60"
                                }`}
                              >
                                <span className="font-medium">{option.name}</span>
                                <span className="ml-2 text-xs text-[#64748B]">
                                  {[option.city, option.state].filter(Boolean).join(", ") || "No location"}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {hierarchyError && <p className="text-sm text-[#DC2626]">{hierarchyError}</p>}

                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          variant="outline"
                          className="min-h-[44px]"
                          onClick={() => setHierarchyEditorOpen(false)}
                          disabled={hierarchyMutation.isPending}
                        >
                          Cancel
                        </Button>
                        <Button
                          className="min-h-[44px]"
                          onClick={() => {
                            if (!companyQuery.data) return;
                            if (selectedParentId === companyQuery.data.parentCompanyId) {
                              setHierarchyEditorOpen(false);
                              return;
                            }
                            hierarchyMutation.mutate(selectedParentId);
                          }}
                          disabled={hierarchyMutation.isPending}
                        >
                          {hierarchyMutation.isPending ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Saving...
                            </>
                          ) : (
                            "Save parent company"
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              )}
            </div>
          )}

          <CrmCompanyEquipmentSection companyId={companyId} />
          <CrmCustomFieldsCard
            recordType="company"
            recordId={companyId}
            canManageDefinitions={canManageDefinitions}
          />

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-[#334155]" />
              <h2 className="text-base font-semibold text-[#0F172A]">Activity Timeline</h2>
            </div>

            {activitiesQuery.isLoading ? (
              <div className="space-y-3" role="status" aria-label="Loading activities">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="h-24 animate-pulse rounded-xl border border-[#E2E8F0] bg-white" />
                ))}
              </div>
            ) : activitiesQuery.isError ? (
              <Card className="p-4 text-sm text-[#334155]">Couldn&apos;t load activities. Try refreshing the page.</Card>
            ) : (
              <CrmActivityTimeline
                activities={activitiesQuery.data ?? []}
                onLogActivity={() => setComposerOpen(true)}
                entityLabel={companyName}
                showEntityLabel={false}
                pendingTaskId={pendingTaskId}
                onToggleTaskStatus={async (activity, nextStatus) => {
                  await patchTaskMutation.mutateAsync({ activityId: activity.id, status: nextStatus });
                }}
              />
            )}
          </section>
        </>
      )}

      <Button
        className="fixed bottom-20 right-4 z-30 min-h-[44px] rounded-full px-5 shadow-lg sm:hidden"
        onClick={() => setComposerOpen(true)}
      >
        <Plus className="mr-1 h-4 w-4" />
        Log Activity
      </Button>

      <CrmActivityComposer
        open={composerOpen}
        onOpenChange={setComposerOpen}
        isPending={createActivityMutation.isPending}
        subjectLabel={companyName}
        onSubmit={async (input) => {
          await createActivityMutation.mutateAsync(input);
        }}
      />
    </div>
  );
}
