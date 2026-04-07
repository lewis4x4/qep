import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { portalApi } from "../lib/portal-api";
import { PortalLayout } from "../components/PortalLayout";
import { Plus, ImagePlus } from "lucide-react";
import { supabase } from "@/lib/supabase";

const REQUEST_TYPES = ["repair", "maintenance", "warranty", "parts", "inspection", "emergency"];

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

/** Linked-job timeline (P1-D) — same underlying events as staff, customer-safe labels only. */
function PortalRequestShopTimeline({ requestId }: { requestId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["portal", "service-timeline", requestId],
    queryFn: () => portalApi.getServiceRequestTimeline(requestId),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <p className="text-xs text-muted-foreground mt-2 border-t pt-2">Loading shop updates…</p>
    );
  }
  if (error) {
    return (
      <p className="text-xs text-destructive mt-2 border-t pt-2">Could not load shop updates.</p>
    );
  }

  const payload = data as {
    ok?: boolean;
    service_job_id?: string | null;
    events?: Array<{
      id: string;
      event_type: string;
      created_at: string;
      old_stage?: string | null;
      new_stage?: string | null;
      customer_label: string;
    }>;
  };

  if (!payload?.ok) return null;

  if (!payload.service_job_id) {
    return (
      <p className="text-xs text-muted-foreground mt-2 border-t pt-2">
        Shop updates will appear here once your request is linked to the service team.
      </p>
    );
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  if (events.length === 0) {
    return (
      <p className="text-xs text-muted-foreground mt-2 border-t pt-2">
        No milestone updates yet. Current status is shown above when available.
      </p>
    );
  }

  return (
    <div className="mt-2 border-t pt-2 space-y-1.5">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
        Shop updates
      </p>
      <ul className="space-y-2 max-h-52 overflow-y-auto pr-1">
        {events.map((ev) => (
          <li key={ev.id} className="text-xs flex flex-col gap-0.5">
            <div className="flex justify-between gap-2">
              <span className="text-foreground">{ev.customer_label}</span>
              <time
                className="text-muted-foreground shrink-0 text-[10px]"
                dateTime={ev.created_at}
              >
                {new Date(ev.created_at).toLocaleString(undefined, {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
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
  const [showForm, setShowForm] = useState(false);
  const [requestType, setRequestType] = useState("");
  const [description, setDescription] = useState("");
  const [urgency, setUrgency] = useState("normal");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);

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

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => portalApi.createServiceRequest(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal", "service-requests"] });
      setShowForm(false);
      setRequestType("");
      setDescription("");
      setPhotoUrls([]);
    },
  });

  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length || !portalRow?.id) return;
    setUploadBusy(true);
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
    } finally {
      setUploadBusy(false);
    }
  };

  return (
    <PortalLayout>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-foreground">Service Requests</h1>
        <Button size="sm" onClick={() => setShowForm(!showForm)}><Plus className="mr-1 h-4 w-4" /> New Request</Button>
      </div>

      {showForm && (
        <Card className="p-4 mb-4 space-y-3">
          <select value={requestType} onChange={(e) => setRequestType(e.target.value)} className="w-full rounded border border-input bg-card px-3 py-2 text-sm">
            <option value="">Select type...</option>
            {REQUEST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the issue..." className="w-full rounded border border-input bg-card px-3 py-2 text-sm min-h-[80px]" />
          <select value={urgency} onChange={(e) => setUrgency(e.target.value)} className="w-full rounded border border-input bg-card px-3 py-2 text-sm">
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="emergency">Emergency</option>
          </select>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => onPickFiles(e.target.files)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!portalRow?.id || uploadBusy}
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus className="mr-1 h-4 w-4" />
              {uploadBusy ? "Uploading…" : "Add photos"}
            </Button>
            {photoUrls.length > 0 && (
              <span className="text-xs text-muted-foreground">{photoUrls.length} photo(s)</span>
            )}
          </div>
          {createMutation.isError && <p className="text-xs text-red-400">Failed to submit. Try again.</p>}
          <Button
            size="sm"
            onClick={() =>
              createMutation.mutate({
                request_type: requestType,
                description,
                urgency,
                photos: photoUrls.map((url) => ({ url })),
              })}
            disabled={!requestType || !description || createMutation.isPending}
          >
            {createMutation.isPending ? "Submitting..." : "Submit Request"}
          </Button>
        </Card>
      )}

      {isLoading && <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-16 animate-pulse" />)}</div>}

      <div className="space-y-2">
        {(data?.requests ?? []).map((raw) => {
          const req = raw as {
            id: string;
            request_type: string;
            description: string;
            status: string;
            portal_status?: PortalStatusSummary | null;
            internal_job?: { id: string; current_stage: string; closed_at: string | null }[] | { id: string; current_stage: string; closed_at: string | null } | null;
          };
          const ij = Array.isArray(req.internal_job) ? req.internal_job[0] : req.internal_job;
          const portalStatus = req.portal_status ?? null;
          const etaLabel = portalStatus?.eta
            ? new Date(portalStatus.eta).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
            : null;
          return (
            <Card key={req.id} className="p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground mr-2">{req.request_type}</span>
                  <span className="text-sm font-medium text-foreground">{req.description?.substring(0, 60)}{req.description && req.description.length > 60 ? "..." : ""}</span>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0 ${
                  req.status === "completed" ? "bg-emerald-500/10 text-emerald-400" :
                  req.status === "submitted" ? "bg-blue-500/10 text-blue-400" :
                  "bg-amber-500/10 text-amber-400"
                }`}>{req.status}</span>
              </div>
              {portalStatus && (
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>
                    Status: <span className="text-foreground font-medium">{portalStatus.label}</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <span>Source: {portalStatus.source_label}</span>
                    {etaLabel && <span>ETA: <span className="text-foreground font-medium">{etaLabel}</span></span>}
                    {portalStatus.last_updated_at && (
                      <span>
                        Last updated: {new Date(portalStatus.last_updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    )}
                  </div>
                </div>
              )}
              {ij?.id ? (
                <PortalRequestShopTimeline requestId={req.id} />
              ) : (
                <p className="text-xs text-muted-foreground mt-2 border-t pt-2">
                  When the shop connects this request to a job, milestone updates will appear here.
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </PortalLayout>
  );
}
