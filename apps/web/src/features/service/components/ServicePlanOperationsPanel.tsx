import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// New migration RPCs are deliberately narrowed here until generated types refresh.
const db = supabase as unknown as { from: typeof supabase.from; rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };
type Program = { id: string; name: string; is_active: boolean; is_provisional: boolean; review_status: string; review_notes: string | null };
export function ServicePlanOperationsPanel() {
  const { profile } = useAuth();
  const ws = profile?.active_workspace_id;
  const qc = useQueryClient();
  const canManage = ["admin", "manager", "owner"].includes(profile?.role ?? "");
  const [programId, setProgramId] = useState("");
  const [agreementId, setAgreementId] = useState("");
  const [baseline, setBaseline] = useState("");
  const [enrolledOn, setEnrolledOn] = useState(new Date().toISOString().slice(0, 10));
  const [reviewNotes, setReviewNotes] = useState("");
  const [intervalCode, setIntervalCode] = useState("");
  const [intervalHours, setIntervalHours] = useState("");
  const [intervalDays, setIntervalDays] = useState("");
  const query = useQuery({
    queryKey: ["service-plan-operations", ws], enabled: !!ws, refetchInterval: 30000,
    queryFn: async () => {
      const results = await Promise.all([
        supabase.from("service_agreement_programs").select("id,name,is_active,is_provisional,review_status,review_notes").eq("workspace_id", ws!).is("deleted_at", null),
        supabase.from("service_agreements").select("id,contract_number,equipment_id,status").eq("workspace_id", ws!).is("deleted_at", null),
        supabase.from("service_plan_equipment_enrollments").select("id,service_agreement_id,status").eq("workspace_id", ws!),
        supabase.from("service_agreement_program_intervals").select("id,program_id,name,interval_hours,interval_days,interval_months").eq("workspace_id", ws!).eq("is_active", true),
        supabase.from("service_plan_schedule_prompts").select("id,service_job_id,created_at,evidence,job:service_jobs!inner(scheduled_start_at,current_stage)").eq("workspace_id", ws!).is("job.scheduled_start_at", null).is("job.deleted_at", null).not("job.current_stage", "in", "(paid_closed,invoiced)").order("created_at", { ascending: false }).limit(100),
        supabase.from("service_agreement_entitlement_balances").select("*").eq("workspace_id", ws!),
      ]);
      for (const result of results) if (result.error) throw result.error;
      return { programs: results[0].data as Program[], agreements: results[1].data!, enrollments: results[2].data!, intervals: results[3].data!, prompts: (results[4].data ?? []).filter(prompt => { const job = Array.isArray(prompt.job) ? prompt.job[0] : prompt.job; return job && !job.scheduled_start_at && !["paid_closed", "invoiced"].includes(job.current_stage); }), balances: results[5].data! };
    },
  });
  const selectedProgram = query.data?.programs.find(program => program.id === programId);
  const action = useMutation({
    mutationFn: async (kind: "interval" | "review" | "activate" | "deactivate" | "enroll") => {
      if (!ws || !profile?.id || !canManage) throw new Error("A manager in an active workspace is required.");
      const common = { p_workspace_id: ws, p_program_id: programId };
      const input = kind === "interval" ? { name: "service_plan_save_program_interval", args: { ...common, p_interval_code: intervalCode.trim(), p_name: intervalCode.trim(), p_interval_hours: intervalHours ? Number(intervalHours) : null, p_interval_days: intervalDays ? Number(intervalDays) : null, p_interval_months: null, p_source_evidence: { review_notes: reviewNotes }, p_actor_id: profile.id } }
        : kind === "review" ? { name: "service_plan_review_program", args: { ...common, p_reviewer_id: profile.id, p_review_notes: reviewNotes } }
        : kind === "enroll" ? { name: "service_enroll_agreement", args: { p_agreement_id: agreementId, p_program_id: programId, p_enrolled_on: enrolledOn, p_baseline_hours: baseline ? Number(baseline) : null } }
        : { name: "service_plan_set_program_activation", args: { ...common, p_is_active: kind === "activate", p_actor_id: profile.id } };
      const { error } = await db.rpc(input.name, input.args);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["service-plan-operations"] }); await qc.invalidateQueries({ queryKey: ["service-agreements"] }); },
  });
  return <Card className="p-5 space-y-4">
    <h2 className="text-lg font-semibold">Plan review, enrollment and PM scheduling</h2>
    <p className="text-sm text-muted-foreground">Recording an agreement does not enroll its machine. Provisional plans remain inactive until a manager reviews the actual intervals and explicitly activates the program.</p>
    {query.isLoading && <p>Loading plan evidence…</p>}
    {query.error && <p role="alert" className="text-destructive">{query.error.message}</p>}
    <div className="grid gap-3 md:grid-cols-2">
      <label className="text-sm">Program<select aria-label="PM program" className="block w-full rounded border p-2" value={programId} onChange={e => setProgramId(e.target.value)}><option value="">Choose a program</option>{query.data?.programs.map(program => <option key={program.id} value={program.id}>{program.name} · {program.is_active ? "active" : program.is_provisional ? "provisional" : program.review_status}</option>)}</select></label>
      <label className="text-sm">Review evidence<textarea aria-label="PM review evidence" className="block w-full rounded border p-2" value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} placeholder="Owner-approved catalog reference and review notes" /></label>
    </div>
    {selectedProgram && <>
      <p className="text-sm">Recorded review: {selectedProgram.review_notes ?? "Not reviewed"}</p>
      <ul className="text-sm list-disc pl-5">{query.data?.intervals.filter(interval => interval.program_id === programId).map(interval => <li key={interval.id}>{interval.name}: {interval.interval_hours ?? "—"} hours / {interval.interval_days ?? "—"} days / {interval.interval_months ?? "—"} months</li>)}</ul>
      {canManage && <div className="space-y-3">
        {!selectedProgram.is_active && <div className="flex flex-wrap gap-2"><input aria-label="PM interval name" className="rounded border p-2" placeholder="Interval name/code" value={intervalCode} onChange={e => setIntervalCode(e.target.value)} /><input aria-label="PM interval hours" className="rounded border p-2" type="number" min="1" placeholder="Hours" value={intervalHours} onChange={e => setIntervalHours(e.target.value)} /><input aria-label="PM interval days" className="rounded border p-2" type="number" min="1" placeholder="Days" value={intervalDays} onChange={e => setIntervalDays(e.target.value)} /><Button disabled={action.isPending || !intervalCode || (!intervalHours && !intervalDays)} onClick={() => action.mutate("interval")}>Save interval</Button></div>}
        <div className="flex flex-wrap gap-2"><Button disabled={action.isPending || selectedProgram.is_active || !reviewNotes.trim()} onClick={() => action.mutate("review")}>Record program review</Button><Button disabled={action.isPending || selectedProgram.is_active || selectedProgram.is_provisional || selectedProgram.review_status !== "reviewed"} onClick={() => action.mutate("activate")}>Activate reviewed program</Button><Button variant="outline" disabled={action.isPending || !selectedProgram.is_active} onClick={() => action.mutate("deactivate")}>Deactivate</Button></div>
        <div className="grid gap-2 md:grid-cols-4"><select aria-label="Agreement to enroll" className="rounded border p-2" value={agreementId} onChange={e => setAgreementId(e.target.value)}><option value="">Agreement to enroll</option>{query.data?.agreements.filter(a => a.equipment_id).map(a => <option key={a.id} value={a.id}>{a.contract_number} · {query.data?.enrollments.some(e => e.service_agreement_id === a.id && e.status === "active") ? "enrolled" : "not enrolled"}</option>)}</select><input aria-label="Enrollment date" className="rounded border p-2" type="date" value={enrolledOn} onChange={e => setEnrolledOn(e.target.value)} /><input aria-label="Baseline machine hours" className="rounded border p-2" type="number" min="0" step="0.1" placeholder="Baseline hours (or actual meter)" value={baseline} onChange={e => setBaseline(e.target.value)} /><Button disabled={action.isPending || !agreementId || !selectedProgram.is_active} onClick={() => action.mutate("enroll")}>Enroll machine</Button></div>
      </div>}
    </>}
    {action.error && <p role="alert" className="text-destructive">{action.error.message}</p>}
    {action.isSuccess && <p role="status">Saved. Plan status and enrollment evidence refreshed.</p>}
    <div><h3 className="font-semibold">PM scheduling prompts</h3><p className="text-xs text-muted-foreground">Open the generated work order to set its schedule. These prompts are not evidence of customer message delivery.</p>{query.data?.prompts.length === 0 && <p className="text-sm">No PM scheduling prompts.</p>}{query.data?.prompts.length === 100 && <p className="text-sm">Showing the newest 100 pending scheduling prompts.</p>}{query.data?.prompts.map(prompt => <Link className="block rounded border p-2 text-sm" key={prompt.id} to={`/service?job=${prompt.service_job_id}`}>Schedule PM work order · {new Date(prompt.created_at).toLocaleDateString()}</Link>)}</div>
    <details><summary className="cursor-pointer text-sm font-semibold">Entitlement balances</summary><div className="space-y-2">{query.data?.balances.map(balance => <p className="text-sm" key={`${balance.service_agreement_id}:${balance.unit_code}`}>{query.data?.agreements.find(agreement => agreement.id === balance.service_agreement_id)?.contract_number ?? "Agreement"} · {balance.unit_code}: {balance.available_quantity} available, {balance.reserved_quantity} reserved, {balance.consumed_quantity} used</p>)}</div></details>
  </Card>;
}
