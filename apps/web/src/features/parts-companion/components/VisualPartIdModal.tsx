/**
 * VisualPartIdModal — Slice 3.4.
 *
 * Counter rep holds a worn/damaged part, taps camera, snaps a photo.
 * Claude Vision (parts-identify-photo edge fn) classifies what it sees,
 * cross-references parts_catalog, and returns ranked matches.
 *
 * Clicking a match closes the modal and bubbles the SKU up to the
 * LookupPage search input, which auto-executes the hybrid search.
 *
 * Matches the LookupPage design tokens (T.*) so the modal feels native.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Camera, X, Sparkles, Loader2, CheckCircle2, ArrowRight,
  AlertCircle, RefreshCw,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

interface CatalogMatch {
  part_number: string;
  description: string;
  category: string | null;
  list_price: number | null;
  match_score: number;
  match_reason: string;
  inventory: Array<{ branch_id: string; qty_on_hand: number }>;
  substitutes: Array<{ part_number: string; relationship: string }>;
}

interface IdentifiedPart {
  description: string;
  part_type: string | null;
  condition: string | null;
  wear_indicators: string[];
  confidence: number;
}

interface PhotoResult {
  identification: {
    identified_parts: IdentifiedPart[];
    equipment_context: {
      make: string | null;
      model: string | null;
      system: string | null;
    } | null;
  };
  catalog_matches: CatalogMatch[];
  has_matches: boolean;
}

// Same token palette as LookupPage — keep visual parity.
const T = {
  bg: "#0A1628",
  bgElevated: "#0F1D31",
  card: "#132238",
  border: "#1F3254",
  orange: "#E87722",
  orangeGlow: "rgba(232,119,34,0.15)",
  text: "#E5ECF5",
  textMuted: "#8A9BB4",
  textDim: "#5F7391",
  success: "#22C55E",
  successBg: "rgba(34,197,94,0.12)",
  warning: "#F59E0B",
  purple: "#A855F7",
  purpleBg: "rgba(168,85,247,0.14)",
} as const;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface Props {
  open: boolean;
  onClose: () => void;
  onPartSelected: (partNumber: string) => void;
}

export function VisualPartIdModal({ open, onClose, onPartSelected }: Props) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [equipmentContext, setEquipmentContext] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation<PhotoResult, Error, File>({
    mutationFn: async (file) => {
      const base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke<PhotoResult>(
        "parts-identify-photo",
        {
          body: {
            image_base64: base64,
            mime_type: file.type || "image/jpeg",
            equipment_context: equipmentContext.trim() || undefined,
          },
        },
      );
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Empty response");
      return data;
    },
  });

  // Cleanup object URL when preview changes or modal closes.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!open) handleReset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    mutation.mutate(file);
  }

  function handleReset() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setEquipmentContext("");
    mutation.reset();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handlePick(sku: string) {
    onPartSelected(sku);
    onClose();
  }

  if (!open) return null;

  const result = mutation.data;
  const hasResult = !!result;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      style={{ background: "rgba(5,10,20,0.72)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-[560px] max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl"
        style={{
          background: `linear-gradient(180deg, ${T.card} 0%, ${T.bg} 100%)`,
          border: `1px solid ${T.border}`,
          boxShadow: "0 40px 80px rgba(0,0,0,0.55)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 sticky top-0"
          style={{
            background: T.card,
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          <div className="flex items-center gap-2">
            <span
              className="rounded-lg p-1.5 flex items-center"
              style={{ background: T.orangeGlow, color: T.orange }}
            >
              <Camera size={16} />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: T.orange }}>
                Visual Parts ID
              </p>
              <h2 className="text-base font-semibold" style={{ color: T.text }}>
                Snap. Identify. Match.
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg transition"
            style={{ background: T.bgElevated, color: T.textMuted }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {/* No photo yet: capture zone */}
          {!previewUrl && !mutation.isPending && !hasResult && (
            <div className="space-y-3">
              <p className="text-sm" style={{ color: T.textMuted }}>
                Snap a photo of a worn or damaged part. Claude Vision reads
                OEM markings, part type, and condition — then we cross-reference
                the catalog.
              </p>

              <div>
                <label className="text-[11px] font-semibold uppercase tracking-[0.14em] mb-1.5 block" style={{ color: T.textDim }}>
                  Equipment context (optional — improves accuracy)
                </label>
                <input
                  type="text"
                  value={equipmentContext}
                  onChange={(e) => setEquipmentContext(e.target.value)}
                  placeholder="e.g. Yanmar SA424, Bandit 15XP, ASV RC85"
                  className="w-full rounded-lg px-3 py-2 outline-none"
                  style={{
                    fontSize: 14,
                    background: T.bgElevated,
                    border: `1px solid ${T.border}`,
                    color: T.text,
                  }}
                />
              </div>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 rounded-xl py-4 font-semibold transition-all"
                style={{
                  background: T.orange,
                  color: "#fff",
                  boxShadow: `0 8px 24px ${T.orangeGlow}`,
                }}
              >
                <Camera size={18} />
                Take or upload photo
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFilePicked}
                className="hidden"
              />
            </div>
          )}

          {/* Preview + loading */}
          {previewUrl && (
            <div className="space-y-3">
              <div
                className="relative rounded-xl overflow-hidden"
                style={{ border: `1px solid ${T.border}` }}
              >
                <img src={previewUrl} alt="Part" className="w-full max-h-60 object-cover" />
                {mutation.isPending && (
                  <div
                    className="absolute inset-0 flex items-center justify-center"
                    style={{ background: "rgba(10,22,40,0.78)" }}
                  >
                    <div className="text-center">
                      <Loader2 className="animate-spin mx-auto mb-2" size={28} style={{ color: T.orange }} />
                      <p className="text-sm font-semibold" style={{ color: T.text }}>
                        Claude is reading the part…
                      </p>
                    </div>
                  </div>
                )}
              </div>
              {!mutation.isPending && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="w-full flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium"
                  style={{
                    background: T.bgElevated,
                    border: `1px solid ${T.border}`,
                    color: T.textMuted,
                  }}
                >
                  <RefreshCw size={14} />
                  Try another photo
                </button>
              )}
            </div>
          )}

          {/* Error */}
          {mutation.isError && (
            <div
              className="rounded-lg p-3 flex items-start gap-2"
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
              }}
            >
              <AlertCircle size={16} style={{ color: "#EF4444" }} className="mt-0.5 shrink-0" />
              <div className="text-sm" style={{ color: T.text }}>
                <p className="font-semibold">Identification failed</p>
                <p className="text-xs mt-0.5" style={{ color: T.textMuted }}>
                  {mutation.error.message}
                </p>
              </div>
            </div>
          )}

          {/* Results */}
          {hasResult && (
            <div className="space-y-4">
              {/* What Claude saw */}
              {result.identification.identified_parts.length > 0 && (
                <div
                  className="rounded-xl p-3 space-y-2"
                  style={{
                    background: T.purpleBg,
                    border: "1px solid rgba(168,85,247,0.25)",
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <Sparkles size={13} style={{ color: T.purple }} />
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: T.purple }}>
                      What Claude sees
                    </p>
                  </div>
                  {result.identification.identified_parts.slice(0, 1).map((p, idx) => (
                    <div key={idx} className="text-sm" style={{ color: T.text }}>
                      <p className="font-semibold">{p.description}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs mt-1" style={{ color: T.textMuted }}>
                        {p.part_type && <span>type: {p.part_type}</span>}
                        {p.condition && <span>condition: {p.condition}</span>}
                        <span>confidence: {Math.round(p.confidence * 100)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Catalog matches */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] mb-2" style={{ color: T.textDim }}>
                  {result.has_matches ? "Catalog matches" : "No confident matches"}
                </p>
                {result.has_matches ? (
                  <div className="space-y-2">
                    {result.catalog_matches.slice(0, 5).map((m) => (
                      <button
                        key={m.part_number}
                        type="button"
                        onClick={() => handlePick(m.part_number)}
                        className="w-full text-left rounded-lg p-3 transition-all"
                        style={{
                          background: T.bgElevated,
                          border: `1px solid ${T.border}`,
                          color: T.text,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = T.orange;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = T.border;
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="font-mono font-semibold text-sm" style={{ color: T.orange }}>
                              {m.part_number}
                            </p>
                            <p className="text-sm mt-0.5 truncate">{m.description}</p>
                            <div className="flex items-center gap-2 mt-1.5">
                              <span
                                className="text-[10px] font-semibold uppercase tracking-[0.14em] px-1.5 py-0.5 rounded"
                                style={{ background: T.successBg, color: T.success }}
                              >
                                {Math.round(m.match_score * 100)}% match
                              </span>
                              {m.list_price != null && (
                                <span className="text-xs" style={{ color: T.textMuted }}>
                                  ${Number(m.list_price).toFixed(2)}
                                </span>
                              )}
                              {m.inventory.length > 0 && (
                                <span className="text-xs" style={{ color: T.textMuted }}>
                                  {m.inventory.reduce((sum, i) => sum + (i.qty_on_hand ?? 0), 0)} on hand
                                </span>
                              )}
                            </div>
                            {m.match_reason && (
                              <p className="text-xs mt-1.5" style={{ color: T.textDim }}>
                                {m.match_reason}
                              </p>
                            )}
                          </div>
                          <ArrowRight size={16} style={{ color: T.textMuted }} className="shrink-0 mt-1" />
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div
                    className="rounded-lg p-3 flex items-start gap-2"
                    style={{
                      background: "rgba(245,158,11,0.08)",
                      border: "1px solid rgba(245,158,11,0.25)",
                    }}
                  >
                    <AlertCircle size={14} style={{ color: T.warning }} className="mt-0.5 shrink-0" />
                    <p className="text-xs" style={{ color: T.text }}>
                      Claude identified the part but no confident catalog match was found. Try
                      adding more equipment context or retake the photo with the OEM marking
                      clearly visible.
                    </p>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleReset}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium"
                style={{
                  background: T.bgElevated,
                  border: `1px solid ${T.border}`,
                  color: T.textMuted,
                }}
              >
                <CheckCircle2 size={14} />
                Start over
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
