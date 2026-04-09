import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchCompanySubtreeEquipment } from "../lib/qrm-router-api";

interface QrmCompanySubtreeEquipmentSectionProps {
  companyId: string;
}

const availabilityColor: Record<string, string> = {
  available: "bg-emerald-500/15 text-emerald-400",
  rented: "bg-violet-500/15 text-violet-400",
  sold: "bg-zinc-500/15 text-zinc-400",
  in_service: "bg-amber-500/15 text-amber-400",
  in_transit: "bg-sky-500/15 text-sky-400",
  reserved: "bg-indigo-500/15 text-indigo-400",
  decommissioned: "bg-red-500/15 text-red-400",
};

function fmt(v: string) {
  return v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function QrmCompanySubtreeEquipmentSection({ companyId }: QrmCompanySubtreeEquipmentSectionProps) {
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
          <div className="text-sm text-destructive space-y-1">
            <p>Couldn&apos;t load roll-up equipment.</p>
            <p className="text-xs text-destructive/70">
              {query.error instanceof Error ? query.error.message : "Unknown error — check workspace access."}
            </p>
          </div>
        )}

        {!query.isLoading && !query.isError && (query.data?.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground">No equipment in this company tree yet.</p>
        )}

        {!query.isLoading && !query.isError && (query.data?.length ?? 0) > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4">Equipment</th>
                  <th className="py-2 pr-4">Company</th>
                  <th className="py-2 pr-4">Category</th>
                  <th className="py-2 pr-4">Availability</th>
                  <th className="py-2 pr-2">Hours / Miles</th>
                  <th className="py-2 pr-2" />
                </tr>
              </thead>
              <tbody>
                {query.data?.map((eq) => (
                  <tr key={eq.id} className="border-b border-border/60">
                    <td className="py-2 pr-4">
                      <div className="font-medium text-foreground">{eq.name}</div>
                      {(eq.make || eq.model || eq.year) && (
                        <div className="text-xs text-muted-foreground">
                          {[eq.year, eq.make, eq.model].filter(Boolean).join(" ")}
                        </div>
                      )}
                      {eq.assetTag && (
                        <div className="font-mono text-xs text-muted-foreground/70">{eq.assetTag}</div>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {eq.companyName ?? "—"}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {eq.category ? fmt(eq.category) : "-"}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge variant="outline" className={availabilityColor[eq.availability] ?? ""}>
                        {fmt(eq.availability)}
                      </Badge>
                    </td>
                    <td className="py-2 pr-2 font-mono text-xs text-muted-foreground">
                      {eq.engineHours != null ? `${eq.engineHours.toLocaleString()} hrs` : ""}
                      {eq.engineHours != null && eq.mileage != null ? " / " : ""}
                      {eq.mileage != null ? `${eq.mileage.toLocaleString()} mi` : ""}
                      {eq.engineHours == null && eq.mileage == null ? "-" : ""}
                    </td>
                    <td className="py-2 pr-2">
                      <Link to={`/crm/equipment/${eq.id}`}>
                        <Button variant="ghost" size="sm">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
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
