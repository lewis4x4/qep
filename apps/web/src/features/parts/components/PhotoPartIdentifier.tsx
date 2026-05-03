import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Camera, Loader2, X } from "lucide-react";
import { normalizePhotoPartIdentificationResult } from "../lib/parts-row-normalizers";

interface Props {
  onPartSelected?: (partNumber: string, description: string) => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function PhotoPartIdentifier({ onPartSelected }: Props) {
  const [showPanel, setShowPanel] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [equipmentContext, setEquipmentContext] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const photoMut = useMutation({
    mutationFn: async (file: File) => {
      const base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("parts-identify-photo", {
        body: {
          image_base64: base64,
          mime_type: file.type || "image/jpeg",
          equipment_context: equipmentContext.trim() || undefined,
        },
      });
      if (error) throw error;
      return normalizePhotoPartIdentificationResult(data);
    },
  });

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    photoMut.mutate(file);
  };

  const reset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setShowPanel(false);
    setPreviewUrl(null);
    setEquipmentContext("");
    photoMut.reset();
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setShowPanel(!showPanel)}
        className="gap-1.5"
      >
        <Camera className="h-3.5 w-3.5" />
        Photo ID
      </Button>

      {showPanel && (
        <Card className="absolute top-full left-0 mt-2 w-[380px] p-4 space-y-3 z-50 shadow-lg">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Photo part identification</h3>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={reset}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <p className="text-xs text-muted-foreground">
            Snap a photo of a worn or damaged part. AI identifies it and finds catalog matches.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="text-xs file:mr-2 file:rounded file:border-0 file:bg-primary file:px-2 file:py-1 file:text-xs file:text-primary-foreground file:cursor-pointer"
            onChange={handleFileChange}
          />

          <input
            type="text"
            className="w-full h-8 text-xs rounded border border-input bg-background px-2"
            placeholder="Equipment context (e.g., Cat 320 excavator)"
            value={equipmentContext}
            onChange={(e) => setEquipmentContext(e.target.value)}
          />

          {previewUrl && (
            <img
              src={previewUrl}
              alt="Part photo"
              className="w-full max-h-40 object-contain rounded border"
            />
          )}

          {photoMut.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing photo…
            </div>
          )}

          {photoMut.isError && (
            <p className="text-xs text-destructive">
              {(photoMut.error as Error)?.message ?? "Photo analysis failed."}
            </p>
          )}

          {photoMut.data && (
            <div className="space-y-2">
              {photoMut.data.identification.identified_parts.map((p, i) => (
                <div key={i} className="rounded border p-2 text-xs space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{p.description}</span>
                    {p.confidence > 0 && (
                      <Badge variant="outline" className="text-[10px]">
                        {(p.confidence * 100).toFixed(0)}%
                      </Badge>
                    )}
                  </div>
                  {p.part_type && (
                    <span className="text-muted-foreground">Type: {p.part_type}</span>
                  )}
                  {p.condition && (
                    <span className="text-muted-foreground"> · Condition: {p.condition}</span>
                  )}
                  {p.wear_indicators.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {p.wear_indicators.map((w, j) => (
                        <span key={j} className="text-[10px] rounded px-1 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                          {w}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {photoMut.data.catalog_matches.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium uppercase text-muted-foreground">
                    Catalog matches
                  </p>
                  {photoMut.data.catalog_matches.slice(0, 5).map((m) => (
                    <button
                      type="button"
                      key={m.part_number}
                      className="flex items-center gap-2 rounded border p-2 text-xs cursor-pointer hover:bg-muted/50 w-full text-left"
                      onClick={() => onPartSelected?.(m.part_number, m.description)}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="font-mono font-medium">{m.part_number}</span>
                        <span className="text-muted-foreground ml-1 truncate">
                          {m.description}
                        </span>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {m.match_score}pt
                      </Badge>
                      {m.inventory.length > 0 && (
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 shrink-0">
                          {m.inventory.reduce((s, inv) => s + inv.qty_on_hand, 0)} in stock
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {!photoMut.data.has_matches && (
                <p className="text-xs text-muted-foreground">
                  No catalog matches found. Try a clearer photo or enter part details manually.
                </p>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
