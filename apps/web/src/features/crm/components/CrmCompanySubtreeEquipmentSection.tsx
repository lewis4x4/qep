import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { fetchCompanySubtreeEquipment } from "../lib/crm-router-api";

interface CrmCompanySubtreeEquipmentSectionProps {
  companyId: string;
}

export function CrmCompanySubtreeEquipmentSection({ companyId }: CrmCompanySubtreeEquipmentSectionProps) {
  const query = useQuery({
    queryKey: ["crm", "company", companyId, "equipment-subtree"],
    queryFn: () => fetchCompanySubtreeEquipment(companyId),
    staleTime: 15_000,
  });

  return (
    <section
      id="company-subtree-equipment"
      className="scroll-mt-24"
      aria-label="Equipment across company tree"
    >
      <Card className="space-y-3 border-border bg-card p-4 sm:p-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">Equipment (company tree)</h2>
          <p className="text-sm text-muted-foreground">
            Assets on this account and all child companies — same scope as the hierarchy roll-up count.
          </p>
        </div>

        {query.isLoading && <div className="h-12 animate-pulse rounded bg-muted/40" />}
        {query.isError && (
          <p className="text-sm text-destructive">Couldn&apos;t load roll-up equipment.</p>
        )}

        {!query.isLoading && !query.isError && (query.data?.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground">No equipment in this company tree yet.</p>
        )}

        {!query.isLoading && !query.isError && (query.data?.length ?? 0) > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Company</th>
                  <th className="py-2 pr-4">Asset Tag</th>
                  <th className="py-2 pr-4">Serial Number</th>
                  <th className="py-2 pr-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {query.data?.map((equipment) => (
                  <tr key={equipment.id} className="border-b border-border/60">
                    <td className="py-2 pr-4 font-medium text-foreground">{equipment.name}</td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {equipment.companyName ?? "—"}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{equipment.assetTag || "-"}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                      {equipment.serialNumber || "-"}
                    </td>
                    <td className="py-2 pr-2 text-muted-foreground">
                      {new Date(equipment.updatedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}
