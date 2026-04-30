import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, GitMerge, Loader2, Plus } from "lucide-react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { UserRole } from "@/lib/database.types";
import { QrmActivityComposer } from "../components/QrmActivityComposer";
import { QrmActivityTimeline } from "../components/QrmActivityTimeline";
import { QrmCompanyEditorSheet } from "../components/QrmCompanyEditorSheet";
import { QrmCompanyEquipmentSection } from "../components/QrmCompanyEquipmentSection";
import { QrmCompanyHierarchyCard } from "../components/QrmCompanyHierarchyCard";
import { QrmCompanyShipToSection } from "../components/QrmCompanyShipToSection";
import { QrmCompanySubtreeEquipmentSection } from "../components/QrmCompanySubtreeEquipmentSection";
import { QrmCustomFieldsCard } from "../components/QrmCustomFieldsCard";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { AskIronAdvisorButton } from "@/components/primitives";
import { DeckSurface } from "../components/command-deck";
import { fetchAccount360 } from "../lib/account-360-api";
import { buildAccountCommandHref, buildAccountTimelineHref } from "../lib/account-command";
import {
  AccountNextBestActions,
  AccountCommercialTab,
  AccountFleetTab,
  AccountIntelliDealerTab,
  AccountQuotesTab,
  AccountServiceTab,
  AccountPartsTab,
  AccountARTab,
} from "../components/Account360Tabs";
import { HealthScoreDrawer } from "../../nervous-system/components/HealthScoreDrawer";
import { HealthScorePill } from "../../nervous-system/components/HealthScorePill";
import { ARCreditBlockBanner } from "../components/ARCreditBlockBanner";
import { CustomerPartsIntelCard } from "../../parts/components/CustomerPartsIntelCard";
import { useCrmActivityBodyMutation } from "../hooks/useCrmActivityBodyMutation";
import { useCrmActivityDeliveryMutation } from "../hooks/useCrmActivityDeliveryMutation";
import { useCrmActivityOccurredAtMutation } from "../hooks/useCrmActivityOccurredAtMutation";
import { useCrmActivityTaskMutation } from "../hooks/useCrmActivityTaskMutation";
import {
  createCrmActivity,
  getCrmCompany,
  getProfileDisplayName,
  listCrmCompanies,
  listCompanyActivities,
} from "../lib/qrm-api";
import { fetchCompanyHierarchy, updateCompanyParent } from "../lib/qrm-router-api";
import type { QrmActivityItem } from "../lib/types";

interface QrmCompanyDetailPageProps {
  userId: string;
  userRole: UserRole;
}

export function QrmCompanyDetailPage({ userId, userRole }: QrmCompanyDetailPageProps) {
  const { companyId } = useParams<{ companyId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [composerOpen, setComposerOpen] = useState(false);
  const [hierarchyEditorOpen, setHierarchyEditorOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [parentSearchInput, setParentSearchInput] = useState("");
  const [parentSearch, setParentSearch] = useState("");
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [hierarchyError, setHierarchyError] = useState<string | null>(null);
  const [account360Tab, setAccount360Tab] = useState<"commercial" | "fleet" | "quotes" | "service" | "parts" | "ar" | "intellidealer" | "lifecycle">("commercial");
  const [healthDrawerOpen, setHealthDrawerOpen] = useState(false);

  const account360Query = useQuery({
    queryKey: ["account-360", companyId],
    queryFn: () => fetchAccount360(companyId!),
    enabled: !!companyId,
    staleTime: 30_000,
  });

  const companyQuery = useQuery({
    queryKey: ["crm", "company", companyId],
    queryFn: () => getCrmCompany(companyId!),
    enabled: Boolean(companyId),
  });

  const hierarchyQuery = useQuery({
    queryKey: ["crm", "company", companyId, "hierarchy"],
    queryFn: () => fetchCompanyHierarchy(companyId!),
    enabled: Boolean(companyId) && Boolean(companyQuery.data),
  });

  const activitiesQuery = useQuery({
    queryKey: ["crm", "company", companyId, "activities"],
    queryFn: () => listCompanyActivities(companyId!),
    enabled: Boolean(companyId) && companyQuery.data !== null,
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
    }) => createCrmActivity({ ...input, companyId: companyId! }, userId),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["crm", "company", companyId, "activities"] });
      const previous = queryClient.getQueryData<QrmActivityItem[]>(["crm", "company", companyId, "activities"]) ?? [];
      const optimistic: QrmActivityItem = {
        id: `optimistic-${Date.now()}`,
        workspaceId: "default",
        activityType: input.activityType,
        body: input.body,
        occurredAt: input.occurredAt,
        contactId: null,
        companyId: companyId!,
        dealId: null,
        createdBy: userId,
        metadata: input.task ? { task: input.task } : {},
        createdAt: input.occurredAt,
        updatedAt: input.occurredAt,
        isOptimistic: true,
      };

      queryClient.setQueryData<QrmActivityItem[]>(["crm", "company", companyId, "activities"], [optimistic, ...previous]);
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

  const { pendingBodyId, patchBody } = useCrmActivityBodyMutation(["crm", "company", companyId, "activities"]);
  const { pendingOccurredAtId, patchOccurredAt } = useCrmActivityOccurredAtMutation(["crm", "company", companyId, "activities"]);
  const { pendingTaskId, patchTask } = useCrmActivityTaskMutation(["crm", "company", companyId, "activities"]);
  const { pendingDeliveryId, deliverActivity } = useCrmActivityDeliveryMutation([
    "crm",
    "company",
    companyId,
    "activities",
  ]);

  const hierarchyMutation = useMutation({
    mutationFn: (nextParentId: string | null) => updateCompanyParent(companyId!, nextParentId),
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
    if (location.hash !== "#company-subtree-equipment") return;
    if (!companyQuery.data) return;
    const el = document.getElementById("company-subtree-equipment");
    if (!el) return;
    const timer = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [location.hash, location.pathname, companyQuery.data]);

  useEffect(() => {
    if (!hierarchyEditorOpen || !companyQuery.data) return;
    setSelectedParentId(companyQuery.data.parentCompanyId);
    setParentSearchInput("");
    setParentSearch("");
    setHierarchyError(null);
  }, [hierarchyEditorOpen, companyQuery.data?.id, companyQuery.data?.parentCompanyId]);

  if (!companyId) {
    return <Navigate to="/qrm/companies" replace />;
  }

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
        search1: null,
        search2: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        postalCode: null,
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
  const companyWhatMattersNow = !companyQuery.data
    ? "Account context is loading."
    : account360Query.data?.health?.current_score != null
      ? `Health score is ${Number(account360Query.data.health.current_score).toFixed(0)} and should guide the operating posture.`
      : "No health read is available yet for this account."
  const companyNextMove = !companyQuery.data
    ? "Wait for the account to load."
    : account360Query.data?.ar_block
      ? "Resolve the AR block or protect the next commercial move accordingly."
      : "Use next-best actions and fresh activity to move the account forward now."
  const companyRiskIfIgnored = !companyQuery.data
    ? "No risk available yet."
    : account360Query.data?.ar_block
      ? "Commercial momentum can stall behind unresolved AR pressure."
      : "Without a visible next move, the account becomes a passive record instead of an operating surface."
  const companyActivitySummary = activitiesQuery.isLoading
    ? "Activity is loading."
    : (activitiesQuery.data?.length ?? 0) > 0
      ? `${activitiesQuery.data?.length ?? 0} recent activity item${(activitiesQuery.data?.length ?? 0) === 1 ? "" : "s"} are already on the record.`
      : "No recent activity is logged on this account."
  const companyActionPrompt = (activitiesQuery.data?.length ?? 0) > 0
    ? "Use the latest activity thread to decide the next owner touch before opening lower panels."
    : "Log the next meaningful touch now so the account has visible momentum."
  const canManageDefinitions = userRole === "admin" || userRole === "owner";
  const canManageHierarchy = userRole === "admin" || userRole === "manager" || userRole === "owner";
  const canManageEin = userRole === "admin" || userRole === "manager" || userRole === "owner";
  const account360Company = account360Query.data?.company;
  const hasEinValue = Boolean(account360Company && Object.prototype.hasOwnProperty.call(account360Company, "ein"));
  const einValue = hasEinValue ? account360Company?.ein ?? null : undefined;
  const einMasked = Boolean(account360Company?.ein_masked);
  const einDisplayValue = einValue === undefined
    ? (account360Query.isLoading ? "Loading..." : "Not available")
    : einValue ?? "Not recorded";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-28 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="outline" className="min-h-[44px] gap-2">
          <Link to="/qrm/companies">
            <ArrowLeft className="h-4 w-4" />
            Back to companies
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountCommandHref(companyId)}>
              Open Command Center
            </Link>
          </Button>
          <Button variant="outline" onClick={() => setEditorOpen(true)}>
            Edit Company
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={`/chat?company_id=${companyId}`}>
              Ask Knowledge
            </Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to="/admin/duplicates">
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

      {companyQuery.isLoading && (
        <DeckSurface className="h-28 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
      )}

      {companyQuery.isError && (
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Unable to load this company. Refresh the page or go back to your companies list.
          </p>
        </DeckSurface>
      )}

      {!companyQuery.isLoading && !companyQuery.isError && !companyQuery.data && (
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            This company isn&apos;t available. It may have been removed or you might not have access.
          </p>
        </DeckSurface>
      )}

      {companyQuery.data && (
        <>
          <div className="flex items-start justify-between gap-3">
            <QrmPageHeader title={companyQuery.data.name} subtitle={locationLabel} />
            <div className="flex items-center gap-2">
              <HealthScorePill
                score={account360Query.data?.health?.current_score != null ? Number(account360Query.data.health.current_score) : null}
                delta7d={account360Query.data?.health?.delta_7d != null ? Number(account360Query.data.health.delta_7d) : null}
                size="md"
                onClick={() => setHealthDrawerOpen(true)}
              />
              <AskIronAdvisorButton contextType="company" contextId={companyId} variant="inline" />
            </div>
          </div>

          {/* AR credit block banner with embedded override dialog (Phase D) */}
          {account360Query.data?.ar_block && (
            <ARCreditBlockBanner
              block={account360Query.data.ar_block}
              currentUserId={userId}
              currentUserRole={userRole}
              onOverridden={() => account360Query.refetch()}
            />
          )}

          {/* Recommended Next Best Actions composite */}
          {account360Query.data && (
            <AccountNextBestActions data={account360Query.data} />
          )}

          {/* Account 360 tabs */}
          {account360Query.data && (
            <DeckSurface>
              <div className="border-b border-qep-deck-rule/60 pb-2">
                <div role="tablist" className="flex flex-wrap gap-1">
                  {[
                    { key: "commercial", label: "Commercial" },
                    { key: "fleet",     label: `Fleet (${account360Query.data.fleet.length})` },
                    { key: "quotes",    label: `Open Quotes (${account360Query.data.open_quotes.length})` },
                    { key: "service",   label: `Service (${account360Query.data.service.length})` },
                    { key: "parts",     label: `Parts ($${(account360Query.data.parts.lifetime_total ?? 0).toLocaleString()})` },
                    { key: "ar",        label: `Invoices / AR (${account360Query.data.invoices.length})` },
                    { key: "intellidealer", label: "IntelliDealer" },
                    { key: "lifecycle", label: "Lifecycle" },
                  ].map((t) => {
                    const isActive = t.key === account360Tab;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => setAccount360Tab(t.key as typeof account360Tab)}
                        className={`rounded-sm px-3 py-2 text-xs font-medium transition-colors ${
                          isActive
                            ? "bg-qep-orange/10 text-qep-orange"
                            : "text-muted-foreground hover:bg-qep-deck-elevated/30 hover:text-foreground"
                        }`}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-4">
                {account360Tab === "commercial" && <AccountCommercialTab data={account360Query.data} companyId={companyId!} />}
                {account360Tab === "fleet"   && <AccountFleetTab fleet={account360Query.data.fleet} companyId={companyId!} />}
                {account360Tab === "quotes"  && <AccountQuotesTab quotes={account360Query.data.open_quotes} />}
                {account360Tab === "service" && <AccountServiceTab service={account360Query.data.service} />}
                {account360Tab === "parts"   && <AccountPartsTab parts={account360Query.data.parts} />}
                {account360Tab === "ar"      && <AccountARTab invoices={account360Query.data.invoices} arBlock={account360Query.data.ar_block} />}
                {account360Tab === "intellidealer" && <AccountIntelliDealerTab companyId={companyId!} />}
                {account360Tab === "lifecycle" && (
                  <DeckSurface className="border-qep-deck-rule/60 bg-qep-deck-elevated/40 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">Customer lifecycle</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Multi-year customer arc — first contact → first quote → first purchase → first service, plus any NPS / churn / won-back milestones.
                        </p>
                      </div>
                      <Button asChild size="sm" variant="outline" className="h-7 text-[10px]">
                        <Link to={buildAccountTimelineHref(companyId)}>
                          Open timeline →
                        </Link>
                      </Button>
                    </div>
                  </DeckSurface>
                )}
              </div>
            </DeckSurface>
          )}

          <HealthScoreDrawer
            customerProfileId={(account360Query.data?.profile?.id as string | undefined) ?? null}
            open={healthDrawerOpen}
            onOpenChange={setHealthDrawerOpen}
          />

          <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-4 sm:p-5">
            <div className="mb-3 border-b border-qep-deck-rule/60 pb-2">
              <h3 className="text-sm font-semibold text-foreground">Tax / Regulatory</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Federal identity fields used for 1099, AvaTax exemption, and OFAC screening.
              </p>
            </div>
            <dl className="mb-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Federal EIN</dt>
                <dd className="font-medium text-foreground">
                  {einDisplayValue}
                </dd>
                {einMasked ? (
                  <p className="mt-1 text-xs text-muted-foreground">Masked for unauthorized roles.</p>
                ) : null}
              </div>
            </dl>
            <dl className="grid grid-cols-1 gap-3 border-t border-qep-deck-rule/60 pt-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Assigned rep</dt>
                <dd className="font-medium text-foreground">
                  {assignedRepQuery.data || (companyQuery.data.assignedRepId ? "Assigned representative" : "Unassigned")}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last updated</dt>
                <dd className="font-medium text-foreground">
                  {new Date(companyQuery.data.updatedAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </dd>
              </div>
            </dl>
          </DeckSurface>

          {hierarchyQuery.isLoading && (
            <DeckSurface className="h-28 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
          )}
          {!hierarchyQuery.isLoading && hierarchyQuery.data && (
            <div className="space-y-3">
              <QrmCompanyHierarchyCard hierarchy={hierarchyQuery.data} companyId={companyId} />

              {canManageHierarchy && (
                <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-4 sm:p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Hierarchy controls</h3>
                      <p className="text-sm text-muted-foreground">
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
                    <p className="text-sm text-muted-foreground">
                      Current parent:{" "}
                      <span className="font-medium text-foreground">
                        {currentParentNode?.name ?? "Top-level company"}
                      </span>
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <label
                        className="block text-sm font-medium text-foreground"
                        htmlFor="crm-parent-company-search"
                      >
                        Search parent company
                      </label>
                      <input
                        id="crm-parent-company-search"
                        value={parentSearchInput}
                        onChange={(event) => setParentSearchInput(event.target.value)}
                        placeholder="Search companies by name, city, or state"
                        className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
                      />

                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => setSelectedParentId(null)}
                          className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                            selectedParentId === null
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-border bg-card text-foreground hover:border-primary/50 hover:bg-accent/30"
                          }`}
                        >
                          Top-level company (no parent)
                        </button>

                        {parentOptionsQuery.isLoading ? (
                          <div className="h-12 animate-pulse rounded-md border border-border bg-muted/40" />
                        ) : availableParentOptions.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No eligible parent companies found for this search.
                          </p>
                        ) : (
                          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                            {availableParentOptions.map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => setSelectedParentId(option.id)}
                                className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                                  selectedParentId === option.id
                                    ? "border-primary bg-primary/15 text-primary"
                                    : "border-border bg-card text-foreground hover:border-primary/50 hover:bg-accent/30"
                                }`}
                              >
                                <span className="font-medium">{option.name}</span>
                                <span className="ml-2 text-xs text-muted-foreground">
                                  {[option.city, option.state].filter(Boolean).join(", ") || "No location"}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {hierarchyError && <p className="text-sm text-destructive">{hierarchyError}</p>}

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
                </DeckSurface>
              )}
            </div>
          )}

          <QrmCompanySubtreeEquipmentSection companyId={companyId} />
          <QrmCompanyShipToSection companyId={companyId} />
          <QrmCompanyEquipmentSection companyId={companyId} />
          <QrmCustomFieldsCard
            recordType="company"
            recordId={companyId}
            canManageDefinitions={canManageDefinitions}
          />

          <CustomerPartsIntelCard companyId={companyId} />

          <DeckSurface>
            <div className="flex items-start justify-between gap-3 border-b border-qep-deck-rule/60 pb-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Activity Timeline</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  The last touches tied to this account across calls, notes, meetings, and messages.
                </p>
              </div>
              <Button asChild size="sm" variant="ghost">
                <Link to={buildAccountCommandHref(companyId)}>Open command center</Link>
              </Button>
            </div>

            {activitiesQuery.isLoading ? (
              <div className="space-y-3 mt-4" role="status" aria-label="Loading activities">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-24 animate-pulse rounded-sm border border-qep-deck-rule bg-qep-deck-elevated/40"
                  />
                ))}
              </div>
            ) : activitiesQuery.isError ? (
              <div className="border-qep-deck-rule/60 bg-qep-deck-elevated/40 p-4 text-sm text-muted-foreground mt-4 rounded-sm">
                Couldn&apos;t load activities. Try refreshing the page.
              </div>
            ) : (
              <div className="mt-4">
                <QrmActivityTimeline
                  activities={activitiesQuery.data ?? []}
                  onLogActivity={() => setComposerOpen(true)}
                  entityLabel={companyName}
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
              </div>
            )}
          </DeckSurface>
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
        subjectLabel={companyName}
        onSubmit={async (input) => {
          await createActivityMutation.mutateAsync(input);
        }}
      />
      <QrmCompanyEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        company={companyQuery.data ? { ...companyQuery.data, ein: einValue, einMasked } : companyQuery.data}
        canManageEin={canManageEin}
        onArchived={() => navigate("/qrm/companies")}
      />
    </div>
  );
}
