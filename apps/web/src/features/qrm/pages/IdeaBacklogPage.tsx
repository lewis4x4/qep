import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Lightbulb, Plus, Mic, Loader2, Check, X, Clock, Rocket,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

interface Idea {
  id: string;
  title: string;
  body: string | null;
  source: "voice" | "text" | "meeting" | "email";
  status: "new" | "triaged" | "in_progress" | "shipped" | "declined";
  priority: "low" | "medium" | "high" | "critical";
  tags: string[];
  captured_by: string | null;
  captured_at: string;
  ai_confidence: number | null;
}

const STATUS_META: Record<Idea["status"], { label: string; color: string; icon: React.ReactNode }> = {
  new:         { label: "New",         color: "text-blue-400 border-blue-500/30",        icon: <Lightbulb className="h-3 w-3" /> },
  triaged:     { label: "Triaged",     color: "text-violet-400 border-violet-500/30",    icon: <Clock className="h-3 w-3" /> },
  in_progress: { label: "In progress", color: "text-qep-orange border-qep-orange/30",    icon: <Loader2 className="h-3 w-3" /> },
  shipped:     { label: "Shipped",     color: "text-emerald-400 border-emerald-500/30",  icon: <Rocket className="h-3 w-3" /> },
  declined:    { label: "Declined",    color: "text-muted-foreground border-border",     icon: <X className="h-3 w-3" /> },
};

export function IdeaBacklogPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({ title: "", body: "", priority: "medium" as Idea["priority"] });
  const [statusFilter, setStatusFilter] = useState<Idea["status"] | "all">("all");

  const { data: ideas = [], isLoading } = useQuery({
    queryKey: ["idea-backlog"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { order: (c: string, o: Record<string, boolean>) => { limit: (n: number) => Promise<{ data: Idea[] | null; error: unknown }> } } };
      }).from("qrm_idea_backlog")
        .select("*")
        .order("captured_at", { ascending: false })
        .limit(200);
      if (error) throw new Error("Failed to load idea backlog");
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!draft.title.trim()) throw new Error("Title required");
      const { error } = await (supabase as unknown as {
        from: (t: string) => { insert: (v: Record<string, unknown>) => Promise<{ error: unknown }> };
      }).from("qrm_idea_backlog").insert({
        title: draft.title.trim(),
        body: draft.body.trim() || null,
        priority: draft.priority,
        source: "text",
        status: "new",
      });
      if (error) throw new Error(String((error as { message?: string }).message ?? "Insert failed"));
    },
    onSuccess: () => {
      setDraft({ title: "", body: "", priority: "medium" });
      setShowCreate(false);
      queryClient.invalidateQueries({ queryKey: ["idea-backlog"] });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (input: { id: string; status: Idea["status"] }) => {
      const patch: Record<string, unknown> = { status: input.status };
      if (input.status === "shipped") patch.shipped_at = new Date().toISOString();
      if (input.status === "triaged") patch.triaged_at = new Date().toISOString();
      const { error } = await (supabase as unknown as {
        from: (t: string) => { update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: unknown }> } };
      }).from("qrm_idea_backlog").update(patch).eq("id", input.id);
      if (error) throw new Error("Update failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["idea-backlog"] }),
  });

  const filtered = statusFilter === "all" ? ideas : ideas.filter((i) => i.status === statusFilter);
  const counts = ideas.reduce<Record<string, number>>((acc, i) => {
    acc[i.status] = (acc[i.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-qep-orange" aria-hidden />
            <h1 className="text-xl font-bold text-foreground">Idea Backlog</h1>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Owner / rep idea capture. Voice path coming next: speak "idea: …" or "process improvement: …" anywhere
            voice-to-QRM is recording and the idea lands here automatically.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
          <Plus className="mr-1 h-3 w-3" /> {showCreate ? "Cancel" : "New idea"}
        </Button>
      </div>

      {showCreate && (
        <Card className="p-4 border-qep-orange/30">
          <div className="space-y-2">
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Title</label>
              <input
                type="text"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="One-line headline of the idea"
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Detail</label>
              <textarea
                value={draft.body}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                rows={4}
                placeholder="What problem does this solve? Who benefits?"
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Priority</label>
              <select
                value={draft.priority}
                onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value as Idea["priority"] }))}
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button
                size="sm"
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !draft.title.trim()}
              >
                {createMutation.isPending ? "Saving…" : "Capture"}
              </Button>
            </div>
            {createMutation.isError && (
              <p className="text-xs text-red-400">{(createMutation.error as Error).message}</p>
            )}
          </div>
          <div className="mt-3 flex items-center gap-1 text-[10px] text-muted-foreground">
            <Mic className="h-3 w-3" />
            Voice capture: drop into Voice QRM and start a sentence with "idea:" or "we should:".
          </div>
        </Card>
      )}

      {/* Status filter */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setStatusFilter("all")}
          className={`rounded-full border px-3 py-1 text-[11px] font-medium ${
            statusFilter === "all"
              ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
              : "border-border text-muted-foreground hover:border-foreground/20"
          }`}
        >
          All ({ideas.length})
        </button>
        {(Object.keys(STATUS_META) as Idea["status"][]).map((s) => {
          const meta = STATUS_META[s];
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium ${
                statusFilter === s
                  ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
                  : "border-border text-muted-foreground hover:border-foreground/20"
              }`}
            >
              {meta.label} ({counts[s] ?? 0})
            </button>
          );
        })}
      </div>

      {/* List */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-16 animate-pulse" />)}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <Card className="border-dashed p-8 text-center">
          <Lightbulb className="mx-auto h-8 w-8 text-muted-foreground mb-2" aria-hidden />
          <p className="text-sm text-foreground">No ideas captured yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Click "New idea" or speak one into Voice QRM with "idea:" as the lead phrase.
          </p>
        </Card>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((idea) => {
            const meta = STATUS_META[idea.status];
            return (
              <Card key={idea.id} className={`p-3 ${meta.color}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase ${meta.color.split(" ")[0]}`}>
                        {meta.icon}
                        {meta.label}
                      </span>
                      {idea.priority !== "medium" && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground uppercase">
                          {idea.priority}
                        </span>
                      )}
                      {idea.source === "voice" && (
                        <span className="flex items-center gap-0.5 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-blue-400">
                          <Mic className="h-2.5 w-2.5" /> voice
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-foreground">{idea.title}</p>
                    {idea.body && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-3">{idea.body}</p>
                    )}
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Captured {new Date(idea.captured_at).toLocaleString()}
                    </p>
                  </div>
                  {idea.status === "new" && (
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="ghost" className="h-6 text-[10px]"
                        onClick={() => updateStatusMutation.mutate({ id: idea.id, status: "declined" })}>
                        <X className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-[10px]"
                        onClick={() => updateStatusMutation.mutate({ id: idea.id, status: "triaged" })}>
                        <Check className="h-3 w-3" /> Triage
                      </Button>
                    </div>
                  )}
                  {idea.status === "triaged" && (
                    <Button size="sm" variant="outline" className="h-6 shrink-0 text-[10px]"
                      onClick={() => updateStatusMutation.mutate({ id: idea.id, status: "in_progress" })}>
                      Start
                    </Button>
                  )}
                  {idea.status === "in_progress" && (
                    <Button size="sm" variant="outline" className="h-6 shrink-0 text-[10px]"
                      onClick={() => updateStatusMutation.mutate({ id: idea.id, status: "shipped" })}>
                      <Rocket className="h-3 w-3" /> Shipped
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
