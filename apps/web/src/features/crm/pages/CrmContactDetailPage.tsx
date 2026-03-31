import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, FileText, Link2, Plus } from "lucide-react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { UserRole } from "@/lib/database.types";
import { CrmActivityComposer } from "../components/CrmActivityComposer";
import { CrmDealSignalBadges } from "../components/CrmDealSignalBadges";
import { CrmActivityTimeline } from "../components/CrmActivityTimeline";
import { CrmContactEditorSheet } from "../components/CrmContactEditorSheet";
import { CrmCustomFieldsCard } from "../components/CrmCustomFieldsCard";
import { CrmPageHeader } from "../components/CrmPageHeader";
import { useCrmActivityBodyMutation } from "../hooks/useCrmActivityBodyMutation";
import { useCrmActivityDeliveryMutation } from "../hooks/useCrmActivityDeliveryMutation";
import { useCrmActivityOccurredAtMutation } from "../hooks/useCrmActivityOccurredAtMutation";
import { CrmTerritoryConflictBadge } from "../components/CrmTerritoryConflictBadge";
import { useCrmActivityTaskMutation } from "../hooks/useCrmActivityTaskMutation";
import {
  createCrmActivity,
  getCrmCompany,
  getCrmContact,
  getProfileDisplayName,
  listContactActivities,
  listContactTerritories,
  listRepSafeDealsForContact,
} from "../lib/crm-api";
import type { CrmActivityItem } from "../lib/types";

interface CrmContactDetailPageProps {
  userId: string;
  userRole: UserRole;
}

export function CrmContactDetailPage({ userId, userRole }: CrmContactDetailPageProps) {
  const { contactId } = useParams<{ contactId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [composerOpen, setComposerOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  if (!contactId) {
    return <Navigate to="/crm/contacts" replace />;
  }

  const contactQuery = useQuery({
    queryKey: ["crm", "contact", contactId],
    queryFn: () => getCrmContact(contactId),
  });

  const activitiesQuery = useQuery({
    queryKey: ["crm", "contact", contactId, "activities"],
    queryFn: () => listContactActivities(contactId),
    enabled: contactQuery.data !== null,
  });

  const companyQuery = useQuery({
    queryKey: ["crm", "company", contactQuery.data?.primaryCompanyId],
    queryFn: () => getCrmCompany(contactQuery.data?.primaryCompanyId ?? ""),
    enabled: Boolean(contactQuery.data?.primaryCompanyId),
  });

  const territoriesQuery = useQuery({
    queryKey: ["crm", "contact", contactId, "territories"],
    queryFn: () => listContactTerritories(contactId),
    enabled: Boolean(contactQuery.data),
    staleTime: 30_000,
  });

  const dealsQuery = useQuery({
    queryKey: ["crm", "contact", contactId, "rep-safe-deals"],
    queryFn: () => listRepSafeDealsForContact(contactId),
    enabled: contactQuery.data !== null,
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
    }) => createCrmActivity({ ...input, contactId }, userId),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["crm", "contact", contactId, "activities"] });
      const previous = queryClient.getQueryData<CrmActivityItem[]>(["crm", "contact", contactId, "activities"]) ?? [];
      const optimistic: CrmActivityItem = {
        id: `optimistic-${Date.now()}`,
        workspaceId: "default",
        activityType: input.activityType,
        body: input.body,
        occurredAt: input.occurredAt,
        contactId,
        companyId: null,
        dealId: null,
        createdBy: userId,
        metadata: input.task ? { task: input.task } : {},
        createdAt: input.occurredAt,
        updatedAt: input.occurredAt,
        isOptimistic: true,
      };

      queryClient.setQueryData<CrmActivityItem[]>(["crm", "contact", contactId, "activities"], [optimistic, ...previous]);
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["crm", "contact", contactId, "activities"], context.previous);
      }
    },
    onSuccess: () => {
      setComposerOpen(false);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["crm", "contact", contactId, "activities"] });
    },
  });

  const { pendingBodyId, patchBody } = useCrmActivityBodyMutation(["crm", "contact", contactId, "activities"]);
  const { pendingOccurredAtId, patchOccurredAt } = useCrmActivityOccurredAtMutation(["crm", "contact", contactId, "activities"]);
  const { pendingTaskId, patchTask } = useCrmActivityTaskMutation(["crm", "contact", contactId, "activities"]);
  const { pendingDeliveryId, deliverActivity } = useCrmActivityDeliveryMutation([
    "crm",
    "contact",
    contactId,
    "activities",
  ]);

  const conflict = useMemo(() => {
    if (!contactQuery.data?.assignedRepId || !territoriesQuery.data) {
      return null;
    }

    return territoriesQuery.data.find((territory) =>
      territory.assignedRepId && territory.assignedRepId !== contactQuery.data?.assignedRepId
    ) ?? null;
  }, [contactQuery.data?.assignedRepId, territoriesQuery.data]);

  const contactRepNameQuery = useQuery({
    queryKey: ["crm", "profile", "contact-rep", contactQuery.data?.assignedRepId],
    queryFn: () => getProfileDisplayName(contactQuery.data?.assignedRepId ?? ""),
    enabled: Boolean(contactQuery.data?.assignedRepId),
  });

  const territoryRepNameQuery = useQuery({
    queryKey: ["crm", "profile", "territory-rep", conflict?.assignedRepId],
    queryFn: () => getProfileDisplayName(conflict?.assignedRepId ?? ""),
    enabled: Boolean(conflict?.assignedRepId),
  });

  const contactName = useMemo(() => {
    if (!contactQuery.data) {
      return "contact";
    }
    return `${contactQuery.data.firstName} ${contactQuery.data.lastName}`;
  }, [contactQuery.data]);

  const canResolveConflict = userRole === "admin" || userRole === "manager" || userRole === "owner";
  const canManageDefinitions = userRole === "admin" || userRole === "owner";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-28 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/crm/contacts"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to contacts
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setEditorOpen(true)}>
            Edit Contact
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={`/quote?crm_contact_id=${contactId}`}>
              <FileText className="mr-2 h-4 w-4" />
              New Quote
            </Link>
          </Button>
          <Button className="hidden sm:inline-flex" onClick={() => setComposerOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Log Activity
          </Button>
        </div>
      </div>

      {contactQuery.isLoading && <div className="h-28 animate-pulse rounded-xl border border-[#E2E8F0] bg-white" />}

      {contactQuery.isError && (
        <Card className="p-6 text-center">
          <p className="text-sm text-[#334155]">Unable to load this contact. Refresh the page or go back to your contacts list.</p>
        </Card>
      )}

      {!contactQuery.isLoading && !contactQuery.isError && !contactQuery.data && (
        <Card className="p-6 text-center">
          <p className="text-sm text-[#334155]">This contact isn&apos;t available. It may have been removed or you might not have access.</p>
        </Card>
      )}

      {contactQuery.data && (
        <>
          <CrmPageHeader
            title={`${contactQuery.data.firstName} ${contactQuery.data.lastName}`}
            subtitle={contactQuery.data.title || "CRM Contact"}
          />

          {contactQuery.data.dgeCustomerProfileId && (
            <Card className="p-3">
              <p className="inline-flex items-center gap-2 text-sm text-[#334155]">
                <Link2 className="h-4 w-4 text-[#B45309]" />
                <Link
                  className="font-medium text-[#0F172A] underline-offset-2 hover:underline"
                  to={`/chat?customer_profile_id=${contactQuery.data.dgeCustomerProfileId}`}
                >
                  DGE profile linked
                </Link>
              </p>
            </Card>
          )}

          {conflict && (
            <CrmTerritoryConflictBadge
              territoryName={conflict.name}
              territoryRepName={territoryRepNameQuery.data ?? null}
              contactRepName={contactRepNameQuery.data ?? null}
              canResolve={canResolveConflict}
              onResolve={() => {
                if (contactQuery.data?.primaryCompanyId) {
                  navigate(`/crm/companies/${contactQuery.data.primaryCompanyId}`);
                }
              }}
            />
          )}

          <Card className="p-4 sm:p-5">
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[#475569]">Email</dt>
                <dd className="font-medium text-[#0F172A]">{contactQuery.data.email || "Not provided"}</dd>
              </div>
              <div>
                <dt className="text-[#475569]">Phone</dt>
                <dd className="font-medium text-[#0F172A]">{contactQuery.data.phone || "Not provided"}</dd>
              </div>
              <div>
                <dt className="text-[#475569]">Primary company</dt>
                <dd className="font-medium text-[#0F172A]">{companyQuery.data?.name || "Not linked"}</dd>
              </div>
              <div>
                <dt className="text-[#475569]">Last updated</dt>
                <dd className="font-medium text-[#0F172A]">
                  {new Date(contactQuery.data.updatedAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </dd>
              </div>
            </dl>
          </Card>

          <CrmCustomFieldsCard
            recordType="contact"
            recordId={contactId}
            canManageDefinitions={canManageDefinitions}
          />

          <Card className="p-4 sm:p-5">
            <h2 className="text-base font-semibold text-[#0F172A]">Open Deals</h2>
            {dealsQuery.isLoading && <div className="mt-3 h-10 animate-pulse rounded bg-[#F8FAFC]" />}
            {!dealsQuery.isLoading && (dealsQuery.data?.length ?? 0) === 0 && (
              <p className="mt-2 text-sm text-[#475569]">No linked deals yet.</p>
            )}
            {!dealsQuery.isLoading && (dealsQuery.data?.length ?? 0) > 0 && (
              <ul className="mt-3 space-y-2">
                {dealsQuery.data?.map((deal) => (
                  <li key={deal.id} className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <Link to={`/crm/deals/${deal.id}`} className="font-medium text-[#0F172A] hover:text-[#B45309]">
                        {deal.name}
                      </Link>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[#475569]">{deal.amount ? `$${deal.amount.toLocaleString()}` : "Amount TBD"}</span>
                        <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
                          <Link to={`/quote?crm_contact_id=${contactId}&crm_deal_id=${deal.id}`}>
                            Quote
                          </Link>
                        </Button>
                      </div>
                    </div>
                    <CrmDealSignalBadges deal={deal} />
                    {deal.expectedCloseOn && <p className="mt-1 text-xs text-[#475569]">Target close: {deal.expectedCloseOn}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

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
                entityLabel={contactName}
                showEntityLabel={false}
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
        subjectLabel={contactName}
        onSubmit={async (input) => {
          await createActivityMutation.mutateAsync(input);
        }}
      />
      <CrmContactEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        contact={contactQuery.data}
        onArchived={() => navigate("/crm/contacts")}
      />
    </div>
  );
}
