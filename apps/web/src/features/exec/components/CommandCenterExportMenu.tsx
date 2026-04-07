/**
 * Command Center Export Menu — generates the role-specific exec packet
 * via the exec-packet-generator edge fn, previews the markdown, and
 * exposes a download button for the .md file.
 *
 * Slice 6.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FileDown, Loader2, Download, Check, History } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { ExecRoleTab } from "../lib/types";

interface PacketResponse {
  ok: boolean;
  run_id: string | null;
  role: string;
  generated_at: string;
  markdown: string;
  json: Record<string, unknown>;
  stats: { definitions: number; snapshots: number; alerts: number };
  error?: string;
}

interface PacketRunRow {
  id: string;
  generated_at: string;
  packet_md: string;
  metrics_count: number;
  alerts_count: number;
  delivery_status: string | null;
  delivered_at: string | null;
}

interface Props {
  role: ExecRoleTab;
}

export function CommandCenterExportMenu({ role }: Props) {
  const queryClient = useQueryClient();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [packet, setPacket] = useState<PacketResponse | null>(null);

  const { data: history = [] } = useQuery({
    queryKey: ["exec", "packet-runs", role],
    queryFn: async (): Promise<PacketRunRow[]> => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (c: string, v: string) => {
              order: (c: string, o: { ascending: boolean }) => {
                limit: (n: number) => Promise<{ data: PacketRunRow[] | null; error: unknown }>;
              };
            };
          };
        };
      }).from("exec_packet_runs")
        .select("id, generated_at, packet_md, metrics_count, alerts_count, delivery_status, delivered_at")
        .eq("role", role)
        .order("generated_at", { ascending: false })
        .limit(5);
      if (error) throw new Error("packet history load failed");
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const generate = useMutation({
    mutationFn: async (): Promise<PacketResponse> => {
      const supa = supabase as unknown as {
        functions: { invoke: (name: string, opts: { body: Record<string, unknown> }) => Promise<{ data: PacketResponse | null; error: { message?: string } | null }> };
      };
      const res = await supa.functions.invoke("exec-packet-generator", { body: { role } });
      if (res.error) throw new Error(res.error.message ?? "packet generation failed");
      if (!res.data?.ok) throw new Error(res.data?.error ?? "packet generation failed");
      return res.data;
    },
    onSuccess: (data) => {
      setPacket(data);
      setPreviewOpen(true);
      queryClient.invalidateQueries({ queryKey: ["exec", "packet-runs", role] });
    },
  });

  const markDelivered = useMutation({
    mutationFn: async (input: { runId: string; deliveryStatus: "previewed" | "downloaded" }) => {
      const patch: Record<string, unknown> = {
        delivery_status: input.deliveryStatus,
      };
      if (input.deliveryStatus === "downloaded") {
        patch.delivered_at = new Date().toISOString();
      }
      const { error } = await (supabase as unknown as {
        from: (t: string) => {
          update: (v: Record<string, unknown>) => {
            eq: (c: string, v: string) => Promise<{ error: unknown }>;
          };
        };
      }).from("exec_packet_runs").update(patch).eq("id", input.runId);
      if (error) throw new Error("packet status update failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exec", "packet-runs", role] });
    },
  });

  useEffect(() => {
    if (!previewOpen || !packet?.run_id) return;
    if (packet.run_id && history.some((row) => row.id === packet.run_id && row.delivery_status === "previewed")) {
      return;
    }
    markDelivered.mutate({ runId: packet.run_id, deliveryStatus: "previewed" });
  }, [previewOpen, packet?.run_id]);

  function downloadPacket() {
    if (!packet) return;
    const blob = new Blob([packet.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qep-${role}-packet-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Audit + status update
    if (packet.run_id) {
      markDelivered.mutate({ runId: packet.run_id, deliveryStatus: "downloaded" });
    }
  }

  function openHistoryRun(run: PacketRunRow) {
    setPacket({
      ok: true,
      run_id: run.id,
      role,
      generated_at: run.generated_at,
      markdown: run.packet_md,
      json: {},
      stats: {
        definitions: run.metrics_count,
        snapshots: 0,
        alerts: run.alerts_count,
      },
    });
    setPreviewOpen(true);
  }

  function deliveryLabel(status: string | null): string {
    if (status === "downloaded") return "Downloaded";
    if (status === "emailed") return "Emailed";
    if (status === "previewed") return "Previewed";
    return "Generated";
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={generate.isPending}
        onClick={() => generate.mutate()}
      >
        {generate.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <FileDown className="mr-1 h-3 w-3" />}
        Generate packet
      </Button>

      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{role.toUpperCase()} Executive Packet</SheetTitle>
            <SheetDescription>
              {packet ? `${packet.stats.definitions} metrics · ${packet.stats.snapshots} snapshots · ${packet.stats.alerts} alerts` : ""}
            </SheetDescription>
          </SheetHeader>

          {packet && (
            <>
              <div className="mt-4 flex items-center justify-between">
                <p className="text-[10px] text-muted-foreground">
                  Generated {new Date(packet.generated_at).toLocaleString()}
                </p>
                <Button size="sm" onClick={downloadPacket}>
                  <Download className="mr-1 h-3 w-3" /> Download .md
                </Button>
              </div>
              <Card className="mt-3 p-4">
                <pre className="whitespace-pre-wrap font-mono text-[10px] text-foreground">{packet.markdown}</pre>
              </Card>
              <p className="mt-2 flex items-center gap-1 text-[10px] text-emerald-400">
                <Check className="h-3 w-3" /> Packet persisted to exec_packet_runs (id: {packet.run_id?.slice(0, 8)}…)
              </p>
            </>
          )}

          <Card className="mt-4 p-4">
            <div className="mb-2 flex items-center gap-2">
              <History className="h-3.5 w-3.5 text-qep-orange" />
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Recent packet runs</p>
            </div>
            {history.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No prior packet runs for this lens yet.</p>
            ) : (
              <div className="space-y-2">
                {history.map((run) => (
                  <div key={run.id} className="flex items-center justify-between gap-3 rounded border border-border/60 bg-muted/10 p-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-foreground">
                        {new Date(run.generated_at).toLocaleString()}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {run.metrics_count} metrics · {run.alerts_count} alerts
                        {run.delivered_at ? ` · delivered ${new Date(run.delivered_at).toLocaleDateString()}` : ""}
                      </p>
                    </div>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-semibold text-muted-foreground">
                      {deliveryLabel(run.delivery_status)}
                    </span>
                    <Button size="sm" variant="outline" onClick={() => openHistoryRun(run)}>
                      Open
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </SheetContent>
      </Sheet>
    </>
  );
}
