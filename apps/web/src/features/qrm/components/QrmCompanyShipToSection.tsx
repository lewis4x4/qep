import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  createCompanyShipTo,
  fetchCompanyShipTos,
  patchCompanyShipTo,
} from "../lib/qrm-router-api";
import type { QrmCompanyShipToAddress, QrmCompanyShipToInput } from "../lib/types";
import { QrmCompanyShipToSheet } from "./QrmCompanyShipToSheet";

interface QrmCompanyShipToSectionProps {
  companyId: string;
}

function formatLocation(shipTo: QrmCompanyShipToAddress): string {
  return [
    shipTo.addressLine1,
    shipTo.addressLine2,
    [shipTo.city, shipTo.state].filter(Boolean).join(", "),
    shipTo.postalCode,
    shipTo.country,
  ]
    .filter((part) => part && part.trim().length > 0)
    .join(" · ");
}

export function QrmCompanyShipToSection({ companyId }: QrmCompanyShipToSectionProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingShipTo, setEditingShipTo] = useState<QrmCompanyShipToAddress | null>(null);

  const shipToQuery = useQuery({
    queryKey: ["crm", "company", companyId, "ship-tos"],
    queryFn: () => fetchCompanyShipTos(companyId),
    staleTime: 15_000,
  });

  const saveMutation = useMutation({
    mutationFn: async (input: QrmCompanyShipToInput) => {
      if (editingShipTo) {
        return patchCompanyShipTo(companyId, editingShipTo.id, input);
      }
      return createCompanyShipTo(companyId, input);
    },
    onSuccess: async () => {
      const wasEditing = Boolean(editingShipTo);
      setSheetOpen(false);
      setEditingShipTo(null);
      await queryClient.invalidateQueries({ queryKey: ["crm", "company", companyId, "ship-tos"] });
      toast({
        title: wasEditing ? "Ship-to updated" : "Ship-to added",
        description: wasEditing
          ? "The delivery destination is up to date."
          : "The company now has another delivery destination on file.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not save ship-to address",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (shipToId: string) => {
      return patchCompanyShipTo(companyId, shipToId, { archive: true });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["crm", "company", companyId, "ship-tos"] });
      toast({
        title: "Ship-to archived",
        description: "The destination is no longer active on this company.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not archive ship-to address",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  function handleCreateOpen() {
    setEditingShipTo(null);
    setSheetOpen(true);
  }

  function handleEditOpen(shipTo: QrmCompanyShipToAddress) {
    setEditingShipTo(shipTo);
    setSheetOpen(true);
  }

  function handleArchive(shipTo: QrmCompanyShipToAddress) {
    if (archiveMutation.isPending) return;
    if (!window.confirm(`Archive ship-to address "${shipTo.name}"?`)) return;
    archiveMutation.mutate(shipTo.id);
  }

  return (
    <Card className="space-y-4 border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">Ship-To Addresses</h2>
          <p className="text-sm text-muted-foreground">
            Keep multiple named delivery destinations on the account, not just the primary billing address.
          </p>
        </div>
        <Button size="sm" onClick={handleCreateOpen}>
          <Plus className="mr-1 h-4 w-4" />
          Add Ship-To
        </Button>
      </div>

      {shipToQuery.isLoading && <div className="h-20 animate-pulse rounded bg-muted/40" />}
      {shipToQuery.isError && (
        <div className="space-y-1 text-sm text-destructive">
          <p>Couldn&apos;t load ship-to addresses.</p>
          <p className="text-xs text-destructive/70">
            {shipToQuery.error instanceof Error ? shipToQuery.error.message : "Unknown error — check workspace access."}
          </p>
        </div>
      )}

      {!shipToQuery.isLoading && !shipToQuery.isError && (shipToQuery.data?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground">
          No ship-to addresses are on file yet.
        </p>
      )}

      {!shipToQuery.isLoading && !shipToQuery.isError && (shipToQuery.data?.length ?? 0) > 0 && (
        <div className="grid gap-3">
          {shipToQuery.data?.map((shipTo) => {
            const location = formatLocation(shipTo);
            return (
              <div key={shipTo.id} className="rounded-lg border border-border bg-muted/10 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{shipTo.name}</p>
                      {shipTo.isPrimary ? (
                        <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-500">
                          <Star className="mr-1 h-3 w-3" />
                          Primary
                        </Badge>
                      ) : null}
                    </div>
                    {shipTo.contactName ? (
                      <p className="text-sm text-muted-foreground">{shipTo.contactName}</p>
                    ) : null}
                    {location ? (
                      <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{location}</span>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No address lines entered yet.</p>
                    )}
                    {shipTo.phone ? (
                      <p className="text-sm text-muted-foreground">Phone: {shipTo.phone}</p>
                    ) : null}
                    {shipTo.instructions ? (
                      <p className="text-sm text-muted-foreground">{shipTo.instructions}</p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEditOpen(shipTo)}
                    >
                      <Pencil className="mr-1 h-4 w-4" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleArchive(shipTo)}
                      disabled={archiveMutation.isPending}
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      Archive
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <QrmCompanyShipToSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) {
            setEditingShipTo(null);
          }
        }}
        shipTo={editingShipTo}
        isPending={saveMutation.isPending}
        onSubmit={async (input) => {
          await saveMutation.mutateAsync(input);
        }}
      />
    </Card>
  );
}
