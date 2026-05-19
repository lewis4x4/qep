import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { DeckSurface, StatusDot, type StatusTone } from "../components/command-deck";

type VoiceCaptureHealthRow = {
  id: string;
  workspace_id: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
  transcript: string | null;
  sync_status: string;
  sync_error: string | null;
  qrm_activity_id: string | null;
  qrm_synced_at: string | null;
  linked_deal_id: string | null;
  linked_company_id: string | null;
  linked_contact_id: string | null;
};

function minutesOld(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

function statusTone(row: VoiceCaptureHealthRow): StatusTone {
  const pendingOver5 = ["pending", "processing"].includes(row.sync_status) && minutesOld(row.created_at) > 5;
  const transcriptWithoutQrm = Boolean(row.transcript && row.transcript.trim()) && !row.qrm_activity_id;
  if (row.sync_status === "failed") return "hot";
  if (pendingOver5 || transcriptWithoutQrm) return "warm";
  if (row.sync_status === "synced") return "ok";
  return "active";
}

export function VoiceCaptureHealthPage() {
  const queryClient = useQueryClient();

  const healthQuery = useQuery({
    queryKey: ["qrm", "voice-capture-health"],
    queryFn: async () => {
      const [capturesResult, profilesResult] = await Promise.all([
        supabase
          .from("voice_captures")
          .select("id, workspace_id, user_id, created_at, updated_at, transcript, sync_status, sync_error, qrm_activity_id, qrm_synced_at, linked_deal_id, linked_company_id, linked_contact_id")
          .order("created_at", { ascending: false })
          .limit(250),
        supabase.from("profiles").select("id, full_name, email"),
      ]);

      if (capturesResult.error) throw new Error(capturesResult.error.message);
      if (profilesResult.error) throw new Error(profilesResult.error.message);

      const profiles = new Map(
        (profilesResult.data ?? []).map((p) => [p.id, p.full_name?.trim() || p.email?.trim() || p.id.slice(0, 8)]),
      );

      return {
        captures: ((capturesResult.data ?? []) as VoiceCaptureHealthRow[]).map((row) => ({
          ...row,
          user_id: profiles.get(row.user_id) ? `${profiles.get(row.user_id)} (${row.user_id.slice(0, 8)})` : row.user_id,
        })),
      };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const reprocessMutation = useMutation({
    mutationFn: async (captureId: string) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-capture-sync`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ capture_id: captureId }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: "Reprocess failed" }));
        throw new Error((payload as { error?: string }).error ?? "Reprocess failed");
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["qrm", "voice-capture-health"] });
    },
  });

  const board = useMemo(() => {
    const captures = healthQuery.data?.captures ?? [];
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const capturedToday = captures.filter((row) => new Date(row.created_at) >= startOfToday).length;
    const transcribed = captures.filter((row) => Boolean(row.transcript && row.transcript.trim())).length;
    const qrmAttached = captures.filter((row) => Boolean(row.qrm_activity_id)).length;
    const inboxFallback = captures.filter((row) => !row.linked_deal_id && !row.linked_company_id && !row.linked_contact_id).length;
    const failed = captures.filter((row) => row.sync_status === "failed").length;
    const pendingOver5 = captures.filter((row) => ["pending", "processing"].includes(row.sync_status) && minutesOld(row.created_at) > 5).length;
    const transcriptWithoutQrm = captures.filter((row) => Boolean(row.transcript && row.transcript.trim()) && !row.qrm_activity_id);

    return {
      captures,
      capturedToday,
      transcribed,
      qrmAttached,
      inboxFallback,
      failed,
      pendingOver5,
      transcriptWithoutQrm,
      needsAction: captures.filter((row) => row.sync_status === "failed" || (["pending", "processing"].includes(row.sync_status) && minutesOld(row.created_at) > 5) || (Boolean(row.transcript && row.transcript.trim()) && !row.qrm_activity_id)),
    };
  }, [healthQuery.data]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-12 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Voice Capture Health"
        subtitle="Operational visibility for voice capture → transcript → QRM attachment flow."
        crumb={{ surface: "OPS", lens: "HEALTH", count: board.needsAction.length }}
        metrics={[
          { label: "Captured today", value: board.capturedToday },
          { label: "Transcribed", value: board.transcribed },
          { label: "QRM attached", value: board.qrmAttached, tone: "ok" },
          { label: "Inbox fallback", value: board.inboxFallback, tone: board.inboxFallback > 0 ? "warm" : undefined },
          { label: "Failed", value: board.failed, tone: board.failed > 0 ? "hot" : undefined },
          { label: "Pending >5m", value: board.pendingOver5, tone: board.pendingOver5 > 0 ? "warm" : undefined },
        ]}
      />
      <QrmSubNav />

      {healthQuery.isLoading ? (
        <DeckSurface className="p-6 text-sm text-muted-foreground">Loading voice capture health…</DeckSurface>
      ) : healthQuery.isError ? (
        <DeckSurface className="border-qep-hot/40 bg-qep-hot/5 p-6 text-sm text-qep-hot">
          {healthQuery.error instanceof Error ? healthQuery.error.message : "Voice capture health is unavailable right now."}
        </DeckSurface>
      ) : (
        <>
          {board.transcriptWithoutQrm.length > 0 && (
            <DeckSurface className="border-amber-500/40 bg-amber-500/5 p-4 text-sm text-amber-100">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <p>
                  {board.transcriptWithoutQrm.length} transcript capture{board.transcriptWithoutQrm.length === 1 ? "" : "s"} have no QRM activity yet.
                </p>
              </div>
            </DeckSurface>
          )}

          <DeckSurface className="overflow-x-auto p-0">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Capture</th>
                  <th className="px-3 py-2 text-left">Workspace</th>
                  <th className="px-3 py-2 text-left">User</th>
                  <th className="px-3 py-2 text-left">Age</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Error</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {board.needsAction.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                      No captures currently need manual reprocess.
                    </td>
                  </tr>
                ) : (
                  board.needsAction.slice(0, 60).map((row) => (
                    <tr key={row.id} className="border-t border-border/60 align-top">
                      <td className="px-3 py-2 font-mono text-xs">{row.id}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row.workspace_id ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">{row.user_id}</td>
                      <td className="px-3 py-2 text-xs">{minutesOld(row.created_at)}m</td>
                      <td className="px-3 py-2 text-xs">
                        <span className="inline-flex items-center gap-1">
                          <StatusDot tone={statusTone(row)} />
                          {row.sync_status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{row.sync_error ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={reprocessMutation.isPending}
                          onClick={() => reprocessMutation.mutate(row.id)}
                        >
                          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reprocess
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </DeckSurface>

          <div className="text-xs text-muted-foreground">
            Endpoint-backed reprocess runs via <code>voice-capture-sync</code> with role/workspace checks. Need a broader queue? <Link to="/voice-qrm" className="underline">Open Voice-to-QRM</Link>.
          </div>
        </>
      )}
    </div>
  );
}
