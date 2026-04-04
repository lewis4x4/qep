import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { portalApi } from "../lib/portal-api";
import { PortalLayout } from "../components/PortalLayout";
import { Plus } from "lucide-react";

const REQUEST_TYPES = ["repair", "maintenance", "warranty", "parts", "inspection", "emergency"];

export function PortalServicePage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [requestType, setRequestType] = useState("");
  const [description, setDescription] = useState("");
  const [urgency, setUrgency] = useState("normal");

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
    },
  });

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
          {createMutation.isError && <p className="text-xs text-red-400">Failed to submit. Try again.</p>}
          <Button size="sm" onClick={() => createMutation.mutate({ request_type: requestType, description, urgency })} disabled={!requestType || !description || createMutation.isPending}>
            {createMutation.isPending ? "Submitting..." : "Submit Request"}
          </Button>
        </Card>
      )}

      {isLoading && <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-16 animate-pulse" />)}</div>}

      <div className="space-y-2">
        {(data?.requests ?? []).map((req: any) => (
          <Card key={req.id} className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground mr-2">{req.request_type}</span>
                <span className="text-sm font-medium text-foreground">{req.description?.substring(0, 60)}{req.description?.length > 60 ? "..." : ""}</span>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                req.status === "completed" ? "bg-emerald-500/10 text-emerald-400" :
                req.status === "submitted" ? "bg-blue-500/10 text-blue-400" :
                "bg-amber-500/10 text-amber-400"
              }`}>{req.status}</span>
            </div>
          </Card>
        ))}
      </div>
    </PortalLayout>
  );
}
