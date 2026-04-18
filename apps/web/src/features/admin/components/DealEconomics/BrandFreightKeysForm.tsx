import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  getBrandFreightKeys,
  setBrandFreightKey,
  type BrandFreightKeyRow,
} from "../../lib/deal-economics-api";

export function BrandFreightKeysForm() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const isReadOnly = profile?.role === "rep";

  const [brands, setBrands]         = useState<BrandFreightKeyRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [confirmOff, setConfirmOff] = useState<BrandFreightKeyRow | null>(null);
  const [saving, setSaving]         = useState<string | null>(null); // brandId being saved

  useEffect(() => {
    getBrandFreightKeys().then((data) => {
      setBrands(data);
      setLoading(false);
    });
  }, []);

  async function toggle(brand: BrandFreightKeyRow, enabled: boolean) {
    // Optimistic update
    setBrands((prev) =>
      prev.map((b) => (b.id === brand.id ? { ...b, has_inbound_freight_key: enabled } : b))
    );
    setSaving(brand.id);
    const result = await setBrandFreightKey(brand.id, enabled);
    setSaving(null);
    if ("error" in result) {
      // Revert on failure
      setBrands((prev) =>
        prev.map((b) => (b.id === brand.id ? { ...b, has_inbound_freight_key: !enabled } : b))
      );
      toast({ title: "Failed to update", description: result.error, variant: "destructive" });
    } else {
      toast({ title: `${brand.name} freight key ${enabled ? "enabled" : "disabled"}` });
    }
  }

  function handleToggle(brand: BrandFreightKeyRow) {
    if (isReadOnly) return;
    const next = !brand.has_inbound_freight_key;
    if (!next) {
      // Toggling off — require confirm
      setConfirmOff(brand);
    } else {
      toggle(brand, true);
    }
  }

  async function handleConfirmOff() {
    if (!confirmOff) return;
    const brand = confirmOff;
    setConfirmOff(null);
    await toggle(brand, false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Brand Inbound Freight Keys</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
        ) : brands.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No brands found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4">Code</th>
                <th className="pb-2 pr-4">Brand</th>
                <th className="pb-2">Inbound Freight Key</th>
              </tr>
            </thead>
            <tbody>
              {brands.map((brand) => (
                <tr key={brand.id} className="border-b">
                  <td className="py-2 pr-4 font-mono text-xs">{brand.code}</td>
                  <td className="py-2 pr-4">{brand.name}</td>
                  <td className="py-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={brand.has_inbound_freight_key}
                      disabled={isReadOnly || saving === brand.id}
                      onClick={() => handleToggle(brand)}
                      className={[
                        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        "disabled:cursor-not-allowed disabled:opacity-50",
                        brand.has_inbound_freight_key ? "bg-primary" : "bg-muted",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
                          brand.has_inbound_freight_key ? "translate-x-4" : "translate-x-0",
                        ].join(" ")}
                      />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Confirm dialog — toggle OFF only */}
        <Dialog open={!!confirmOff} onOpenChange={(open) => { if (!open) setConfirmOff(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Disable Freight Key for {confirmOff?.name}?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Turning this off means quotes for {confirmOff?.name} will show &ldquo;Inbound freight: TBD at ship&rdquo; instead of a calculated freight line. Continue?
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmOff(null)}>Cancel</Button>
              <Button variant="destructive" onClick={handleConfirmOff}>Disable</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
