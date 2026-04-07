/**
 * Command Center Export Menu — generates the role-specific exec packet
 * via the exec-packet-generator edge fn, previews the markdown, and
 * exposes a download button for the .md file.
 *
 * Slice 6.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FileDown, Loader2, Download, Check } from "lucide-react";
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

interface Props {
  role: ExecRoleTab;
}

export function CommandCenterExportMenu({ role }: Props) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [packet, setPacket] = useState<PacketResponse | null>(null);

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
    },
  });

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
    void (supabase as unknown as {
      from: (t: string) => { update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> } };
      rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
    }).from("exec_packet_runs").update({ delivery_status: "downloaded", delivered_at: new Date().toISOString() }).eq("id", packet.run_id ?? "");
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
        </SheetContent>
      </Sheet>
    </>
  );
}
