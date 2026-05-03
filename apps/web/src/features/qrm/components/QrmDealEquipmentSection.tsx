import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Plus, Trash2, Wrench } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import {
  fetchCompanyEquipment,
  fetchDealEquipment,
  linkEquipmentToDeal,
  unlinkEquipmentFromDeal,
} from "../lib/qrm-router-api";
import type { QrmDealEquipmentRole, QrmEquipment } from "../lib/types";

interface QrmDealEquipmentSectionProps {
  dealId: string;
  companyId: string | null;
}

const ROLE_OPTIONS: { value: QrmDealEquipmentRole; label: string }[] = [
  { value: "subject", label: "Subject of Sale" },
  { value: "trade_in", label: "Trade-in" },
  { value: "rental", label: "Rental" },
  { value: "part_exchange", label: "Part Exchange" },
];

function isDealEquipmentRole(value: string): value is QrmDealEquipmentRole {
  return ROLE_OPTIONS.some((option) => option.value === value);
}

function normalizeDealEquipmentRole(value: string): QrmDealEquipmentRole {
  return isDealEquipmentRole(value) ? value : "subject";
}

const roleColor: Record<string, string> = {
  subject: "bg-sky-500/15 text-sky-400",
  trade_in: "bg-amber-500/15 text-amber-400",
  rental: "bg-violet-500/15 text-violet-400",
  part_exchange: "bg-emerald-500/15 text-emerald-400",
};

function fmt(v: string) {
  return v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none";

export function QrmDealEquipmentSection({ dealId, companyId }: QrmDealEquipmentSectionProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState("");
  const [selectedRole, setSelectedRole] = useState<QrmDealEquipmentRole>("subject");
  const [linkNotes, setLinkNotes] = useState("");

  const linksQuery = useQuery({
    queryKey: ["crm", "deal", dealId, "equipment"],
    queryFn: () => fetchDealEquipment(dealId),
    staleTime: 15_000,
  });

  const companyEquipmentQuery = useQuery({
    queryKey: ["crm", "company", companyId ?? "__none__", "equipment"],
    queryFn: async (): Promise<QrmEquipment[]> => (companyId ? fetchCompanyEquipment(companyId) : []),
    staleTime: 30_000,
    enabled: sheetOpen && !!companyId,
  });

  const linkMutation = useMutation({
    mutationFn: () =>
      linkEquipmentToDeal({
        dealId,
        equipmentId: selectedEquipmentId,
        role: selectedRole,
        notes: linkNotes.trim() || null,
      }),
    onSuccess: async () => {
      setSheetOpen(false);
      setSelectedEquipmentId("");
      setLinkNotes("");
      await queryClient.invalidateQueries({ queryKey: ["crm", "deal", dealId, "equipment"] });
      toast({ title: "Equipment linked to deal" });
    },
    onError: (error) => {
      toast({
        title: "Unable to link equipment",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (linkId: string) => unlinkEquipmentFromDeal(linkId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["crm", "deal", dealId, "equipment"] });
      toast({ title: "Equipment unlinked" });
    },
    onError: (error) => {
      toast({
        title: "Unable to unlink equipment",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const links = linksQuery.data ?? [];
  const linkedIds = new Set(links.map((l) => l.equipmentId));
  const availableEquipment = (companyEquipmentQuery.data ?? []).filter((e) => !linkedIds.has(e.id));

  return (
    <Card className="space-y-3 border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold text-foreground">Equipment</h2>
        </div>
        <Button size="sm" variant="outline" onClick={() => setSheetOpen(true)}>
          <Link2 className="mr-1 h-4 w-4" />
          Link Equipment
        </Button>
      </div>

      {linksQuery.isLoading && <div className="h-10 animate-pulse rounded bg-muted/40" />}
      {linksQuery.isError && (
        <p className="text-sm text-destructive">Couldn&apos;t load linked equipment.</p>
      )}

      {!linksQuery.isLoading && !linksQuery.isError && links.length === 0 && (
        <p className="text-sm text-muted-foreground">No equipment linked to this deal yet.</p>
      )}

      {links.length > 0 && (
        <div className="space-y-2">
          {links.map((link) => (
            <div key={link.id} className="flex items-center gap-3 rounded-md border border-border bg-background/50 px-3 py-2">
              <div className="min-w-0 flex-1">
                <Link to={`/crm/equipment/${link.equipmentId}`} className="font-medium text-foreground hover:text-primary">
                  {link.equipment?.name ?? "Equipment"}
                </Link>
                {link.equipment && (link.equipment.make || link.equipment.model || link.equipment.year) && (
                  <div className="text-xs text-muted-foreground">
                    {[link.equipment.year, link.equipment.make, link.equipment.model].filter(Boolean).join(" ")}
                  </div>
                )}
                {link.notes && <div className="mt-0.5 text-xs text-muted-foreground">{link.notes}</div>}
              </div>
              <Badge variant="outline" className={roleColor[link.role] ?? ""}>
                {fmt(link.role)}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => unlinkMutation.mutate(link.id)}
                disabled={unlinkMutation.isPending}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Link Equipment to Deal</SheetTitle>
            <SheetDescription>
              {companyId
                ? "Select equipment from the linked company."
                : "Link a company to this deal first to see available equipment."}
            </SheetDescription>
          </SheetHeader>

          {companyId ? (
            <div className="mt-4 space-y-4">
              <div>
                <Label htmlFor="de-equipment">Equipment</Label>
                <select
                  id="de-equipment"
                  className={selectClass}
                  value={selectedEquipmentId}
                  onChange={(e) => setSelectedEquipmentId(e.target.value)}
                >
                  <option value="">Select equipment…</option>
                  {availableEquipment.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.name}{eq.assetTag ? ` (${eq.assetTag})` : ""}
                    </option>
                  ))}
                </select>
                {availableEquipment.length === 0 && !companyEquipmentQuery.isLoading && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    No unlinked equipment found. Add equipment on the company page first.
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="de-role">Role</Label>
                <select
                  id="de-role"
                  className={selectClass}
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(normalizeDealEquipmentRole(e.target.value))}
                >
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="de-notes">Notes (optional)</Label>
                <Input
                  id="de-notes"
                  value={linkNotes}
                  onChange={(e) => setLinkNotes(e.target.value)}
                  placeholder="e.g. customer wants to trade in for newer model"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancel</Button>
                <Button
                  disabled={!selectedEquipmentId || linkMutation.isPending}
                  onClick={() => linkMutation.mutate()}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Link
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-6 text-sm text-muted-foreground">
              This deal has no company linked yet. Link a company to access its equipment registry.
            </p>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}
