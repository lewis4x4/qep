import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { createCompanyEquipment, fetchCompanyEquipment } from "../lib/qrm-router-api";
import { QrmEquipmentFormSheet, draftToPayload } from "./QrmEquipmentFormSheet";

interface QrmCompanyEquipmentSectionProps {
  companyId: string;
}

const conditionColor: Record<string, string> = {
  new: "bg-emerald-500/15 text-emerald-400",
  excellent: "bg-emerald-500/15 text-emerald-400",
  good: "bg-sky-500/15 text-sky-400",
  fair: "bg-amber-500/15 text-amber-400",
  poor: "bg-orange-500/15 text-orange-400",
  salvage: "bg-red-500/15 text-red-400",
};

const availabilityColor: Record<string, string> = {
  available: "bg-emerald-500/15 text-emerald-400",
  rented: "bg-violet-500/15 text-violet-400",
  sold: "bg-zinc-500/15 text-zinc-400",
  in_service: "bg-amber-500/15 text-amber-400",
  in_transit: "bg-sky-500/15 text-sky-400",
  reserved: "bg-indigo-500/15 text-indigo-400",
  decommissioned: "bg-red-500/15 text-red-400",
};

function formatLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function QrmCompanyEquipmentSection({ companyId }: QrmCompanyEquipmentSectionProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const equipmentQuery = useQuery({
    queryKey: ["crm", "company", companyId, "equipment"],
    queryFn: () => fetchCompanyEquipment(companyId),
    staleTime: 15_000,
  });

  const createMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof draftToPayload>) =>
      createCompanyEquipment({ ...payload, companyId }),
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["crm", "company", companyId, "equipment"] });
      toast({ title: "Equipment added", description: "The equipment record has been created." });
    },
    onError: (error) => {
      toast({
        title: "Unable to add equipment",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <Card className="space-y-3 border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">Equipment Registry</h2>
          <p className="text-sm text-muted-foreground">Track customer assets linked to this company.</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Add Equipment
        </Button>
      </div>

      {equipmentQuery.isLoading && <div className="h-12 animate-pulse rounded bg-muted/40" />}
      {equipmentQuery.isError && (
        <div className="text-sm text-destructive space-y-1">
          <p>Couldn&apos;t load equipment records.</p>
          <p className="text-xs text-destructive/70">
            {equipmentQuery.error instanceof Error ? equipmentQuery.error.message : "Unknown error — check workspace access."}
          </p>
        </div>
      )}

      {!equipmentQuery.isLoading && !equipmentQuery.isError && (equipmentQuery.data?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground">No equipment linked yet.</p>
      )}

      {!equipmentQuery.isLoading && !equipmentQuery.isError && (equipmentQuery.data?.length ?? 0) > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4">Equipment</th>
                <th className="py-2 pr-4">Category</th>
                <th className="py-2 pr-4">Condition</th>
                <th className="py-2 pr-4">Availability</th>
                <th className="py-2 pr-2">Hours / Miles</th>
                <th className="py-2 pr-2" />
              </tr>
            </thead>
            <tbody>
              {equipmentQuery.data?.map((eq) => (
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
                    {eq.category ? formatLabel(eq.category) : "-"}
                  </td>
                  <td className="py-2 pr-4">
                    {eq.condition ? (
                      <Badge variant="outline" className={conditionColor[eq.condition] ?? ""}>
                        {formatLabel(eq.condition)}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <Badge variant="outline" className={availabilityColor[eq.availability] ?? ""}>
                      {formatLabel(eq.availability)}
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

      <QrmEquipmentFormSheet
        open={open}
        onOpenChange={setOpen}
        isPending={createMutation.isPending}
        onSubmit={(payload) => createMutation.mutate(payload)}
      />
    </Card>
  );
}
