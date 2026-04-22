import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

interface Props {
  jobId: string;
  existingQuoteId?: string;
}

export function ServiceQuoteBuilder({ jobId, existingQuoteId }: Props) {
  const qc = useQueryClient();
  const [laborRate, setLaborRate] = useState("");

  const generate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("service-quote-engine", {
        body: {
          action: "generate",
          job_id: jobId,
          ...(laborRate.trim() ? { labor_rate: Number(laborRate) } : {}),
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service-job", jobId] });
      qc.invalidateQueries({ queryKey: ["service-jobs"] });
    },
  });

  const send = useMutation({
    mutationFn: async (quoteId: string) => {
      const { data, error } = await supabase.functions.invoke("service-quote-engine", {
        body: { action: "send", quote_id: quoteId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service-job", jobId] });
      qc.invalidateQueries({ queryKey: ["service-jobs"] });
    },
  });

  const approve = useMutation({
    mutationFn: async (quoteId: string) => {
      const { data, error } = await supabase.functions.invoke("service-quote-engine", {
        body: { action: "approve", quote_id: quoteId, method: "phone" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service-job", jobId] });
      qc.invalidateQueries({ queryKey: ["service-jobs"] });
    },
  });

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Quote Builder</h3>

      <div className="flex items-center gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Labor Rate Override ($/hr)</label>
          <input
            type="number"
            value={laborRate}
            onChange={(e) => setLaborRate(e.target.value)}
            className="w-24 rounded-md border px-2 py-1 text-sm bg-background"
            placeholder="Auto"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Leave blank to use Labor Pricing rules.
          </p>
        </div>
        <button
          onClick={() => generate.mutate()}
          disabled={generate.isPending}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition mt-4"
        >
          {generate.isPending ? "Generating..." : "Generate Quote"}
        </button>
      </div>

      {generate.isError && (
        <p className="text-xs text-destructive">
          {(generate.error as Error)?.message ?? "Quote generation failed"}
        </p>
      )}

      {existingQuoteId && (
        <div className="flex gap-2">
          <button
            onClick={() => send.mutate(existingQuoteId)}
            disabled={send.isPending}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {send.isPending ? "Sending..." : "Send to Customer"}
          </button>
          <button
            onClick={() => approve.mutate(existingQuoteId)}
            disabled={approve.isPending}
            className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 transition"
          >
            {approve.isPending ? "Approving..." : "Record Approval"}
          </button>
        </div>
      )}
    </div>
  );
}
