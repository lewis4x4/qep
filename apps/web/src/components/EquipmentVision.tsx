import { useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Camera, Upload, Loader2, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface VisionEquipment {
  make: string | null;
  model: string | null;
  year: string | null;
  category: string | null;
  serial_visible: string | null;
}

interface VisionCondition {
  overall: string;
  exterior: string | null;
  wear_indicators: string[];
  damage_noted: string[];
  hours_estimate: string | null;
}

interface VisionAnalysis {
  equipment: VisionEquipment;
  condition: VisionCondition;
  identification_confidence: string;
  description: string;
  key_features: string[];
  potential_issues: string[];
  recommended_next_steps: string[];
}

interface InventoryMatch {
  id: string;
  name: string;
  make: string;
  model: string;
  year: number | null;
  condition: string | null;
  list_price: number | null;
  rental_rate_daily: number | null;
}

interface MarketValuation {
  equipment_description: string;
  estimated_value_low: number | null;
  estimated_value_high: number | null;
  valuation_date: string;
  source: string | null;
}

interface VisionResult {
  analysis: VisionAnalysis;
  crm_matches: {
    inventory: InventoryMatch[];
    valuations: MarketValuation[];
  };
}

const conditionColors: Record<string, string> = {
  excellent: "text-green-400 bg-green-400/10 border-green-400/30",
  good: "text-blue-400 bg-blue-400/10 border-blue-400/30",
  fair: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
  poor: "text-red-400 bg-red-400/10 border-red-400/30",
  unknown: "text-muted-foreground bg-muted border-border",
};

const confidenceColors: Record<string, string> = {
  high: "text-green-400",
  medium: "text-yellow-400",
  low: "text-red-400",
};

export function EquipmentVision() {
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError("Image must be under 20MB");
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setError(null);
    setResult(null);
    setAnalyzing(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError("Not authenticated");
        return;
      }

      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/equipment-vision`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: formData,
        },
      );

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Analysis failed");
        return;
      }

      setResult(data as VisionResult);
    } catch {
      setError("Failed to analyze image. Please try again.");
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect],
  );

  function reset() {
    setResult(null);
    setError(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="space-y-4">
      {/* Upload area */}
      {!result && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="relative rounded-lg border-2 border-dashed border-white/20 bg-white/5 p-8 text-center transition-colors hover:border-qep-orange/40"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileSelect(f);
            }}
          />

          {analyzing ? (
            <div className="flex flex-col items-center gap-3">
              {previewUrl && (
                <img src={previewUrl} alt="Equipment" className="h-32 rounded-lg object-cover opacity-60" />
              )}
              <Loader2 className="h-8 w-8 animate-spin text-qep-orange" />
              <p className="text-sm text-muted-foreground">Analyzing equipment...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center gap-3">
                <Camera className="h-8 w-8 text-muted-foreground" />
                <Upload className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Take a photo or upload an equipment image
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  AI will identify make, model, condition, and estimate value
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Equipment Analysis</h3>
            <Button variant="ghost" size="sm" onClick={reset} className="gap-1 text-xs">
              <X className="h-3 w-3" /> New scan
            </Button>
          </div>

          {previewUrl && (
            <img src={previewUrl} alt="Equipment" className="w-full max-h-48 rounded-lg object-cover" />
          )}

          {/* Identification */}
          <Card className="bg-white/5 border-white/10">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                Equipment ID
                <span className={`text-xs ${confidenceColors[result.analysis.identification_confidence] ?? ""}`}>
                  ({result.analysis.identification_confidence} confidence)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                {result.analysis.equipment.make && (
                  <div><span className="text-muted-foreground">Make:</span> <span className="text-foreground font-medium">{result.analysis.equipment.make}</span></div>
                )}
                {result.analysis.equipment.model && (
                  <div><span className="text-muted-foreground">Model:</span> <span className="text-foreground font-medium">{result.analysis.equipment.model}</span></div>
                )}
                {result.analysis.equipment.year && (
                  <div><span className="text-muted-foreground">Year:</span> <span className="text-foreground">{result.analysis.equipment.year}</span></div>
                )}
                {result.analysis.equipment.category && (
                  <div><span className="text-muted-foreground">Category:</span> <span className="text-foreground">{result.analysis.equipment.category}</span></div>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-2">{result.analysis.description}</p>
            </CardContent>
          </Card>

          {/* Condition */}
          <Card className="bg-white/5 border-white/10">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                Condition Assessment
                <span className={`text-xs px-2 py-0.5 rounded-full border ${conditionColors[result.analysis.condition.overall] ?? conditionColors.unknown}`}>
                  {result.analysis.condition.overall}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 space-y-2">
              {result.analysis.condition.exterior && (
                <p className="text-xs text-muted-foreground">{result.analysis.condition.exterior}</p>
              )}
              {result.analysis.condition.wear_indicators.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-foreground mb-1">Wear indicators:</p>
                  <ul className="text-xs text-muted-foreground space-y-0.5">
                    {result.analysis.condition.wear_indicators.map((w, i) => (
                      <li key={i} className="flex items-start gap-1">
                        <span className="text-yellow-400 mt-0.5">-</span> {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.analysis.condition.damage_noted.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-red-400 mb-1">Damage noted:</p>
                  <ul className="text-xs text-muted-foreground space-y-0.5">
                    {result.analysis.condition.damage_noted.map((d, i) => (
                      <li key={i} className="flex items-start gap-1">
                        <AlertTriangle className="h-3 w-3 text-red-400 mt-0.5 shrink-0" /> {d}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.analysis.condition.hours_estimate && (
                <p className="text-xs text-muted-foreground">
                  Estimated hours: <span className="text-foreground">{result.analysis.condition.hours_estimate}</span>
                </p>
              )}
            </CardContent>
          </Card>

          {/* Market data */}
          {(result.crm_matches.valuations.length > 0 || result.crm_matches.inventory.length > 0) && (
            <Card className="bg-white/5 border-white/10">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-sm">Market & Inventory</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 space-y-3">
                {result.crm_matches.valuations.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-foreground mb-1">Market valuations:</p>
                    {result.crm_matches.valuations.map((v, i) => (
                      <div key={i} className="text-xs text-muted-foreground flex justify-between items-center py-1 border-b border-white/5 last:border-0">
                        <span>{v.equipment_description}</span>
                        <span className="text-foreground font-medium">
                          {v.estimated_value_low && v.estimated_value_high
                            ? `$${v.estimated_value_low.toLocaleString()} – $${v.estimated_value_high.toLocaleString()}`
                            : "N/A"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {result.crm_matches.inventory.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-foreground mb-1">Matching inventory:</p>
                    {result.crm_matches.inventory.map((inv, i) => (
                      <div key={i} className="text-xs text-muted-foreground py-1 border-b border-white/5 last:border-0">
                        <span className="text-foreground">{inv.name}</span>
                        {inv.list_price && <span className="ml-2">List: ${inv.list_price.toLocaleString()}</span>}
                        {inv.condition && <span className="ml-2">Condition: {inv.condition}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Next steps */}
          {result.analysis.recommended_next_steps.length > 0 && (
            <Card className="bg-white/5 border-white/10">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-qep-orange" />
                  Recommended Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                  {result.analysis.recommended_next_steps.map((step, i) => (
                    <li key={i} className="text-foreground/80">{step}</li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
