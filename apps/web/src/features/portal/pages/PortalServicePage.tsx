import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { portalApi } from "../lib/portal-api";
import {
  normalizePortalFleetPickerRows,
  normalizePortalServiceRequestsPayload,
  normalizePortalServiceTimelinePayload,
} from "../lib/portal-row-normalizers";
import { PortalLayout } from "../components/PortalLayout";
import { Plus, ImagePlus } from "lucide-react";
import { supabase } from "@/lib/supabase";

const REQUEST_TYPES = ["repair", "maintenance", "warranty", "parts", "inspection", "emergency"];
const DEPARTMENTS = ["service", "parts"] as const;

const SHOP_TIMELINE_STAGE_LABEL: Record<string, string> = {
  request_received: "Request received",
  triaging: "Being reviewed",
  diagnosis_selected: "Diagnosis confirmed",
  quote_drafted: "Quote in progress",
  quote_sent: "Quote sent",
  approved: "Approved",
  parts_pending: "Waiting on parts",
  parts_staged: "Parts ready",
  haul_scheduled: "Transport scheduled",
  scheduled: "Appointment scheduled",
  in_progress: "In progress",
  blocked_waiting: "Waiting",
  quality_check: "Quality review",
  ready_for_pickup: "Ready for pickup",
  invoice_ready: "Invoice ready",
  invoiced: "Invoiced",
  paid_closed: "Completed",
};

interface PortalStatusSummary {
  label: string;
  source: "service_job" | "portal_request" | "default";
  source_label: string;
  eta: string | null;
  last_updated_at: string | null;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function statusTone(label: string, source: PortalStatusSummary["source"] | undefined): string {
  if (source === "service_job") return "bg-blue-500/10 text-blue-400";
  if (/completed/i.test(label)) return "bg-emerald-500/10 text-emerald-400";
  if (/waiting/i.test(label)) return "bg-red-500/10 text-red-400";
  return "bg-amber-500/10 text-amber-400";
}

function PortalRequestShopTimeline({ requestId }: { requestId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["portal", "service-timeline", requestId],
    queryFn: () => portalApi.getServiceRequestTimeline(requestId),
    staleTime: 60_000,
  });

  if (isLoading) {
    return <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">Loading shop updates…</p>;
  }
  if (error) {
    return <p className="mt-2 border-t pt-2 text-xs text-destructive">Could not load shop updates.</p>;
  }

  const payload = normalizePortalServiceTimelinePayload(data);

  if (!payload?.ok) return null;
  if (!payload.service_job_id) {
    return (
      <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
        Shop updates will appear here once your request is linked to the service team.
      </p>
    );
  }

  const events = payload.events;
  if (events.length === 0) {
    return (
      <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
        No milestone updates yet. Current status is shown above when available.
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-1.5 border-t pt-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Shop updates</p>
      <ul className="max-h-52 space-y-2 overflow-y-auto pr-1">
        {events.map((ev) => (
          <li key={ev.id} className="flex flex-col gap-0.5 text-xs">
            <div className="flex justify-between gap-2">
              <span className="text-foreground">{ev.customer_label}</span>
              <time className="shrink-0 text-[10px] text-muted-foreground" dateTime={ev.created_at}>
                {new Date(ev.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
              </time>
            </div>
            {ev.new_stage && ev.event_type === "stage_transition" && (
              <span className="text-[11px] text-muted-foreground">
                {SHOP_TIMELINE_STAGE_LABEL[ev.new_stage] ?? ev.new_stage}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PortalServicePage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [searchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(Boolean(searchParams.get("request_type") || searchParams.get("fleet_id")));
  const [requestType, setRequestType] = useState(searchParams.get("request_type") ?? "");
  const [department, setDepartment] = useState<(typeof DEPARTMENTS)[number]>("service");
  const [description, setDescription] = useState("");
  const [urgency, setUrgency] = useState("normal");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [fleetId, setFleetId] = useState(searchParams.get("fleet_id") ?? "");

  const { data: portalRow } = useQuery({
    queryKey: ["portal", "customer-self"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase
        .from("portal_customers")
        .select("id")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["portal", "service-requests"],
    queryFn: portalApi.getServiceRequests,
    staleTime: 15_000,
  });

  const fleetQuery = useQuery({
    queryKey: ["portal", "fleet-with-status"],
    queryFn: portalApi.getFleetWithStatus,
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => portalApi.createServiceRequest(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal", "service-requests"] });
      setShowForm(false);
      setRequestType("");
      setDepartment("service");
      setDescription("");
      setPhotoUrls([]);
      setUploadError(null);
      setFleetId("");
    },
  });

  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length || !portalRow?.id) return;
    setUploadBusy(true);
    setUploadError(null);
    try {
      const next: string[] = [...photoUrls];
      for (const file of Array.from(files).slice(0, 6)) {
        const ext = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "jpg";
        const path = `${portalRow.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("portal-service-photos")
          .upload(path, file, { upsert: false, contentType: file.type || undefined });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("portal-service-photos").getPublicUrl(path);
        if (pub?.publicUrl) next.push(pub.publicUrl);
      }
      setPhotoUrls(next);
    } catch (e) {
      console.error(e);
      setUploadError("Photo upload failed. Try again with a smaller image or retry in a moment.");
    } finally {
      setUploadBusy(false);
    }
  };

  const serviceData = normalizePortalServiceRequestsPayload(data);
  const openRequests = serviceData?.open_requests ?? [];
  const completedRequests = serviceData?.completed_requests ?? [];
  const fleetOptions = normalizePortalFleetPickerRows(fleetQuery.data?.fleet);

  return (
    <PortalLayout>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Service Requests</h1>
        <Button size="sm" onClick={() => setShowForm((value) => !value)}>
          <Plus className="mr-1 h-4 w-4" />
          New Request
        </Button>
      </div>

      {serviceData?.workspace_summary && (
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <Card className="p-4">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Open work</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{serviceData.workspace_summary.open_count}</p>
          </Card>
          <Card className="p-4">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Completed recently</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{serviceData.workspace_summary.completed_count}</p>
          </Card>
          <Card className="p-4">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Blocked / waiting</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{serviceData.workspace_summary.blocked_count}</p>
          </Card>
        </div>
      )}

      {showForm && (
        <Card className="mb-4 space-y-3 p-4">
          {fleetOptions.length > 0 && (
            <select
              value={fleetId}
              onChange={(event) => setFleetId(event.target.value)}
              className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
            >
              <option value="">Select machine…</option>
              {fleetOptions.map((fleet) => (
                <option key={fleet.id} value={fleet.id}>
                  {[fleet.make, fleet.model, fleet.year].filter(Boolean).join(" ")}
                </option>
              ))}
            </select>
          )}
          <select value={requestType} onChange={(event) => setRequestType(event.target.value)} className="w-full rounded border border-input bg-card px-3 py-2 text-sm">
            <option value="">Select type...</option>
            {REQUEST_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <select value={department} onChange={(event) => setDepartment(event.target.value as (typeof DEPARTMENTS)[number])} className="w-full rounded border border-input bg-card px-3 py-2 text-sm">
            {DEPARTMENTS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <Input value={fleetId} onChange={(event) => setFleetId(event.target.value)} placeholder="Fleet machine id" className="text-sm" />
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Describe the issue..."
            className="min-h-[100px] w-full rounded border border-input bg-card px-3 py-2 text-sm"
          />
          <select value={urgency} onChange={(event) => setUrgency(event.target.value)} className="w-full rounded border border-input bg-card px-3 py-2 text-sm">
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="emergency">Emergency</option>
          </select>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => onPickFiles(event.target.files)} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={!portalRow?.id || uploadBusy} onClick={() => fileRef.current?.click()}>
              <ImagePlus className="mr-1 h-4 w-4" />
              {uploadBusy ? "Uploading…" : "Add photos"}
            </Button>
            {photoUrls.length > 0 && <span className="text-xs text-muted-foreground">{photoUrls.length} photo(s)</span>}
          </div>
          {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}
          {createMutation.isError && <p className="text-xs text-red-400">Failed to submit. Try again.</p>}
          <Button
            size="sm"
            disabled={!requestType || !description.trim() || createMutation.isPending}
            onClick={() =>
              createMutation.mutate({
                fleet_id: fleetId || null,
                department,
                request_type: requestType,
                description,
                urgency,
                photos: photoUrls.map((url) => ({ url })),
              })}
          >
            {createMutation.isPending ? "Submitting..." : "Submit Request"}
          </Button>
        </Card>
      )}

      {isLoading && <div className="space-y-3">{Array.from({ length: 3 }).map((_, index) => <Card key={index} className="h-16 animate-pulse" />)}</div>}

      {[
        { label: "Open work", rows: openRequests },
        { label: "Completed recently", rows: completedRequests },
      ].map((section) => (
        <div key={section.label} className="mb-4 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{section.label}</p>
          {section.rows.map((req) => {
            const internalJob = req.internal_job;
            const portalStatus = req.portal_status ?? null;
            const etaLabel = formatDate(portalStatus?.eta ?? null);

            return (
              <Card key={req.id} className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="mr-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{req.request_type}</span>
                    <span className="text-sm font-medium text-foreground">
                      {req.description?.substring(0, 72)}
                      {req.description && req.description.length > 72 ? "..." : ""}
                    </span>
                  </div>
                  {portalStatus && (
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusTone(portalStatus.label, portalStatus.source)}`}>
                      {portalStatus.label}
                    </span>
                  )}
                </div>

                {req.workspace_timeline?.customer_summary && (
                  <p className="text-sm text-foreground">{req.workspace_timeline.customer_summary}</p>
                )}

                {portalStatus && (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-3">
                      {req.workspace_timeline?.branch_label && <span>Branch: {req.workspace_timeline.branch_label}</span>}
                      <span>Source: {portalStatus.source_label}</span>
                      {etaLabel && <span>ETA: <span className="font-medium text-foreground">{etaLabel}</span></span>}
                      {portalStatus.last_updated_at && (
                        <span>
                          Last updated: {new Date(portalStatus.last_updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </span>
                      )}
                      {typeof req.photo_count === "number" && req.photo_count > 0 && <span>{req.photo_count} photo(s)</span>}
                    </div>
                    {req.workspace_timeline?.next_step && (
                      <p className="text-xs text-foreground">{req.workspace_timeline.next_step}</p>
                    )}
                  </div>
                )}

                {internalJob?.id ? (
                  <PortalRequestShopTimeline requestId={req.id} />
                ) : (
                  <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
                    When the shop connects this request to a job, milestone updates will appear here.
                  </p>
                )}
              </Card>
            );
          })}

          {!isLoading && section.rows.length === 0 && (
            <Card className="border-dashed p-6 text-center">
              <p className="text-sm text-muted-foreground">No requests in this section right now.</p>
            </Card>
          )}
        </div>
      ))}
    </PortalLayout>
  );
}
