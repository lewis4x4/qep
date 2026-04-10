import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BookOpen, ArrowUpRight, LifeBuoy, PackagePlus, Wrench } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { buildAccountCommandHref } from "../lib/account-command";
import { buildPostSaleExperienceBoard } from "../lib/post-sale-experience";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";

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
        const metadata = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;
        const attachments = Array.isArray(metadata.attachments)
          ? metadata.attachments.filter((entry): entry is unknown => entry != null)
          : [];
        attachmentCountByEquipment.set(row.id, attachments.length);
      }

      return buildPostSaleExperienceBoard({
        fleet: (fleetResult.data ?? []).flatMap((row) => {
          const company = companyByPortalCustomer.get(row.portal_customer_id);
          if (!company) return [];
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
        }),
        service: (serviceResult.data ?? []).map((row) => ({
          companyId: row.customer_id,
          machineId: row.machine_id,
          currentStage: row.current_stage,
          createdAt: row.created_at,
        })),
        documents: (docsResult.data ?? []).flatMap((row) => {
          const company = row.portal_customer_id ? companyByPortalCustomer.get(row.portal_customer_id) : null;
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

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Post-Sale Experience Center"
        subtitle="Onboarding quality, first-90-day friction, and attachment adoption across recently sold accounts."
      />
      <QrmSubNav />

      {boardQuery.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading post-sale experience…</Card>
      ) : boardQuery.isError || !board ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {boardQuery.error instanceof Error ? boardQuery.error.message : "Post-sale experience is unavailable right now."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard icon={LifeBuoy} label="Accounts" value={String(board.summary.accounts)} detail="Accounts with fleet purchased in the last 90 days." />
            <SummaryCard icon={Wrench} label="Friction" value={String(board.summary.frictionAccounts)} detail="Accounts with service, due-service, or adoption friction." />
            <SummaryCard icon={BookOpen} label="Doc Gaps" value={String(board.summary.documentGapUnits)} detail="Recent units missing visible onboarding docs." />
            <SummaryCard icon={PackagePlus} label="Attachment Gaps" value={String(board.summary.attachmentGapUnits)} detail="Recent units with no attachments registered." />
          </div>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">First-90 accounts</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Accounts ranked by first-90-day friction so the team can close onboarding gaps before they harden.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/portal">
                  Portal fleet <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              {board.accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent post-sale accounts are active right now.</p>
              ) : (
                board.accounts.slice(0, 12).map((row) => (
                  <div key={row.companyId} className="rounded-xl border border-border/60 bg-muted/10 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{row.companyName}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {row.recentUnits} recent unit{row.recentUnits === 1 ? "" : "s"} · {row.serviceTouches} service touch{row.serviceTouches === 1 ? "" : "es"}
                          {row.openServiceTouches > 0 ? ` · ${row.openServiceTouches} open` : ""}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {row.overdueDueCount} due-service risk · {row.docCoverageCount}/{row.recentUnits} units with visible docs · {row.attachmentGapCount} attachment gaps
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        <Button asChild size="sm" variant="ghost">
                          <Link to={buildAccountCommandHref(row.companyId)}>
                            Account <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-qep-orange" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}
