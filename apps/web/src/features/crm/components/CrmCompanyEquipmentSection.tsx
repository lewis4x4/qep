import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { createCompanyEquipment, fetchCompanyEquipment } from "../lib/crm-router-api";

interface CrmCompanyEquipmentSectionProps {
  companyId: string;
}

interface NewEquipmentDraft {
  name: string;
  assetTag: string;
  serialNumber: string;
}

export function CrmCompanyEquipmentSection({ companyId }: CrmCompanyEquipmentSectionProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<NewEquipmentDraft>({
    name: "",
    assetTag: "",
    serialNumber: "",
  });

  const equipmentQuery = useQuery({
    queryKey: ["crm", "company", companyId, "equipment"],
    queryFn: () => fetchCompanyEquipment(companyId),
    staleTime: 15_000,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createCompanyEquipment({
        companyId,
        name: draft.name,
        assetTag: draft.assetTag || null,
        serialNumber: draft.serialNumber || null,
      }),
    onSuccess: async () => {
      setOpen(false);
      setDraft({ name: "", assetTag: "", serialNumber: "" });
      await queryClient.invalidateQueries({ queryKey: ["crm", "company", companyId, "equipment"] });
      toast({ title: "Equipment added", description: "The company equipment registry has been updated." });
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
    <Card className="space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-[#0F172A]">Equipment Registry</h2>
          <p className="text-sm text-[#475569]">Track customer assets linked to this company.</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Add Equipment
        </Button>
      </div>

      {equipmentQuery.isLoading && <div className="h-12 animate-pulse rounded bg-[#F8FAFC]" />}
      {equipmentQuery.isError && (
        <p className="text-sm text-destructive">Couldn&apos;t load equipment records.</p>
      )}

      {!equipmentQuery.isLoading && !equipmentQuery.isError && (equipmentQuery.data?.length ?? 0) === 0 && (
        <p className="text-sm text-[#475569]">No equipment linked yet.</p>
      )}

      {!equipmentQuery.isLoading && !equipmentQuery.isError && (equipmentQuery.data?.length ?? 0) > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-left text-xs uppercase tracking-wide text-[#475569]">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Asset Tag</th>
                <th className="py-2 pr-4">Serial Number</th>
                <th className="py-2 pr-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {equipmentQuery.data?.map((equipment) => (
                <tr key={equipment.id} className="border-b border-[#F1F5F9]">
                  <td className="py-2 pr-4 font-medium text-[#0F172A]">{equipment.name}</td>
                  <td className="py-2 pr-4 text-[#334155]">{equipment.assetTag || "-"}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-[#334155]">{equipment.serialNumber || "-"}</td>
                  <td className="py-2 pr-2 text-[#475569]">
                    {new Date(equipment.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Add equipment</SheetTitle>
            <SheetDescription>
              Keep company context while adding an equipment asset.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-[#0F172A]" htmlFor="equipment-name">
                Name
              </label>
              <Input
                id="equipment-name"
                value={draft.name}
                onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="CAT 320 Excavator"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[#0F172A]" htmlFor="equipment-asset-tag">
                Asset tag
              </label>
              <Input
                id="equipment-asset-tag"
                value={draft.assetTag}
                onChange={(event) => setDraft((prev) => ({ ...prev, assetTag: event.target.value }))}
                placeholder="QEP-EX-1003"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[#0F172A]" htmlFor="equipment-serial">
                Serial number
              </label>
              <Input
                id="equipment-serial"
                value={draft.serialNumber}
                onChange={(event) => setDraft((prev) => ({ ...prev, serialNumber: event.target.value }))}
                placeholder="SN12345"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                disabled={createMutation.isPending || draft.name.trim().length === 0}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
                Save Equipment
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
