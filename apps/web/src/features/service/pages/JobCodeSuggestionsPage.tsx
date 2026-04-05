import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ServiceSubNav } from "../components/ServiceSubNav";

type JobCodeEmbed = {
  job_name?: string;
  make?: string;
  parts_template?: unknown;
  common_add_ons?: unknown;
};

function pickJobCodeEmbed(jc: unknown): JobCodeEmbed | null {
  if (jc == null) return null;
  if (Array.isArray(jc)) return (jc[0] as JobCodeEmbed) ?? null;
  if (typeof jc === "object") return jc as JobCodeEmbed;
  return null;
}

export function JobCodeSuggestionsPage() {
  const qc = useQueryClient();

  const { data: suggestions = [], isLoading } = useQuery({
    queryKey: ["job-code-suggestions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_code_template_suggestions")
        .select(`
          id,
          job_code_id,
          observation_count,
          review_status,
          suggested_parts_template,
          suggested_common_add_ons,
          updated_at,
          job_codes ( job_name, make, parts_template, common_add_ons )
        `)
        .eq("review_status", "pending")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const merge = useMutation({
    mutationFn: async (suggestionId: string) => {
      const { data, error } = await supabase.functions.invoke("service-jobcode-suggestion-merge", {
        body: { suggestion_id: suggestionId },
      });
      if (error) throw error;
      if (data && typeof data === "object" && "error" in data) {
        throw new Error(String((data as { error?: string }).error));
      }
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job-code-suggestions"] }),
  });

  const reject = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("job_code_template_suggestions")
        .update({ review_status: "rejected", updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job-code-suggestions"] }),
  });

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 space-y-6">
      <ServiceSubNav />
      <div>
        <h1 className="text-2xl font-semibold">Job code suggestions</h1>
        <p className="text-sm text-muted-foreground">
          Pending template changes from the learner. Approve merges into production job codes.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : suggestions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pending suggestions.</p>
      ) : (
        <div className="space-y-4">
          {suggestions.map((s: {
            id: string;
            job_code_id: string;
            observation_count: number;
            suggested_parts_template: unknown;
            suggested_common_add_ons: unknown;
            job_codes: unknown;
          }) => {
            const jc = pickJobCodeEmbed(s.job_codes);
            return (
            <Card key={s.id} className="p-4 space-y-2">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <span className="font-medium">{jc?.job_name ?? s.job_code_id}</span>
                  <span className="text-muted-foreground text-sm ml-2">{jc?.make}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {s.observation_count} observations
                </span>
              </div>
              <pre className="text-[10px] bg-muted/50 rounded p-2 overflow-x-auto max-h-32">
                {JSON.stringify({ suggested: s.suggested_parts_template, current: jc?.parts_template }, null, 0)}
              </pre>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={merge.isPending}
                  onClick={() => merge.mutate(s.id)}
                >
                  Approve merge
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={reject.isPending}
                  onClick={() => reject.mutate(s.id)}
                >
                  Reject
                </Button>
              </div>
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
