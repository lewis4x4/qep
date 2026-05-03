import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { InspectionChecklist } from "../components/InspectionChecklist";
import { SignatureCapture } from "../components/SignatureCapture";
import {
  DEFAULT_DRIVER_CHECKLIST,
  TRAFFIC_STATUS_META,
  canCompleteTrafficTicket,
  normalizeDriverChecklist,
  serializeDriverChecklist,
  updateChecklistItem,
} from "../lib/traffic-ticket-driver";
import { normalizeTrafficTicketRows, type TrafficTicketRow } from "../lib/ops-row-normalizers";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Loader2,
  Lock,
  MapPin,
  Truck,
} from "lucide-react";

const FILTERS = ["all", "haul_pending", "scheduled", "being_shipped", "completed"] as const;
const BUCKET = "equipment-photos";

function asPhotoArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

async function uploadTicketPhoto(ticketId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `traffic-tickets/${ticketId}/${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (uploadError) {
    throw uploadError;
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export function TrafficTicketsPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [hourMeterInput, setHourMeterInput] = useState("");
  const [problemNotes, setProblemNotes] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);

  const { data: tickets = [], isLoading, isError, error } = useQuery<TrafficTicketRow[]>({
    queryKey: ["ops", "traffic-tickets", statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("traffic_tickets")
        .select("id, billing_comments, created_at, delivery_address, delivery_lat, delivery_lng, delivery_photos, delivery_signature_url, department, driver_checklist, driver_id, from_location, hour_meter_reading, locked, problems_reported, shipping_date, status, stock_number, ticket_type, to_contact_name, to_contact_phone, to_location, urgency")
        .order("shipping_date", { ascending: true });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query.limit(50);
      if (error) throw error;
      return normalizeTrafficTicketRows(data);
    },
    staleTime: 15_000,
  });

  const selectedTicket = useMemo(() => {
    if (tickets.length === 0) return null;
    return tickets.find((ticket) => ticket.id === selectedId) ?? tickets[0] ?? null;
  }, [tickets, selectedId]);

  const updateTicketMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<TrafficTicketRow> }) => {
      const { error } = await supabase.from("traffic_tickets").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setStatusError(null);
      queryClient.invalidateQueries({ queryKey: ["ops", "traffic-tickets"] });
    },
    onError: (mutationError) => {
      setStatusError(mutationError instanceof Error ? mutationError.message : "Traffic ticket update failed.");
    },
  });

  const checklistItems = normalizeDriverChecklist(selectedTicket?.driver_checklist ?? null);
  const currentPhotos = asPhotoArray(selectedTicket?.delivery_photos);
  const effectiveSignature = signatureDataUrl ?? selectedTicket?.delivery_signature_url ?? null;

  const completionReady = selectedTicket
    ? canCompleteTrafficTicket({
        driver_checklist: serializeDriverChecklist(checklistItems),
        delivery_lat: selectedTicket.delivery_lat,
        delivery_lng: selectedTicket.delivery_lng,
        delivery_signature_url: effectiveSignature,
        delivery_photos: currentPhotos,
        hour_meter_reading: selectedTicket.hour_meter_reading ?? (hourMeterInput ? Number(hourMeterInput) : null),
      })
    : false;

  async function patchSelectedTicket(patch: Partial<TrafficTicketRow>) {
    if (!selectedTicket) return;
    updateTicketMutation.mutate({ id: selectedTicket.id, patch });
  }

  async function captureGps() {
    if (!selectedTicket || selectedTicket.locked) return;
    if (!navigator.geolocation) {
      setStatusError("Geolocation is not available on this device.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const checklist = updateChecklistItem(checklistItems, "Capture delivery location GPS", true);
        patchSelectedTicket({
          delivery_lat: position.coords.latitude,
          delivery_lng: position.coords.longitude,
          driver_checklist: serializeDriverChecklist(checklist),
        });
      },
      (geoError) => setStatusError(geoError.message),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function handlePhotoSelect(file: File | null) {
    if (!file || !selectedTicket || selectedTicket.locked) return;
    try {
      const url = await uploadTicketPhoto(selectedTicket.id, file);
      const nextPhotos = [...currentPhotos, url];
      const checklist = updateChecklistItem(checklistItems, "Capture delivery and hour meter proof", true);
      patchSelectedTicket({
        delivery_photos: nextPhotos,
        driver_checklist: serializeDriverChecklist(checklist),
      });
    } catch (uploadError) {
      setStatusError(uploadError instanceof Error ? uploadError.message : "Photo upload failed.");
    }
  }

  if (isLoading) {
    return <div className="space-y-4 p-4">{Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-20 animate-pulse" />)}</div>;
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-5xl px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <Card className="border-red-500/20 bg-red-500/5 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-red-400" />
            <div>
              <p className="text-sm font-semibold text-foreground">Traffic workflow unavailable</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {error instanceof Error ? error.message : "Traffic tickets could not be loaded."}
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Traffic Tickets</h1>
          <p className="text-sm text-muted-foreground">
            Equipment logistics workflow with driver proof-of-delivery capture. No equipment moves without a ticket.
          </p>
        </div>
        <Button size="sm">
          <Truck className="mr-1 h-4 w-4" /> New Ticket
        </Button>
      </div>

      {statusError && (
        <Card className="mb-4 border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{statusError}</span>
          </div>
        </Card>
      )}

      <div className="mb-4 flex gap-2 overflow-x-auto">
        {FILTERS.map((filter) => (
          <button
            key={filter}
            onClick={() => setStatusFilter(filter)}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              statusFilter === filter ? "border-qep-orange bg-qep-orange/10 text-qep-orange" : "border-border text-muted-foreground"
            }`}
          >
            {filter === "all" ? "All" : TRAFFIC_STATUS_META[filter]?.label ?? filter.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-2">
          {tickets.length === 0 ? (
            <Card className="p-6 text-center">
              <p className="text-sm text-muted-foreground">No traffic tickets found.</p>
            </Card>
          ) : (
            tickets.map((ticket) => {
              const active = selectedTicket?.id === ticket.id;
              const statusMeta = TRAFFIC_STATUS_META[ticket.status] ?? TRAFFIC_STATUS_META.haul_pending;
              return (
                <button
                  key={ticket.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(ticket.id);
                    setHourMeterInput(ticket.hour_meter_reading?.toString() ?? "");
                    setProblemNotes(ticket.problems_reported ?? "");
                    setSignatureDataUrl(null);
                    setStatusError(null);
                  }}
                  className={`w-full rounded-xl border text-left transition ${active ? "border-qep-orange/40 bg-qep-orange/5" : "border-border bg-background hover:border-white/20"}`}
                >
                  <Card className="border-none bg-transparent p-4 shadow-none">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusMeta.badge}`}>
                            {statusMeta.label}
                          </span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                            {ticket.ticket_type.replace(/_/g, " ")}
                          </span>
                          {ticket.locked && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] text-red-300">
                              <Lock className="h-3 w-3" /> Locked
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-sm font-semibold text-foreground">Stock #{ticket.stock_number}</p>
                        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {ticket.from_location} → {ticket.to_location}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Ship: {ticket.shipping_date} • Contact: {ticket.to_contact_name}
                        </p>
                      </div>
                      {active && <CheckCircle2 className="h-4 w-4 text-qep-orange" />}
                    </div>
                  </Card>
                </button>
              );
            })
          )}
        </div>

        {selectedTicket ? (
          <div className="space-y-4">
            <Card className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-qep-orange">Driver mobile workflow</p>
                  <h2 className="mt-1 text-lg font-semibold text-foreground">Stock #{selectedTicket.stock_number}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedTicket.from_location} → {selectedTicket.to_location} • {selectedTicket.to_contact_name} • {selectedTicket.to_contact_phone}
                  </p>
                </div>
                {selectedTicket.locked ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-3 py-1 text-[11px] text-red-300">
                    <Lock className="h-3.5 w-3.5" />
                    Read-only after submission
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-qep-orange/10 px-3 py-1 text-[11px] text-qep-orange">
                    Complete checklist, GPS, signature, and proof to finish
                  </span>
                )}
              </div>
            </Card>

            <InspectionChecklist
              title="Driver checklist"
              items={checklistItems}
              onUpdate={(nextItems) => {
                if (selectedTicket.locked) return;
                patchSelectedTicket({ driver_checklist: serializeDriverChecklist(nextItems) });
              }}
            />

            <Card className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">GPS delivery proof</p>
                  <p className="text-xs text-muted-foreground">
                    Capture the truck’s current location from the phone before delivery submission.
                  </p>
                </div>
                <Button size="sm" onClick={captureGps} disabled={Boolean(selectedTicket.locked) || updateTicketMutation.isPending}>
                  <MapPin className="mr-1 h-4 w-4" />
                  Capture GPS
                </Button>
              </div>
              <p className="mt-3 text-sm text-foreground">
                {selectedTicket.delivery_lat != null && selectedTicket.delivery_lng != null
                  ? `${selectedTicket.delivery_lat.toFixed(5)}, ${selectedTicket.delivery_lng.toFixed(5)}`
                  : "No GPS proof captured yet."}
              </p>
            </Card>

            <SignatureCapture
              label="Delivery signature"
              onCapture={(dataUrl) => {
                setSignatureDataUrl(dataUrl);
                if (selectedTicket.locked) return;
                const checklist = updateChecklistItem(checklistItems, "Capture customer signature", true);
                patchSelectedTicket({
                  delivery_signature_url: dataUrl,
                  driver_checklist: serializeDriverChecklist(checklist),
                });
              }}
            />

            <Card className="p-4">
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Proof of delivery</p>
                  <p className="text-xs text-muted-foreground">
                    Upload delivery proof and hour meter photo from the phone. The same proof set unlocks completion.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="hour-meter">Hour meter reading</Label>
                    <Input
                      id="hour-meter"
                      type="number"
                      inputMode="decimal"
                      value={hourMeterInput}
                      onChange={(event) => setHourMeterInput(event.target.value)}
                      onBlur={() => {
                        if (selectedTicket.locked) return;
                        const parsed = hourMeterInput.trim() ? Number(hourMeterInput) : null;
                        patchSelectedTicket({ hour_meter_reading: Number.isFinite(parsed as number) ? parsed : null });
                      }}
                      disabled={Boolean(selectedTicket.locked)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ticket-photo">Delivery + hour meter photo</Label>
                    <Input
                      id="ticket-photo"
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      disabled={Boolean(selectedTicket.locked)}
                      onChange={(event) => void handlePhotoSelect(event.target.files?.[0] ?? null)}
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-foreground">
                  {currentPhotos.length > 0 ? `${currentPhotos.length} proof photo${currentPhotos.length === 1 ? "" : "s"} uploaded.` : "No delivery proof photos uploaded yet."}
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="space-y-2">
                <Label htmlFor="traffic-problems">Problems reported</Label>
                <Input
                  id="traffic-problems"
                  value={problemNotes}
                  onChange={(event) => setProblemNotes(event.target.value)}
                  onBlur={() => {
                    if (selectedTicket.locked) return;
                    patchSelectedTicket({ problems_reported: problemNotes.trim() || null });
                  }}
                  disabled={Boolean(selectedTicket.locked)}
                  placeholder="Notes from delivery, access issues, or equipment concerns"
                />
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (selectedTicket.locked) return;
                    patchSelectedTicket({ status: "scheduled" });
                  }}
                  disabled={Boolean(selectedTicket.locked) || selectedTicket.status === "scheduled"}
                >
                  Mark scheduled
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (selectedTicket.locked) return;
                    patchSelectedTicket({ status: "being_shipped" });
                  }}
                  disabled={Boolean(selectedTicket.locked) || selectedTicket.status === "being_shipped"}
                >
                  Mark in transit
                </Button>
                <Button
                  onClick={() => {
                    if (selectedTicket.locked) return;
                    if (!completionReady) {
                      setStatusError("Capture checklist, GPS, signature, proof photo, and hour meter before completing delivery.");
                      return;
                    }
                    patchSelectedTicket({
                      status: "completed",
                      proof_of_delivery_complete: true,
                      completed_at: new Date().toISOString(),
                    });
                  }}
                  disabled={Boolean(selectedTicket.locked) || updateTicketMutation.isPending}
                >
                  {updateTicketMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                  Complete delivery
                </Button>
              </div>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
