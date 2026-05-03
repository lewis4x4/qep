import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { buildAccountCommandHref } from "../lib/account-command";
import { buildPostSaleExperienceBoard } from "../lib/post-sale-experience";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { DeckSurface, StatusDot, SignalChip } from "../components/command-deck";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function PostSaleExperienceCenterPage() {
  const boardQuery = useQuery({
    queryKey: ["qrm", "post-sale-experience"],
    queryFn: async () => {
      const [portalCustomersResult, fleetResult, serviceResult, docsResult, equipmentResult] = await Promise.all([
        supabase
          .from("portal_customers")
          .select("id, crm_company_id, crm_companies(name)")
          .not("crm_company_id", "is", null)
          .limit(1000),
        supabase
          .from("customer_fleet")
          .select("id, portal_customer_id, equipment_id, purchase_date, next_service_due, warranty_expiry")
          .eq("is_active", true)
          .limit(1000),
        supabase
          .from("service_jobs")
          .select("customer_id, machine_id, current_stage, created_at")
          .gte("created_at", new Date(Date.now() - 90 * 86_400_000).toISOString())
          .limit(1000),
        supabase
          .from("equipment_documents")
          .select("fleet_id, crm_equipment_id, document_type, portal_customer_id")
          .eq("customer_visible", true)
          .limit(1000),
        supabase
          .from("crm_equipment")
          .select("id, metadata")
          .limit(1000),
      ]);

      if (portalCustomersResult.error) throw new Error(portalCustomersResult.error.message);
      if (fleetResult.error) throw new Error(fleetResult.error.message);
      if (serviceResult.error) throw new Error(serviceResult.error.message);
      if (docsResult.error) throw new Error(docsResult.error.message);
      if (equipmentResult.error) throw new Error(equipmentResult.error.message);

      const companyByPortalCustomer = new Map<string, { companyId: string; companyName: string | null }>();
      for (const row of portalCustomersResult.data ?? []) {
        if (!row.crm_company_id) continue;
        const companyJoin = Array.isArray(row.crm_companies) ? row.crm_companies[0] : row.crm_companies;
        companyByPortalCustomer.set(row.id, {
          companyId: row.crm_company_id,
          companyName: companyJoin?.name ?? null,
        });
      }

      const attachmentCountByEquipment = new Map<string, number>();
      for (const row of equipmentResult.data ?? []) {
        const metadata = isRecord(row.metadata) ? row.metadata : {};
        const attachments = Array.isArray(metadata.attachments)
          ? metadata.attachments.filter((entry): entry is unknown => entry != null)
          : [];
        attachmentCountByEquipment.set(row.id, attachments.length);
      }

      const companyByFleet = new Map<string, { companyId: string; companyName: string | null }>();
      const companyByEquipment = new Map<string, { companyId: string; companyName: string | null }>();

      const fleetRows = (fleetResult.data ?? []).flatMap((row) => {
        const company = companyByPortalCustomer.get(row.portal_customer_id);
        if (!company) return [];
        companyByFleet.set(row.id, company);
        if (row.equipment_id) companyByEquipment.set(row.equipment_id, company);
        return [{
          companyId: company.companyId,
          companyName: company.companyName ?? "Account",
          fleetId: row.id,
          equipmentId: row.equipment_id,
          purchaseDate: row.purchase_date,
          nextServiceDue: row.next_service_due,
          warrantyExpiry: row.warranty_expiry,
          attachmentCount: row.equipment_id ? (attachmentCountByEquipment.get(row.equipment_id) ?? 0) : 0,
        }];
      });

      return buildPostSaleExperienceBoard({
        fleet: fleetRows,
        service: (serviceResult.data ?? []).map((row) => ({
          companyId: row.customer_id,
          machineId: row.machine_id,
          currentStage: row.current_stage,
          createdAt: row.created_at,
        })),
        documents: (docsResult.data ?? []).flatMap((row) => {
          const company = row.portal_customer_id
            ? companyByPortalCustomer.get(row.portal_customer_id)
            : row.fleet_id
              ? companyByFleet.get(row.fleet_id)
              : row.crm_equipment_id
                ? companyByEquipment.get(row.crm_equipment_id)
                : null;
          if (!company) return [];
          return [{
            companyId: company.companyId,
            fleetId: row.fleet_id,
            equipmentId: row.crm_equipment_id,
            documentType: row.document_type,
          }];
        }),
      });
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const board = boardQuery.data;
  const summary = board?.summary ?? { accounts: 0, frictionAccounts: 0, documentGapUnits: 0, attachmentGapUnits: 0 };

  // Cascading Iron briefing — route to the sharpest post-sale lever.
  const postSaleIronHeadline = boardQuery.isLoading
    ? "Scanning onboarding touches and fleet friction in the first 90 days…"
    : boardQuery.isError
      ? "Post-sale center offline. One of the feeders failed — check the console."
      : summary.frictionAccounts > 0
        ? `${summary.frictionAccounts} account${summary.frictionAccounts === 1 ? "" : "s"} carrying onboarding friction in the first 90 days — close the gap before it hardens into churn. ${summary.documentGapUnits} doc gap${summary.documentGapUnits === 1 ? "" : "s"}.`
        : summary.documentGapUnits > 0
          ? `${summary.documentGapUnits} recent unit${summary.documentGapUnits === 1 ? "" : "s"} missing visible onboarding docs — push them to portal to lift the first-90 experience.`
          : summary.attachmentGapUnits > 0
            ? `${summary.attachmentGapUnits} unit${summary.attachmentGapUnits === 1 ? "" : "s"} missing attachment records — close before the next service visit drifts.`
            : summary.accounts > 0
              ? `${summary.accounts} account${summary.accounts === 1 ? "" : "s"} in the first-90 window, clean onboarding. Protect the motion.`
              : "No recent post-sale accounts in the 90-day window.";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-12 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Post-Sale"
        subtitle="Onboarding quality, first-90-day friction, and attachment adoption across recently sold accounts."
        crumb={{ surface: "TODAY", lens: "POST-SALE", count: summary.accounts }}
        metrics={[
          { label: "Accounts", value: summary.accounts },
          { label: "Friction", value: summary.frictionAccounts, tone: summary.frictionAccounts > 0 ? "hot" : undefined },
          { label: "Doc gaps", value: summary.documentGapUnits, tone: summary.documentGapUnits > 0 ? "warm" : undefined },
          { label: "Attach gaps", value: summary.attachmentGapUnits, tone: summary.attachmentGapUnits > 0 ? "warm" : undefined },
        ]}
        ironBriefing={{
          headline: postSaleIronHeadline,
          actions: [{ label: "Portal fleet →", href: "/portal" }],
        }}
      />
      <QrmSubNav />

      {boardQuery.isLoading ? (
        <DeckSurface className="p-6 text-sm text-muted-foreground">Loading post-sale experience…</DeckSurface>
      ) : boardQuery.isError || !board ? (
        <DeckSurface className="border-qep-hot/40 bg-qep-hot/5 p-6 text-sm text-qep-hot">
          {boardQuery.error instanceof Error ? boardQuery.error.message : "Post-sale experience is unavailable right now."}
        </DeckSurface>
      ) : (
        <DeckSurface className="p-3 sm:p-4">
          <div>
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">First-90 accounts</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Ranked by first-90-day friction so the team can close onboarding gaps before they harden.
            </p>
          </div>
          <div className="mt-3 divide-y divide-qep-deck-rule/40 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/30">
            {board.accounts.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No recent post-sale accounts are active right now.</p>
            ) : (
              board.accounts.slice(0, 12).map((row) => {
                const tone = row.openServiceTouches > 0 ? "hot" : row.overdueDueCount > 0 ? "warm" : row.attachmentGapCount > 0 ? "active" : "cool";
                return (
                  <Link
                    key={row.companyId}
                    to={buildAccountCommandHref(row.companyId)}
                    className="group flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-qep-orange/[0.04]"
                  >
                    <StatusDot tone={tone} pulse={tone === "hot"} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-foreground">{row.companyName}</p>
                      <p className="mt-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                        {row.recentUnits} unit{row.recentUnits === 1 ? "" : "s"} · {row.serviceTouches} service touch{row.serviceTouches === 1 ? "" : "es"}
                        {row.openServiceTouches > 0 ? ` · ${row.openServiceTouches} open` : ""}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {row.overdueDueCount > 0 && (
                          <SignalChip label="Due risk" value={row.overdueDueCount} tone="warm" />
                        )}
                        {row.attachmentGapCount > 0 && (
                          <SignalChip label="Attach gap" value={row.attachmentGapCount} tone="active" />
                        )}
                        <SignalChip label="Docs" value={`${row.docCoverageCount}/${row.recentUnits}`} tone={row.docCoverageCount < row.recentUnits ? "warm" : "live"} />
                      </div>
                    </div>
                    <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-qep-orange" />
                  </Link>
                );
              })
            )}
          </div>
          {board.accounts.length > 12 && (
            <div className="mt-2 flex items-center justify-between px-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                12 / {board.accounts.length.toLocaleString()} shown
              </p>
              <Button asChild size="sm" variant="outline" className="h-8 px-2 font-mono text-[11px] uppercase tracking-[0.1em]">
                <Link to="/portal">
                  Portal fleet <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          )}
        </DeckSurface>
      )}
    </div>
  );
}
