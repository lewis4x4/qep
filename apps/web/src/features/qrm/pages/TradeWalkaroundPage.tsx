import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Camera, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { AskIronAdvisorButton } from "@/components/primitives";
import { fetchDealComposite } from "../lib/deal-composite-api";
import {
  REQUIRED_TRADE_PHOTO_SLOTS,
  buildTradeWalkaroundHref,
  canSubmitTradeWalkaround,
  missingRequiredTradePhotos,
  type TradeWalkaroundPhoto,
} from "../lib/trade-walkaround";
import {
  createTradeValuation,
  getTradeValuation,
  uploadTradeWalkaroundPhoto,
  type TradeValuationResponse,
} from "../lib/trade-walkaround-api";

const CONDITION_PROMPTS = [
  "Hydraulic leaks visible",
  "Tire or track wear",
  "Structural or frame damage",
  "Cab or glass damage",
  "Attachment wear",
] as const;

export function TradeWalkaroundPage() {
  const { dealId } = useParams<{ dealId: string }>();
  const [form, setForm] = useState({
    make: "",
    model: "",
    year: "",
    serialNumber: "",
    hours: "",
    operationalStatus: "operational",
    lastFullService: "",
    attachmentsIncluded: "",
    repairNotes: "",
  });
  const [selectedPrompts, setSelectedPrompts] = useState<string[]>([]);
  const [photos, setPhotos] = useState<TradeWalkaroundPhoto[]>([]);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [valuationResult, setValuationResult] = useState<TradeValuationResponse | null>(null);

  const compositeQuery = useQuery({
    queryKey: ["trade-walkaround", "deal", dealId],
    queryFn: () => fetchDealComposite(dealId!),
    enabled: Boolean(dealId),
    staleTime: 30_000,
  });

  const valuationQuery = useQuery({
    queryKey: ["trade-walkaround", "valuation", dealId],
    queryFn: () => getTradeValuation(dealId!),
    enabled: Boolean(dealId),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!valuationQuery.data) return;
    setForm((current) => ({
      ...current,
      make: valuationQuery.data?.make ?? current.make,
      model: valuationQuery.data?.model ?? current.model,
      year: valuationQuery.data?.year?.toString() ?? current.year,
      serialNumber: valuationQuery.data?.serial_number ?? current.serialNumber,
      hours: valuationQuery.data?.hours?.toString() ?? current.hours,
      operationalStatus: valuationQuery.data?.operational_status ?? current.operationalStatus,
      lastFullService: valuationQuery.data?.last_full_service ?? current.lastFullService,
      attachmentsIncluded: valuationQuery.data?.attachments_included?.join(", ") ?? current.attachmentsIncluded,
      repairNotes: valuationQuery.data?.needed_repairs ?? current.repairNotes,
    }));
    setPhotos(valuationQuery.data.photos);
  }, [valuationQuery.data]);

  const createMutation = useMutation({
    mutationFn: () =>
      createTradeValuation({
        deal_id: dealId!,
        make: form.make.trim(),
        model: form.model.trim(),
        year: form.year ? Number(form.year) : undefined,
        serial_number: form.serialNumber.trim() || undefined,
        hours: form.hours ? Number(form.hours) : undefined,
        photos,
        operational_status: form.operationalStatus,
        last_full_service: form.lastFullService.trim() || undefined,
        needed_repairs: [...selectedPrompts, form.repairNotes.trim()].filter(Boolean).join("; ") || undefined,
        attachments_included: form.attachmentsIncluded
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      }),
    onSuccess: (result) => {
      setValuationResult(result);
    },
  });

  const missingPhotos = useMemo(() => missingRequiredTradePhotos(photos), [photos]);
  const canSubmit = canSubmitTradeWalkaround({
    make: form.make,
    model: form.model,
    photos,
  });

  if (!dealId) {
    return <Navigate to="/qrm/deals" replace />;
  }

  const deal = compositeQuery.data?.deal ?? null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="outline" className="min-h-[44px] gap-2">
          <Link to={`/qrm/deals/${dealId}`}>
            <ArrowLeft className="h-4 w-4" />
            Back to deal
          </Link>
        </Button>
        <AskIronAdvisorButton contextType="deal" contextId={dealId} variant="inline" />
      </div>

      <QrmPageHeader
        title={deal?.name ?? "Trade Walkaround"}
        subtitle="Guided trade capture: required photos, condition prompts, AI scoring, and instant valuation."
      />

      {valuationQuery.data && (
        <Card className="border-qep-orange/20 bg-qep-orange/5 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-qep-orange">Latest valuation on file</p>
          <p className="mt-2 text-sm text-foreground">
            {valuationQuery.data.make} {valuationQuery.data.model}
            {valuationQuery.data.year ? ` (${valuationQuery.data.year})` : ""} ·
            {" "}
            {valuationQuery.data.final_value != null
              ? `$${Math.round(valuationQuery.data.final_value).toLocaleString()} final`
              : valuationQuery.data.preliminary_value != null
              ? `$${Math.round(valuationQuery.data.preliminary_value).toLocaleString()} preliminary`
              : "No value yet"}
          </p>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-foreground">Machine capture</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Make" value={form.make} onChange={(value) => setForm((current) => ({ ...current, make: value }))} />
              <Field label="Model" value={form.model} onChange={(value) => setForm((current) => ({ ...current, model: value }))} />
              <Field label="Year" value={form.year} onChange={(value) => setForm((current) => ({ ...current, year: value }))} type="number" />
              <Field label="Hours" value={form.hours} onChange={(value) => setForm((current) => ({ ...current, hours: value }))} type="number" />
              <Field label="Serial number" value={form.serialNumber} onChange={(value) => setForm((current) => ({ ...current, serialNumber: value }))} />
              <div>
                <label className="text-[11px] text-muted-foreground block mb-0.5">Operational status</label>
                <select
                  value={form.operationalStatus}
                  onChange={(event) => setForm((current) => ({ ...current, operationalStatus: event.target.value }))}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="daily_use">Daily use</option>
                  <option value="operational">Operational</option>
                  <option value="non_operational">Non-operational</option>
                </select>
              </div>
              <Field
                label="Last full service"
                value={form.lastFullService}
                onChange={(value) => setForm((current) => ({ ...current, lastFullService: value }))}
                placeholder="e.g. 250h service in Jan 2026"
                className="sm:col-span-2"
              />
              <Field
                label="Attachments included"
                value={form.attachmentsIncluded}
                onChange={(value) => setForm((current) => ({ ...current, attachmentsIncluded: value }))}
                placeholder="Bucket, forks, thumb"
                className="sm:col-span-2"
              />
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-foreground">Condition prompts</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {CONDITION_PROMPTS.map((prompt) => {
                const active = selectedPrompts.includes(prompt);
                return (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() =>
                      setSelectedPrompts((current) =>
                        current.includes(prompt) ? current.filter((item) => item !== prompt) : [...current, prompt],
                      )}
                    className={`rounded-full border px-3 py-2 text-xs transition ${
                      active ? "border-qep-orange bg-qep-orange/10 text-qep-orange" : "border-border text-muted-foreground"
                    }`}
                  >
                    {prompt}
                  </button>
                );
              })}
            </div>
            <div className="mt-4">
              <label className="text-[11px] text-muted-foreground block mb-0.5">Repair / condition notes</label>
              <textarea
                value={form.repairNotes}
                onChange={(event) => setForm((current) => ({ ...current, repairNotes: event.target.value }))}
                className="h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Capture wear, leaks, cab issues, attachment damage, or anything the AI should consider."
              />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Required walkaround photos</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {missingPhotos.length === 0 ? "All required photos captured." : `${missingPhotos.length} required photos still missing.`}
                </p>
              </div>
              {missingPhotos.length === 0 && (
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              )}
            </div>
            <div className="mt-4 space-y-3">
              {REQUIRED_TRADE_PHOTO_SLOTS.map((slot) => {
                const uploaded = photos.find((photo) => photo.type === slot.type) ?? null;
                return (
                  <label
                    key={slot.type}
                    className={`block rounded-xl border p-3 text-sm ${uploaded ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-background"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{slot.label}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{slot.prompt}</p>
                      </div>
                      <Camera className={`h-4 w-4 ${uploaded ? "text-emerald-400" : "text-muted-foreground"}`} />
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="mt-3 block w-full text-xs"
                      disabled={uploadingType === slot.type}
                      onChange={async (event) => {
                        const file = event.target.files?.[0] ?? null;
                        if (!file) return;
                        setUploadingType(slot.type);
                        try {
                          const uploadedPhoto = await uploadTradeWalkaroundPhoto({
                            dealId,
                            type: slot.type,
                            file,
                          });
                          setPhotos((current) => {
                            const remaining = current.filter((photo) => photo.type !== slot.type);
                            return [...remaining, uploadedPhoto];
                          });
                        } finally {
                          setUploadingType(null);
                        }
                      }}
                    />
                    {uploadingType === slot.type && (
                      <p className="mt-2 text-xs text-muted-foreground">Uploading…</p>
                    )}
                  </label>
                );
              })}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-qep-orange" />
              <h2 className="text-sm font-semibold text-foreground">Instant valuation</h2>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Runs the existing trade valuation engine after the required photos and machine basics are captured.
            </p>
            <Button
              className="mt-4 w-full"
              disabled={!canSubmit || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Run valuation
            </Button>
            {createMutation.isError && (
              <p className="mt-3 text-sm text-red-300">
                {createMutation.error instanceof Error ? createMutation.error.message : "Valuation failed."}
              </p>
            )}
            {valuationResult && (
              <div className="mt-4 space-y-3 rounded-xl border border-qep-orange/20 bg-qep-orange/5 p-4">
                <p className="text-sm font-semibold text-foreground">
                  Preliminary value: ${Math.round(valuationResult.valuation.preliminary_value ?? 0).toLocaleString()}
                </p>
                <p className="text-sm text-muted-foreground">
                  AI condition score: {valuationResult.ai_assessment.score}/100
                </p>
                <p className="text-sm text-foreground">{valuationResult.ai_assessment.notes}</p>
                {valuationResult.ai_assessment.detected_damage.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Detected: {valuationResult.ai_assessment.detected_damage.join(", ")}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground">
                  Generated in {valuationResult.pipeline_duration_ms}ms
                </p>
                <Button asChild size="sm" variant="outline">
                  <Link to={`/quote-v2?crm_deal_id=${dealId}${deal?.primaryContactId ? `&crm_contact_id=${deal?.primaryContactId}` : ""}`}>
                    Open quote builder
                  </Link>
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="text-[11px] text-muted-foreground block mb-0.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      />
    </div>
  );
}
