import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

interface Props {
  jobId: string;
}

export function CompletionFeedbackForm({ jobId }: Props) {
  const qc = useQueryClient();
  const [actualProblemFixed, setActualProblemFixed] = useState<boolean | null>(null);
  const [additionalIssues, setAdditionalIssues] = useState("");
  const [missingParts, setMissingParts] = useState("");
  const [timeSaverNotes, setTimeSaverNotes] = useState("");
  const [serialSpecificNote, setSerialSpecificNote] = useState("");
  const [returnVisitRisk, setReturnVisitRisk] = useState("none");
  const [upsellSuggestions, setUpsellSuggestions] = useState("");
  const [actualHours, setActualHours] = useState<string>("");

  const submit = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("service-completion-feedback", {
        body: {
          job_id: jobId,
          actual_problem_fixed: actualProblemFixed,
          additional_issues: additionalIssues ? additionalIssues.split("\n").filter(Boolean).map((s) => ({ description: s })) : [],
          missing_parts: missingParts ? missingParts.split("\n").filter(Boolean).map((s) => ({ part: s })) : [],
          time_saver_notes: timeSaverNotes || null,
          serial_specific_note: serialSpecificNote || null,
          return_visit_risk: returnVisitRisk,
          upsell_suggestions: upsellSuggestions ? upsellSuggestions.split("\n").filter(Boolean).map((s) => ({ suggestion: s })) : [],
          actual_hours: actualHours ? Number(actualHours) : null,
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

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
        Completion Feedback
      </h3>

      <div>
        <label className="block text-sm font-medium mb-1">Actual problem fixed?</label>
        <div className="flex gap-3">
          <label className="flex items-center gap-1.5 text-sm">
            <input type="radio" name="fixed" checked={actualProblemFixed === true} onChange={() => setActualProblemFixed(true)} />
            Yes
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="radio" name="fixed" checked={actualProblemFixed === false} onChange={() => setActualProblemFixed(false)} />
            No
          </label>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Actual Hours Worked</label>
        <input
          type="number"
          step="0.5"
          value={actualHours}
          onChange={(e) => setActualHours(e.target.value)}
          placeholder="e.g. 4.5"
          className="w-32 rounded-md border px-3 py-1.5 text-sm bg-background"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Additional Issues Discovered</label>
        <textarea
          value={additionalIssues}
          onChange={(e) => setAdditionalIssues(e.target.value)}
          rows={2}
          placeholder="One per line..."
          className="w-full rounded-md border px-3 py-2 text-sm bg-background resize-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Missing Parts from Original Quote</label>
        <textarea
          value={missingParts}
          onChange={(e) => setMissingParts(e.target.value)}
          rows={2}
          placeholder="One per line..."
          className="w-full rounded-md border px-3 py-2 text-sm bg-background resize-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Time Saver for Next Time</label>
        <textarea
          value={timeSaverNotes}
          onChange={(e) => setTimeSaverNotes(e.target.value)}
          rows={2}
          placeholder="Tips for the next tech doing this job..."
          className="w-full rounded-md border px-3 py-2 text-sm bg-background resize-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Serial-Specific Note</label>
        <textarea
          value={serialSpecificNote}
          onChange={(e) => setSerialSpecificNote(e.target.value)}
          rows={2}
          placeholder="Anything unique about this specific machine..."
          className="w-full rounded-md border px-3 py-2 text-sm bg-background resize-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Return Visit Risk</label>
        <select
          value={returnVisitRisk}
          onChange={(e) => setReturnVisitRisk(e.target.value)}
          className="rounded-md border px-3 py-1.5 text-sm bg-background"
        >
          <option value="none">None</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Upsell / PM / Recall Suggestions</label>
        <textarea
          value={upsellSuggestions}
          onChange={(e) => setUpsellSuggestions(e.target.value)}
          rows={2}
          placeholder="One per line..."
          className="w-full rounded-md border px-3 py-2 text-sm bg-background resize-none"
        />
      </div>

      <button
        onClick={() => submit.mutate()}
        disabled={submit.isPending}
        className="w-full rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition"
      >
        {submit.isPending ? "Submitting..." : "Submit Feedback"}
      </button>

      {submit.isSuccess && (
        <p className="text-sm text-green-600 font-medium">Feedback submitted successfully</p>
      )}
      {submit.isError && (
        <p className="text-xs text-destructive">
          {(submit.error as Error)?.message ?? "Submission failed"}
        </p>
      )}
    </div>
  );
}
