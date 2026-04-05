import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { reassignFromBranchPool } from "../lib/api";
import { SERVICE_STAGES } from "../lib/constants";

export function ServiceBranchConfigPage() {
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState("");
  const [advisorJson, setAdvisorJson] = useState("[]");
  const [techJson, setTechJson] = useState("[]");
  const [notifyJson, setNotifyJson] = useState("[]");
  const [plannerRulesJson, setPlannerRulesJson] = useState("{}");
  const [businessHoursJson, setBusinessHoursJson] = useState("{}");
  const [appointmentSlotMinutes, setAppointmentSlotMinutes] = useState("60");
  const [notes, setNotes] = useState("");
  const [fromUser, setFromUser] = useState("");
  const [reassignRole, setReassignRole] = useState<"advisor" | "technician">("advisor");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["service-branch-config"],
    queryFn: async () => {
      const { data, error } = await supabase.from("service_branch_config").select("*").order("branch_id");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: tatTargets = [] } = useQuery({
    queryKey: ["service-tat-targets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_tat_targets")
        .select("*")
        .order("current_stage");
      if (error) throw error;
      return data ?? [];
    },
  });

  const selected = useMemo(
    () => rows.find((r) => r.branch_id === branchId),
    [rows, branchId],
  );

  const loadBranch = (id: string) => {
    setBranchId(id);
    const r = rows.find((x) => x.branch_id === id);
    if (!r) return;
    setAdvisorJson(JSON.stringify(r.default_advisor_pool ?? [], null, 2));
    setTechJson(JSON.stringify(r.default_technician_pool ?? [], null, 2));
    setNotifyJson(JSON.stringify(r.parts_team_notify_user_ids ?? [], null, 2));
    setPlannerRulesJson(JSON.stringify((r as { planner_rules?: unknown }).planner_rules ?? {}, null, 2));
    setBusinessHoursJson(JSON.stringify((r as { business_hours?: unknown }).business_hours ?? { weekdays: [] }, null, 2));
    setAppointmentSlotMinutes(
      String((r as { appointment_slot_minutes?: number }).appointment_slot_minutes ?? 60),
    );
    setNotes(r.notes ?? "");
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!branchId.trim()) throw new Error("Branch id required");
      let advisor: unknown;
      let tech: unknown;
      let notify: unknown;
      let plannerRules: unknown;
      let businessHours: unknown;
      try {
        advisor = JSON.parse(advisorJson);
        tech = JSON.parse(techJson);
        notify = JSON.parse(notifyJson);
        plannerRules = JSON.parse(plannerRulesJson || "{}");
        businessHours = JSON.parse(businessHoursJson || "{}");
      } catch {
        throw new Error("Invalid JSON in pool, planner_rules, or business_hours fields");
      }
      const slotM = Math.max(15, Math.min(480, Math.floor(Number(appointmentSlotMinutes) || 60)));
      const { error } = await supabase.from("service_branch_config").upsert(
        {
          workspace_id: "default",
          branch_id: branchId.trim(),
          default_advisor_pool: advisor,
          default_technician_pool: tech,
          parts_team_notify_user_ids: notify,
          planner_rules: plannerRules as Record<string, unknown>,
          business_hours: businessHours as Record<string, unknown>,
          appointment_slot_minutes: slotM,
          notes: notes || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,branch_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-branch-config"] }),
  });

  const reassign = useMutation({
    mutationFn: () =>
      reassignFromBranchPool({
        branch_id: branchId.trim(),
        from_user_id: fromUser.trim(),
        role: reassignRole,
      }),
  });

  const [tatStage, setTatStage] = useState("");
  const [tatH, setTatH] = useState("24");
  const [tatMdH, setTatMdH] = useState("8");

  const saveTatRow = useMutation({
    mutationFn: async (row: {
      id?: string;
      current_stage: string;
      target_hours: number;
      machine_down_target_hours: number;
    }) => {
      const payload: Record<string, unknown> = {
        workspace_id: "default",
        current_stage: row.current_stage,
        target_hours: row.target_hours,
        machine_down_target_hours: row.machine_down_target_hours,
        updated_at: new Date().toISOString(),
      };
      if (row.id) payload.id = row.id;
      const { error } = await supabase.from("service_tat_targets").upsert(payload, {
        onConflict: "workspace_id,current_stage",
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-tat-targets"] }),
  });

  const deleteTat = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("service_tat_targets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-tat-targets"] }),
  });

  return (
    <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Branch service routing</h1>
        <p className="text-sm text-muted-foreground">
          Edit advisor/tech UUID pools and parts notification list per branch. JSON arrays of profile UUIDs.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="text-xs text-muted-foreground">Branch</label>
              <select
                value={branchId}
                onChange={(e) => loadBranch(e.target.value)}
                className="block rounded border px-2 py-1 text-sm"
              >
                <option value="">Select…</option>
                {rows.map((r) => (
                  <option key={r.id} value={r.branch_id}>{r.branch_id}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs text-muted-foreground">Or new branch id</label>
              <input
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="w-full rounded border px-2 py-1 text-sm font-mono"
                placeholder="branch slug"
              />
            </div>
          </div>

          {selected || branchId ? (
            <div className="space-y-3 rounded-lg border p-4">
              <div>
                <label className="text-xs font-medium">default_advisor_pool</label>
                <textarea
                  value={advisorJson}
                  onChange={(e) => setAdvisorJson(e.target.value)}
                  className="w-full font-mono text-xs min-h-[88px] rounded border p-2"
                />
              </div>
              <div>
                <label className="text-xs font-medium">default_technician_pool</label>
                <textarea
                  value={techJson}
                  onChange={(e) => setTechJson(e.target.value)}
                  className="w-full font-mono text-xs min-h-[88px] rounded border p-2"
                />
              </div>
              <div>
                <label className="text-xs font-medium">parts_team_notify_user_ids</label>
                <textarea
                  value={notifyJson}
                  onChange={(e) => setNotifyJson(e.target.value)}
                  className="w-full font-mono text-xs min-h-[72px] rounded border p-2"
                />
              </div>
              <div>
                <label className="text-xs font-medium">business_hours (JSON)</label>
                <p className="text-[10px] text-muted-foreground mb-1">
                  Weekday open/close windows for service-calendar-slots (dow 1=Mon … 5=Fri).
                </p>
                <textarea
                  value={businessHoursJson}
                  onChange={(e) => setBusinessHoursJson(e.target.value)}
                  className="w-full font-mono text-xs min-h-[100px] rounded border p-2"
                />
              </div>
              <div className="flex gap-4 items-end flex-wrap">
                <div>
                  <label className="text-xs font-medium">appointment_slot_minutes</label>
                  <input
                    type="number"
                    min={15}
                    max={480}
                    step={15}
                    value={appointmentSlotMinutes}
                    onChange={(e) => setAppointmentSlotMinutes(e.target.value)}
                    className="block w-28 rounded border px-2 py-1 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium">planner_rules (JSON)</label>
                <p className="text-[10px] text-muted-foreground mb-1">
                  Defaults and priority hints for service-parts-planner (returned in plan metadata).
                </p>
                <textarea
                  value={plannerRulesJson}
                  onChange={(e) => setPlannerRulesJson(e.target.value)}
                  className="w-full font-mono text-xs min-h-[56px] rounded border p-2"
                />
              </div>
              <div>
                <label className="text-xs font-medium">notes</label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded border px-2 py-1 text-sm"
                />
              </div>
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => save.mutate()}
                className="rounded bg-primary text-primary-foreground px-3 py-1.5 text-sm"
              >
                {save.isPending ? "Saving…" : "Save branch config"}
              </button>
            </div>
          ) : null}

          <div className="rounded-lg border p-4 space-y-3">
            <h2 className="text-sm font-medium">Workspace TAT targets</h2>
            <p className="text-xs text-muted-foreground">
              Hours per stage for service-tat-monitor. Empty stage → built-in defaults in the worker.
            </p>
            <div className="flex flex-wrap gap-2 items-end text-xs">
              <div>
                <label className="text-muted-foreground block">Stage</label>
                <select
                  value={tatStage}
                  onChange={(e) => setTatStage(e.target.value)}
                  className="rounded border px-2 py-1 font-mono"
                >
                  <option value="">Select…</option>
                  {SERVICE_STAGES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-muted-foreground block">Target h</label>
                <input
                  type="number"
                  min={0.25}
                  step={0.25}
                  value={tatH}
                  onChange={(e) => setTatH(e.target.value)}
                  className="w-20 rounded border px-2 py-1"
                />
              </div>
              <div>
                <label className="text-muted-foreground block">Machine-down h</label>
                <input
                  type="number"
                  min={0.25}
                  step={0.25}
                  value={tatMdH}
                  onChange={(e) => setTatMdH(e.target.value)}
                  className="w-20 rounded border px-2 py-1"
                />
              </div>
              <button
                type="button"
                disabled={!tatStage || saveTatRow.isPending}
                onClick={() =>
                  saveTatRow.mutate({
                    current_stage: tatStage,
                    target_hours: Number(tatH),
                    machine_down_target_hours: Number(tatMdH),
                  })}
                className="rounded bg-secondary px-2 py-1"
              >
                Save row
              </button>
            </div>
            {tatTargets.length === 0 ? (
              <p className="text-xs text-muted-foreground">No rows — defaults apply.</p>
            ) : (
              <div className="overflow-x-auto text-xs">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1 pr-2">Stage</th>
                      <th className="py-1 pr-2">Target h</th>
                      <th className="py-1 pr-2">Machine-down h</th>
                      <th className="py-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {tatTargets.map((t) => (
                      <tr key={t.id} className="border-b border-border/50">
                        <td className="py-1 pr-2 font-mono">{t.current_stage}</td>
                        <td className="py-1 pr-2">
                          <input
                            type="number"
                            className="w-16 rounded border px-1 py-0.5 bg-background"
                            defaultValue={t.target_hours}
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (!Number.isFinite(v) || v <= 0) return;
                              saveTatRow.mutate({
                                id: t.id,
                                current_stage: t.current_stage,
                                target_hours: v,
                                machine_down_target_hours: t.machine_down_target_hours,
                              });
                            }}
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <input
                            type="number"
                            className="w-16 rounded border px-1 py-0.5 bg-background"
                            defaultValue={t.machine_down_target_hours}
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (!Number.isFinite(v) || v <= 0) return;
                              saveTatRow.mutate({
                                id: t.id,
                                current_stage: t.current_stage,
                                target_hours: t.target_hours,
                                machine_down_target_hours: v,
                              });
                            }}
                          />
                        </td>
                        <td className="py-1">
                          <button
                            type="button"
                            className="text-destructive text-[10px]"
                            onClick={() => {
                              if (confirm("Delete this TAT row?")) deleteTat.mutate(t.id);
                            }}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-lg border p-4 space-y-2">
            <h2 className="text-sm font-medium">Reassign from pool</h2>
            <p className="text-xs text-muted-foreground">
              Moves open jobs off a departing user to the next UUID in the pool (see service-job-router).
            </p>
            <div className="flex flex-wrap gap-2 items-end">
              <input
                value={fromUser}
                onChange={(e) => setFromUser(e.target.value)}
                placeholder="from_user_id UUID"
                className="flex-1 min-w-[200px] rounded border px-2 py-1 text-xs font-mono"
              />
              <select
                value={reassignRole}
                onChange={(e) => setReassignRole(e.target.value as "advisor" | "technician")}
                className="rounded border px-2 py-1 text-sm"
              >
                <option value="advisor">advisor</option>
                <option value="technician">technician</option>
              </select>
              <button
                type="button"
                disabled={reassign.isPending || !branchId || !fromUser}
                onClick={() => reassign.mutate()}
                className="rounded bg-secondary px-3 py-1.5 text-sm"
              >
                {reassign.isPending ? "…" : "Reassign"}
              </button>
            </div>
            {reassign.data && (
              <p className="text-xs text-muted-foreground">
                Reassigned {reassign.data.reassigned} → {reassign.data.replacement.slice(0, 8)}…
              </p>
            )}
            {reassign.isError && (
              <p className="text-xs text-destructive">{(reassign.error as Error).message}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
