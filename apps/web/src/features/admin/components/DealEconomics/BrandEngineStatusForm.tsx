import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { AlertCircle, CheckCircle2, FileText, Key, MapPin, Sparkles } from "lucide-react";
import {
  getBrandEngineStatus,
  setBrandDealEngineEnabled,
  missingPrereqs,
  type BrandEngineStatusRow,
} from "../../lib/deal-economics-api";

interface ReadinessBadgeProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  required: boolean;
}

function ReadinessBadge({ icon, label, count, required }: ReadinessBadgeProps) {
  const missing = required && count === 0;
  return (
    <span
      title={`${label}: ${count}`}
      className={[
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium border",
        missing
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : count > 0
          ? "border-success/40 bg-success/10 text-success-foreground"
          : "border-border bg-muted/40 text-muted-foreground",
      ].join(" ")}
    >
      {icon}
      <span>{count}</span>
    </span>
  );
}

export function BrandEngineStatusForm() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const isReadOnly = profile?.role === "rep";

  const [brands, setBrands]             = useState<BrandEngineStatusRow[]>([]);
  const [loading, setLoading]           = useState(true);
  const [confirmToggle, setConfirmToggle] = useState<
    { brand: BrandEngineStatusRow; nextEnabled: boolean } | null
  >(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    getBrandEngineStatus().then((data) => {
      setBrands(data);
      setLoading(false);
    });
  }, []);

  async function toggle(brand: BrandEngineStatusRow, enabled: boolean) {
    setBrands((prev) =>
      prev.map((b) => (b.id === brand.id ? { ...b, discount_configured: enabled } : b)),
    );
    setSaving(brand.id);
    const result = await setBrandDealEngineEnabled(brand.id, enabled);
    setSaving(null);
    if ("error" in result) {
      setBrands((prev) =>
        prev.map((b) => (b.id === brand.id ? { ...b, discount_configured: !enabled } : b)),
      );
      toast({
        title: "Failed to update",
        description: result.error,
        variant: "destructive",
      });
    } else {
      toast({
        title: `${brand.name} Deal Engine ${enabled ? "enabled" : "disabled"}`,
      });
    }
  }

  function handleToggle(brand: BrandEngineStatusRow) {
    if (isReadOnly) return;
    const next = !brand.discount_configured;
    const missing = missingPrereqs(brand);

    // Always confirm going OFF (quoting stops). Confirm going ON when prereqs
    // are missing so admin acknowledges the brand may not actually quote.
    if (!next || missing.length > 0) {
      setConfirmToggle({ brand, nextEnabled: next });
      return;
    }
    toggle(brand, true);
  }

  async function handleConfirm() {
    if (!confirmToggle) return;
    const { brand, nextEnabled } = confirmToggle;
    setConfirmToggle(null);
    await toggle(brand, nextEnabled);
  }

  const dialogBrand   = confirmToggle?.brand ?? null;
  const dialogEnabled = confirmToggle?.nextEnabled ?? false;
  const dialogMissing = dialogBrand ? missingPrereqs(dialogBrand) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Deal Engine Status</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-xs text-muted-foreground">
          When enabled, the AI Deal Engine generates scenarios for this brand. Disable to
          temporarily stop quoting (e.g. during a pricing reset). Readiness badges show what's
          configured: a published price sheet and at least one freight zone are required for
          quotes to calculate successfully.
        </p>

        {loading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
        ) : brands.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No brands found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-3">Brand</th>
                  <th className="pb-2 pr-3">Readiness</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2">Deal Engine</th>
                </tr>
              </thead>
              <tbody>
                {brands.map((brand) => {
                  const missing = missingPrereqs(brand);
                  const quoteReady = missing.length === 0;
                  const enabledButNotReady = brand.discount_configured && !quoteReady;
                  return (
                    <tr key={brand.id} className="border-b">
                      <td className="py-3 pr-3">
                        <div className="font-medium">{brand.name}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{brand.code}</div>
                      </td>
                      <td className="py-3 pr-3">
                        <div className="flex flex-wrap items-center gap-1">
                          <ReadinessBadge
                            icon={<FileText className="h-3 w-3" />}
                            label="Published price sheets"
                            count={brand.published_sheet_count}
                            required
                          />
                          <ReadinessBadge
                            icon={<MapPin className="h-3 w-3" />}
                            label="Freight zones"
                            count={brand.freight_zone_count}
                            required
                          />
                          <ReadinessBadge
                            icon={<Sparkles className="h-3 w-3" />}
                            label="Active programs"
                            count={brand.active_program_count}
                            required={false}
                          />
                          <ReadinessBadge
                            icon={<Key className="h-3 w-3" />}
                            label="Inbound freight key"
                            count={brand.has_inbound_freight_key ? 1 : 0}
                            required={false}
                          />
                        </div>
                      </td>
                      <td className="py-3 pr-3">
                        {enabledButNotReady ? (
                          <Badge variant="warning" className="text-[10px]">
                            <AlertCircle className="mr-1 h-3 w-3" />
                            Enabled, prereqs missing
                          </Badge>
                        ) : brand.discount_configured ? (
                          <Badge variant="success" className="text-[10px]">
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            Live
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Disabled</Badge>
                        )}
                      </td>
                      <td className="py-3">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={brand.discount_configured}
                          disabled={isReadOnly || saving === brand.id}
                          onClick={() => handleToggle(brand)}
                          className={[
                            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            "disabled:cursor-not-allowed disabled:opacity-50",
                            brand.discount_configured ? "bg-primary" : "bg-muted",
                          ].join(" ")}
                        >
                          <span
                            className={[
                              "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
                              brand.discount_configured ? "translate-x-4" : "translate-x-0",
                            ].join(" ")}
                          />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Confirm dialog */}
        <Dialog
          open={!!confirmToggle}
          onOpenChange={(open) => {
            if (!open) setConfirmToggle(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {dialogEnabled
                  ? `Enable Deal Engine for ${dialogBrand?.name}?`
                  : `Disable Deal Engine for ${dialogBrand?.name}?`}
              </DialogTitle>
            </DialogHeader>

            {dialogEnabled ? (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Turning this on lets the AI generate quote scenarios for {dialogBrand?.name}.
                </p>
                {dialogMissing.length > 0 && (
                  <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-foreground">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    <div className="text-xs">
                      <div className="font-medium">Missing prerequisites:</div>
                      <ul className="mt-1 list-disc pl-4">
                        {dialogMissing.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                      <div className="mt-2">
                        Quotes will likely fail until these are configured. You can still enable the
                        brand — reps will see a clear "not yet configured" error until the prereqs land.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Turning this off stops the AI Deal Engine from producing scenarios for{" "}
                {dialogBrand?.name}. In-flight quotes already saved are not affected.
              </p>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmToggle(null)}>
                Cancel
              </Button>
              <Button
                variant={dialogEnabled ? "default" : "destructive"}
                onClick={handleConfirm}
              >
                {dialogEnabled ? "Enable" : "Disable"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
