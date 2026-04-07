/**
 * AI Executive Summary Strip — calls the exec-summary-generator edge fn,
 * renders the returned markdown, with a refresh button + freshness chip.
 *
 * v1: deterministic template-driven generation. v2 will allow LLM rewrite
 * via a "mode=ai" flag without changing the UI.
 */
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Sparkles, RefreshCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import type { ExecRoleTab } from "../lib/types";

interface SummaryResponse {
  ok: boolean;
  role: string;
  generated_at: string;
  markdown: string;
  stats: { definitions: number; snapshots: number; alerts: number };
  error?: string;
}

interface Props {
  role: ExecRoleTab;
}

export function AiExecutiveSummaryStrip({ role }: Props) {
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["exec", "summary", role],
    queryFn: async (): Promise<SummaryResponse> => {
      const supa = supabase as unknown as {
        functions: { invoke: (name: string, opts: { body: Record<string, unknown> }) => Promise<{ data: SummaryResponse | null; error: { message?: string } | null }> };
      };
      const res = await supa.functions.invoke("exec-summary-generator", { body: { role } });
      if (res.error) throw new Error(res.error.message ?? "summary failed");
      return res.data ?? { ok: false, role, generated_at: "", markdown: "", stats: { definitions: 0, snapshots: 0, alerts: 0 } };
    },
    staleTime: 5 * 60_000,
  });

  return (
    <Card className="border-qep-orange/20 bg-gradient-to-r from-qep-orange/5 to-transparent p-4">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-qep-orange" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] uppercase tracking-wider text-qep-orange">Executive briefing</p>
            <Button size="sm" variant="ghost" disabled={isFetching} onClick={() => refetch()}>
              {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
            </Button>
          </div>
          {isLoading ? (
            <p className="mt-2 text-xs text-muted-foreground">Generating briefing…</p>
          ) : error ? (
            <p className="mt-2 text-xs text-red-400">{(error as Error).message}</p>
          ) : data?.markdown ? (
            <SummaryMarkdown markdown={data.markdown} />
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">No briefing yet.</p>
          )}
          {data && (
            <p className="mt-2 text-[10px] text-muted-foreground">
              {data.stats.definitions} metrics · {data.stats.snapshots} snapshots · {data.stats.alerts} alerts ·
              generated {new Date(data.generated_at).toLocaleTimeString()}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * Lightweight markdown renderer — just enough for headings + bullets +
 * bold + emoji. Avoids pulling react-markdown into the bundle.
 */
function SummaryMarkdown({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  const out: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("# ")) {
      out.push(<h2 key={i} className="mt-2 text-sm font-bold text-foreground">{line.slice(2)}</h2>);
    } else if (line.startsWith("## ")) {
      out.push(<h3 key={i} className="mt-2 text-[11px] uppercase tracking-wider text-muted-foreground">{line.slice(3)}</h3>);
    } else if (line.startsWith("- ")) {
      out.push(
        <p key={i} className="text-[11px] text-foreground" dangerouslySetInnerHTML={{
          __html: line.slice(2).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'),
        }} />
      );
    } else if (line.startsWith("_") && line.endsWith("_")) {
      out.push(<p key={i} className="mt-2 text-[10px] italic text-muted-foreground">{line.slice(1, -1)}</p>);
    } else if (line.trim() === "") {
      out.push(<div key={i} className="h-1" />);
    } else {
      out.push(<p key={i} className="text-[11px] text-foreground">{line}</p>);
    }
  }
  return <div className="mt-1 space-y-0.5">{out}</div>;
}
