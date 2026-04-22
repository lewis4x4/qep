import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Lightbulb, Plus, Mic, Loader2, Check, X, Clock, Rocket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeckSurface } from "../components/command-deck";
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

export function IdeaBacklogPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({ title: "", body: "", priority: "medium" });
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
        from: (t: string) => { insert: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: unknown }> } };
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
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-qep-orange">Field OS</p>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Mobile Field Command</h1>
          </div>
          <p className="text-sm text-muted-foreground">Fast field priorities, voice capture, and command links designed for road.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <QuickAction to="/voice-qrm" icon={Mic} label="Voice note" />
        <QuickAction to="/qrm/visit-intelligence" icon={Clock} label="Visit brief" />
        <QuickAction to="/qrm/deals" icon={Route} label="My deals" />
        <QuickAction to="/qrm/companies" icon={Building2} label="Accounts" />
        <QuickAction to="/qrm/time-bank" icon={Timer} label="Time bank" />
        <QuickAction to="/fleet" icon={MapIcon} label="Fleet map" />
        <QuickAction to="/qrm" icon={Route} label="Full QRM" />
      </div>

      {isLoading && (
        <div className="space-y-3">
          <div className="h-8 bg-muted/20 rounded-sm animate-pulse" />
          <div className="h-8 bg-muted/20 rounded-sm animate-pulse" />
        </div>
      )}

      {showCreate && (
        <DeckSurface className="border-qep-orange/30">
          <div className="space-y-2">
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Title</label>
              <input
                type="text"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="One-line headline of the idea"
                className="mt-1 w-full rounded-md border border-qep-deck-rule bg-card px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Detail</label>
              <textarea
                value={draft.body}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                rows={4}
                placeholder="What problem does this solve? Who benefits?"
                className="mt-1 w-full rounded-md border border-qep-deck-rule bg-card px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Priority</label>
              <select
                value={draft.priority}
                onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value as Idea["priority"] }))}
                className="mt-1 w-full rounded-md border border-qep-deck-rule bg-card px-2 py-1.5 text-sm"
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
          </div>
        </DeckSurface>
      )}

      {filtered.length === 0 && (
        <DeckSurface className="border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">No ideas captured yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Click <strong className="font-medium text-foreground">New idea</strong> or speak one into Voice QRM with <strong className="font-medium text-foreground">"idea:"</strong> as a lead phrase.
          </p>
        </DeckSurface>
      )}

      {filtered.length > 0 && (
        <>
          <div className="grid grid-cols-4 gap-3">
            <DeckSurface className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">New</p>
              <p className="mt-3 text-2xl font-semibold text-foreground">{counts.new ?? 0}</p>
              <p className="mt-1 text-xs text-muted-foreground">Fresh entries needing triage.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Triaged</p>
              <p className="mt-3 text-2xl font-semibold text-foreground">{counts.triaged ?? 0}</p>
              <p className="mt-1 text-xs text-muted-foreground">Ideas in progress queue awaiting owner action.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">In Progress</p>
              <p className="mt-3 text-2xl font-semibold text-foreground">{counts.in_progress ?? 0}</p>
              <p className="mt-1 text-xs text-muted-foreground">Active work items with clear next steps.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Shipped</p>
              <p className="mt-3 text-2xl font-semibold text-foreground">{counts.shipped ?? 0}</p>
              <p className="mt-1 text-xs text-muted-foreground">Delivered features that customers have received.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Declined</p>
              <p className="mt-3 text-2xl font-semibold text-foreground">{counts.declined ?? 0}</p>
              <p className="mt-1 text-xs text-muted-foreground">Ideas not pursued after customer feedback.</p>
            </DeckSurface>
          </div>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Today&apos;s priorities</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Owner / rep idea capture. Voice path coming next: speak "idea: …" or "we should:" for process improvements.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setShowCreate((v) => !v)}>
                <Plus className="mr-1 h-3 w-3" /> {showCreate ? "Cancel" : "New idea"}
              </Button>
            </div>
          </DeckSurface>

          <div className="grid grid-cols-2 gap-3">
            {filtered.map((idea) => {
              const meta = idea.status === "new"
                ? { label: "New", color: "text-blue-400 border-blue-500/30", icon: <Lightbulb className="h-3 w-3" /> }
                : idea.status === "triaged"
                ? { label: "Triaged", color: "text-violet-400 border-violet-500/30", icon: <Clock className="h-3 w-3" /> }
                : idea.status === "in_progress"
                ? { label: "In progress", color: "text-qep-orange border-qep-orange/30", icon: <Loader2 className="h-3 w-3" /> }
                : idea.status === "shipped"
                ? { label: "Shipped", color: "text-emerald-400 border-emerald-500/30", icon: <Rocket className="h-3 w-3" /> }
                : idea.status === "declined"
                ? { label: "Declined", color: "text-muted-foreground border-border", icon: <X className="h-3 w-3" /> }
                : { label: "Unknown", color: "text-muted-foreground border-border", icon: <X className="h-3 w-3" /> };

              return (
                <div key={idea.id} className="rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{idea.title}</p>
                        {idea.source === "voice" && (
                          <span className="flex items-center gap-1 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-blue-400">
                            <Mic className="h-2 w-2" /> voice
                          </span>
                        )}
                      </div>
                      <div className="mt-3">
                        {idea.body && (
                          <p className="text-xs text-muted-foreground line-clamp-2">{idea.body}</p>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                          Captured {new Date(idea.captured_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </p>
                      </div>
                    </div>
                    {idea.status === "new" && (
                      <div className="mt-3 flex shrink-0">
                        <Button size="sm" variant="ghost" onClick={() => updateStatusMutation.mutate({ id: idea.id, status: "triaged" })}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {isLoading && (
        <div className="space-y-3">
          <div className="h-8 bg-muted/20 rounded-sm animate-pulse" />
          <div className="h-8 bg-muted/20 rounded-sm animate-pulse" />
        </div>
      )}
    </div>
  );
}

function QuickAction({ to, icon: Icon, label }: { to: string; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <Link
      to={to}
      className="flex min-h-[72px] flex-col justify-between rounded-xl border border-qep-deck-rule bg-card px-4 py-3 transition hover:border-qep-orange/40 hover:bg-qep-orange/5"
    >
      <Icon className="h-5 w-5 text-qep-orange" aria-hidden />
      <span className="text-sm font-medium text-foreground">{label}</span>
    </Link>
  );
}
