/**
 * PDI Checklist Page — Track 4, Slice 4.2.
 *
 * Mobile-optimized tap-through checklist for Pre-Delivery Inspection.
 * Loads the equipment intake record, presents the PDI checklist as
 * sequential tappable items, captures photo evidence per step, and
 * blocks stage advancement until pdi_completed = true.
 *
 * Route: /ops/intake/:intakeId/pdi
 */
import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Circle,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { normalizePdiIntakeRecord, type PdiCheckResult, type PdiIntakeRecord } from "../lib/ops-row-normalizers";

// ─── Default PDI Checklist Items ──────────────────────────────────────────

interface PdiItem {
  id: string;
  label: string;
  category: string;
  required: boolean;
  requires_photo: boolean;
}

const DEFAULT_PDI_ITEMS: PdiItem[] = [
  { id: "engine_oil", label: "Engine oil level", category: "Engine", required: true, requires_photo: false },
  { id: "coolant", label: "Coolant level", category: "Engine", required: true, requires_photo: false },
  { id: "hydraulic_fluid", label: "Hydraulic fluid level", category: "Hydraulics", required: true, requires_photo: false },
  { id: "fuel_filter", label: "Fuel filter condition", category: "Engine", required: true, requires_photo: false },
  { id: "air_filter", label: "Air filter condition", category: "Engine", required: true, requires_photo: false },
  { id: "belts_hoses", label: "Belts and hoses inspection", category: "Engine", required: true, requires_photo: true },
  { id: "battery", label: "Battery and connections", category: "Electrical", required: true, requires_photo: false },
  { id: "lights", label: "All lights operational", category: "Electrical", required: true, requires_photo: true },
  { id: "gauges", label: "Instrument panel / gauges", category: "Electrical", required: true, requires_photo: false },
  { id: "tires_tracks", label: "Tires / tracks condition", category: "Undercarriage", required: true, requires_photo: true },
  { id: "brakes", label: "Brake system test", category: "Safety", required: true, requires_photo: false },
  { id: "steering", label: "Steering response", category: "Safety", required: true, requires_photo: false },
  { id: "bucket_blade", label: "Bucket / blade condition", category: "Attachments", required: false, requires_photo: true },
  { id: "pin_bushing", label: "Pin and bushing wear", category: "Undercarriage", required: false, requires_photo: true },
  { id: "cab_interior", label: "Cab interior cleanliness", category: "Cosmetic", required: false, requires_photo: false },
  { id: "decals", label: "Safety decals present and legible", category: "Safety", required: true, requires_photo: false },
  { id: "smoke_test", label: "Exhaust smoke test (start engine)", category: "Engine", required: true, requires_photo: false },
  { id: "leaks", label: "Fluid leak inspection (after 5 min run)", category: "Hydraulics", required: true, requires_photo: true },
  { id: "serial_plate", label: "Serial number plate photo", category: "Documentation", required: true, requires_photo: true },
  { id: "hour_meter", label: "Hour meter reading photo", category: "Documentation", required: true, requires_photo: true },
];

// ─── Types ─────────────────────────────────────────────────────────────────

// ─── Main Component ────────────────────────────────────────────────────────

export function PdiChecklistPage() {
  const { intakeId } = useParams<{ intakeId: string }>();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState<Record<string, string>>({});

  // Load intake record
  const { data: intake, isLoading, isError } = useQuery<PdiIntakeRecord | null>({
    queryKey: ["ops", "intake", intakeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("equipment_intake")
        .select("*")
        .eq("id", intakeId!)
        .single();
      if (error) throw error;
      return normalizePdiIntakeRecord(data);
    },
    enabled: !!intakeId,
    staleTime: 10_000,
  });

  // Parse existing checklist state
  const existingResults = new Map<string, PdiCheckResult>();
  for (const r of intake?.pdi_checklist ?? []) {
    existingResults.set(r.id, r);
  }

  // Count progress
  const totalItems = DEFAULT_PDI_ITEMS.filter((i) => i.required).length;
  const completedItems = DEFAULT_PDI_ITEMS.filter(
    (i) => i.required && existingResults.get(i.id)?.status != null,
  ).length;
  const allRequiredDone = DEFAULT_PDI_ITEMS.every(
    (i) => !i.required || existingResults.get(i.id)?.status != null,
  );

  // Mutation: update checklist
  const checkMutation = useMutation({
    mutationFn: async (result: PdiCheckResult) => {
      const existing = intake?.pdi_checklist ?? [];
      const updated = existing.filter((r: PdiCheckResult) => r.id !== result.id);
      updated.push(result);

      const { error } = await supabase
        .from("equipment_intake")
        .update({ pdi_checklist: updated })
        .eq("id", intakeId!);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ops", "intake", intakeId] }),
  });

  // Mutation: sign off PDI
  const signOffMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("equipment_intake")
        .update({
          pdi_completed: true,
          pdi_signed_off_by: user?.id ?? null,
        })
        .eq("id", intakeId!);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ops", "intake", intakeId] }),
  });

  // Handle check item tap
  const handleCheck = useCallback(
    (item: PdiItem, status: "pass" | "fail" | "skip") => {
      const note = noteInput[item.id]?.trim() || undefined;
      checkMutation.mutate({
        id: item.id,
        status,
        note,
        checked_at: new Date().toISOString(),
      });
    },
    [checkMutation, noteInput],
  );

  // Handle photo upload
  const handlePhoto = useCallback(
    async (item: PdiItem, file: File) => {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `pdi/${intakeId}/${item.id}-${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("equipment-photos")
        .upload(path, file);
      if (uploadErr) {
        console.error("Photo upload failed:", uploadErr.message);
        return;
      }
      const { data: urlData } = supabase.storage
        .from("equipment-photos")
        .getPublicUrl(path);
      const photoUrl = urlData.publicUrl;

      checkMutation.mutate({
        id: item.id,
        status: "pass",
        photo_url: photoUrl,
        checked_at: new Date().toISOString(),
      });
    },
    [checkMutation, intakeId],
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-lg px-4 pt-8">
        <Card className="p-8 text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Loading PDI checklist...</p>
        </Card>
      </div>
    );
  }

  if (isError || !intake) {
    return (
      <div className="mx-auto max-w-lg px-4 pt-8">
        <Card className="p-8 text-center">
          <AlertTriangle className="mx-auto h-6 w-6 text-red-400" />
          <p className="mt-3 text-sm text-muted-foreground">Unable to load intake record.</p>
          <Button asChild size="sm" variant="outline" className="mt-4">
            <Link to="/ops/intake"><ArrowLeft className="mr-1 h-3 w-3" /> Back to Intake</Link>
          </Button>
        </Card>
      </div>
    );
  }

  // Group items by category
  const categories = new Map<string, PdiItem[]>();
  for (const item of DEFAULT_PDI_ITEMS) {
    const list = categories.get(item.category) ?? [];
    list.push(item);
    categories.set(item.category, list);
  }

  const stockLabel = intake.stock_number ?? "Unknown Stock #";
  const isCompleted = intake.pdi_completed;

  return (
    <div className="mx-auto max-w-lg px-4 pb-24 pt-2">
      {/* Header */}
      <Button asChild variant="ghost" size="sm" className="h-7 text-[11px] mb-2">
        <Link to="/ops/intake"><ArrowLeft className="mr-1 h-3 w-3" aria-hidden /> Back to Intake</Link>
      </Button>

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-foreground">{stockLabel}</h1>
          <p className="text-xs text-muted-foreground">Pre-Delivery Inspection Checklist</p>
        </div>
        {isCompleted ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-1 text-[10px] font-bold text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> Completed
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">{completedItems}/{totalItems} required</span>
        )}
      </div>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-qep-orange transition-all duration-300"
            style={{ width: `${totalItems > 0 ? (completedItems / totalItems) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Checklist items by category */}
      <div className="space-y-4">
        {[...categories.entries()].map(([category, items]) => (
          <div key={category}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
              {category}
            </p>
            <Card className="divide-y divide-border">
              {items.map((item) => {
                const result = existingResults.get(item.id);
                const isChecked = result?.status != null;
                const isPass = result?.status === "pass";
                const isFail = result?.status === "fail";

                return (
                  <div key={item.id} className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0">
                        {isChecked ? (
                          isPass ? (
                            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                          ) : (
                            <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                          )
                        ) : (
                          <Circle className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-0.5" />
                        )}
                        <div className="min-w-0">
                          <p className={`text-sm ${isChecked ? "text-muted-foreground" : "text-foreground"}`}>
                            {item.label}
                            {!item.required && (
                              <span className="ml-1 text-[9px] text-muted-foreground">(optional)</span>
                            )}
                          </p>
                          {result?.note && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">{result.note}</p>
                          )}
                          {result?.photo_url && (
                            <a
                              href={result.photo_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 mt-1 text-[10px] text-blue-400 hover:underline"
                            >
                              <Camera className="h-2.5 w-2.5" /> View photo
                            </a>
                          )}
                        </div>
                      </div>

                      {!isCompleted && (
                        <div className="flex items-center gap-1 shrink-0">
                          {item.requires_photo && !result?.photo_url && (
                            <button
                              type="button"
                              onClick={() => {
                                setActivePhotoId(item.id);
                                fileInputRef.current?.click();
                              }}
                              className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted"
                              title="Take photo"
                            >
                              <Camera className="h-4 w-4" />
                            </button>
                          )}
                          {!isChecked ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleCheck(item, "pass")}
                                className="rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-400 hover:bg-emerald-500/20"
                              >
                                Pass
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCheck(item, "fail")}
                                className="rounded-md bg-red-500/10 px-2 py-1 text-[10px] font-semibold text-red-400 hover:bg-red-500/20"
                              >
                                Fail
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                checkMutation.mutate({
                                  id: item.id,
                                  status: "skip",
                                  checked_at: new Date().toISOString(),
                                })
                              }
                              className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted"
                            >
                              Undo
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </Card>
          </div>
        ))}
      </div>

      {/* Sign-off section */}
      {!isCompleted && allRequiredDone && (
        <Card className="mt-6 border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="text-xs text-emerald-400 font-semibold mb-2">All required items checked</p>
          <p className="text-[11px] text-muted-foreground mb-3">
            Review any failed items. Signing off confirms this PDI is complete.
          </p>
          <Button
            className="w-full"
            onClick={() => signOffMutation.mutate()}
            disabled={signOffMutation.isPending}
          >
            {signOffMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            Sign Off PDI
          </Button>
        </Card>
      )}

      {!isCompleted && !allRequiredDone && (
        <Card className="mt-6 border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-xs text-amber-400 font-semibold">
            {totalItems - completedItems} required item{totalItems - completedItems !== 1 ? "s" : ""} remaining
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Complete all required checks before signing off.
          </p>
        </Card>
      )}

      {/* Hidden file input for camera */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file || !activePhotoId) return;
          const item = DEFAULT_PDI_ITEMS.find((i) => i.id === activePhotoId);
          if (item) handlePhoto(item, file);
          setActivePhotoId(null);
          e.target.value = "";
        }}
      />
    </div>
  );
}
