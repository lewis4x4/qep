import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, FileText, Plus } from "lucide-react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { UserRole } from "@/lib/database.types";
import { QrmActivityComposer } from "../components/QrmActivityComposer";
import { QrmActivityTimeline } from "../components/QrmActivityTimeline";
import { QrmDealEditorSheet } from "../components/QrmDealEditorSheet";
import { QrmDealEquipmentSection } from "../components/QrmDealEquipmentSection";
import { QrmDealUpdateCard } from "../components/QrmDealUpdateCard";
import { NeedsAssessmentCard } from "../components/NeedsAssessmentCard";
import { CadenceTimeline } from "../components/CadenceTimeline";
import { DemoRequestCard } from "../components/DemoRequestCard";
import { DgeIntelligencePanel } from "../../dge/components/DgeIntelligencePanel";
import { SopSuggestionWidget } from "../../sop/components/SopSuggestionWidget";
import { AskIronAdvisorButton } from "@/components/primitives";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { useCrmActivityBodyMutation } from "../hooks/useCrmActivityBodyMutation";
import { useCrmActivityDeliveryMutation } from "../hooks/useCrmActivityDeliveryMutation";
import { useCrmActivityOccurredAtMutation } from "../hooks/useCrmActivityOccurredAtMutation";
import { useCrmActivityTaskMutation } from "../hooks/useCrmActivityTaskMutation";
import { formatTimestamp, toDateTimeLocalValue, toIsoOrNull } from "../lib/deal-date";
import {
  createCrmActivity,
  listDealActivities,
  listCrmDealStages,
  patchCrmDeal,
} from "../lib/qrm-api";
import { dealCompositeQueryKey } from "../lib/deal-composite-keys";
import { fetchDealComposite } from "../lib/deal-composite-api";
import type { QrmDealPatchInput } from "../lib/types";

interface QrmDealDetailPageProps {
  userId: string;
  userRole: UserRole;
}

export function QrmDealDetailPage({ userId, userRole }: QrmDealDetailPageProps) {
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

  const compositeQuery = useQuery({
    queryKey: dealCompositeQueryKey(dealId!),
    queryFn: () => fetchDealComposite(dealId!),
    enabled: Boolean(dealId),
    staleTime: 30_000,
  });

  const stagesQuery = useQuery({
    queryKey: ["crm", "deal-stages"],
    queryFn: listCrmDealStages,
    staleTime: 60_000,
  });

  const activitiesQuery = useQuery({
    queryKey: ["crm", "deal", dealId, "activities"],
    queryFn: () => listDealActivities(dealId!),
    enabled: Boolean(dealId) && compositeQuery.isError,
  });

  useEffect(() => {
    if (compositeQuery.data?.activities) {
      queryClient.setQueryData(["crm", "deal", dealId, "activities"], compositeQuery.data.activities);
    }
  }, [compositeQuery.data, dealId, queryClient]);

  const dealQueryData = compositeQuery.data?.deal ?? null;
  const contactQueryData = compositeQuery.data?.contact ?? null;
  const companyQueryData = compositeQuery.data?.company ?? null;
  const lossFieldsData = isElevatedRole ? compositeQuery.data?.lossFields : null;

  const activitiesData = activitiesQuery.data ?? compositeQuery.data?.activities ?? [];

  useEffect(() => {
    if (!dealQueryData) return;
    setStageId(dealQueryData.stageId);
    setNextFollowUpInput(toDateTimeLocalValue(dealQueryData.nextFollowUpAt));
    setFormError(null);
  }, [dealQueryData?.id, dealQueryData?.stageId, dealQueryData?.nextFollowUpAt]);

  useEffect(() => {
    if (!isElevatedRole) return;
    setLossReason(lossFieldsData?.lossReason ?? "");
    setCompetitor(lossFieldsData?.competitor ?? "");
  }, [isElevatedRole, lossFieldsData?.lossReason, lossFieldsData?.competitor]);

  const selectedStage = useMemo(
    () => stagesQuery.data?.find((stage) => stage.id === stageId) ?? null,
    [stageId, stagesQuery.data],
  );

  const compositeInvalidate = dealId ? [dealCompositeQueryKey(dealId)] : [];

  const saveMutation = useMutation({
    mutationFn: (input: QrmDealPatchInput) => patchCrmDeal(dealId!, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dealCompositeQueryKey(dealId!) }),
        queryClient.invalidateQueries({ queryKey: ["crm", "contact", dealQueryData?.primaryContactId, "rep-safe-deals"] }),
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
      await queryClient.invalidateQueries({ queryKey: dealCompositeQueryKey(dealId!) });
    },
  });

  const activityHooksOpts = { extraInvalidateKeys: compositeInvalidate };

  const { pendingBodyId, patchBody } = useCrmActivityBodyMutation(
    ["crm", "deal", dealId, "activities"],
    activityHooksOpts,
  );
  const { pendingOccurredAtId, patchOccurredAt } = useCrmActivityOccurredAtMutation(
    ["crm", "deal", dealId, "activities"],
    activityHooksOpts,
  );
  const { pendingTaskId, patchTask } = useCrmActivityTaskMutation(
    ["crm", "deal", dealId, "activities"],
    activityHooksOpts,
  );
  const { pendingDeliveryId, deliverActivity } = useCrmActivityDeliveryMutation(
    ["crm", "deal", dealId, "activities"],
    activityHooksOpts,
  );

  if (!dealId) {
    return <Navigate to="/qrm/contacts" replace />;
  }

  async function handleSave(): Promise<void> {
    if (!dealQueryData) return;
    setFormError(null);

    const payload: QrmDealPatchInput = {};
    if (stageId && stageId !== dealQueryData.stageId) {
      payload.stageId = stageId;
    }

    const normalizedNextFollowUp = toIsoOrNull(nextFollowUpInput);
    const currentFollowUp = dealQueryData.nextFollowUpAt ? new Date(dealQueryData.nextFollowUpAt).toISOString() : null;
    if (normalizedNextFollowUp !== currentFollowUp) {
      payload.nextFollowUpAt = normalizedNextFollowUp;
      payload.followUpReminderSource = "deal_detail";
    }

    if (isElevatedRole && selectedStage?.isClosedLost) {
      const nextLossReason = lossReason.trim() || null;
      const nextCompetitor = competitor.trim() || null;
      const existingLossReason = lossFieldsData?.lossReason ?? null;
      const existingCompetitor = lossFieldsData?.competitor ?? null;

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

  const dealName = dealQueryData?.name ?? "deal";
  const isLoading = compositeQuery.isLoading;
  const hasError = compositeQuery.isError;
  const hasDeal = Boolean(dealQueryData);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-28 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/qrm/deals"
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
                dealQueryData?.primaryContactId ? `&contact_id=${dealQueryData.primaryContactId}` : ""
              }${dealQueryData?.companyId ? `&company_id=${dealQueryData.companyId}` : ""}`}
            >
              Ask Knowledge
            </Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link
              to={`/quote?crm_deal_id=${dealId}${
                dealQueryData?.primaryContactId ? `&crm_contact_id=${dealQueryData.primaryContactId}` : ""
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

      {isLoading && <div className="h-28 animate-pulse rounded-xl border border-border bg-card" />}
      {hasError && (
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">Unable to load this deal right now. Please refresh and try again.</p>
        </Card>
      )}
      {!isLoading && !hasError && !hasDeal && (
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">This deal isn&apos;t available or you don&apos;t have access.</p>
        </Card>
      )}

      {dealQueryData && (
        <>
          <div className="flex items-start justify-between gap-3">
            <QrmPageHeader title={dealQueryData.name} subtitle="Deal detail, follow-up cadence, and close controls." />
            <AskIronAdvisorButton contextType="deal" contextId={dealId} variant="inline" />
          </div>

          <SopSuggestionWidget
            entityType="deal"
            entityId={dealQueryData.id}
            stage={selectedStage?.name}
            department="sales"
            compact
          />

          <Card className="p-4 sm:p-5">
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="font-medium text-foreground">
                  {typeof dealQueryData.amount === "number" ? `$${dealQueryData.amount.toLocaleString()}` : "Amount TBD"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Closed at</dt>
                <dd className="font-medium text-foreground">{formatTimestamp(dealQueryData.closedAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Primary contact</dt>
                <dd className="font-medium text-foreground">
                  {contactQueryData ? (
                    <Link to={`/qrm/contacts/${contactQueryData.id}`}>
                      {contactQueryData.firstName} {contactQueryData.lastName}
                    </Link>
                  ) : (
                    "Not linked"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Company</dt>
                <dd className="font-medium text-foreground">
                  {companyQueryData ? (
                    <Link to={`/qrm/companies/${companyQueryData.id}`}>{companyQueryData.name}</Link>
                  ) : (
                    "Not linked"
                  )}
                </dd>
              </div>
            </dl>
          </Card>

          <QrmDealUpdateCard
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

          <NeedsAssessmentCard dealId={dealId!} prefetched={compositeQuery.data?.needsAssessment ?? null} />

          <CadenceTimeline dealId={dealId!} prefetched={compositeQuery.data?.cadences ?? null} />

          <DemoRequestCard dealId={dealId!} prefetched={compositeQuery.data?.demos ?? null} />

          <DgeIntelligencePanel dealId={dealId!} dealAmount={dealQueryData?.amount ?? undefined} userRole={userRole} />

          <QrmDealEquipmentSection dealId={dealId} companyId={dealQueryData?.companyId ?? null} />

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-semibold text-foreground">Activity Timeline</h2>
            </div>
            <QrmActivityTimeline
              activities={activitiesData}
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

      <QrmActivityComposer
        open={composerOpen}
        onOpenChange={setComposerOpen}
        isPending={createActivityMutation.isPending}
        subjectLabel={dealName}
        onSubmit={async (input) => {
          await createActivityMutation.mutateAsync(input);
        }}
      />
      <QrmDealEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        deal={dealQueryData}
        onArchived={() => navigate("/qrm/deals")}
      />
    </div>
  );
}
