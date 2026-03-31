import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, FileText, Plus } from "lucide-react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { UserRole } from "@/lib/database.types";
import { CrmActivityComposer } from "../components/CrmActivityComposer";
import { CrmActivityTimeline } from "../components/CrmActivityTimeline";
import { CrmDealEditorSheet } from "../components/CrmDealEditorSheet";
import { CrmDealUpdateCard } from "../components/CrmDealUpdateCard";
import { CrmPageHeader } from "../components/CrmPageHeader";
import { useCrmActivityBodyMutation } from "../hooks/useCrmActivityBodyMutation";
import { useCrmActivityDeliveryMutation } from "../hooks/useCrmActivityDeliveryMutation";
import { useCrmActivityOccurredAtMutation } from "../hooks/useCrmActivityOccurredAtMutation";
import { useCrmActivityTaskMutation } from "../hooks/useCrmActivityTaskMutation";
import { formatTimestamp, toDateTimeLocalValue, toIsoOrNull } from "../lib/deal-date";
import {
  createCrmActivity,
  getCrmCompany,
  getCrmContact,
  getCrmDeal,
  getCrmDealLossFields,
  listCrmDealStages,
  listDealActivities,
  patchCrmDeal,
} from "../lib/crm-api";
import type { CrmDealPatchInput } from "../lib/types";

interface CrmDealDetailPageProps {
  userId: string;
  userRole: UserRole;
}

export function CrmDealDetailPage({ userId, userRole }: CrmDealDetailPageProps) {
  const { dealId } = useParams<{ dealId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isElevatedRole = userRole === "admin" || userRole === "manager" || userRole === "owner";

  const [composerOpen, setComposerOpen] = useState(false);
  const [stageId, setStageId] = useState("");
  const [nextFollowUpInput, setNextFollowUpInput] = useState("");
  const [lossReason, setLossReason] = useState("");
  const [competitor, setCompetitor] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!dealId) {
    return <Navigate to="/crm/contacts" replace />;
  }

  const dealQuery = useQuery({
    queryKey: ["crm", "deal", dealId],
    queryFn: () => getCrmDeal(dealId),
  });

  const stagesQuery = useQuery({
    queryKey: ["crm", "deal-stages"],
    queryFn: listCrmDealStages,
    staleTime: 60_000,
  });

  const activitiesQuery = useQuery({
    queryKey: ["crm", "deal", dealId, "activities"],
    queryFn: () => listDealActivities(dealId),
    enabled: dealQuery.data !== null,
  });

  const lossFieldsQuery = useQuery({
    queryKey: ["crm", "deal", dealId, "loss-fields"],
    queryFn: () => getCrmDealLossFields(dealId),
    enabled: isElevatedRole && dealQuery.data !== null,
    staleTime: 60_000,
  });

  const contactQuery = useQuery({
    queryKey: ["crm", "contact", dealQuery.data?.primaryContactId],
    queryFn: () => getCrmContact(dealQuery.data?.primaryContactId ?? ""),
    enabled: Boolean(dealQuery.data?.primaryContactId),
  });

  const companyQuery = useQuery({
    queryKey: ["crm", "company", dealQuery.data?.companyId],
    queryFn: () => getCrmCompany(dealQuery.data?.companyId ?? ""),
    enabled: Boolean(dealQuery.data?.companyId),
  });

  useEffect(() => {
    if (!dealQuery.data) return;
    setStageId(dealQuery.data.stageId);
    setNextFollowUpInput(toDateTimeLocalValue(dealQuery.data.nextFollowUpAt));
    setFormError(null);
  }, [dealQuery.data?.id, dealQuery.data?.stageId, dealQuery.data?.nextFollowUpAt]);

  useEffect(() => {
    if (!isElevatedRole) return;
    setLossReason(lossFieldsQuery.data?.lossReason ?? "");
    setCompetitor(lossFieldsQuery.data?.competitor ?? "");
  }, [isElevatedRole, lossFieldsQuery.data?.lossReason, lossFieldsQuery.data?.competitor]);

  const selectedStage = useMemo(
    () => stagesQuery.data?.find((stage) => stage.id === stageId) ?? null,
    [stageId, stagesQuery.data]
  );

  const saveMutation = useMutation({
    mutationFn: (input: CrmDealPatchInput) => patchCrmDeal(dealId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["crm", "deal", dealId] }),
        queryClient.invalidateQueries({ queryKey: ["crm", "contact", dealQuery.data?.primaryContactId, "rep-safe-deals"] }),
        queryClient.invalidateQueries({ queryKey: ["crm", "deal", dealId, "loss-fields"] }),
      ]);
      setFormError(null);
    },
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
    }) =>
      createCrmActivity({ ...input, dealId }, userId),
    onSuccess: async () => {
      setComposerOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["crm", "deal", dealId, "activities"] });
    },
  });

  const { pendingBodyId, patchBody } = useCrmActivityBodyMutation(["crm", "deal", dealId, "activities"]);
  const { pendingOccurredAtId, patchOccurredAt } = useCrmActivityOccurredAtMutation(["crm", "deal", dealId, "activities"]);
  const { pendingTaskId, patchTask } = useCrmActivityTaskMutation(["crm", "deal", dealId, "activities"]);
  const { pendingDeliveryId, deliverActivity } = useCrmActivityDeliveryMutation([
    "crm",
    "deal",
    dealId,
    "activities",
  ]);

  async function handleSave(): Promise<void> {
    if (!dealQuery.data) return;
    setFormError(null);

    const payload: CrmDealPatchInput = {};
    if (stageId && stageId !== dealQuery.data.stageId) {
      payload.stageId = stageId;
    }

    const normalizedNextFollowUp = toIsoOrNull(nextFollowUpInput);
    const currentFollowUp = dealQuery.data.nextFollowUpAt ? new Date(dealQuery.data.nextFollowUpAt).toISOString() : null;
    if (normalizedNextFollowUp !== currentFollowUp) {
      payload.nextFollowUpAt = normalizedNextFollowUp;
    }

    if (isElevatedRole && selectedStage?.isClosedLost) {
      const nextLossReason = lossReason.trim() || null;
      const nextCompetitor = competitor.trim() || null;
      const existingLossReason = lossFieldsQuery.data?.lossReason ?? null;
      const existingCompetitor = lossFieldsQuery.data?.competitor ?? null;

      if (!nextLossReason && !existingLossReason) {
        setFormError("Loss reason is required when the deal is moved to Closed Lost.");
        return;
      }

      if (nextLossReason !== existingLossReason) {
        payload.lossReason = nextLossReason;
      }
      if (nextCompetitor !== existingCompetitor) {
        payload.competitor = nextCompetitor;
      }
    }

    if (Object.keys(payload).length === 0) {
      return;
    }

    await saveMutation.mutateAsync(payload);
  }

  const dealName = dealQuery.data?.name ?? "deal";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-28 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/crm/deals"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-input bg-card px-3 text-sm text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to deals
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setEditorOpen(true)}>
            Edit Deal
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link
              to={`/chat?deal_id=${dealId}${
                dealQuery.data?.primaryContactId ? `&contact_id=${dealQuery.data.primaryContactId}` : ""
              }${dealQuery.data?.companyId ? `&company_id=${dealQuery.data.companyId}` : ""}`}
            >
              Ask Knowledge
            </Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link
              to={`/quote?crm_deal_id=${dealId}${
                dealQuery.data?.primaryContactId ? `&crm_contact_id=${dealQuery.data.primaryContactId}` : ""
              }`}
            >
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

      {dealQuery.isLoading && <div className="h-28 animate-pulse rounded-xl border border-border bg-card" />}
      {dealQuery.isError && (
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">Unable to load this deal right now. Please refresh and try again.</p>
        </Card>
      )}
      {!dealQuery.isLoading && !dealQuery.isError && !dealQuery.data && (
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">This deal isn&apos;t available or you don&apos;t have access.</p>
        </Card>
      )}

      {dealQuery.data && (
        <>
          <CrmPageHeader title={dealQuery.data.name} subtitle="Deal detail, follow-up cadence, and close controls." />

          <Card className="p-4 sm:p-5">
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="font-medium text-foreground">
                  {typeof dealQuery.data.amount === "number" ? `$${dealQuery.data.amount.toLocaleString()}` : "Amount TBD"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Closed at</dt>
                <dd className="font-medium text-foreground">{formatTimestamp(dealQuery.data.closedAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Primary contact</dt>
                <dd className="font-medium text-foreground">
                  {contactQuery.data ? <Link to={`/crm/contacts/${contactQuery.data.id}`}>{contactQuery.data.firstName} {contactQuery.data.lastName}</Link> : "Not linked"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Company</dt>
                <dd className="font-medium text-foreground">
                  {companyQuery.data ? <Link to={`/crm/companies/${companyQuery.data.id}`}>{companyQuery.data.name}</Link> : "Not linked"}
                </dd>
              </div>
            </dl>
          </Card>

          <CrmDealUpdateCard
            stages={stagesQuery.data ?? []}
            stageId={stageId}
            setStageId={setStageId}
            nextFollowUpInput={nextFollowUpInput}
            setNextFollowUpInput={setNextFollowUpInput}
            isElevatedRole={isElevatedRole}
            showClosedLostFields={Boolean(selectedStage?.isClosedLost)}
            lossReason={lossReason}
            setLossReason={setLossReason}
            competitor={competitor}
            setCompetitor={setCompetitor}
            formError={formError}
            saveError={saveMutation.isError}
            savePending={saveMutation.isPending}
            stagesLoading={stagesQuery.isLoading}
            onSave={() => void handleSave()}
          />

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-semibold text-foreground">Activity Timeline</h2>
            </div>
            {activitiesQuery.isLoading ? (
              <div className="space-y-3" role="status" aria-label="Loading activities">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="h-24 animate-pulse rounded-xl border border-border bg-card" />
                ))}
              </div>
            ) : activitiesQuery.isError ? (
              <Card className="p-4 text-sm text-muted-foreground">Couldn&apos;t load activities for this deal.</Card>
            ) : (
              <CrmActivityTimeline
                activities={activitiesQuery.data ?? []}
                onLogActivity={() => setComposerOpen(true)}
                entityLabel={dealName}
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
        subjectLabel={dealName}
        onSubmit={async (input) => {
          await createActivityMutation.mutateAsync(input);
        }}
      />
      <CrmDealEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        deal={dealQuery.data}
        onArchived={() => navigate("/crm/deals")}
      />
    </div>
  );
}
